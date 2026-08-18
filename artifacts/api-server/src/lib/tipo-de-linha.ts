/**
 * FIXO OU CELULAR — a leitura do número, sem perguntar nada a ninguém.
 *
 * Muita clínica do Maps vem com telefone FIXO, e olhando a lista não dava para
 * saber qual era qual. É só isso que este módulo resolve: dizer o tipo da
 * linha a partir dos dígitos.
 *
 * ⚠️ Isto NÃO é filtro. Fixo não é barrado em lugar nenhum — ver o cabeçalho
 * de `triar()` em verificacao.ts, que registra a medição que decidiu isso.
 *
 * A regra vive AQUI e só aqui, no servidor, porque ela responde a duas
 * perguntas que precisam concordar: a etiqueta de cada linha da tela e a taxa
 * do resumo ("de quantos fixos verificados, quantos tinham WhatsApp"). Copiar
 * o critério para o navegador faria a etiqueta e a taxa divergirem sem que
 * nada avisasse — a etiqueta diria "fixo" numa linha que a conta não contou.
 */
import { normalizarTelefone } from "./filtro-spam";

export type TipoDeLinha = "celular" | "fixo" | "indefinido";

/**
 * O tipo da linha, ou "indefinido" quando não dá para afirmar.
 *
 * O critério de cabeça é o do tamanho — celular tem 9 dígitos depois do DDD,
 * fixo tem 8 — e ele quase basta. O "quase" é o PRIMEIRO DÍGITO, e ele importa
 * justamente aqui:
 *
 *   - fixo brasileiro começa em 2–5;
 *   - celular ANTIGO, de antes do nono dígito, tem 8 dígitos e começa em 6–9.
 *
 * Contar todo número de 8 dígitos como fixo poria esses celulares antigos
 * dentro da taxa do resumo — e celular quase sempre tem WhatsApp. A conta que
 * existe para decidir se vale barrar fixo nasceria inflada pelo lado que não é
 * fixo, ou seja, mentindo exatamente na direção que muda a decisão.
 *
 * Isso não é hipótese distante: o cabeçalho de canonicalizar-telefone.ts
 * documenta uma conta de WhatsApp real vivendo na forma de 8 dígitos
 * (`558592008899`).
 *
 * O que não se encaixa em nenhuma das duas formas sai "indefinido", nunca
 * chutado para um dos lados: número internacional (que `normalizarTelefone`
 * deixa passar) não tem DDD nem essa regra de primeiro dígito, e etiqueta
 * errada na tela é pior que etiqueta ausente.
 */
export function tipoDeLinha(bruto: string | null | undefined): TipoDeLinha {
  const numero = bruto ? normalizarTelefone(bruto) : null;
  // Sem o 55 não há DDD para descontar, e sem DDD a contagem de dígitos locais
  // seria outra coisa qualquer.
  if (!numero || !numero.startsWith("55")) return "indefinido";

  // `normalizarTelefone` já garantiu 12 ou 13 dígitos, então o que sobra
  // depois do país e do DDD tem 8 ou 9.
  const local = numero.slice(4);
  const primeiro = Number(local[0]);

  if (local.length === 9) {
    // 9 dígitos que não começam em 9 não existem no plano de numeração.
    return primeiro === 9 ? "celular" : "indefinido";
  }

  if (local.length === 8) {
    if (primeiro >= 2 && primeiro <= 5) return "fixo";
    if (primeiro >= 6 && primeiro <= 9) return "celular";
  }

  return "indefinido";
}
