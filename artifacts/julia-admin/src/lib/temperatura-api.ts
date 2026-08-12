/**
 * TEMPERATURA (Rodada 41) — cliente das rotas de leitura do funil.
 *
 * Escrito à mão pelo mesmo motivo do atencao-api: são rotas de operação do
 * painel, fora do contrato OpenAPI dos dados, então não passam pelos hooks
 * gerados.
 */

export interface ContagemPorFaixa {
  frio: number;
  morno: number;
  quente: number;
  fervendo: number;
}

/** Quantos leads em cada faixa de temperatura (cliente e perdido ficam fora). */
export async function listarTemperatura(): Promise<ContagemPorFaixa> {
  const res = await fetch("/api/stats/temperatura", { credentials: "include" });
  if (!res.ok) throw new Error(`Não consegui carregar a temperatura (HTTP ${res.status})`);
  return (await res.json()) as ContagemPorFaixa;
}

export interface ItemEmReativacao {
  id: number;
  name: string | null;
  phone: string;
  /** 1, 2 ou 3 — qual toque da fila longa é o próximo. */
  proximoToque: number;
  /** Quando o próximo toque vence (ISO). */
  agendadoPara: string;
}

export interface RespostaDeReativacao {
  itens: ItemEmReativacao[];
  total: number;
}

/** Quem está na fila longa de reativação (+30/+60/+90 dias). */
export async function listarReativacao(): Promise<RespostaDeReativacao> {
  const res = await fetch("/api/stats/reativacao", { credentials: "include" });
  if (!res.ok) throw new Error(`Não consegui carregar a reativação (HTTP ${res.status})`);
  return (await res.json()) as RespostaDeReativacao;
}
