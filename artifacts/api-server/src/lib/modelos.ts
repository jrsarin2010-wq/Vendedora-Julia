/**
 * OS MODELOS DA JÚLIA — fonte única dos nomes.
 *
 * Os nomes vêm de variável de ambiente para a troca não exigir mudança de
 * código: muda no Railway, o serviço reinicia com o modelo novo, e a volta é
 * igualmente imediata. O preço dessa flexibilidade é que um nome digitado
 * errado não quebra build nenhum — só explode em runtime, na primeira
 * conversa. É por isso que a sonda de boot (lib/sonda-modelo.ts) confere os
 * três assim que o processo sobe.
 *
 * Defaults em UM lugar só: webhook.ts e outreach-message.ts importam daqui.
 * Antes cada um repetia o seu `process.env ?? default`, e era questão de
 * tempo os defaults divergirem sem ninguém decidir.
 *
 * Papéis:
 *  - resposta de venda (REPLY): a conversa com o dentista — o mais crítico.
 *  - abordagem (OUTREACH): a primeira mensagem fria.
 *  - extração (EXTRACTION): o analista de bastidor que preenche a ficha.
 */
export const REPLY_MODEL = process.env.JULIA_REPLY_MODEL ?? "gpt-5.4-mini";
export const EXTRACTION_MODEL = process.env.JULIA_EXTRACTION_MODEL ?? "gpt-5.4-nano";
export const OUTREACH_MODEL = process.env.JULIA_OUTREACH_MODEL ?? "gpt-5.4-mini";
