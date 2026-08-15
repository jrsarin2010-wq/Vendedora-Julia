/**
 * PROSPECÇÃO ATIVA — regras de quem pode ser abordado e de quando pode sair.
 *
 * Este arquivo é só DECISÃO, sem banco e sem rede: tudo aqui é função pura,
 * para que as travas que protegem o número do Dr. Sarinho possam ser testadas
 * de verdade, sem depender de horário real nem de Postgres.
 *
 * Por que o ritmo é conservador: o Evolution é ferramenta não oficial. Volume
 * alto e cadência regular são o caminho mais rápido para o número ser banido —
 * e o número banido leva junto TODO o histórico de conversa com os dentistas.
 */

export const FUSO_SP = "America/Sao_Paulo";

export interface ConfigOutreach {
  habilitado: boolean;
  porHora: number;
  porDia: number;
  horaInicio: number;
  horaFim: number;
  soDiasUteis: boolean;
  intervaloMinimoSegundos: number;
}

function numeroDoAmbiente(chave: string, padrao: number): number {
  const bruto = process.env[chave];
  if (bruto === undefined || bruto.trim() === "") return padrao;
  const n = Number(bruto);
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

/**
 * Lê a configuração do ambiente A CADA chamada, e não uma vez no carregamento
 * do módulo. Assim o valor efetivo é sempre o que está no ambiente agora, e o
 * teste consegue ligar e desligar a trava sem recarregar nada.
 *
 * OUTREACH_ENABLED só é verdadeiro com o texto exato "true". Qualquer outra
 * coisa — vazio, "false", "1", lixo — mantém DESLIGADO. A trava mestra tem que
 * errar para o lado seguro.
 */
export function lerConfig(): ConfigOutreach {
  return {
    habilitado: (process.env.OUTREACH_ENABLED ?? "false").trim().toLowerCase() === "true",
    porHora: numeroDoAmbiente("OUTREACH_PER_HOUR", 8),
    porDia: numeroDoAmbiente("OUTREACH_PER_DAY", 40),
    horaInicio: numeroDoAmbiente("OUTREACH_START_HOUR", 9),
    horaFim: numeroDoAmbiente("OUTREACH_END_HOUR", 18),
    soDiasUteis: (process.env.OUTREACH_WEEKDAYS_ONLY ?? "true").trim().toLowerCase() !== "false",
    intervaloMinimoSegundos: numeroDoAmbiente("OUTREACH_MIN_GAP_SECONDS", 180),
  };
}

export interface MomentoSP {
  /** Hora do dia (0-23) no fuso de São Paulo. */
  hora: number;
  /** Data no formato AAAA-MM-DD, no fuso de São Paulo. */
  dia: string;
  /** true de segunda a sexta. */
  diaUtil: boolean;
}

/**
 * Traduz um instante para o fuso de São Paulo.
 *
 * O horário tem que ser o do dentista, não o do servidor: o Railway roda em
 * UTC, e sem isto a janela "9h às 18h" cairia às 6h da manhã no Brasil.
 */
export function momentoEmSaoPaulo(instante: Date): MomentoSP {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_SP,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
  }).formatToParts(instante);

  const pegar = (tipo: string): string =>
    partes.find((p) => p.type === tipo)?.value ?? "";

  // Em alguns ambientes a meia-noite volta como "24" em vez de "00".
  const hora = Number(pegar("hour")) % 24;
  const diaSemana = pegar("weekday");

  return {
    hora,
    dia: `${pegar("year")}-${pegar("month")}-${pegar("day")}`,
    diaUtil: !["Sat", "Sun"].includes(diaSemana),
  };
}

export type MotivoBloqueio =
  | "desligado"
  | "fim_de_semana"
  | "fora_da_janela"
  | "limite_hora"
  | "limite_dia"
  | "intervalo_minimo";

export const EXPLICACAO_BLOQUEIO: Record<MotivoBloqueio, string> = {
  desligado: "OUTREACH_ENABLED está desligado — nada dispara.",
  fim_de_semana: "Fim de semana: a Júlia não aborda ninguém.",
  fora_da_janela: "Fora do horário comercial configurado.",
  limite_hora: "Limite de mensagens desta hora já foi atingido.",
  limite_dia: "Limite de mensagens de hoje já foi atingido.",
  intervalo_minimo: "Ainda não passou o intervalo mínimo desde a última mensagem.",
};

export interface EstadoDeRitmo {
  config: ConfigOutreach;
  agora: Date;
  enviadosNaUltimaHora: number;
  enviadosHoje: number;
  ultimoEnvio: Date | null;
  /** Intervalo exigido AGORA, em segundos. Sorteado a cada ciclo. */
  intervaloExigidoSegundos: number;
}

export interface Decisao {
  pode: boolean;
  motivo?: MotivoBloqueio;
}

/**
 * Decide se uma mensagem de abordagem pode sair NESTE instante.
 *
 * A ordem das checagens importa para o diagnóstico: a primeira coisa
 * reportada deve ser a mais "de fora" possível, para o motivo mostrado no
 * painel ser o que o Dr. Sarinho precisa resolver primeiro.
 */
export function podeDispararAgora(estado: EstadoDeRitmo): Decisao {
  const { config } = estado;

  if (!config.habilitado) return { pode: false, motivo: "desligado" };

  const momento = momentoEmSaoPaulo(estado.agora);

  if (config.soDiasUteis && !momento.diaUtil) {
    return { pode: false, motivo: "fim_de_semana" };
  }
  // Janela fechada em baixo, aberta em cima: com 9 e 18, a última mensagem
  // pode sair 18:59. Passou das 18:59, para.
  if (momento.hora < config.horaInicio || momento.hora >= config.horaFim) {
    return { pode: false, motivo: "fora_da_janela" };
  }
  if (estado.enviadosNaUltimaHora >= config.porHora) {
    return { pode: false, motivo: "limite_hora" };
  }
  if (estado.enviadosHoje >= config.porDia) {
    return { pode: false, motivo: "limite_dia" };
  }
  if (estado.ultimoEnvio) {
    const segundosDesdeUltimo =
      (estado.agora.getTime() - estado.ultimoEnvio.getTime()) / 1000;
    if (segundosDesdeUltimo < estado.intervaloExigidoSegundos) {
      return { pode: false, motivo: "intervalo_minimo" };
    }
  }
  return { pode: true };
}

/**
 * Sorteia o intervalo exigido entre duas mensagens: entre o mínimo e o dobro
 * dele. Cadência exata é assinatura de robô — se sair uma mensagem a cada
 * 180 segundos cravados, qualquer antifraude do WhatsApp enxerga isso.
 */
export function sortearIntervalo(minimoSegundos: number): number {
  return minimoSegundos + Math.random() * minimoSegundos;
}

export interface LeadParaAbordar {
  status: string;
  outreachStatus: string;
  phone: string;
}

export type MotivoInelegivel =
  | "opt_out"
  | "ja_cliente"
  | "ja_abordado"
  | "cadencia_esgotada"
  | "nao_entregavel"
  | "nao_e_de_prospeccao";

export const EXPLICACAO_INELEGIVEL: Record<MotivoInelegivel, string> = {
  opt_out: 'Lead com status "lost": pediu para não receber mensagens.',
  ja_cliente: 'Lead com status "closed": já é cliente, não se vende de novo.',
  ja_abordado: "Este lead já recebeu a primeira mensagem.",
  cadencia_esgotada:
    "Recebeu a abordagem e os dois toques, e não respondeu nenhum. Não se procura mais.",
  nao_entregavel:
    "O número rejeitou três envios seguidos: sem WhatsApp, fixo ou digitado errado. Confira o telefone.",
  nao_e_de_prospeccao: "Lead não está na fila de prospecção (outreachStatus ≠ pending).",
};

export interface Elegibilidade {
  elegivel: boolean;
  motivo?: MotivoInelegivel;
}

/**
 * Este lead pode ser abordado?
 *
 * A trava do "lost" é a mais importante do arquivo: quem pediu para parar não
 * volta a ser incomodado, nem que reapareça numa planilha nova. Ela é checada
 * aqui E na hora de importar — de propósito, porque o status pode virar "lost"
 * DEPOIS da importação, com o lead já esperando na fila.
 */
export function leadElegivel(lead: LeadParaAbordar): Elegibilidade {
  if (lead.status === "lost") return { elegivel: false, motivo: "opt_out" };
  if (lead.status === "closed") return { elegivel: false, motivo: "ja_cliente" };
  // Antes do "sent" porque o motivo é mais específico e conta uma história
  // diferente: aqui não é "ainda vai responder", é "a cadência inteira saiu e
  // ele ficou calado". Sem esta linha ele cairia no genérico do final, e o
  // painel diria só "não está na fila".
  if (lead.outreachStatus === "nao_respondeu") {
    return { elegivel: false, motivo: "cadencia_esgotada" };
  }
  // Número que rejeitou três envios seguidos (lib/nao-entregavel.ts). Motivo
  // próprio porque a ação do painel é diferente: aqui não é "deixa quieto",
  // é "confira o telefone na planilha".
  if (lead.outreachStatus === "nao_entregavel") {
    return { elegivel: false, motivo: "nao_entregavel" };
  }
  if (lead.outreachStatus === "sent") return { elegivel: false, motivo: "ja_abordado" };
  if (lead.outreachStatus !== "pending") {
    return { elegivel: false, motivo: "nao_e_de_prospeccao" };
  }
  return { elegivel: true };
}

/**
 * Conta, a partir dos envios já feitos, quantos saíram na última hora e
 * quantos saíram hoje (dia de São Paulo). Recebe as datas prontas para não
 * depender do banco.
 */
export function contarEnvios(
  enviosAnteriores: Date[],
  agora: Date,
): { naUltimaHora: number; hoje: number; ultimo: Date | null } {
  const diaDeHoje = momentoEmSaoPaulo(agora).dia;
  const umaHoraAtras = agora.getTime() - 60 * 60 * 1000;

  let naUltimaHora = 0;
  let hoje = 0;
  let ultimo: Date | null = null;

  for (const envio of enviosAnteriores) {
    const t = envio.getTime();
    if (t > agora.getTime()) continue; // data no futuro: ignora
    if (t >= umaHoraAtras) naUltimaHora++;
    if (momentoEmSaoPaulo(envio).dia === diaDeHoje) hoje++;
    if (!ultimo || t > ultimo.getTime()) ultimo = envio;
  }

  return { naUltimaHora, hoje, ultimo };
}
