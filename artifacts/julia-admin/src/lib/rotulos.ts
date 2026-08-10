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
