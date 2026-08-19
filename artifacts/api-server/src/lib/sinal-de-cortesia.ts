/**
 * ELE RESPONDE POR EDUCACAO — o sinal que vem antes de a conversa morrer.
 *
 * Duas respostas seguidas de ate tres palavras ("sim", "sou eu", "a
 * secretaria") nao sao conversa: sao cortesia. O dentista continua digitando
 * porque foi perguntado, nao porque quer. Nas sete conversas lidas em
 * 19/08/2026 esse foi o padrao das duas que mais responderam e mesmo assim
 * morreram — o lead 44 respondeu quatro perguntas assim, o 49 respondeu cinco e
 * encerrou dizendo que nao tinha se inscrito para entrevista.
 *
 * POR QUE ISTO E CODIGO, e nao so uma linha do prompt. A regra do que FAZER ao
 * ver o sinal mora na FASE 2, B4 — ali ela e comportamento, e comportamento e
 * do prompt. O que nao pode ser do prompt e a OBSERVACAO: contar palavras de
 * duas mensagens separadas, atraves da janela de contexto, e exatamente o tipo
 * de conta que o modelo faz quando lembra e esquece quando esta ocupado
 * vendendo. Foi assim que "se o automatico responder de novo, nao insista"
 * rendeu sete minutos de ping-pong com a regra escrita no prompt.
 *
 * Entao o codigo OBSERVA e a ficha ENTREGA o fato pronto; o prompt decide o que
 * fazer com ele. Mesma divisao do interlocutor e da temperatura.
 *
 * Arquivo so de DECISAO: funcao pura, sem banco e sem rede.
 */

/** Quantas palavras uma resposta pode ter e ainda ser cortesia. */
export const MAXIMO_DE_PALAVRAS = 3;

/** Quantas respostas curtas seguidas fecham o sinal. */
export const RESPOSTAS_SEGUIDAS = 2;

/**
 * Conta palavras de verdade: emoji e pontuacao solta nao viram palavra, senao
 * um "ok 👍" contaria como duas e escaparia do limite justamente no caso mais
 * curto que existe.
 */
export function contarPalavras(texto: string): number {
  return (texto.match(/\p{L}[\p{L}\p{N}'-]*/gu) ?? []).length;
}

/**
 * Esta mensagem e uma resposta de cortesia?
 *
 * PERGUNTA NAO CONTA, e essa e a trava que impede o sinal de queimar um lead
 * bom: "quanto custa?" tem duas palavras e e o oposto de desinteresse. Cortesia
 * e responder o minimo; quem pergunta esta puxando a conversa, nao a
 * empurrando para o fim.
 */
export function ehRespostaDeCortesia(texto: string): boolean {
  const limpo = (texto ?? "").trim();
  if (!limpo) return false;
  if (limpo.includes("?")) return false;
  const palavras = contarPalavras(limpo);
  return palavras > 0 && palavras <= MAXIMO_DE_PALAVRAS;
}

/**
 * As DUAS ultimas mensagens dele foram cortesia?
 *
 * `mensagensDele` sao so as inbound, em ordem cronologica. Olha o fim da lista:
 * o sinal e sobre o estado AGORA, e uma resposta longa no meio da conversa
 * desarma tudo que veio antes — que e o mesmo motivo pelo qual a B4 diz que a
 * conversa recomeca normal quando ele escrever de verdade.
 */
export function respondePorCortesia(mensagensDele: string[]): boolean {
  if (mensagensDele.length < RESPOSTAS_SEGUIDAS) return false;
  return mensagensDele
    .slice(-RESPOSTAS_SEGUIDAS)
    .every((m) => ehRespostaDeCortesia(m));
}
