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
  AVISO_DE_ESPERA,
  buildLeadBriefing,
  conversaFoiProfunda,
} from "../julia-persona";
import {
  comRepique,
  esperasDeRepique,
  descreverErro,
} from "../lib/repique";
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
import { ORIGEM_SITE, veioDaLanding } from "../lib/origem-site";
import { limparAssunto } from "../lib/duvidas-do-site";
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
import {
  registrarSinais,
  faixaDaTemperatura,
  statusDaFaixa,
  CADENCIA_POR_FAIXA,
} from "../lib/temperatura";
import { peneirarSinais } from "../lib/peneira-de-sinais";
import {
  REPLY_MODEL,
  EXTRACTION_MODEL,
  TETO_RESPOSTA,
  TETO_EXTRACAO,
} from "../lib/modelos";
import {
  perguntasRepetidas,
  registrarDescoberta,
  TOPICO_PT,
} from "../lib/descoberta";
import {
  ehPessoa,
  esperandoAPessoa,
  lerInterlocutor,
  mereceFollowUp,
  nomeFoiDito,
  pareceAssistenteVirtual,
  podeGravarNome,
  podePontuarTemperatura,
  textosDePessoa,
  type Interlocutor,
} from "../lib/interlocutor";
import {
  travar,
  soltar,
  chegou,
  foiSuperado,
  encerrarTurno,
  esperarSilencio,
  janelaDeAgrupamentoMs,
} from "../lib/turno-do-lead";

const router: IRouter = Router();

// Modelos de IA da Júlia: nomes e defaults moram em lib/modelos.ts (fonte
// única — a sonda de boot confere os mesmos nomes que este arquivo usa).

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

  // O TURNO DESTE LEAD (ver lib/turno-do-lead.ts). Declarados aqui fora, antes
  // do try, porque quem os devolve é o `finally` lá embaixo — e ele precisa
  // alcançá-los em qualquer saída, inclusive nos vários `return` do caminho e
  // num erro no meio da geração. Trava não devolvida cala o lead para sempre.
  let chaveDoTurno: string | null = null;
  let senhaDoTurno = 0;
  let tokenDaTrava: number | null = null;

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

    // ————— TURNO DESTE LEAD, ABERTURA —————
    //
    // Daqui até a devolução da trava (logo depois de gravar a mensagem) só
    // roda UM handler por lead de cada vez. É o que impede duas gerações
    // simultâneas, dois leads com o mesmo telefone (`leads.phone` é UNIQUE: a
    // segunda inserção estourava e a mensagem sumia neste catch) e duas levas
    // de follow-up (o cancelamento de um handler caindo entre o cancelamento e
    // o insert do outro).
    //
    // A senha é tirada ANTES da trava, de propósito: ela marca a ordem de
    // CHEGADA, e é isso que decide quem responde a rajada. Esperar a vez na
    // fila não pode mudar essa ordem.
    chaveDoTurno = phone;
    senhaDoTurno = chegou(phone);
    tokenDaTrava = await travar(phone);

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
      // A origem sai da PRIMEIRA mensagem e só dela: a landing pré-preenche
      // "Oi! Vim pelo site do CaptaClin e tenho uma dúvida", e essa frase é o
      // único fio entre os dois projetos (ver lib/origem-site.ts).
      //
      // Gravada só na criação, de propósito. Se um lead que já existe mandar a
      // frase depois, a origem NÃO muda: para quem veio de importação ou do
      // Instagram, a origem é o que autoriza a Júlia a dizer onde viu a clínica,
      // e sobrescrever isso apagaria uma verdade para gravar outra.
      const daLanding = veioDaLanding(text);
      const inserted = await db
        .insert(leadsTable)
        .values({
          phone,
          origin: daLanding ? ORIGEM_SITE : "whatsapp",
          // Nasce frio: mandar mensagem não esquenta ninguém (Rodada 41). O
          // status certo é derivado da temperatura logo abaixo, nesta mesma
          // passada — se a mensagem trouxer sinal de compra, ele já sobe aqui.
          status: "cold",
          funnelStage: "new",
          lastMessageAt: new Date(),
        })
        .returning();
      lead = inserted[0];
      if (daLanding) {
        req.log.info({ leadId: lead.id }, "Lead veio da landing (botão do site)");
      }
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

    // QUEM ESTA DO OUTRO LADO, primeira camada: o que a lista fixa reconhece
    // sozinha, sem esperar o extrator. Fica ANTES da geracao de proposito — o
    // extrator so roda DEPOIS da resposta, entao sem esta camada a primeira
    // mensagem para um robo sairia com a ficha achando que e o dentista, e e
    // justamente ela que precisa acertar. Mesmo desenho de duas camadas da
    // irritacao e do opt-out.
    //
    // So PREENCHE lacuna, nunca rebaixa: quem ja tem interlocutor conhecido
    // (o extrator leu a conversa inteira e decidiu) nao volta a ser robo por
    // causa de uma frase solta. O extrator continua podendo mudar em qualquer
    // direcao, porque ele ve o que a lista nao ve.
    const sinalDeRobo = pareceAssistenteVirtual(text);
    if (sinalDeRobo && lerInterlocutor(lead.interlocutor) === "nao_sei") {
      await db
        .update(leadsTable)
        .set({ interlocutor: "assistente_virtual", updatedAt: new Date() })
        .where(eq(leadsTable.id, lead.id));
      lead.interlocutor = "assistente_virtual";
      req.log.info(
        { leadId: lead.id, sinal: sinalDeRobo },
        "Atendimento automatico do outro lado — modo vitrine",
      );
    }

    // UMA MENSAGEM SO, E ELA JA SAIU: o automatico respondeu de novo, entao
    // agora e esperar a pessoa.
    //
    // O prompt manda "e UMA mensagem so" e "se o automatico responder de novo,
    // nao insista" desde 18/08/2026 — e mesmo assim o lead 59 rendeu sete
    // minutos de ping-pong entre duas IAs. Instrucao nao e trava: enquanto
    // chegar mensagem, este handler gera resposta, e o modelo obedece ao turno
    // que tem na frente. A trava e esta, e mora antes da janela de agrupamento
    // porque a chamada ao modelo e o que ela existe para nao pagar.
    //
    // Ela olha o TEXTO que chegou, e nao so a coluna do lead — o porque esta em
    // `esperandoAPessoa`, e e a parte que importa: quem tira o lead de
    // "assistente_virtual" e o extrator, e o extrator so roda nos turnos que
    // produzem resposta. Uma trava que calasse pela coluna mataria a conversa
    // para sempre, inclusive para a pessoa que assumisse o WhatsApp depois.
    //
    // O que ela NAO faz: nao para de gravar a mensagem dele (isso ja aconteceu
    // acima) nem de rodar a central de vigia. A conversa continua sendo lida —
    // ela so para de ser respondida.
    if (
      esperandoAPessoa(lerInterlocutor(lead.interlocutor), lead.vitrineEnviadaEm, text)
    ) {
      req.log.info(
        { leadId: lead.id, sinal: sinalDeRobo, vitrineEnviadaEm: lead.vitrineEnviadaEm },
        "Automatico respondeu de novo — a Julia espera a pessoa, nao insiste",
      );
      return;
    }

    // A conversa ainda não tem resposta NOSSA nenhuma? Então a janela de
    // silêncio é a curta. A pergunta é feita aqui, com o lead em mãos e a
    // trava na mão, porque logo abaixo ela já não valeria: entre soltar e
    // retomar a trava, outro handler pode ter respondido.
    const jaFalamos =
      (
        await db
          .select()
          .from(leadMessagesTable)
          .where(
            and(
              eq(leadMessagesTable.leadId, lead.id),
              eq(leadMessagesTable.direction, "outbound"),
            ),
          )
          .limit(1)
      ).length > 0;

    // ————— TURNO DESTE LEAD, A JANELA —————
    //
    // A trava sai da mão DE PROPÓSITO antes de esperar. Segurando-a durante os
    // segundos de janela, o handler da mensagem seguinte não conseguiria nem
    // gravar o que o dentista escreveu — e o grupo nunca se formaria. Solta, as
    // mensagens da rajada entram todas no histórico, em ordem, e só então uma
    // delas gera.
    soltar(chaveDoTurno, tokenDaTrava);
    tokenDaTrava = null;

    await esperarSilencio(janelaDeAgrupamentoMs(!jaFalamos));

    // Chegou mensagem mais nova enquanto esperávamos? Então esta resposta já
    // nasceu velha: quem responde é o dono da última, com esta aqui no
    // histórico. Era exatamente o caso das 19:14 — a mensagem que continuava a
    // descoberta já estava desatualizada quando a recusa chegou.
    if (foiSuperado(chaveDoTurno, senhaDoTurno)) {
      req.log.info(
        { leadId: lead.id },
        "Mensagem mais nova chegou na janela — esta não gera resposta",
      );
      return;
    }

    tokenDaTrava = await travar(chaveDoTurno);

    // Passou a janela inteira desde a leitura lá de cima: `pausedUntil`,
    // `status` e `atencao` podem ter mudado (o humano assumiu no celular, por
    // exemplo). Seguir com a cópia velha seria trocar uma corrida por outra.
    const leadAtual = (
      await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)).limit(1)
    )[0];
    if (leadAtual) lead = leadAtual;

    if (lead.pausedUntil && new Date(lead.pausedUntil).getTime() > Date.now()) {
      req.log.info(
        { leadId: lead.id, pausedUntil: lead.pausedUntil },
        "Humano assumiu durante a janela — não respondendo",
      );
      return;
    }

    // Get last N messages for context.
    // Buscamos as N MAIS RECENTES (desc) e depois invertemos para a ordem
    // cronológica (mais antiga → mais nova), que é o que o modelo espera.
    //
    // Rodada 44 — eram 30, agora são 20. Cada resposta paga o histórico inteiro
    // em tokens, e o teto da conta é por MINUTO (ver TETO_DE_TOKENS em
    // julia-persona.ts): 10 mensagens a menos são ~800 tokens por resposta, o
    // maior ganho isolado que existe sem mexer no prompt.
    //
    // Por que 20 e não 15: a ficha do lead guarda os FATOS (dor, objeção,
    // etapa, plano, temperatura), mas não guarda a NUANCE — o que já foi
    // oferecido, o que ele recusou, o tom da negociação. 20 economiza a maior
    // parte e mantém margem para conversa longa.
    const MENSAGENS_DE_CONTEXTO = 20;
    const recentHistory = await db
      .select()
      .from(leadMessagesTable)
      .where(eq(leadMessagesTable.leadId, lead.id))
      .orderBy(desc(leadMessagesTable.createdAt))
      .limit(MENSAGENS_DE_CONTEXTO);

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
      interlocutor: lead.interlocutor,
      descoberta: lead.descoberta,
    });

    const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: JULIA_SYSTEM_PROMPT },
      { role: "system", content: leadBriefing },
      ...history.map((m) => ({
        role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      })),
    ];

    // A CHAMADA QUE O DENTISTA ESTÁ ESPERANDO (Rodada 43).
    //
    // Antes, um 429 da OpenAI (limite de tokens por minuto da conta, que uma
    // rajada de respostas simultâneas estoura) caía direto no catch lá embaixo:
    // uma linha de log, e o dentista sem resposta nenhuma, sem ninguém saber.
    // Aconteceu quinze vezes em dois minutos no dia 12/08.
    //
    // Agora: até três repiques com espera crescente, um aviso de vida antes da
    // última tentativa, e — se ainda assim falhar — o lead vai para a central
    // de vigia, que é onde um humano olha. Silêncio nunca mais é o desfecho.
    let completion;
    try {
      completion = await comRepique(
        () =>
          openai.chat.completions.create(
            {
              model: REPLY_MODEL,
              max_completion_tokens: TETO_RESPOSTA,
              messages: chatMessages,
            },
            { timeout: 30_000 },
          ),
        {
          // O aviso de espera sai ANTES da espera longa, não depois: aos ~7
          // segundos ele ainda está olhando a tela; aos 19 já desistiu.
          //
          // Vai para o histórico só se foi entregue, como toda mensagem nossa
          // (Rodada 21) — e o histórico importa aqui: se a última tentativa
          // falhar, é esta promessa em aberto que segura o toque 1 do
          // follow-up (Rodada 36).
          antesDaUltima: async () => {
            const aviso = AVISO_DE_ESPERA(lead.name);
            if (await sendWhatsAppMessage(phone, aviso)) {
              await db.insert(leadMessagesTable).values({
                leadId: lead.id,
                direction: "outbound",
                content: aviso,
                messageType: "text",
              });
              req.log.info({ leadId: lead.id }, "Aviso de espera enviado — IA recusando");
            }
          },
          aoRepicar: ({ tentativa, esperaMs, erro }) =>
            req.log.warn(
              { leadId: lead.id, tentativa, esperaMs, erro },
              "OpenAI recusou — repicando",
            ),
        },
      );
    } catch (err) {
      // Acabaram as tentativas (ou o erro não era passageiro — chave errada,
      // payload inválido). O lead vai para a central COM o motivo técnico: sem
      // o detalhe, o dono abre a conversa, não vê nada de errado e não entende
      // por que aquilo está na lista.
      const detalhe = descreverErro(err);
      req.log.error(
        { leadId: lead.id, model: REPLY_MODEL, err },
        "OpenAI recusou em todas as tentativas — lead para a central de vigia",
      );
      await marcarAtencao(
        lead,
        "julia_estranha",
        `A IA não respondeu depois de ${esperasDeRepique().length + 1} tentativas. ${detalhe}`,
      );
      return;
    }

    const escolhaDaResposta = completion.choices[0];
    const reply = escolhaDaResposta?.message?.content?.trim();
    if (!reply) {
      // Não inventamos resposta (melhor calar do que falar bobagem), mas o
      // lead fica sem resposta — isso precisa aparecer no log, não sumir.
      //
      // O `finish_reason` e a contagem entram porque "veio vazia" sozinho não
      // diz NADA sobre a causa: estouro de teto e recusa do modelo produzem a
      // mesma string vazia. Foram esses dois números que faltaram para explicar
      // a prévia muda da abordagem em 18/08, e este caminho é o mesmo.
      req.log.error(
        {
          leadId: lead.id,
          model: REPLY_MODEL,
          finishReason: escolhaDaResposta?.finish_reason ?? null,
          tetoDeSaida: TETO_RESPOSTA,
          tokensGerados: completion.usage?.completion_tokens ?? null,
          tokensDeRaciocinio:
            completion.usage?.completion_tokens_details?.reasoning_tokens ?? null,
        },
        escolhaDaResposta?.finish_reason === "length"
          ? "Resposta estourou o teto de saída — lead ficou sem resposta; suba TETO_RESPOSTA em lib/modelos.ts"
          : "Modelo devolveu resposta vazia — lead ficou sem resposta",
      );

      // A CENTRAL DE VIGIA VALE PARA AS DUAS CARAS DA MESMA FALHA.
      //
      // O caminho que LANÇA já mandava o lead para a central: "silêncio nunca
      // mais é o desfecho". Este caminho — a chamada volta 200 com conteúdo
      // vazio — produz exatamente o mesmo desfecho para o dentista (ele falou
      // e ninguém respondeu) e ficava só numa linha de log, que ninguém lê a
      // menos que já esteja procurando. A falha barulhenta era vigiada; a
      // silenciosa, não, e é a silenciosa que não avisa que está acontecendo.
      //
      // Mesmo motivo do teto: um estouro pode devolver 400 OU resposta vazia,
      // e tratar as duas de jeitos diferentes fez o defeito da abordagem
      // parecer dois defeitos.
      const porQueVazia =
        escolhaDaResposta?.finish_reason === "length"
          ? `A IA estourou o teto de saída (${TETO_RESPOSTA} tokens) e não sobrou texto.`
          : "A IA respondeu, mas veio sem texto nenhum.";
      await marcarAtencao(
        lead,
        "julia_estranha",
        `${porQueVazia} O dentista falou e ficou sem resposta — vale reler a conversa e responder na mão.`,
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

    // É a PRIMEIRA resposta desta conversa?
    //
    // Quem clicou no botão do site está com a tela aberta, olhando. Os 12
    // segundos de "digitando..." da Rodada 28 fazem ele achar que não tem
    // ninguém — aqui o teto cai para 3s (ver PRIMEIRA_RESPOSTA_MAXIMO_MS).
    //
    // A pergunta é "já falamos com ele?", e não mais "o histórico tem uma linha
    // só?". A contagem funcionava enquanto cada mensagem dele virava uma
    // resposta; com a rajada agrupada, um "Ola julia" + "Renata" chega ao
    // histórico como DUAS linhas e a primeira resposta da conversa perderia o
    // teto de 3s — justamente no caso que o agrupamento existe para juntar.
    // `jaFalamos` é a mesma pergunta que escolheu a janela lá em cima.
    const primeiraResposta = !jaFalamos;

    let delivered = false;
    if (textoLimpo) {
      delivered = await sendWhatsAppMessage(phone, textoLimpo, primeiraResposta);
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

      // A VITRINE FOI ENTREGUE. Carimba, e a partir daqui a trava la de cima
      // cala a Julia ate uma pessoa assumir.
      //
      // So depois de ENTREGUE, de proposito: carimbar antes faria uma falha da
      // Evolution consumir a unica mensagem que esta clinica ia receber. Mesma
      // regra do historico logo acima, e pelo mesmo motivo.
      if (lerInterlocutor(lead.interlocutor) === "assistente_virtual") {
        const agora = new Date();
        await db
          .update(leadsTable)
          .set({ vitrineEnviadaEm: agora, updatedAt: agora })
          .where(eq(leadsTable.id, lead.id));
        lead.vitrineEnviadaEm = agora;
      }
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
    } else if (perguntasRepetidas(textoLimpo, lead.descoberta).length > 0) {
      // A CERCA DA PORTA DE SAIDA (Rodada 54).
      //
      // O prompt manda perguntar uma vez so, e a ficha diz o que ja saiu. Isto
      // aqui e o que acontece quando ela desobedece assim mesmo: instrucao de
      // modelo reduz frequencia, nao impede — a mesma licao do nome inventado.
      //
      // NAO bloqueia a mensagem, e nao daria: quando isto roda o texto dela ja
      // existe, e reescrever a fala de um modelo por regex seria pior que o
      // defeito. O que ela faz e transformar uma regressao silenciosa em alarme
      // na central. Causa 4 e a unica das cinco que vive fora do alcance do
      // teste; sem este gatilho, a unica forma de descobrir que ela voltou a
      // insistir seria um dentista reclamando.
      const repetidas = perguntasRepetidas(textoLimpo, lead.descoberta);
      await marcarAtencao(
        lead,
        "julia_estranha",
        `Ela perguntou de novo o que ele já respondeu: ${repetidas
          .map((t) => TOPICO_PT[t])
          .join(", ")}.`,
      );
      req.log.warn(
        { leadId: lead.id, topicos: repetidas },
        "Pergunta repetida — a porta de saida nao foi respeitada",
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

    // Os sinais de temperatura que o extrator encontrar (Rodada 41). Fica fora
    // do try da extração porque a temperatura é atualizada mais abaixo mesmo
    // quando a extração falha — o "respondeu_algo" não depende de IA.
    let sinaisDaConversa: string[] = [];

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

      // Repique CURTO aqui, de propósito: a resposta do dentista já saiu, então
      // ninguém está esperando na tela — mas perder a extração custa a dor, a
      // objeção e os sinais de temperatura desta conversa (Rodada 41). Uma
      // segunda chance é barata; segurar o processo por 19 segundos numa
      // rajada, não.
      const extraction = await comRepique(
        () =>
          openai.chat.completions.create(
            {
              model: EXTRACTION_MODEL,
              max_completion_tokens: TETO_EXTRACAO,
              messages: [
                { role: "system", content: JULIA_EXTRACTION_PROMPT },
                { role: "user", content: transcript },
              ],
            },
            { timeout: 20_000 },
          ),
        {
          esperas: esperasDeRepique().slice(0, 1),
          aoRepicar: ({ erro }) =>
            req.log.warn({ leadId: lead.id, erro }, "Extração recusada — uma segunda tentativa"),
        },
      );

      // O JSON TRUNCADO E O JSON AUSENTE não são o mesmo problema, e o catch
      // lá embaixo trata os dois como "seguindo sem". A diferença importa: um
      // JSON cortado no meio significa TETO CURTO, e teto curto piora
      // exatamente na conversa rica — a que tem sinal, descoberta respondida e
      // dor escrita, ou seja, o melhor lead da lista. Sem esta linha o sintoma
      // seria a ficha parada, sem ninguém saber por quê.
      const escolhaDaExtracao = extraction.choices[0];
      if (escolhaDaExtracao?.finish_reason === "length") {
        req.log.error(
          {
            leadId: lead.id,
            model: EXTRACTION_MODEL,
            tetoDeSaida: TETO_EXTRACAO,
            tokensGerados: extraction.usage?.completion_tokens ?? null,
          },
          "Extração estourou o teto de saída — a ficha deste lead não foi atualizada; suba TETO_EXTRACAO em lib/modelos.ts",
        );
      }
      const rawExtraction = escolhaDaExtracao?.message?.content?.trim() ?? "";
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
        duvidaDoSite?: string | null;
        sinais?: string[];
        interlocutor?: string | null;
        descoberta?: Record<string, unknown> | null;
        trechos?: Record<string, unknown> | null;
      };

      // SINAIS DE TEMPERATURA, agora peneirados (lib/peneira-de-sinais.ts).
      //
      // Três camadas, e cada uma responde uma pergunta diferente:
      //   - aqui, o FORMATO: é mesmo uma lista de strings? (o modelo às vezes
      //     inventa formato);
      //   - a peneira, o FATO: o sinal se sustenta no que ele escreveu?
      //   - registrarSinais, o NOME: existe na tabela de pontos?
      //
      // A do meio é nova, e é a que faltava: o lead 49 recebeu 40 dos 53
      // pontos de dois sinais que nunca aconteceram, e as outras duas camadas
      // deixaram passar porque o formato estava certo e o nome existia.
      if (Array.isArray(parsed.sinais)) {
        const peneira = peneirarSinais(
          parsed.sinais.filter((s): s is string => typeof s === "string"),
          {
            descoberta: parsed.descoberta,
            painPoints: parsed.painPoints,
            trechos: parsed.trechos,
            // SÓ o que ELE escreveu. É o que faz a citação da Júlia reprovar
            // sozinha, sem precisar de regra própria para autoria.
            mensagensDele: history
              .filter((m) => m.direction === "inbound")
              .map((m) => m.content),
          },
        );
        sinaisDaConversa = peneira.aceitos;

        if (peneira.descartados.length > 0) {
          // Vai para o log SEMPRE, e com o motivo: sinal descartado em
          // silêncio viraria "a temperatura está baixa e ninguém sabe por quê"
          // — o espelho exato do defeito que a peneira conserta.
          req.log.warn(
            { leadId: lead.id, descartados: peneira.descartados },
            "Sinais de temperatura descartados: o extrator não sustentou",
          );
        }
      }

      const update: {
        painPoints?: string;
        mainObjection?: string;
        name?: string;
        planInterest?: "basic" | "essencial" | "pro";
        funnelStage?: FunnelStage;
        duvidaDoSite?: string;
        interlocutor?: Interlocutor;
        vitrineEnviadaEm?: Date | null;
        descoberta?: string;
        updatedAt?: Date;
      } = {};
      // QUEM ESTA DO OUTRO LADO, segunda camada. Sobrescreve em QUALQUER
      // direcao (ao contrario da lista fixa, que so preenche lacuna): o
      // extrator le a conversa inteira, entao e ele que enxerga a pessoa
      // assumindo depois do robo, ou o "sou da equipe da doutora" que nenhuma
      // lista de palavras alcanca. Valor invalido vira "nao_sei" e nao grava.
      // O QUE JA FOI PERGUNTADO. Funde com o que ja estava guardado em vez de
      // substituir: um turno em que o extrator nao enxergou o assunto nao pode
      // apagar o que se sabia, senao a pergunta volta — que e o defeito, nao o
      // conserto. A precedencia mora em registrarDescoberta.
      const descobertaAgora = registrarDescoberta(lead.descoberta, parsed.descoberta);
      if (descobertaAgora && descobertaAgora !== (lead.descoberta ?? "")) {
        update.descoberta = descobertaAgora;
      }

      const quemAgora = lerInterlocutor(parsed.interlocutor);
      if (quemAgora !== "nao_sei" && quemAgora !== lerInterlocutor(lead.interlocutor)) {
        update.interlocutor = quemAgora;
        // A PORTA DE SAIDA da trava do vai-e-vem. Uma pessoa assumiu a
        // conversa: o carimbo da vitrine cai junto, senao a Julia ficaria muda
        // para sempre com quem chegou depois do robo — que e o oposto do que a
        // trava existe para fazer. Se a clinica devolver a conversa ao
        // automatico mais tarde, ele ganha uma vitrine nova, e isso e certo:
        // e outro momento, e quem le e outra pessoa.
        if (quemAgora !== "assistente_virtual" && lead.vitrineEnviadaEm) {
          update.vitrineEnviadaEm = null;
        }
      }

      if (parsed.painPoints && parsed.painPoints.trim()) {
        update.painPoints = parsed.painPoints.trim();
      }
      if (parsed.mainObjection && parsed.mainObjection.trim()) {
        update.mainObjection = parsed.mainObjection.trim();
      }
      // Só grava o nome se ainda não temos um (não sobrescreve o que já sabíamos).
      //
      // E SÓ SE ELE TIVER DITO (Rodada 52). O extrator devolvia qualquer string
      // e isto aqui gravava com um `.trim()`: numa conversa real saiu "Rosane"
      // de uma troca em que ninguém escreveu "Rosane". A instrução "não invente
      // nada" existe no prompt dele desde sempre — instrução de modelo não é
      // cerca, esta é.
      //
      // Confere só contra o que ELE mandou. Incluir as falas da Júlia reabriria
      // o buraco pelo outro lado: ela chuta um nome, o extrator lê a própria
      // fala dela na passada seguinte, e o chute vira fato gravado.
      //
      // E EXISTE CAMINHO DE VOLTA (Rodada 53). O `!lead.name` sozinho fazia um
      // nome errado ficar errado para sempre: um lead real ficou com o nome da
      // ASSISTENTE gravado como se fosse o da dentista, e nada no sistema podia
      // desfazer isso. Agora o nome pode ser corrigido quando QUEM ESTA DO
      // OUTRO LADO muda nesta mesma passada — que e exatamente o momento em que
      // se descobre que o nome guardado era de outra pessoa.
      //
      // Fora desse momento a trava continua: nome so se grava uma vez. Deixar o
      // extrator reescrever a cada mensagem trocaria um defeito raro (nome
      // preso) por um constante (nome oscilando). O outro caminho de correcao e
      // a mao do dono, pelo PATCH /api/leads/:id.
      const nomeNovo = parsed.name?.trim();
      const interlocutorMudou = Boolean(update.interlocutor);
      const vaiGravarNome =
        Boolean(nomeNovo) &&
        (!lead.name || (interlocutorMudou && nomeNovo !== lead.name));

      // E O NOME TEM QUE SER DE UMA PESSOA (19/08/2026). Duas metades, e as
      // duas nasceram do mesmo defeito em conversas reais: "Bem-vindo ao
      // Consultorio Dr. Romulo" virou "Dr. Romulo" no lead 43, e "Sou a Dra.
      // Gabrielly e sera um prazer te atender" virou "Dra. Gabrielly" no 63.
      // Nos dois o nome estava mesmo escrito — so nao havia ninguem escrevendo.
      //
      //   - `textosDePessoa` tira do corpo de prova as mensagens que se
      //     denunciam como automaticas. E por MENSAGEM: o que a pessoa que
      //     assumir a conversa escrever depois continua valendo.
      //   - `podeGravarNome` fecha o resto: enquanto o interlocutor for robo,
      //     nome nenhum e gravado, nem o que vier numa linha curta e limpa.
      //
      // A pergunta do `nomeFoiDito` e "esta escrito?"; esta e "quem escreveu?".
      const quemAssina = update.interlocutor ?? lerInterlocutor(lead.interlocutor);
      if (nomeNovo && vaiGravarNome && podeGravarNome(quemAssina)) {
        const ditosPorEle = textosDePessoa(
          history.filter((m) => m.direction === "inbound").map((m) => m.content),
        );
        if (nomeFoiDito(nomeNovo, ditosPorEle)) {
          update.name = nomeNovo;
          if (lead.name && lead.name !== nomeNovo) {
            req.log.info(
              { leadId: lead.id, de: lead.name, para: nomeNovo },
              "Nome corrigido: quem esta do outro lado mudou",
            );
          }
        } else {
          req.log.warn(
            { leadId: lead.id, nome: nomeNovo },
            "Nome do extrator nao aparece no que uma PESSOA escreveu — descartado",
          );
        }
      } else if (nomeNovo && vaiGravarNome) {
        req.log.warn(
          { leadId: lead.id, nome: nomeNovo, interlocutor: quemAssina },
          "Nome veio de um automatico — nao e o nome de quem esta falando",
        );
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

      // O QUE A LANDING NÃO RESPONDE (Rodada 35).
      //
      // Duas travas, e as duas do NOSSO lado, não do modelo: só para quem a
      // origem diz que veio do site, e só enquanto o campo estiver vazio. A
      // primeira é o que fez ele clicar — da segunda em diante a dúvida já
      // nasceu da conversa com a Júlia, e a conversa não é a página.
      //
      // Gravar isso aqui é de graça: o extrator já leu a conversa inteira para
      // achar dor e objeção.
      if (lead.origin === ORIGEM_SITE && !lead.duvidaDoSite) {
        const assunto = limparAssunto(parsed.duvidaDoSite);
        if (assunto) update.duvidaDoSite = assunto;
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
        // Reflete em memória para a guarda do "só uma vez" continuar valendo se
        // este mesmo lead voltar a passar por aqui na mesma execução.
        if (update.duvidaDoSite) lead.duvidaDoSite = update.duvidaDoSite;
        // Reflete em memoria: as travas de temperatura e de follow-up logo
        // abaixo leem este campo, e sem isto so valeriam na passada seguinte.
        if (update.interlocutor) lead.interlocutor = update.interlocutor;
        if (update.vitrineEnviadaEm === null) lead.vitrineEnviadaEm = null;
        if (update.descoberta) lead.descoberta = update.descoberta;
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
      // "falar com um atendente" SAIU daqui (Rodada 52): e frase de MENU
      // automatico ("digite 2 para falar com um atendente"), nao pedido de
      // gente. Ela sozinha punha 30 pontos no lead — o piso da faixa quente —
      // e foi assim que um bot institucional virou lead QUENTE em 7 minutos.
      // As irmas ficam: nenhuma delas cabe num menu.
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

    // DE QUEM É O FATO, aplicado ao handoff (Rodada 52).
    //
    // Duas coisas diferentes disparavam o MESMO handoff, e as duas ganhavam as
    // mesmas consequências:
    //   - o dentista PEDIR uma pessoa;
    //   - a própria Júlia PROMETER que vai passar adiante.
    //
    // A segunda continua precisando de alerta: promessa dela em aberto é caso
    // de gente entregar (é a mesma pendência que o toque 1 do follow-up já
    // respeita, via SINAIS_DE_PROMESSA). O que ela NÃO pode é esquentar o lead:
    // temperatura mede o que ELE demonstrou, e ela falando sozinha não é sinal
    // de compra nenhum. Era o mesmo erro do extrator lendo as falas dela como
    // interesse dele.
    // `ehPessoa` fecha o caminho lateral: o bloco abaixo escreve status "hot"
    // DIRETO no lead, sem passar pela temperatura, entao a trava do termometro
    // sozinha nao alcanca este ponto. Sem isto, um menu com qualquer frase da
    // lista promoveria o robo a quente por fora — e ainda chamaria o dono ao
    // Telegram para uma conversa em que ninguem pediu nada.
    const pediuPessoa =
      !optedOut &&
      ehPessoa(lerInterlocutor(lead.interlocutor)) &&
      handoffKeywords.some((k) => textoNorm.includes(k));
    const elaPrometeuPassar =
      !optedOut &&
      (respostaNorm.includes("vou passar para") ||
        respostaNorm.includes("vou te passar"));

    const handoffRequested = pediuPessoa || elaPrometeuPassar;

    // Alerta SEMPRE que o lead pedir — não uma única vez na vida dele.
    // Antes, um falso positivo queimava a flag e o pedido real semanas depois
    // passava batido. O update é idempotente; o alerta é que repete.
    if (handoffRequested) {
      // Não rebaixa quem já é cliente ("closed") nem quem pediu para parar
      // ("lost"). O handoff roda DEPOIS da extração; sem esta guarda, um
      // cliente que escrevesse "me liga" voltaria para "hot" e a leva de
      // follow-up de VENDA seria armada de novo para quem já pagou.
      //
      // E só sobe para "hot" quando o pedido foi DELE: a promessa dela não
      // promove ninguém, pelo mesmo motivo de não pontuar.
      const statusAposHandoff =
        lead.status === "closed" || lead.status === "lost" || !pediuPessoa
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

    // TEMPERATURA DE VERDADE (Rodada 41): o que esquenta um lead não é ele
    // falar, é O QUE ele fala. Soma os sinais desta mensagem aos já vistos —
    // sem repetir (perguntar preço três vezes vale 15, não 45) — e deriva o
    // status da pontuação. Antes, "warm" era qualquer um que mandou mensagem:
    // quem comparou planos ficava igual a quem mandou "oi".
    //
    // Roda ANTES de armar a leva de follow-ups, de propósito: a cadência é
    // escolhida pela temperatura, e tem que ser a temperatura DE AGORA.
    // ROBO NAO ESQUENTA LEAD (Rodada 52). A trava que nao depende do modelo:
    // qualquer que seja o sinal — preco, recurso, ate o "falar com um atendente"
    // de um menu — palavra de automatico nao move o termometro. Barrar num lugar
    // so vale mais do que cacar palavra por palavra na lista de cada detector, e
    // foi assim que um bot institucional virou lead QUENTE em 7 minutos.
    //
    // Nem sequer ANOTA os sinais, e isso e o ponto: `sinaisVistos` acumula num
    // conjunto que nunca zera. Um "perguntou_preco" colhido do menu do robo
    // ficaria valendo 15 pontos que ninguem ganhou — e cobraria esses pontos da
    // pessoa de verdade que assumir a conversa depois.
    //
    // Escrito como `else try` para nao reindentar o bloco inteiro: o que muda e
    // so a guarda na entrada.
    if (!podePontuarTemperatura(lerInterlocutor(lead.interlocutor))) {
      req.log.info(
        { leadId: lead.id },
        "Atendimento automatico — temperatura nao pontua",
      );
    } else try {
      const novos = [...sinaisDaConversa, "respondeu_algo"];
      // O handoff tem detector próprio (acima), mais confiável que o extrator
      // para este sinal — por isso ele não está na lista do prompt.
      //
      // `pediuPessoa`, e nao `handoffRequested`: a Julia prometendo passar
      // adiante gera alerta (alguem tem que entregar), mas nao vale os 30
      // pontos. Temperatura mede o que ELE demonstrou.
      if (pediuPessoa) novos.push("pediu_pessoa");

      const { sinaisVistos, temperatura } = registrarSinais(lead.sinaisVistos, novos);

      if (
        temperatura !== (lead.temperatura ?? 0) ||
        sinaisVistos !== (lead.sinaisVistos ?? "")
      ) {
        // "closed" e "lost" são terminais: a pontuação continua sendo anotada
        // (é história da conversa), mas não rebaixa nem ressuscita ninguém.
        const terminal = lead.status === "closed" || lead.status === "lost";
        const statusDerivado = statusDaFaixa(faixaDaTemperatura(temperatura));

        await db
          .update(leadsTable)
          .set({
            temperatura,
            sinaisVistos,
            ...(terminal ? {} : { status: statusDerivado }),
            updatedAt: new Date(),
          })
          .where(eq(leadsTable.id, lead.id));

        // Reflete em memória: a armação da leva logo abaixo lê estes campos.
        lead.temperatura = temperatura;
        lead.sinaisVistos = sinaisVistos;
        if (!terminal) lead.status = statusDerivado;
      }
    } catch (err) {
      req.log.warn({ err, leadId: lead.id }, "Atualização de temperatura falhou (seguindo sem)");
    }

    // Arma uma leva NOVA de follow-ups, contando a partir de agora.
    // Como acabamos de cancelar os pendentes acima, não há leva ativa — então
    // sempre criamos uma nova. Assim, se o lead sumir, a cadência recomeça do
    // último contato. (Só não arma se o lead já fechou ou foi perdido.)
    // Robo do outro lado nao recebe leva (decisao do dono, 17/08/2026): a
    // Julia responde UMA vez, bem — o dentista pode ler depois — e para. Os
    // toques cairiam no mesmo automatico, que responderia de novo: ping-pong de
    // robo com robo gastando credito dos dois lados. Quando uma pessoa assumir,
    // o interlocutor muda e a cadencia arma sozinha na passada seguinte, porque
    // a leva e armada a cada resposta dele.
    if (!mereceFollowUp(lerInterlocutor(lead.interlocutor))) {
      req.log.info(
        { leadId: lead.id },
        "Atendimento automatico — nenhuma leva de follow-up armada",
      );
    } else if (!["closed", "lost"].includes(lead.status)) {
      // RODADA 41 (Parte 2): a leva nasce na cadência da temperatura DE AGORA
      // — a atualização logo acima veio antes disto de propósito. Como toda
      // resposta dele cancela a leva antiga e arma esta, um lead frio que
      // pergunta o preço troca de cadência aqui, sem passo extra.
      const cadencia = CADENCIA_POR_FAIXA[faixaDaTemperatura(lead.temperatura ?? 0)];

      // A conversa ANDOU? Conta as mensagens DELE, nao o total: as respostas da
      // Julia inflariam o numero e fariam toda conversa parecer profunda. O
      // historico ja inclui a mensagem que ele acabou de mandar (gravada na
      // fase A), entao este numero e o de agora.
      const mensagensDele = history.filter((m) => m.direction === "inbound").length;
      const profunda = conversaFoiProfunda(mensagensDele);

      const scheduledFollowUps = cadencia.map((hours, idx) => {
        // O ÚLTIMO toque é sempre a despedida (template 4, "essa é minha última
        // mensagem"): numa cadência de dois toques, prometer a última mensagem
        // e nunca mandá-la deixaria a porta entreaberta para sempre — e mandar
        // um toque do meio como final quebraria a promessa ao contrário.
        const template = (idx === cadencia.length - 1 ? 4 : idx + 1) as
          keyof typeof FOLLOW_UP_TEMPLATES;
        return {
          leadId: lead.id,
          scheduledAt: new Date(Date.now() + hours * 60 * 60 * 1000),
          touchNumber: idx + 1,
          // Explícito, apesar do padrão do schema já ser "conversa": é aqui que
          // se decide que estes toques PODEM citar a conversa e a dor, porque
          // chegar neste ponto significa que ele respondeu alguma coisa.
          kind: "conversa" as const,
          // A profundidade so muda o toque 1 — os outros tres nunca afirmaram
          // nada sobre o tamanho da conversa, entao recebem o argumento e o
          // ignoram.
          messageTemplate: FOLLOW_UP_TEMPLATES[template](
            lead.name,
            lead.painPoints,
            profunda,
          ),
          status: "pending" as const,
        };
      });

      await db.insert(followUpsTable).values(scheduledFollowUps);
    }
  } catch (err) {
    req.log.error({ err }, "Webhook processing error");
  } finally {
    // A trava volta em QUALQUER saída — os vários `return` do caminho, o erro
    // no meio da geração, o corte por spam. Uma trava esquecida não faz barulho
    // nenhum: ela simplesmente cala aquele lead para sempre, e o sintoma
    // (dentista sem resposta) aparece longe da causa.
    if (chaveDoTurno !== null && tokenDaTrava !== null) {
      soltar(chaveDoTurno, tokenDaTrava);
    }
    if (chaveDoTurno !== null) {
      encerrarTurno(chaveDoTurno, senhaDoTurno);
    }
  }
});

export default router;
