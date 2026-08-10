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
ok("entregou: follow-ups armados", state.followUps.length === 4);

wa.entrega = false;
await post(evento("quanto custa?"));
ok("falhou: resposta NÃO gravada", saidas("outbound").length === 0);
ok("falhou: loga erro", temLog("Resposta NÃO entregue"), JSON.stringify(logs));
ok("falhou: mensagem recebida continua gravada", saidas("inbound").length === 1);
wa.entrega = true;

secao("D — resposta vazia do modelo");

ctrl.reply = "";
await post(evento("oi"));
ok("loga erro", temLog("resposta vazia"), JSON.stringify(logs));
ok("nada é enviado", !respondeu());
ctrl.reply = "Oi!";

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
