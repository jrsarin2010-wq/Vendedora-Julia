/**
 * RODADA 53 — o campo do banco entrando cru na mensagem, e o caminho de volta.
 *
 * Tres coisas com a mesma raiz: um dado gravado para uma finalidade sendo usado
 * em outra sem ninguem conferir se ele cabe ali.
 *
 * 1) A DOR. O extrator gravava "Ele quer entender como funciona o atendimento
 *    no WhatsApp" — frase, em terceira pessoa. O toque 1 colava isso depois de
 *    "sobre", que exige complemento nominal, e o dentista recebeu:
 *    "Fiquei pensando no que voce me contou sobre ele quer entender como
 *    funciona o atendimento no whatsapp." Os toques 2, 3 e 4 ja tinham recebido
 *    o cuidado do aposto; o 1 ficou de fora.
 *
 * 2) O TOQUE 1 escolhido por INDICE. Quem respondeu cinco perguntas recebia o
 *    mesmo "acabou ficando pela metade" de quem respondeu "oi".
 *
 * 3) O NOME preso. O `!lead.name` impedia corrigir nome ja gravado, e um lead
 *    ficou com o nome da ASSISTENTE como se fosse o da dentista — para sempre.
 */
import { ok, secao, fim } from "./assert";
import { post, chamar, evento, zerar } from "./driver";
import { handlerDe, chamarRota } from "./rota";
import leadsRouter from "../src/routes/leads";
import { state } from "./stubs/db.mjs";
import { ctrl } from "./stubs/openai.mjs";
import {
  FOLLOW_UP_TEMPLATES,
  JULIA_EXTRACTION_PROMPT,
  MENSAGENS_PARA_CONVERSA_PROFUNDA,
  conversaFoiProfunda,
  pareceNarracao,
} from "../src/julia-persona";

function acharRota(router: unknown, metodo: string, caminho: string) {
  const camada = (router as any).stack.find(
    (l: any) => l.route?.path === caminho && l.route?.methods?.[metodo],
  );
  if (!camada) throw new Error(`Rota ${metodo.toUpperCase()} ${caminho} nao existe`);
  return camada.route.stack[camada.route.stack.length - 1].handle;
}

const extracao = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    painPoints: null,
    mainObjection: null,
    name: null,
    planInterest: null,
    funnelStage: null,
    isCustomer: false,
    wantsToStop: false,
    irritado: false,
    duvidaDoSite: null,
    sinais: [],
    interlocutor: "nao_sei",
    ...extra,
  });

/**
 * O toque 1 da leva VIVA.
 *
 * Filtrar por `pending` nao e detalhe: cada resposta dele cancela a leva
 * anterior e arma uma nova, entao numa conversa de cinco mensagens existem
 * cinco toques 1 na tabela, e quatro deles estao cancelados. Um `find` cru
 * devolveria o PRIMEIRO — o da primeira mensagem, quando a conversa de fato
 * ainda era rasa — e o teste passaria dizendo o contrario do que mede.
 */
const toque1 = () =>
  (state.followUps as any[])
    .filter((f) => f.touchNumber === 1 && f.status === "pending")
    .at(-1)?.messageTemplate ?? "";

// ── A — a dor narrada ───────────────────────────────────────────────────────

secao("A — o que e narracao sobre ele, e o que e a dor dele");

ok("o caso real", pareceNarracao("Ele quer entender como funciona o atendimento no WhatsApp"));
ok("com maiuscula ou minuscula", pareceNarracao("ele quer entender"));
ok('"o dentista ..."', pareceNarracao("O dentista tem dificuldade com o WhatsApp"));
ok('"a dentista ..."', pareceNarracao("A dentista nao consegue responder"));
ok('"o cliente ..."', pareceNarracao("o cliente quer saber o preco"));
ok('"ela ..."', pareceNarracao("Ela precisa de ajuda com a agenda"));

ok(
  "a dor DE VERDADE passa, mesmo tendo verbo",
  !pareceNarracao("perde paciente que chama fora do horario"),
);
ok(
  "e a que fala da rotina tambem",
  !pareceNarracao("ninguem responde o WhatsApp quando ela esta com paciente"),
);
// A regra e por PREFIXO com limite de palavra: sem o \b, "eleicao" casaria com
// "ele" e uma dor legitima seria descartada em silencio.
ok('"eleicao" nao e "ele"', !pareceNarracao("eleicao mudou o movimento da clinica"));
ok('"elastico" nao e "ela"', !pareceNarracao("elastico do aparelho sempre acaba"));

secao("A2 — e o prompt do extrator pede o formato certo");

ok(
  "manda escrever O PROBLEMA, nao uma frase sobre ele",
  JULIA_EXTRACTION_PROMPT.includes("escreva O PROBLEMA, não uma frase sobre ele"),
);
ok(
  "e proibe comecar com ele/ela/o dentista",
  JULIA_EXTRACTION_PROMPT.includes('NUNCA comece com "ele", "ela", "o dentista"'),
);
ok(
  "com o exemplo errado que aconteceu de verdade",
  JULIA_EXTRACTION_PROMPT.includes("Ele quer entender como funciona o atendimento no WhatsApp"),
);

// ── B — o molde 1 ───────────────────────────────────────────────────────────

secao("B — o toque 1 nao exige mais regencia");

const DOR_BOA = "perde paciente que chama fora do horario";
const DOR_NARRADA = "Ele quer entender como funciona o atendimento no WhatsApp";

ok(
  "a dor entra como APOSTO, depois de dois-pontos",
  FOLLOW_UP_TEMPLATES[1]("Marina", DOR_BOA).includes(`me contou: ${DOR_BOA}`),
  FOLLOW_UP_TEMPLATES[1]("Marina", DOR_BOA),
);
ok(
  'e nunca mais depois de "sobre"',
  !FOLLOW_UP_TEMPLATES[1]("Marina", DOR_BOA).includes(`sobre ${DOR_BOA}`),
);

secao("B2 — dor narrada nao entra em toque NENHUM");

for (const t of [1, 2, 3, 4] as const) {
  const texto = FOLLOW_UP_TEMPLATES[t]("Marina", DOR_NARRADA);
  ok(
    `toque ${t}: a narracao nao vaza para a mensagem`,
    !texto.toLowerCase().includes("ele quer entender"),
    texto,
  );
  ok(
    `toque ${t}: cai no texto generico, igual a quem nao tem dor`,
    texto === FOLLOW_UP_TEMPLATES[t]("Marina", null),
  );
}

// ── C — profundidade da conversa ────────────────────────────────────────────

secao("C — o toque 1 para de desmentir quem conversou");

ok("uma mensagem dele nao e conversa", !conversaFoiProfunda(1));
ok("duas ainda nao", !conversaFoiProfunda(2));
ok(`${MENSAGENS_PARA_CONVERSA_PROFUNDA} ja e`, conversaFoiProfunda(MENSAGENS_PARA_CONVERSA_PROFUNDA));
ok("cinco tambem", conversaFoiProfunda(5));

ok(
  "conversa rasa: o texto de sempre",
  FOLLOW_UP_TEMPLATES[1]("Marina", null, false).includes("acabou ficando pela metade"),
);
ok(
  "conversa que andou: NAO diz que ficou pela metade",
  !FOLLOW_UP_TEMPLATES[1]("Marina", null, true).includes("acabou ficando pela metade"),
  FOLLOW_UP_TEMPLATES[1]("Marina", null, true),
);
ok(
  "e reconhece que quem sumiu foi ELA",
  FOLLOW_UP_TEMPLATES[1]("Marina", null, true).includes("sem resposta"),
);
ok(
  "sem o terceiro argumento, continua o texto raso (chamada antiga vale)",
  FOLLOW_UP_TEMPLATES[1]("Marina", null) === FOLLOW_UP_TEMPLATES[1]("Marina", null, false),
);

// ── D — o webhook, de ponta a ponta ─────────────────────────────────────────

secao("D — quem respondeu pouco recebe o toque raso");

{
  ctrl.extraction = extracao();
  await post(evento("oi"));
  ok("uma mensagem dele → raso", toque1().includes("acabou ficando pela metade"), toque1());
}

secao("D2 — quem respondeu bastante NAO recebe 'ficou pela metade'");

{
  ctrl.extraction = extracao();
  zerar();
  await chamar(evento("oi"));
  await chamar(evento("sou eu mesma que respondo"));
  await chamar(evento("de noite fica sem resposta"));
  await chamar(evento("somos duas dentistas"));
  await chamar(evento("anuncio no instagram sim"));
  ok(
    "cinco mensagens dele → toque profundo",
    !toque1().includes("acabou ficando pela metade"),
    toque1(),
  );
  ok("e o texto reconhece a conversa", toque1().includes("conversou bastante"), toque1());
}

secao("D3 — a dor narrada nao chega na leva armada");

{
  ctrl.extraction = extracao({ painPoints: DOR_NARRADA });
  await post(evento("quero entender como funciona"));
  ok("gravou a dor na ficha (a ficha aceita frase)", (state.leads[0] as any).painPoints === DOR_NARRADA);
  ok(
    "mas a mensagem armada NAO a carrega",
    !toque1().toLowerCase().includes("ele quer entender"),
    toque1(),
  );
}

// ── E — o caminho de volta do nome ──────────────────────────────────────────

secao("E — o nome errado deixa de ser permanente");

{
  // A assistente respondeu primeiro e o nome dela ficou gravado. Depois a
  // dentista assume — e o interlocutor MUDA. E esse o gatilho da correcao.
  ctrl.extraction = extracao({ name: "Renata", interlocutor: "equipe" });
  await post(evento("oi, aqui e a Renata da clinica"));
  ok("nome da assistente gravado", (state.leads[0] as any).name === "Renata");

  ctrl.extraction = extracao({ name: "Liliane", interlocutor: "dentista_dono" });
  await chamar(evento("aqui e a Liliane, sou a dentista"));
  const lead = state.leads[0] as any;
  ok("o nome foi corrigido", lead.name === "Liliane", `name=${lead.name}`);
  ok("e o interlocutor junto", lead.interlocutor === "dentista_dono", String(lead.interlocutor));
}

secao("E2 — mas a trava continua: sem mudanca de interlocutor, nao reescreve");

{
  ctrl.extraction = extracao({ name: "Renata", interlocutor: "equipe" });
  await post(evento("oi, aqui e a Renata"));
  ok("gravou", (state.leads[0] as any).name === "Renata");

  ctrl.extraction = extracao({ name: "Renatinha", interlocutor: "equipe" });
  await chamar(evento("pode me chamar de Renatinha"));
  ok(
    "mesmo interlocutor → nome nao oscila",
    (state.leads[0] as any).name === "Renata",
    (state.leads[0] as any).name,
  );
}

secao("E3 — e a cerca do nome vale tambem na correcao");

{
  ctrl.extraction = extracao({ name: "Renata", interlocutor: "equipe" });
  await post(evento("oi, aqui e a Renata"));

  // Interlocutor muda, mas o nome novo nao aparece no que ele escreveu.
  ctrl.extraction = extracao({ name: "Rosane", interlocutor: "dentista_dono" });
  await chamar(evento("agora sou eu quem fala, sou a dentista"));
  ok(
    "nome inventado nao entra nem pela porta da correcao",
    (state.leads[0] as any).name === "Renata",
    (state.leads[0] as any).name,
  );
}

secao("E4 — e o dono corrige na mao, pelo painel");

{
  zerar();
  state.leads.push({
    id: 1,
    phone: "5571999990000",
    name: "Rosane",
    status: "warm",
    funnelStage: "qualified",
    interlocutor: null,
  });

  const atualizar = acharRota(leadsRouter, "patch", "/leads/:id");
  const r = await chamarRota(atualizar, {
    params: { id: "1" },
    body: { name: "Liliane", interlocutor: "dentista_dono" },
  });

  ok("a rota aceitou", r.status === 200, JSON.stringify(r.body));
  const lead = state.leads[0] as any;
  ok("nome corrigido a mao", lead.name === "Liliane", lead.name);
  ok("e o interlocutor tambem", lead.interlocutor === "dentista_dono", String(lead.interlocutor));
}

secao("E5 — valor invalido de interlocutor e recusado pelo schema");

{
  const atualizar = acharRota(leadsRouter, "patch", "/leads/:id");
  const r = await chamarRota(atualizar, {
    params: { id: "1" },
    body: { interlocutor: "dentista" },
  });
  ok("nao entra lixo na coluna", r.status !== 200, `status=${r.status}`);
}

fim();
