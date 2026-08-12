/**
 * TEMPERATURA DO LEAD (Rodada 41).
 *
 * Mandar mensagem não esquenta ninguém — o que esquenta é o tipo de pergunta.
 * Quem pergunta preço está mais perto de comprar que quem manda "oi", e os dois
 * não podem receber a mesma cadência.
 *
 * A pontuação é cumulativa dentro da conversa. Não zera: interesse demonstrado
 * não desaparece porque ele ficou quieto — o que muda com o tempo é a urgência,
 * e isso a reativação resolve.
 *
 * Arquivo só de DECISÃO, sem banco e sem rede, no mesmo espírito do outreach.ts:
 * tudo aqui é função pura e testável.
 */

export const SINAIS_DE_TEMPERATURA = {
  // Quente — está decidindo
  pediu_link: 30, // "manda o link", "como faço pra assinar"
  perguntou_como_assinar: 30,
  pediu_pessoa: 30, // handoff (detectado pelo webhook, não pelo extrator)
  disse_vou_pensar: 20, // é quase-fechamento, não recusa
  perguntou_contrato: 20, // quem não vai assinar não lê contrato
  perguntou_seguranca: 20, // "é golpe?" = está considerando pagar

  // Morno — está avaliando
  perguntou_preco: 15,
  comparou_planos: 15,
  perguntou_recurso: 10, // "faz isso?", "como funciona X"
  contou_a_dor: 10, // respondeu a descoberta
  disse_quantos_prof: 10,

  // Frio — está só olhando
  respondeu_algo: 3, // qualquer mensagem dele (dado pelo webhook, uma vez)
} as const;

export type Sinal = keyof typeof SINAIS_DE_TEMPERATURA;

/**
 * O que o EXTRATOR pode devolver. `pediu_pessoa` e `respondeu_algo` ficam de
 * fora de propósito: são dados pelo próprio webhook (o handoff já tem detector
 * dedicado, e "respondeu algo" é fato, não interpretação).
 */
export const SINAIS_DO_EXTRATOR: readonly Sinal[] = [
  "pediu_link",
  "perguntou_como_assinar",
  "disse_vou_pensar",
  "perguntou_contrato",
  "perguntou_seguranca",
  "perguntou_preco",
  "comparou_planos",
  "perguntou_recurso",
  "contou_a_dor",
  "disse_quantos_prof",
];

export const FAIXAS = ["frio", "morno", "quente", "fervendo"] as const;
export type Faixa = (typeof FAIXAS)[number];

/**
 * 0-9 frio (só apareceu), 10-29 morno (avaliando), 30-59 quente (decidindo),
 * 60+ fervendo (múltiplos sinais de compra — prioridade máxima).
 */
export function faixaDaTemperatura(pontos: number): Faixa {
  if (pontos >= 60) return "fervendo";
  if (pontos >= 30) return "quente";
  if (pontos >= 10) return "morno";
  return "frio";
}

/**
 * O `status` que já existe (hot/warm/cold) passa a ser DERIVADO da pontuação —
 * assim o painel e todas as travas que olham status continuam funcionando.
 * "closed" e "lost" não passam por aqui: são terminais e ninguém os rebaixa.
 */
export function statusDaFaixa(faixa: Faixa): "cold" | "warm" | "hot" {
  if (faixa === "frio") return "cold";
  if (faixa === "morno") return "warm";
  return "hot";
}

/**
 * Lê o campo `sinaisVistos` do lead ("perguntou_preco,contou_a_dor"). Mesmo
 * formato do `demosEnviadas`: texto separado por vírgula, porque é lista
 * pequena e de vocabulário fechado. Valor desconhecido (sinal renomeado,
 * banco mexido na mão) é ignorado em vez de quebrar a conta.
 */
export function lerSinaisVistos(texto: string | null | undefined): Sinal[] {
  if (!texto) return [];
  return texto
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Sinal => s in SINAIS_DE_TEMPERATURA);
}

/**
 * Junta os sinais novos aos já vistos e devolve a pontuação do conjunto.
 *
 * É o Set que garante a regra "o mesmo sinal não pontua duas vezes": perguntar
 * preço em três mensagens diferentes vale 15, não 45. Sinal desconhecido vindo
 * do extrator (nome inventado pelo modelo) é descartado em silêncio.
 */
export function registrarSinais(
  vistos: string | null | undefined,
  novos: string[],
): { sinaisVistos: string; temperatura: number } {
  const conjunto = new Set<Sinal>(lerSinaisVistos(vistos));
  for (const s of novos) {
    if (s in SINAIS_DE_TEMPERATURA) conjunto.add(s as Sinal);
  }
  const lista = [...conjunto];
  return {
    sinaisVistos: lista.join(","),
    temperatura: lista.reduce((soma, s) => soma + SINAIS_DE_TEMPERATURA[s], 0),
  };
}
