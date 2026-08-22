/**
 * Rodada 34 — a cadência de quem foi abordado e NUNCA respondeu.
 *
 * O erro que estes testes existem para travar é de VERDADE, não de mecânica: os
 * follow-ups de conversa dizem "a gente começou a conversar" e "o que você me
 * contou". Para quem só recebeu uma mensagem fria e ficou calado, as duas
 * frases são falsas — e vindas de um número que ele não conhece, uma frase
 * falsa não é deslize de copy, é o motivo pelo qual ele denuncia o número.
 *
 * Por isso a asserção mais importante deste arquivo não é "os dois toques
 * saem". É "nenhum toque de abordagem cita conversa que não houve nem dor que
 * ninguém contou".
 */
import { ok, secao, fim } from "./assert";
import { chamar, evento } from "./driver";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";
import { rodarCicloDeAbordagem } from "../src/lib/outreach-scheduler";
import { rodarCicloDeFollowUp } from "../src/lib/follow-up-scheduler";
import {
  ABORDAGEM_DELAYS_HOURS,
  FOLLOW_UP_TEMPLATES,
  JULIA_TOQUE_PROMPT,
} from "../src/julia-persona";
import { leadElegivel, EXPLICACAO_INELEGIVEL } from "../src/lib/outreach";
import { abordagemNoPainel } from "./painel";

/** Uma terça-feira, 14h em São Paulo. Dentro da janela, como no outreach.test. */
const TERCA_14H = new Date("2026-08-11T17:00:00.000Z");
const HORA = 60 * 60 * 1000;
const depois = (horas: number) => new Date(TERCA_14H.getTime() + horas * HORA);

const NUMERO = "5585999997777";

/**
 * QUANTO O TESTE PRECISA AVANÇAR para que a próxima mensagem fria possa sair.
 *
 * 41 minutos, e o número é escolhido: o intervalo mínimo virou 1200s em
 * 19/08/2026 e é SORTEADO entre o mínimo e o dobro dele, então o maior valor
 * que o sorteio pode exigir é 40 minutos. Avançar 41 passa sempre, por qualquer
 * sorteio — e é isso que mantém este arquivo determinístico sem precisar
 * cravar o intervalo nem congelar o `Math.random`.
 *
 * Se o dia chegar em que os 41 minutos não bastem, não é este número que está
 * errado: é o `OUTREACH_MIN_GAP_SECONDS` que subiu, e a conta é 2× ele + 1min.
 */
const PASSO_DO_RITMO = 41 * 60 * 1000;

const toques = () => state.followUps.filter((f: any) => f.kind === "abordagem");
const pendentes = () => state.followUps.filter((f: any) => f.status === "pending");

/** Um lead importado, esperando a primeira mensagem. */
function filaCom(extra: Record<string, unknown> = {}) {
  state.reset();
  wa.reset();
  ctrl.reset();
  // Etapa 4: sem a chave do painel a abordagem nem começa, e a cadência que
  // este arquivo testa nunca seria armada.
  abordagemNoPainel(true);
  ctrl.reply = "Oi, Dra. Marina! Aqui é a Júlia, do CaptaClin. Posso te fazer uma pergunta?";
  state.leads.push({
    id: state.nextId++,
    phone: NUMERO,
    name: "Marina",
    clinicName: "Odonto Vida",
    instagram: "@odontovida",
    city: null,
    origin: "import",
    status: "cold",
    funnelStage: "new",
    outreachStatus: "pending",
    createdAt: new Date(),
    ...extra,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// O TEXTO — o teste que importa.
// ───────────────────────────────────────────────────────────────────────────

secao("os toques de abordagem NÃO citam conversa que não houve nem dor inexistente");

/**
 * Cada frase abaixo afirma alguma coisa sobre um passado que, para quem nunca
 * respondeu, não existe. A lista é de FRASES e não de palavras soltas de
 * propósito: "conversa" sozinha é legítima ("vale dois minutos de conversa"),
 * o que não pode é dar a conversa como acontecida.
 */
const AFIRMACOES_SEM_BASE = [
  "começou a conversar",
  "ficando pela metade",
  "você me contou",
  "que você me falou",
  "aquilo que você falou",
  "aquele problema que você",
  "fiquei pensando no que você",
  "ainda te incomoda",
  "da última vez você",
  "como combinamos",
  "voltando ao que",
];

/**
 * 19/08/2026 — os dois toques deixaram de ser texto fixo.
 *
 * Eram duas sentenças literais, idênticas para todo dentista (só o nome
 * mudava), e a segunda ainda carregava o link do site. Depois que o dono baixou
 * o ritmo de 40 para 15 por dia, isto virou o maior sinal de robô que sobrava:
 * cota não muda em nada o fato de N números receberem a MESMA frase.
 *
 * O que este arquivo pode testar mudou junto. A lista `AFIRMACOES_SEM_BASE`
 * media uma string que existia; agora o texto nasce do modelo e não existe até
 * a hora do envio. As asserções de CONTEÚDO mudaram de endereço — estão em
 * julia-persona.test.ts, medindo o `JULIA_TOQUE_PROMPT`, que é onde a regra
 * passou a morar. Aqui ficou o que só este arquivo consegue provar: a FIAÇÃO —
 * que o toque nasce sem texto, que o texto é pedido na hora do envio, e que o
 * prompt usado é o dos toques e não outro.
 */
ok(
  "a cadência de conversa continua sendo a que afirma a conversa (é por isso que são duas)",
  FOLLOW_UP_TEMPLATES[1]("Marina", null).includes("começou a conversar"),
);
ok(
  "e as frases que ela pode dizer seguem proibidas no prompt do toque frio",
  AFIRMACOES_SEM_BASE.every((f) => !JULIA_TOQUE_PROMPT.toLowerCase().includes(f.toLowerCase())),
);
ok(
  "o prompt do toque não tem link nenhum dentro dele (nem para o modelo copiar)",
  !/captaclin\.com\.br/.test(JULIA_TOQUE_PROMPT),
);

secao("são DOIS toques, e o segundo é sete dias depois do primeiro");
ok("a cadência tem exatamente dois", ABORDAGEM_DELAYS_HOURS.length === 2, JSON.stringify(ABORDAGEM_DELAYS_HOURS));
ok("o primeiro, 3 dias depois da abordagem", ABORDAGEM_DELAYS_HOURS[0] === 72);
ok("o segundo, 7 dias depois do primeiro", ABORDAGEM_DELAYS_HOURS[1] - ABORDAGEM_DELAYS_HOURS[0] === 168);

// ───────────────────────────────────────────────────────────────────────────
// A CADÊNCIA, do envio ao silêncio permanente.
// ───────────────────────────────────────────────────────────────────────────

secao("a abordagem arma a cadência — dois toques, e só dois");
process.env.OUTREACH_ENABLED = "true";
filaCom();
let r = await rodarCicloDeAbordagem(TERCA_14H);
ok("a abordagem saiu", r.enviou === true, JSON.stringify(r));
ok("armou dois toques, nem um a mais", state.followUps.length === 2, JSON.stringify(state.followUps));
ok("os dois são da cadência de abordagem", toques().length === 2);
ok(
  "numerados 1 e 2",
  toques().map((f: any) => f.touchNumber).join(",") === "1,2",
);
ok(
  "agendados para +3 dias e +10 dias",
  toques()[0].scheduledAt.getTime() === depois(72).getTime() &&
    toques()[1].scheduledAt.getTime() === depois(240).getTime(),
  toques().map((f: any) => f.scheduledAt.toISOString()).join(" | "),
);
ok(
  "e NENHUM nasce com texto gravado — pré-renderizar é o que produzia a frase idêntica para todo mundo",
  toques().every((f: any) => f.messageTemplate === null),
  JSON.stringify(toques().map((f: any) => f.messageTemplate)),
);

secao("a abordagem que NÃO saiu não arma cadência nenhuma");
filaCom();
wa.entrega = false;
r = await rodarCicloDeAbordagem(TERCA_14H);
ok("não entregou", r.enviou === false && r.motivo === "nao_entregue", JSON.stringify(r));
ok("nenhum toque foi armado", state.followUps.length === 0, JSON.stringify(state.followUps));
wa.entrega = true;

secao("os toques saem no prazo, um por rodada, e depois é silêncio permanente");
filaCom();
await rodarCicloDeAbordagem(TERCA_14H);
const enviadasNaAbordagem = wa.enviadas.length;

// Antes da hora: nada.
await rodarCicloDeFollowUp(depois(71));
ok("71h depois, nada saiu ainda", wa.enviadas.length === enviadasNaAbordagem);
ok("os dois seguem pendentes", pendentes().length === 2);

// A ABERTURA que acabou de sair — é ela que o toque não pode repetir, e é por
// isso que o teste guarda o texto.
const ABERTURA = wa.enviadas[wa.enviadas.length - 1].message;

// Toque 1. O texto vem do modelo AGORA, e o stub devolve o que o teste mandar:
// um sentinela diferente da abertura é o que prova que houve geração nova, e
// não a frase fixa de antes nem o texto gravado na fila.
ctrl.reply = "TOQUE 1 GERADO AGORA";
await rodarCicloDeFollowUp(depois(72));
ok(
  "72h depois sai o toque 1, com o texto gerado na hora",
  wa.enviadas[wa.enviadas.length - 1].message === "TOQUE 1 GERADO AGORA",
  wa.enviadas[wa.enviadas.length - 1].message,
);
{
  const [sistema, ficha] = ctrl.mensagens[ctrl.mensagens.length - 1];
  ok("e foi o prompt DOS TOQUES que governou (não o da abertura)", sistema.content === JULIA_TOQUE_PROMPT);
  ok("a ficha diz que é o toque 1", ficha.content.includes("TOQUE 1"), ficha.content);
  ok(
    "e mostra a abertura que já foi mandada — sem isso 'não repita' é incumprível",
    ficha.content.includes(ABERTURA),
    ficha.content,
  );
}
ok("só o toque 1 (o 2 ainda não venceu)", pendentes().length === 1);
ok("o lead continua 'sent' — ainda pode responder", state.leads[0].outreachStatus === "sent");

// Toque 2.
ctrl.reply = "TOQUE 2 GERADO AGORA";
await rodarCicloDeFollowUp(depois(240));
ok(
  "10 dias depois sai o toque 2",
  wa.enviadas[wa.enviadas.length - 1].message === "TOQUE 2 GERADO AGORA",
  wa.enviadas[wa.enviadas.length - 1].message,
);
{
  const [, ficha] = ctrl.mensagens[ctrl.mensagens.length - 1];
  ok("a ficha diz que é o ÚLTIMO", ficha.content.includes("TOQUE 2") && ficha.content.includes("ÚLTIMA"), ficha.content);
  ok(
    "e mostra as DUAS mensagens anteriores",
    ficha.content.includes(ABERTURA) && ficha.content.includes("TOQUE 1 GERADO AGORA"),
    ficha.content,
  );
}
ok("no total, a abordagem + 2 toques", wa.enviadas.length === enviadasNaAbordagem + 2, JSON.stringify(wa.enviadas.map((e: any) => e.message)));
ok("não sobrou nada pendente", pendentes().length === 0, JSON.stringify(state.followUps));
ok(
  "o lead vira 'nao_respondeu' — a cadência acabou",
  state.leads[0].outreachStatus === "nao_respondeu",
  state.leads[0].outreachStatus,
);

// Depois do toque 2: nada mais, nunca.
const totalDepoisDoToque2 = wa.enviadas.length;
await rodarCicloDeFollowUp(depois(400));
await rodarCicloDeFollowUp(depois(2000));
ok("depois do toque 2 não sai mais nada", wa.enviadas.length === totalDepoisDoToque2);
ok("e nada foi reagendado", state.followUps.length === 2, JSON.stringify(state.followUps));

secao("quem esgotou a cadência não volta para a fila de prospecção");
{
  const { elegivel, motivo } = leadElegivel({
    status: "cold",
    outreachStatus: "nao_respondeu",
    phone: NUMERO,
  });
  ok("inelegível", !elegivel);
  ok("com motivo próprio, não o genérico", motivo === "cadencia_esgotada", String(motivo));
  ok(
    "e o painel tem o que dizer",
    EXPLICACAO_INELEGIVEL.cadencia_esgotada.includes("não respondeu nenhum"),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// A JANELA — toque frio é mensagem fria, e obedece as mesmas travas.
// ───────────────────────────────────────────────────────────────────────────

secao("toque de abordagem respeita a janela da prospecção");
/** Arma a cadência e devolve o instante em que o toque 1 vence. */
function comToqueVencido() {
  filaCom();
  return rodarCicloDeAbordagem(TERCA_14H);
}

// Domingo. 2026-08-16T17:00Z é domingo 14h em SP.
await comToqueVencido();
let antes = wa.enviadas.length;
await rodarCicloDeFollowUp(new Date("2026-08-16T17:00:00.000Z"));
ok("domingo não sai toque frio", wa.enviadas.length === antes);
ok("e ele continua PENDENTE, não perdido", pendentes().length === 2);

// Sexta, 20h em SP.
await rodarCicloDeFollowUp(new Date("2026-08-14T23:00:00.000Z"));
ok("de noite também não sai", wa.enviadas.length === antes);
ok("continua pendente", pendentes().length === 2);

// Sexta, 14h em SP: sai.
await rodarCicloDeFollowUp(new Date("2026-08-14T17:00:00.000Z"));
ok("dentro da janela, sai", wa.enviadas.length === antes + 1, JSON.stringify(wa.enviadas));

secao("a trava mestra também segura os toques já agendados");
await comToqueVencido();
antes = wa.enviadas.length;
delete process.env.OUTREACH_ENABLED;
await rodarCicloDeFollowUp(depois(72));
ok("com OUTREACH_ENABLED desligado, o toque não sai", wa.enviadas.length === antes);
ok("e segue pendente para quando religar", pendentes().length === 2);
process.env.OUTREACH_ENABLED = "true";
await rodarCicloDeFollowUp(depois(72));
ok("religado, o toque sai", wa.enviadas.length === antes + 1);

secao("um toque frio por rodada (vinte textos idênticos no mesmo segundo é assinatura de robô)");
{
  state.reset();
  wa.reset();
  abordagemNoPainel(true);
  // Cinco leads já abordados, todos com o toque 1 vencido.
  for (let i = 0; i < 5; i++) {
    const id = state.nextId++;
    state.leads.push({
      id,
      phone: `55859999${String(1000 + i)}`,
      name: "Marina",
      status: "cold",
      funnelStage: "contacted",
      outreachStatus: "sent",
      createdAt: new Date(),
    });
    state.followUps.push({
      id: state.nextId++,
      leadId: id,
      status: "pending",
      touchNumber: 1,
      kind: "abordagem",
      scheduledAt: depois(1),
      messageTemplate: null,
    });
  }
  await rodarCicloDeFollowUp(depois(72));
  ok("saiu UM, não cinco", wa.enviadas.length === 1, JSON.stringify(wa.enviadas.map((e: any) => e.phone)));
  ok("os outros quatro seguem pendentes", pendentes().length === 4);

  // As rodadas seguintes escoam a fila, uma a uma — cada uma 5 minutos depois,
  // como na vida real. Desde a Rodada 51 os toques dividem o intervalo mínimo
  // com o resto do ritmo frio, então rodada no MESMO instante não escoa nada
  // (é o comportamento certo: dois toques no mesmo segundo é o bloco que este
  // teste existe para impedir).
  await rodarCicloDeFollowUp(new Date(depois(72).getTime() + PASSO_DO_RITMO));
  await rodarCicloDeFollowUp(new Date(depois(72).getTime() + 2 * PASSO_DO_RITMO));
  ok("duas rodadas depois, três saíram", wa.enviadas.length === 3);
  ok("e dois seguem na fila", pendentes().length === 2);

  // A prova do intervalo: uma rodada extra no MESMO instante da anterior não
  // solta o quarto toque — ainda não passou o mínimo desde o terceiro.
  await rodarCicloDeFollowUp(new Date(depois(72).getTime() + 2 * PASSO_DO_RITMO));
  ok("no mesmo instante, o quarto não sai", wa.enviadas.length === 3);
  ok("mas segue pendente, não perdido", pendentes().length === 2);
}

secao("toque frio CONSOME a cota do dia (Rodada 51 — antes saía por fora)");
{
  // Um toque vencido… num dia em que as 40 aberturas já saíram. Antes da
  // Rodada 51 ele sairia assim mesmo, e o número mandaria 41+; agora o balde é
  // um só e o toque espera amanhã.
  state.reset();
  wa.reset();
  abordagemNoPainel(true);
  const id = state.nextId++;
  state.leads.push({
    id,
    phone: NUMERO,
    name: "Marina",
    status: "cold",
    funnelStage: "contacted",
    outreachStatus: "sent",
    createdAt: new Date(),
  });
  state.followUps.push({
    id: state.nextId++,
    leadId: id,
    status: "pending",
    touchNumber: 1,
    kind: "abordagem",
    scheduledAt: new Date(TERCA_14H.getTime() - 1000),
    messageTemplate: null,
  });
  // 40 aberturas hoje, duas horas atrás (12h SP — mesmo dia, fora da última hora).
  for (let i = 0; i < 40; i++) {
    state.leads.push({
      id: state.nextId++,
      phone: `55859996${String(i).padStart(4, "0")}`,
      status: "cold",
      outreachStatus: "sent",
      outreachSentAt: new Date(TERCA_14H.getTime() - 2 * HORA),
    });
  }
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("com a cota do dia cheia, o toque não sai", wa.enviadas.length === 0, JSON.stringify(wa.enviadas));
  ok("e segue pendente para amanhã", pendentes().length === 1);
}

secao("toque frio espera o intervalo mínimo desde a ÚLTIMA mensagem fria — de qualquer agendador");
{
  state.reset();
  wa.reset();
  abordagemNoPainel(true);
  const id = state.nextId++;
  state.leads.push({
    id,
    phone: NUMERO,
    name: "Marina",
    status: "cold",
    funnelStage: "contacted",
    outreachStatus: "sent",
    createdAt: new Date(),
  });
  state.followUps.push({
    id: state.nextId++,
    leadId: id,
    status: "pending",
    touchNumber: 1,
    kind: "abordagem",
    scheduledAt: new Date(TERCA_14H.getTime() - 1000),
    messageTemplate: null,
  });
  // Uma ABERTURA (do outro agendador) saiu 30 segundos atrás.
  state.leads.push({
    id: state.nextId++,
    phone: "5585999990001",
    status: "cold",
    outreachStatus: "sent",
    outreachSentAt: new Date(TERCA_14H.getTime() - 30 * 1000),
  });
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("30s depois de uma abertura, o toque espera", wa.enviadas.length === 0, JSON.stringify(wa.enviadas));
  ok("segue pendente", pendentes().length === 1);

  // Passado o intervalo (sorteado, no máximo 40 minutos), sai.
  await rodarCicloDeFollowUp(new Date(TERCA_14H.getTime() + PASSO_DO_RITMO));
  ok("passado o intervalo, sai", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
}

secao("número que rejeita 3 envios: a cadência inteira morre e o Telegram avisa");
{
  // O lead recebeu a abordagem, mas o número morreu (ou nunca existiu e a
  // Evolution demorou a dizer). O toque 1 vence e a Evolution rejeita — três
  // rodadas seguidas. Na terceira, desiste-se do número: TODOS os pendentes
  // dele morrem (o toque 2 incluso, que nem venceu) e o alerta sai.
  state.reset();
  wa.reset();
  abordagemNoPainel(true);
  const id = state.nextId++;
  state.leads.push({
    id,
    phone: NUMERO,
    name: "Marina",
    status: "cold",
    funnelStage: "contacted",
    outreachStatus: "sent",
    createdAt: new Date(),
  });
  state.followUps.push({
    id: state.nextId++,
    leadId: id,
    status: "pending",
    touchNumber: 1,
    kind: "abordagem",
    scheduledAt: new Date(TERCA_14H.getTime() - 1000),
    messageTemplate: null,
  });
  state.followUps.push({
    id: state.nextId++,
    leadId: id,
    status: "pending",
    touchNumber: 2,
    kind: "abordagem",
    scheduledAt: depois(200), // ainda no futuro
    messageTemplate: null,
  });

  wa.entrega = false;
  wa.falhaPermanente = true;
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("1ª rejeição: segue pendente", pendentes().length === 2);
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("2ª rejeição: ainda pendente", pendentes().length === 2);
  ok("ainda sem alerta", wa.naoEntregaveis.length === 0);
  await rodarCicloDeFollowUp(TERCA_14H);
  ok(
    "3ª rejeição: TODOS os pendentes cancelados (o toque 2 incluso)",
    pendentes().length === 0 && toques().every((f: any) => f.status === "cancelled"),
    JSON.stringify(toques().map((f: any) => f.status)),
  );
  ok("o Telegram foi avisado, uma vez só", wa.naoEntregaveis.length === 1, JSON.stringify(wa.naoEntregaveis));
  ok(
    "com o número no alerta, para conferir na planilha",
    wa.naoEntregaveis[0].lead.phone === NUMERO,
  );
  ok("a contagem ficou no lead", state.leads[0].falhasDeEnvio === 3, String(state.leads[0].falhasDeEnvio));

  // E nada volta: rodadas futuras não ressuscitam a cadência.
  wa.entrega = true;
  wa.falhaPermanente = false;
  const antesDeTudo = wa.enviadas.length;
  await rodarCicloDeFollowUp(depois(300));
  ok("nada mais sai para este número", wa.enviadas.length === antesDeTudo);
}

// ───────────────────────────────────────────────────────────────────────────
// QUAIS TRAVAS VALEM PARA O TOQUE DE CONVERSA (revisto em 18/08/2026).
//
// Este bloco afirmava "o follow-up de conversa NÃO é freado pela janela", e
// afirmava certo pela metade. O princípio continua de pé: a trava mestra, o
// botão do painel e o fim de semana protegem quem NÃO pediu contato, e quem já
// está conversando não espera segunda-feira por causa deles.
//
// O que estava errado era estender isso ao HORÁRIO. Sem janela nenhuma, o
// toque saía de madrugada: em 18/08/2026 o lead 59 recebeu o toque 2 à 01:28.
// Mensagem automática nessa hora é o que faz um dentista bloquear o número — e
// o número é o mesmo da prospecção, então a conta é paga pelos dois lados.
//
// Decisão do dono, 18/08/2026: passa a valer a janela de HORÁRIO, e só ela.
// ───────────────────────────────────────────────────────────────────────────
secao("toque de conversa — fim de semana e botão do painel continuam NÃO freando");
{
  state.reset();
  wa.reset();
  abordagemNoPainel(true);
  const id = state.nextId++;
  state.leads.push({
    id,
    phone: NUMERO,
    name: "Marina",
    status: "warm",
    funnelStage: "qualified",
    outreachStatus: "none",
    createdAt: new Date(),
  });
  state.followUps.push({
    id: state.nextId++,
    leadId: id,
    status: "pending",
    touchNumber: 1,
    kind: "conversa",
    scheduledAt: depois(1),
    messageTemplate: "toque de conversa",
  });
  delete process.env.OUTREACH_ENABLED;
  ctrl.reply = "TOQUE DE CONVERSA GERADO AGORA";
  // Domingo, 14h em SP, trava mestra desligada: sai assim mesmo.
  await rodarCicloDeFollowUp(new Date("2026-08-16T17:00:00.000Z"));
  ok(
    "domingo à tarde, com a trava mestra desligada, o toque de conversa sai",
    wa.enviadas.length === 1,
    JSON.stringify(wa.enviadas),
  );
  // 22/08/2026: a asserção media o `messageTemplate` do banco, porque até aqui
  // era ele que saía. Agora o texto nasce do modelo na hora do envio, e medir o
  // template de novo seria travar a versão CONGELADA que esta mudança existe
  // para eliminar — a fixture modelava o defeito.
  ok(
    "e com o texto gerado agora, não com o congelado no banco",
    wa.enviadas[0]?.message === "TOQUE DE CONVERSA GERADO AGORA",
    JSON.stringify(wa.enviadas),
  );
  process.env.OUTREACH_ENABLED = "true";
}

secao("toque de conversa — a MADRUGADA freia, e o toque fica pendente");
{
  state.reset();
  wa.reset();
  abordagemNoPainel(true);
  const id = state.nextId++;
  state.leads.push({
    id,
    phone: NUMERO,
    name: "Marina",
    status: "warm",
    funnelStage: "qualified",
    outreachStatus: "none",
    createdAt: new Date(),
  });
  state.followUps.push({
    id: state.nextId++,
    leadId: id,
    status: "pending",
    touchNumber: 2,
    kind: "conversa",
    scheduledAt: new Date("2026-08-18T02:00:00.000Z"),
    messageTemplate: "toque de conversa",
  });

  // 01:28 em São Paulo — a hora exata em que o lead 59 recebeu o dele.
  await rodarCicloDeFollowUp(new Date("2026-08-18T04:28:00.000Z"));
  ok("de madrugada não sai", wa.enviadas.length === 0, JSON.stringify(wa.enviadas));
  ok(
    "e NÃO foi cancelado — segue pendente, como na pausa humana",
    pendentes().length === 1,
    JSON.stringify(state.followUps.map((f: any) => f.status)),
  );

  // 19h em SP: ainda fechado (a janela é 9h-18h).
  await rodarCicloDeFollowUp(new Date("2026-08-18T22:00:00.000Z"));
  ok("de noite também não sai", wa.enviadas.length === 0);
  ok("continua pendente", pendentes().length === 1);

  // 9h em SP do dia seguinte: sai — e o texto é escrito NESTE momento, que é
  // metade do motivo de gerar na hora do envio em vez de no armamento. O toque
  // ficou três ciclos parado esperando o horário; um texto congelado abriria
  // com a saudação da madrugada em que ele venceu.
  ctrl.reply = "TOQUE DE CONVERSA GERADO AGORA";
  await rodarCicloDeFollowUp(new Date("2026-08-19T12:00:00.000Z"));
  ok(
    "quando o horário abre, sai",
    wa.enviadas.length === 1,
    JSON.stringify(wa.enviadas),
  );
  ok(
    "e com o texto gerado agora, não com o congelado no banco",
    wa.enviadas[0]?.message === "TOQUE DE CONVERSA GERADO AGORA",
    JSON.stringify(wa.enviadas),
  );
  // O toque vira 'sent'. Os pendentes NÃO zeram, e é correto: era o último da
  // cadência de conversa, então o agendador armou a reativação em seguida.
  ok(
    "e aí sim o toque vira 'sent'",
    state.followUps.filter((f: any) => f.kind === "conversa").every((f: any) => f.status === "sent"),
    JSON.stringify(state.followUps.map((f: any) => `${f.kind}:${f.status}`)),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// A RESPOSTA DELE troca a cadência.
// ───────────────────────────────────────────────────────────────────────────

secao("ele responde: sai da cadência de abordagem e entra na de conversa");
{
  filaCom();
  await rodarCicloDeAbordagem(TERCA_14H);
  ok("a cadência de abordagem está armada", pendentes().length === 2);

  await chamar(evento("quem é você?", NUMERO));

  ok(
    "os dois toques de abordagem foram cancelados",
    toques().every((f: any) => f.status === "cancelled"),
    JSON.stringify(toques().map((f: any) => f.status)),
  );
  const novos = state.followUps.filter((f: any) => f.kind === "conversa");
  // "quem é você?" pontua só o respondeu_algo → frio → 2 toques (Rodada 41).
  ok("e a leva de conversa foi armada no lugar", novos.length === 2, JSON.stringify(novos.length));
  ok("todos os pendentes agora são de conversa", pendentes().every((f: any) => f.kind === "conversa"));

  // O ciclo seguinte não pode ressuscitar um toque frio.
  //
  // O toque frio não tem mais texto fixo para procurar entre as enviadas. O que
  // o identifica agora é o PROMPT com que ele seria gerado: se nenhuma chamada
  // nova ao modelo usou o `JULIA_TOQUE_PROMPT`, nenhum toque frio saiu — e essa
  // prova é mais forte que a antiga, porque pega inclusive o toque que fosse
  // gerado e não entregue.
  const chamadasAntesDoCiclo = ctrl.mensagens.length;
  await rodarCicloDeFollowUp(depois(240));
  const friosDepois = ctrl.mensagens
    .slice(chamadasAntesDoCiclo)
    .filter((msgs: any) => msgs[0]?.content === JULIA_TOQUE_PROMPT);
  ok("e nenhum toque frio sai depois disso", friosDepois.length === 0, JSON.stringify(friosDepois));
  ok(
    "o lead não é marcado como 'nao_respondeu' — ele respondeu",
    state.leads[0].outreachStatus !== "nao_respondeu",
    state.leads[0].outreachStatus,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 22/08/2026 — O TOQUE DUPLICADO, e a cota que impede a rajada.
//
// O caso real: até 17/08 o webhook não serializava por lead, e duas respostas
// quase simultâneas cancelavam a leva pendente e inseriam DUAS levas novas. A
// trava de `lib/turno-do-lead.ts` fechou a produção de duplicatas — e as linhas
// já gravadas continuaram no banco. Em 22/08 uma pausa de três dias caiu, a
// fila represada saiu de uma vez, e um lead recebeu a MESMA mensagem duas
// vezes, com 11 segundos entre elas.
//
// A asserção que MAIS importa aqui não é "o gêmeo é cancelado" — é a de baixo,
// a do rearme: (lead, kind, touchNumber) se repete de leva em leva, e a
// primeira versão desta regra, escrita só com essa chave, cancelava o toque 1
// de quem tinha VOLTADO A RESPONDER. Calar quem voltou a falar é pior do que o
// defeito que a regra conserta.
// ───────────────────────────────────────────────────────────────────────────
secao("toque duplicado — o gêmeo é cancelado, o rearme não");
{
  state.reset();
  wa.reset();
  ctrl.reset();
  abordagemNoPainel(true);
  ctrl.reply = "TOQUE GERADO";
  const id = state.nextId++;
  state.leads.push({
    id,
    phone: NUMERO,
    name: "Marina",
    status: "warm",
    funnelStage: "qualified",
    outreachStatus: "none",
    createdAt: new Date(),
  });
  // Os dois gêmeos: mesma leva, mesmo lugar da cadência, armados com segundos
  // de diferença por dois handlers que corriam em paralelo.
  for (const atraso of [0, 3000]) {
    state.followUps.push({
      id: state.nextId++,
      leadId: id,
      status: "pending",
      touchNumber: 1,
      kind: "conversa",
      scheduledAt: new Date(TERCA_14H.getTime() - HORA + atraso),
      messageTemplate: "texto congelado",
    });
  }

  await rodarCicloDeFollowUp(TERCA_14H);
  ok(
    "os dois venceram juntos e UMA mensagem saiu",
    wa.enviadas.length === 1,
    JSON.stringify(wa.enviadas.map((e: any) => e.message)),
  );
  ok(
    "o gêmeo foi CANCELADO, não adiado — adiar só empurra a repetição",
    state.followUps.filter((f: any) => f.status === "cancelled").length === 1,
    JSON.stringify(state.followUps.map((f: any) => f.status)),
  );
  // E a prova de que ele não volta. Sem esta passada, a asserção de cima é a
  // única que enxerga a deduplicação: no PRIMEIRO ciclo a cota de um por rodada
  // já seguraria a segunda mensagem sozinha, e o teste passaria verde mesmo com
  // a deduplicação desligada. É no ciclo seguinte que o gêmeo adiado sairia.
  await rodarCicloDeFollowUp(new Date(TERCA_14H.getTime() + 5 * 60 * 1000));
  ok(
    "e no ciclo seguinte ele NÃO volta — continua uma mensagem só",
    wa.enviadas.length === 1,
    JSON.stringify(wa.enviadas.map((e: any) => e.message)),
  );

  // O REARME, que é o falso positivo. O dentista responde depois de o toque 1
  // já ter saído, e o webhook arma uma leva nova começando do 1 de novo. Este
  // toque 1 é agendado DEPOIS de o anterior ter saído — e é isso, e só isso,
  // que o distingue de um gêmeo.
  wa.reset();
  state.followUps.push({
    id: state.nextId++,
    leadId: id,
    status: "pending",
    touchNumber: 1,
    kind: "conversa",
    scheduledAt: new Date(TERCA_14H.getTime() + HORA),
    messageTemplate: null,
  });
  await rodarCicloDeFollowUp(new Date(TERCA_14H.getTime() + 2 * HORA));
  ok(
    "quem voltou a responder recebe o toque 1 da leva NOVA",
    wa.enviadas.length === 1,
    JSON.stringify(wa.enviadas.map((e: any) => e.message)),
  );
}

secao("toque de conversa — um por ciclo, para a pausa não virar rajada");
{
  state.reset();
  wa.reset();
  ctrl.reset();
  abordagemNoPainel(true);
  ctrl.reply = "TOQUE GERADO";
  // Três leads diferentes com toque vencido, como no represamento de 22/08:
  // leads distintos de propósito, para provar que a cota é do CICLO e não do
  // lead — a deduplicação já cuida do mesmo lead.
  for (let i = 0; i < 3; i++) {
    const id = state.nextId++;
    state.leads.push({
      id,
      phone: `55859999900${i}0`,
      name: "Marina",
      status: "warm",
      funnelStage: "qualified",
      outreachStatus: "none",
      createdAt: new Date(),
    });
    state.followUps.push({
      id: state.nextId++,
      leadId: id,
      status: "pending",
      touchNumber: 1,
      kind: "conversa",
      scheduledAt: new Date(TERCA_14H.getTime() - HORA),
      messageTemplate: null,
    });
  }

  // Só os de CONVERSA: o toque 1 aqui é o último da cadência de cada lead,
  // então cada envio arma a fila de reativação em seguida (Rodada 41) e o total
  // de pendentes cresce por um motivo que nada tem a ver com esta cota.
  const conversaPendentes = () =>
    state.followUps.filter(
      (f: any) => f.kind === "conversa" && f.status === "pending",
    );

  await rodarCicloDeFollowUp(TERCA_14H);
  ok(
    "três vencidos, UMA mensagem no ciclo",
    wa.enviadas.length === 1,
    JSON.stringify(wa.enviadas.map((e: any) => e.phone)),
  );
  ok(
    "os outros dois seguem PENDENTES — atrasar é o certo, cancelar não",
    conversaPendentes().length === 2,
    JSON.stringify(state.followUps.map((f: any) => `${f.kind}:${f.status}`)),
  );

  await rodarCicloDeFollowUp(new Date(TERCA_14H.getTime() + 5 * 60 * 1000));
  ok("no ciclo seguinte sai o segundo", wa.enviadas.length === 2);
  ok("e um ainda espera", conversaPendentes().length === 1);
}

delete process.env.OUTREACH_ENABLED;
fim();
