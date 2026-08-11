import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  leadsTable,
  leadMessagesTable,
  followUpsTable,
  type Lead,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { openai, speechToText, detectAudioFormat } from "@workspace/integrations-openai-ai-server";
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
  sendTelegramAtencao,
  sendTelegramPausa,
  fetchWhatsAppMediaBase64,
  sendWhatsAppAudio,
} from "../lib/integrations";
import {
  extrairDemo,
  lerDemo,
  podeEnviar,
  registrar,
  pastaDemos,
} from "../lib/demos";
import { pareceCelularReal, padraoDeServico } from "../lib/filtro-spam";
import { enviadaPorNos } from "../lib/enviadas-por-nos";
import {
  MOTIVO_PT,
  limparAtencao,
  marcarAtencao,
  pareceConfuso,
  pareceIrritado,
  recortarDetalhe,
  respostaLonga,
  respostaRepetida,
} from "../lib/atencao";

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

/**
 * Quanto tempo a Júlia fica calada depois que um humano responde pelo celular.
 * Cada mensagem dele renova o prazo, então na prática ela só volta 5 minutos
 * depois da ÚLTIMA mensagem dele — enquanto ele estiver conversando, ela não
 * atravessa.
 */
const PAUSA_HUMANA_MS =
  (Number(process.env.PAUSA_HUMANA_MINUTOS) || 5) * 60 * 1000;

/**
 * Um humano respondeu este contato pelo celular: cala a Júlia por um tempo.
 *
 * Só atualiza lead que JÁ EXISTE. Se o Dr. puxar conversa com alguém que nunca
 * falou com a Júlia, não há nada para pausar — e criar um lead a partir de uma
 * mensagem nossa encheria o painel de gente que nunca respondeu.
 */
async function pausarPorHumano(
  remoteJid: string,
  req: { log: { info: (o: unknown, m: string) => void } },
): Promise<void> {
  const phone = remoteJid.replace("@s.whatsapp.net", "").replace("@c.us", "");
  if (!phone || phone.includes("@")) return;

  const lead = (
    await db.select().from(leadsTable).where(eq(leadsTable.phone, phone)).limit(1)
  )[0];
  if (!lead) return;

  // Já estava pausada? Então isto é a segunda, terceira, décima mensagem dele
  // na mesma conversa: renova o prazo, mas NÃO avisa de novo. Avisar a cada
  // mensagem faria o Telegram repetir de volta o que ele acabou de digitar.
  const jaEstavaPausada = Boolean(
    lead.pausedUntil && new Date(lead.pausedUntil).getTime() > Date.now(),
  );

  const ate = new Date(Date.now() + PAUSA_HUMANA_MS);
  await db
    .update(leadsTable)
    .set({ pausedUntil: ate, updatedAt: new Date() })
    .where(eq(leadsTable.id, lead.id));
  req.log.info({ leadId: lead.id, ate }, "Humano assumiu — Júlia pausada");

  // Ele entrou na conversa: o aviso da central já cumpriu a função e sai da
  // lista. Vale para QUALQUER motivo — inclusive os que não se limpam com o
  // tempo — porque aqui não houve passagem de tempo, houve ação dele.
  await limparAtencao(lead, "o humano assumiu a conversa");

  if (!jaEstavaPausada) {
    await sendTelegramPausa({ type: "pausa", lead, ate });
  }
}

/**
 * Marca irritação e avisa no Telegram UMA VEZ POR EPISÓDIO.
 *
 * O "uma vez" não precisa de contador nem de carimbo de tempo: sai de graça da
 * precedência. `marcarAtencao` só devolve true quando a marcação MUDOU, e
 * `irritado` não substitui `irritado` (empate não substitui). Então a segunda,
 * terceira e décima mensagem irritada do mesmo episódio não geram alerta — e,
 * se o lead já estava em `pediu_pessoa` (mais grave), também não, porque o dono
 * já foi chamado para essa conversa. Um alerta por mensagem seria o caminho mais
 * curto para ele silenciar o bot.
 */
async function avisarIrritacao(
  lead: Lead,
  texto: string,
  sinal: string,
  req: { log: { warn: (o: unknown, m: string) => void } },
): Promise<void> {
  if (!(await marcarAtencao(lead, "irritado", texto))) return;

  req.log.warn(
    { leadId: lead.id, sinal },
    "Dentista parece irritado — alerta enviado",
  );
  await sendTelegramAtencao({
    lead,
    motivo: MOTIVO_PT.irritado,
    detalhe: recortarDetalhe(texto),
  });
}

// IDs de mensagem já processados, pra não responder duas vezes se o Evolution
// reenviar o mesmo webhook (retry/timeout). Em memória: some no restart, o que
// é aceitável — retry acontece em segundos.
const processados = new Map<string, number>();
const PROCESSADO_TTL_MS = 10 * 60 * 1000;

function jaProcessado(id: string | undefined): boolean {
  if (!id) return false;
  const agora = Date.now();
  for (const [k, t] of processados) {
    if (agora - t > PROCESSADO_TTL_MS) processados.delete(k);
  }
  if (processados.has(id)) return true;
  processados.set(id, agora);
  return false;
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
    if (fromMe) {
      // `fromMe` cobre DUAS coisas diferentes: o que a Júlia mandou pela API e
      // o que uma pessoa digitou no celular. A segunda significa que o humano
      // assumiu a conversa — e aí a Júlia precisa se calar, senão os dois
      // respondem o dentista ao mesmo tempo.
      //
      // A distinção é por IDENTIDADE (guardamos o id de tudo que enviamos), não
      // pelo campo `source` do payload — ver lib/enviadas-por-nos.ts para o
      // porquê.
      if (!enviadaPorNos(key?.id)) {
        await pausarPorHumano(String(key?.remoteJid ?? ""), req);
      }
      return;
    }

    // Antes de QUALQUER processamento: se este webhook já foi tratado, sai.
    if (jaProcessado(key?.id)) {
      req.log.info({ messageId: key?.id }, "Webhook repetido — ignorado");
      return;
    }

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

    // ANTI-SPAM 1 — o remetente é um celular de pessoa?
    // Banco e operadora mandam de número curto (0800, 4004, 32004545) ou de
    // remetente alfanumérico. Isso nunca é dentista, então corta aqui, antes
    // de sequer procurar o lead: não gasta consulta, não gasta IA, não polui
    // o painel com lead que não existe.
    if (!pareceCelularReal(phone)) {
      req.log.info({ phone }, "Remetente não parece celular (serviço/robô) — ignorado");
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
    //
    // A transcrição CONTINUA na Rodada 27 — ela precisa entender quem manda
    // áudio. O que saiu foi a resposta por voz: ela responde sempre por texto.
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

    // Upsert lead.
    //
    // Isto vem ANTES do corte por "sem texto" de propósito: mídia sem texto
    // também merece resposta (bloco logo abaixo), e pra responder a Júlia
    // precisa do lead existindo. O cancelamento de follow-ups e a gravação da
    // mensagem recebida continuam DEPOIS do corte — uma foto solta não deve
    // cancelar a leva de follow-up nem gravar uma mensagem de conteúdo vazio.
    let lead = (
      await db.select().from(leadsTable).where(eq(leadsTable.phone, phone)).limit(1)
    )[0];

    // ANTI-SPAM 2 — conteúdo de banco, crédito, cobrança ou verificação.
    //
    // A trava está no `!lead`: conversa JÁ INICIADA nunca é descartada por
    // conteúdo. Um dentista que já fala com a Júlia pode perfeitamente dizer
    // "tô pagando empréstimo, tá apertado" — silenciar isso seria muito pior
    // do que deixar passar um spam. E o robô de banco nunca ganha essa
    // imunidade: como a primeira mensagem dele é barrada, o lead não chega a
    // ser criado, e a segunda cai no mesmo filtro.
    //
    // Por isso o filtro fica AQUI, entre a busca do lead e a criação dele: a
    // consulta acima é só leitura, então descartar neste ponto não deixa lead
    // fantasma no painel.
    if (!lead) {
      const padrao = padraoDeServico(text);
      if (padrao) {
        // `warn`, e com o padrão que bateu: se um dentista de verdade for
        // barrado por engano, o log aponta qual regra precisa mudar. O texto
        // barrado NÃO é logado de propósito — costuma ser código de
        // verificação do próprio Dr. Sarinho.
        req.log.warn(
          { phone, padrao: String(padrao) },
          "Mensagem de banco/crédito/verificação — ignorada",
        );
        return;
      }
    }

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

    // O humano assumiu esta conversa há pouco? Então a Júlia não fala.
    //
    // Isto NÃO faz o webhook sair: o que o dentista escreveu continua sendo
    // gravado no histórico logo abaixo. É só a RESPOSTA que é suprimida — se a
    // gente descartasse a mensagem, a Júlia voltaria da pausa sem saber o que
    // foi conversado enquanto esteve fora.
    const pausada = Boolean(
      lead.pausedUntil && new Date(lead.pausedUntil).getTime() > Date.now(),
    );

    if (!text.trim()) {
      // Chegou algo que não é texto (imagem, vídeo, documento, figurinha,
      // localização, contato) ou um áudio que não deu pra transcrever. Antes
      // isso caía num `return` mudo: o dentista mandava um print da agenda e
      // recebia silêncio absoluto, sem saber que tinha sido ignorado. Agora a
      // Júlia avisa e pede em texto.
      const m = msg ?? {};
      const temTipo = (tipo: string): boolean =>
        Boolean(m[tipo] ?? m.message?.[tipo]);

      const ehFigurinha = temTipo("stickerMessage");
      const ehAudio = temTipo("audioMessage");
      const temMidia =
        ehFigurinha ||
        ehAudio ||
        temTipo("imageMessage") ||
        temTipo("videoMessage") ||
        temTipo("documentMessage") ||
        temTipo("locationMessage") ||
        temTipo("contactMessage");

      if (temMidia && pausada) {
        // Mídia durante a pausa: o humano está conduzindo, e um "me manda por
        // texto" da Júlia no meio da conversa dele é justamente a interrupção
        // que a pausa existe para evitar.
        req.log.info(
          { leadId: lead.id, pausedUntil: lead.pausedUntil },
          "Conversa pausada (humano assumiu) — aviso de mídia não enviado",
        );
      } else if (temMidia) {
        const aviso = ehFigurinha
          ? "haha 😄 Me conta em texto o que você precisa que eu te ajudo!"
          : ehAudio
            ? "Não consegui ouvir seu áudio direito 😅 Pode me mandar por texto?"
            : "Recebi seu arquivo, mas aqui eu consigo ler melhor por texto 😊 Pode me contar em poucas palavras?";

        const entregue = await sendWhatsAppMessage(phone, aviso);
        if (entregue) {
          await db.insert(leadMessagesTable).values({
            leadId: lead.id,
            direction: "outbound",
            content: aviso,
            messageType: "text",
          });
          req.log.info({ leadId: lead.id }, "Mídia recebida sem texto — aviso enviado");
        } else {
          req.log.error({ leadId: lead.id, phone }, "Aviso de mídia NÃO entregue");
        }
      } else {
        req.log.warn({ phone }, "Mensagem sem texto e sem mídia reconhecida — ignorada");
      }
      return;
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

    // Daqui para baixo é a Júlia respondendo. Se o humano assumiu, ela para
    // AQUI — depois de gravar o que o dentista disse (para ela ter o contexto
    // quando voltar) e antes de gastar crédito de IA com uma resposta que não
    // pode ser enviada.
    if (pausada) {
      req.log.info(
        { leadId: lead.id, pausedUntil: lead.pausedUntil },
        "Conversa pausada (humano assumiu) — não respondendo",
      );
      return;
    }

    // CENTRAL DE VIGIA, primeira camada: o que dá para decidir só pelo texto
    // dele, sem esperar o extrator. Fica ANTES da chamada de IA de propósito —
    // se ele está irritado, o alerta não deve esperar a Júlia formular resposta.
    //
    // O extrator confirma depois (segunda camada), no bloco de extração: a lista
    // fixa é rápida e literal, o modelo pega o que ela não alcança. Mesmo
    // desenho do opt-out.
    const sinalDeIrritacao = pareceIrritado(text);
    if (sinalDeIrritacao) {
      await avisarIrritacao(lead, text, sinalDeIrritacao, req);
    }

    // Gatilho 3.1 — ele reclamou de não estar sendo entendido. É reclamação
    // sobre a JÚLIA, então não vai para o Telegram: fica no painel.
    const sinalDeConfusao = pareceConfuso(text);
    if (sinalDeConfusao) {
      await marcarAtencao(lead, "julia_estranha", text);
    }

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
      origin: lead.origin,
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
    if (!reply) {
      // Não inventamos resposta (melhor calar do que falar bobagem), mas o
      // lead fica sem resposta — isso precisa aparecer no log, não sumir.
      req.log.error(
        { leadId: lead.id, model: REPLY_MODEL },
        "Modelo devolveu resposta vazia — lead ficou sem resposta",
      );
      return;
    }

    // A Júlia responde SEMPRE por texto, inclusive para quem mandou áudio
    // (Rodada 27). A voz dela deixou de ser conversa e virou demonstração: em
    // vez de sintetizar a resposta a cada mensagem, ela manda uma das três
    // gravações prontas quando quer PROVAR alguma coisa.
    //
    // O modelo pede a demo terminando a resposta com [DEMO:nome]. O marcador
    // sai do texto aqui — o dentista nunca pode ver isso.
    const { texto: textoLimpo, demo: demoPedida } = extrairDemo(reply);

    let delivered = false;
    if (textoLimpo) {
      delivered = await sendWhatsAppMessage(phone, textoLimpo);
    } else {
      // Resposta que era só o marcador. Áudio solto, sem uma frase
      // apresentando, confunde — então não mandamos nada e isso aparece no log.
      req.log.error(
        { leadId: lead.id, demoPedida },
        "Modelo respondeu só com o marcador de demo — nada foi enviado",
      );
      return;
    }

    // A resposta só entra no histórico se REALMENTE chegou. Gravar antes de
    // entregar fazia o painel mostrar conversa que o dentista nunca recebeu —
    // e, pior, na mensagem seguinte a Júlia lia o histórico e achava que já
    // tinha respondido. Não gravando, ela tenta de novo.
    if (delivered) {
      await db.insert(leadMessagesTable).values({
        leadId: lead.id,
        direction: "outbound",
        content: textoLimpo,
        messageType: "text",
      });
    } else {
      req.log.error(
        { leadId: lead.id, phone },
        "Resposta NÃO entregue — não gravada no histórico",
      );
    }

    // CENTRAL DE VIGIA, gatilho 3 — sinais de que a Júlia escorregou.
    //
    // Só dá para avaliar aqui: dois dos sinais dependem do texto que ela acabou
    // de produzir e de saber se ele chegou. Nada disso vai para o Telegram — é
    // reclamação sobre ela, não lead pegando fogo.
    //
    // A resposta anterior dela é o último "outbound" do histórico. O histórico
    // foi lido depois de gravar a mensagem recebida, mas antes de gravar esta
    // resposta, então o que está lá é mesmo a fala anterior.
    const respostaAnterior =
      [...history].reverse().find((m) => m.direction === "outbound")?.content ?? null;

    if (!delivered) {
      // A falha de envio já é logada acima — e log ninguém lê. Sem marcar no
      // lead, um dentista que ficou sem resposta por erro de entrega era
      // exatamente o caso invisível que esta rodada existe para acabar.
      await marcarAtencao(
        lead,
        "julia_estranha",
        "A resposta não foi entregue no WhatsApp.",
      );
    } else if (respostaRepetida(textoLimpo, respostaAnterior)) {
      await marcarAtencao(
        lead,
        "julia_estranha",
        `Ela repetiu quase a mesma resposta: "${textoLimpo}"`,
      );
    } else if (respostaLonga(textoLimpo)) {
      await marcarAtencao(
        lead,
        "julia_estranha",
        `Resposta de ${textoLimpo.length} caracteres — o prompt manda 2-3 linhas.`,
      );
    }

    // O ÁUDIO DE DEMONSTRAÇÃO, depois do texto — a narração prepara o ouvido.
    // Tudo aqui é bônus: o texto já foi entregue, então nenhuma falha daqui
    // para baixo pode interromper a conversa.
    if (delivered && demoPedida) {
      const permissao = podeEnviar(demoPedida, lead.demosEnviadas);
      if (!permissao.pode) {
        req.log.info(
          { leadId: lead.id, demo: demoPedida, motivo: permissao.motivo },
          "Demo não enviada",
        );
      } else {
        const mp3 = await lerDemo(demoPedida);
        if (!mp3) {
          req.log.error(
            { leadId: lead.id, demo: demoPedida, pasta: pastaDemos() },
            "Arquivo da demo não encontrado — só o texto foi entregue",
          );
        } else {
          const enviou = await sendWhatsAppAudio(phone, mp3.toString("base64"));
          if (enviou) {
            await db.insert(leadMessagesTable).values({
              leadId: lead.id,
              direction: "outbound",
              content: `[áudio de demonstração: ${demoPedida}]`,
              messageType: "audio",
            });
            // Só marca depois de entregue: se o envio falhou, ela pode tentar
            // essa mesma demo de novo na próxima mensagem.
            await db
              .update(leadsTable)
              .set({
                demosEnviadas: registrar(lead.demosEnviadas, demoPedida),
                updatedAt: new Date(),
              })
              .where(eq(leadsTable.id, lead.id));
            req.log.info({ leadId: lead.id, demo: demoPedida }, "Demo enviada");
          } else {
            req.log.error(
              { leadId: lead.id, demo: demoPedida },
              "Demo não entregue — só o texto chegou",
            );
          }
        }
      }
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
        `Júlia: ${textoLimpo}`,
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
        isCustomer?: boolean;
        wantsToStop?: boolean;
        irritado?: boolean;
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

      // Virou cliente? Para de vender pra quem já comprou.
      //
      // Este bloco roda ANTES do trecho que arma a leva nova de follow-ups
      // (mais abaixo), então mexer em lead.status já basta para a guarda de lá
      // barrar o armamento. O cancelamento explícito abaixo é redundante hoje
      // — os pendentes já foram cancelados quando o lead respondeu — mas fica
      // como proteção caso essa ordem mude um dia.
      if (parsed.isCustomer === true && lead.status !== "closed") {
        await db
          .update(leadsTable)
          .set({ status: "closed", updatedAt: new Date() })
          .where(eq(leadsTable.id, lead.id));
        await db
          .update(followUpsTable)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(followUpsTable.leadId, lead.id),
              eq(followUpsTable.status, "pending"),
            ),
          );
        lead.status = "closed";
        req.log.info({ leadId: lead.id }, "Lead virou cliente — follow-ups encerrados");
      }

      // Pediu pra parar (com palavras que a lista fixa não pega)? Respeita.
      if (parsed.wantsToStop === true && lead.status !== "lost" && lead.status !== "closed") {
        const nota = "[OPT-OUT] Lead pediu para parar de receber mensagens.";
        await db
          .update(leadsTable)
          .set({
            status: "lost",
            notes: lead.notes ? `${nota}\n${lead.notes}` : nota,
            updatedAt: new Date(),
          })
          .where(eq(leadsTable.id, lead.id));
        await db
          .update(followUpsTable)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(followUpsTable.leadId, lead.id),
              eq(followUpsTable.status, "pending"),
            ),
          );
        lead.status = "lost";
        req.log.info({ leadId: lead.id }, "Opt-out detectado por intenção — follow-ups encerrados");
      }

      // CENTRAL DE VIGIA, segunda camada da irritação: o que a lista fixa não
      // alcança (tom seco, frustração dita sem palavra-chave). O prompt do
      // extrator é explicitamente conservador, porque "tá caro" e "não tenho
      // interesse" são desacordo comercial — se isso virasse alerta, ele
      // receberia notificação de toda negociação normal.
      //
      // Se a lista fixa já marcou nesta mesma mensagem, `avisarIrritacao` não
      // manda nada: a precedência barra o Telegram repetido.
      if (parsed.irritado === true) {
        await avisarIrritacao(lead, text, "extrator", req);
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
      // Não rebaixa quem já é cliente ("closed") nem quem pediu para parar
      // ("lost"). O handoff roda DEPOIS da extração; sem esta guarda, um
      // cliente que escrevesse "me liga" voltaria para "hot" e a leva de
      // follow-up de VENDA seria armada de novo para quem já pagou.
      const statusAposHandoff =
        lead.status === "closed" || lead.status === "lost"
          ? lead.status
          : ("hot" as const);

      await db
        .update(leadsTable)
        .set({
          handoffRequested: true,
          status: statusAposHandoff,
          updatedAt: new Date(),
        })
        .where(eq(leadsTable.id, lead.id));

      // CENTRAL DE VIGIA, gatilho 1. O alerta de Telegram deste caso já existe
      // (logo abaixo, o `sendTelegramAlert` detalhado da Rodada 17) — o que
      // faltava era ele aparecer na lista do painel. É o motivo mais grave,
      // então prevalece sobre qualquer outro que já estivesse marcado.
      await marcarAtencao(lead, "pediu_pessoa", text);

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
