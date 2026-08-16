/**
 * PROSPECÇÃO — cliente das rotas de varredura e das clínicas captadas.
 *
 * Escrito à mão pelo mesmo motivo do atencao-api e do import-api: são rotas de
 * OPERAÇÃO do painel, fora do contrato OpenAPI dos dados, então não passam
 * pelos hooks gerados pelo orval.
 *
 * Os tipos abaixo são declarados POR INTEIRO, de propósito. Na lista de
 * dentistas há campos lidos com `(lead as { temperatura?: number })` porque o
 * tipo gerado não os conhece — cast que o compilador não confere e que já
 * ficou desatualizado uma vez. Aqui o tipo é a fonte, e o servidor devolve a
 * linha inteira: se um campo mudar de nome, a tela quebra no `tsc`, não na
 * frente do Dr. Sarinho.
 *
 * Colunas `numeric` do Postgres chegam como STRING (nota, latitude), e é assim
 * que estão tipadas — arredondar no lugar errado é como "4.7" vira "5".
 */

// ---------------------------------------------------------------------------
// Controle da varredura
// ---------------------------------------------------------------------------

export interface ContagemDaFila {
  pendente: number;
  executando: number;
  concluida: number;
  falhou: number;
  cancelada: number;
}

export interface UltimaVarredura {
  termo: string;
  cidade: string;
  uf: string;
  concluidaEm: string | null;
}

export interface StatusDaVarredura {
  /** O botão do painel (chave `varredura_ativa` no banco). */
  ativa: boolean;
  /**
   * A variável `APIFY_SWEEP_ENABLED` do Railway. Falsa aqui significa que o
   * botão não adianta: o worker nem chega a olhar o banco.
   */
  interruptorGeral: boolean;
  /** O worker parou sozinho por erro NOSSO (credencial, infra). */
  pausadaPorErro: boolean;
  motivoPausa: string | null;
  fila: ContagemDaFila;
  gastoMesUsd: number;
  tetoUsd: number;
  /** Rodadas nas últimas 24h — janela deslizante, igual à cota do worker. */
  rodadasHoje: number;
  tetoDiario: number;
  ultimaVarredura: UltimaVarredura | null;
}

async function lerJson<T>(res: Response, oQue: string): Promise<T> {
  if (!res.ok) throw new Error(`Não consegui ${oQue} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export async function obterStatusDaVarredura(): Promise<StatusDaVarredura> {
  const res = await fetch("/api/varreduras/status", { credentials: "include" });
  return lerJson<StatusDaVarredura>(res, "carregar o status da varredura");
}

/** O botão. Devolve o status já atualizado, para a tela não precisar reconsultar. */
export async function definirVarreduraAtiva(
  ativa: boolean,
): Promise<StatusDaVarredura> {
  const res = await fetch("/api/varreduras/ativa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ativa }),
  });
  return lerJson<StatusDaVarredura>(
    res,
    ativa ? "ligar a varredura" : "desligar a varredura",
  );
}

// ---------------------------------------------------------------------------
// Verificação de WhatsApp (Etapa 3A)
// ---------------------------------------------------------------------------

export interface StatusDaVerificacao {
  /** O botão do painel (chave `verificacao_ativa` no banco). */
  ativa: boolean;
  /**
   * A variável `VERIFICACAO_ENABLED` do Railway. Falsa aqui significa que o
   * botão não adianta: o worker nem chega a olhar o banco.
   */
  interruptorGeral: boolean;
  /** O worker parou sozinho: a Evolution não deu veredito nenhum. */
  pausadaPorErro: boolean;
  motivoPausa: string | null;
  /** Em `novo` COM telefone do Maps — exatamente quem o worker pegaria. */
  aVerificar: number;
  /**
   * Janela DESLIZANTE de 24h, não "desde a meia-noite". É a mesma conta que
   * trava o worker — por isso a tela diz "em 24h" e não "hoje".
   */
  verificadosNa24h: number;
  tetoDiario: number;
  tamanhoDoLote: number;
}

export async function obterStatusDaVerificacao(): Promise<StatusDaVerificacao> {
  const res = await fetch("/api/verificacao/status", { credentials: "include" });
  return lerJson<StatusDaVerificacao>(res, "carregar o status da verificação");
}

/** O botão. Devolve o status já atualizado, como o da varredura. */
export async function definirVerificacaoAtiva(
  ativa: boolean,
): Promise<StatusDaVerificacao> {
  const res = await fetch("/api/verificacao/ativa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ativa }),
  });
  return lerJson<StatusDaVerificacao>(
    res,
    ativa ? "ligar a verificação" : "desligar a verificação",
  );
}

// ---------------------------------------------------------------------------
// Abordagem (Etapa 4) — o interruptor que fica no Painel
// ---------------------------------------------------------------------------

export interface StatusDaAbordagem {
  /** O botão do painel (chave `outreach_ativo` no banco). */
  ativo: boolean;
  /**
   * A variável `OUTREACH_ENABLED` do Railway. Falsa aqui significa que o botão
   * não adianta: o agendador nem chega a olhar o banco.
   */
  interruptorGeral: boolean;
  /** Dia útil E dentro do horário comercial, no fuso de São Paulo. */
  dentroDaJanela: boolean;
  janela: { inicio: number; fim: number };
  /** Esperando a primeira mensagem — já descontado quem virou opt-out. */
  naFila: number;
  /** Janela DESLIZANTE de 24h, não "desde a meia-noite". */
  abordadosNas24h: number;
  /** Recebeu a abordagem e nunca respondeu nada. */
  aguardandoResposta: number;
  /**
   * Minutos até a próxima mensagem poder sair. `0` quer dizer "no próximo
   * ciclo" (um minuto), não "agora". Nulo quando não há previsão honesta a
   * dar: desligada, fila vazia, fora da janela ou cota estourada.
   */
  proximoEnvioEm: number | null;
}

export async function obterStatusDaAbordagem(): Promise<StatusDaAbordagem> {
  const res = await fetch("/api/outreach/status", { credentials: "include" });
  return lerJson<StatusDaAbordagem>(res, "carregar o estado da abordagem");
}

/** O botão. Devolve o status já atualizado, como os outros dois. */
export async function definirAbordagemAtiva(
  ativo: boolean,
): Promise<StatusDaAbordagem> {
  const res = await fetch("/api/outreach/ativo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ativo }),
  });
  return lerJson<StatusDaAbordagem>(
    res,
    ativo ? "ligar a abordagem" : "pausar a abordagem",
  );
}

// ---------------------------------------------------------------------------
// Clínicas captadas
// ---------------------------------------------------------------------------

/** Os 9 estados do enum `prospeccao_status` do banco. */
export type StatusProspeccao =
  | "novo"
  | "sem_telefone"
  | "telefone_invalido"
  | "sem_whatsapp"
  | "apto"
  | "na_fila"
  | "promovido"
  | "ja_existente"
  | "descartado";

export interface ClinicaProspect {
  id: number;
  placeId: string;
  nome: string;
  /** Como veio do Maps, intocado. */
  telefoneRaw: string | null;
  /** Dígitos com 55, sem "+", no mesmo formato de `leads.phone`. */
  telefoneWhatsapp: string | null;
  /** Nulo = ainda não verificado. NÃO é o mesmo que "não tem". */
  temWhatsapp: boolean | null;
  verificadoWhatsappEm: string | null;
  website: string | null;
  instagram: string | null;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  categoria: string | null;
  bairro: string | null;
  /** Ficha do Google assumida por alguém. Nulo = o ator não informou. */
  perfilReivindicado: boolean | null;
  nota: string | null;
  totalAvaliacoes: number | null;
  latitude: string | null;
  longitude: string | null;
  varreduraId: number | null;
  leadId: number | null;
  statusProspeccao: StatusProspeccao;
  criadoEm: string;
  atualizadoEm: string;
}

export interface FiltrosDeProspects {
  status?: StatusProspeccao | null;
  uf?: string | null;
  cidade?: string | null;
  busca?: string | null;
  limite?: number;
  offset?: number;
}

export interface RespostaDeProspects {
  itens: ClinicaProspect[];
  /** Total do RESULTADO FILTRADO — é o que diz se existe próxima página. */
  total: number;
  limite: number;
  offset: number;
}

export async function listarProspects(
  filtros: FiltrosDeProspects = {},
): Promise<RespostaDeProspects> {
  const params = new URLSearchParams();
  if (filtros.status) params.set("status", filtros.status);
  if (filtros.uf) params.set("uf", filtros.uf);
  if (filtros.cidade) params.set("cidade", filtros.cidade);
  if (filtros.busca) params.set("busca", filtros.busca);
  if (filtros.limite !== undefined) params.set("limite", String(filtros.limite));
  if (filtros.offset !== undefined) params.set("offset", String(filtros.offset));

  const res = await fetch(`/api/prospects?${params.toString()}`, {
    credentials: "include",
  });
  return lerJson<RespostaDeProspects>(res, "carregar as clínicas");
}

export interface BairroContado {
  bairro: string;
  total: number;
}

export interface ResumoDeProspects {
  porStatus: Record<StatusProspeccao, number>;
  /** Do bairro mais concentrado para o menos. */
  porBairro: BairroContado[];
  comTelefone: number;
  /**
   * Os três números da taxa de aproveitamento da varredura.
   *
   * Os dois primeiros são nulos enquanto NINGUÉM foi verificado — 0 ali leria
   * como "conferimos e é isso". O terceiro é número desde o primeiro lote: a
   * recusa por telefone inválido é nossa, decidida sem perguntar nada à
   * Evolution.
   */
  comWhatsapp: number | null;
  semWhatsapp: number | null;
  telefoneInvalido: number;
  total: number;
  /**
   * A trava da prospecção ativa, JÁ COMBINADA (Etapa 4): a `OUTREACH_ENABLED`
   * do Railway E o botão da abordagem no Painel. Verdadeira só com as duas.
   *
   * Está aqui porque é ao lado do botão "Promover" que ela decide o significado
   * do clique: desligada, promover só cria o dentista; ligada, põe ele na fila
   * e a Júlia escreve. Duas ações diferentes, o mesmo botão.
   */
  juliaLigada: boolean;
}

export async function obterResumoDeProspects(): Promise<ResumoDeProspects> {
  const res = await fetch("/api/prospects/resumo", { credentials: "include" });
  return lerJson<ResumoDeProspects>(res, "carregar o resumo das clínicas");
}

// ---------------------------------------------------------------------------
// Promoção a dentista (Etapa 3C)
// ---------------------------------------------------------------------------

/** Teto por chamada, repetido aqui só para o botão poder avisar antes. */
export const MAXIMO_POR_PROMOCAO = 50;

export interface ProspectPromovido {
  prospectId: number;
  nome: string;
  /** Nulo numa simulação: nada foi criado. */
  leadId: number | null;
}

export interface ProspectJaExistente extends ProspectPromovido {
  motivo: "duplicado" | "opt-out";
}

export interface ProspectSemLead {
  prospectId: number;
  nome: string;
}

export interface ProspectRecusado {
  prospectId: number;
  motivo: string;
}

export interface ResultadoDaPromocao {
  solicitados: number;
  modo: "simular" | "aplicar";
  promovidos: ProspectPromovido[];
  jaExistentes: ProspectJaExistente[];
  /** O número existia na verificação e não existe mais. */
  semWhatsapp: ProspectSemLead[];
  /** A Evolution não deu veredito: continuam aptas e voltam depois. */
  adiados: ProspectSemLead[];
  /** Lista recusada por inteiro (clínica fora de "apto"). Nada foi processado. */
  recusados: ProspectRecusado[];
}

/**
 * `modo: "aplicar"` cria dentista de verdade e — com a Júlia ligada — faz
 * mensagem sair. `"simular"` percorre as mesmas regras sem gravar nada.
 */
export async function promoverProspects(
  prospectIds: number[],
  modo: "simular" | "aplicar" = "aplicar",
): Promise<ResultadoDaPromocao> {
  const res = await fetch("/api/prospects/promover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ prospectIds, modo }),
  });

  // A recusa em bloco (409) traz o MOTIVO no corpo, e é a resposta mais útil
  // desta rota: "a lista tem clínica que não está apta" precisa chegar na tela
  // como frase, não como "HTTP 409".
  if (res.status === 409) {
    const corpo = (await res.json()) as ResultadoDaPromocao;
    const motivos = corpo.recusados
      .map((r) => `#${r.prospectId}: ${r.motivo}`)
      .join("; ");
    throw new Error(`Nada foi promovido — ${motivos}`);
  }
  return lerJson<ResultadoDaPromocao>(res, "promover as clínicas");
}
