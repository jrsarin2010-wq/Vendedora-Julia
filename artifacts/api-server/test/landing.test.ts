/**
 * RODADA 35 — o dentista que vem da landing.
 *
 * O contexto que muda tudo: quem clica no botão do site acabou de ler a página
 * inteira. Viu os três planos, os preços, as listas de recursos. Ele não veio
 * descobrir o que o CaptaClin faz — veio porque algo na página não respondeu.
 *
 * Três coisas estão sob teste aqui:
 *
 * 1. O reconhecimento. A frase pré-preenchida do botão é o ÚNICO fio entre a
 *    landing e este projeto: se ela deixar de ser reconhecida, as três
 *    correções desta rodada morrem em silêncio, sem erro nenhum no log.
 * 2. O que a ficha e o prompt dizem sobre não repetir a página.
 * 3. A dúvida que fez ele clicar — gravada só para quem veio do site, só uma
 *    vez, e contada certo no painel.
 *
 * A rapidez da primeira resposta (correção 1) mora em digitacao.test.ts, junto
 * do resto do cálculo de digitação; aqui fica só a prova de que o webhook
 * levanta o sinalizador na hora certa.
 */
import { ok, secao, fim } from "./assert";
import { chamarRota } from "./rota";
import { post, chamar, evento } from "./driver";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";
import {
  JULIA_SYSTEM_PROMPT,
  JULIA_EXTRACTION_PROMPT,
  buildLeadBriefing,
} from "../src/julia-persona";
import { readFileSync } from "node:fs";
import {
  chegouSozinho,
  ehModoA,
  MENSAGEM_DO_BOTAO_DO_SITE,
  ORIGENS_DE_QUEM_CHEGOU_SOZINHO,
  ORIGEM_SITE,
  veioDaLanding,
} from "../src/lib/origem-site";
import { contarAssuntos, limparAssunto } from "../src/lib/duvidas-do-site";
import statsRouter from "../src/routes/stats";

const NUMERO = "5585999998888";

const ficha = (origin: string | null) =>
  buildLeadBriefing({
    name: "Carlos",
    funnelStage: "new",
    painPoints: null,
    mainObjection: null,
    planInterest: null,
    daysSinceLastMessage: 0,
    isReturning: false,
    totalMessages: 1,
    origin,
  });

/** Monta a resposta do extrator com o campo novo. */
const extracao = (duvidaDoSite: string | null) =>
  JSON.stringify({
    painPoints: null,
    mainObjection: null,
    name: null,
    planInterest: null,
    funnelStage: null,
    isCustomer: false,
    wantsToStop: false,
    irritado: false,
    duvidaDoSite,
  });

/** Acha o handler pelo método e caminho, sem depender da ordem de registro. */
function acharRota(router: unknown, metodo: string, caminho: string) {
  const camada = (router as any).stack.find(
    (l: any) => l.route?.path === caminho && l.route?.methods?.[metodo],
  );
  if (!camada) throw new Error(`Rota ${metodo.toUpperCase()} ${caminho} não existe`);
  return camada.route.stack[camada.route.stack.length - 1].handle;
}

// ── CORREÇÃO 1 (a ponta que vive no webhook) ───────────────────────────────

secao("correção 1 — a primeira resposta sai com o sinalizador de pressa");
{
  ctrl.reply = "Oi! Sou a Júlia. Me conta qual é a dúvida que eu te ajudo.";
  await post(evento(MENSAGEM_DO_BOTAO_DO_SITE, NUMERO));
  ok("respondeu", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
  ok(
    "e marcou como primeira resposta (teto de 3s em vez de 12s)",
    wa.enviadas[0]?.primeiraResposta === true,
    String(wa.enviadas[0]?.primeiraResposta),
  );
}

secao("correção 1 — da segunda mensagem em diante o ritmo humano volta");
{
  ctrl.reply = "A recarga é 200 conversas por R$97, e não mexe na mensalidade.";
  await chamar(evento("e a recarga, como funciona?", NUMERO));
  ok("respondeu de novo", wa.enviadas.length === 2, JSON.stringify(wa.enviadas));
  ok(
    "sem o sinalizador desta vez",
    wa.enviadas[1]?.primeiraResposta === false,
    String(wa.enviadas[1]?.primeiraResposta),
  );
}

secao("correção 1 — vale para qualquer primeira mensagem, não só a da landing");
{
  // O motivo da pressa é ele estar OLHANDO a tela, e isso é verdade em toda
  // primeira troca. Amarrar a correção à landing deixaria de fora quem chega
  // pelo Instagram e faz exatamente a mesma coisa.
  ctrl.reply = "Oi! Aqui é a Júlia, do CaptaClin. Como posso te chamar?";
  await post(evento("oi", "5511911112222"));
  ok(
    "um 'oi' qualquer também é primeira resposta",
    wa.enviadas[0]?.primeiraResposta === true,
    String(wa.enviadas[0]?.primeiraResposta),
  );
}

// ── O reconhecimento da landing ────────────────────────────────────────────

secao("a frase do botão do site é reconhecida");
ok("a mensagem exata do botão", veioDaLanding(MENSAGEM_DO_BOTAO_DO_SITE));
ok("sem acento", veioDaLanding("Oi! Vim pelo site do CaptaClin e tenho uma duvida"));
ok("em caixa alta", veioDaLanding("OI! VIM PELO SITE DO CAPTACLIN E TENHO UMA DÚVIDA"));
ok(
  "com a pergunta emendada depois (o mais comum de todos)",
  veioDaLanding(
    "Oi! Vim pelo site do CaptaClin e tenho uma dúvida sobre a recarga de conversas",
  ),
);
ok('com o "Oi!" apagado', veioDaLanding("vim pelo site do CaptaClin, tenho uma dúvida"));
ok('escrito à mão como "vim do site"', veioDaLanding("vim do site de vocês"));

secao("e não é reconhecida onde não deve");
ok("mensagem comum não vira lead de site", !veioDaLanding("oi, quanto custa?"));
ok(
  'falar de "site" não basta — tem que ser ele dizendo que VEIO de lá',
  !veioDaLanding("vocês têm site? queria dar uma olhada"),
);
ok("texto vazio", !veioDaLanding(""));
ok("nulo não estoura", !veioDaLanding(null));

// ── CORREÇÃO 2 — a origem e a ficha ────────────────────────────────────────

secao("correção 2 — quem manda a frase do botão nasce com origem de site");
{
  ctrl.reply = "Claro! Me conta o que ficou faltando na página.";
  await post(evento(MENSAGEM_DO_BOTAO_DO_SITE, NUMERO));
  ok("criou o lead", state.leads.length === 1, JSON.stringify(state.leads));
  ok(
    'a origem é "site"',
    state.leads[0]?.origin === ORIGEM_SITE,
    String(state.leads[0]?.origin),
  );
}

secao("correção 2 — quem chega com um 'oi' continua sendo whatsapp");
{
  ctrl.reply = "Oi! Aqui é a Júlia. Como posso te chamar?";
  await post(evento("oi, tudo bem?", NUMERO));
  ok(
    'a origem continua "whatsapp"',
    state.leads[0]?.origin === "whatsapp",
    String(state.leads[0]?.origin),
  );
}

secao("correção 2 — a origem de quem já existe NÃO é sobrescrita");
{
  // Um lead de prospecção tem origem "instagram"/"import", e é ela que autoriza
  // a Júlia a dizer onde viu a clínica. Trocar isso por "site" apagaria uma
  // verdade para gravar outra.
  state.reset();
  wa.reset();
  state.leads.push({
    id: 1,
    phone: NUMERO,
    name: "Marina",
    origin: "instagram",
    status: "warm",
    funnelStage: "contacted",
    outreachStatus: "sent",
    atencao: null,
    createdAt: new Date(),
  });
  ctrl.reply = "Oi, Dra. Marina! Me conta, qual a dúvida?";
  await chamar(evento(MENSAGEM_DO_BOTAO_DO_SITE, NUMERO));
  ok(
    'continua "instagram"',
    state.leads[0]?.origin === "instagram",
    String(state.leads[0]?.origin),
  );
}

secao("correção 2 — a ficha avisa que ele já leu a página");
ok(
  "diz que ele clicou no botão de dentro da página",
  ficha(ORIGEM_SITE).includes("DENTRO da página do CaptaClin"),
);
ok("diz que ele JÁ LEU", ficha(ORIGEM_SITE).includes("JÁ LEU a página"));
ok(
  "nomeia o que ele já viu: planos, preços e recursos",
  ficha(ORIGEM_SITE).includes("viu os três planos, os preços e as listas de recursos"),
);
ok("manda não repetir", ficha(ORIGEM_SITE).includes("NÃO repita isso para ele"));
ok(
  "e diz qual é o valor dela aqui",
  ficha(ORIGEM_SITE).includes("qual plano serve para a clínica DELE"),
);
ok(
  "não manda ela dizer que não sabe de onde ele veio",
  !ficha(ORIGEM_SITE).includes("Não invente origem"),
);
ok(
  'nem cai no "pode citar" genérico das origens de prospecção',
  !ficha(ORIGEM_SITE).includes("pode citar, é verdade"),
);

secao("correção 2 — as outras origens não mudaram");
ok("quem chegou sozinho continua igual", ficha("whatsapp").includes("Não invente origem"));
ok("instagram continua citável", ficha("instagram").includes("(pode citar, é verdade)"));
ok(
  "e nenhuma delas ganhou o aviso da landing",
  !ficha("whatsapp").includes("JÁ LEU a página") &&
    !ficha("instagram").includes("JÁ LEU a página"),
);

secao("correção 2 — a regra está no prompt, dentro do MODO A");
ok(
  "existe o bloco de quem vem do site",
  JULIA_SYSTEM_PROMPT.includes("QUEM VEM DO SITE JÁ LEU A PÁGINA"),
);
ok(
  "manda NÃO repetir a página",
  JULIA_SYSTEM_PROMPT.includes("NÃO repita a página"),
);
ok(
  "diz por que repetir é ruim (parece atendimento automático)",
  JULIA_SYSTEM_PROMPT.includes("faz a conversa parecer atendimento automático"),
);
ok(
  "manda perguntar ANTES de listar plano",
  JULIA_SYSTEM_PROMPT.includes("Quando ele perguntar sobre planos, não liste tudo de novo") &&
    JULIA_SYSTEM_PROMPT.includes("descubra a situação dele e devolva a recomendação"),
);
ok(
  "e recomendar UM plano só",
  JULIA_SYSTEM_PROMPT.includes("recomende UM plano, com o preço e o porquê"),
);
ok(
  "a exceção: pergunta específica se responde primeiro",
  JULIA_SYSTEM_PROMPT.includes(
    "Se ele fizer uma pergunta específica (recarga, contrato, LGPD, como funciona a",
  ) && JULIA_SYSTEM_PROMPT.includes("RESPONDA direto e com segurança"),
);
ok(
  "o bloco está no MODO A (antes do MODO B começar)",
  JULIA_SYSTEM_PROMPT.indexOf("QUEM VEM DO SITE JÁ LEU A PÁGINA") >
    JULIA_SYSTEM_PROMPT.indexOf("MODO A — ELE CHAMOU VOCÊ") &&
    JULIA_SYSTEM_PROMPT.indexOf("QUEM VEM DO SITE JÁ LEU A PÁGINA") <
      JULIA_SYSTEM_PROMPT.indexOf("MODO B — VOCÊ CHAMOU ELE"),
);
ok(
  "o cabeçalho do MODO A reconhece o lead de site",
  JULIA_SYSTEM_PROMPT.includes("ou que ele veio do site"),
);

// ── CORREÇÃO 3 — a dúvida que fez ele clicar ───────────────────────────────

secao("correção 3 — o extrator ganhou o campo");
ok(
  "o JSON pede duvidaDoSite",
  JULIA_EXTRACTION_PROMPT.includes('"duvidaDoSite": "<assunto em 2 a 4 palavras, ou null>"'),
);
ok(
  "pede o ASSUNTO, não a frase dele",
  JULIA_EXTRACTION_PROMPT.includes("Use o assunto, não a frase dele"),
);
ok(
  "só a PRIMEIRA dúvida — é a que fez ele clicar",
  JULIA_EXTRACTION_PROMPT.includes(
    "Registre só a PRIMEIRA dúvida da conversa — é a que fez ele clicar",
  ),
);
ok(
  "null quando ele não veio do site",
  JULIA_EXTRACTION_PROMPT.includes("null quando ele não veio do site"),
);
ok(
  "dá exemplos de assunto",
  JULIA_EXTRACTION_PROMPT.includes('"recarga de conversas"') &&
    JULIA_EXTRACTION_PROMPT.includes('"contrato e fidelidade"'),
);

secao("correção 3 — limpeza do assunto antes de guardar");
ok("caixa não importa", limparAssunto("Recarga De Conversas") === "recarga de conversas");
ok("ponto final sai", limparAssunto("recarga de conversas.") === "recarga de conversas");
ok("aspas saem", limparAssunto('"contrato e fidelidade"') === "contrato e fidelidade");
ok("espaço sobrando some", limparAssunto("  recarga   de conversas  ") === "recarga de conversas");
ok("string vazia vira null", limparAssunto("") === null);
ok("nulo continua nulo", limparAssunto(null) === null);
ok('"null" escrito como texto também é nada', limparAssunto("null") === null);
ok(
  "frase inteira é recusada (o prompt pede 2 a 4 palavras)",
  limparAssunto(
    "ele quis saber se dá pra adicionar outro dentista no plano básico depois",
  ) === null,
);
ok("mas 5 palavras ainda passa", limparAssunto("como funciona o trial grátis") !== null);

secao("correção 3 — a contagem do painel");
{
  const contagem = contarAssuntos([
    "recarga de conversas",
    "Recarga de conversas",
    "recarga de conversas.",
    "contrato e fidelidade",
    null,
    "",
    "profissional adicional",
    "profissional adicional",
  ]);
  ok("três assuntos distintos", contagem.length === 3, JSON.stringify(contagem));
  ok(
    "a variação de caixa e pontuação conta junto, não separado",
    contagem[0].assunto === "recarga de conversas" && contagem[0].total === 3,
    JSON.stringify(contagem[0]),
  );
  ok(
    "o mais frequente vem primeiro",
    contagem[1].assunto === "profissional adicional" && contagem[1].total === 2,
    JSON.stringify(contagem[1]),
  );
  ok(
    "e nulo e vazio não viram linha",
    !contagem.some((c) => !c.assunto),
    JSON.stringify(contagem),
  );
}
{
  // Empate desempatado por ordem alfabética: sem isso a lista dança entre duas
  // cargas da tela com os mesmos dados, e painel que muda sozinho parece bug.
  const a = contarAssuntos(["zelo com dados", "abertura de conta"]);
  const b = contarAssuntos(["abertura de conta", "zelo com dados"]);
  ok(
    "empate tem ordem estável",
    JSON.stringify(a) === JSON.stringify(b) && a[0].assunto === "abertura de conta",
    JSON.stringify(a),
  );
}

secao("correção 3 — grava a dúvida de quem veio do site");
{
  ctrl.extraction = extracao("recarga de conversas");
  ctrl.reply = "A recarga é avulsa: 200 conversas por R$97, sem mexer na mensalidade.";
  await post(
    evento(`${MENSAGEM_DO_BOTAO_DO_SITE} sobre a recarga`, NUMERO),
  );
  ok(
    "gravou o assunto",
    state.leads[0]?.duvidaDoSite === "recarga de conversas",
    String(state.leads[0]?.duvidaDoSite),
  );
}

secao("correção 3 — só a PRIMEIRA dúvida fica registrada");
{
  ctrl.extraction = extracao("contrato e fidelidade");
  ctrl.reply = "Não tem fidelidade nenhuma, você cancela quando quiser.";
  await chamar(evento("e tem fidelidade?", NUMERO));
  ok(
    "a segunda dúvida não substitui a primeira",
    state.leads[0]?.duvidaDoSite === "recarga de conversas",
    String(state.leads[0]?.duvidaDoSite),
  );
}

secao("correção 3 — quem NÃO veio do site não entra na conta");
{
  // Mesmo que o extrator devolva um assunto (ele erra às vezes), a trava de
  // origem é nossa: a lista serve para consertar a PÁGINA, e quem não passou
  // por ela não diz nada sobre ela.
  ctrl.extraction = extracao("recarga de conversas");
  ctrl.reply = "A recarga é 200 conversas por R$97.";
  await post(evento("como funciona a recarga?", NUMERO));
  ok(
    'a origem é "whatsapp"',
    state.leads[0]?.origin === "whatsapp",
    String(state.leads[0]?.origin),
  );
  ok(
    "e nada foi gravado",
    !state.leads[0]?.duvidaDoSite,
    String(state.leads[0]?.duvidaDoSite),
  );
}

secao("correção 3 — veio do site mas não trouxe dúvida");
{
  ctrl.extraction = extracao(null);
  ctrl.reply = "Oi! Aqui é a Júlia, do CaptaClin. Como posso te chamar?";
  await post(evento(MENSAGEM_DO_BOTAO_DO_SITE, NUMERO));
  ok('a origem é "site"', state.leads[0]?.origin === ORIGEM_SITE, String(state.leads[0]?.origin));
  ok(
    "e o campo fica vazio (null não é uma dúvida)",
    !state.leads[0]?.duvidaDoSite,
    String(state.leads[0]?.duvidaDoSite),
  );
}

// ── A rota do painel ───────────────────────────────────────────────────────

const duvidas = acharRota(statsRouter, "get", "/stats/duvidas-do-site");

secao("a rota do painel existe");
ok("GET /stats/duvidas-do-site", typeof duvidas === "function");

secao('GET /stats/duvidas-do-site — "O que a landing não responde"');
{
  state.reset();
  const assuntos = [
    "recarga de conversas",
    "Recarga de conversas",
    "recarga de conversas",
    "profissional adicional",
    "profissional adicional",
    "contrato e fidelidade",
  ];
  assuntos.forEach((assunto, i) =>
    state.leads.push({
      id: i + 1,
      phone: `55119000000${i}`,
      origin: ORIGEM_SITE,
      status: "warm",
      duvidaDoSite: assunto,
      createdAt: new Date(),
    }),
  );
  // Um lead sem dúvida nenhuma, para provar que a rota filtra.
  state.leads.push({
    id: 99,
    phone: "5511999999999",
    origin: "whatsapp",
    status: "warm",
    duvidaDoSite: null,
    createdAt: new Date(),
  });

  const r = await chamarRota(duvidas);
  const corpo = r.body as any;
  ok("responde 200", r.status === 200, String(r.status));
  ok("três linhas", corpo.assuntos.length === 3, JSON.stringify(corpo));
  ok(
    "recarga na frente, com 3 (a variação de caixa somou)",
    corpo.assuntos[0].assunto === "recarga de conversas" && corpo.assuntos[0].total === 3,
    JSON.stringify(corpo.assuntos[0]),
  );
  ok(
    "profissional adicional em segundo, com 2",
    corpo.assuntos[1].assunto === "profissional adicional" && corpo.assuntos[1].total === 2,
    JSON.stringify(corpo.assuntos[1]),
  );
  ok("contrato por último, com 1", corpo.assuntos[2].total === 1, JSON.stringify(corpo.assuntos[2]));
  ok("o total bate com a soma", corpo.total === 6, String(corpo.total));
}

secao("GET /stats/duvidas-do-site — sem nada ainda, responde vazio e não quebra");
{
  state.reset();
  const r = await chamarRota(duvidas);
  const corpo = r.body as any;
  ok("responde 200", r.status === 200, String(r.status));
  ok("lista vazia", Array.isArray(corpo.assuntos) && corpo.assuntos.length === 0, JSON.stringify(corpo));
  ok("total zero", corpo.total === 0, String(corpo.total));
}

// ── QUEM E MODO A ───────────────────────────────────────────────────────────
//
// A regra vivia INLINE dentro do buildLeadBriefing, escrita e usada uma vez so.
// Virou funcao com nome no dia em que a medicao precisou do MESMO recorte —
// duas copias da mesma decisao e a forma classica de as duas divergirem sem
// ninguem perceber (ver a nota sobre regra que existe num lugar so).
secao("MODO A e MODO B: quem procurou quem");

ok("o botao da landing e MODO A", ehModoA(ORIGEM_SITE));
ok("quem chegou sozinho pelo WhatsApp tambem", ehModoA("whatsapp"));
ok("o valor antigo 'inbound' continua valendo", ehModoA("inbound"));
// Nulo nao e um caso a parte: e "chegou sozinho" escrito de outro jeito, e
// tratar como MODO B faria a Julia falar como quem abordou quem nunca abordou.
ok("origem nula e MODO A", ehModoA(null) && ehModoA(undefined));
ok("maps e MODO B", !ehModoA("maps"));
ok("import e MODO B", !ehModoA("import"));
ok("instagram e MODO B", !ehModoA("instagram"));
ok(
  "e 'chegouSozinho' NAO inclui o site — quem clicou no botao ja leu a pagina",
  chegouSozinho("whatsapp") && !chegouSozinho(ORIGEM_SITE),
);

secao("o script do MODO A nao pode divergir do modulo");
{
  // Mesmo desenho do teste que amarra o medir-repeticao aos topicos: o script
  // roda contra producao sem passar pelo build, entao ele COPIA a regra. Se as
  // duas divergirem, a medicao passa a contar OUTRO publico — e os dois lados
  // continuariam "funcionando", que e o que torna esse defeito invisivel.
  const fonte = readFileSync(new URL("../../scripts/medir-modo-a.mjs", import.meta.url), "utf8");
  const origens = [ORIGEM_SITE, ...ORIGENS_DE_QUEM_CHEGOU_SOZINHO];
  const faltando = origens.filter((o) => !fonte.includes(`"${o}"`));
  ok("o script conhece as mesmas origens", faltando.length === 0, JSON.stringify(faltando));
  ok("e e somente leitura", !/INSERT|UPDATE|DELETE/i.test(fonte), "o script escreve no banco!");

  // As duas coisas que fazem a medicao valer alguma coisa depois: o criterio
  // impresso ANTES do resultado, para ninguem ajusta-lo ao numero que saiu, e
  // o aviso de que aqui o baseline e a PRIMEIRA rodada — nao ha numero cravado,
  // porque ninguem leu uma conversa do MODO A ainda.
  ok("declara o criterio antes de medir", fonte.includes("CRITERIO, declarado antes de medir"));
  ok(
    "e diz que o baseline e a primeira rodada dele",
    fonte.includes("A PRIMEIRA") && fonte.includes("rodada deste script E o baseline"),
  );
  // A metade que o numero NAO cobre, dita em voz alta em vez de escondida.
  ok(
    "admite que nao mede se o motivo esta ligado ao que ele contou",
    fonte.includes("O QUE ESTE SCRIPT NAO MEDE"),
  );
  // O denominador junto do numero: conversa que nunca recomendou some da
  // mediana, e some por ser o pior caso.
  ok("mostra tambem quantas NUNCA recomendaram", fonte.includes("NUNCA recomendou"));
  // "pro" minusculo e "para o" em portugues falado, e esta em todo o prompt.
  ok(
    "o plano Pro e conferido com caixa, no texto cru",
    fonte.includes("const PLANO_PRO = /"+"\\bPro\\b/"),
  );
}

fim();
