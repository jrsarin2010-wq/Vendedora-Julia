/**
 * RÓTULOS EM PORTUGUÊS.
 *
 * Traduz apenas o que o olho vê. As CHAVES aqui são exatamente os valores que
 * vivem no banco e viajam na API ("cold", "qualified", ...) — elas nunca mudam.
 * Se um valor novo aparecer no enum e alguém esquecer de traduzir, o próprio
 * valor cru é exibido, em vez de a tela quebrar ou mostrar vazio.
 */

export const STATUS_PT: Record<string, string> = {
  hot: "Quente",
  warm: "Morno",
  cold: "Frio",
  closed: "Cliente",
  lost: "Perdido",
};

/**
 * TEMPERATURA (Rodada 41). As faixas e os limites são os mesmos de
 * api-server/src/lib/temperatura.ts — duplicados aqui porque o painel não
 * importa código do servidor. Se os limites mudarem lá, mudam aqui.
 */
export const FAIXA_PT: Record<string, string> = {
  frio: "Frio",
  morno: "Morno",
  quente: "Quente",
  fervendo: "Fervendo",
};

export type Faixa = "frio" | "morno" | "quente" | "fervendo";

export function faixaDaTemperatura(pontos: number): Faixa {
  if (pontos >= 60) return "fervendo";
  if (pontos >= 30) return "quente";
  if (pontos >= 10) return "morno";
  return "frio";
}

export const rotuloFaixa = (v: string | null | undefined): string =>
  (v && FAIXA_PT[v]) || v || "—";

export const ETAPA_PT: Record<string, string> = {
  new: "Novo",
  contacted: "Contatado",
  qualified: "Qualificado",
  interested: "Interessado",
  objection: "Objeção",
  closing: "Fechamento",
  closed: "Fechado",
  lost: "Perdido",
};

export const PLANO_PT: Record<string, string> = {
  basic: "Básico",
  essencial: "Essencial",
  pro: "Pro",
};

/**
 * Motivos da central de vigia. O servidor já manda `motivoTexto` pronto — este
 * mapa é a rede para quando só o código estiver em mãos (o selo na lista de
 * dentistas, por exemplo).
 */
export const MOTIVO_ATENCAO_PT: Record<string, string> = {
  pediu_pessoa: "Pediu para falar com uma pessoa",
  irritado: "Parece irritado",
  julia_estranha: "A Júlia pode ter errado",
  sem_resposta: "Está sem resposta há mais de 15 min",
};

/** Versão curta, para caber no selo da linha da tabela. */
export const MOTIVO_ATENCAO_CURTO_PT: Record<string, string> = {
  pediu_pessoa: "Quer falar com você",
  irritado: "Irritado",
  julia_estranha: "Júlia estranha",
  sem_resposta: "Sem resposta",
};

/**
 * PROSPECÇÃO (Etapa 3B). Os 9 estados de `clinicas_prospect.status_prospeccao`
 * — o caminho da clínica captada no Maps até virar (ou não) lead.
 *
 * "Sem telefone" e "Telefone inválido" são separados porque medem coisas
 * diferentes: um é buraco no dado do Google, o outro é a nossa normalização
 * recusando. Juntar os dois na tela apagaria justamente essa diferença.
 */
export const PROSPECCAO_PT: Record<string, string> = {
  novo: "Novo",
  sem_telefone: "Sem telefone",
  telefone_invalido: "Telefone inválido",
  sem_whatsapp: "Sem WhatsApp",
  apto: "Apto",
  na_fila: "Na fila",
  promovido: "Promovido",
  ja_existente: "Já é lead",
  descartado: "Descartado",
};

export const SITUACAO_FOLLOWUP_PT: Record<string, string> = {
  pending: "Agendado",
  sent: "Enviado",
  cancelled: "Cancelado",
};

export const rotuloStatus = (v: string | null | undefined): string =>
  (v && STATUS_PT[v]) || v || "—";

export const rotuloEtapa = (v: string | null | undefined): string =>
  (v && ETAPA_PT[v]) || v || "—";

export const rotuloPlano = (v: string | null | undefined): string =>
  (v && PLANO_PT[v]) || v || "—";

export const rotuloFollowUp = (v: string | null | undefined): string =>
  (v && SITUACAO_FOLLOWUP_PT[v]) || v || "—";

export const rotuloProspeccao = (v: string | null | undefined): string =>
  (v && PROSPECCAO_PT[v]) || v || "—";

export const rotuloAtencao = (v: string | null | undefined): string =>
  (v && MOTIVO_ATENCAO_PT[v]) || v || "—";

export const rotuloAtencaoCurto = (v: string | null | undefined): string =>
  (v && MOTIVO_ATENCAO_CURTO_PT[v]) || v || "—";
