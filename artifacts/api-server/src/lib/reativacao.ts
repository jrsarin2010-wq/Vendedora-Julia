/**
 * REATIVAÇÃO DE LONGO PRAZO (Rodada 41) — quem entra na fila longa e quando
 * cada toque pode sair.
 *
 * Arquivo só de DECISÃO, sem banco e sem rede, no mesmo espírito do outreach.ts.
 * Os textos moram em julia-persona.ts (TOQUES_REATIVACAO); quem agenda e envia
 * é o follow-up-scheduler.
 */
import { momentoEmSaoPaulo } from "./outreach";

/**
 * No máximo 10 reativações por dia, independente de quantas vencerem.
 * Reativação em bloco é assinatura de robô — e quem está nesta fila ficou 30
 * dias sem notícia nossa, o pior público para receber disparo em massa.
 */
export const LIMITE_REATIVACOES_POR_DIA = 10;

/** O que a decisão precisa saber de um lead. O scheduler passa o lead inteiro. */
export interface LeadParaReativar {
  status: string;
  atencao?: string | null;
}

export type MotivoForaDaReativacao =
  | "opt_out"
  | "ja_cliente"
  | "nunca_esquentou"
  | "na_vigia";

export const EXPLICACAO_FORA: Record<MotivoForaDaReativacao, string> = {
  opt_out: 'Lead "lost": pediu para parar, e isso não expira.',
  ja_cliente: 'Lead "closed": virou cliente, não se vende de novo.',
  nunca_esquentou:
    "Lead frio: nunca demonstrou nada — reativar quem nunca esquentou é spam.",
  na_vigia:
    "Lead marcado na central de vigia sem resolução: é caso de gente, não de robô.",
};

export interface Elegibilidade {
  elegivel: boolean;
  motivo?: MotivoForaDaReativacao;
}

/**
 * Este lead entra na fila de reativação?
 *
 * QUEM ENTRA: warm ou hot que não fechou (com a Rodada 41, warm/hot significam
 * temperatura morno/quente+ — status é derivado da pontuação). QUEM NÃO ENTRA,
 * NUNCA: opt-out, cliente, quem nunca esquentou e quem está na vigia.
 *
 * Checada duas vezes de propósito, como a trava do "lost" na prospecção: na
 * hora de ARMAR a fila e de novo na hora de ENVIAR cada toque — em 30 dias o
 * lead pode ter virado cliente, pedido para parar ou caído na vigia.
 */
export function elegivelParaReativacao(lead: LeadParaReativar): Elegibilidade {
  if (lead.status === "lost") return { elegivel: false, motivo: "opt_out" };
  if (lead.status === "closed") return { elegivel: false, motivo: "ja_cliente" };
  if (lead.status !== "warm" && lead.status !== "hot") {
    return { elegivel: false, motivo: "nunca_esquentou" };
  }
  if (lead.atencao) return { elegivel: false, motivo: "na_vigia" };
  return { elegivel: true };
}

/**
 * A novidade que dá motivo ao toque 2. Lida do ambiente A CADA chamada (mesmo
 * padrão do lerConfig): o Dr. Sarinho configura no painel do Railway sem
 * redeploy, e o teste liga e desliga sem recarregar nada.
 */
export function lerNovidade(): string {
  return (process.env.REATIVACAO_NOVIDADE ?? "").trim();
}

export interface DecisaoDeToque {
  envia: boolean;
  /** true = o toque morre (cancelled); false = só não sai agora. */
  cancela?: boolean;
  motivo?: string;
}

/**
 * Este toque de reativação pode sair AGORA, para ESTE lead?
 *
 * Os cortes são todos CANCELAMENTO, não adiamento: quem saiu da elegibilidade
 * depois de 30 dias não volta a ser elegível esperando mais um ciclo — e o
 * toque 2 sem novidade não ganha motivo novo cinco minutos depois.
 *
 * As escadas de exigência (+60 só morno ou mais, +90 só quente ou mais) vêm da
 * regra da rodada: quanto mais fundo na fila longa, mais interesse o lead
 * precisa ter demonstrado para justificar mais um toque.
 */
export function decidirToqueDeReativacao(
  touchNumber: number,
  lead: LeadParaReativar,
  novidade: string,
): DecisaoDeToque {
  const { elegivel, motivo } = elegivelParaReativacao(lead);
  if (!elegivel) return { envia: false, cancela: true, motivo };

  // Toque 2 (+60): só com novidade REAL configurada. Sem novidade não há
  // motivo para voltar — e voltar sem motivo é o que faz o dentista bloquear.
  if (touchNumber === 2 && !novidade) {
    return { envia: false, cancela: true, motivo: "sem_novidade" };
  }

  // Toque 3 (+90): só para quem está quente ou mais. (O toque 2 exige morno ou
  // mais, o que a elegibilidade acima já garante.)
  if (touchNumber === 3 && lead.status !== "hot") {
    return { envia: false, cancela: true, motivo: "so_quente_recebe_o_terceiro" };
  }

  return { envia: true };
}

/**
 * Quantas reativações JÁ saíram no dia de hoje (dia de São Paulo, como todo o
 * ritmo da prospecção). Recebe os carimbos prontos para não depender do banco.
 */
export function contarReativacoesDeHoje(
  sentAts: (Date | string | null | undefined)[],
  agora: Date,
): number {
  const hoje = momentoEmSaoPaulo(agora).dia;
  let total = 0;
  for (const carimbo of sentAts) {
    if (!carimbo) continue;
    const quando = new Date(carimbo);
    if (quando.getTime() > agora.getTime()) continue; // futuro: lixo, ignora
    if (momentoEmSaoPaulo(quando).dia === hoje) total++;
  }
  return total;
}
