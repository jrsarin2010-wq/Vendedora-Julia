/**
 * Rodada 41, Parte 3 — reativação de longo prazo.
 *
 * Depois do último toque de conversa, silêncio permanente: todo dentista que
 * não fechava em 7 dias estava morto no funil. Agora quem esquentou e não
 * fechou entra na fila longa (+30/+60/+90 dias), com motivo novo em cada toque
 * e saída explícita em todos.
 */
import { ok, secao, fim } from "./assert";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { linhas } from "./stubs/logger.mjs";
import { abordagemNoPainel } from "./painel";
import { rodarCicloDeFollowUp } from "../src/lib/follow-up-scheduler";
import { TOQUES_REATIVACAO, REATIVACAO_DELAYS_DIAS } from "../src/julia-persona";
import {
  LIMITE_REATIVACOES_POR_DIA,
  elegivelParaReativacao,
  decidirToqueDeReativacao,
  contarReativacoesDeHoje,
} from "../src/lib/reativacao";

// Terça-feira, 14h em São Paulo: dentro da janela da prospecção.
const TERCA_14H = new Date("2026-08-11T17:00:00.000Z");
// Domingo, 14h em São Paulo: fora dela.
const DOMINGO_14H = new Date("2026-08-16T17:00:00.000Z");

process.env.OUTREACH_ENABLED = "true";
delete process.env.REATIVACAO_NOVIDADE;

// ── Os textos ───────────────────────────────────────────────────────────────

secao("os três toques têm motivo próprio e saída explícita");
{
  const t1 = TOQUES_REATIVACAO[1]("Fernando", "perde paciente fora do horário");
  ok("toque 1: o gancho é a DOR dele", t1.includes("perde paciente fora do horário"), t1);
  ok('toque 1: saída explícita ("é só me dizer")', t1.includes("é só me dizer que eu não te procuro mais"));

  const t1SemDor = TOQUES_REATIVACAO[1]("Fernando", null);
  ok(
    "toque 1 sem dor anotada: gancho genérico honesto, mesma saída",
    t1SemDor.includes("WhatsApp da clínica") && t1SemDor.includes("é só me dizer"),
    t1SemDor,
  );

  const t2 = TOQUES_REATIVACAO[2]("Fernando", "a gente lançou a ligação por IA");
  ok("toque 2: o gancho é a NOVIDADE", t2.includes("a gente lançou a ligação por IA"), t2);
  ok('toque 2: saída explícita ("é só me dizer")', t2.includes("é só me dizer"));

  const t3 = TOQUES_REATIVACAO[3]("Fernando");
  ok(
    "toque 3: é uma despedida honesta — a saída É a mensagem",
    t3.includes("essa é a última vez que eu te procuro"),
    t3,
  );
  ok("toque 3: deixa o endereço", t3.includes("https://www.captaclin.com.br"));

  ok(
    "nenhum dos três tem emoji (mensagem automática depois de um mês de silêncio)",
    ![t1, t2, t3].some((t) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)),
  );
}

secao("a fila é de três toques: +30, +60 e +90 dias");
ok("os dias são 30/60/90", JSON.stringify(REATIVACAO_DELAYS_DIAS) === JSON.stringify([30, 60, 90]));

// ── Quem entra, quem nunca entra ────────────────────────────────────────────

secao("elegibilidade — quem entra e quem NUNCA entra");
ok("warm entra", elegivelParaReativacao({ status: "warm", atencao: null }).elegivel);
ok("hot entra", elegivelParaReativacao({ status: "hot", atencao: null }).elegivel);
ok(
  "opt-out (lost) nunca — pediu para parar, e isso não expira",
  elegivelParaReativacao({ status: "lost", atencao: null }).motivo === "opt_out",
);
ok(
  "cliente (closed) nunca",
  elegivelParaReativacao({ status: "closed", atencao: null }).motivo === "ja_cliente",
);
ok(
  "frio nunca — reativar quem nunca esquentou é spam",
  elegivelParaReativacao({ status: "cold", atencao: null }).motivo === "nunca_esquentou",
);
ok(
  "na central de vigia sem resolução, nunca",
  elegivelParaReativacao({ status: "hot", atencao: "pediu_pessoa" }).motivo === "na_vigia",
);

secao("decisão por toque — as escadas da fila longa");
ok(
  "toque 2 SEM novidade configurada não dispara (cancela)",
  (() => {
    const d = decidirToqueDeReativacao(2, { status: "warm", atencao: null }, "");
    return !d.envia && d.cancela === true && d.motivo === "sem_novidade";
  })(),
);
ok(
  "toque 2 COM novidade sai para morno ou mais",
  decidirToqueDeReativacao(2, { status: "warm", atencao: null }, "ligação por IA").envia,
);
ok(
  "toque 3 só para quente ou mais: warm não recebe",
  !decidirToqueDeReativacao(3, { status: "warm", atencao: null }, "x").envia,
);
ok(
  "toque 3 sai para hot",
  decidirToqueDeReativacao(3, { status: "hot", atencao: null }, "x").envia,
);

secao("contagem do dia (fuso de São Paulo)");
{
  const hoje1 = new Date(TERCA_14H.getTime() - 60 * 60 * 1000);
  const ontem = new Date(TERCA_14H.getTime() - 26 * 60 * 60 * 1000);
  const futuro = new Date(TERCA_14H.getTime() + 60 * 60 * 1000);
  ok(
    "conta só o que saiu hoje — ontem, futuro e nulo ficam fora",
    contarReativacoesDeHoje([hoje1, hoje1, ontem, futuro, null], TERCA_14H) === 2,
  );
}

// ── O agendador: fim da cadência de conversa arma a fila ────────────────────

const NUMERO = "5585999998888";

function fimDeCadencia(leadExtras: Record<string, unknown> = {}): void {
  state.reset();
  wa.reset();
  linhas.length = 0;
  // Etapa 4: a reativação é toque FRIO e passa pelo botão do painel, como a
  // abordagem. O reset apagou a chave, e ausente é desligada.
  abordagemNoPainel(true);
  state.leads.push({
    id: 1,
    phone: NUMERO,
    name: "Fernando",
    status: "warm",
    funnelStage: "interested",
    atencao: null,
    painPoints: "perde paciente fora do horário",
    createdAt: new Date(),
    ...leadExtras,
  });
  // O último toque de conversa da leva, vencido. touchNumber 2 (cadência de
  // frio/morno pode terminar no 2) — e evita a checagem de promessa do toque 1.
  state.followUps.push({
    id: 900,
    leadId: 1,
    kind: "conversa",
    status: "pending",
    touchNumber: 2,
    scheduledAt: new Date(TERCA_14H.getTime() - 1000),
    messageTemplate: "toque final de conversa",
  });
}

const reativacoes = () => state.followUps.filter((f: any) => f.kind === "reativacao");

secao("último toque de conversa sai → lead warm entra na fila de reativação");
{
  fimDeCadencia();
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("o toque de conversa saiu", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
  ok("três toques de reativação armados", reativacoes().length === 3, String(reativacoes().length));
  const dias = reativacoes().map((f: any) =>
    Math.round((new Date(f.scheduledAt).getTime() - TERCA_14H.getTime()) / 86_400_000),
  );
  ok("em +30, +60 e +90 dias", JSON.stringify(dias) === JSON.stringify([30, 60, 90]), JSON.stringify(dias));
  ok(
    "sem texto gravado — o texto nasce no envio",
    reativacoes().every((f: any) => f.messageTemplate === null),
  );
  ok(
    "o toque enviado ganhou carimbo de quando saiu",
    Boolean((state.followUps as any[]).find((f) => f.id === 900)?.sentAt),
  );
}

secao("quem NUNCA entra na fila, mesmo no fim da cadência");
{
  fimDeCadencia({ status: "cold" });
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("frio: toque sai, mas fila NÃO é armada", reativacoes().length === 0);
  ok(
    "e o motivo fica no log",
    linhas.some((l: any) => l.msg.includes("Fim da cadência sem reativação")),
    JSON.stringify(linhas),
  );

  fimDeCadencia({ status: "lost" });
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("opt-out: nada é enviado e nada é armado", wa.enviadas.length === 0 && reativacoes().length === 0);

  fimDeCadencia({ status: "closed" });
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("cliente: nada é enviado e nada é armado", wa.enviadas.length === 0 && reativacoes().length === 0);

  fimDeCadencia({ atencao: "sem_resposta" });
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("na vigia: o toque sai, mas a fila NÃO é armada", reativacoes().length === 0);
}

secao("a fila só é armada quando NÃO sobra toque pendente");
{
  fimDeCadencia();
  state.followUps.push({
    id: 901,
    leadId: 1,
    kind: "conversa",
    status: "pending",
    touchNumber: 3,
    scheduledAt: new Date(TERCA_14H.getTime() + 48 * 60 * 60 * 1000), // ainda no futuro
    messageTemplate: "toque 3, ainda por vir",
  });
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("com toque ainda pendente, a fila não é armada", reativacoes().length === 0);
}

// ── O agendador: enviando os toques da fila ─────────────────────────────────

function toqueVencido(
  touchNumber: number,
  leadExtras: Record<string, unknown> = {},
): void {
  state.reset();
  wa.reset();
  linhas.length = 0;
  abordagemNoPainel(true);
  state.leads.push({
    id: 1,
    phone: NUMERO,
    name: "Fernando",
    status: "warm",
    funnelStage: "interested",
    atencao: null,
    painPoints: "paciente some no fim de semana",
    createdAt: new Date(),
    ...leadExtras,
  });
  state.followUps.push({
    id: 900,
    leadId: 1,
    kind: "reativacao",
    status: "pending",
    touchNumber,
    scheduledAt: new Date(TERCA_14H.getTime() - 1000),
    messageTemplate: null,
  });
}

const meuToque = () => (state.followUps as any[]).find((f) => f.id === 900);

secao("toque 1 (+30d): sai com a dor dele e a saída fácil");
{
  toqueVencido(1);
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("saiu", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
  ok(
    "com a dor que ele contou",
    wa.enviadas[0].message.includes("paciente some no fim de semana"),
    wa.enviadas[0].message,
  );
  ok("com a saída explícita", wa.enviadas[0].message.includes("é só me dizer"));
  ok("virou 'sent' com carimbo", meuToque().status === "sent" && Boolean(meuToque().sentAt));
  ok("a mensagem foi para o histórico", state.messages.length === 1);
}

secao("toque 2 (+60d): só dispara com novidade REAL configurada");
{
  delete process.env.REATIVACAO_NOVIDADE;
  toqueVencido(2);
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("sem novidade: nada é enviado", wa.enviadas.length === 0, JSON.stringify(wa.enviadas));
  ok("e o toque MORRE (cancelled), não fica adiado", meuToque().status === "cancelled", meuToque().status);

  process.env.REATIVACAO_NOVIDADE = "a gente lançou a ligação por IA — ela liga pro paciente agora";
  toqueVencido(2);
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("com novidade: sai", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
  ok(
    "e a novidade é o gancho",
    wa.enviadas[0].message.includes("ligação por IA"),
    wa.enviadas[0].message,
  );
  delete process.env.REATIVACAO_NOVIDADE;
}

secao("toque 3 (+90d): só para quem está quente ou mais");
{
  toqueVencido(3); // warm
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("warm não recebe o terceiro — cancelado", wa.enviadas.length === 0 && meuToque().status === "cancelled");

  toqueVencido(3, { status: "hot" });
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("hot recebe a despedida", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
  ok("com o endereço", wa.enviadas[0].message.includes("captaclin.com.br"));
}

secao("em 30 dias tudo muda: os cortes na hora do envio");
{
  toqueVencido(1, { status: "lost" });
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("virou opt-out no meio: nada sai, toque cancelado", wa.enviadas.length === 0 && meuToque().status === "cancelled");

  toqueVencido(1, { atencao: "pediu_pessoa" });
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("caiu na vigia no meio: nada sai, toque cancelado", wa.enviadas.length === 0 && meuToque().status === "cancelled");

  toqueVencido(1, { status: "cold" });
  await rodarCicloDeFollowUp(TERCA_14H);
  ok("esfriou (nunca esquentou de verdade): cancelado", wa.enviadas.length === 0 && meuToque().status === "cancelled");
}

secao("as travas de ritmo e a trava mestra");
{
  delete process.env.OUTREACH_ENABLED;
  toqueVencido(1);
  await rodarCicloDeFollowUp(TERCA_14H);
  ok(
    "OUTREACH_ENABLED desligado → a reativação TAMBÉM para (adiada, não morta)",
    wa.enviadas.length === 0 && meuToque().status === "pending",
    meuToque().status,
  );
  process.env.OUTREACH_ENABLED = "true";

  toqueVencido(1);
  await rodarCicloDeFollowUp(DOMINGO_14H);
  ok(
    "domingo → adiada, segue pendente para a janela abrir",
    wa.enviadas.length === 0 && meuToque().status === "pending",
    meuToque().status,
  );

  // Limite diário: 10 já saíram hoje, a 11ª espera amanhã.
  toqueVencido(1);
  for (let i = 0; i < LIMITE_REATIVACOES_POR_DIA; i++) {
    state.followUps.push({
      id: 2000 + i,
      leadId: 1,
      kind: "reativacao",
      status: "sent",
      touchNumber: 1,
      scheduledAt: new Date(TERCA_14H.getTime() - 60 * 60 * 1000),
      sentAt: new Date(TERCA_14H.getTime() - 60 * 60 * 1000),
      messageTemplate: null,
    });
  }
  await rodarCicloDeFollowUp(TERCA_14H);
  ok(
    "limite de 10 por dia: a 11ª não sai e segue pendente",
    wa.enviadas.length === 0 && meuToque().status === "pending",
    meuToque().status,
  );

  // Uma por ciclo: dois toques vencidos, sai só um.
  toqueVencido(1);
  state.leads.push({
    id: 2,
    phone: "5585999997777",
    name: "Marina",
    status: "warm",
    atencao: null,
    painPoints: null,
    createdAt: new Date(),
  });
  state.followUps.push({
    id: 901,
    leadId: 2,
    kind: "reativacao",
    status: "pending",
    touchNumber: 1,
    scheduledAt: new Date(TERCA_14H.getTime() - 1000),
    messageTemplate: null,
  });
  await rodarCicloDeFollowUp(TERCA_14H);
  ok(
    "reativação em bloco não existe: uma por ciclo, a outra espera",
    wa.enviadas.length === 1,
    JSON.stringify(wa.enviadas),
  );
}

delete process.env.OUTREACH_ENABLED;

fim();
