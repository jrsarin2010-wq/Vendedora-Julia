/**
 * O QUE A LANDING NÃO RESPONDE — cliente da rota de assuntos.
 *
 * Escrito à mão pelo mesmo motivo do atencao-api: é rota de operação do painel,
 * fora do contrato OpenAPI dos dados, então não passa pelos hooks gerados.
 */

export interface AssuntoDaLanding {
  /** O assunto já normalizado pelo servidor ("recarga de conversas"). */
  assunto: string;
  total: number;
}

export interface RespostaDeDuvidas {
  /** Do mais frequente para o menos. */
  assuntos: AssuntoDaLanding[];
  /** Quantas dúvidas foram registradas ao todo. */
  total: number;
}

export async function listarDuvidasDoSite(): Promise<RespostaDeDuvidas> {
  const res = await fetch("/api/stats/duvidas-do-site", { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Não consegui carregar as dúvidas da landing (HTTP ${res.status})`);
  }
  return (await res.json()) as RespostaDeDuvidas;
}
