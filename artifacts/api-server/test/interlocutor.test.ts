/**
 * DE QUEM E O FATO (Rodada 52) — quem esta do outro lado, e de quem e o nome.
 *
 * Tres sintomas de tres conversas reais, uma causa so: o sistema presumia que
 * quem digita e o dentista dono, e o codigo aceitava o que o extrator dissesse.
 *
 *  - quem se apresentou como "da equipe da Dra. Liliane" virou "Dra. Rosane";
 *  - uma assistente virtual chamada "RF" virou "Dr. Romero" e "senhor";
 *  - um bot institucional conversou 7 minutos e o lead foi marcado QUENTE,
 *    porque o menu dele ("...falar com um atendente") batia na lista de handoff
 *    e valia 30 pontos — o piso exato da faixa quente.
 */
import { ok, secao, fim } from "./assert";
import { post, chamar, evento, zerar } from "./driver";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";
import {
  INTERLOCUTORES,
  lerInterlocutor,
  mereceFollowUp,
  nomeFoiDito,
  pareceAssistenteVirtual,
  podePontuarTemperatura,
} from "../src/lib/interlocutor";
import {
  buildLeadBriefing,
  JULIA_EXTRACTION_PROMPT,
  JULIA_SYSTEM_PROMPT,
} from "../src/julia-persona";

/** Uma extração completa, com os campos novos desta rodada. */
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

const ficha = (p: Record<string, unknown>): string =>
  buildLeadBriefing({
    name: null,
    funnelStage: "new",
    painPoints: null,
    mainObjection: null,
    planInterest: null,
    daysSinceLastMessage: null,
    isReturning: false,
    totalMessages: 1,
    origin: "maps",
    ...p,
  } as Parameters<typeof buildLeadBriefing>[0]);

// ── A — as funcoes puras ────────────────────────────────────────────────────

secao("A — a lista fixa reconhece atendimento automatico");

ok("assistente virtual", pareceAssistenteVirtual("Ola, sou a assistente virtual da clinica") !== null);
ok("menu numerado", pareceAssistenteVirtual("1 - Valores\n2 - Agendamento\nDigite 1") !== null);
ok("mensagem automatica com acento", pareceAssistenteVirtual("Esta é uma mensagem automática") !== null);
ok("nao responda esta mensagem", pareceAssistenteVirtual("Não responda esta mensagem, por favor") !== null);
ok(
  "devolve QUAL sinal bateu, para o log poder dizer",
  pareceAssistenteVirtual("sou a assistente virtual") === "assistente virtual",
  String(pareceAssistenteVirtual("sou a assistente virtual")),
);

// O falso positivo que derrubou a versao antiga do detector de handoff: numa
// descoberta normal o dentista responde exatamente isto.
ok(
  "'minha atendente responde' NAO e robo — e resposta de dentista",
  pareceAssistenteVirtual("quem responde é a minha atendente") === null,
);
ok("'sou dentista' nao e robo", pareceAssistenteVirtual("sou dentista e atendo sozinho") === null);
ok("'automatico' fora de contexto nao basta", pareceAssistenteVirtual("meu sistema é automatico?") === null);

secao("A2 — a cerca do nome: ele DISSE isso?");

const dela = ["Oi, aqui é a Renata", "quero saber do preço"];
ok('"Renata" foi dito → passa', nomeFoiDito("Renata", dela));
ok('"Rosane" nao foi dito → barra', !nomeFoiDito("Rosane", dela));
ok("nome nulo barra", !nomeFoiDito(null, dela));
ok("nome vazio barra", !nomeFoiDito("   ", dela));
ok("uma letra so barra (casaria com quase tudo)", !nomeFoiDito("R", dela));
ok(
  "compara sem acento e sem caixa",
  nomeFoiDito("Fabiola", ["aqui quem fala é a Fabíola"]),
);
ok("lista vazia barra", !nomeFoiDito("Renata", []));

secao("A3 — leitura da coluna e as duas travas");

ok("valor valido passa", lerInterlocutor("equipe") === "equipe");
ok("nulo vira nao_sei", lerInterlocutor(null) === "nao_sei");
ok("lixo vira nao_sei", lerInterlocutor("dentista") === "nao_sei");
ok("nao_sei e um valor de verdade, nao ausencia", INTERLOCUTORES.includes("nao_sei"));
ok("robo nao pontua", !podePontuarTemperatura("assistente_virtual"));
ok("equipe pontua normal", podePontuarTemperatura("equipe"));
ok("dono pontua normal", podePontuarTemperatura("dentista_dono"));
ok("robo nao recebe follow-up", !mereceFollowUp("assistente_virtual"));
ok("equipe recebe follow-up", mereceFollowUp("equipe"));

// ── B — a ficha ─────────────────────────────────────────────────────────────

secao("B — o titulo Dr./Dra. e do DENTISTA, e so dele");

ok(
  "dono com nome feminino → Dra.",
  ficha({ name: "Marina", interlocutor: "dentista_dono" }).includes("trate como: Dra. Marina"),
);
ok(
  "EQUIPE com nome feminino → NADA de Dra.",
  !ficha({ name: "Renata", interlocutor: "equipe" }).includes("Dra. Renata"),
  ficha({ name: "Renata", interlocutor: "equipe" }),
);
ok(
  "e a ficha diz por que",
  ficha({ name: "Renata", interlocutor: "equipe" }).includes("NÃO é o dentista"),
);
ok(
  "assistente virtual tambem nao ganha titulo",
  !ficha({ name: "RF", interlocutor: "assistente_virtual" }).includes("Dr. RF") &&
    !ficha({ name: "RF", interlocutor: "assistente_virtual" }).includes("Dra. RF"),
);
ok(
  "sem saber quem e, NAO ganha titulo",
  !ficha({ name: "Marina", interlocutor: null }).includes("Dra. Marina"),
  ficha({ name: "Marina", interlocutor: null }),
);

secao("B2 — a linha de interlocutor existe SEMPRE");

ok("dono", ficha({ interlocutor: "dentista_dono" }).includes("o próprio dentista dono"));
ok("equipe", ficha({ interlocutor: "equipe" }).includes("alguém da EQUIPE"));
ok("robo", ficha({ interlocutor: "assistente_virtual" }).includes("ATENDIMENTO AUTOMÁTICO"));
ok(
  "e o silencio tambem e dito, em vez de virar suposicao",
  ficha({ interlocutor: null }).includes("ainda NÃO SABE"),
  ficha({ interlocutor: null }),
);

secao("B3 — o prompt do extrator manda julgar por AUTORIA");

ok(
  "o nome e de quem ESTA ESCREVENDO",
  JULIA_EXTRACTION_PROMPT.includes("SÓ o nome de quem está escrevendo"),
);
ok(
  "e nome de terceiro citado vira null, com o exemplo real",
  JULIA_EXTRACTION_PROMPT.includes("sou da equipe da Dra. Liliane"),
);
ok(
  "os sinais sao do DENTISTA, nao do que a Julia ofereceu",
  JULIA_EXTRACTION_PROMPT.includes(
    "Julgue pelo que o DENTISTA fez, nunca pelo que a Júlia ofereceu",
  ),
);
ok(
  "menu automatico nao demonstra interesse",
  JULIA_EXTRACTION_PROMPT.includes("Menu automático NÃO demonstra interesse"),
);
ok(
  "e na duvida o interlocutor e nao_sei, nunca dono",
  JULIA_EXTRACTION_PROMPT.includes('na dúvida, "nao_sei" — nunca "dentista_dono"'),
);

// ── C — o webhook ───────────────────────────────────────────────────────────

secao("C — o menu do robo NAO esquenta o lead");

{
  ctrl.extraction = extracao({ interlocutor: "assistente_virtual" });
  await post(evento("Bem-vindo! 1 - Valores  2 - Agendamento  3 - Falar com um atendente"));
  const lead = state.leads[0] as any;

  ok("o robo foi reconhecido", lead.interlocutor === "assistente_virtual", String(lead.interlocutor));
  ok("NAO virou quente", lead.status !== "hot", `status=${lead.status}`);
  ok("nao pontuou nada", !lead.temperatura, `temperatura=${lead.temperatura}`);
  ok("nenhuma leva de follow-up armada", state.followUps.length === 0, `${state.followUps.length}`);
  ok("mas ela responde uma vez — e vitrine", wa.enviadas.length === 1, `${wa.enviadas.length}`);
}

secao("C2 — 'falar com um atendente' sozinho nao e mais pedido de pessoa");

{
  // Sem nenhum sinal do extrator e sem robo declarado: se a frase de menu ainda
  // estivesse na lista de handoff, sozinha ela poria 30 pontos e faria hot.
  ctrl.extraction = extracao();
  await post(evento("digite 3 para falar com um atendente"));
  const lead = state.leads[0] as any;
  ok(
    "so o respondeu_algo pontuou",
    lead.temperatura === 3,
    `temperatura=${lead.temperatura}`,
  );
  ok("continua frio", lead.status === "cold", lead.status);
}

secao("C2b — nem uma frase que CONTINUA na lista promove um robo");

{
  // A segunda camada, achada pela sabotagem da primeira: o bloco de handoff
  // escreve status "hot" DIRETO, sem passar pela temperatura. Aqui a frase é
  // legítima ("falar com uma pessoa") — o que barra é saber quem falou.
  ctrl.extraction = extracao({ interlocutor: "assistente_virtual" });
  await post(evento("Sou a assistente virtual. Para falar com uma pessoa, aguarde."));
  const lead = state.leads[0] as any;
  ok("nao virou quente", lead.status !== "hot", `status=${lead.status}`);
  ok("nao marcou handoff", !lead.handoffRequested, String(lead.handoffRequested));
  ok(
    "e NAO chamou o dono no Telegram para uma conversa em que ninguem pediu nada",
    wa.alertas.length === 0,
    JSON.stringify(wa.alertas),
  );
}

secao("C3 — quem PEDE uma pessoa de verdade continua esquentando");

{
  ctrl.extraction = extracao();
  await post(evento("quero falar com uma pessoa"));
  const lead = state.leads[0] as any;
  ok("pediu_pessoa + respondeu_algo = 33", lead.temperatura === 33, String(lead.temperatura));
  ok("33 e quente", lead.status === "hot", lead.status);
  ok("e o dono foi avisado", wa.alertas.length === 1, JSON.stringify(wa.alertas));
}

secao("C4 — a Julia prometendo passar adiante AVISA, mas nao esquenta");

{
  ctrl.extraction = extracao();
  ctrl.reply = "Claro! Vou te passar para alguém do time, tá?";
  await post(evento("nao entendi essa parte do contrato"));
  const lead = state.leads[0] as any;

  ok("o dono foi avisado — a promessa dela precisa de gente", wa.alertas.length === 1);
  ok("o lead ficou marcado para handoff", lead.handoffRequested === true);
  ok(
    "mas NAO ganhou os 30 pontos: ele nao pediu nada",
    lead.temperatura === 3,
    `temperatura=${lead.temperatura}`,
  );
  ok("e nao foi promovido a quente", lead.status === "cold", lead.status);
  ctrl.reply = "Oi! Como posso te ajudar?";
}

secao("C5 — nome que ele nao disse NAO e gravado");

{
  ctrl.extraction = extracao({ name: "Rosane" });
  await post(evento("sou da equipe da Dra. Liliane, ela pediu pra eu ver isso"));
  const lead = state.leads[0] as any;
  ok("o nome inventado foi descartado", !lead.name, `name=${lead.name}`);
}

secao("C6 — nome que ele DISSE e gravado normalmente");

{
  ctrl.extraction = extracao({ name: "Renata", interlocutor: "equipe" });
  await post(evento("oi, aqui é a Renata da clinica"));
  const lead = state.leads[0] as any;
  ok("gravou", lead.name === "Renata", `name=${lead.name}`);
  ok("e sabe que nao e a dentista", lead.interlocutor === "equipe", String(lead.interlocutor));
}

secao("C7 — a pessoa que assume depois do robo devolve a conversa ao normal");

{
  ctrl.extraction = extracao({ interlocutor: "assistente_virtual" });
  await post(evento("Sou a assistente virtual. Digite 1 para valores."));
  ok("nasceu como robo", (state.leads[0] as any).interlocutor === "assistente_virtual");
  ok("sem follow-up", state.followUps.length === 0);

  ctrl.extraction = extracao({ interlocutor: "dentista_dono", sinais: ["perguntou_preco"] });
  await chamar(evento("opa, aqui é o Dr. Carlos, quanto custa?"));
  const lead = state.leads[0] as any;
  ok("o extrator corrigiu para a pessoa", lead.interlocutor === "dentista_dono", String(lead.interlocutor));
  ok("e agora pontua", lead.temperatura === 18, `temperatura=${lead.temperatura}`);
  ok("e a leva volta a ser armada", state.followUps.length > 0, `${state.followUps.length}`);
}

secao("C8 — a lista fixa age no PRIMEIRO turno, sem esperar o extrator");

{
  // O extrator NAO ajuda aqui: devolve "nao_sei" e ainda por cima um sinal
  // quente. Se so ele decidisse, este lead pontuaria e armaria leva — e a
  // resposta ja teria saido, porque ele so roda DEPOIS dela.
  ctrl.extraction = extracao({ sinais: ["perguntou_preco"] });
  await post(evento("Olá! Sou a assistente virtual da clínica. Posso ajudar?"));
  const lead = state.leads[0] as any;
  ok("a lista fixa classificou sozinha", lead.interlocutor === "assistente_virtual", String(lead.interlocutor));
  ok("o sinal quente do extrator nao pontuou", !lead.temperatura, `temperatura=${lead.temperatura}`);
  ok("nao armou leva", state.followUps.length === 0, `${state.followUps.length}`);
}

secao("C9 — a fronteira com o anti-spam: cada um cobre o que o outro nao cobre");

{
  // "mensagem automatica" esta nas DUAS listas, e isso nao e duplicacao: o
  // anti-spam (lib/filtro-spam.ts) so roda quando o lead NAO existe, e por
  // decisao registrada conversa ja iniciada nunca e descartada por conteudo.
  // Entao o anti-spam pega a primeira, e a lista de robo pega da segunda em
  // diante — que e exatamente onde o bot institucional conversou 7 minutos.
  ctrl.extraction = extracao();
  await post(evento("Esta é uma mensagem automática, não responda esta mensagem."));
  ok(
    "primeira mensagem de servico: o anti-spam corta antes, sem criar lead",
    state.leads.length === 0,
    `leads=${state.leads.length}`,
  );

  zerar();
  ctrl.extraction = extracao({ sinais: ["perguntou_preco"] });
  await chamar(evento("oi, tudo bem?"));
  ok("conversa comeca normal", state.leads.length === 1);

  await chamar(evento("Esta é uma mensagem automática, não responda esta mensagem."));
  const lead = state.leads[0] as any;
  ok(
    "a MESMA frase, ja com o lead criado, e pega pela lista de robo",
    lead.interlocutor === "assistente_virtual",
    String(lead.interlocutor),
  );
}

// ── D — o que a Julia FAZ ao reconhecer outra IA (Rodada 55) ────────────────
//
// Ate aqui o reconhecimento so servia para PROTEGER: nao esquentar o lead, nao
// armar follow-up, nao gravar nome. Tudo negativo. Do lado da conversa a Julia
// seguia oferecendo descoberta a um robo, porque nenhuma linha dizia o que
// fazer com a informacao. Este bloco e a parte positiva: ela nomeia o que
// aconteceu, se revela IA — que aqui deixa de ser confissao e vira o argumento,
// porque a clinica ja confia o WhatsApp dela a um automatico — e pede o que so
// pessoa da: alguem da equipe, ou o melhor horario.
secao("D — diante de outra IA: nomear, se revelar, e pedir a pessoa");

ok(
  "o vai-e-vem de perguntas com um automatico esta proibido, com o motivo",
  JULIA_SYSTEM_PROMPT.includes("NUNCA entra em vai-e-vem de perguntas com um automático") &&
    JULIA_SYSTEM_PROMPT.includes("não tem rotina, não tem dor e não decide nada"),
);
ok(
  "e continua sendo UMA mensagem so, lida pela pessoa depois",
  JULIA_SYSTEM_PROMPT.includes("É UMA mensagem só, e quem\nvai lê-la é a pessoa, depois"),
);
ok(
  "1) ela nomeia o que aconteceu, com leveza e sem ironia",
  JULIA_SYSTEM_PROMPT.includes(
    "diga com leveza, sem ironia, que percebeu que é o atendimento automático",
  ),
);
ok(
  "2) ela se revela IA, e o prompt diz por que ali isso vira argumento",
  JULIA_SYSTEM_PROMPT.includes("conte que você também é uma IA") &&
    JULIA_SYSTEM_PROMPT.includes("aqui ela vira argumento") &&
    JULIA_SYSTEM_PROMPT.includes("a clínica já confia o\n  WhatsApp dela a um robô"),
);
ok(
  "3) ela pede o que so uma pessoa da: alguem da equipe, ou o horario",
  JULIA_SYSTEM_PROMPT.includes(
    "peça o que só uma pessoa dá: falar com alguém da equipe, ou o melhor horário",
  ),
);
ok(
  "e se o robo responder de novo, ela nao insiste",
  JULIA_SYSTEM_PROMPT.includes("Se o automático responder de novo, não insista"),
);

// A CONTRADICAO QUE ESTE BLOCO TERIA CRIADO, se ficasse sozinho. Duas regras
// antigas dizem o contrario dele, e as duas precisam apontar para a excecao —
// senao a regra que ficou para tras nao fica so incompleta, vira contradicao, e
// o modelo obedece a mais categorica (foi o que aconteceu com a reputacao).
ok(
  "a secao da revelacao ganhou a excecao, em vez de continuar proibindo",
  JULIA_SYSTEM_PROMPT.includes("EXCEÇÃO, a única: do outro lado está o atendimento automático") &&
    JULIA_SYSTEM_PROMPT.includes("conte já na primeira mensagem, sem esperar aprovação"),
);
ok(
  "e a excecao aponta de volta para a secao que descreve o comportamento",
  JULIA_SYSTEM_PROMPT.includes(
    "prova tudo. Veja COM QUEM VOCÊ ESTÁ FALANDO",
  ),
);
ok(
  'a regra de "fale o minimo possivel em IA" tambem sabe que existe excecao',
  JULIA_SYSTEM_PROMPT.includes("É a exceção à\n  regra de falar pouco em IA"),
);
ok(
  "a revelacao normal continua exigindo aprovacao dele antes",
  JULIA_SYSTEM_PROMPT.includes("QUANDO CONTAR — só depois de ele demonstrar aprovação"),
);
{
  // A ficha e o prompt tem que usar o MESMO rotulo, senao o comportamento
  // existe mas nao encontra o caso. Mesmo contrato do "Reputação no Google".
  const fichaDeRobo = ficha({ interlocutor: "assistente_virtual" });
  ok(
    "a ficha manda ver a secao que agora diz o que fazer",
    fichaDeRobo.includes("veja COM QUEM VOCÊ ESTÁ FALANDO"),
    fichaDeRobo,
  );
}

fim();
