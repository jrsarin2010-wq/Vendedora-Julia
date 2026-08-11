/**
 * CENTRAL DE VIGIA — cliente das rotas de atenção.
 *
 * Escrito à mão pelo mesmo motivo do import-api e do auth-api: são rotas de
 * operação do painel, fora do contrato OpenAPI dos dados, então não passam pelos
 * hooks gerados.
 *
 * Um efeito colateral útil: como o `Lead` gerado não conhece o campo `atencao`,
 * é ESTA lista que alimenta o selo na lista de dentistas e o aviso no detalhe.
 * Uma consulta serve as três telas.
 */

export interface ItemDeAtencao {
  id: number;
  name: string | null;
  phone: string;
  /** Link wa.me pronto — é pelo WhatsApp que ele responde, não pelo painel. */
  whatsapp: string;
  motivo: string;
  /** O motivo já em português, vindo do servidor. */
  motivoTexto: string;
  detalhe: string | null;
  desde: string | null;
  painPoints: string | null;
}

export interface RespostaDeAtencao {
  itens: ItemDeAtencao[];
  total: number;
}

/** Quem precisa de você agora, mais antigo primeiro. */
export async function listarAtencao(): Promise<RespostaDeAtencao> {
  const res = await fetch("/api/atencao", { credentials: "include" });
  if (!res.ok) throw new Error(`Não consegui carregar os avisos (HTTP ${res.status})`);
  return (await res.json()) as RespostaDeAtencao;
}

/** O botão "Já cuidei disso". Idempotente: dois cliques não dão erro. */
export async function resolverAtencao(leadId: number): Promise<{ resolvido: boolean }> {
  const res = await fetch(`/api/leads/${leadId}/atencao/resolver`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Não consegui resolver (HTTP ${res.status})`);
  return (await res.json()) as { resolvido: boolean };
}
