/**
 * A PENEIRA DOS SINAIS — o extrator propõe, o código confere.
 *
 * O primeiro bloco é o lead 49 de 18/08/2026, reconstruído: 40 dos 53 pontos
 * dele vieram de dois sinais que nunca aconteceram. É o cenário que a peneira
 * existe para reprovar, e ele fica em primeiro lugar de propósito — se um dia
 * este arquivo ficar verde por engano, é aqui que se olha.
 *
 * As asserções de "não deixou passar" valem mais que as de "deixou": sinal a
 * mais é ponto que ninguém ganhou, e `sinaisVistos` nunca zera, então o erro
 * dura para sempre.
 */
import { ok, secao, fim } from "./assert";
import {
  MINIMO_DO_TRECHO,
  SINAIS_QUE_EXIGEM_PROVA,
  normalizar,
  peneirarSinais,
} from "../src/lib/peneira-de-sinais";
import { SINAIS_DE_TEMPERATURA } from "../src/lib/temperatura";

const dele = (...ms: string[]) => ms;

// ---------------------------------------------------------------------------
secao("O LEAD 49 — os dois sinais inventados caem, o verdadeiro fica");
{
  // A Júlia perguntou duas vezes quantos profissionais são e nunca foi
  // respondida (por isso `sem_resposta`), e ele nunca perguntou como assinar.
  const r = peneirarSinais(
    ["respondeu_algo", "perguntou_recurso", "perguntou_como_assinar", "disse_quantos_prof"],
    {
      descoberta: { profissionais: "sem_resposta" },
      painPoints: null,
      trechos: {},
      mensagensDele: dele(
        "oi, vi sua mensagem",
        "e isso responde sozinho mesmo? como funciona",
      ),
    },
  );

  ok(
    "perguntou_como_assinar CAIU — 30 pontos sem prova nenhuma",
    !r.aceitos.includes("perguntou_como_assinar"),
    r.aceitos.join(","),
  );
  ok(
    "disse_quantos_prof CAIU — o próprio extrator disse sem_resposta",
    !r.aceitos.includes("disse_quantos_prof"),
    r.aceitos.join(","),
  );
  ok(
    "perguntou_recurso FICOU — ele perguntou mesmo, e não é sinal de 30",
    r.aceitos.includes("perguntou_recurso"),
    r.aceitos.join(","),
  );
  ok("respondeu_algo FICOU", r.aceitos.includes("respondeu_algo"));

  const pontos = r.aceitos.reduce((t, s) => t + (SINAIS_DE_TEMPERATURA[s as never] ?? 0), 0);
  ok(
    `sobram 13 pontos (frio->morno) em vez de 53 (quente): ${pontos}`,
    pontos === 13,
    JSON.stringify(r),
  );
  ok("e os dois descartes vão com motivo", r.descartados.length === 2, JSON.stringify(r.descartados));
}

// ---------------------------------------------------------------------------
secao("TRAVA 1 — coerência com o próprio JSON do extrator");

for (const [rotulo, descoberta, esperado] of [
  ["sem_resposta reprova", { profissionais: "sem_resposta" }, false],
  ["tópico ausente reprova", {}, false],
  ["descoberta nula reprova", null, false],
  ["valor vazio reprova", { profissionais: "" }, false],
  ["um número aprova", { profissionais: "2" }, true],
  ["texto aprova", { profissionais: "eu e mais uma" }, true],
] as Array<[string, Record<string, unknown> | null, boolean]>) {
  const r = peneirarSinais(["disse_quantos_prof"], {
    descoberta,
    painPoints: null,
    trechos: {},
    mensagensDele: dele("somos dois aqui"),
  });
  ok(`disse_quantos_prof: ${rotulo}`, r.aceitos.includes("disse_quantos_prof") === esperado, JSON.stringify(r));
}

{
  const semDor = peneirarSinais(["contou_a_dor"], {
    descoberta: {},
    painPoints: null,
    trechos: {},
    mensagensDele: dele("é complicado aqui"),
  });
  ok("contou_a_dor cai sem painPoints", !semDor.aceitos.includes("contou_a_dor"));

  const comDor = peneirarSinais(["contou_a_dor"], {
    descoberta: {},
    painPoints: "perde paciente que chama fora do horário",
    trechos: {},
    mensagensDele: dele("de noite ninguém responde"),
  });
  ok("contou_a_dor passa com painPoints", comDor.aceitos.includes("contou_a_dor"));
}

// ---------------------------------------------------------------------------
secao("TRAVA 2 — os dois sinais de 30 têm que apontar a fala DELE");

ok(
  "a lista de quem exige prova é exatamente os dois de 30 que vêm do extrator",
  JSON.stringify([...SINAIS_QUE_EXIGEM_PROVA].sort()) ===
    JSON.stringify(["pediu_link", "perguntou_como_assinar"]),
  SINAIS_QUE_EXIGEM_PROVA.join(","),
);
ok(
  "e os dois valem mesmo 30 (se a tabela mudar, esta lista tem que ser revista)",
  SINAIS_QUE_EXIGEM_PROVA.every((s) => SINAIS_DE_TEMPERATURA[s] === 30),
);

for (const sinal of SINAIS_QUE_EXIGEM_PROVA) {
  const comProva = peneirarSinais([sinal], {
    descoberta: {},
    painPoints: null,
    trechos: { [sinal]: "me manda o link pra assinar" },
    mensagensDele: dele("boa tarde", "me manda o link pra assinar entao"),
  });
  ok(`${sinal}: passa quando o trecho está na fala dele`, comProva.aceitos.includes(sinal), JSON.stringify(comProva));

  const semTrecho = peneirarSinais([sinal], {
    descoberta: {},
    painPoints: null,
    trechos: {},
    mensagensDele: dele("me manda o link pra assinar entao"),
  });
  ok(`${sinal}: CAI sem trecho, mesmo com a fala existindo`, !semTrecho.aceitos.includes(sinal));

  const inventado = peneirarSinais([sinal], {
    descoberta: {},
    painPoints: null,
    trechos: { [sinal]: "quero assinar hoje mesmo" },
    mensagensDele: dele("boa tarde", "vou ver com meu socio"),
  });
  ok(`${sinal}: CAI com trecho inventado`, !inventado.aceitos.includes(sinal), JSON.stringify(inventado));

  const daJulia = peneirarSinais([sinal], {
    descoberta: {},
    painPoints: null,
    // A frase existe na conversa, mas quem disse foi ELA. `mensagensDele` só
    // tem inbound, então a autoria se resolve sozinha, sem regra própria.
    trechos: { [sinal]: "quer que eu te mande o link pra assinar" },
    mensagensDele: dele("boa tarde"),
  });
  ok(`${sinal}: CAI quando o trecho é fala da JÚLIA`, !daJulia.aceitos.includes(sinal), JSON.stringify(daJulia));

  const curto = peneirarSinais([sinal], {
    descoberta: {},
    painPoints: null,
    trechos: { [sinal]: "ok" },
    mensagensDele: dele("ok"),
  });
  ok(`${sinal}: CAI com trecho curto demais (< ${MINIMO_DO_TRECHO})`, !curto.aceitos.includes(sinal));
}

secao("a comparação perdoa acento, caixa e pontuação — não a invenção");
{
  const r = peneirarSinais(["pediu_link"], {
    descoberta: {},
    painPoints: null,
    trechos: { pediu_link: "Voce PODE me mandar o link!!" },
    mensagensDele: dele("você pode me mandar o link, por favor?"),
  });
  ok(
    "acento, caixa e pontuação não derrubam sinal verdadeiro",
    r.aceitos.includes("pediu_link"),
    JSON.stringify(r),
  );
  ok("normalizar tira acento e pontuação", normalizar("Você PODE?!") === "voce pode");

  // A FRONTEIRA, e ela é deliberada: a peneira perdoa GRAFIA, não PARÁFRASE.
  // O extrator trocar "vc" por "você" já é reescrever a fala dele, e uma
  // comparação que aceitasse isso teria que aceitar semelhança — que é
  // exatamente a porta por onde a citação inventada volta a entrar.
  //
  // O preço está no lado barato: sinal verdadeiro que morre aqui volta na
  // mensagem seguinte e vale os mesmos 30. Sinal falso que passa vale 30 para
  // sempre, porque `sinaisVistos` nunca zera.
  const parafrase = peneirarSinais(["pediu_link"], {
    descoberta: {},
    painPoints: null,
    trechos: { pediu_link: "você pode me mandar o link" },
    mensagensDele: dele("vc pode me mandar o link"),
  });
  ok(
    "paráfrase NÃO passa, mesmo querendo dizer a mesma coisa",
    !parafrase.aceitos.includes("pediu_link"),
    JSON.stringify(parafrase),
  );
}

secao("os sinais que NÃO são de 30 seguem sem precisar de trecho");
{
  const r = peneirarSinais(["perguntou_preco", "comparou_planos", "perguntou_seguranca"], {
    descoberta: {},
    painPoints: null,
    trechos: {},
    mensagensDele: dele("quanto custa?"),
  });
  ok("os três passaram sem prova citada", r.aceitos.length === 3, JSON.stringify(r));
}

fim();
