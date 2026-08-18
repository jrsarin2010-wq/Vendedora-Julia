/**
 * TURNO DO LEAD — uma geração por vez, e uma resposta por rajada.
 *
 * O PROBLEMA QUE ISTO RESOLVE, com data: em 3 conversas reais o webhook rodou
 * várias vezes em paralelo sobre o MESMO lead. Às 19:14 saíram duas mensagens
 * contraditórias no mesmo minuto — uma continuando a descoberta, outra
 * encerrando depois da recusa; às 12:22 saíram cinco no mesmo minuto. A causa
 * não era o texto do prompt: era não haver serialização nenhuma. Cada webhook
 * é um handler assíncrono independente, cada um lia o histórico no seu próprio
 * instante, e nenhum enxergava a resposta que o outro ainda ia gravar.
 *
 * O que NÃO servia:
 *
 * - O cache de `key.id` já processado (routes/webhook.ts) só cobre reenvio do
 *   MESMO webhook pela Evolution. Cinco mensagens diferentes têm cinco ids
 *   diferentes e passam todas.
 * - `pausedUntil` cobre o humano assumindo pelo celular, não a Júlia
 *   atropelando a si mesma.
 *
 * São DUAS peças, com responsabilidades separadas de propósito:
 *
 * 1) A TRAVA (`travar`/`soltar`) — uma tarefa por vez por lead. É o que impede
 *    duas gerações simultâneas e, de quebra, duas criações do mesmo lead
 *    (`leads.phone` é UNIQUE: hoje a segunda estoura e a mensagem some no
 *    catch) e duas levas de follow-up (o cancelamento de um handler caindo
 *    entre o cancelamento e o insert do outro).
 *
 * 2) A SENHA (`chegou`/`foiSuperado`) — o agrupamento. Cada mensagem tira uma
 *    senha ao chegar. Depois de gravar, o handler espera uns segundos de
 *    silêncio; ao acordar, se a senha dele não é mais a última, ele SAI sem
 *    gerar. Quem responde é sempre o dono da mensagem mais nova, com todas as
 *    anteriores já no histórico.
 *
 * POR QUE A SENHA EM VEZ DE UM TIMER COMPARTILHADO: o efeito é idêntico ao de
 * um debounce clássico (a geração acontece N ms depois da ÚLTIMA mensagem),
 * mas sem estado de timer para nascer errado num restart ou vazar entre leads.
 * Cada handler espera a própria janela e desiste sozinho.
 *
 * TUDO EM MEMÓRIA, e isso é uma escolha com limite conhecido: vale para UM
 * processo. `railway.json` não declara réplicas (o padrão é 1), e é a mesma
 * aposta que o cache de `key.id` já faz. Com duas réplicas, a trava certa seria
 * `pg_advisory_xact_lock` no Postgres — complexidade que hoje ninguém usaria.
 *
 * Arquivo sem banco e sem rede, no espírito do temperatura.ts: tudo aqui é
 * testável sem subir nada.
 */

/** Uma trava por lead: quem está com ela, e quem está na fila esperando. */
interface Trava {
  /** Token de quem segura a trava agora. `null` = livre. */
  dono: number | null;
  /** Quem está esperando a vez, na ordem de chegada. */
  fila: Array<(token: number) => void>;
}

const travas = new Map<string, Trava>();

/** Tokens são globais e só crescem: dois donos nunca colidem. */
let proximoToken = 1;

/**
 * Espera a vez neste lead e devolve o token de quem passou a segurar a trava.
 *
 * O token existe para `soltar` ser seguro: sem ele, um handler que já soltou
 * (ou que nem chegou a pegar) liberaria a trava DE OUTRO no seu `finally`, e o
 * paralelismo voltaria pela porta dos fundos — do jeito mais difícil de achar.
 */
export async function travar(chave: string): Promise<number> {
  let trava = travas.get(chave);
  if (!trava) {
    trava = { dono: null, fila: [] };
    travas.set(chave, trava);
  }

  if (trava.dono === null) {
    trava.dono = proximoToken++;
    return trava.dono;
  }

  return new Promise<number>((resolver) => {
    trava!.fila.push(resolver);
  });
}

/**
 * Devolve a trava. Idempotente e sem efeito quando o token não é o do dono
 * atual — é isso que faz um `finally` genérico poder chamar sempre, sem
 * precisar saber se ainda havia algo a soltar.
 *
 * Quando há fila, a trava é PASSADA direto para o próximo (ele acorda já como
 * dono) em vez de ficar livre por um instante: livre no meio, um handler novo
 * furaria a fila.
 */
export function soltar(chave: string, token: number): void {
  const trava = travas.get(chave);
  if (!trava || trava.dono !== token) return;

  const proximo = trava.fila.shift();
  if (proximo) {
    trava.dono = proximoToken++;
    proximo(trava.dono);
    return;
  }

  trava.dono = null;
  // Ninguém segurando e ninguém esperando: a chave sai do mapa. Sem isto o
  // mapa guardaria uma entrada por telefone que já falou com a Júlia, para
  // sempre.
  travas.delete(chave);
}

/** A senha da última mensagem que chegou de cada lead. */
const senhas = new Map<string, number>();

/**
 * Registra que chegou mensagem deste lead e devolve a senha dela.
 *
 * Chamado ANTES de gravar qualquer coisa: a senha marca a ordem de CHEGADA,
 * que é o que decide quem é o dono da rajada.
 */
export function chegou(chave: string): number {
  const senha = (senhas.get(chave) ?? 0) + 1;
  senhas.set(chave, senha);
  return senha;
}

/**
 * Chegou mensagem mais nova depois desta? Então este handler não responde: o
 * dono da rajada é o da mensagem mais nova, e ele vai gerar uma resposta só,
 * já com esta aqui no histórico.
 *
 * Descartar o VELHO e não o novo é o ponto: a mensagem das 19:14 que continuava
 * o interrogatório já tinha nascido desatualizada quando a recusa chegou.
 */
export function foiSuperado(chave: string, senha: number): boolean {
  return (senhas.get(chave) ?? 0) !== senha;
}

/**
 * Fecha o turno deste lead. Sem efeito se já chegou mensagem mais nova — ela é
 * dona da contagem agora e não pode perder o lugar.
 */
export function encerrarTurno(chave: string, senha: number): void {
  if (senhas.get(chave) === senha) senhas.delete(chave);
}

/**
 * A JANELA DE SILÊNCIO, em milissegundos.
 *
 * Dois valores, e a diferença entre eles não é capricho — é a Rodada 35. Lá
 * está registrado (lib/integrations.ts, PRIMEIRA_RESPOSTA_MAXIMO_MS) que 12
 * segundos de espera na PRIMEIRA resposta fazem o dentista achar que não tem
 * ninguém e ir embora: "é a única troca da conversa inteira em que rapidez vale
 * mais que naturalidade". Uma janela de 8s ali somaria com a geração e a
 * digitação e daria ~15s — pior do que o número que aquela rodada condenou.
 *
 * Por isso a abertura tem janela curta (3s: o picote de abertura é rápido e
 * curto — "Ola julia" / "Renata") e o resto da conversa tem janela larga (8s:
 * ele já está engajado, não está mais olhando a tela, e é aí que aparecem os
 * blocos picotados em três ou quatro mensagens).
 *
 * Lido a cada chamada, e não no topo do módulo, pelo mesmo motivo do
 * `minutosSemResposta()` da central de vigia: assim o valor efetivo é o que
 * está no ambiente AGORA, e o teste consegue zerar a janela.
 */
export const JANELA_ABERTURA_MS = 3_000;
export const JANELA_CONVERSA_MS = 8_000;

export function janelaDeAgrupamentoMs(abertura: boolean): number {
  const bruto = abertura
    ? process.env.AGRUPAMENTO_ABERTURA_MS
    : process.env.AGRUPAMENTO_MS;
  const padrao = abertura ? JANELA_ABERTURA_MS : JANELA_CONVERSA_MS;
  if (!bruto) return padrao;
  const n = Number(bruto);
  // Valor inválido cai no padrão em vez de virar NaN: um `setTimeout(NaN)`
  // dispara na hora e desligaria o agrupamento em silêncio.
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

/** Espera a janela. Zero não paga nem um tique do relógio. */
export function esperarSilencio(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolver) => setTimeout(resolver, ms));
}
