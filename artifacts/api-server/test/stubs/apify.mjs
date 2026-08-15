/**
 * Stub da borda do Apify: nenhuma run é iniciada e nenhum crédito é gasto.
 * O teste programa as respostas e depois inspeciona o que teria sido pedido.
 */
export const apify = {
  /** O que `iniciarRun` devolve. */
  inicio: { ok: true, runId: "run-1", datasetId: "ds-1" },
  /** O que `consultarRun` devolve. */
  estado: {
    ok: true,
    situacao: "sucesso",
    statusCru: "SUCCEEDED",
    custoUsd: 0.075,
    campoDoCusto: "chargedTotalUsd",
    datasetId: "ds-1",
  },
  /** O que `baixarDataset` devolve. */
  dataset: { ok: true, itens: [] },

  /** Inputs enviados ao ator, na ordem. */
  disparos: [],
  /** Ids de run consultados. */
  consultas: [],
  /** Ids de dataset baixados. */
  downloads: [],

  reset() {
    this.disparos = [];
    this.consultas = [];
    this.downloads = [];
  },
};

export async function iniciarRun(input) {
  apify.disparos.push(input);
  return apify.inicio;
}

export async function consultarRun(runId) {
  apify.consultas.push(runId);
  return apify.estado;
}

export async function baixarDataset(datasetId) {
  apify.downloads.push(datasetId);
  return apify.dataset;
}
