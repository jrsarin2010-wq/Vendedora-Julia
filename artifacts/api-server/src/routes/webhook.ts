import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  leadsTable,
  leadMessagesTable,
  followUpsTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { openai, speechToText, detectAudioFormat } from "@workspace/integrations-openai-ai-server";
import {
  JULIA_SYSTEM_PROMPT,
  JULIA_EXTRACTION_PROMPT,
  FOLLOW_UP_TEMPLATES,
  FOLLOW_UP_DELAYS_HOURS,
} from "../julia-persona";
import { sendWhatsAppMessage, sendTelegramAlert, fetchWhatsAppMediaBase64 } from "../lib/integrations";

const router: IRouter = Router();

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
    const phone = phoneRaw.replace("@s.whatsapp.net", "").replace("@c.us", "");
    if (!phone) return;

    // Get or decode message text
    let text = "";
    const msg = msgData?.message ?? msgData;
    if (msg?.conversation) text = msg.conversation;
    else if (msg?.extendedTextMessage?.text) text = msg.extendedTextMessage.text;
    else if (msg?.message?.conversation) text = msg.message.conversation;
    else if (msg?.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;

    // Se não veio texto, talvez seja um ÁUDIO. A Júlia transcreve e segue
    // o fluxo normal como se fosse texto. Nunca derruba o fluxo se falhar.
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

    const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: JULIA_SYSTEM_PROMPT },
      ...history.map((m) => ({
        role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      })),
    ];

    // Call OpenAI (com timeout: se a IA demorar demais, abortamos em vez de travar)
    const completion = await openai.chat.completions.create(
      {
        model: "gpt-5.4",
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

    // Send via Evolution API
    await sendWhatsAppMessage(phone, reply);

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
          model: "gpt-5.4",
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
      };

      const update: { painPoints?: string; mainObjection?: string; updatedAt?: Date } = {};
      if (parsed.painPoints && parsed.painPoints.trim()) {
        update.painPoints = parsed.painPoints.trim();
      }
      if (parsed.mainObjection && parsed.mainObjection.trim()) {
        update.mainObjection = parsed.mainObjection.trim();
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

    // Check if handoff needed (não dispara em caso de opt-out)
    const handoffKeywords = [
      "falar com humano",
      "falar com pessoa",
      "falar com alguém",
      "atendente",
      "responsável",
      "dono",
      "gerente",
    ];
    const handoffRequested =
      !optedOut &&
      (handoffKeywords.some((k) => lowerText.includes(k)) ||
        lowerReply.includes("vou passar para") ||
        lowerReply.includes("nosso time"));

    if (handoffRequested && !lead.handoffRequested) {
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
        messageTemplate: FOLLOW_UP_TEMPLATES[((idx + 1) as keyof typeof FOLLOW_UP_TEMPLATES)](lead.name),
        status: "pending" as const,
      }));

      await db.insert(followUpsTable).values(scheduledFollowUps);
    }
  } catch (err) {
    req.log.error({ err }, "Webhook processing error");
  }
});

export default router;
