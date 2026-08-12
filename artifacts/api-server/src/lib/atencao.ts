/**
 * CENTRAL DE VIGIA — quando uma conversa precisa de uma pessoa.
 *
 * O Dr. Sarinho responde pelo WhatsApp, não pelo painel. O que faltava era
 * saber QUANDO entrar. Este módulo concentra a decisão: os sinais que marcam um
 * lead, a precedência entre eles e quem merece Telegram.
 *
 * LIMITAÇÃO CONHECIDA, registrada de propósito para quem vier depois: o gatilho
 * "julia_estranha" pega SINAIS INDIRETOS (o dentista reclamou, ela repetiu, ela
 * escreveu demais, o envio falhou). Ele NÃO julga o conteúdo — se a Júlia
 * afirmar uma bobagem com convicção e o dentista não reclamar, ninguém percebe.
 * O caminho para isso seria uma auditoria periódica das conversas por IA, mais
 * caro e fora do escopo desta rodada.
 */
import { db, leadsTable, leadMessagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Os motivos, DA MAIOR PARA A MENOR gravidade. A ordem é o contrato da
 * precedência: um `sem_resposta` nunca apaga um `pediu_pessoa`.
 */
export const MOTIVOS_ATENCAO = [
  "pediu_pessoa",
  "irritado",
  "julia_estranha",
  "sem_resposta",
] as const;

export type MotivoAtencao = (typeof MOTIVOS_ATENCAO)[number];

/** O motivo em português, para o painel e para o Telegram. */
export const MOTIVO_PT: Record<MotivoAtencao, string> = {
  pediu_pessoa: "Pediu para falar com uma pessoa",
  irritado: "Parece irritado",
  julia_estranha: "A Júlia pode ter errado",
  sem_resposta: "Está sem resposta há mais de 15 min",
};

/**
 * Só estes dois viram notificação no Telegram.
 *
 * A divisão é proposital: Telegram é para o que precisa dele AGORA. Se todo
 * gatilho notificasse, em uma semana ele estaria ignorando todos — e o que
 * importasse passaria batido junto.
 */
const MOTIVOS_COM_TELEGRAM = new Set<MotivoAtencao>(["pediu_pessoa", "irritado"]);

export function avisaNoTelegram(motivo: MotivoAtencao): boolean {
  return MOTIVOS_COM_TELEGRAM.has(motivo);
}

/**
 * O motivo novo deve substituir o que já está marcado?
 *
 * Só quando é MAIS GRAVE. Empate não substitui — é isso que faz o alerta de
 * irritação sair uma vez por episódio, e não a cada mensagem.
 */
export function deveSubstituir(atual: string | null | undefined, novo: MotivoAtencao): boolean {
  if (!atual) return true;
  const i = (MOTIVOS_ATENCAO as readonly string[]).indexOf(atual);
  // Valor que não conhecemos (banco mexido na mão, motivo antigo removido):
  // o novo, que é válido, assume. Melhor um motivo certo do que um lixo preso.
  if (i === -1) return true;
  return (MOTIVOS_ATENCAO as readonly string[]).indexOf(novo) < i;
}

/** Tira acento e caixa, para as listas fixas não precisarem duplicar variantes. */
export function semAcento(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * O que dispara irritação na hora, sem esperar o extrator.
 *
 * Note o que NÃO está aqui: "tá caro", "não tenho interesse", "não é pra mim".
 * Discordar não é estar irritado. Se desacordo comercial marcasse irritação, o
 * Telegram apitaria em toda negociação normal e ele pararia de olhar — o que
 * custaria justamente os casos reais.
 */
export const SINAIS_DE_IRRITACAO = [
  "que merda",
  "que porcaria",
  "porcaria de",
  "não estou entendendo nada",
  "isso não funciona",
  "que atendimento",
  "péssimo atendimento",
  "absurdo",
  "ridículo",
  "perda de tempo",
  "cansei",
  "tô cansado disso",
  "já falei isso",
  "já disse isso",
  "de novo a mesma coisa",
  "você não me entende",
  "não é isso que eu perguntei",
  "quero cancelar tudo",
  "me tira daqui",
];

/** O dentista reclamou de não estar sendo entendido. */
export const SINAIS_DE_CONFUSAO = [
  "não entendi",
  "não entendeu",
  "não foi isso",
  "não é isso que",
  "você tá me entendendo",
  "como assim",
  "não faz sentido",
  "tá confuso",
];

/**
 * Procura um dos sinais no texto e devolve QUAL bateu (ou null).
 *
 * Devolver o sinal, e não um booleano, é o que permite ao painel e ao Telegram
 * dizerem por que dispararam — sem isso o aviso seria "parece irritado" sem
 * nada que o sustente, e ele teria que abrir a conversa para descobrir.
 */
function acharSinal(texto: string, sinais: string[]): string | null {
  const alvo = semAcento(texto);
  for (const sinal of sinais) {
    if (alvo.includes(semAcento(sinal))) return sinal;
  }
  return null;
}

export function pareceIrritado(texto: string): string | null {
  return acharSinal(texto, SINAIS_DE_IRRITACAO);
}

/**
 * RODADA 36 — a Júlia prometeu e a conversa parou ali.
 *
 * O caso real: o dentista pediu o contrato, ela disse "vou pedir pra alguém do
 * time te mandar", ninguém mandou — e uma hora depois o follow-up automático
 * chegou dizendo que a conversa "ficou pela metade". Do lado dele: pediu
 * documento, não recebeu, e ainda levou um "vamos continuar?".
 *
 * Estes são os jeitos que a PRÓPRIA JÚLIA promete coisa (o prompt ensina vários
 * deles, como o "deixa eu confirmar certinho e te falo" do SE NÃO SOUBER).
 * Quando a última mensagem da conversa é dela e contém um destes, o toque 1
 * não é caso de robô — é caso de gente entregar o que foi prometido.
 */
export const SINAIS_DE_PROMESSA = [
  "vou te mandar",
  "vou mandar",
  "vou te enviar",
  "vou enviar",
  "vou pedir pra",
  "vou pedir para",
  "vou confirmar",
  "deixa eu confirmar",
  "vou verificar",
  "deixa eu verificar",
  "vou checar",
  "te falo",
  "te aviso",
  "te retorno",
  "já te mando",
  "vou providenciar",
  "tô providenciando",
  "estou providenciando",
];

export function pareceMensagemComPromessa(texto: string): string | null {
  return acharSinal(texto, SINAIS_DE_PROMESSA);
}

export function pareceConfuso(texto: string): string | null {
  return acharSinal(texto, SINAIS_DE_CONFUSAO);
}

/** Acima disto a Júlia quebrou a própria regra de 2-3 linhas. */
export const LIMITE_DE_TEXTAO = 400;

export function respostaLonga(texto: string): boolean {
  return texto.length > LIMITE_DE_TEXTAO;
}

/**
 * Semelhança entre dois textos, de 0 a 1 (Dice sobre bigramas de caracteres).
 *
 * Bigrama e não palavra: a Júlia travada reescreve a mesma frase trocando uma
 * ou duas palavras, e comparação por conjunto de palavras perde isso.
 */
export function similaridade(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramas = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };

  const ma = bigramas(a);
  const mb = bigramas(b);
  let comuns = 0;
  for (const [g, n] of ma) comuns += Math.min(n, mb.get(g) ?? 0);
  return (2 * comuns) / (a.length - 1 + (b.length - 1));
}

export const LIMITE_DE_SEMELHANCA = 0.8;

/**
 * A Júlia repetiu quase a mesma coisa? É o sinal mais confiável de que ela
 * travou — e o mais irritante para quem está do outro lado.
 */
export function respostaRepetida(nova: string, anterior: string | null | undefined): boolean {
  if (!anterior) return false;
  const a = semAcento(nova).replace(/\s+/g, " ").trim();
  const b = semAcento(anterior).replace(/\s+/g, " ").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  // Abertura idêntica já basta: ela recomeçando igual é repetição, mesmo que
  // o final mude.
  if (a.length >= 60 && b.length >= 60 && a.slice(0, 60) === b.slice(0, 60)) return true;
  return similaridade(a, b) > LIMITE_DE_SEMELHANCA;
}

/** O trecho que vai para o painel e para o Telegram, cortado no tamanho útil. */
const LIMITE_DO_DETALHE = 280;

export function recortarDetalhe(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (!limpo) return null;
  return limpo.length > LIMITE_DO_DETALHE ? `${limpo.slice(0, LIMITE_DO_DETALHE)}…` : limpo;
}

/** O molde mínimo de lead que este módulo precisa (o webhook passa o lead inteiro). */
interface LeadVigiado {
  id: number;
  atencao?: string | null;
}

/**
 * Marca o lead, respeitando a precedência.
 *
 * Devolve `true` só quando a marcação REALMENTE mudou. Quem chama usa isso para
 * decidir se manda Telegram — é o que garante um alerta por episódio.
 */
export async function marcarAtencao(
  lead: LeadVigiado,
  motivo: MotivoAtencao,
  detalhe: string | null,
): Promise<boolean> {
  if (!deveSubstituir(lead.atencao, motivo)) return false;

  const agora = new Date();
  await db
    .update(leadsTable)
    .set({
      atencao: motivo,
      atencaoDesde: agora,
      atencaoDetalhe: recortarDetalhe(detalhe),
      updatedAt: agora,
    })
    .where(eq(leadsTable.id, lead.id));

  // Reflete em memória: o mesmo webhook pode checar mais de um gatilho, e sem
  // isto o segundo não veria o que o primeiro marcou.
  lead.atencao = motivo;
  logger.info({ leadId: lead.id, motivo }, "Lead marcado para atenção");
  return true;
}

/**
 * Limpa a marcação. `porque` só vai para o log — serve para distinguir o botão
 * do painel de uma limpeza automática quando alguém for ler depois.
 */
export async function limparAtencao(lead: LeadVigiado, porque: string): Promise<boolean> {
  if (!lead.atencao) return false;

  await db
    .update(leadsTable)
    .set({
      atencao: null,
      atencaoDesde: null,
      atencaoDetalhe: null,
      updatedAt: new Date(),
    })
    .where(eq(leadsTable.id, lead.id));

  logger.info({ leadId: lead.id, anterior: lead.atencao, porque }, "Atenção resolvida");
  lead.atencao = null;
  return true;
}

/**
 * Minutos de silêncio que fazem o gatilho 4 disparar. Lido a cada chamada, e
 * não no topo do módulo, pelo mesmo motivo do `configTelegram()`: assim o valor
 * efetivo é o que está no ambiente agora e o teste consegue mudá-lo.
 */
export function minutosSemResposta(): number {
  return Number(process.env.ALERTA_SEM_RESPOSTA_MINUTOS) || 15;
}

function estaPausado(lead: { pausedUntil?: Date | string | null }, agora: number): boolean {
  return Boolean(lead.pausedUntil && new Date(lead.pausedUntil).getTime() > agora);
}

/**
 * GATILHO 4 — o dentista falou e ficou sem resposta.
 *
 * Roda no agendador que já existe (a cada 5 min). Também é aqui que o motivo
 * `sem_resposta` se desfaz sozinho: se a Júlia respondeu depois, o problema
 * acabou. Os outros três NÃO se limpam com o tempo — se ninguém cuidou,
 * continuam pendentes, porque sumir sozinho é pior que ficar chato.
 */
export async function verificarSemResposta(): Promise<{ marcados: number; limpos: number }> {
  const agora = Date.now();
  const limiteMs = minutosSemResposta() * 60 * 1000;
  let marcados = 0;
  let limpos = 0;

  const leads = await db.select().from(leadsTable).limit(500);

  for (const lead of leads) {
    // Cliente e perdido não geram cobrança de resposta.
    if (lead.status === "closed" || lead.status === "lost") continue;

    // Pausado é silêncio INTENCIONAL: ele assumiu a conversa. Cobrar resposta
    // aqui seria o sistema reclamando do próprio dono.
    if (estaPausado(lead, agora)) continue;

    const ultima = (
      await db
        .select()
        .from(leadMessagesTable)
        .where(eq(leadMessagesTable.leadId, lead.id))
        .orderBy(desc(leadMessagesTable.createdAt))
        .limit(1)
    )[0];
    if (!ultima) continue;

    const dele = ultima.direction === "inbound";
    const idadeMs = agora - new Date(ultima.createdAt).getTime();

    if (dele && idadeMs > limiteMs) {
      if (await marcarAtencao(lead, "sem_resposta", ultima.content)) marcados++;
    } else if (!dele && lead.atencao === "sem_resposta") {
      // A Júlia respondeu depois — o motivo desta marcação especificamente
      // deixou de existir.
      if (await limparAtencao(lead, "a Júlia respondeu")) limpos++;
    }
  }

  if (marcados > 0 || limpos > 0) {
    logger.info({ marcados, limpos }, "Vigia de sem-resposta");
  }
  return { marcados, limpos };
}
