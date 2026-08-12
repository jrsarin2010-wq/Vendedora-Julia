/**
 * REPIQUE — quando a OpenAI recusa, a gente tenta de novo antes de desistir.
 *
 * O caso real (12/08/2026, 12:23): uma rajada de mensagens estourou o limite de
 * tokens por minuto da conta e a OpenAI devolveu 429 quinze vezes seguidas.
 * Cada 429 caía no catch do webhook, virava uma linha de log e MAIS NADA — o
 * dentista mandava mensagem e recebia silêncio absoluto, sem ninguém saber.
 *
 * O 429 é temporário por definição: a própria resposta da OpenAI diz "tente de
 * novo em 3.9s", porque a janela do limite é de um minuto. Esperar e repetir
 * resolve quase todos. O que não resolve vira caso de gente, não linha de log.
 *
 * Arquivo só de DECISÃO, sem banco e sem rede, no mesmo espírito do outreach.ts:
 * quem chama decide o que fazer com o erro que sobrar.
 */

/**
 * As esperas entre uma tentativa e a seguinte. Três repiques: a primeira
 * chamada mais três, com a última saindo 19 segundos depois do começo.
 *
 * Por que crescente: o 429 de TPM tem janela de um minuto. Repicar rápido duas
 * vezes pega o caso em que a janela virou logo; a espera longa no fim pega o
 * caso em que a rajada foi grande. Repique de intervalo fixo só multiplica a
 * mesma recusa.
 */
export const ESPERAS_PADRAO_MS = [2000, 5000, 12000];

/**
 * Lida do ambiente A CADA chamada (mesmo padrão do `lerConfig` do outreach):
 * assim dá para afrouxar ou apertar o ritmo pelo painel do Railway sem
 * redeploy — e o teste roda com "0,0,0" em vez de esperar 19 segundos de
 * verdade.
 */
export function esperasDeRepique(): number[] {
  const bruto = (process.env.REPIQUE_ESPERAS_MS ?? "").trim();
  if (!bruto) return ESPERAS_PADRAO_MS;

  const pedacos = bruto.split(",").map((n) => n.trim());
  const numeros = pedacos.map((n) => (n === "" ? NaN : Number(n)));

  // Configuração inválida cai no padrão INTEIRO — nunca aproveita a parte que
  // deu certo. O motivo é concreto: `Number("")` é ZERO, então um "2000,,5000"
  // digitado errado viraria uma espera de zero no meio, e repique sem espera
  // martela a OpenAI exatamente quando ela já está recusando. Melhor ignorar a
  // configuração toda do que obedecer meia.
  const todosValidos =
    numeros.length > 0 && numeros.every((n) => Number.isFinite(n) && n >= 0);

  return todosValidos ? numeros : ESPERAS_PADRAO_MS;
}

/** Erros de rede que valem repique (a chamada nem chegou a ser respondida). */
const CODIGOS_DE_REDE = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

/**
 * Vale a pena tentar de novo?
 *
 * SIM para o que é passageiro: 429 (limite de tokens), 5xx (a OpenAI caiu),
 * 408 (estourou o tempo) e falha de rede.
 *
 * NÃO para o resto, e isso importa tanto quanto o sim: repetir um 401 (chave
 * errada) ou um 400 (payload inválido) não conserta nada e ainda faz o dentista
 * esperar 19 segundos para receber o mesmo silêncio. Erro de configuração tem
 * que aparecer rápido.
 */
export function ehRecusaTemporaria(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string; name?: string };

  if (typeof e.status === "number") {
    if (e.status === 429 || e.status === 408) return true;
    return e.status >= 500 && e.status <= 599;
  }

  if (e.code && CODIGOS_DE_REDE.has(e.code)) return true;

  // O SDK da OpenAI embrulha queda de conexão e estouro de tempo sem `status`.
  const nome = e.name ?? "";
  return /APIConnection|Timeout|Connection/i.test(nome);
}

/** Resumo curto do erro, para log e para a central de vigia. */
export function descreverErro(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as { status?: number; message?: string; name?: string };
  const partes = [
    e.name && e.name !== "Error" ? e.name : null,
    typeof e.status === "number" ? `HTTP ${e.status}` : null,
    e.message ?? null,
  ].filter(Boolean);
  return partes.join(" — ") || "erro sem descrição";
}

const dormir = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface OpcoesDeRepique {
  /** Sobrescreve as esperas (o padrão vem do ambiente). */
  esperas?: number[];
  /**
   * Chamado UMA vez, logo antes da espera que antecede a última tentativa —
   * e não depois dela. É o que permite avisar o dentista aos 7 segundos em vez
   * de aos 19: a mensagem de emergência só tem valor se chegar enquanto ele
   * ainda está olhando a tela.
   *
   * Se lançar, o erro é engolido: um aviso que falhou não pode matar a
   * tentativa que ainda pode dar certo.
   */
  antesDaUltima?: () => Promise<void>;
  /** Chamado a cada repique, para o log de quem chama. */
  aoRepicar?: (info: { tentativa: number; esperaMs: number; erro: string }) => void;
}

/**
 * Roda `chamar`, repetindo enquanto o erro for temporário.
 *
 * Devolve o resultado da primeira tentativa que der certo. Se todas falharem,
 * LANÇA o último erro — quem chama é que sabe o que fazer (o webhook manda o
 * lead para a central de vigia; o agendador de abordagem devolve o lead para a
 * fila). Engolir o erro aqui seria repetir, em outro lugar, o mesmo silêncio
 * que esta rodada existe para acabar.
 */
export async function comRepique<T>(
  chamar: () => Promise<T>,
  opcoes: OpcoesDeRepique = {},
): Promise<T> {
  const esperas = opcoes.esperas ?? esperasDeRepique();

  for (let tentativa = 0; ; tentativa++) {
    try {
      return await chamar();
    } catch (err) {
      const acabaramAsChances = tentativa >= esperas.length;
      if (acabaramAsChances || !ehRecusaTemporaria(err)) throw err;

      // A PRÓXIMA tentativa é a última? Então avisa antes de esperar.
      if (tentativa === esperas.length - 1 && opcoes.antesDaUltima) {
        try {
          await opcoes.antesDaUltima();
        } catch {
          /* aviso é bônus: nunca derruba a tentativa que ainda vem */
        }
      }

      opcoes.aoRepicar?.({
        tentativa: tentativa + 1,
        esperaMs: esperas[tentativa],
        erro: descreverErro(err),
      });

      await dormir(esperas[tentativa]);
    }
  }
}
