import { type Lead } from "@workspace/db";
import { logger } from "./logger";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";

/**
 * Configuração da Evolution, lida A CADA chamada em vez de uma vez no
 * carregamento do módulo — assim o valor efetivo é sempre o que está no
 * ambiente agora, e o teste consegue mudar a configuração sem recarregar nada.
 */
function configEvolution() {
  return {
    // Tira a barra do fim: a URL é montada por concatenação, e uma barra
    // sobrando produziria ".../..//message/sendText/...".
    base: (process.env.EVOLUTION_API_URL ?? "").replace(/\/+$/, ""),
    chave: process.env.EVOLUTION_API_KEY ?? "",
    instancia: process.env.EVOLUTION_INSTANCE ?? "julia",
  };
}

/**
 * Monta a URL de um endpoint da Evolution para a instância configurada.
 *
 * O nome da instância vai codificado. Isto NÃO é preciosismo: o nome real
 * tem espaço ("Vendedora CaptaClin"), e um espaço cru na URL vira 404 na
 * Evolution. Como o `sendWhatsAppMessage` só devolve false e loga, o sintoma
 * seria a Júlia parar de responder sem nenhum erro visível no deploy.
 */
export function urlDaEvolution(caminho: string): string {
  const { base, instancia } = configEvolution();
  return `${base}/${caminho}/${encodeURIComponent(instancia)}`;
}

// Tempo máximo de espera por qualquer serviço externo (em ms).
// Se estourar, a chamada é abortada em vez de deixar a Júlia travada esperando.
const EXTERNAL_TIMEOUT_MS = 10_000;

/**
 * Envia uma mensagem de TEXTO pelo WhatsApp via Evolution.
 * Retorna true se entregou, false caso contrário — quem chama precisa saber,
 * porque gravar no histórico uma resposta que não chegou faz o painel mentir.
 */
export async function sendWhatsAppMessage(
  phone: string,
  message: string
): Promise<boolean> {
  const { base, chave } = configEvolution();
  if (!base || !chave) {
    logger.warn({ phone }, "Evolution API not configured — skipping WhatsApp send");
    return false;
  }

  try {
    const url = urlDaEvolution("message/sendText");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: chave,
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
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, phone }, "Failed to send WhatsApp message");
    return false;
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
  const { base, chave } = configEvolution();
  if (!base || !chave) {
    logger.warn("Evolution API not configured — cannot fetch media");
    return null;
  }

  try {
    const url = urlDaEvolution("chat/getBase64FromMediaMessage");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: chave,
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
  const { base, chave } = configEvolution();
  if (!base || !chave) {
    logger.warn({ phone }, "Evolution API not configured — skipping WhatsApp audio send");
    return false;
  }

  try {
    const url = urlDaEvolution("message/sendWhatsAppAudio");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: chave,
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
