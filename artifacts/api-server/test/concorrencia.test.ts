/**
 * CONCORRÊNCIA POR LEAD — a cerca que faltava.
 *
 * O caso real: em 3 conversas o webhook rodou em paralelo sobre o mesmo lead.
 * Às 19:14 saíram duas mensagens CONTRADITÓRIAS no mesmo minuto (uma seguindo
 * a descoberta, outra encerrando depois da recusa); às 12:22 saíram CINCO no
 * mesmo minuto; e o dentista mandando picotado ("Ola julia" / "Renata") virava
 * uma resposta por picote.
 *
 * Nenhum teste deste repositório cobria isso: o driver sempre esperou uma
 * chamada terminar antes de fazer a próxima, que é justamente o cenário em que
 * o defeito não aparece. Aqui as chamadas saem SEM `await` entre elas.
 *
 * A janela de agrupamento vem do ambiente (ver lib/turno-do-lead.ts). Quase
 * todo cenário aqui roda com ela em ZERO — assim o teste é rápido e
 * determinístico, e o que ele prova é o piso da garantia: mensagens que chegam
 * enquanto a anterior ainda está sendo gravada já entram no mesmo grupo. O
 * cenário B é o único que usa janela de verdade, porque é o único que precisa
 * dela: lá a segunda mensagem chega DEPOIS de a primeira já estar gravada.
 */
import { ok, secao, fim } from "./assert";
import { chamar, evento, zerar, saidas, logs } from "./driver";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";

/** Só as mensagens de TEXTO que saíram (a demo em áudio não conta como resposta). */
const textos = () => wa.enviadas.filter((e: any) => e.tipo === "text");

/**
 * As `messages` de cada geração de RESPOSTA, sem as do extrator. O extrator
 * roda no modelo "nano"; a resposta de venda, no "mini" (ver stubs/openai.mjs).
 */
const geracoesDeResposta = () =>
  ctrl.mensagens.filter((_: unknown, i: number) => !String(ctrl.calls[i]).includes("nano"));

/**
 * O que a n-ésima geração de resposta tinha no histórico, sem o prompt do
 * sistema nem a ficha. Só as falas — que é o que estes testes perguntam.
 *
 * Existe por um motivo prático: uma falha que imprimisse `messages` inteiro
 * despejaria o prompt da Júlia (são ~20 mil tokens) no terminal, e ninguém
 * consegue ler um teste vermelho de 400KB.
 */
const falasDaGeracao = (n: number): string[] =>
  ((geracoesDeResposta()[n] ?? []) as Array<{ role: string; content: string }>)
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role}: ${m.content}`);

const resumoDasGeracoes = () =>
  JSON.stringify(geracoesDeResposta().map((_: unknown, i: number) => falasDaGeracao(i)));

const janela = (aberturaMs: string, conversaMs: string) => {
  process.env.AGRUPAMENTO_ABERTURA_MS = aberturaMs;
  process.env.AGRUPAMENTO_MS = conversaMs;
};

secao("A — rajada no mesmo lead vira UMA resposta");

janela("0", "0");
zerar();
await Promise.all([
  chamar(evento("Ola julia")),
  chamar(evento("Aqui e a Renata")),
  chamar(evento("da clinica Sorriso")),
]);

ok(
  "três mensagens picotadas → UMA resposta",
  textos().length === 1,
  JSON.stringify(textos().map((e: any) => e.message)),
);
ok(
  "as três continuam gravadas no histórico",
  saidas("inbound").length === 3,
  `inbound=${saidas("inbound").length}`,
);
ok(
  "a geração enxergou as TRÊS, não só a última",
  geracoesDeResposta().length === 1 &&
    ["Ola julia", "Aqui e a Renata", "da clinica Sorriso"].every((t) =>
      falasDaGeracao(0).some((f) => f.includes(t)),
    ),
  resumoDasGeracoes(),
);
ok(
  "as descartadas dizem no log por que não geraram",
  logs.filter((l) => l.msg.includes("Mensagem mais nova chegou")).length === 2,
  JSON.stringify(logs.map((l) => l.msg)),
);
// RODADA 35 dentro do agrupamento: a rajada põe TRÊS linhas no histórico, então
// "primeira resposta" não pode mais ser medido por contagem de mensagens. Sem
// esta cerca, o agrupamento devolveria em silêncio o teto de 12s de "digitando"
// para quem acabou de clicar no botão do site — o defeito que aquela rodada
// existe para impedir, reinstalado por um conserto de outra coisa.
ok(
  "a resposta agrupada ainda é tratada como PRIMEIRA (teto de 3s)",
  textos()[0]?.primeiraResposta === true,
  JSON.stringify(textos().map((e: any) => e.primeiraResposta)),
);

secao("A2 — a mesma rajada arma UMA leva de follow-up, não três");

// Com o extrator neutro do stub só pontua `respondeu_algo` (3) → faixa fria →
// cadência de 2 toques. Três levas dariam 6, que é o dano colateral que a
// intercalação entre o cancelamento de um handler e o insert de outro produzia.
ok(
  "uma leva de dois toques",
  state.followUps.length === 2,
  `followUps=${state.followUps.length}`,
);

secao("A3 — a rajada cria UM lead");

// No Postgres `leads.phone` é UNIQUE: sem serialização a segunda inserção
// estoura, cai no catch do webhook e a mensagem do dentista some sem nenhum
// sinal. O stub não tem a restrição, então aqui o mesmo defeito aparece como
// lead duplicado — a causa é a mesma.
ok("um lead só", state.leads.length === 1, `leads=${state.leads.length}`);

secao("B — a janela de silêncio agrupa quem chega depois da gravação");

janela("60", "60");
zerar();
const primeiraParte = chamar(evento("oi, tudo bem?"));
// 20ms: tempo de sobra para a fase A da primeira terminar. Sem a janela, ela
// já teria gerado e respondido aqui.
await new Promise((r) => setTimeout(r, 20));
const segundaParte = chamar(evento("é sobre o whatsapp da clinica"));
await Promise.all([primeiraParte, segundaParte]);

ok(
  "duas mensagens dentro da janela → UMA resposta",
  textos().length === 1,
  JSON.stringify(textos().map((e: any) => e.message)),
);
ok(
  "e a resposta enxergou as duas",
  geracoesDeResposta().length === 1 &&
    ["oi, tudo bem?", "é sobre o whatsapp da clinica"].every((t) =>
      falasDaGeracao(0).some((f) => f.includes(t)),
    ),
  resumoDasGeracoes(),
);

secao("C — a trava é POR LEAD, não global");

janela("0", "0");
zerar();
await Promise.all([
  chamar(evento("oi", "5585999998888")),
  chamar(evento("oi", "5585988887777")),
]);

ok("dois dentistas diferentes → duas respostas", textos().length === 2, `${textos().length}`);
ok("dois leads", state.leads.length === 2, `leads=${state.leads.length}`);

secao("D — mensagem que chega DURANTE a geração é respondida depois, em ordem");

// É o caso das 19:14: a recusa chegou com a geração anterior já no ar. Sem a
// trava, as duas respostas saíam no mesmo minuto e se contradiziam, porque a
// segunda foi gerada sem enxergar a primeira. Com a trava, ela espera — e lê.
janela("0", "0");
zerar();
ctrl.atraso = 30;
const emVoo = chamar(evento("quanto custa?"));
await new Promise((r) => setTimeout(r, 15));
const porCima = chamar(evento("na verdade nao tenho interesse"));
await Promise.all([emVoo, porCima]);
ctrl.atraso = 0;

ok("duas respostas, uma para cada", textos().length === 2, `${textos().length}`);
ok(
  "a segunda geração enxergou a resposta da primeira",
  geracoesDeResposta().length === 2 &&
    falasDaGeracao(1).some((f) => f === `assistant: ${ctrl.reply}`),
  resumoDasGeracoes(),
);

fim();
