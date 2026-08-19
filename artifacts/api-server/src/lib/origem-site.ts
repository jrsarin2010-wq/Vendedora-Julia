/**
 * ELE VEIO DA LANDING? (Rodada 35)
 *
 * O botão flutuante de captaclin.com.br abre o WhatsApp com uma mensagem JÁ
 * ESCRITA:
 *
 *     Oi! Vim pelo site do CaptaClin e tenho uma dúvida
 *
 * Essa frase é o ÚNICO fio que liga os dois projetos. A landing é outro
 * repositório, outro deploy, outro banco — não há webhook, API nem parâmetro
 * chegando de lá, só o texto que o dentista aperta "enviar". O documento da
 * tarefa da landing diz isso com todas as letras ("não altere esse texto sem
 * avisar; o atendimento do outro lado usa essa frase para identificar que a
 * pessoa veio da landing"). Este arquivo é o outro lado dessa combinação.
 *
 * Por que isso importa tanto: quem clica ali acabou de ler a página inteira —
 * viu os três planos, os preços e as listas de recursos. Ele não veio descobrir
 * o que o CaptaClin faz, veio porque alguma coisa na página não respondeu.
 * Tratá-lo como quem nunca viu nada faz a Júlia recitar de volta o que ele
 * acabou de ler.
 *
 * O casamento é por ASSINATURA e não por igualdade: muita gente digita a
 * pergunta logo depois da frase pronta, apaga o "Oi!" ou troca a pontuação. O
 * que sobrevive a tudo isso é "vim pelo site". Aceitamos também "vim do site",
 * que é como alguém escreveria à mão — e que, quando escrito, é igualmente
 * verdade.
 *
 * O risco do falso positivo é praticamente zero: ninguém diz "vim pelo site"
 * sem ter vindo do site. O do falso NEGATIVO (ele apagou tudo e escreveu do
 * zero) é real, e é aceitável: cai no comportamento de antes desta rodada.
 */

/** A frase exata que a landing pré-preenche. Mudou lá? Mude aqui junto. */
export const MENSAGEM_DO_BOTAO_DO_SITE =
  "Oi! Vim pelo site do CaptaClin e tenho uma dúvida";

/**
 * O valor gravado em `leads.origin` para quem chegou por ali. Fora da lista de
 * origens de prospecção ("import", "maps", "instagram") de propósito: aquelas
 * dizem onde NÓS o encontramos, esta diz que ELE nos procurou — e já leu tudo.
 */
export const ORIGEM_SITE = "site";

/**
 * AS ORIGENS DE QUEM CHEGOU SOZINHO — ele mandou mensagem do nada.
 *
 * "whatsapp" e o que o webhook grava quando nao ha assinatura da landing;
 * "inbound" e o valor antigo, e continua aqui porque lead velho ainda o tem.
 * Nulo entra junto: e o mesmo caso, escrito de outro jeito.
 */
export const ORIGENS_DE_QUEM_CHEGOU_SOZINHO = ["whatsapp", "inbound"] as const;

export function chegouSozinho(origin: string | null | undefined): boolean {
  return (
    !origin || (ORIGENS_DE_QUEM_CHEGOU_SOZINHO as readonly string[]).includes(origin)
  );
}

/**
 * ELE VEIO ATE NOS? (MODO A) ou fomos NOS que fomos ate ele? (MODO B)
 *
 * A regra vivia INLINE dentro do `buildLeadBriefing`, escrita uma vez e usada
 * uma vez — e ficou impossivel de conferir de fora no dia em que a medicao
 * precisou do mesmo recorte. Virou funcao com nome pelo mesmo motivo do
 * `ehPessoa`: o que decide comportamento tem que ter onde ser lido e testado.
 *
 * MODO A e quem nos procurou: chegou sozinho pelo WhatsApp, ou clicou no botao
 * da landing. MODO B e todo o resto ("maps", "import", "instagram") — origens
 * que dizem onde NOS o encontramos.
 */
export function ehModoA(origin: string | null | undefined): boolean {
  return chegouSozinho(origin) || origin === ORIGEM_SITE;
}

/**
 * Minúsculas, sem acento, espaços colapsados. A faixa ̀-ͯ é a dos
 * sinais diacríticos que o NFD separa da letra — mesma limpeza que o webhook
 * já faz nas palavras-chave de handoff.
 */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ASSINATURAS = ["vim pelo site", "vim do site"];

/** A mensagem carrega a assinatura do botão da landing? */
export function veioDaLanding(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const limpo = normalizar(texto);
  return ASSINATURAS.some((a) => limpo.includes(a));
}
