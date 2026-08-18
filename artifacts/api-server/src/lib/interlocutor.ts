/**
 * DE QUEM E O FATO — quem esta do outro lado, e de quem e o nome que apareceu.
 *
 * O sistema inteiro presumia que quem digita e o dentista dono da clinica.
 * Tres conversas reais mostraram o custo dessa presuncao:
 *
 * - quem se apresentou como "da equipe da Dra. Liliane" virou "Dra. Rosane" —
 *   nome de terceiro colhido como se fosse o de quem escreve, e ainda por cima
 *   trocado;
 * - uma assistente virtual chamada "RF" virou "Dr. Romero" e "senhor";
 * - um bot institucional conversou 7 minutos e o lead foi marcado como QUENTE,
 *   porque o menu automatico dele ("...falar com um atendente") bateu na lista
 *   de handoff e valeu 30 pontos de temperatura, o piso da faixa quente.
 *
 * Arquivo so de DECISAO, sem banco e sem rede, no mesmo espirito do
 * temperatura.ts e do outreach.ts: tudo aqui e funcao pura e testavel.
 */

/**
 * Quem esta do outro lado. Lista FECHADA — valor fora dela e tratado como
 * "nao sei", nunca como verdade.
 *
 * `nao_sei` e o padrao, e e o ponto: a ausencia de informacao tem que ser
 * dizivel. Sem ele, "nao sei" e "e o dono" viram o mesmo valor nulo, e o
 * modelo preenche o vazio com a suposicao mais comoda.
 */
export const INTERLOCUTORES = [
  "dentista_dono",
  "equipe",
  "assistente_virtual",
  "nao_sei",
] as const;

export type Interlocutor = (typeof INTERLOCUTORES)[number];

export function ehInterlocutorValido(valor: unknown): valor is Interlocutor {
  return (
    typeof valor === "string" && (INTERLOCUTORES as readonly string[]).includes(valor)
  );
}

/** Le a coluna do lead. Nulo, vazio ou valor desconhecido viram "nao_sei". */
export function lerInterlocutor(valor: string | null | undefined): Interlocutor {
  return ehInterlocutorValido(valor) ? valor : "nao_sei";
}

/** Tira acento e caixa. Mesma normalizacao do atencao.ts, pelo mesmo motivo. */
export function semAcento(s: string): string {
  // \p{Mn} sao as marcas combinantes que o NFD separa da letra: e a mesma
  // faixa que o \u0300-\u036f do atencao.ts, escrita pela propriedade em vez
  // de pelos numeros. A regra fica legivel e a LINHA fica sem nenhum caractere
  // acentuado, que e o que impede uma reescrita do arquivo em outra
  // codificacao de transformar a regra em lixo silencioso (ja aconteceu neste
  // repo com o julia-persona.ts).
  return s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
}

/**
 * O QUE DENUNCIA UM ATENDIMENTO AUTOMATICO na primeira mensagem.
 *
 * Existe porque o extrator roda DEPOIS da resposta: se o unico detector fosse
 * ele, a primeira resposta ao robo sairia cega, e e justamente ela que precisa
 * acertar. Mesmo desenho de duas camadas da irritacao e do opt-out — a lista
 * fixa e rapida e literal, o modelo pega o que ela nao alcanca.
 *
 * Note o que NAO esta aqui: "atendente", "secretaria", "recepcao" soltos. Um
 * dentista responde "quem responde e a minha atendente" numa descoberta normal,
 * e isso e resposta de gente, nao assinatura de robo. Foi esse tipo de palavra
 * solta que ja tinha derrubado a versao antiga do detector de handoff.
 */
export const SINAIS_DE_ASSISTENTE_VIRTUAL = [
  "assistente virtual",
  "sou um assistente",
  "sou uma assistente",
  "sou um robo",
  "atendimento automatico",
  "atendimento automatizado",
  "resposta automatica",
  "mensagem automatica",
  "este e um canal automatico",
  "nao responda esta mensagem",
  "nao responda essa mensagem",
  "digite 1",
  "digite o numero",
  "escolha uma das opcoes",
  "selecione uma opcao",
  "menu de atendimento",
  "horario de atendimento: seg",
];

/**
 * Procura um sinal no texto e devolve QUAL bateu (ou null).
 *
 * Devolve o sinal, e nao um booleano, pelo mesmo motivo do `pareceIrritado`:
 * quem loga precisa dizer qual regra classificou a conversa como robo. Se um
 * dentista de verdade for classificado por engano, o log aponta a linha que
 * precisa mudar — sem isso, sobra "achei que era robo" sem nada que sustente.
 */
export function pareceAssistenteVirtual(texto: string): string | null {
  const alvo = semAcento(texto);
  for (const sinal of SINAIS_DE_ASSISTENTE_VIRTUAL) {
    if (alvo.includes(semAcento(sinal))) return sinal;
  }
  return null;
}

/**
 * A CERCA DO NOME: este nome foi mesmo DITO por ele?
 *
 * O extrator devolvia qualquer string e o codigo gravava com um `.trim()`. A
 * instrucao "nao invente nada" existe no prompt dele desde sempre — e mesmo
 * assim saiu "Rosane" de uma conversa onde ninguem escreveu "Rosane". Instrucao
 * de modelo nao e cerca; isto e.
 *
 * `textosRecebidos` sao SO as mensagens DELE. Passar as falas da Julia junto
 * abriria o buraco de novo pelo outro lado: ela chuta "Dr. Romero" numa
 * mensagem, o extrator le a propria fala dela na conversa seguinte e o chute
 * vira fato gravado.
 *
 * ATENCAO ao que esta cerca NAO faz: ela nao decide de QUEM e o nome. "Sou da
 * equipe da Dra. Liliane" contem "Liliane", entao passa aqui. Esse caso e
 * barrado pela regra de autoria no prompt do extrator e pelo interlocutor —
 * as tres protecoes cobrem coisas diferentes, e e por isso que sao tres.
 */
export function nomeFoiDito(
  nome: string | null | undefined,
  textosRecebidos: string[],
): boolean {
  if (!nome || !nome.trim()) return false;
  const alvo = semAcento(nome.trim());
  if (alvo.length < 2) return false;
  return textosRecebidos.some((t) => semAcento(t ?? "").includes(alvo));
}

/**
 * Do outro lado ha uma PESSOA?
 *
 * E a pergunta que decide se uma frase conta como ato dele. O bloco de handoff
 * escreve `status: "hot"` direto no lead, sem passar pela temperatura — entao a
 * trava do termometro sozinha nao o alcanca, e um menu que dissesse "falar com
 * uma pessoa" promoveria o robo a quente por fora. Descoberto pela sabotagem da
 * propria cerca, e nao por leitura: e o tipo de caminho lateral que so aparece
 * quando se desliga a protecao e se olha o que sobra.
 */
export function ehPessoa(interlocutor: Interlocutor): boolean {
  return interlocutor !== "assistente_virtual";
}

/**
 * Esta conversa pode mexer no termometro?
 *
 * Nao, quando do outro lado ha um robo. E a trava que nao depende do modelo:
 * qualquer que seja o sinal que dispare — preco, recurso, ate o pedido de
 * atendente do menu — palavra de automatico nao esquenta lead nenhum. Barrar
 * aqui, num lugar so, vale mais do que cacar palavra por palavra na lista de
 * cada detector.
 */
export function podePontuarTemperatura(interlocutor: Interlocutor): boolean {
  return interlocutor !== "assistente_virtual";
}

/**
 * Esta conversa merece uma leva de follow-up?
 *
 * Nao, com robo do outro lado (decisao do dono, 17/08/2026): a Julia responde
 * UMA vez — bem, porque o dentista pode ler a conversa depois — e para. Os
 * toques cairiam no mesmo automatico, que responderia de novo, e a Julia de
 * novo: ping-pong de robo com robo gastando credito de modelo dos dois lados.
 *
 * Nao e beco sem saida: quando uma pessoa assumir a conversa, o interlocutor
 * muda na passada seguinte e a cadencia normal arma sozinha, porque o webhook
 * arma a leva a cada resposta dele.
 */
export function mereceFollowUp(interlocutor: Interlocutor): boolean {
  return interlocutor !== "assistente_virtual";
}
