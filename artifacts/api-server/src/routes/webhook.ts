import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  leadsTable,
  leadMessagesTable,
  followUpsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  JULIA_SYSTEM_PROMPT,
  FOLLOW_UP_TEMPLATES,
  FOLLOW_UP_DELAYS_HOURS,
} from "../julia-persona";
import { sendWhatsAppMessage, sendTelegramAlert } from "../lib/integrations";

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

    // Cancel any pending follow-ups since lead replied
    await db
      .update(followUpsTable)
      .set({ status: "cancelled" })
      .where(eq(followUpsTable.leadId, lead.id));

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

    // Check if handoff needed
    const handoffKeywords = [
      "falar com humano",
      "falar com pessoa",
      "falar com alguém",
      "atendente",
      "responsável",
      "dono",
      "gerente",
      "cancelar",
    ];
    const lowerReply = reply.toLowerCase();
    const lowerText = text.toLowerCase();
    const handoffRequested =
      handoffKeywords.some((k) => lowerText.includes(k)) ||
      lowerReply.includes("vou passar para") ||
      lowerReply.includes("nosso time");

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

    // Schedule follow-ups if lead hasn't closed
    if (!["closed", "lost"].includes(lead.status)) {
      const scheduledFollowUps = FOLLOW_UP_DELAYS_HOURS.map((hours, idx) => ({
        leadId: lead.id,
        scheduledAt: new Date(Date.now() + hours * 60 * 60 * 1000),
        touchNumber: idx + 1,
        messageTemplate: FOLLOW_UP_TEMPLATES[((idx + 1) as keyof typeof FOLLOW_UP_TEMPLATES)](lead.name),
        status: "pending" as const,
      }));

      // Only add if no pending follow-ups exist
      const existing = await db
        .select({ id: followUpsTable.id })
        .from(followUpsTable)
        .where(eq(followUpsTable.leadId, lead.id))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(followUpsTable).values(scheduledFollowUps);
      }
    }
  } catch (err) {
    req.log.error({ err }, "Webhook processing error");
  }
});

export default router;
