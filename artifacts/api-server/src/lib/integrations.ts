import { type Lead } from "@workspace/db";
import { logger } from "./logger";
import { registrarEnviadaPorNos } from "./enviadas-por-nos";

/**
 * Anota o id da mensagem que a Evolution acabou de criar, para o webhook saber
 * depois que este `fromMe` foi nosso e não de um humano no celular.
 *
 * Nunca derruba o envio: a mensagem JÁ foi entregue quando chegamos aqui. Se o
 * corpo vier num formato inesperado, o pior caso é a Júlia se calar por 5
 * minutos naquela conversa — ruim, mas muito melhor do que estourar uma exceção
 * depois de entregue e fazer quem chamou achar que falhou.
 */
async function anotarIdEnviado(response: Response, phone: string): Promise<void> {
  try {
    const corpo = (await response.json()) as { key?: { id?: string } };
    const id = corpo?.key?.id;
    if (id) {
      registrarEnviadaPorNos(id);
      return;
    }
    logger.warn(
      { phone },
      "Evolution não devolveu key.id — a Júlia pode se auto-pausar nesta conversa",
    );
  } catch (err) {
    logger.warn({ err, phone }, "Não consegui ler o key.id da resposta da Evolution");
  }
}

/**
 * Configuração do Telegram, lida A CADA chamada — mesma decisão do
 * `configEvolution()` logo abaixo, e pelo mesmo motivo: o valor efetivo passa a
 * ser o que está no ambiente agora, e o teste consegue exercitar o caminho
 * "configurado" sem recarregar módulo. Lido no topo do arquivo, o alerta ficava
 * intestável: quem definisse a variável depois do import não mudava nada.
 */
function configTelegram() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
  };
}

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
 * O nome da instância vai codificado. Uma ressalva honesta sobre o motivo:
 * para o nome atual ("Vendedora CaptaClin"), o ESPAÇO sozinho não quebrava —
 * o parser de URL do Node normaliza espaço para %20 automaticamente, então o
 * código antigo funcionava por sorte. Medido, não suposto.
 *
 * O que o parser NÃO normaliza são os caracteres que já têm significado na
 * URL: "#" trunca tudo que vem depois, "?" vira query string e "/" vira outro
 * segmento de caminho. Um nome de instância com qualquer um deles produziria
 * uma requisição para o lugar errado — e, como o envio só devolve false e
 * loga, o sintoma seria a Júlia parar de responder sem erro visível.
 *
 * Ou seja: isto é blindagem contra o nome mudar, não o conserto de um bug
 * ativo. Vale ter porque o nome da instância é configuração, não código.
 */
export function urlDaEvolution(caminho: string): string {
  const { base, instancia } = configEvolution();
  return `${base}/${caminho}/${encodeURIComponent(instancia)}`;
}

// Tempo máximo de espera por qualquer serviço externo (em ms).
// Se estourar, a chamada é abortada em vez de deixar a Júlia travada esperando.
const EXTERNAL_TIMEOUT_MS = 10_000;

/**
 * Tempo que uma pessoa levaria digitando este texto, para a Júlia não
 * responder instantaneamente. Velocidade de celular, não de teclado.
 *
 * Exportada porque é a única parte testável desta borda: o resto é rede.
 */
export function tempoDeDigitacao(texto: string): number {
  const MS_POR_CARACTERE = 45; // ~26 caracteres por segundo é rápido demais; 45ms ≈ digitação de celular
  const MINIMO_MS = 2_000; // nunca instantâneo
  const MAXIMO_MS = 12_000; // acima disso o dentista acha que sumiu
  const base = texto.length * MS_POR_CARACTERE;
  const variacao = 0.85 + Math.random() * 0.3; // ±15%, porque tempo exato é robô
  return Math.min(MAXIMO_MS, Math.max(MINIMO_MS, Math.round(base * variacao)));
}

/** O teto de `tempoDeDigitacao`. Serve para o orçamento de timeout abaixo. */
export const MAXIMO_DIGITACAO_MS = 12_000;

/**
 * Envia uma mensagem de TEXTO pelo WhatsApp via Evolution.
 * Retorna true se entregou, false caso contrário — quem chama precisa saber,
 * porque gravar no histórico uma resposta que não chegou faz o painel mentir.
 *
 * DIGITAÇÃO HUMANIZADA (Rodada 28): mandamos `delay` (ms) e `presence`, e a
 * Evolution mostra "digitando..." pelo tempo pedido antes de entregar.
 *
 * O detalhe que decide o timeout, verificado no código da Evolution e não
 * suposto: o `delay` é BLOQUEANTE do nosso lado. Em
 * `whatsapp.baileys.service.ts`, `sendMessageWithTyping` faz
 * `await delay(options.delay)` DENTRO do handler, antes do `sendMessage` — ou
 * seja, a resposta HTTP só volta depois de o atraso inteiro passar. Com o
 * timeout fixo de 10s, um texto longo (atraso de até 12s) seria abortado por
 * nós e a mensagem NÃO sairia.
 *
 * Por isso o timeout desta chamada é o orçamento normal MAIS o atraso pedido:
 * os 10s continuam valendo para a rede e o processamento, e o tempo de
 * "digitação" entra por cima, sem comer o prazo do resto.
 *
 * Não há risco para o webhook: a rota já responde `{ ok: true }` antes de
 * processar (routes/webhook.ts), então a Evolution nunca fica esperando por
 * nós — o atraso vive apenas neste fetch.
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

  const atraso = tempoDeDigitacao(message);

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
        delay: atraso,
        presence: "composing",
      }),
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS + atraso),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ phone, status: response.status, body }, "Evolution API error");
      return false;
    }
    await anotarIdEnviado(response, phone);
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
 *
 * SEM atraso de digitação, de propósito. Duas razões:
 *
 * 1. O áudio de demo vai logo DEPOIS de um texto que já esperou até 12s
 *    "digitando". Somar outro atraso aqui deixaria o dentista olhando para a
 *    tela sem nada acontecer por perto de meio minuto.
 * 2. A demo é uma gravação pronta, não uma fala improvisada na hora.
 *
 * Registro do que foi verificado, para quem quiser mudar de ideia depois: a
 * Evolution SUPORTA atraso aqui, e com a presença certa — `audioWhatsapp`
 * passa `{ presence: 'recording', delay }` fixo, então apareceria "gravando
 * áudio...", nunca "digitando...". A porta está aberta; a escolha de não usar
 * é pelo ritmo da conversa, não por limitação da API.
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
    // O áudio de demonstração também volta como `fromMe`. Sem anotar o id aqui,
    // a Júlia se pausaria sozinha toda vez que mandasse uma demo.
    await anotarIdEnviado(response, phone);
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

/**
 * O telefone como LINK do WhatsApp, para o alerta virar um toque em vez de
 * "copiar o número na mão e procurar a conversa". É o ponto do alerta: o lead
 * mais quente que existe é o que pediu para falar com uma pessoa, e cada
 * segundo de atrito aí custa caro.
 *
 * `wa.me` exige só dígitos. O telefone já vem do `remoteJid` com DDI, mas a
 * limpeza é barata e protege contra número gravado com máscara na importação.
 */
export function linkDoWhatsApp(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

/**
 * Alerta de que um humano assumiu uma conversa pelo celular.
 *
 * Existe para o Dr. Sarinho ter registro de quando pegou cada conversa. Dispara
 * só na VIRADA (conversa solta -> pausada), nunca na renovação: como cada
 * mensagem dele empurra o prazo, avisar a cada uma transformaria o Telegram num
 * eco do que ele acabou de digitar.
 */
interface PausaAlert {
  type: "pausa";
  lead: Lead;
  ate: Date;
}

/** Manda o texto para o Telegram. Nunca lança: alerta é aviso, não fluxo. */
async function enviarAoTelegram(text: string, contexto: string): Promise<void> {
  const { token, chatId } = configTelegram();
  if (!token || !chatId) {
    // Este warn é a única pista de que um lead quente passou batido. Diz o que
    // falta e o que se perdeu, porque quem for ler o log depois do prejuízo
    // precisa entender na primeira linha.
    logger.warn(
      { contexto },
      "Telegram não configurado (falta TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID) — alerta NÃO enviado",
    );
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        // O alerta traz um link wa.me e o preview do WhatsApp só ocupa espaço.
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ status: response.status, body, contexto }, "Telegram API error");
    }
  } catch (err) {
    logger.error({ err, contexto }, "Failed to send Telegram alert");
  }
}

export async function sendTelegramAlert(alert: HandoffAlert): Promise<void> {
  const { lead, lastMessage } = alert;

  const text = [
    `🚨 *HANDOFF SOLICITADO — Lead precisa de atenção humana*`,
    ``,
    `👤 *Nome:* ${lead.name ?? "Não informado"}`,
    // Link em vez de número solto: um toque abre a conversa. Sem isso o alerta
    // obriga a copiar o número e procurar o contato na mão.
    `📱 *WhatsApp:* [${lead.phone}](${linkDoWhatsApp(lead.phone)})`,
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

  await enviarAoTelegram(text, "handoff");
}

/** Avisa que a Júlia se calou porque alguém assumiu a conversa pelo celular. */
export async function sendTelegramPausa(alert: PausaAlert): Promise<void> {
  const { lead, ate } = alert;
  const hora = ate.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  const text = [
    `🤫 *Você assumiu uma conversa — a Júlia se calou*`,
    ``,
    `👤 *Nome:* ${lead.name ?? "Não informado"}`,
    `📱 *WhatsApp:* [${lead.phone}](${linkDoWhatsApp(lead.phone)})`,
    ``,
    `Ela volta a responder às *${hora}*, e cada mensagem sua adia mais 5 minutos.`,
    `_Se quiser devolver a conversa antes disso, use "Devolver para a Júlia" no painel._`,
  ].join("\n");

  await enviarAoTelegram(text, "pausa");
}
