/**
 * O SINAL DE CORTESIA (Rodada 56) — ele responde por educacao, nao por
 * interesse.
 *
 * Sete conversas reais lidas em 19/08/2026. As duas que MAIS responderam foram
 * as que morreram: o lead 44 respondeu quatro perguntas e parou; o 49 respondeu
 * cinco e encerrou dizendo que nao tinha se inscrito para entrevista. O padrao
 * comum eram respostas de duas ou tres palavras, uma atras da outra.
 *
 * O que fazer com o sinal esta no prompt (FASE 2, B4). O que se prova aqui e a
 * OBSERVACAO: o codigo conta, a ficha entrega o fato pronto, e o modelo nao
 * precisa lembrar de contar palavras atraves da janela de contexto.
 */
import { ok, secao, fim } from "./assert";
import {
  contarPalavras,
  ehRespostaDeCortesia,
  respondePorCortesia,
} from "../src/lib/sinal-de-cortesia";
import { buildLeadBriefing } from "../src/julia-persona";

const ficha = (p: Record<string, unknown>): string =>
  buildLeadBriefing({
    name: "Carlos",
    funnelStage: "new",
    painPoints: null,
    mainObjection: null,
    planInterest: null,
    daysSinceLastMessage: null,
    isReturning: false,
    totalMessages: 4,
    origin: "maps",
    ...p,
  } as Parameters<typeof buildLeadBriefing>[0]);

const AVISO = "As DUAS últimas respostas dele têm até três palavras";

secao("A — o que conta como palavra");

ok("palavras normais", contarPalavras("sou eu mesmo") === 3);
ok("acento nao quebra a contagem", contarPalavras("é a secretária") === 3);
// Emoji e pontuacao solta nao viram palavra: senao um "ok 👍" contaria como
// duas e escaparia do limite justo no caso mais curto que existe.
ok("emoji nao e palavra", contarPalavras("ok 👍") === 1);
ok("pontuacao sozinha nao e palavra", contarPalavras("sim ...") === 1);
ok("texto vazio da zero", contarPalavras("   ") === 0);

secao("B — uma resposta de cortesia");

ok("uma palavra", ehRespostaDeCortesia("sim"));
ok("tres palavras", ehRespostaDeCortesia("sou eu mesmo"));
ok("quatro palavras ja e conversa", !ehRespostaDeCortesia("sou eu mesmo sim"));
ok("vazio nao conta", !ehRespostaDeCortesia("   "));
// A trava que impede o sinal de queimar um lead bom: quem PERGUNTA esta
// puxando a conversa, nao a empurrando para o fim.
ok("pergunta curta NAO e cortesia", !ehRespostaDeCortesia("quanto custa?"));
ok("nem a mais curta de todas", !ehRespostaDeCortesia("como?"));

secao("C — duas seguidas fecham o sinal");

ok("duas curtas seguidas", respondePorCortesia(["sim", "a secretária"]));
ok("uma so nao basta", !respondePorCortesia(["sim"]));
ok("lista vazia nao dispara", !respondePorCortesia([]));
ok(
  "curta seguida de longa NAO dispara — olha o fim da lista",
  !respondePorCortesia(["sim", "olha, na verdade a gente perde bastante gente à noite"]),
);
// A porta de saida da B4: ele voltou a escrever de verdade, o sinal cai.
ok(
  "duas curtas la atras nao seguram o sinal depois de uma resposta de verdade",
  !respondePorCortesia(["sim", "a secretária", "deixa eu te contar como funciona aqui"]),
);
ok(
  "e tres curtas seguidas continuam disparando",
  respondePorCortesia(["sim", "sou eu", "a secretária"]),
);

secao("D — a ficha entrega o fato, e so no MODO B");

{
  const curtas = ["sim", "a secretária"];
  const modoB = ficha({ origin: "maps", mensagensDele: curtas });
  ok("no MODO B o aviso aparece", modoB.includes(AVISO), modoB);
  ok(
    "e manda aplicar a regra que descreve o comportamento",
    modoB.includes("aplique a FASE 2, B4"),
    modoB,
  );

  // Quem chegou sozinho respondendo "sim" esta sendo objetivo, nao educado: o
  // sinal so significa desinteresse quando foi a Julia que chamou.
  ok(
    "quem chegou sozinho pelo WhatsApp nao dispara",
    !ficha({ origin: "whatsapp", mensagensDele: curtas }).includes(AVISO),
  );
  ok(
    "quem veio do site nao dispara",
    !ficha({ origin: "site", mensagensDele: curtas }).includes(AVISO),
  );
  ok(
    "sem origem nenhuma nao dispara",
    !ficha({ origin: null, mensagensDele: curtas }).includes(AVISO),
  );
}

{
  // Linha morta na ficha e ruido, e ruido o modelo preenche com suposicao —
  // mesma razao da reputacao e do que ja foi perguntado.
  ok(
    "sem o sinal, a linha nao existe",
    !ficha({ mensagensDele: ["me conta melhor como isso funciona aí"] }).includes(AVISO),
  );
  ok(
    "e sem as mensagens dele tambem nao",
    !ficha({}).includes(AVISO),
  );
}

fim();
