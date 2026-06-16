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

/**
 * Busca o áudio (ou outra mídia) de uma mensagem do WhatsApp já decifrado,
 * em base64, usando a Evolution API. O WhatsApp criptografa as mídias, então
 * não dá pra ler direto do payload — é preciso pedir à Evolution.
 *
 * Retorna o base64 da mídia, ou null se não conseguir (sem derrubar o fluxo).
 */
export async function fetchWhatsAppMediaBase64(
  messageId: string,
): Promise<string | null> {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    logger.warn("Evolution API not configured — cannot fetch media");
    return null;
  }

  try {
    const url = `${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${EVOLUTION_INSTANCE}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY,
      },
      body: JSON.stringify({ message: { key: { id: messageId } } }),
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error(
        { status: response.status, body },
        "Evolution getBase64FromMediaMessage error",
      );
      return null;
    }

    const data = (await response.json()) as { base64?: string };
    return data?.base64 ?? null;
  } catch (err) {
    logger.error({ err }, "Failed to fetch WhatsApp media");
    return null;
  }
}

/**
 * Envia uma mensagem de ÁUDIO (nota de voz) pelo WhatsApp via Evolution.
 * Recebe o áudio em base64. Retorna true se enviou, false caso contrário
 * (pra quem chama poder cair pra texto se falhar).
 */
export async function sendWhatsAppAudio(
  phone: string,
  audioBase64: string,
): Promise<boolean> {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    logger.warn({ phone }, "Evolution API not configured — skipping WhatsApp audio send");
    return false;
  }

  try {
    const url = `${EVOLUTION_API_URL}/message/sendWhatsAppAudio/${EVOLUTION_INSTANCE}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY,
      },
      body: JSON.stringify({ number: phone, audio: audioBase64 }),
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error(
        { phone, status: response.status, body },
        "Evolution sendWhatsAppAudio error",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, phone }, "Failed to send WhatsApp audio");
    return false;
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
