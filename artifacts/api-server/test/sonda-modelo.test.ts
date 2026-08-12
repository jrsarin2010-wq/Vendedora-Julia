/**
 * A sonda de modelo do boot — o alarme contra o nome de modelo errado.
 *
 * O cenário que ela cobre: JULIA_REPLY_MODEL com um nome que não existe passa
 * por todo deploy verde (o healthcheck não fala com a OpenAI) e só explode na
 * primeira conversa real, em silêncio. A sonda transforma isso em erro de
 * boot, com alerta no Telegram.
 */
import { ok, secao, fim } from "./assert";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";
import {
  alvosDaSonda,
  agruparPorModelo,
  sondarModelos,
  sondarModelosNoBoot,
  type ResultadoDaSonda,
  type RespostaDaSonda,
} from "../src/lib/sonda-modelo";
import { REPLY_MODEL, EXTRACTION_MODEL, OUTREACH_MODEL } from "../src/lib/modelos";

secao("os alvos da sonda são os três papéis, com a resposta primeiro");
{
  const alvos = alvosDaSonda();
  ok("são três papéis", alvos.length === 3);
  ok(
    "o primeiro é a resposta de venda (o que mata a venda se falhar)",
    alvos[0].papel === "resposta" && alvos[0].modelo === REPLY_MODEL,
  );
  ok(
    "extração e abordagem vêm com os modelos da fonte única",
    alvos.some((a) => a.papel === "extração" && a.modelo === EXTRACTION_MODEL) &&
      alvos.some((a) => a.papel === "abordagem" && a.modelo === OUTREACH_MODEL),
  );
}

secao("agrupamento: uma chamada por modelo DISTINTO");
{
  const grupos = agruparPorModelo([
    { papel: "resposta", modelo: "m-a" },
    { papel: "extração", modelo: "m-b" },
    { papel: "abordagem", modelo: "m-a" },
  ]);
  ok("dois modelos distintos viram dois grupos", grupos.length === 2);
  ok(
    "o modelo compartilhado carrega os dois papéis",
    grupos[0].modelo === "m-a" && grupos[0].papeis.join("+") === "resposta+abordagem",
  );
  ok("o modelo exclusivo carrega um papel só", grupos[1].papeis.join("") === "extração");
  ok(
    "hoje os defaults dividem resposta e abordagem num grupo só (2 chamadas, não 3)",
    agruparPorModelo(alvosDaSonda()).length === 2,
  );
}

secao("sondarModelos — sucesso, falha e o alarme");
{
  const chamadas: string[] = [];
  const falhas: ResultadoDaSonda[] = [];
  const chamar = async (modelo: string): Promise<RespostaDaSonda> => {
    chamadas.push(modelo);
    if (modelo === "modelo-que-nao-existe") {
      const erro = new Error("404 The model `modelo-que-nao-existe` does not exist");
      (erro as Error & { status: number }).status = 404;
      throw erro;
    }
    return { respondeu: true, tpmDaConta: "200000", rpmDaConta: "500" };
  };

  const resultados = await sondarModelos(
    [
      { modelo: "modelo-bom", papeis: ["resposta"] },
      { modelo: "modelo-que-nao-existe", papeis: ["extração"] },
      { modelo: "outro-bom", papeis: ["abordagem"] },
    ],
    chamar,
    async (r) => {
      falhas.push(r);
    },
  );

  ok("sondou os três grupos", chamadas.length === 3);
  ok(
    "o sucesso vem com os headers de rate limit (o TPM real da conta)",
    resultados[0].ok && resultados[0].tpmDaConta === "200000" && resultados[0].rpmDaConta === "500",
  );
  ok(
    "a falha vira resultado com o erro descrito, não exceção",
    resultados[1].ok === false && /404/.test(resultados[1].detalhe ?? ""),
  );
  ok(
    "uma falha NÃO impede a sonda seguinte (o alarme não pode cegar o resto)",
    resultados[2].ok === true,
  );
  ok(
    "o alarme disparou só para a falha, com os papéis dela",
    falhas.length === 1 && falhas[0].modelo === "modelo-que-nao-existe" && falhas[0].papeis[0] === "extração",
  );
}

secao("sondarModelos nunca lança — nem quando o próprio alarme falha");
{
  let lancou = false;
  try {
    const resultados = await sondarModelos(
      [{ modelo: "m", papeis: ["resposta"] }],
      async () => {
        throw new Error("rede caiu");
      },
      async () => {
        throw new Error("o Telegram também caiu");
      },
    );
    ok("a falha do alarme não engole o resultado", resultados[0].ok === false);
  } catch {
    lancou = true;
  }
  ok("nenhuma exceção escapou", !lancou);
}

secao("resposta vazia é falha, não sucesso");
{
  const avisos: ResultadoDaSonda[] = [];
  const resultados = await sondarModelos(
    [{ modelo: "m", papeis: ["resposta"] }],
    async () => ({ respondeu: false, tpmDaConta: null, rpmDaConta: null }),
    async (r) => {
      avisos.push(r);
    },
  );
  ok(
    "vazio marca ok=false com o motivo dito",
    resultados[0].ok === false && /vazia/.test(resultados[0].detalhe ?? ""),
  );
  ok("e o alarme dispara também", avisos.length === 1);
}

secao("sondarModelosNoBoot — a fiação real, contra os stubs");
{
  // O caminho inteiro: alvos reais → agrupamento → chamada no client OpenAI
  // (stub) → alerta no Telegram (stub). O stub do OpenAI responde qualquer
  // modelo, então aqui tudo passa — o que se testa é a fiação.
  ctrl.reset();
  wa.reset();
  const resultados = await sondarModelosNoBoot();
  ok(
    "sondou os modelos distintos da configuração real",
    resultados.length === agruparPorModelo(alvosDaSonda()).length,
  );
  ok("todos responderam (o stub responde tudo)", resultados.every((r) => r.ok));
  ok("nenhum alerta de Telegram disparou", wa.sondas.length === 0);
  ok(
    "as chamadas foram para os modelos configurados",
    ctrl.calls.length === resultados.length &&
      ctrl.calls.includes(REPLY_MODEL) &&
      ctrl.calls.includes(EXTRACTION_MODEL),
  );

  // Agora o cenário que motivou a sonda: a OpenAI recusa (modelo não existe).
  ctrl.reset();
  wa.reset();
  ctrl.falhasRestantes = 99; // todas as chamadas falham
  ctrl.falhaStatus = 404;
  ctrl.falhaMensagem = "404 The model does not exist";
  const comFalha = await sondarModelosNoBoot();
  ok("toda sonda falhou", comFalha.every((r) => !r.ok));
  ok(
    "cada modelo com falha rendeu UM alerta no Telegram",
    wa.sondas.length === comFalha.length,
  );
  ok(
    "o alerta diz o modelo e o papel",
    wa.sondas[0].modelo === REPLY_MODEL && /resposta/.test(wa.sondas[0].papeis),
  );
  ctrl.reset();
  wa.reset();
}

fim();
