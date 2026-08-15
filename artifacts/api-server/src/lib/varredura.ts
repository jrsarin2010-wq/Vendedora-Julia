/**
 * REGRAS DA VARREDURA — as decisões, sem banco e sem rede.
 *
 * Mesma divisão de outreach.ts / outreach-scheduler.ts: aqui mora o que dá
 * para testar com uma chamada de função, e o agendador só orquestra.
 */
import type { clinicasProspectTable, ApifyVarredura } from "@workspace/db";
import { normalizarTelefone } from "./filtro-spam";

/**
 * Preço por lugar raspado, MEDIDO na calibração (5 lugares = US$ 0,025) no
 * plano Free do ator compass/google-maps-extractor. Não é estimativa.
 */
export const USD_POR_LUGAR = 0.005;

/**
 * Teto de gasto no mês. O crédito Free é US$ 5,00 e as 54 rodadas de 15
 * resultados custam US$ 4,05 — a folga entre 4,05 e 4,50 é a margem de erro da
 * nossa contagem, e a folga entre 4,50 e 5,00 é o que sobra se tudo der errado.
 */
export const TETO_MENSAL_USD = 4.5;

/** Quantas rodadas podem ser disparadas em 24h. */
export const MAXIMO_RODADAS_POR_DIA = 10;

/** Falhas seguidas antes de desistir de uma combinação. */
export const LIMITE_DE_TENTATIVAS = 3;

/** Run que passa disso sem terminar é considerada pendurada. */
export const TEMPO_MAXIMO_DA_RUN_MS = 30 * 60 * 1000;

/**
 * Teto de cobrança imposto pelo PRÓPRIO Apify em cada run. É a segunda trava:
 * a nossa contabilidade decide se dispara, e esta garante o limite mesmo se a
 * nossa conta estiver errada.
 *
 * É 0,50 porque o ator declara `minimalMaxTotalChargeUsd: 0.5` — o valor
 * MÍNIMO aceito neste parâmetro. Pedir 0,10 seria mais apertado no papel, mas
 * corre o risco de o Apify recusar a run inteira, e uma rodada que nem começa
 * é pior que um teto folgado.
 *
 * Folgado sem ser perigoso: isto é TETO, não gasto. Uma rodada de 15 lugares
 * custa US$ 0,075, então o limite só encostaria se o ator raspasse ~100
 * lugares — o que `maxCrawledPlacesPerSearch` já impede. Ele existe para o
 * caso de tudo o mais falhar ao mesmo tempo.
 */
export const MAX_TOTAL_CHARGE_USD = 0.5;

/** Idioma pedido ao ator. */
const IDIOMA = "pt-BR";

export interface ConfigDeVarredura {
  habilitado: boolean;
}

/**
 * Lida a CADA chamada, como o resto do repo: assim o valor efetivo é o que
 * está no ambiente agora, e o teste liga e desliga sem recarregar módulo.
 *
 * Nasce DESLIGADA. Um deploy não pode começar a gastar crédito sozinho.
 */
export function lerConfigDeVarredura(): ConfigDeVarredura {
  return { habilitado: process.env.APIFY_SWEEP_ENABLED === "true" };
}

/** Quanto se espera gastar numa rodada de N resultados. */
export function custoPrevisto(maxResultados: number): number {
  return Math.round(maxResultados * USD_POR_LUGAR * 10_000) / 10_000;
}

export interface EntradaDoOrcamento {
  /** Soma de custo_real_usd das rodadas concluídas no mês corrente. */
  gastoNoMes: number;
  /**
   * Resultados que já foram pedidos e ainda não voltaram. O custo real só
   * aparece quando a run termina; sem reservar o que está em voo, o worker
   * dispararia às cegas contra crédito já comprometido.
   */
  resultadosEmVoo: number;
  /** Tamanho da rodada que se quer disparar agora. */
  maxResultados: number;
}

export interface DecisaoDeOrcamento {
  pode: boolean;
  previsto: number;
  reservaEmVoo: number;
  /** Total comprometido se esta rodada for disparada. */
  comprometido: number;
}

/**
 * Arredonda para os 4 decimais da coluna `custo_real_usd`.
 *
 * Não é preciosismo: 15 × 0,005 dá 0,07500000000000001 em ponto flutuante, e
 * sem arredondar um gasto que fecha EXATAMENTE no teto seria recusado por um
 * centésimo de milésimo de dólar que não existe.
 */
export function arredondarUsd(valor: number): number {
  return Math.round(valor * 10_000) / 10_000;
}

export function calcularOrcamento(entrada: EntradaDoOrcamento): DecisaoDeOrcamento {
  const reservaEmVoo = arredondarUsd(entrada.resultadosEmVoo * USD_POR_LUGAR);
  const previsto = custoPrevisto(entrada.maxResultados);
  const comprometido = arredondarUsd(entrada.gastoNoMes + reservaEmVoo + previsto);
  return {
    pode: comprometido <= TETO_MENSAL_USD,
    previsto,
    reservaEmVoo,
    comprometido,
  };
}

/** O input do ator, com os nomes de campo confirmados na calibração. */
export function inputDoAtor(varredura: {
  termoBusca: string;
  cidade: string;
  uf: string;
  maxResultados: number;
}): Record<string, unknown> {
  return {
    searchStringsArray: [varredura.termoBusca],
    locationQuery: `${varredura.cidade}, ${varredura.uf}, Brazil`,
    maxCrawledPlacesPerSearch: varredura.maxResultados,
    language: IDIOMA,
    maxTotalChargeUsd: MAX_TOTAL_CHARGE_USD,
    // Nenhum add-on: no plano Free, enriquecimento de redes e verificação de
    // e-mail custam US$ 100/mil — 20× o dado base.
  };
}

/** O item cru do dataset, com os campos que a calibração confirmou existirem. */
export interface ItemDoMaps {
  placeId?: unknown;
  title?: unknown;
  phoneUnformatted?: unknown;
  website?: unknown;
  address?: unknown;
  city?: unknown;
  neighborhood?: unknown;
  postalCode?: unknown;
  categoryName?: unknown;
  totalScore?: unknown;
  reviewsCount?: unknown;
  location?: { lat?: unknown; lng?: unknown } | null;
  permanentlyClosed?: unknown;
  temporarilyClosed?: unknown;
  isAdvertisement?: unknown;
  claimThisBusiness?: unknown;
  /** Existe, mas NÃO é usado: vem "São Paulo" por extenso, não a sigla. */
  state?: unknown;
}

type LinhaDeProspect = typeof clinicasProspectTable.$inferInsert;

/** Texto aproveitável, ou null. */
function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo.length > 0 ? limpo : null;
}

/** Número vira string: as colunas `numeric` do drizzle são string em TS. */
function numeroTexto(valor: unknown): string | null {
  return typeof valor === "number" && Number.isFinite(valor) ? String(valor) : null;
}

export type MotivoDeDescarte = "sem_place_id" | "fechado";

export interface ItemPreparado {
  linha?: LinhaDeProspect;
  descarte?: MotivoDeDescarte;
}

/**
 * Traduz um item do Maps para uma linha de `clinicas_prospect`.
 *
 * A UF vem da VARREDURA, nunca do item: o campo `state` do ator traz o nome do
 * estado por extenso ("São Paulo"), e a coluna tem duas letras. Como cada
 * rodada é de uma cidade só, a UF da fila é a fonte correta e sempre certa.
 */
export function prepararItem(item: ItemDoMaps, varredura: ApifyVarredura): ItemPreparado {
  const placeId = texto(item.placeId);
  // Sem chave de deduplicação não há registro: a mesma clínica aparece nos dois
  // termos de busca, e é o place_id que impede a segunda cópia.
  if (!placeId) return { descarte: "sem_place_id" };

  // Clínica fechada para sempre não é mercado. Fechada TEMPORARIAMENTE entra
  // normalmente — e anúncio no Maps é clínica igual, também entra.
  if (item.permanentlyClosed === true) return { descarte: "fechado" };

  const telefoneRaw = texto(item.phoneUnformatted);

  return {
    linha: {
      placeId,
      nome: texto(item.title) ?? "(sem nome)",
      telefoneRaw,
      // Continua NULO nesta etapa: quem preenche é a Etapa 3, com a forma
      // canônica que o WhatsApp devolve no jid (ver canonicalizar-telefone.ts).
      telefoneWhatsapp: null,
      temWhatsapp: null,
      website: texto(item.website),
      // Sem fonte: o Instagram só viria pelo add-on de redes sociais, que no
      // Free custa 20× o dado base.
      instagram: null,
      endereco: texto(item.address),
      cidade: texto(item.city) ?? varredura.cidade,
      uf: varredura.uf,
      bairro: texto(item.neighborhood),
      cep: texto(item.postalCode),
      categoria: texto(item.categoryName),
      nota: numeroTexto(item.totalScore),
      totalAvaliacoes: typeof item.reviewsCount === "number" ? item.reviewsCount : null,
      latitude: numeroTexto(item.location?.lat),
      longitude: numeroTexto(item.location?.lng),
      // "não sei" não pode virar "não tem": só vira booleano se o ator disse.
      perfilReivindicado:
        typeof item.claimThisBusiness === "boolean" ? !item.claimThisBusiness : null,
      varreduraId: varredura.id,
      statusProspeccao: telefoneRaw ? ("novo" as const) : ("sem_telefone" as const),
    },
  };
}

export interface LotePreparado {
  linhas: LinhaDeProspect[];
  semPlaceId: number;
  fechados: number;
  /** Repetidos DENTRO do mesmo dataset (mesmo place_id). */
  repetidos: number;
}

/**
 * Prepara o lote inteiro. Um item ruim nunca derruba os outros: ele é contado
 * e o lote segue.
 */
export function prepararLote(itens: ItemDoMaps[], varredura: ApifyVarredura): LotePreparado {
  const lote: LotePreparado = { linhas: [], semPlaceId: 0, fechados: 0, repetidos: 0 };
  const vistos = new Set<string>();

  for (const item of itens) {
    const { linha, descarte } = prepararItem(item ?? {}, varredura);
    if (descarte === "sem_place_id") {
      lote.semPlaceId++;
      continue;
    }
    if (descarte === "fechado") {
      lote.fechados++;
      continue;
    }
    if (!linha) continue;

    if (vistos.has(linha.placeId)) {
      lote.repetidos++;
      continue;
    }
    vistos.add(linha.placeId);
    lote.linhas.push(linha);
  }

  return lote;
}

/**
 * A próxima da fila: menor prioridade primeiro, depois o menor id.
 *
 * A ordenação é feita aqui, e não só no ORDER BY, porque é ela que decide onde
 * o dinheiro é gasto — e assim a escolha é a mesma no banco de verdade e no
 * banco falso do teste, que não ordena.
 */
export function escolherProxima<T extends { prioridade: number; id: number }>(
  pendentes: T[],
): T | null {
  if (pendentes.length === 0) return null;
  return [...pendentes].sort(
    (a, b) => a.prioridade - b.prioridade || a.id - b.id,
  )[0] as T;
}

/** A run demorou demais e não vai voltar? */
export function runPendurada(disparadaEm: Date | null, agora: Date): boolean {
  if (!disparadaEm) return false;
  return agora.getTime() - new Date(disparadaEm).getTime() > TEMPO_MAXIMO_DA_RUN_MS;
}

/**
 * O telefone do Maps é aproveitável pela Etapa 3?
 *
 * Não muda nada nesta etapa (o status depende só de HAVER telefone), mas
 * existe para o log dizer quanto do dado captado é utilizável de verdade — a
 * calibração viu 5 de 5 com celular, e isso precisa ser medido, não torcido.
 */
export function telefoneAproveitavel(telefoneRaw: string | null): boolean {
  return telefoneRaw !== null && normalizarTelefone(telefoneRaw) !== null;
}
