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
  ABORDAGEM_TOQUES,
  ABORDAGEM_DELAYS_HOURS,
  FOLLOW_UP_TEMPLATES,
} from "../src/julia-persona";
import { leadElegivel, EXPLICACAO_INELEGIVEL } from "../src/lib/outreach";

/** Uma terça-feira, 14h em São Paulo. Dentro da janela, como no outreach.test. */
const TERCA_14H = new Date("2026-08-11T17:00:00.000Z");
const HORA = 60 * 60 * 1000;
const depois = (horas: number) => new Date(TERCA_14H.getTime() + horas * HORA);

const NUMERO = "5585999997777";

const toques = () => state.followUps.filter((f: any) => f.kind === "abordagem");
const pendentes = () => state.followUps.filter((f: any) => f.status === "pending");

/** Um lead importado, esperando a primeira mensagem. */
function filaCom(extra: Record<string, unknown> = {}) {
  state.reset();
  wa.reset();
  ctrl.reset();
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

for (const t of [1, 2] as const) {
  const texto = ABORDAGEM_TOQUES[t]("Marina");
  const achadas = AFIRMACOES_SEM_BASE.filter((f) =>
    texto.toLowerCase().includes(f.toLowerCase()),
  );
  ok(`toque ${t}: não afirma nada sobre um passado que não existe`, achadas.length === 0, achadas.join(" | "));
  ok(`toque ${t}: sem nome, ainda assim começa em maiúscula`, /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(ABORDAGEM_TOQUES[t](null)), ABORDAGEM_TOQUES[t](null));
  ok(`toque ${t}: com nome, trata como Dra. Marina`, texto.startsWith("Dra. Marina, "), texto);
}

ok(
  "a dor não tem por onde entrar: o toque só recebe o nome",
  ABORDAGEM_TOQUES[1].length === 1 && ABORDAGEM_TOQUES[2].length === 1,
);
ok(
  "e a cadência de conversa continua sendo a que afirma a conversa (é por isso que são duas)",
  FOLLOW_UP_TEMPLATES[1]("Marina", null).includes("começou a conversar"),
);

secao("o desenho dos dois toques");
ok(
  "toque 1 dá a saída fácil (é o que vira opt-out em vez de denúncia)",
  ABORDAGEM_TOQUES[1]("Marina").includes("é só me dizer que eu não incomodo mais"),
);
ok(
  "toque 1 NÃO manda link — ele ainda não deu licença para nada",
  !ABORDAGEM_TOQUES[1]("Marina").includes("captaclin.com.br"),
);
ok(
  "toque 2 se anuncia como a última",
  ABORDAGEM_TOQUES[2]("Marina").includes("última mensagem"),
);
ok(
  "toque 2 deixa o endereço e sai",
  ABORDAGEM_TOQUES[2]("Marina").includes("https://www.captaclin.com.br"),
);
ok("nenhum dos dois vende preço ou plano", ![1, 2].some((t) => /R\$|plano|trial|garantia/i.test(ABORDAGEM_TOQUES[t as 1 | 2]("Marina"))));

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
{
  const achadas = toques().flatMap((f: any) =>
    AFIRMACOES_SEM_BASE.filter((frase) => f.messageTemplate.toLowerCase().includes(frase.toLowerCase())),
  );
  ok("e o texto gravado neles não afirma nada sem base", achadas.length === 0, achadas.join(" | "));
}

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

// Toque 1.
await rodarCicloDeFollowUp(depois(72));
ok(
  "72h depois sai o toque 1",
  wa.enviadas[wa.enviadas.length - 1].message === ABORDAGEM_TOQUES[1]("Marina"),
  wa.enviadas[wa.enviadas.length - 1].message,
);
ok("só o toque 1 (o 2 ainda não venceu)", pendentes().length === 1);
ok("o lead continua 'sent' — ainda pode responder", state.leads[0].outreachStatus === "sent");

// Toque 2.
await rodarCicloDeFollowUp(depois(240));
ok(
  "10 dias depois sai o toque 2",
  wa.enviadas[wa.enviadas.length - 1].message === ABORDAGEM_TOQUES[2]("Marina"),
  wa.enviadas[wa.enviadas.length - 1].message,
);
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
      messageTemplate: ABORDAGEM_TOQUES[1]("Marina"),
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
  const MIN = 60 * 1000;
  await rodarCicloDeFollowUp(new Date(depois(72).getTime() + 5 * MIN));
  await rodarCicloDeFollowUp(new Date(depois(72).getTime() + 10 * MIN));
  ok("duas rodadas depois, três saíram", wa.enviadas.length === 3);
  ok("e dois seguem na fila", pendentes().length === 2);

  // A prova do intervalo: uma rodada extra no MESMO instante da anterior não
  // solta o quarto toque — ainda não passou o mínimo desde o terceiro.
  await rodarCicloDeFollowUp(new Date(depois(72).getTime() + 10 * MIN));
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
    messageTemplate: ABORDAGEM_TOQUES[1]("Marina"),
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
    messageTemplate: ABORDAGEM_TOQUES[1]("Marina"),
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

  // Cinco minutos depois (o ciclo seguinte de verdade), sai.
  await rodarCicloDeFollowUp(new Date(TERCA_14H.getTime() + 5 * 60 * 1000));
  ok("no ciclo seguinte, sai", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
}

secao("número que rejeita 3 envios: a cadência inteira morre e o Telegram avisa");
{
  // O lead recebeu a abordagem, mas o número morreu (ou nunca existiu e a
  // Evolution demorou a dizer). O toque 1 vence e a Evolution rejeita — três
  // rodadas seguidas. Na terceira, desiste-se do número: TODOS os pendentes
  // dele morrem (o toque 2 incluso, que nem venceu) e o alerta sai.
  state.reset();
  wa.reset();
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
    messageTemplate: ABORDAGEM_TOQUES[1]("Marina"),
  });
  state.followUps.push({
    id: state.nextId++,
    leadId: id,
    status: "pending",
    touchNumber: 2,
    kind: "abordagem",
    scheduledAt: depois(200), // ainda no futuro
    messageTemplate: ABORDAGEM_TOQUES[2]("Marina"),
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

secao("follow-up de conversa NÃO é freado pela janela (ele já respondeu)");
{
  state.reset();
  wa.reset();
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
  // Domingo de noite, trava mestra desligada: o toque de CONVERSA sai assim
  // mesmo. A janela da prospecção protege quem não pediu contato; quem pediu
  // não tem por que esperar segunda-feira.
  await rodarCicloDeFollowUp(new Date("2026-08-16T23:00:00.000Z"));
  ok("saiu", wa.enviadas.length === 1 && wa.enviadas[0].message === "toque de conversa", JSON.stringify(wa.enviadas));
  process.env.OUTREACH_ENABLED = "true";
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
  const antesDoCiclo = wa.enviadas.length;
  await rodarCicloDeFollowUp(depois(240));
  const friosDepois = wa.enviadas
    .slice(antesDoCiclo)
    .filter((e: any) => e.message === ABORDAGEM_TOQUES[1]("Marina") || e.message === ABORDAGEM_TOQUES[2]("Marina"));
  ok("e nenhum toque frio sai depois disso", friosDepois.length === 0, JSON.stringify(friosDepois));
  ok(
    "o lead não é marcado como 'nao_respondeu' — ele respondeu",
    state.leads[0].outreachStatus !== "nao_respondeu",
    state.leads[0].outreachStatus,
  );
}

delete process.env.OUTREACH_ENABLED;
fim();
