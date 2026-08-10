/**
 * Rodada 27 — os áudios de demonstração.
 *
 * A tabela da seção 2.6, mais o que ela implica. O fio condutor é o mesmo das
 * outras rodadas: a demo é BÔNUS. Nenhuma falha dela — marcador inventado,
 * arquivo faltando, envio recusado — pode impedir o dentista de receber a
 * resposta em texto.
 *
 * Os arquivos são de verdade: o teste escreve três MP3 falsos numa pasta
 * temporária e aponta DEMOS_DIR para lá. Assim a leitura de arquivo é
 * exercitada de verdade, e o caso "arquivo faltando" é o arquivo faltando
 * mesmo, não um stub configurado para falhar.
 */
import { ok, secao, fim } from "./assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const pasta = mkdtempSync(path.join(tmpdir(), "demos-"));
process.env.DEMOS_DIR = pasta;

const { extrairDemo, jaEnviadas, registrar, podeEnviar, lerDemo, DEMOS, ROTEIROS, LIMITE_DEMOS } =
  await import("../src/lib/demos");
const { post, chamar, evento, eventoMidia, logs, temLog, saidas } = await import("./driver");
const { state } = await import("./stubs/db.mjs");
const { wa } = await import("./stubs/integrations.mjs");
const { ctrl } = await import("./stubs/openai.mjs");

for (const nome of DEMOS) {
  writeFileSync(path.join(pasta, `${nome}.mp3`), Buffer.from(`MP3-FALSO-${nome}`));
}

secao("os três roteiros existem e são o que vai virar áudio");
ok("são exatamente três", DEMOS.length === 3, DEMOS.join(","));
for (const nome of DEMOS) {
  ok(`${nome}: tem roteiro`, (ROTEIROS[nome]?.length ?? 0) > 80, String(ROTEIROS[nome]?.length));
}
ok("limite é 2 por lead", LIMITE_DEMOS === 2);

secao("extrair o marcador do texto");
let r = extrairDemo("Olha como eu respondo:\n[DEMO:vou_pensar]");
ok("reconhece a demo", r.demo === "vou_pensar", String(r.demo));
ok("o marcador some do texto", r.texto === "Olha como eu respondo:", JSON.stringify(r.texto));
ok("o dentista nunca vê a palavra DEMO", !r.texto.includes("DEMO"));

r = extrairDemo("Texto qualquer [DEMO:qualquer] e mais texto");
ok("marcador inválido: nenhuma demo", r.demo === null);
ok("marcador inválido: mesmo assim some do texto", !r.texto.includes("DEMO"), r.texto);

r = extrairDemo("Sem marcador nenhum.");
ok("sem marcador: demo null", r.demo === null);
ok("sem marcador: texto intacto", r.texto === "Sem marcador nenhum.");

r = extrairDemo("[DEMO:quanto_custa]");
ok("resposta só com marcador: texto fica vazio", r.texto === "");

secao("contabilidade das demos por lead");
ok("lista vazia", jaEnviadas(null).length === 0);
ok("lê csv", jaEnviadas("vou_pensar,quanto_custa").length === 2);
ok("registra a primeira", registrar(null, "vou_pensar") === "vou_pensar");
ok("registra a segunda", registrar("vou_pensar", "quanto_custa") === "vou_pensar,quanto_custa");
ok("não duplica", registrar("vou_pensar", "vou_pensar") === "vou_pensar");
ok("primeira demo pode", podeEnviar("vou_pensar", null).pode);
ok("a mesma de novo NÃO pode", !podeEnviar("vou_pensar", "vou_pensar").pode);
ok(
  "e o motivo é a repetição",
  podeEnviar("vou_pensar", "vou_pensar").motivo === "demo repetida",
);
ok("segunda diferente pode", podeEnviar("quanto_custa", "vou_pensar").pode);
ok(
  "terceira NÃO pode",
  !podeEnviar("fora_do_horario", "vou_pensar,quanto_custa").pode,
);
ok(
  "e o motivo é o limite",
  podeEnviar("fora_do_horario", "vou_pensar,quanto_custa").motivo ===
    "limite por lead atingido",
);

secao("ler o arquivo");
ok("lê um mp3 existente", (await lerDemo("vou_pensar")) !== null);
rmSync(path.join(pasta, "fora_do_horario.mp3"));
ok("arquivo faltando devolve null, não lança", (await lerDemo("fora_do_horario")) === null);
writeFileSync(path.join(pasta, "fora_do_horario.mp3"), Buffer.from("MP3-FALSO"));

secao("no webhook — texto primeiro, áudio depois");
ctrl.reply = "Deixa eu te mostrar:\n[DEMO:vou_pensar]";
await post(evento("não sei se funciona com meu paciente"));
ok("mandou duas coisas", wa.enviadas.length === 2, JSON.stringify(wa.enviadas.map((e: any) => e.tipo)));
ok("primeiro o TEXTO", wa.enviadas[0]?.tipo === "text");
ok("depois o ÁUDIO", wa.enviadas[1]?.tipo === "audio");
ok("o marcador não foi enviado", !wa.enviadas[0]?.message?.includes("DEMO"), wa.enviadas[0]?.message);
ok(
  "o texto entregue é o limpo",
  wa.enviadas[0]?.message === "Deixa eu te mostrar:",
  wa.enviadas[0]?.message,
);
let gravadas = saidas("outbound");
ok("gravou duas mensagens", gravadas.length === 2, String(gravadas.length));
ok("a primeira como text", (gravadas[0] as any).messageType === "text");
ok("a segunda como audio", (gravadas[1] as any).messageType === "audio");
ok(
  "o histórico não guarda o marcador",
  !(gravadas[0] as any).content.includes("DEMO:"),
  (gravadas[0] as any).content,
);
ok("marcou a demo no lead", (state.leads[0] as any).demosEnviadas === "vou_pensar");

secao("marcador inválido — texto entregue, nenhum áudio");
ctrl.reply = "Olha só isso aqui [DEMO:qualquer]";
await post(evento("oi"));
ok("só o texto saiu", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
ok("é texto", wa.enviadas[0]?.tipo === "text");
ok("sem o marcador", !wa.enviadas[0]?.message?.includes("DEMO"));
ok("nada foi marcado no lead", !(state.leads[0] as any).demosEnviadas);

secao("arquivo faltando — o texto chega e o erro aparece no log");
rmSync(path.join(pasta, "quanto_custa.mp3"));
ctrl.reply = "Escuta isso:\n[DEMO:quanto_custa]";
await post(evento("quanto custa?"));
ok("o texto foi entregue", wa.enviadas.length === 1 && wa.enviadas[0]?.tipo === "text");
ok("nenhum áudio", !wa.enviadas.some((e: any) => e.tipo === "audio"));
ok("logou o erro", temLog("Arquivo da demo não encontrado"), JSON.stringify(logs));
ok("não marcou como enviada", !(state.leads[0] as any).demosEnviadas);
writeFileSync(path.join(pasta, "quanto_custa.mp3"), Buffer.from("MP3-FALSO"));

secao("a mesma demo duas vezes — a segunda é ignorada");
ctrl.reply = "Olha:\n[DEMO:vou_pensar]";
await post(evento("primeira"));
ok("a primeira vez manda o áudio", wa.enviadas.some((e: any) => e.tipo === "audio"));
ctrl.reply = "Olha de novo:\n[DEMO:vou_pensar]";
// `chamar` (e não `post`) porque o lead precisa sobreviver entre as duas
// mensagens — é a memória dele que segura o limite. Só os envios são zerados.
wa.reset();
await chamar(evento("segunda"));
ok("a segunda vez NÃO manda áudio", !wa.enviadas.some((e: any) => e.tipo === "audio"), JSON.stringify(wa.enviadas));
ok("mas o texto foi entregue", wa.enviadas.length === 1 && wa.enviadas[0]?.tipo === "text");
ok("logou o motivo", temLog("Demo não enviada"));
ok("o lead continua com uma só", (state.leads[0] as any).demosEnviadas === "vou_pensar");

secao("terceira demo no mesmo lead — ignorada");
ctrl.reply = "Primeira:\n[DEMO:vou_pensar]";
await post(evento("um"));
ctrl.reply = "Segunda:\n[DEMO:quanto_custa]";
wa.reset();
await chamar(evento("dois"));
ok(
  "duas demos diferentes passam",
  (state.leads[0] as any).demosEnviadas === "vou_pensar,quanto_custa",
  (state.leads[0] as any).demosEnviadas,
);
ctrl.reply = "Terceira:\n[DEMO:fora_do_horario]";
wa.reset();
await chamar(evento("tres"));
ok("a terceira não sai", !wa.enviadas.some((e: any) => e.tipo === "audio"), JSON.stringify(wa.enviadas));
ok("o texto sai normalmente", wa.enviadas[0]?.tipo === "text");
ok(
  "o lead continua com duas",
  (state.leads[0] as any).demosEnviadas === "vou_pensar,quanto_custa",
);

secao("envio do áudio falhando — o texto já chegou, a conversa segue");
wa.entregaAudio = false;
ctrl.reply = "Olha:\n[DEMO:vou_pensar]";
await post(evento("oi"));
ok("o texto foi entregue", wa.enviadas[0]?.tipo === "text");
ok("logou a falha", temLog("Demo não entregue"));
ok(
  "NÃO marcou como enviada — pode tentar de novo depois",
  !(state.leads[0] as any).demosEnviadas,
);
ok("gravou só a mensagem de texto", saidas("outbound").length === 1);
wa.entregaAudio = true;

secao("resposta que é SÓ o marcador — nada é enviado, e isso aparece no log");
ctrl.reply = "[DEMO:vou_pensar]";
await post(evento("oi"));
ok("nada saiu", wa.enviadas.length === 0, JSON.stringify(wa.enviadas));
ok("logou", temLog("só com o marcador"), JSON.stringify(logs));

secao("Rodada 27 — áudio recebido é transcrito, mas a resposta vai em TEXTO");
ctrl.reply = "Entendi, doutor. Hoje quem responde o WhatsApp da clínica?";
ctrl.transcript = "oi, queria saber como funciona";
wa.media = "QUFBQQ==";
await post(eventoMidia("audioMessage"));
ok("transcreveu o áudio", temLog("Áudio do WhatsApp transcrito"));
ok("respondeu", wa.enviadas.length === 1);
ok("respondeu por TEXTO, não por voz", wa.enviadas[0]?.tipo === "text", wa.enviadas[0]?.tipo);
ok("gravou como text", (saidas("outbound")[0] as any).messageType === "text");
ok(
  "a transcrição virou a mensagem recebida",
  (saidas("inbound")[0] as any)?.content === "oi, queria saber como funciona",
);
wa.media = null;
ctrl.transcript = "";

rmSync(pasta, { recursive: true, force: true });
fim();
