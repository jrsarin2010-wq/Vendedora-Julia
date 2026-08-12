/**
 * SONDA DE MODELO — o boot confere, em voz alta, se os modelos configurados
 * respondem.
 *
 * POR QUE ELA EXISTE: o nome do modelo vem de variável de ambiente
 * (lib/modelos.ts). Um nome errado NÃO derruba o deploy — o healthcheck testa
 * /api/healthz, que não fala com a OpenAI. O deploy fica verde, o painel abre,
 * e o erro só aparece quando um dentista escreve: a resposta morre com 404 no
 * log e ele recebe silêncio. A sonda faz essa falha acontecer AGORA, no boot,
 * uma única vez — com log de erro e alerta no Telegram — em vez de na primeira
 * conversa real.
 *
 * DE BRINDE: a resposta da OpenAI traz nos headers o limite REAL da conta para
 * aquele modelo (x-ratelimit-limit-tokens). A tabela pública de tiers não vale
 * como fonte — o 429 de 12/08 acusou limite de 200 mil num modelo em que a
 * tabela dizia 500 mil. A sonda loga o que a conta de fato tem.
 *
 * Custo: uma chamada mínima por modelo DISTINTO, uma vez por subida do
 * processo. Frações de centavo.
 */
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";
import { sendTelegramSondaModelo } from "./integrations";
import { descreverErro } from "./repique";
import { REPLY_MODEL, EXTRACTION_MODEL, OUTREACH_MODEL } from "./modelos";

export interface AlvoDeSonda {
  /** O papel na Júlia: "resposta", "extração", "abordagem". */
  papel: string;
  modelo: string;
}

/** Os três papéis, com a resposta primeiro — é a que mata a venda se falhar. */
export function alvosDaSonda(): AlvoDeSonda[] {
  return [
    { papel: "resposta", modelo: REPLY_MODEL },
    { papel: "extração", modelo: EXTRACTION_MODEL },
    { papel: "abordagem", modelo: OUTREACH_MODEL },
  ];
}

export interface GrupoDeSonda {
  modelo: string;
  papeis: string[];
}

/**
 * Junta papéis que usam o mesmo modelo: uma chamada por modelo DISTINTO.
 * Resposta e abordagem compartilham o default hoje — sondar duas vezes seria
 * pagar duas chamadas pela mesma pergunta.
 */
export function agruparPorModelo(alvos: AlvoDeSonda[]): GrupoDeSonda[] {
  const grupos: GrupoDeSonda[] = [];
  for (const { papel, modelo } of alvos) {
    const existente = grupos.find((g) => g.modelo === modelo);
    if (existente) existente.papeis.push(papel);
    else grupos.push({ modelo, papeis: [papel] });
  }
  return grupos;
}

export interface RespostaDaSonda {
  /** O modelo devolveu uma mensagem? */
  respondeu: boolean;
  /** x-ratelimit-limit-tokens: o TPM real da conta para este modelo. */
  tpmDaConta: string | null;
  /** x-ratelimit-limit-requests: o RPM real. */
  rpmDaConta: string | null;
}

export interface ResultadoDaSonda extends GrupoDeSonda {
  ok: boolean;
  /** O que deu errado, já em texto — null quando ok. */
  detalhe: string | null;
  tpmDaConta: string | null;
  rpmDaConta: string | null;
}

/**
 * Sonda cada grupo, um a um. NUNCA lança, e uma falha não impede as sondas
 * seguintes: a sonda avisa, não derruba — um boot que morresse por causa do
 * próprio alarme seria pior que a falha que ele vigia.
 */
export async function sondarModelos(
  grupos: GrupoDeSonda[],
  chamar: (modelo: string) => Promise<RespostaDaSonda>,
  aoFalhar: (r: ResultadoDaSonda) => Promise<void> = async () => {},
): Promise<ResultadoDaSonda[]> {
  const resultados: ResultadoDaSonda[] = [];
  for (const grupo of grupos) {
    let resultado: ResultadoDaSonda;
    try {
      const r = await chamar(grupo.modelo);
      resultado = {
        ...grupo,
        ok: r.respondeu,
        detalhe: r.respondeu ? null : "o modelo devolveu resposta vazia",
        tpmDaConta: r.tpmDaConta,
        rpmDaConta: r.rpmDaConta,
      };
    } catch (err) {
      resultado = {
        ...grupo,
        ok: false,
        detalhe: descreverErro(err),
        tpmDaConta: null,
        rpmDaConta: null,
      };
    }
    resultados.push(resultado);
    if (!resultado.ok) {
      try {
        await aoFalhar(resultado);
      } catch {
        // O alarme do alarme não existe: se o aviso falhar, o log de erro do
        // chamador ainda conta a história.
      }
    }
  }
  return resultados;
}

/**
 * A chamada real, mínima de propósito: uma frase, teto curto de saída.
 * `.withResponse()` expõe os headers de rate limit; se não existir (stub de
 * teste, SDK futuro), a sonda funciona igual — só fica sem os headers.
 */
async function chamadaReal(modelo: string): Promise<RespostaDaSonda> {
  const promessa = openai.chat.completions.create(
    {
      model: modelo,
      max_completion_tokens: 16,
      messages: [{ role: "user", content: "Responda apenas: ok" }],
    },
    { timeout: 20_000 },
  );

  const comHeaders =
    typeof promessa.withResponse === "function"
      ? await promessa.withResponse()
      : { data: await promessa, response: undefined };

  return {
    respondeu: Boolean(comHeaders.data.choices?.[0]?.message),
    tpmDaConta: comHeaders.response?.headers.get("x-ratelimit-limit-tokens") ?? null,
    rpmDaConta: comHeaders.response?.headers.get("x-ratelimit-limit-requests") ?? null,
  };
}

/**
 * O que o index.ts chama depois de abrir a porta. Roda solto (void): a sonda
 * não pode atrasar nem derrubar a subida do servidor.
 */
export async function sondarModelosNoBoot(): Promise<ResultadoDaSonda[]> {
  const resultados = await sondarModelos(
    agruparPorModelo(alvosDaSonda()),
    chamadaReal,
    async (r) => {
      await sendTelegramSondaModelo(r.modelo, r.papeis.join(" + "), r.detalhe ?? "sem detalhe");
    },
  );

  for (const r of resultados) {
    if (r.ok) {
      logger.info(
        { modelo: r.modelo, papeis: r.papeis, tpmDaConta: r.tpmDaConta, rpmDaConta: r.rpmDaConta },
        "Sonda de modelo: OK — o modelo responde",
      );
    } else {
      logger.error(
        { modelo: r.modelo, papeis: r.papeis, detalhe: r.detalhe },
        "Sonda de modelo: o modelo NÃO respondeu — todo uso deste papel vai falhar",
      );
    }
  }
  return resultados;
}
