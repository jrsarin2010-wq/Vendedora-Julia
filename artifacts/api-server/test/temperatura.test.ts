/**
 * Rodada 41, Parte 1 — temperatura por SINAL, não por atividade.
 *
 * O problema que esta rodada mata: "warm" era qualquer um que mandou mensagem,
 * então quem perguntou preço e comparou planos ficava igual a quem mandou "oi".
 * Agora cada sinal pontua, a pontuação acumula sem repetir, e o status
 * (hot/warm/cold) é DERIVADO da pontuação.
 */
import { ok, secao, fim } from "./assert";
import { post, chamar, evento } from "./driver";
import { state } from "./stubs/db.mjs";
import { ctrl } from "./stubs/openai.mjs";
import {
  SINAIS_DE_TEMPERATURA,
  SINAIS_DO_EXTRATOR,
  registrarSinais,
  lerSinaisVistos,
  faixaDaTemperatura,
  statusDaFaixa,
} from "../src/lib/temperatura";
import { JULIA_EXTRACTION_PROMPT } from "../src/julia-persona";

// ── A tabela de pontos ──────────────────────────────────────────────────────

secao("cada sinal vale o que a rodada definiu");
ok("pediu_link vale 30", SINAIS_DE_TEMPERATURA.pediu_link === 30);
ok("pediu_pessoa (handoff) vale 30", SINAIS_DE_TEMPERATURA.pediu_pessoa === 30);
ok("disse_vou_pensar vale 20 — é quase-fechamento", SINAIS_DE_TEMPERATURA.disse_vou_pensar === 20);
ok("perguntou_preco vale 15", SINAIS_DE_TEMPERATURA.perguntou_preco === 15);
ok("contou_a_dor vale 10", SINAIS_DE_TEMPERATURA.contou_a_dor === 10);
ok("respondeu_algo vale só 3 — falar não esquenta", SINAIS_DE_TEMPERATURA.respondeu_algo === 3);
ok(
  "todo sinal do extrator existe na tabela de pontos",
  SINAIS_DO_EXTRATOR.every((s) => s in SINAIS_DE_TEMPERATURA),
);
ok(
  "pediu_pessoa e respondeu_algo NÃO estão na lista do extrator (são do webhook)",
  !SINAIS_DO_EXTRATOR.includes("pediu_pessoa") && !SINAIS_DO_EXTRATOR.includes("respondeu_algo"),
);

// ── Acúmulo sem repetição ───────────────────────────────────────────────────

secao("registrarSinais — soma certo e o mesmo sinal não pontua duas vezes");
{
  const r1 = registrarSinais(null, ["perguntou_preco", "contou_a_dor"]);
  ok("preço + dor = 25", r1.temperatura === 25, String(r1.temperatura));

  const r2 = registrarSinais(r1.sinaisVistos, ["perguntou_preco"]);
  ok(
    "perguntar preço de novo NÃO soma de novo",
    r2.temperatura === 25,
    String(r2.temperatura),
  );

  const r3 = registrarSinais(r2.sinaisVistos, ["pediu_link"]);
  ok("um sinal novo soma em cima", r3.temperatura === 55, String(r3.temperatura));

  const r4 = registrarSinais(null, ["sinal_que_o_modelo_inventou", "perguntou_preco"]);
  ok("sinal desconhecido é descartado", r4.temperatura === 15, String(r4.temperatura));

  ok(
    "lerSinaisVistos ignora lixo no campo",
    lerSinaisVistos("perguntou_preco,lixo_antigo, contou_a_dor").length === 2,
  );
  ok("campo vazio = nenhum sinal", lerSinaisVistos(null).length === 0);
}

// ── As faixas, nos limites ──────────────────────────────────────────────────

secao("faixas — os limites 9/10, 29/30 e 59/60 classificam certo");
ok("0 → frio", faixaDaTemperatura(0) === "frio");
ok("9 → frio", faixaDaTemperatura(9) === "frio");
ok("10 → morno", faixaDaTemperatura(10) === "morno");
ok("29 → morno", faixaDaTemperatura(29) === "morno");
ok("30 → quente", faixaDaTemperatura(30) === "quente");
ok("59 → quente", faixaDaTemperatura(59) === "quente");
ok("60 → fervendo", faixaDaTemperatura(60) === "fervendo");
ok("95 → fervendo", faixaDaTemperatura(95) === "fervendo");

secao("status derivado da faixa — o painel continua entendendo");
ok("frio → cold", statusDaFaixa("frio") === "cold");
ok("morno → warm", statusDaFaixa("morno") === "warm");
ok("quente → hot", statusDaFaixa("quente") === "hot");
ok("fervendo → hot", statusDaFaixa("fervendo") === "hot");

// ── O prompt do extrator ────────────────────────────────────────────────────

secao("o extrator foi ensinado a ver os sinais");
ok(
  "o prompt pede os sinais de interesse",
  JULIA_EXTRACTION_PROMPT.includes("SINAIS DE INTERESSE"),
);
ok(
  'o JSON de resposta tem o campo "sinais"',
  JULIA_EXTRACTION_PROMPT.includes('"sinais"'),
);
ok(
  "a lista de nomes está no prompt, exata",
  SINAIS_DO_EXTRATOR.every((s) => JULIA_EXTRACTION_PROMPT.includes(s)),
);
ok(
  'CASO CRÍTICO: "não é pra mim" NÃO é vou pensar — um é recusa, o outro quase-fechamento',
  JULIA_EXTRACTION_PROMPT.includes('"Não é pra mim" NÃO é vou pensar') &&
    JULIA_EXTRACTION_PROMPT.includes("quase-fechamento"),
);
ok(
  "na dúvida, o extrator não inclui",
  JULIA_EXTRACTION_PROMPT.includes("Na dúvida, não inclua"),
);

// ── O webhook de ponta a ponta ──────────────────────────────────────────────

const EXTRACAO_NEUTRA = ctrl.extraction;
const extracao = (sinais: string[]): string =>
  JSON.stringify({
    painPoints: null,
    mainObjection: null,
    name: null,
    planInterest: null,
    funnelStage: null,
    isCustomer: false,
    wantsToStop: false,
    sinais,
  });

secao("webhook — os sinais do extrator viram temperatura e status");
{
  ctrl.extraction = extracao(["perguntou_preco", "contou_a_dor"]);
  await post(evento("quanto custa? aqui ninguém responde o whatsapp"));
  const lead = state.leads[0];
  ok(
    "preço + dor + respondeu_algo = 28",
    lead.temperatura === 28,
    String(lead.temperatura),
  );
  ok("28 é morno → status warm", lead.status === "warm", lead.status);
  ok(
    "os sinais ficaram anotados",
    String(lead.sinaisVistos).includes("perguntou_preco") &&
      String(lead.sinaisVistos).includes("respondeu_algo"),
    String(lead.sinaisVistos),
  );
}

secao("webhook — o mesmo sinal em outra mensagem não soma de novo");
{
  ctrl.extraction = extracao(["perguntou_preco", "contou_a_dor"]);
  await post(evento("quanto custa?"));
  // segunda mensagem do MESMO lead (post zera o banco; chamar não)
  ctrl.extraction = extracao(["perguntou_preco"]);
  await chamar(evento("e o preço, como é?"));
  const lead = state.leads[0];
  ok("continua 28", lead.temperatura === 28, String(lead.temperatura));
}

secao("webhook — quem só manda 'oi' fica FRIO, não morno");
{
  ctrl.extraction = extracao([]);
  await post(evento("oi"));
  const lead = state.leads[0];
  ok("respondeu_algo sozinho = 3", lead.temperatura === 3, String(lead.temperatura));
  ok("3 é frio → status cold", lead.status === "cold", lead.status);
}

secao("webhook — pedir uma pessoa (handoff) pontua pediu_pessoa");
{
  ctrl.extraction = extracao([]);
  await post(evento("quero falar com uma pessoa"));
  const lead = state.leads[0];
  ok(
    "pediu_pessoa + respondeu_algo = 33",
    lead.temperatura === 33,
    String(lead.temperatura),
  );
  ok("33 é quente → status hot", lead.status === "hot", lead.status);
}

secao("webhook — extração falhou? o respondeu_algo ainda conta");
{
  ctrl.extraction = "não sou um json";
  await post(evento("oi"));
  const lead = state.leads[0];
  ok("temperatura 3 mesmo sem extrator", lead.temperatura === 3, String(lead.temperatura));
}

secao("webhook — cliente e perdido não mudam de status pela temperatura");
{
  ctrl.extraction = extracao(["pediu_link", "perguntou_como_assinar", "perguntou_contrato"]);
  await post(evento("primeira mensagem pra criar o lead"));
  state.leads[0].status = "closed";
  ctrl.extraction = extracao(["perguntou_seguranca"]);
  await chamar(evento("é seguro pagar?"));
  const lead = state.leads[0];
  ok("a pontuação continua sendo anotada", lead.temperatura >= 60, String(lead.temperatura));
  ok("mas o status closed não é tocado", lead.status === "closed", lead.status);
}

ctrl.extraction = EXTRACAO_NEUTRA;

fim();
