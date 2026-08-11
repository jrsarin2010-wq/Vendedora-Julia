/**
 * O QUE A LANDING NÃO RESPONDE (Rodada 35)
 *
 * Todo dentista que clica no botão do site está dizendo, de graça, o que falta
 * na página. Se cinco perguntam sobre recarga, a página tem um buraco na
 * recarga; se três perguntam sobre contrato, falta isso lá. Hoje esse dado
 * morre dentro das conversas — é o feedback mais barato que existe e ninguém
 * está lendo.
 *
 * Este módulo é a parte determinística disso: limpar o assunto que o analista
 * de bastidor devolveu e contar os assuntos. Quem decide QUANDO gravar é o
 * webhook (só para lead vindo do site, e só a primeira dúvida da conversa).
 */

/** Mais que isto não é assunto, é frase — e frase não agrupa com nada. */
const MAXIMO_PALAVRAS = 6;
const MAXIMO_CARACTERES = 60;

/** O modelo às vezes devolve a ausência como texto em vez de JSON null. */
const VAZIOS = ["null", "none", "n/a", "nao", "não", "nenhuma", "nenhum", "-"];

/**
 * Normaliza o assunto vindo do extrator, ou devolve null se não servir.
 *
 * Guarda em MINÚSCULAS de propósito: o painel conta ocorrências, e "Recarga de
 * conversas" e "recarga de conversas" precisam cair na mesma linha. Sem isso o
 * ranking se estilhaça em variações de caixa e a contagem mente para baixo,
 * que é exatamente o erro que faz a lista parecer irrelevante.
 *
 * Recusa (null) o que veio como frase inteira: o prompt pede 2 a 4 palavras, e
 * uma frase nunca vai casar com outra — entraria no ranking como um "1"
 * eterno, empurrando para baixo os assuntos que de fato se repetem.
 */
export function limparAssunto(bruto: string | null | undefined): string | null {
  if (!bruto) return null;

  const limpo = bruto
    .toLowerCase()
    .replace(/["“”'`]/g, "")
    .replace(/[.!?;,\s]+$/, "")
    .replace(/^[-–—\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!limpo) return null;
  if (VAZIOS.includes(limpo)) return null;
  if (limpo.length > MAXIMO_CARACTERES) return null;
  if (limpo.split(" ").length > MAXIMO_PALAVRAS) return null;

  return limpo;
}

export interface AssuntoContado {
  assunto: string;
  total: number;
}

/**
 * Agrupa e conta, do mais frequente para o menos. Empate desempata em ordem
 * alfabética, para a lista não dançar entre duas cargas da tela com os mesmos
 * dados — painel que muda de ordem sozinho parece quebrado.
 *
 * Passa tudo por `limparAssunto` de novo em vez de confiar no que está gravado:
 * o banco pode ter linhas anteriores a esta limpeza, e uma delas com caixa
 * diferente rebaixaria a contagem do assunto certo.
 */
export function contarAssuntos(
  valores: (string | null | undefined)[],
): AssuntoContado[] {
  const contagem = new Map<string, number>();

  for (const valor of valores) {
    const assunto = limparAssunto(valor);
    if (!assunto) continue;
    contagem.set(assunto, (contagem.get(assunto) ?? 0) + 1);
  }

  return [...contagem.entries()]
    .map(([assunto, total]) => ({ assunto, total }))
    .sort((a, b) => b.total - a.total || a.assunto.localeCompare(b.assunto, "pt-BR"));
}
