/**
 * Rodada 29 — quando um humano assume a conversa, a Júlia se cala.
 *
 * O risco que estes testes existem para travar: `fromMe` cobre TANTO o que a
 * Júlia envia pela API QUANTO o que uma pessoa digita no celular. Se o código
 * não distinguir os dois, ela se auto-pausa a cada resposta e emudece para
 * sempre — uma falha que some no log e só aparece como "a Júlia parou de
 * responder".
 */
import { ok, secao, fim } from "./assert";
import { post, chamar, evento, eventoFromMe, eventoMidia, temLog, respondeu, saidas } from "./driver";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { linhas } from "./stubs/logger.mjs";
import {
  registrarEnviadaPorNos,
  enviadaPorNos,
  limparEnviadas,
} from "../src/lib/enviadas-por-nos";
import { rodarCicloDeFollowUp } from "../src/lib/follow-up-scheduler";
import { rodarCicloDeAbordagem } from "../src/lib/outreach-scheduler";

const NUMERO = "5585999998888";
const pausaDoLead = () => state.leads[0]?.pausedUntil ?? null;

// ── O registro de identidade, isolado ──────────────────────────────────────

secao("enviadas-por-nos — o registro que separa nós do humano");
limparEnviadas();
ok("id desconhecido não é nosso", !enviadaPorNos("NUNCA-VI-ESSE"));
registrarEnviadaPorNos("ABC123");
ok("depois de registrar, é nosso", enviadaPorNos("ABC123"));
ok(
  "ler não consome (a Evolution manda upsert E update da mesma mensagem)",
  enviadaPorNos("ABC123") && enviadaPorNos("ABC123"),
);
ok("id vazio nunca é nosso", !enviadaPorNos("") && !enviadaPorNos(null) && !enviadaPorNos(undefined));
registrarEnviadaPorNos(null);
registrarEnviadaPorNos("");
ok("registrar id vazio não quebra nem polui", !enviadaPorNos(""));
limparEnviadas();
ok("limpar zera de verdade", !enviadaPorNos("ABC123"));

// ── O webhook ──────────────────────────────────────────────────────────────

secao("fromMe enviado por NÓS não pausa (senão ela emudece sozinha)");
await post(evento("oi, tudo bem?", NUMERO));
ok("a conversa começou normal", respondeu());
ok("nasce sem pausa", !pausaDoLead());

limparEnviadas();
registrarEnviadaPorNos("MENSAGEM-NOSSA-1");
await chamar(eventoFromMe("Oi! Aqui é a Júlia 😊", NUMERO, "MENSAGEM-NOSSA-1"));
ok("a resposta da própria Júlia NÃO pausa", !pausaDoLead(), String(pausaDoLead()));
ok("e não vira log de humano assumindo", !temLog("Humano assumiu"));

secao("fromMe digitado no CELULAR pausa por 5 minutos");
await post(evento("quanto custa?", NUMERO));
limparEnviadas(); // nada que venha agora foi registrado como nosso
await chamar(eventoFromMe("Oi doutor, é o suporte aqui, deixa comigo", NUMERO, "DIGITADA-NO-CELULAR"));

const ate = pausaDoLead();
ok("pausou", Boolean(ate), String(ate));
ok("logou que o humano assumiu", temLog("Humano assumiu"));
{
  const faltam = new Date(ate).getTime() - Date.now();
  ok(
    "a pausa é de ~5 minutos",
    faltam > 4.5 * 60 * 1000 && faltam <= 5 * 60 * 1000,
    `${Math.round(faltam / 1000)}s`,
  );
}

secao("o Telegram avisa que ele assumiu — UMA vez, não a cada mensagem");
ok("avisou na virada", wa.pausas.length === 1, JSON.stringify(wa.pausas));
ok("o aviso aponta o lead certo", wa.pausas[0]?.lead?.phone === NUMERO);

secao("cada mensagem do humano RENOVA o prazo");
{
  const primeira = new Date(pausaDoLead()).getTime();
  await new Promise((r) => setTimeout(r, 25));
  await chamar(eventoFromMe("já te respondo certinho", NUMERO, "DIGITADA-NO-CELULAR-2"));
  const segunda = new Date(pausaDoLead()).getTime();
  ok("o prazo foi empurrado para frente", segunda > primeira, `${primeira} -> ${segunda}`);
  // Renovar não avisa de novo: senão o Telegram viraria eco de tudo que ele
  // digita no celular.
  ok("a renovação NÃO gera novo aviso", wa.pausas.length === 1, JSON.stringify(wa.pausas));
}

secao("durante a pausa: a mensagem é GRAVADA, a resposta não sai");
{
  const enviadasAntes = wa.enviadas.length;
  await chamar(evento("beleza, e o preço do Pro?", NUMERO));
  ok("nenhuma resposta foi enviada", wa.enviadas.length === enviadasAntes, JSON.stringify(wa.enviadas));
  ok("logou o motivo", temLog("Conversa pausada"));
  ok(
    "MAS a mensagem do dentista entrou no histórico",
    saidas("inbound").some((m: any) => m.content === "beleza, e o preço do Pro?"),
    JSON.stringify(saidas("inbound")),
  );
}

secao("durante a pausa, nem o aviso de mídia escapa");
{
  const enviadasAntes = wa.enviadas.length;
  await chamar(eventoMidia("imageMessage", NUMERO));
  ok("o aviso de mídia foi suprimido", wa.enviadas.length === enviadasAntes, JSON.stringify(wa.enviadas));
  ok("e o motivo aparece no log", temLog("aviso de mídia não enviado"));
}

secao("passada a pausa, ela volta a responder sozinha");
{
  // Empurra o relógio da pausa para o passado, que é o mesmo que esperar.
  state.leads[0].pausedUntil = new Date(Date.now() - 1000);
  const enviadasAntes = wa.enviadas.length;
  await chamar(evento("oi? ainda tá aí?", NUMERO));
  ok("voltou a responder", wa.enviadas.length > enviadasAntes, JSON.stringify(wa.enviadas));
}

secao("pausa expirada não bloqueia nada");
{
  await post(evento("primeira", NUMERO));
  state.leads[0].pausedUntil = new Date(Date.now() - 60_000);
  const antes = wa.enviadas.length;
  await chamar(evento("segunda", NUMERO));
  ok("respondeu normalmente", wa.enviadas.length > antes);
  ok("não logou pausa", !temLog("Conversa pausada"));
}

secao("fromMe de quem NÃO é lead não cria lead fantasma");
{
  await post(evento("oi", NUMERO));
  const quantosAntes = state.leads.length;
  limparEnviadas();
  await chamar(eventoFromMe("oi, tudo certo?", "5511888887777", "PARA-DESCONHECIDO"));
  ok(
    "mensagem nossa para quem nunca falou com a Júlia não vira lead",
    state.leads.length === quantosAntes,
    `${quantosAntes} -> ${state.leads.length}`,
  );
}

secao("o áudio de demo também é nosso — não pode auto-pausar");
{
  // O envio de áudio passa pelo mesmo registro de id. Se ele não registrasse,
  // toda demo enviada calaria a Júlia por 5 minutos logo depois de impressionar
  // o dentista — exatamente no pior momento.
  await post(evento("me mostra como ela responde", NUMERO));
  limparEnviadas();
  registrarEnviadaPorNos("AUDIO-DEMO-1");
  await chamar(eventoFromMe("", NUMERO, "AUDIO-DEMO-1"));
  ok("a demo enviada por nós não pausa", !pausaDoLead(), String(pausaDoLead()));
}

// ── Os agendadores ─────────────────────────────────────────────────────────

secao("follow-up vencido NÃO dispara em cima do humano");
{
  await post(evento("oi", NUMERO));
  const lead = state.leads[0];
  // A conversa acima já armou a leva normal de follow-ups (todos agendados
  // para o futuro, então não disparam). O nosso é este, vencido e identificado
  // pelo id — pegar `followUps[0]` pegaria um dos automáticos.
  state.followUps.push({
    id: 900,
    leadId: lead.id,
    status: "pending",
    touchNumber: 1,
    scheduledAt: new Date(Date.now() - 60_000), // vencido
    messageTemplate: "toque de teste",
  });
  const meuToque = () => state.followUps.find((f: any) => f.id === 900);

  lead.pausedUntil = new Date(Date.now() + 5 * 60 * 1000);
  const antes = wa.enviadas.length;
  linhas.length = 0;
  await rodarCicloDeFollowUp();
  ok("o follow-up não saiu", wa.enviadas.length === antes, JSON.stringify(wa.enviadas));
  // O agendador usa o `logger` do módulo, não o `req.log` do webhook.
  ok(
    "logou que foi adiado",
    linhas.some((l: any) => l.msg.includes("follow-up adiado")),
    JSON.stringify(linhas),
  );
  ok(
    "e o ciclo não estourou exceção",
    !linhas.some((l: any) => l.msg.includes("Follow-up scheduler error")),
    JSON.stringify(linhas),
  );
  ok(
    "e continua PENDENTE (adiado, não perdido)",
    meuToque().status === "pending",
    meuToque().status,
  );

  // Passada a pausa, o mesmo toque sai na rodada seguinte.
  lead.pausedUntil = new Date(Date.now() - 1000);
  await rodarCicloDeFollowUp();
  ok(
    "depois da pausa o toque sai",
    wa.enviadas.some((e: any) => e.message === "toque de teste"),
    JSON.stringify(wa.enviadas),
  );
  ok("e aí sim vira 'sent'", meuToque().status === "sent", meuToque().status);
}

secao("abordagem fria não cai por cima de quem o humano já chamou");
{
  // O caso real: ele manda mensagem pelo celular para uma clínica importada
  // antes da Júlia chegar nela. Sem a trava, a abordagem dela cairia por cima.
  state.reset();
  wa.reset();
  process.env.OUTREACH_ENABLED = "true";
  state.leads.push({
    id: 1,
    phone: "5511777776666",
    name: "Marina",
    clinicName: "Odonto Vida",
    origin: "import",
    outreachStatus: "pending",
    status: "cold",
    funnelStage: "new",
    createdAt: new Date(),
    pausedUntil: new Date(Date.now() + 5 * 60 * 1000),
  });

  const r = await rodarCicloDeAbordagem();
  ok("não abordou", !r.enviou, JSON.stringify(r));
  ok("nada foi enviado", wa.enviadas.length === 0, JSON.stringify(wa.enviadas));
  ok(
    "e NÃO foi marcado como skipped (a pausa é temporária)",
    state.leads[0].outreachStatus === "pending",
    state.leads[0].outreachStatus,
  );
}

fim();
