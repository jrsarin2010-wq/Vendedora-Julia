import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  leadsTable,
  leadMessagesTable,
  followUpsTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { openai, speechToText, textToSpeech, detectAudioFormat } from "@workspace/integrations-openai-ai-server";
import {
  JULIA_SYSTEM_PROMPT,
  JULIA_EXTRACTION_PROMPT,
  FOLLOW_UP_TEMPLATES,
  FOLLOW_UP_DELAYS_HOURS,
  buildLeadBriefing,
} from "../julia-persona";
import {
  sendWhatsAppMessage,
  sendTelegramAlert,
  fetchWhatsAppMediaBase64,
  sendWhatsAppAudio,
} from "../lib/integrations";

const router: IRouter = Router();

// Modelos de IA da Júlia (configuráveis por variável de ambiente, pra trocar
// fácil no futuro sem mexer no código):
//  - resposta de venda: rápido e econômico (GPT-5.4 Mini)
//  - analista de dor/objeção: tarefa simples, o mais barato (GPT-5.4 Nano)
const REPLY_MODEL = process.env.JULIA_REPLY_MODEL ?? "gpt-5.4-mini";
const EXTRACTION_MODEL = process.env.JULIA_EXTRACTION_MODEL ?? "gpt-5.4-nano";

// Etapas do funil, na ordem em que uma negociação avança. Serve para a regra
// MONOTÔNICA abaixo: o extrator sugere a etapa, mas ela só pode ir para frente.
// Sem isso, uma mensagem casual ("obrigado!") faria o modelo rebaixar um lead
// de "closing" para "qualified" — pior do que a etapa congelada que havia antes.
const FUNNEL_ORDER = [
  "new",
  "contacted",
  "qualified",
  "interested",
  "objection",
  "closing",
  "closed",
] as const;

type FunnelStage = (typeof FUNNEL_ORDER)[number] | "lost";

// "closed" e "lost" são terminais: podem ser marcados de qualquer ponto.
function podeAvancar(atual: string, novo: FunnelStage): boolean {
  if (novo === "lost" || novo === "closed") return atual !== novo;
  const i = FUNNEL_ORDER.indexOf(atual as (typeof FUNNEL_ORDER)[number]);
  const j = FUNNEL_ORDER.indexOf(novo);
  if (i === -1 || j === -1) return false;
  return j > i;
}

// Senha secreta que só o seu WhatsApp (Evolution) conhece. Se estiver
// configurada, a Júlia só processa mensagens que tragam essa senha — assim
// ninguém de fora consegue forjar mensagens e gastar seu crédito de IA.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "";

function secretMatches(provided: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(WEBHOOK_SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// POST /api/webhook/whatsapp
router.post("/webhook/whatsapp", async (req, res) => {
  // Tranca: confere a senha secreta (cabeçalho x-webhook-secret ou ?secret=).
  if (WEBHOOK_SECRET) {
    const provided =
      req.header("x-webhook-secret") ??
      (typeof req.query.secret === "string" ? req.query.secret : "");
    if (!provided || !secretMatches(provided)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  } else {
    req.log.warn(
      "WEBHOOK_SECRET não configurado — webhook aceitando qualquer origem",
    );
  }

  // Acknowledge immediately to avoid Evolution API timeout
  res.json({ ok: true });

  try {
    const payload = req.body;
    if (!payload?.data) return;

    const event = payload.event as string;
    if (!["messages.upsert", "MESSAGES_UPSERT"].includes(event)) return;

    const msgData = payload.data;
    const key = msgData?.key ?? msgData?.message?.key;
    const fromMe = key?.fromMe ?? false;
    if (fromMe) return; // Ignore messages sent by us

    const phoneRaw: string =
      key?.remoteJid ?? msgData?.remoteJid ?? "";

    // Grupo, status e lista de transmissão NÃO são lead. Sem esta trava, um
    // JID de grupo ("...@g.us") passa direto pelo replace abaixo, vira
    // "telefone", cria lead e a Júlia começa a vender DENTRO do grupo —
    // inclusive em grupo de colegas dentistas.
    if (
      phoneRaw.endsWith("@g.us") ||
      phoneRaw.endsWith("@broadcast") ||
      phoneRaw.startsWith("status@")
    ) {
      req.log.info({ remoteJid: phoneRaw }, "Mensagem de grupo/status ignorada");
      return;
    }

    const phone = phoneRaw.replace("@s.whatsapp.net", "").replace("@c.us", "");
    if (!phone) return;

    // Rede de segurança: se ainda sobrou "@", é um tipo de JID que a gente não
    // conhece (newsletter, @lid, o que o WhatsApp inventar). Melhor ignorar e
    // registrar do que tratar como telefone e responder para o lugar errado.
    if (phone.includes("@")) {
      req.log.warn({ remoteJid: phoneRaw }, "JID desconhecido ignorado");
      return;
    }

    // Get or decode message text
    let text = "";
    const msg = msgData?.message ?? msgData;
    if (msg?.conversation) text = msg.conversation;
    else if (msg?.extendedTextMessage?.text) text = msg.extendedTextMessage.text;
    else if (msg?.message?.conversation) text = msg.message.conversation;
    else if (msg?.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;

    // Se não veio texto, talvez seja um ÁUDIO. A Júlia transcreve e segue
    // o fluxo normal como se fosse texto. Nunca derruba o fluxo se falhar.
    let inboundWasAudio = false;
    if (!text.trim()) {
      const audioMsg = msg?.audioMessage ?? msg?.message?.audioMessage;
      const messageId: string | undefined = key?.id;
      if (audioMsg && messageId) {
        try {
          const base64 = await fetchWhatsAppMediaBase64(messageId);
          if (base64) {
            const buffer = Buffer.from(base64, "base64");
            const detected = detectAudioFormat(buffer);
            // WhatsApp manda áudio em ogg/opus; se não reconhecer, tenta ogg.
            const fmt = detected === "unknown" ? "ogg" : detected;
            text = (await speechToText(buffer, fmt)).trim();
            inboundWasAudio = true;
            req.log.info({ phone }, "Áudio do WhatsApp transcrito");
          }
        } catch (err) {
          req.log.warn({ err, phone }, "Falha ao transcrever áudio do WhatsApp");
        }
      }
    }

    if (!text.trim()) return;

    // Upsert lead
    let lead = (
      await db.select().from(leadsTable).where(eq(leadsTable.phone, phone)).limit(1)
    )[0];

    if (!lead) {
      const inserted = await db
        .insert(leadsTable)
        .values({
          phone,
          origin: "whatsapp",
          status: "warm",
          funnelStage: "new",
          lastMessageAt: new Date(),
        })
        .returning();
      lead = inserted[0];
    } else {
      await db
        .update(leadsTable)
        .set({ lastMessageAt: new Date(), updatedAt: new Date() })
        .where(eq(leadsTable.id, lead.id));
    }

    // Cancela só os follow-ups PENDENTES (o lead respondeu, então a leva
    // armada não deve mais disparar). Os já enviados ficam no histórico.
    await db
      .update(followUpsTable)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(followUpsTable.leadId, lead.id),
          eq(followUpsTable.status, "pending"),
        ),
      );

    // Save inbound message
    await db.insert(leadMessagesTable).values({
      leadId: lead.id,
      direction: "inbound",
      content: text,
      messageType: "text",
    });

    // Get last N messages for context.
    // Buscamos as 30 MAIS RECENTES (desc) e depois invertemos para a ordem
    // cronológica (mais antiga → mais nova), que é o que o modelo espera.
    const recentHistory = await db
      .select()
      .from(leadMessagesTable)
      .where(eq(leadMessagesTable.leadId, lead.id))
      .orderBy(desc(leadMessagesTable.createdAt))
      .limit(30);

    const history = recentHistory.reverse();

    // MEMÓRIA: monta a ficha deste dentista (nome, dor, objeção, etapa, quanto
    // tempo sumiu) e entrega junto do prompt. É isso que faz a Júlia retomar a
    // conversa como quem lembra da pessoa, em vez de começar do zero.
    const lastMessageAt = lead.lastMessageAt ?? null;
    const daysSinceLastMessage = lastMessageAt
      ? Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / 86_400_000)
      : null;
    // "Voltando" = ficou 1 dia ou mais sem falar e já tem conversa anterior.
    const isReturning =
      history.length > 1 && daysSinceLastMessage !== null && daysSinceLastMessage >= 1;

    const leadBriefing = buildLeadBriefing({
      name: lead.name,
      funnelStage: lead.funnelStage,
      painPoints: lead.painPoints,
      mainObjection: lead.mainObjection,
      planInterest: lead.planInterest,
      daysSinceLastMessage,
      isReturning,
      totalMessages: history.length,
    });

    const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: JULIA_SYSTEM_PROMPT },
      { role: "system", content: leadBriefing },
      ...history.map((m) => ({
        role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      })),
    ];

    // Call OpenAI (com timeout: se a IA demorar demais, abortamos em vez de travar)
    const completion = await openai.chat.completions.create(
      {
        model: REPLY_MODEL,
        max_completion_tokens: 512,
        messages: chatMessages,
      },
      { timeout: 30_000 }
    );

    const reply = completion.choices[0]?.message?.content?.trim();
    if (!reply) return;

    // Save outbound message
    await db.insert(leadMessagesTable).values({
      leadId: lead.id,
      direction: "outbound",
      content: reply,
      messageType: "text",
    });

    // Entrega da resposta: se o dentista mandou áudio, a Júlia responde por
    // ÁUDIO (mesmo formato, mais natural). Se a voz falhar por qualquer
    // motivo, cai pra texto — o lead nunca fica sem resposta.
    let delivered = false;
    if (inboundWasAudio) {
      try {
        const audioBuffer = await Promise.race([
          textToSpeech(reply, "nova", "opus"),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("tts timeout")), 30_000),
          ),
        ]);
        if (audioBuffer.length > 0) {
          delivered = await sendWhatsAppAudio(phone, audioBuffer.toString("base64"));
        }
      } catch (err) {
        req.log.warn({ err, phone }, "Falha ao gerar/enviar áudio — caindo pra texto");
      }
    }
    if (!delivered) {
      await sendWhatsAppMessage(phone, reply);
    }

    // Analista de bastidor: lê a conversa e anota a dor e a objeção do lead,
    // pra você receber o lead com contexto. Roda DEPOIS de enviar a resposta
    // (não atrasa o dentista) e nunca derruba o fluxo se falhar.
    try {
      const transcript = [
        ...history.map(
          (m) =>
            `${m.direction === "inbound" ? "Dentista" : "Júlia"}: ${m.content}`,
        ),
        `Júlia: ${reply}`,
      ].join("\n");

      const extraction = await openai.chat.completions.create(
        {
          model: EXTRACTION_MODEL,
          max_completion_tokens: 200,
          messages: [
            { role: "system", content: JULIA_EXTRACTION_PROMPT },
            { role: "user", content: transcript },
          ],
        },
        { timeout: 20_000 },
      );

      const rawExtraction = extraction.choices[0]?.message?.content?.trim() ?? "";
      const jsonText = rawExtraction.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(jsonText) as {
        painPoints?: string | null;
        mainObjection?: string | null;
        name?: string | null;
        planInterest?: string | null;
        funnelStage?: string | null;
      };

      const update: {
        painPoints?: string;
        mainObjection?: string;
        name?: string;
        planInterest?: "basic" | "essencial" | "pro";
        funnelStage?: FunnelStage;
        updatedAt?: Date;
      } = {};
      if (parsed.painPoints && parsed.painPoints.trim()) {
        update.painPoints = parsed.painPoints.trim();
      }
      if (parsed.mainObjection && parsed.mainObjection.trim()) {
        update.mainObjection = parsed.mainObjection.trim();
      }
      // Só grava o nome se ainda não temos um (não sobrescreve o que já sabíamos).
      if (!lead.name && parsed.name && parsed.name.trim()) {
        update.name = parsed.name.trim();
      }
      if (
        parsed.planInterest &&
        ["basic", "essencial", "pro"].includes(parsed.planInterest)
      ) {
        update.planInterest = parsed.planInterest as "basic" | "essencial" | "pro";
      }
      // Etapa do funil: só grava se for válida E se for um avanço. Antes ficava
      // travada em "new" para sempre, e a ficha afirmava ao modelo que um lead
      // de 20 mensagens era novo — fazendo a Júlia reabrir descoberta com quem
      // já tinha discutido preço.
      const stageSugerida = parsed.funnelStage as FunnelStage | undefined;
      if (
        stageSugerida &&
        (FUNNEL_ORDER as readonly string[]).concat("lost").includes(stageSugerida) &&
        podeAvancar(lead.funnelStage, stageSugerida)
      ) {
        update.funnelStage = stageSugerida;
      }

      if (Object.keys(update).length > 0) {
        update.updatedAt = new Date();
        await db
          .update(leadsTable)
          .set(update)
          .where(eq(leadsTable.id, lead.id));
        // reflete em memória pra o alerta do Telegram já sair com o contexto
        if (update.painPoints) lead.painPoints = update.painPoints;
        if (update.mainObjection) lead.mainObjection = update.mainObjection;
        if (update.name) lead.name = update.name;
        if (update.funnelStage) lead.funnelStage = update.funnelStage;
      }
    } catch (err) {
      req.log.warn(
        { err, leadId: lead.id },
        "Extração de dor/objeção falhou (seguindo sem)",
      );
    }

    const lowerReply = reply.toLowerCase();
    const lowerText = text.toLowerCase();

    // Pedido de parar de receber mensagens (opt-out). Respeitamos na hora:
    // o lead deixa de receber follow-ups e NÃO vira handoff (ele quer parar,
    // não falar com humano).
    const optOutPhrases = [
      "parar de receber",
      "para de receber",
      "pare de receber",
      "não quero receber",
      "nao quero receber",
      "para de me mandar",
      "pare de me mandar",
      "não me manda",
      "nao me manda",
      "não me mande",
      "nao me mande",
      "para de mandar",
      "pare de mandar",
      "sair da lista",
      "me tira da lista",
      "descadastr",
      "me remove",
      "não perturbe",
      "nao perturbe",
      "não enviar mais",
      "nao enviar mais",
      "stop",
    ];
    const optedOut = optOutPhrases.some((p) => lowerText.includes(p));

    if (optedOut) {
      const optOutNote = "[OPT-OUT] Lead pediu para parar de receber mensagens.";
      await db
        .update(leadsTable)
        .set({
          status: "lost",
          notes: lead.notes ? `${optOutNote}\n${lead.notes}` : optOutNote,
          updatedAt: new Date(),
        })
        .where(eq(leadsTable.id, lead.id));
      lead.status = "lost"; // impede que a leva de follow-up abaixo seja armada
    }

    // HANDOFF — o lead quer falar com gente de verdade.
    //
    // A versão anterior casava palavras soltas ("dono", "responsável",
    // "atendente", "gerente") e disparava em resposta normal de descoberta:
    // a própria Júlia pergunta "quem responde o WhatsApp da clínica?" e o
    // dentista responde "minha atendente" — handoff falso. Pior: "responsável
    // técnico" é termo obrigatório do CRO, todo dono de clínica é um.
    //
    // Agora tudo é ancorado em PEDIDO ("falar com...", "me liga"), não em
    // substantivo solto. Acentos são removidos dos dois lados, então a lista
    // não precisa duplicar "alguem"/"alguém".
    const semAcento = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const textoNorm = semAcento(text);
    const respostaNorm = semAcento(reply);

    const handoffKeywords = [
      // pedido explícito de falar com uma pessoa
      "falar com uma pessoa",
      "falar com pessoa",
      "falar com alguem",
      "falar com um humano",
      "falar com humano",
      "falar com voce",
      "falar com o responsavel",
      "falar com a responsavel",
      "falar com o dono",
      "falar com o vendedor",
      "falar com um atendente",
      "falar com a equipe",
      "falar com o sarinho",
      "falar com o dr sarinho",
      "falar com dr sarinho",
      "conversar com uma pessoa",
      "conversar com alguem",
      // pedido de contato direto
      "me liga",
      "me ligar",
      "pode me ligar",
      "me chama no telefone",
      "qual o telefone",
      "qual seu telefone",
      "qual o seu numero",
      "qual seu numero",
      // quer confirmar que não é robô
      "atendimento humano",
      "pessoa de verdade",
      "gente de verdade",
      "tem alguem ai",
    ];

    const handoffRequested =
      !optedOut &&
      (handoffKeywords.some((k) => textoNorm.includes(k)) ||
        respostaNorm.includes("vou passar para") ||
        respostaNorm.includes("vou te passar"));

    // Alerta SEMPRE que o lead pedir — não uma única vez na vida dele.
    // Antes, um falso positivo queimava a flag e o pedido real semanas depois
    // passava batido. O update é idempotente; o alerta é que repete.
    if (handoffRequested) {
      await db
        .update(leadsTable)
        .set({ handoffRequested: true, status: "hot", updatedAt: new Date() })
        .where(eq(leadsTable.id, lead.id));

      // Reload for updated data
      const updatedLead = (
        await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)).limit(1)
      )[0];

      if (updatedLead) {
        await sendTelegramAlert({
          type: "handoff",
          lead: updatedLead,
          lastMessage: text,
        });
      }
    }

    // Arma uma leva NOVA de follow-ups, contando a partir de agora.
    // Como acabamos de cancelar os pendentes acima, não há leva ativa — então
    // sempre criamos uma nova. Assim, se o lead sumir, a cadência recomeça do
    // último contato. (Só não arma se o lead já fechou ou foi perdido.)
    if (!["closed", "lost"].includes(lead.status)) {
      const scheduledFollowUps = FOLLOW_UP_DELAYS_HOURS.map((hours, idx) => ({
        leadId: lead.id,
        scheduledAt: new Date(Date.now() + hours * 60 * 60 * 1000),
        touchNumber: idx + 1,
        messageTemplate: FOLLOW_UP_TEMPLATES[((idx + 1) as keyof typeof FOLLOW_UP_TEMPLATES)](
          lead.name,
          lead.painPoints,
        ),
        status: "pending" as const,
      }));

      await db.insert(followUpsTable).values(scheduledFollowUps);
    }
  } catch (err) {
    req.log.error({ err }, "Webhook processing error");
  }
});

export default router;
