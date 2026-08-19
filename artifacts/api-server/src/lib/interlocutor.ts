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
 * SAO QUATRO FAMILIAS, e nao uma lista so. Sete conversas reais lidas em
 * 19/08/2026 mostraram que CINCO das sete clinicas responderam com automacao —
 * nao e excecao, e a maioria — e que cada uma se denuncia de um jeito:
 *
 *   1. ele DIZ que e automatico ("sou a assistente virtual", lead 59);
 *   2. ele te trata como PACIENTE ("Bem-vindo ao Consultorio... Em que podemos
 *      ajudar?", lead 43; "Sou a Dra. Gabrielly e sera um prazer te atender",
 *      lead 63);
 *   3. ele pede a FICHA do paciente (nome completo, raio-x, plano, lead 62);
 *   4. ele oferece um MENU de opcoes (leads 49 e 62).
 *
 * O lead 63 e o que decide o desenho: primeira pessoa, sem menu, sem emoji em
 * serie, assinado com o nome da dentista. Nenhuma marca de FORMA o pega. O que
 * o entrega e o CONTEUDO — atendimento a paciente oferecido a quem acabou de se
 * apresentar como vendedora. Por isso a familia 2 existe, e por isso ela nao
 * depende de menu nenhum.
 *
 * Note o que NAO esta aqui: "atendente", "secretaria", "recepcao" soltos. Um
 * dentista responde "quem responde e a minha atendente" numa descoberta normal,
 * e isso e resposta de gente, nao assinatura de robo. Foi esse tipo de palavra
 * solta que ja tinha derrubado a versao antiga do detector de handoff. Pelo
 * mesmo motivo ficou de fora "em que posso ajudar" no singular: e exatamente o
 * que um dentista de verdade escreve ao receber uma abordagem fria. So a forma
 * corporativa no plural ("podemos") entra.
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
 * FAMILIA 2 — a saudacao de vitrine: ele te trata como PACIENTE.
 *
 * E a familia que pega o lead 63, e a unica que nao depende de forma nenhuma.
 * Cada frase daqui passou por uma pergunta so: um dentista escreveria isto
 * respondendo a uma vendedora que acabou de se apresentar? "Bem-vindo ao
 * consultorio" e "sera um prazer te atender" nao — sao ditos a quem vai sentar
 * na cadeira. E por isso que a lista e curta: quem entra aqui nao pode ter
 * leitura de gente.
 */
export const SINAIS_DE_ATENDIMENTO_A_PACIENTE = [
  "seja bem-vindo",
  "seja bem vindo",
  "seja bem-vinda",
  "seja bem vinda",
  "bem-vindo ao",
  "bem vindo ao",
  "bem-vinda ao",
  "bem vinda ao",
  "bem-vindo a clinica",
  "bem vindo a clinica",
  "bem-vinda a clinica",
  "bem vinda a clinica",
  "em que podemos ajudar",
  "em que podemos te ajudar",
  "no que podemos ajudar",
  "no que podemos te ajudar",
  "como podemos ajudar",
  "como podemos te ajudar",
  "sera um prazer te atender",
  "sera um prazer atender",
  "prazer em te atender",
  "agendar sua consulta",
  "agendar sua avaliacao",
];

/**
 * FAMILIA 3 — a ficha do paciente, e ela so vale NO PLURAL.
 *
 * Cada item sozinho tem leitura honesta: uma recepcionista de carne e osso
 * pergunta "seu nome completo?" sem ser robo nenhum. O que nao tem leitura
 * honesta e o CONJUNTO — nome completo E raio-x E plano de saude na mesma
 * mensagem e formulario de triagem, e formulario nao se escreve a mao para
 * quem acabou de se apresentar como vendedora (lead 62).
 *
 * Por isso a regra e "dois itens diferentes", e nao "um item": e a mesma
 * disciplina da peneira de sinais — o que sustenta a classificacao e a
 * coerencia entre pedacos, nunca um pedaco isolado.
 */
export const DADOS_DE_PACIENTE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["nome completo", ["nome completo"]],
  ["data de nascimento", ["data de nascimento", "data de nasc"]],
  [
    "raio-x",
    ["raio-x", "raio x", "radiografia", "panoramica", "documentacao ortodontica"],
  ],
  [
    "plano de saude",
    ["plano de saude", "plano odontologico", "qual convenio", "seu convenio"],
  ],
  ["cpf", ["cpf"]],
  [
    "queixa",
    ["esta sentindo dor", "qual a sua queixa", "qual sua queixa", "qual o procedimento"],
  ],
  [
    "primeira consulta",
    ["primeira consulta", "primeira vez na clinica", "ja e paciente", "ja foi atendido"],
  ],
];

/**
 * FAMILIA 4 — o menu, reconhecido pela FORMA e nao por palavra.
 *
 * A lista fixa so pegava menu que trazia junto o "digite 1". O lead 49 nao
 * trazia: era script mais opcoes, e passou inteiro. Aqui a marca e estrutural —
 * duas ou mais linhas comecando por numero com separador, ou tres ou mais
 * comecando por marcador.
 *
 * Numero pede DUAS linhas e marcador pede TRES de proposito: "1 - Valores /
 * 2 - Agendamento" nao tem outra leitura, mas duas linhas abertas por travessao
 * sao um jeito comum de gente listar duas perguntas no WhatsApp. O custo de
 * errar aqui e alto — a Julia responderia a um dentista de verdade dizendo que
 * percebeu o automatico —, entao o marcador paga uma linha a mais de prova.
 */
const LINHA_NUMERADA = /^\s*\(?\d{1,2}\)?\s*[-–—).:]\s*\S/;
const LINHA_COM_MARCADOR = /^\s*[*+•▪◦‣·]\s+\S|^\s*-\s+\S/;
const NUMERO_EMOJI = /^\s*[0-9#]️?⃣\s*\S/;

/**
 * Devolve a descricao do menu encontrado, ou null. Descricao e nao booleano
 * pelo mesmo motivo do resto do arquivo: o log precisa dizer QUAL regra
 * classificou a conversa como robo.
 */
export function temMenuDeOpcoes(texto: string): string | null {
  let numeradas = 0;
  let marcadas = 0;
  for (const linha of texto.split(/\r?\n/)) {
    if (LINHA_NUMERADA.test(linha) || NUMERO_EMOJI.test(linha)) numeradas++;
    else if (LINHA_COM_MARCADOR.test(linha)) marcadas++;
  }
  if (numeradas >= 2) return `menu numerado (${numeradas} opcoes)`;
  if (marcadas >= 3) return `menu com marcadores (${marcadas} itens)`;
  return null;
}

/**
 * Devolve quais dados de paciente foram pedidos na mesma mensagem, ou null
 * quando foi menos de dois. Ver DADOS_DE_PACIENTE para o porque do plural.
 */
export function pedeFichaDePaciente(texto: string): string | null {
  const alvo = semAcento(texto);
  const achados: string[] = [];
  for (const [nome, formas] of DADOS_DE_PACIENTE) {
    if (formas.some((f) => alvo.includes(semAcento(f)))) achados.push(nome);
  }
  return achados.length >= 2 ? `ficha de paciente: ${achados.join(" + ")}` : null;
}

/**
 * Procura um sinal no texto e devolve QUAL bateu (ou null).
 *
 * Devolve o sinal, e nao um booleano, pelo mesmo motivo do `pareceIrritado`:
 * quem loga precisa dizer qual regra classificou a conversa como robo. Se um
 * dentista de verdade for classificado por engano, o log aponta a linha que
 * precisa mudar — sem isso, sobra "achei que era robo" sem nada que sustente.
 *
 * A ordem das familias e a ordem da confianca: primeiro o que ele diz DE SI,
 * depois o que ele diz DE VOCE, depois a ficha, por ultimo a forma.
 */
export function pareceAssistenteVirtual(texto: string): string | null {
  const alvo = semAcento(texto);
  for (const sinal of SINAIS_DE_ASSISTENTE_VIRTUAL) {
    if (alvo.includes(semAcento(sinal))) return sinal;
  }
  for (const sinal of SINAIS_DE_ATENDIMENTO_A_PACIENTE) {
    if (alvo.includes(semAcento(sinal))) return sinal;
  }
  return pedeFichaDePaciente(texto) ?? temMenuDeOpcoes(texto);
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

/**
 * O NOME QUE APARECE NUM AUTOMATICO NAO E O NOME DE QUEM ESTA FALANDO.
 *
 * O `nomeFoiDito` acima pergunta "esta escrito?". Falta a outra metade: QUEM
 * escreveu. "Bem-vindo ao Consultorio Dr. Romulo" tem "Romulo" escrito, e o
 * lead 43 ficou com "Dr. Romulo" gravado como se o dentista tivesse se
 * apresentado; "Sou a Dra. Gabrielly e sera um prazer te atender" fez o mesmo
 * no lead 63. Nos dois casos o nome e o da PLACA da clinica, nao o da pessoa —
 * e nao havia pessoa nenhuma.
 *
 * A peneira e por MENSAGEM, e nao pelo lead, de proposito: quando alguem da
 * equipe assume a conversa depois do robo, o que essa pessoa escrever continua
 * valendo. Barrar o lead inteiro deixaria o nome preso pelo resto da vida dele
 * — o defeito que a Rodada 53 ja tinha consertado no outro sentido.
 */
export function textosDePessoa(textos: string[]): string[] {
  return textos.filter((t) => pareceAssistenteVirtual(t ?? "") === null);
}

/**
 * Este nome pode ser gravado?
 *
 * Nao, enquanto do outro lado houver um robo. E a segunda metade da peneira
 * acima, e as duas sao precisas: a peneira cobre a mensagem que se denuncia
 * sozinha, esta cobre o automatico que manda uma linha curta e limpa ("Dra.
 * Gabrielly") logo depois de outra que se denunciou. Mesma forma das travas
 * vizinhas, de proposito — quem le uma le todas.
 */
export function podeGravarNome(interlocutor: Interlocutor): boolean {
  return interlocutor !== "assistente_virtual";
}

/**
 * Ja falamos com este automatico, e ele acaba de responder de novo?
 *
 * O prompt manda "e UMA mensagem so" e "se o automatico responder de novo, nao
 * insista" desde 18/08/2026, e mesmo assim o lead 59 rendeu sete minutos de
 * ping-pong entre duas IAs. Instrucao nao e trava: enquanto chegar mensagem, o
 * webhook gera resposta, e o modelo obedece ao turno que tem na frente.
 *
 * O carimbo mora numa COLUNA (`vitrineEnviadaEm`), e nao numa conta do
 * historico, porque o historico e uma janela de 20 mensagens: num vai-e-vem de
 * robo com robo a primeira resposta sai da janela e a trava sumiria junto,
 * justo no caso que ela existe para cortar.
 *
 * E A PORTA DE SAIDA E O TEXTO QUE ACABOU DE CHEGAR, e nao a coluna
 * `interlocutor`. E a parte que precisa ser dita, porque a versao obvia esta
 * errada: calar enquanto o lead estiver marcado como robo deixaria a conversa
 * MORTA para sempre. Quem muda essa coluna e o extrator, e o extrator so roda
 * nos turnos que produzem resposta — calando, ninguem mais reclassificaria
 * ninguem, e a pessoa que assumisse o WhatsApp depois falaria com o silencio.
 *
 * Entao a trava e por MENSAGEM, que e como o dono a descreveu: "se o robo
 * responder de novo, ela espera a pessoa". Mensagem com marca de automatico —
 * silencio. Mensagem sem marca nenhuma — pode ser gente, e o turno corre
 * inteiro: responde e reclassifica. Errar para o lado de responder a um robo
 * uma vez a mais custa uma mensagem; errar para o outro custa o lead.
 */
export function esperandoAPessoa(
  interlocutor: Interlocutor,
  vitrineEnviadaEm: Date | string | null | undefined,
  textoRecebido: string,
): boolean {
  return (
    interlocutor === "assistente_virtual" &&
    Boolean(vitrineEnviadaEm) &&
    pareceAssistenteVirtual(textoRecebido) !== null
  );
}
