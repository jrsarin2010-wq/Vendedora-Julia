import { type Lead } from "@workspace/db";
import { logger } from "./logger";

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL ?? "";
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY ?? "";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE ?? "julia";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";

// Tempo máximo de espera por qualquer serviço externo (em ms).
// Se estourar, a chamada é abortada em vez de deixar a Júlia travada esperando.
const EXTERNAL_TIMEOUT_MS = 10_000;

export async function sendWhatsAppMessage(
  phone: string,
  message: string
): Promise<void> {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    logger.warn({ phone }, "Evolution API not configured — skipping WhatsApp send");
    return;
  }

  try {
    const url = `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        number: phone,
        text: message,
      }),
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ phone, status: response.status, body }, "Evolution API error");
    }
  } catch (err) {
    logger.error({ err, phone }, "Failed to send WhatsApp message");
  }
}

interface HandoffAlert {
  type: "handoff";
  lead: Lead;
  lastMessage: string;
}

export async function sendTelegramAlert(alert: HandoffAlert): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    logger.warn("Telegram not configured — skipping alert");
    return;
  }

  try {
    const { lead, lastMessage } = alert;

    const text = [
      `🚨 *HANDOFF SOLICITADO — Lead precisa de atenção humana*`,
      ``,
      `👤 *Nome:* ${lead.name ?? "Não informado"}`,
      `📱 *Telefone:* ${lead.phone}`,
      `📍 *Estágio:* ${lead.funnelStage}`,
      `🔥 *Status:* ${lead.status}`,
      `💼 *Plano de interesse:* ${lead.planInterest ?? "Não definido"}`,
      `😟 *Dor principal:* ${lead.painPoints ?? "Não identificada"}`,
      `🚧 *Objeção:* ${lead.mainObjection ?? "Nenhuma registrada"}`,
      ``,
      `💬 *Última mensagem do lead:*`,
      `_${lastMessage}_`,
      ``,
      `_Júlia está mantendo o lead aquecido enquanto aguarda._`,
    ].join("\n");

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "Markdown",
      }),
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ status: response.status, body }, "Telegram API error");
    }
  } catch (err) {
    logger.error({ err }, "Failed to send Telegram alert");
  }
}
