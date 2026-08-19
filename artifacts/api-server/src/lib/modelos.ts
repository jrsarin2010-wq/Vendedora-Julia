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

/**
 * OS TETOS DE SAÍDA — e eles moram aqui pelo motivo que quebrou a abordagem.
 *
 * `max_completion_tokens` NÃO é o tamanho da resposta: é o teto do que o modelo
 * pode GASTAR para produzi-la, e num modelo de raciocínio isso inclui os tokens
 * de raciocínio, que nunca aparecem na saída. Quem manda no tamanho é o prompt.
 *
 * A consequência é que um teto pode ficar curto sem ninguém encostar nele —
 * basta a TAREFA encarecer. Foi o que aconteceu em 18/08/2026: o prompt de
 * abordagem trocou quatro exemplos prontos por seis partes descritas, adaptar
 * exemplo é barato e compor não é, e o 200 que estava lá desde sempre quebrou
 * no mesmo deploy. Estourado, o teto falha de duas caras que não se parecem —
 * 400 da OpenAI, ou resposta 200 com conteúdo VAZIO e finish_reason "length".
 *
 * Estavam espalhados em três arquivos, cada um um número solto dentro de uma
 * chamada. Juntos, viram uma lista que alguém revisa ao mexer num prompt — que
 * é exatamente o momento em que ninguém lembrava deles.
 */

/**
 * RESPOSTA DE VENDA. A saída visível são duas ou três linhas de WhatsApp (~100
 * tokens); o resto é raciocínio, sobre o maior prompt do sistema.
 *
 * Mantido em 512 por falta de motivo para mexer, e não por conforto: os logs de
 * 17/08 (o dia dos 40 abordados e das nove conversas) não têm uma linha de
 * "resposta vazia". Se aparecer, o log agora diz o número — ver o diagnóstico
 * no webhook.
 */
export const TETO_RESPOSTA = 512;

/**
 * EXTRAÇÃO. Este subiu de 200, e por MEDIÇÃO, não por precaução.
 *
 * O JSON do extrator cresceu duas vezes sem ninguém revisar o teto: a Rodada 52
 * acrescentou `interlocutor` e a 54 acrescentou `descoberta`, que é um objeto
 * de até seis tópicos. Uma ficha com todos os campos preenchidos — dez sinais,
 * os seis tópicos, dor e objeção escritas — passa de 200 tokens só de JSON
 * VISÍVEL, antes de qualquer raciocínio. O teste `tetos.test.ts` mede isso.
 *
 * Não tinha estourado ainda porque a conversa típica preenche metade dos campos
 * (~96 tokens). Mas o campo que falta encher é o da conversa RICA — o lead
 * engajado, que respondeu muita coisa. O modo de falhar escolhia o melhor lead
 * da lista, e falhava calado: um `warn` de "seguindo sem", a ficha parada, e a
 * `descoberta` — que é o que impede a mesma pergunta de voltar — nunca gravada.
 *
 * 600 -> 800 em 18/08/2026, quando entrou o `trechos` da peneira de sinais. O
 * JSON cheio subiu de ~248 para 316 tokens medidos, e o teste exige o dobro:
 * 632. NÃO ficou em 632.
 *
 * A folga é deliberada, e o motivo é o mesmo dia: o teto da abordagem estava
 * colado no necessário, o prompt cresceu, e o estouro saiu como 400 numa ponta
 * e como resposta VAZIA na outra — duas caras que pareciam dois defeitos. Aqui
 * o modo de falhar é ainda mais traiçoeiro, porque é silencioso e escolhe
 * justamente o melhor lead da lista.
 *
 * E economizar aqui não economiza NADA: `max_completion_tokens` é teto, não
 * gasto. Só se paga o que o modelo de fato gerar. Um teto folgado custa zero
 * enquanto ninguém precisa dele, e o teto apertado só cobra a conta no dia em
 * que o lead é bom.
 */
export const TETO_EXTRACAO = 800;

/**
 * ABORDAGEM — e, desde 19/08/2026, também os dois TOQUES de quem não respondeu,
 * que deixaram de ser texto fixo e passaram a nascer do modelo.
 *
 * Era 200 e quebrou em produção em 18/08/2026; ver o histórico no topo. São no
 * máximo 15 mensagens frias por dia (o ritmo caiu de 40 no mesmo dia em que os
 * toques passaram a ser gerados), então não há o que economizar aqui.
 */
export const TETO_ABORDAGEM = 1024;
