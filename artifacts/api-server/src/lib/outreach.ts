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
 * O RITMO PADRÃO — 15 por dia, 2 por hora, 20 minutos de intervalo mínimo.
 *
 * Era 40/8/180 até 19/08/2026. A decisão de reduzir é do dono, e o motivo é o
 * do cabeçalho deste arquivo: o Evolution é ferramenta não oficial, e a API
 * oficial da Meta está descartada — então o único jeito de baixar o risco de
 * banimento é mandar menos e mandar irregular.
 *
 * Por que os três números mudam JUNTOS, e não só a cota: com 2 por hora e o
 * intervalo velho de 180s, as duas mensagens da hora sairiam coladas (3 a 6
 * minutos entre si) e depois viriam 54 minutos de silêncio. Isso é a rajada
 * seguida de silêncio que o cabeçalho do agendador diz estar evitando — trocar
 * um padrão detectável por outro não é reduzir risco.
 *
 * 1200s de mínimo dá um sorteio real de 20 a 40 minutos (média 30), que
 * espalha as 15 mensagens pelas 9 horas da janela sem buraco nenhum. Nesse
 * ritmo o teto por hora vira ~3 naturalmente, e o `porHora` de 2 fica como
 * cinto de segurança — não como o que dita a cadência.
 *
 * Estes são os DEFAULTS do código, não a configuração viva: as três variáveis
 * de ambiente continuam mandando, e mudá-las no Railway pega no ciclo seguinte
 * (≤60s) sem deploy. O default existe para o ambiente que sobe sem elas — e é
 * por isso que ele tem que dizer a verdade do que foi decidido, senão o próximo
 * serviço novo nasce mandando 40 por dia sem ninguém ter pedido.
 */
const PADRAO_POR_HORA = 2;
const PADRAO_POR_DIA = 15;
const PADRAO_INTERVALO_MINIMO_SEGUNDOS = 1200;

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
    porHora: numeroDoAmbiente("OUTREACH_PER_HOUR", PADRAO_POR_HORA),
    porDia: numeroDoAmbiente("OUTREACH_PER_DAY", PADRAO_POR_DIA),
    horaInicio: numeroDoAmbiente("OUTREACH_START_HOUR", 9),
    horaFim: numeroDoAmbiente("OUTREACH_END_HOUR", 18),
    soDiasUteis: (process.env.OUTREACH_WEEKDAYS_ONLY ?? "true").trim().toLowerCase() !== "false",
    intervaloMinimoSegundos: numeroDoAmbiente(
      "OUTREACH_MIN_GAP_SECONDS",
      PADRAO_INTERVALO_MINIMO_SEGUNDOS,
    ),
  };
}

export interface MomentoSP {
  /** Hora do dia (0-23) no fuso de São Paulo. */
  hora: number;
  /**
   * Minuto da hora (0-59) no fuso de São Paulo.
   *
   * Só a largada do dia precisa dele (ver `atrasoDaLargada`): todas as outras
   * travas raciocinam em horas cheias.
   */
  minuto: number;
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
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(instante);

  const pegar = (tipo: string): string =>
    partes.find((p) => p.type === tipo)?.value ?? "";

  // Em alguns ambientes a meia-noite volta como "24" em vez de "00".
  const hora = Number(pegar("hour")) % 24;
  const diaSemana = pegar("weekday");

  return {
    hora,
    minuto: Number(pegar("minute")) % 60,
    dia: `${pegar("year")}-${pegar("month")}-${pegar("day")}`,
    diaUtil: !["Sat", "Sun"].includes(diaSemana),
  };
}

export type PeriodoDoDia = "manha" | "tarde" | "noite";

/**
 * De que período do dia é esta hora — o que decide entre bom dia, boa tarde e
 * boa noite.
 *
 * Existe porque a Júlia abre a mensagem fria pela saudação do horário, e o
 * horário que vale é o DELE: mesma razão do `momentoEmSaoPaulo`, que é de onde
 * a hora tem que vir. Um "bom dia" às quatro da tarde não é deslize de copy —
 * é a prova, na primeira palavra, de que ninguém olhou nada antes de mandar.
 *
 * Os cortes são os da fala comum, não os do relógio da janela de disparo (9h
 * às 18h): meio-dia vira tarde, e a noite começa às 18h — quem escreve às 18h
 * escreve "boa noite", ainda que o expediente conte aquilo como dia. Antes das
 * 5h é noite também: a madrugada não tem saudação própria em português, e
 * "bom dia" às 3h da manhã é pior que "boa noite".
 */
export function periodoDoDia(hora: number): PeriodoDoDia {
  if (hora >= 5 && hora < 12) return "manha";
  if (hora >= 12 && hora < 18) return "tarde";
  return "noite";
}

export type MotivoBloqueio =
  | "desligado"
  | "desligado_no_painel"
  | "fim_de_semana"
  | "fora_da_janela"
  | "largada_do_dia"
  | "limite_hora"
  | "limite_dia"
  | "intervalo_minimo";

export const EXPLICACAO_BLOQUEIO: Record<MotivoBloqueio, string> = {
  desligado: "OUTREACH_ENABLED está desligado — nada dispara.",
  /**
   * A segunda camada da trava (Etapa 4). `podeDispararAgora` NUNCA devolve
   * este motivo — ele mora no banco, e este arquivo não fala com banco. Quem o
   * produz é o agendador, depois de consultar a chave; a explicação está aqui
   * para o log e a tela lerem todos os bloqueios do mesmo lugar.
   */
  desligado_no_painel:
    "A abordagem está pausada no painel — ninguém novo é abordado. Conversas em andamento seguem normais.",
  fim_de_semana: "Fim de semana: a Júlia não aborda ninguém.",
  fora_da_janela: "Fora do horário comercial configurado.",
  largada_do_dia:
    "A janela já abriu, mas a largada de hoje foi sorteada para alguns minutos depois — começar 9h em ponto todo dia é assinatura de robô.",
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
 * A janela está fechada agora, e por quê? `null` quando está aberta.
 *
 * Existe separada de `podeDispararAgora` porque o painel precisa da resposta
 * SEM as outras travas no meio (Etapa 4): "ligada, mas fora do horário" é uma
 * frase diferente de "ligada e no limite da hora", e as duas viram `pode:
 * false` lá. Extraída em vez de reescrita na rota de propósito — duas contas
 * de horário que pudessem divergir é exatamente o tipo de mentira que o painel
 * não pode contar.
 */
/**
 * SÓ AS HORAS — sem o fim de semana, sem cota e sem o botão do painel.
 *
 * Existe para o follow-up de CONVERSA, que até 18/08/2026 não passava por
 * janela nenhuma: o `toqueFrioPodeSair` só era chamado no ramo da reativação e
 * no do toque frio, e ninguém tinha feito a mesma pergunta para a conversa. O
 * lead 59 recebeu o toque 2 à 01:28 da manhã, e é o tipo de mensagem que faz
 * um dentista bloquear o número — que é o mesmo número da prospecção.
 *
 * Por que NÃO reaproveita o `janelaFechada` inteiro: as outras três travas são
 * da prospecção e aqui estariam erradas.
 *  - o botão do painel governa quem ainda NÃO conversa; quem já conversa
 *    continua sendo atendido com ele desligado, e isso é regra testada;
 *  - a cota diária protege o número contra volume FRIO — o toque de uma
 *    conversa em andamento não é volume frio;
 *  - o fim de semana fica de fora por decisão: sábado às 10h não é o que faz
 *    bloquear, e segurar o toque até segunda tira dois dias de uma conversa
 *    viva. A madrugada é que era o problema, e é a madrugada que isto fecha.
 *    Se um dia o dono quiser o fim de semana também, é trocar esta função pelo
 *    `janelaFechada` — e aí o `soDiasUteis` já resolve.
 */
export function foraDoHorarioDeConversa(
  config: ConfigOutreach,
  agora: Date,
): boolean {
  const { hora } = momentoEmSaoPaulo(agora);
  return hora < config.horaInicio || hora >= config.horaFim;
}

export function janelaFechada(
  config: ConfigOutreach,
  agora: Date,
): "fim_de_semana" | "fora_da_janela" | null {
  const momento = momentoEmSaoPaulo(agora);

  if (config.soDiasUteis && !momento.diaUtil) return "fim_de_semana";
  // Janela fechada em baixo, aberta em cima: com 9 e 18, a última mensagem
  // pode sair 18:59. Passou das 18:59, para.
  if (momento.hora < config.horaInicio || momento.hora >= config.horaFim) {
    return "fora_da_janela";
  }
  return null;
}

/**
 * O ATRASO MÁXIMO DA LARGADA, em minutos. 45 sobre uma janela de 9 horas: o
 * bastante para o horário de início mudar de dia para dia, longe o bastante de
 * comer a janela.
 */
export const LARGADA_MAXIMA_MINUTOS = 45;

/**
 * Espalha os caracteres de um texto num inteiro sem sinal (FNV-1a). Não é
 * criptografia: é só o que transforma "2026-08-19" num número que não tem
 * relação óbvia com "2026-08-20".
 */
function embaralhar(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * QUANTOS MINUTOS DEPOIS DA ABERTURA A PRIMEIRA MENSAGEM DO DIA PODE SAIR.
 *
 * O defeito que isto conserta: à meia-noite o contador do dia zera e o último
 * envio já tem umas quinze horas, então o intervalo mínimo também já venceu.
 * Resultado — a primeira mensagem saía no primeiro ciclo depois das 9h, todo
 * dia útil, entre 09:00 e 09:01. Um número que começa a trabalhar no mesmo
 * minuto todo santo dia é um número que não é operado por gente.
 *
 * SORTEADO PELO DIA, e não por `Math.random()`. É o ponto inteiro da função, e
 * um `Math.random()` aqui não só seria pior — seria inútil: o ciclo roda a cada
 * 60 segundos, então em poucos minutos algum sorteio sairia baixo e a mensagem
 * iria embora de qualquer jeito. Só um valor ESTÁVEL dentro do dia atrasa a
 * largada de verdade.
 *
 * E derivado do DIA, não guardado em memória, para sobreviver a restart: um
 * deploy às 9h05 não pode redesenhar a largada e liberar o envio que o sorteio
 * de hoje tinha adiado — mesmo motivo pelo qual as cotas se contam no banco.
 */
export function atrasoDaLargada(dia: string): number {
  return embaralhar(dia) % (LARGADA_MAXIMA_MINUTOS + 1);
}

/**
 * Já passou a largada sorteada de hoje? Recebe o momento já traduzido para São
 * Paulo, e só faz sentido com a janela aberta — quem chama garante isso.
 */
function antesDaLargada(config: ConfigOutreach, momento: MomentoSP): boolean {
  const minutosDesdeAAbertura =
    (momento.hora - config.horaInicio) * 60 + momento.minuto;
  return minutosDesdeAAbertura < atrasoDaLargada(momento.dia);
}

/**
 * Decide se uma mensagem de abordagem pode sair NESTE instante.
 *
 * A ordem das checagens importa para o diagnóstico: a primeira coisa
 * reportada deve ser a mais "de fora" possível, para o motivo mostrado no
 * painel ser o que o Dr. Sarinho precisa resolver primeiro.
 *
 * A trava do painel (`outreach_ativo`) NÃO entra aqui: ela mora no banco, e
 * este arquivo é decisão pura. Quem a checa é o agendador, logo depois desta
 * função — ver `desligado_no_painel` em EXPLICACAO_BLOQUEIO.
 */
export function podeDispararAgora(estado: EstadoDeRitmo): Decisao {
  const { config } = estado;

  if (!config.habilitado) return { pode: false, motivo: "desligado" };

  const fechada = janelaFechada(config, estado.agora);
  if (fechada) return { pode: false, motivo: fechada };

  // A LARGADA DO DIA vem logo depois da janela, e SEPARADA dela de propósito.
  //
  // Podia ter entrado no `janelaFechada`, e seria menos código. Mas aquela
  // função também responde ao painel (`dentroDaJanela`), e às 9h10 a tela
  // passaria a dizer "fora do horário comercial" logo abaixo de "janela
  // 9h–18h" — uma contradição na mesma caixa. Aqui o painel continua dizendo a
  // verdade sobre a janela, e o bloqueio ganha a frase que explica o que está
  // de fato acontecendo.
  //
  // Fica fora do `foraDoHorarioDeConversa` pelo mesmo motivo das outras travas
  // frias: quem já respondeu não é volume frio, e adiar o toque dele por causa
  // de um sorteio de largada seria proteger o número às custas de uma conversa
  // viva.
  if (antesDaLargada(config, momentoEmSaoPaulo(estado.agora))) {
    return { pode: false, motivo: "largada_do_dia" };
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
 * 1200 segundos cravados, qualquer antifraude do WhatsApp enxerga isso.
 *
 * Vale para os DOIS agendadores desde 19/08/2026. O de follow-up usava o
 * mínimo cravado, com a justificativa de que o ciclo de 5 minutos já espaçava
 * mais que o dobro do mínimo — verdade quando o mínimo era 180s, mentira desde
 * que ele virou 1200s.
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
