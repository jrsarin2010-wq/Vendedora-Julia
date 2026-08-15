/**
 * BORDA DO APIFY — só fala HTTP, não decide nada.
 *
 * A regra de negócio (quando disparar, quanto pode gastar, o que fazer de uma
 * falha) mora em lib/varredura.ts e no agendador. Aqui é a mesma divisão que
 * existe entre integrations.ts e o resto: assim o teste exercita a lógica de
 * verdade com esta camada trocada por stub.
 *
 * O token vai no cabeçalho `Authorization`, e NUNCA na query string. A API do
 * Apify aceita `?token=`, e é como a documentação mostra — mas aí o token
 * entraria em qualquer log de URL, inclusive nas mensagens de erro daqui. No
 * cabeçalho, um log de URL é inofensivo.
 */
import { logger } from "./logger";

/**
 * O ator calibrado. Na URL da API o "/" do id vira "~".
 *
 * É o `google-maps-extractor`, e não o `crawler-google-places` da spec
 * original: foi este que a calibração mediu (US$ 0,005 por lugar), e trocar de
 * ator invalidaria o preço medido.
 */
const ATOR = "compass~google-maps-extractor";

const BASE = "https://api.apify.com/v2";

/** Disparar e consultar são rápidos; baixar dataset pode arrastar um pouco. */
const TIMEOUT_MS = 30_000;

function tokenDoApify(): string {
  return process.env.APIFY_TOKEN ?? "";
}

function cabecalhos(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${tokenDoApify()}`,
  };
}

export interface InicioDeRun {
  ok: boolean;
  runId?: string;
  datasetId?: string;
  /** Descrição curta do que impediu, para gravar em `erro_mensagem`. */
  erro?: string;
}

/** Dispara uma run do ator. Nunca lança. */
export async function iniciarRun(input: unknown): Promise<InicioDeRun> {
  if (!tokenDoApify()) {
    logger.warn("APIFY_TOKEN não configurado — varredura não disparada");
    return { ok: false, erro: "APIFY_TOKEN ausente" };
  }

  try {
    const resposta = await fetch(`${BASE}/acts/${ATOR}/runs`, {
      method: "POST",
      headers: cabecalhos(),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      logger.error({ status: resposta.status, corpo }, "Apify recusou o início da run");
      return { ok: false, erro: `HTTP ${resposta.status}: ${corpo.slice(0, 300)}` };
    }

    const dados = (await resposta.json()) as {
      data?: { id?: string; defaultDatasetId?: string };
    };
    const runId = dados?.data?.id;
    if (!runId) {
      logger.error("Apify aceitou a run mas não devolveu id");
      return { ok: false, erro: "resposta sem id de run" };
    }
    return { ok: true, runId, datasetId: dados.data?.defaultDatasetId };
  } catch (err) {
    logger.error({ err }, "Falha ao iniciar run no Apify");
    return { ok: false, erro: err instanceof Error ? err.message : String(err) };
  }
}

/** Como o resto do sistema enxerga o estado de uma run. */
export type SituacaoDaRun = "rodando" | "sucesso" | "falha";

export interface EstadoDaRun {
  /** A CONSULTA funcionou? false = não sabemos nada sobre a run. */
  ok: boolean;
  situacao?: SituacaoDaRun;
  /** O status cru do Apify ("SUCCEEDED", "TIMED-OUT"...), para o log e o erro. */
  statusCru?: string;
  /** Custo cobrado, quando encontrado no objeto de run. */
  custoUsd: number | null;
  /** Qual campo trouxe o custo — é assim que se confirma o nome na primeira run real. */
  campoDoCusto: string | null;
  datasetId?: string;
  erro?: string;
}

/**
 * Onde procurar o valor cobrado, em ordem. A calibração viu US$ 0,025 no
 * cabeçalho do console, mas o nome do campo na API não foi confirmado — e num
 * ator pay-per-event o `usageTotalUsd` pode se referir só ao uso de
 * plataforma. Em vez de apostar num nome, tenta-se a lista e LOGA-SE qual
 * respondeu; a primeira run real confirma o nome definitivo.
 */
const CAMPOS_DE_CUSTO = [
  "chargedTotalUsd",
  "usageTotalUsd",
  "pricingInfo.totalChargeUsd",
  "stats.chargedTotalUsd",
] as const;

/** Lê um caminho tipo "a.b.c" e devolve o número, se for número. */
function numeroEm(objeto: unknown, caminho: string): number | null {
  let atual: unknown = objeto;
  for (const parte of caminho.split(".")) {
    if (typeof atual !== "object" || atual === null) return null;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return typeof atual === "number" && Number.isFinite(atual) ? atual : null;
}

export function custoDaRun(dados: unknown): { valor: number | null; campo: string | null } {
  for (const campo of CAMPOS_DE_CUSTO) {
    const valor = numeroEm(dados, campo);
    if (valor !== null) return { valor, campo };
  }
  return { valor: null, campo: null };
}

/** Traduz o status do Apify para as três situações que nos interessam. */
function situacaoDe(status: string): SituacaoDaRun {
  if (status === "SUCCEEDED") return "sucesso";
  // READY (na fila), RUNNING e ABORTING ainda podem virar qualquer coisa.
  if (status === "READY" || status === "RUNNING" || status === "ABORTING") return "rodando";
  // FAILED, ABORTED, TIMED-OUT e qualquer status novo que apareça.
  return "falha";
}

/** Pergunta ao Apify como está uma run. Nunca lança. */
export async function consultarRun(runId: string): Promise<EstadoDaRun> {
  if (!tokenDoApify()) {
    return { ok: false, custoUsd: null, campoDoCusto: null, erro: "APIFY_TOKEN ausente" };
  }

  try {
    const resposta = await fetch(`${BASE}/actor-runs/${runId}`, {
      method: "GET",
      headers: cabecalhos(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      logger.error(
        { status: resposta.status, runId, corpo },
        "Apify recusou a consulta da run",
      );
      return {
        ok: false,
        custoUsd: null,
        campoDoCusto: null,
        erro: `HTTP ${resposta.status}`,
      };
    }

    const corpo = (await resposta.json()) as {
      data?: { status?: string; defaultDatasetId?: string };
    };
    const status = corpo?.data?.status;
    if (typeof status !== "string") {
      return {
        ok: false,
        custoUsd: null,
        campoDoCusto: null,
        erro: "resposta sem status",
      };
    }

    const { valor, campo } = custoDaRun(corpo.data);
    return {
      ok: true,
      situacao: situacaoDe(status),
      statusCru: status,
      custoUsd: valor,
      campoDoCusto: campo,
      datasetId: corpo.data?.defaultDatasetId,
    };
  } catch (err) {
    logger.error({ err, runId }, "Falha ao consultar run no Apify");
    return {
      ok: false,
      custoUsd: null,
      campoDoCusto: null,
      erro: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface DatasetBaixado {
  ok: boolean;
  itens: unknown[];
  erro?: string;
}

/** Baixa os itens do dataset de uma run. Nunca lança. */
export async function baixarDataset(datasetId: string): Promise<DatasetBaixado> {
  if (!tokenDoApify()) {
    return { ok: false, itens: [], erro: "APIFY_TOKEN ausente" };
  }

  try {
    const resposta = await fetch(`${BASE}/datasets/${datasetId}/items?clean=true&format=json`, {
      method: "GET",
      headers: cabecalhos(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      logger.error(
        { status: resposta.status, datasetId, corpo },
        "Apify recusou o download do dataset",
      );
      return { ok: false, itens: [], erro: `HTTP ${resposta.status}` };
    }

    const itens = (await resposta.json()) as unknown;
    if (!Array.isArray(itens)) {
      logger.error({ datasetId }, "Dataset do Apify não veio como lista");
      return { ok: false, itens: [], erro: "dataset não é lista" };
    }
    return { ok: true, itens };
  } catch (err) {
    logger.error({ err, datasetId }, "Falha ao baixar dataset do Apify");
    return { ok: false, itens: [], erro: err instanceof Error ? err.message : String(err) };
  }
}
