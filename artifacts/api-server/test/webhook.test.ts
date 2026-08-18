/**
 * Rodada 21 — pontas soltas da auditoria, mais a regressão dos fluxos
 * que já existiam antes dela.
 */
import { ok, secao, fim } from "./assert";
import {
  post,
  chamar,
  evento,
  eventoMidia,
  logs,
  temLog,
  respondeu,
  criouLead,
  saidas,
} from "./driver";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";

secao("A — mídia sem texto deixa de ser ignorada em silêncio");

await post(eventoMidia("imageMessage"));
ok("imagem: a Júlia responde", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
ok(
  "imagem: o aviso pede texto",
  wa.enviadas[0]?.message?.includes("consigo ler melhor por texto") ?? false,
  wa.enviadas[0]?.message,
);
ok("imagem: o lead é criado", criouLead());
ok("imagem: o aviso é gravado no histórico", saidas("outbound").length === 1);
ok("imagem: NÃO grava mensagem recebida vazia", saidas("inbound").length === 0);
ok("imagem: NÃO arma follow-up", state.followUps.length === 0);

await post(eventoMidia("stickerMessage"));
ok(
  "figurinha: resposta leve, sem pedir arquivo",
  wa.enviadas[0]?.message?.startsWith("haha") ?? false,
  wa.enviadas[0]?.message,
);

for (const tipo of ["videoMessage", "documentMessage", "locationMessage", "contactMessage"]) {
  await post(eventoMidia(tipo));
  ok(`${tipo}: também é respondido`, respondeu());
}

ctrl.transcript = "";
wa.media = "AAAA";
await post(eventoMidia("audioMessage"));
ok(
  "áudio não transcrito: avisa que não ouviu",
  wa.enviadas[0]?.message?.includes("ouvir seu áudio") ?? false,
  wa.enviadas[0]?.message,
);
wa.media = null;

await post(eventoMidia("reactionMessage"));
ok(
  "tipo desconhecido: não responde, mas loga",
  !respondeu() && temLog("sem mídia reconhecida"),
  JSON.stringify(logs),
);

wa.entrega = false;
await post(eventoMidia("imageMessage"));
ok("aviso não entregue: não grava no histórico", state.messages.length === 0);
ok("aviso não entregue: loga erro", temLog("Aviso de mídia NÃO entregue"));
wa.entrega = true;

secao("C — webhook repetido");

await post(evento("oi", "5585999998888", "REPETIDO-1"));
const enviadasApos1 = wa.enviadas.length;
await chamar(evento("oi", "5585999998888", "REPETIDO-1"));
ok(
  "mesmo key.id duas vezes → uma só resposta",
  wa.enviadas.length === enviadasApos1,
  JSON.stringify(wa.enviadas),
);
ok("a segunda passagem é logada como repetida", temLog("Webhook repetido"));

secao("B — a resposta só é gravada se foi entregue");

ctrl.reply = "Claro! Me conta mais.";
wa.entrega = true;
await post(evento("quanto custa?"));
ok("entregou: resposta gravada", saidas("outbound").length === 1);
ok("entregou: mensagem recebida gravada", saidas("inbound").length === 1);
// A leva agora é da cadência da temperatura (Rodada 41). Com o extrator neutro
// do stub, só pontua o respondeu_algo (3) → frio → 2 toques.
ok("entregou: follow-ups armados", state.followUps.length === 2, String(state.followUps.length));

wa.entrega = false;
await post(evento("quanto custa?"));
ok("falhou: resposta NÃO gravada", saidas("outbound").length === 0);
ok("falhou: loga erro", temLog("Resposta NÃO entregue"), JSON.stringify(logs));
ok("falhou: mensagem recebida continua gravada", saidas("inbound").length === 1);
wa.entrega = true;

// D — RESPOSTA VAZIA. As duas caras da mesma falha (18/08/2026).
//
// Gerar a resposta falha de dois jeitos: a chamada LANÇA, ou ela volta 200 com
// conteúdo vazio. O desfecho para o dentista é idêntico — ele falou e ninguém
// respondeu —, mas só o caminho que lançava mandava o lead para a central de
// vigia. A cara barulhenta era vigiada, a silenciosa ficava numa linha de log
// que ninguém lê a menos que já esteja procurando.
//
// É a mesma assimetria que a abordagem tinha, e é a que faz um defeito parecer
// dois: metade dos relatos chega com alerta, metade não chega nunca.
secao("D — resposta vazia do modelo");

ctrl.reply = "";
await post(evento("oi"));
ok("loga erro", temLog("resposta vazia"), JSON.stringify(logs));
ok("nada é enviado", !respondeu());
ok(
  "e o lead VAI para a central de vigia — silêncio não pode ser o desfecho",
  (state.leads[0] as any)?.atencao === "julia_estranha",
  String((state.leads[0] as any)?.atencao),
);
ok(
  "com detalhe que diz o que houve, para quem for ler a conversa depois",
  String((state.leads[0] as any)?.atencaoDetalhe ?? "").includes("sem resposta"),
  String((state.leads[0] as any)?.atencaoDetalhe),
);
ctrl.reply = "Oi!";

secao("D2 — o mesmo, quando a causa é o teto de saída estourado");
{
  state.reset();
  ctrl.reset();
  ctrl.reply = "";
  ctrl.finishReason = "length";
  await post(evento("oi"));
  ok("nada é enviado", !respondeu());
  ok(
    "o log nomeia o teto, em vez de dizer só que veio vazia",
    temLog("estourou o teto"),
    JSON.stringify(logs),
  );
  ok(
    "e o lead vai para a central do mesmo jeito",
    (state.leads[0] as any)?.atencao === "julia_estranha",
    String((state.leads[0] as any)?.atencao),
  );
  ctrl.finishReason = "stop";
  ctrl.reply = "Oi!";
}

secao("regressão — fluxos anteriores à Rodada 21");

await post({
  event: "messages.upsert",
  data: {
    key: { id: "G1", remoteJid: "5585123456789-1600000000@g.us", fromMe: false },
    message: { conversation: "oi" },
  },
});
ok("grupo continua ignorado", !respondeu() && !criouLead());

await post({
  event: "messages.upsert",
  data: {
    key: { id: "F1", remoteJid: "5585999998888@s.whatsapp.net", fromMe: true },
    message: { conversation: "oi" },
  },
});
ok("fromMe continua ignorado", !respondeu() && !criouLead());

await post(evento("quero falar com uma pessoa"));
ok("handoff continua disparando alerta", wa.alertas.length === 1);

await post(evento("quero parar de receber mensagens"));
ok("opt-out continua sem armar follow-up", state.followUps.length === 0);

fim();
