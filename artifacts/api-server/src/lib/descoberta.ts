/**
 * O QUE JA FOI PERGUNTADO, E O QUE ELE RESPONDEU.
 *
 * O caso real: a mesma pergunta sobre anuncio saiu SEIS vezes na mesma conversa,
 * com DUAS recusas explicitas do dentista no meio. E noutra conversa a Julia
 * repetiu "quantos profissionais" depois de ja ter sido respondida.
 *
 * A causa nao era so o prompt mandar perguntar em seis lugares diferentes (ele
 * mandava, e nenhum tinha condicao de parada). Era que NAO HAVIA ONDE LEMBRAR:
 * a ficha do lead carregava dor, objecao, etapa e plano, e nada sobre o que ja
 * tinha sido perguntado. A unica memoria era a janela de 20 mensagens — passou
 * disso, a pergunta volta como se fosse a primeira vez.
 *
 * Este modulo e a memoria que faltava, e o detector que avisa quando ela nao
 * foi respeitada. Sem banco e sem rede: tudo funcao pura, no espirito do
 * temperatura.ts e do interlocutor.ts.
 */

/**
 * Os assuntos da descoberta. Lista FECHADA, e pequena de proposito: cada item
 * aqui e uma pergunta que o prompt manda fazer. Assunto que nao esta nesta
 * lista nao e rastreado, e tudo bem — o problema real sao as perguntas
 * OBRIGATORIAS, que sao as que voltam.
 */
export const TOPICOS = [
  "anuncia",
  "verba",
  "profissionais",
  "quem_responde",
  "fora_do_horario",
  "volume_perdido",
] as const;

export type Topico = (typeof TOPICOS)[number];

/**
 * O valor que significa "perguntei e nao veio resposta util".
 *
 * Ele desconversou, mudou de assunto, disse que nao sabe, ou simplesmente nao
 * respondeu. Vale TANTO quanto uma resposta de verdade para efeito de nao
 * repetir: e essa a decisao do dono (17/08/2026), e e o coracao da porta de
 * saida. Perder a informacao custa uma recomendacao imprecisa; insistir custa o
 * dentista.
 */
export const SEM_RESPOSTA = "sem_resposta";

/** Como cada topico aparece na ficha, em portugues de gente. */
export const TOPICO_PT: Record<Topico, string> = {
  anuncia: "se anuncia",
  verba: "quanto investe em anuncio",
  profissionais: "quantos profissionais atendem",
  quem_responde: "quem responde o WhatsApp",
  fora_do_horario: "o que acontece fora do horario",
  volume_perdido: "quantos pacientes sao perdidos",
};

export function ehTopico(valor: unknown): valor is Topico {
  return typeof valor === "string" && (TOPICOS as readonly string[]).includes(valor);
}

/**
 * Limpa o valor antes de guardar.
 *
 * `;` e `=` sao os separadores do formato — um valor que os contenha
 * corromperia a linha inteira e levaria junto os outros topicos. Cortar aqui e
 * mais barato que descobrir depois por que a ficha veio pela metade.
 *
 * O teto de tamanho existe pelo mesmo motivo do aposto na dor: isto e costurado
 * dentro da ficha que vai no prompt, e resposta longa vira relatorio.
 */
export const LIMITE_DO_VALOR = 40;

export function limparValor(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const limpo = bruto
    .replace(/[;=]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITE_DO_VALOR)
    .trim();
  return limpo.length > 0 ? limpo : null;
}

/** Le a coluna `descoberta` ("anuncia=instagram;profissionais=2"). */
export function lerDescoberta(
  texto: string | null | undefined,
): Partial<Record<Topico, string>> {
  const fora: Partial<Record<Topico, string>> = {};
  if (!texto) return fora;
  for (const par of texto.split(";")) {
    const corte = par.indexOf("=");
    if (corte < 1) continue;
    const chave = par.slice(0, corte).trim();
    const valor = limparValor(par.slice(corte + 1));
    if (ehTopico(chave) && valor) fora[chave] = valor;
  }
  return fora;
}

/** Escreve de volta, na ordem de TOPICOS para a coluna nao oscilar sozinha. */
export function escreverDescoberta(mapa: Partial<Record<Topico, string>>): string {
  return TOPICOS.filter((t) => mapa[t])
    .map((t) => `${t}=${mapa[t]}`)
    .join(";");
}

/**
 * Funde o que o extrator achou agora com o que ja estava guardado.
 *
 * A precedencia importa e nao e simetrica:
 *
 * - resposta de verdade SUBSTITUI `sem_resposta` — ele desconversou antes e
 *   contou depois, e a informacao nova e melhor que a ausencia;
 * - `sem_resposta` NUNCA apaga resposta de verdade — senao um turno em que o
 *   extrator nao enxergou o assunto apagaria o que ja se sabia, e a pergunta
 *   voltaria. Isso e o defeito, nao o conserto;
 * - o que nao veio no turno fica como estava.
 *
 * Mesma forma do `registrarSinais` da temperatura, e pelo mesmo motivo: quem
 * acumula estado de conversa nao pode depender de o modelo repetir tudo a cada
 * passada.
 */
export function registrarDescoberta(
  atual: string | null | undefined,
  novos: Record<string, unknown> | null | undefined,
): string {
  const mapa = lerDescoberta(atual);

  for (const [chave, bruto] of Object.entries(novos ?? {})) {
    if (!ehTopico(chave)) continue;
    const valor = typeof bruto === "string" ? limparValor(bruto) : null;
    if (!valor) continue;

    const jaTem = mapa[chave];
    if (valor === SEM_RESPOSTA && jaTem && jaTem !== SEM_RESPOSTA) continue;
    mapa[chave] = valor;
  }

  return escreverDescoberta(mapa);
}

/** Este assunto ja foi tratado? `sem_resposta` conta como tratado. */
export function jaPerguntado(
  descoberta: string | null | undefined,
  topico: Topico,
): boolean {
  return Boolean(lerDescoberta(descoberta)[topico]);
}

/** Tira acento e caixa. Linha sem caractere acentuado, como no interlocutor.ts. */
function semAcento(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
}

/**
 * COMO SE RECONHECE A JULIA PERGUNTANDO cada assunto.
 *
 * Fragmentos INTERROGATIVOS, nao substantivos soltos. "anuncio" sozinho nao
 * entra: ela fala de anuncio o tempo todo no argumento de venda ("cada paciente
 * que some levou junto o dinheiro do anuncio"), e isso e argumento, nao
 * pergunta. Foi exatamente esse tipo de palavra solta que ja tinha derrubado a
 * primeira versao do detector de handoff.
 */
const PERGUNTAS: Record<Topico, string[]> = {
  anuncia: [
    "voce anuncia",
    "vc anuncia",
    "voces anunciam",
    "chega a anunciar",
    "faz anuncio",
    "trabalha com anuncio",
    "roda anuncio",
    "anuncia no instagram",
    "anuncia no google",
  ],
  verba: [
    "quanto voce investe",
    "quanto investe",
    "quanto voces investem",
    "investe por mes",
    "quanto poe por mes",
  ],
  profissionais: [
    "quantos profissionais",
    "quantas pessoas atendem",
    "quantos dentistas",
    "voces sao quantos",
    "sao quantos ai",
  ],
  quem_responde: [
    "quem responde o whatsapp",
    "quem cuida do whatsapp",
    "quem atende o whatsapp",
    "quem responde as mensagens",
  ],
  fora_do_horario: [
    "quando chega mensagem",
    "chega mensagem a noite",
    "como fica no fim de semana",
    "e no fim de semana",
    "e quando e de noite",
  ],
  volume_perdido: [
    "quantos voce acha que somem",
    "quantos somem",
    "quantos pacientes somem",
    "quantos ficam sem resposta",
  ],
};

/**
 * O fragmento aparece dentro de uma PERGUNTA?
 *
 * Olha a frase em que ele caiu e confere se ela termina em "?". Sem isto, a
 * frase de argumento "quem responde o whatsapp hoje e voce, e isso custa
 * paciente" contaria como pergunta — e a Julia seria acusada de repetir algo
 * que ela nao perguntou.
 */
function dentroDePergunta(texto: string, posicao: number): boolean {
  const fim = texto.slice(posicao).search(/[.!?]/);
  if (fim === -1) return false; // frase sem pontuacao final: nao arrisca
  return texto[posicao + fim] === "?";
}

/** Quais assuntos ESTA mensagem pergunta. Vazio quando nao pergunta nenhum. */
export function topicosPerguntados(texto: string): Topico[] {
  const alvo = semAcento(texto ?? "");
  const achados: Topico[] = [];
  for (const topico of TOPICOS) {
    for (const fragmento of PERGUNTAS[topico]) {
      const onde = alvo.indexOf(semAcento(fragmento));
      if (onde !== -1 && dentroDePergunta(alvo, onde)) {
        achados.push(topico);
        break;
      }
    }
  }
  return achados;
}

/**
 * A CERCA: ela acabou de perguntar de novo algo que ja estava respondido?
 *
 * Devolve os topicos repetidos, para quem chama poder dizer QUAIS no alerta —
 * mesma razao do `pareceIrritado` devolver o sinal em vez de um booleano.
 *
 * Nao bloqueia a mensagem, e nao da para bloquear: quando isto roda, o texto
 * dela ja existe e reescrever a fala de um modelo por regex seria pior que o
 * defeito. O que ela faz e transformar uma regressao silenciosa em alarme na
 * central de vigia — que e o unico jeito de medir esta causa, porque ela vive
 * fora do alcance do teste.
 */
export function perguntasRepetidas(
  resposta: string,
  descoberta: string | null | undefined,
): Topico[] {
  const sabidos = lerDescoberta(descoberta);
  return topicosPerguntados(resposta).filter((t) => Boolean(sabidos[t]));
}

/**
 * O bloco da ficha. Devolve null quando nada foi perguntado ainda — linha vazia
 * na ficha e ruido, e o modelo preenche ruido com suposicao.
 */
export function blocoDaFicha(descoberta: string | null | undefined): string | null {
  const mapa = lerDescoberta(descoberta);
  const linhas = TOPICOS.filter((t) => mapa[t]).map((t) =>
    mapa[t] === SEM_RESPOSTA
      ? `  · ${TOPICO_PT[t]}: você já perguntou e ele NÃO respondeu — não pergunte de novo`
      : `  · ${TOPICO_PT[t]}: ${mapa[t]}`,
  );
  if (linhas.length === 0) return null;
  return [
    `- O que você JÁ perguntou nesta conversa (não repita nenhuma destas):`,
    ...linhas,
  ].join("\n");
}
