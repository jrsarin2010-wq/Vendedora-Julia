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
  /** Nulo enquanto NINGUÉM foi verificado — 0 leria como "nenhuma tem". */
  comWhatsapp: number | null;
  total: number;
}

export async function obterResumoDeProspects(): Promise<ResumoDeProspects> {
  const res = await fetch("/api/prospects/resumo", { credentials: "include" });
  return lerJson<ResumoDeProspects>(res, "carregar o resumo das clínicas");
}
