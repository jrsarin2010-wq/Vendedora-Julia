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

/** O teto normal de `tempoDeDigitacao`. Serve para o orçamento de timeout abaixo. */
export const MAXIMO_DIGITACAO_MS = 12_000;

/**
 * A PRIMEIRA resposta da conversa é diferente: o dentista acabou de clicar no
 * botão do site e está olhando a tela. 12 segundos de "digitando..." fazem ele
 * achar que não tem ninguém e voltar. Da segunda mensagem em diante o ritmo
 * humano ajuda — ele já está engajado e tem motivo para esperar; na primeira,
 * atrapalha, porque ele ainda não tem nenhum.
 *
 * É a única troca da conversa inteira em que rapidez vale mais que
 * naturalidade.
 */
export const PRIMEIRA_RESPOSTA_MAXIMO_MS = 3_000;

/** Piso comum às duas faixas: resposta instantânea também denuncia robô. */
export const MINIMO_DIGITACAO_MS = 2_000;

/**
 * Tempo que uma pessoa levaria digitando este texto, para a Júlia não
 * responder instantaneamente. Velocidade de celular, não de teclado.
 *
 * `primeiraResposta` aperta só o TETO (3s em vez de 12s) — o mínimo de 2s vale
 * nas duas, então a faixa da primeira fica entre 2 e 3 segundos.
 *
 * Exportada porque é a única parte testável desta borda: o resto é rede.
 */
export function tempoDeDigitacao(texto: string, primeiraResposta = false): number {
  const MS_POR_CARACTERE = 45; // ~26 caracteres por segundo é rápido demais; 45ms ≈ digitação de celular
  const maximo = primeiraResposta ? PRIMEIRA_RESPOSTA_MAXIMO_MS : MAXIMO_DIGITACAO_MS;
  const base = texto.length * MS_POR_CARACTERE;
  const variacao = 0.85 + Math.random() * 0.3; // ±15%, porque tempo exato é robô
  return Math.min(maximo, Math.max(MINIMO_DIGITACAO_MS, Math.round(base * variacao)));
}

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
 *
 * `primeiraResposta` (Rodada 35) encurta o teto do atraso para 3s. Quem chama
 * é o webhook, que é o único que sabe o tamanho do histórico — ver
 * `PRIMEIRA_RESPOSTA_MAXIMO_MS`.
 */
export async function sendWhatsAppMessage(
  phone: string,
  message: string,
  primeiraResposta = false,
): Promise<boolean> {
  return (await enviarWhatsAppComDiagnostico(phone, message, primeiraResposta)).entregue;
}

/** O resultado de um envio, com o diagnóstico que decide o que fazer da falha. */
export interface EnvioWhatsApp {
  entregue: boolean;
  /**
   * A Evolution rejeitou ESTE destinatário — número sem WhatsApp, fixo,
   * digitado errado. Tentar de novo não muda nada. É a diferença entre "o
   * número é ruim" e "a Evolution está fora do ar" (timeout, 5xx, queda de
   * rede), que se resolve sozinha esperando. Quem conta tentativas para
   * desistir de um lead (lib/nao-entregavel.ts) só pode contar as permanentes:
   * contar as transitórias condenaria leads bons durante uma hora de
   * instabilidade.
   */
  falhaPermanente: boolean;
  /**
   * A falha é do NOSSO lado — a sessão do WhatsApp caiu, ou o número da Júlia
   * foi restringido pelo WhatsApp. O lead não tem nada com isso: não conta
   * tentativa, e é o sinal que pausa a abordagem inteira (lib/restricao.ts).
   *
   * Vem junto de `falhaPermanente: false`, e não como um terceiro valor de um
   * enum, porque quem chama precisa das duas respostas ao mesmo tempo: "conto
   * strike neste lead?" e "paro tudo?" são perguntas diferentes.
   */
  bloqueioNosso: boolean;
}

/**
 * ASSINATURAS DE PROBLEMA NOSSO dentro de um 400.
 *
 * A Evolution devolve 400 para duas coisas muito diferentes: "este
 * destinatário não existe" (que é do número) e "minha sessão caiu" (que é
 * nossa). Em 18/08/2026 o corpo veio assim, com o número da Júlia restringido
 * pelo WhatsApp por 23h:
 *
 *   {"status":400,"error":"Bad Request",
 *    "response":{"message":["Error: Connection Closed"]}}
 *
 * Lido como rejeição do destinatário, condenou três dentistas com número bom.
 *
 * A lista é de assinaturas NOSSAS, e não de assinaturas do número, porque o
 * default seguro é o oposto em cada caso: um lead mantido na fila por engano
 * custa um retry; um lead condenado por engano sai da fila para sempre. Mas
 * ela não é a única defesa — a rajada de leads diferentes em lib/restricao.ts
 * pega o mesmo problema sem depender de reconhecer frase nenhuma, e é ela que
 * continua de pé quando a Evolution inventar uma mensagem nova.
 */
const ASSINATURAS_DE_BLOQUEIO_NOSSO = [
  "connection closed",
  "connection lost",
  "connection terminated",
  "not connected",
  "instance not",
  "instance is not",
  "close connection",
  "socket",
  "unauthorized",
  "forbidden",
  "spam",
  "banned",
  "blocked",
  "restrict",
];

/**
 * Separa "o número é ruim" de "nós estamos impedidos de enviar". Função pura,
 * exportada para o teste — é a regra que já condenou lead bom uma vez.
 */
export function classificarFalhaDeEnvio(
  status: number,
  corpo: string,
): { falhaPermanente: boolean; bloqueioNosso: boolean } {
  const texto = (corpo ?? "").toLowerCase();
  const nosso = ASSINATURAS_DE_BLOQUEIO_NOSSO.some((a) => texto.includes(a));

  // 401/403/404 são configuração nossa; 5xx e timeout são infra. Nenhum deles
  // fala do destinatário, e nenhum pode contar tentativa contra o lead.
  if (status !== 400) {
    return { falhaPermanente: false, bloqueioNosso: status === 401 || status === 403 };
  }
  if (nosso) return { falhaPermanente: false, bloqueioNosso: true };
  return { falhaPermanente: true, bloqueioNosso: false };
}

/**
 * O mesmo envio de `sendWhatsAppMessage`, devolvendo também SE a falha é do
 * número ou do caminho até ele. Os agendadores de mensagem fria usam esta
 * versão; o webhook continua com a booleana — para responder uma conversa em
 * andamento o diagnóstico não muda a decisão (fica gravado no log dos dois
 * jeitos).
 *
 * O critério de "permanente" era o HTTP 400 puro, e isso estava ERRADO: a
 * Evolution usa 400 tanto para "o destinatário não existe" quanto para "minha
 * sessão caiu". Quem decide agora é `classificarFalhaDeEnvio`, que lê o corpo.
 * 401/403/404 são configuração NOSSA errada e 5xx/timeout são infra; nos dois
 * casos o lead não tem culpa, então contam como transitórias.
 */
export async function enviarWhatsAppComDiagnostico(
  phone: string,
  message: string,
  primeiraResposta = false,
): Promise<EnvioWhatsApp> {
  const { base, chave } = configEvolution();
  if (!base || !chave) {
    logger.warn({ phone }, "Evolution API not configured — skipping WhatsApp send");
    return { entregue: false, falhaPermanente: false, bloqueioNosso: false };
  }

  const atraso = tempoDeDigitacao(message, primeiraResposta);

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
      const veredicto = classificarFalhaDeEnvio(response.status, body);
      logger.error(
        { phone, status: response.status, body, ...veredicto },
        "Evolution API error",
      );
      return { entregue: false, ...veredicto };
    }
    await anotarIdEnviado(response, phone);
    return { entregue: true, falhaPermanente: false, bloqueioNosso: false };
  } catch (err) {
    logger.error({ err, phone }, "Failed to send WhatsApp message");
    return { entregue: false, falhaPermanente: false, bloqueioNosso: false };
  }
}

/** Um item da resposta de `chat/whatsappNumbers`, exatamente como a Evolution devolve. */
export interface ItemWhatsappNumbers {
  /** Eco do número que ENVIAMOS. É por ele que se casa a resposta, nunca por posição. */
  number?: string;
  exists?: boolean;
  /**
   * A identidade canônica da conta ("558592008899@s.whatsapp.net"). Só vale
   * quando `exists` é true: para número inexistente a Evolution devolve um jid
   * ESPECULATIVO, montado a partir do que pedimos.
   */
  jid?: string;
  /**
   * Verificado na v2.3.7: veio o próprio número formatado, não um nome de
   * perfil. Declarado aqui para documentar que existe — não persistimos.
   */
  name?: string;
}

export interface ConsultaWhatsApp {
  /**
   * A consulta ACONTECEU? false para qualquer falha (não configurado, HTTP
   * ruim, timeout, corpo inesperado). Falha não é veredito: quem chama tem de
   * tratar como "não sei", jamais como "não tem WhatsApp".
   */
  ok: boolean;
  itens: ItemWhatsappNumbers[];
}

/**
 * Um bloco de 50 números vira 50 consultas do lado do WhatsApp, e o orçamento
 * normal de 10s não cobre isso com folga.
 */
const CONSULTA_NUMEROS_TIMEOUT_MS = 20_000;

/**
 * Pergunta à Evolution QUAIS destes números existem no WhatsApp, em uma única
 * chamada em lote (`POST chat/whatsappNumbers`).
 *
 * Esta função é só a borda: fala HTTP e devolve o corpo. Quem decide o que
 * fazer com `exists`/`jid` é lib/canonicalizar-telefone.ts — assim a regra
 * (ler o jid só quando exists é true, casar pelo `number`) fica em código
 * testado de verdade, e não escondida atrás da rede.
 *
 * Nunca lança e nunca loga número completo nem a chave da API.
 */
export async function consultarNumerosNoWhatsApp(
  numeros: string[],
): Promise<ConsultaWhatsApp> {
  const { base, chave } = configEvolution();
  if (!base || !chave) {
    logger.warn(
      { quantidade: numeros.length },
      "Evolution API não configurada — consulta de números não realizada",
    );
    return { ok: false, itens: [] };
  }

  try {
    const url = urlDaEvolution("chat/whatsappNumbers");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: chave,
      },
      body: JSON.stringify({ numbers: numeros }),
      signal: AbortSignal.timeout(CONSULTA_NUMEROS_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error(
        { status: response.status, quantidade: numeros.length, body },
        "Evolution whatsappNumbers error",
      );
      return { ok: false, itens: [] };
    }

    const corpo = (await response.json()) as unknown;
    if (!Array.isArray(corpo)) {
      logger.error(
        { quantidade: numeros.length },
        "Evolution whatsappNumbers devolveu corpo que não é lista — tratando como falha",
      );
      return { ok: false, itens: [] };
    }

    return { ok: true, itens: corpo as ItemWhatsappNumbers[] };
  } catch (err) {
    logger.error(
      { err, quantidade: numeros.length },
      "Falha ao consultar números no WhatsApp",
    );
    return { ok: false, itens: [] };
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

/**
 * Alerta da sonda de boot (lib/sonda-modelo.ts): um modelo configurado não
 * respondeu. Sem este alerta, a falha seria descoberta pelo primeiro dentista
 * a escrever — e ele descobriria com silêncio.
 */
export async function sendTelegramSondaModelo(
  modelo: string,
  papeis: string,
  detalhe: string,
): Promise<void> {
  const linhas = [
    `🔴 *Modelo de IA não responde — a Júlia pode estar muda*`,
    `Modelo: \`${modelo}\` (papel: ${papeis})`,
    `Erro: ${detalhe}`,
    `Confira \`JULIA_REPLY_MODEL\` / \`JULIA_EXTRACTION_MODEL\` / \`JULIA_OUTREACH_MODEL\` no Railway — voltar ao modelo anterior é imediato, sem deploy de código.`,
  ];
  await enviarAoTelegram(linhas.join("\n"), "sonda-modelo");
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

/**
 * Alerta da CENTRAL DE VIGIA (Rodada 33).
 *
 * Curto de propósito: ele lê no celular e o que importa é decidir se entra
 * agora. O handoff continua com o alerta detalhado próprio (`sendTelegramAlert`)
 * — este aqui serve aos motivos que não têm um, hoje só a irritação. Os motivos
 * `julia_estranha` e `sem_resposta` NÃO passam por aqui: vivem só no painel, e
 * quem decide isso é `avisaNoTelegram()` em lib/atencao.ts.
 */
interface AtencaoAlert {
  lead: Lead;
  /** O motivo já em português, para este módulo não precisar conhecer os códigos. */
  motivo: string;
  detalhe: string | null;
}

export async function sendTelegramAtencao(alert: AtencaoAlert): Promise<void> {
  const { lead, motivo, detalhe } = alert;
  const quem = lead.name ? `Dr(a). ${lead.name}` : lead.phone;

  const linhas = [
    `🔴 *${quem} precisa de você*`,
    `Motivo: ${motivo.toLowerCase()}`,
  ];
  if (detalhe) linhas.push(`_"${detalhe}"_`);
  if (lead.painPoints) linhas.push(`Dor: ${lead.painPoints}`);
  linhas.push(`👉 ${linkDoWhatsApp(lead.phone)}`);

  await enviarAoTelegram(linhas.join("\n"), "atencao");
}

/**
 * Alerta de NÚMERO NÃO ENTREGÁVEL (Rodada 51): a Evolution rejeitou o mesmo
 * destinatário três vezes seguidas e a Júlia desistiu dele.
 *
 * Sem este aviso, a desistência seria silenciosa — e um número digitado errado
 * na planilha é consertável: o Dr. Sarinho corrige e reimporta. O alerta diz o
 * que aconteceu E o que fazer, porque é lido no celular, longe do painel.
 */
interface NaoEntregavelAlert {
  lead: Pick<Lead, "name" | "phone" | "clinicName">;
  tentativas: number;
  /** O que estava sendo enviado ("abordagem", "toque de abordagem"...). */
  contexto: string;
}

export async function sendTelegramNaoEntregavel(alert: NaoEntregavelAlert): Promise<void> {
  const { lead, tentativas, contexto } = alert;
  const quem = [lead.name, lead.clinicName].filter(Boolean).join(" — ") || lead.phone;

  const linhas = [
    `📵 *Número não recebe WhatsApp — desisti de enviar*`,
    `Lead: ${quem}`,
    `Número: \`${lead.phone}\``,
    `A Evolution rejeitou ${tentativas} envios seguidos (${contexto}). O lead saiu da fila e os toques pendentes foram cancelados.`,
    `_Se o número estiver errado na planilha, corrija e importe de novo; se estiver certo, é fixo ou não tem WhatsApp._`,
  ];

  await enviarAoTelegram(linhas.join("\n"), "nao-entregavel");
}

/**
 * Alertas da VARREDURA APIFY (Etapa 2). Três gatilhos, e só três: orçamento
 * bloqueou, uma combinação desistiu depois de três tentativas, e a fila
 * acabou. Não existe alerta de sucesso — alerta que chega sempre é alerta que
 * ninguém lê, e aí o que importa passa batido junto.
 */
export type VarreduraAlert =
  | { tipo: "orcamento"; comprometido: number; teto: number }
  | { tipo: "pausada"; motivo: string }
  | {
      tipo: "falhou";
      termo: string;
      cidade: string;
      uf: string;
      tentativas: number;
      erro: string | null;
    }
  | { tipo: "fila_vazia"; concluidas: number; gastoNoMes: number };

export async function sendTelegramVarredura(alerta: VarreduraAlert): Promise<void> {
  const dinheiro = (v: number) => `US$ ${v.toFixed(2)}`;

  let linhas: string[];
  if (alerta.tipo === "orcamento") {
    linhas = [
      `💸 *Varredura pausada — teto de crédito do mês*`,
      `Comprometido: ${dinheiro(alerta.comprometido)} de ${dinheiro(alerta.teto)}.`,
      `_A fila NÃO se perdeu: as rodadas que faltam voltam sozinhas quando o crédito do mês virar. Parar aqui é o comportamento desejado._`,
    ];
  } else if (alerta.tipo === "pausada") {
    linhas = [
      `⏸️ *Varredura PAUSADA — problema de configuração nosso*`,
      `Motivo: ${alerta.motivo}`,
      `_A fila NÃO foi penalizada: nenhuma rodada foi marcada como falhou e nenhuma tentativa foi contada. Conserte a causa (token, rede) e reinicie o serviço para retomar._`,
    ];
  } else if (alerta.tipo === "falhou") {
    linhas = [
      `🔴 *Varredura desistiu depois de ${alerta.tentativas} tentativas*`,
      `Busca: ${alerta.termo} — ${alerta.cidade}/${alerta.uf}`,
      alerta.erro ? `Erro: ${alerta.erro}` : `Sem mensagem de erro do Apify.`,
      `_As outras rodadas seguem normalmente; só esta combinação saiu da fila._`,
    ];
  } else {
    linhas = [
      `✅ *Fila de varredura vazia — a Onda 1 acabou*`,
      `Rodadas concluídas: ${alerta.concluidas}. Gasto no mês: ${dinheiro(alerta.gastoNoMes)}.`,
      `_Nada mais será disparado até a fila receber novas combinações._`,
    ];
  }

  await enviarAoTelegram(linhas.join("\n"), "varredura");
}

/**
 * Alerta da verificação de WhatsApp (Etapa 3A). UM tipo só, de propósito: o
 * único desfecho que exige alguém é a pausa por lotes mudos, e ela significa
 * que a Evolution não está respondendo — o que também afeta as conversas de
 * verdade. Contagem de lote é log, não alerta.
 */
export type VerificacaoAlert = { tipo: "pausada"; motivo: string; lotes: number };

export async function sendTelegramVerificacao(alerta: VerificacaoAlert): Promise<void> {
  const texto = [
    `⏸️ *Verificação de WhatsApp PAUSADA*`,
    `${alerta.lotes} lotes seguidos voltaram sem nenhum veredito. Isso não são dezenas de números ruins ao mesmo tempo — é a Evolution fora do ar ou credencial ruim.`,
    `Motivo: ${alerta.motivo}`,
    `_Nenhuma clínica foi descartada: as do lote continuam como "novo" e voltam para a fila. Confira a Evolution (a mesma instância que fala com os dentistas) e reinicie o serviço para retomar._`,
  ].join("\n");

  await enviarAoTelegram(texto, "verificacao");
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
