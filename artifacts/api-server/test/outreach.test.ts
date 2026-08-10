/**
 * Rodada 23.3/23.4 — prospecção ativa: as travas que protegem o número.
 *
 * O que está sendo testado aqui não é "a feature funciona". É o contrário:
 * que ela NÃO dispara fora das condições combinadas. Um erro aqui não gera
 * um bug — gera o número do Dr. Sarinho banido, levando junto todo o
 * histórico de conversa com os dentistas.
 */
import { ok, secao, fim } from "./assert";
import {
  lerConfig,
  podeDispararAgora,
  leadElegivel,
  momentoEmSaoPaulo,
  contarEnvios,
  sortearIntervalo,
  type ConfigOutreach,
} from "../src/lib/outreach";
import { rodarCicloDeAbordagem } from "../src/lib/outreach-scheduler";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";

/** Configuração base: tudo liberado, para cada teste travar UMA coisa. */
const baseConfig: ConfigOutreach = {
  habilitado: true,
  porHora: 8,
  porDia: 40,
  horaInicio: 9,
  horaFim: 18,
  soDiasUteis: true,
  intervaloMinimoSegundos: 180,
};

/** Uma terça-feira, 14h em São Paulo (17h UTC). Horário sempre válido. */
const TERCA_14H = new Date("2026-08-11T17:00:00.000Z");

const estado = (over: Partial<Parameters<typeof podeDispararAgora>[0]> = {}) =>
  podeDispararAgora({
    config: baseConfig,
    agora: TERCA_14H,
    enviadosNaUltimaHora: 0,
    enviadosHoje: 0,
    ultimoEnvio: null,
    intervaloExigidoSegundos: 180,
    ...over,
  });

secao("fuso de São Paulo (o servidor roda em UTC)");
const m = momentoEmSaoPaulo(TERCA_14H);
ok("17h UTC = 14h em SP", m.hora === 14, JSON.stringify(m));
ok("dia correto", m.dia === "2026-08-11", m.dia);
ok("terça é dia útil", m.diaUtil);
ok(
  "sábado é reconhecido",
  momentoEmSaoPaulo(new Date("2026-08-15T17:00:00.000Z")).diaUtil === false,
);
ok(
  "domingo é reconhecido",
  momentoEmSaoPaulo(new Date("2026-08-16T17:00:00.000Z")).diaUtil === false,
);
// 2h UTC de terça = 23h de segunda em SP. Sem o fuso, a janela cairia errado.
const viraDia = momentoEmSaoPaulo(new Date("2026-08-11T02:00:00.000Z"));
ok("02h UTC = 23h do dia anterior em SP", viraDia.hora === 23 && viraDia.dia === "2026-08-10", JSON.stringify(viraDia));

secao("TRAVA MESTRA — nada dispara com OUTREACH_ENABLED desligado");
ok(
  "config.habilitado=false bloqueia",
  estado({ config: { ...baseConfig, habilitado: false } }).motivo === "desligado",
);
for (const valor of [undefined, "", "false", "FALSE", "0", "1", "sim", "yes", "TRUE "]) {
  if (valor === undefined) delete process.env.OUTREACH_ENABLED;
  else process.env.OUTREACH_ENABLED = valor;
  const c = lerConfig();
  const esperado = valor?.trim().toLowerCase() === "true";
  ok(
    `OUTREACH_ENABLED=${JSON.stringify(valor)} → ${esperado ? "ligado" : "DESLIGADO"}`,
    c.habilitado === esperado,
  );
}
process.env.OUTREACH_ENABLED = "true";
ok('só o texto exato "true" liga', lerConfig().habilitado === true);
delete process.env.OUTREACH_ENABLED;
ok("sem a variável, começa desligado", lerConfig().habilitado === false);

secao("janela de horário");
ok("14h passa", estado().pode);
for (const [horaUTC, rotulo] of [
  ["2026-08-11T11:00:00.000Z", "08h SP (antes de abrir)"],
  ["2026-08-11T21:00:00.000Z", "18h SP (hora de fechar)"],
  ["2026-08-11T23:00:00.000Z", "20h SP (noite)"],
  ["2026-08-11T05:00:00.000Z", "02h SP (madrugada)"],
] as const) {
  ok(`${rotulo} → bloqueado`, estado({ agora: new Date(horaUTC) }).motivo === "fora_da_janela");
}
ok(
  "09h SP (abertura) passa",
  estado({ agora: new Date("2026-08-11T12:00:00.000Z") }).pode,
);
ok(
  "17h59 SP ainda passa",
  estado({ agora: new Date("2026-08-11T20:59:00.000Z") }).pode,
);

secao("fim de semana");
ok(
  "sábado 14h → bloqueado",
  estado({ agora: new Date("2026-08-15T17:00:00.000Z") }).motivo === "fim_de_semana",
);
ok(
  "domingo 14h → bloqueado",
  estado({ agora: new Date("2026-08-16T17:00:00.000Z") }).motivo === "fim_de_semana",
);
ok(
  "com soDiasUteis=false, sábado passa",
  estado({
    agora: new Date("2026-08-15T17:00:00.000Z"),
    config: { ...baseConfig, soDiasUteis: false },
  }).pode,
);

secao("limite por hora");
ok("7 de 8 na última hora ainda passa", estado({ enviadosNaUltimaHora: 7 }).pode);
ok("8 de 8 bloqueia", estado({ enviadosNaUltimaHora: 8 }).motivo === "limite_hora");
ok("9 bloqueia", estado({ enviadosNaUltimaHora: 9 }).motivo === "limite_hora");

secao("limite por dia");
ok("39 de 40 ainda passa", estado({ enviadosHoje: 39 }).pode);
ok("40 de 40 bloqueia", estado({ enviadosHoje: 40 }).motivo === "limite_dia");
ok("41 bloqueia", estado({ enviadosHoje: 41 }).motivo === "limite_dia");

secao("intervalo mínimo entre mensagens");
ok(
  "1 minuto depois da última → bloqueado",
  estado({ ultimoEnvio: new Date(TERCA_14H.getTime() - 60_000) }).motivo === "intervalo_minimo",
);
ok(
  "179s depois → ainda bloqueado",
  estado({ ultimoEnvio: new Date(TERCA_14H.getTime() - 179_000) }).motivo === "intervalo_minimo",
);
ok(
  "181s depois → passa",
  estado({ ultimoEnvio: new Date(TERCA_14H.getTime() - 181_000) }).pode,
);

secao("intervalo é ALEATÓRIO (cadência exata é assinatura de robô)");
const sorteios = Array.from({ length: 200 }, () => sortearIntervalo(180));
ok("nunca abaixo do mínimo", sorteios.every((s) => s >= 180));
ok("nunca acima do dobro", sorteios.every((s) => s <= 360));
ok("varia de verdade", new Set(sorteios.map((s) => Math.round(s))).size > 50);

secao("elegibilidade do lead");
ok(
  "pending + cold → pode",
  leadElegivel({ status: "cold", outreachStatus: "pending", phone: "5585999998888" }).elegivel,
);
ok(
  'status "lost" NUNCA é prospectado',
  leadElegivel({ status: "lost", outreachStatus: "pending", phone: "x" }).motivo === "opt_out",
);
ok(
  'status "closed" (já cliente) não é prospectado',
  leadElegivel({ status: "closed", outreachStatus: "pending", phone: "x" }).motivo === "ja_cliente",
);
ok(
  "quem já recebeu não recebe de novo",
  leadElegivel({ status: "cold", outreachStatus: "sent", phone: "x" }).motivo === "ja_abordado",
);
ok(
  'lead que chegou pelo WhatsApp (outreachStatus "none") não é abordado',
  leadElegivel({ status: "warm", outreachStatus: "none", phone: "x" }).motivo === "nao_e_de_prospeccao",
);

secao("contagem de envios usa o dia de São Paulo");
const envios = [
  new Date("2026-08-11T16:30:00.000Z"), // 13h30 SP, hoje, última hora
  new Date("2026-08-11T13:00:00.000Z"), // 10h SP, hoje, fora da última hora
  new Date("2026-08-10T20:00:00.000Z"), // ontem em SP
];
const contagem = contarEnvios(envios, TERCA_14H);
ok("1 na última hora", contagem.naUltimaHora === 1, JSON.stringify(contagem));
ok("2 hoje", contagem.hoje === 2, JSON.stringify(contagem));
ok("último é o mais recente", contagem.ultimo?.toISOString() === "2026-08-11T16:30:00.000Z");
ok("sem envios, último é null", contarEnvios([], TERCA_14H).ultimo === null);

// ---------------------------------------------------------------------------
// Ciclo completo, com banco e WhatsApp stubados.
// ---------------------------------------------------------------------------

function filaCom(leads: Record<string, unknown>[]) {
  state.reset();
  wa.reset();
  for (const l of leads) {
    state.leads.push({
      id: state.nextId++,
      phone: `558599990${String(state.nextId).padStart(3, "0")}`,
      status: "cold",
      outreachStatus: "pending",
      origin: "import",
      name: null,
      clinicName: null,
      city: null,
      instagram: null,
      createdAt: new Date(),
      ...l,
    });
  }
}

ctrl.reply = "Oi, Dr. Carlos! Vi a Clínica Sorriso aqui 😊 Posso te fazer uma pergunta?";

secao("ciclo completo — desligado não toca em nada");
delete process.env.OUTREACH_ENABLED;
filaCom([{ name: "Carlos", clinicName: "Clínica Sorriso" }]);
let r = await rodarCicloDeAbordagem(TERCA_14H);
ok("não enviou", r.enviou === false && r.motivo === "desligado", JSON.stringify(r));
ok("nada saiu no WhatsApp", wa.enviadas.length === 0);
ok("nem chamou o modelo", ctrl.calls.length === 0);
ok("lead continua pending", state.leads[0].outreachStatus === "pending");

secao("ciclo completo — ligado, envia UMA e marca sent");
process.env.OUTREACH_ENABLED = "true";
filaCom([{ name: "Carlos", clinicName: "Clínica Sorriso" }]);
r = await rodarCicloDeAbordagem(TERCA_14H);
ok("enviou", r.enviou === true, JSON.stringify(r));
ok("uma mensagem no WhatsApp", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
ok("gravou no histórico como outbound", state.messages.length === 1 && state.messages[0].direction === "outbound");
ok("outreachStatus virou sent", state.leads[0].outreachStatus === "sent");
ok("marcou outreachSentAt", state.leads[0].outreachSentAt instanceof Date);
ok("entra no fluxo normal (funnelStage contacted)", state.leads[0].funnelStage === "contacted");

secao("ciclo completo — envio falhou: não grava e não sai da fila");
filaCom([{ name: "Carlos" }]);
wa.entrega = false;
r = await rodarCicloDeAbordagem(TERCA_14H);
ok("reporta não entregue", r.enviou === false && r.motivo === "nao_entregue", JSON.stringify(r));
ok("NÃO gravou no histórico", state.messages.length === 0);
ok("lead continua pending para tentar de novo", state.leads[0].outreachStatus === "pending");
ok("NÃO marcou outreachSentAt", state.leads[0].outreachSentAt === undefined);
wa.entrega = true;

secao("ciclo completo — lead lost nunca recebe");
filaCom([{ name: "Carlos", status: "lost" }]);
r = await rodarCicloDeAbordagem(TERCA_14H);
ok("não enviou", r.enviou === false, JSON.stringify(r));
ok("nada saiu no WhatsApp", wa.enviadas.length === 0);
ok("saiu da fila como skipped", state.leads[0].outreachStatus === "skipped");
ok("status lost intocado", state.leads[0].status === "lost");

secao("ciclo completo — fora da janela não sai");
filaCom([{ name: "Carlos" }]);
r = await rodarCicloDeAbordagem(new Date("2026-08-11T23:00:00.000Z")); // 20h SP
ok("bloqueado por horário", r.enviou === false && r.motivo === "fora_da_janela", JSON.stringify(r));
ok("nada saiu", wa.enviadas.length === 0);

filaCom([{ name: "Carlos" }]);
r = await rodarCicloDeAbordagem(new Date("2026-08-15T17:00:00.000Z")); // sábado
ok("bloqueado no fim de semana", r.enviou === false && r.motivo === "fim_de_semana", JSON.stringify(r));
ok("nada saiu", wa.enviadas.length === 0);

secao("ciclo completo — limite diário respeitado com dados reais");
filaCom([{ name: "Carlos" }]);
// 40 leads já abordados hoje.
for (let i = 0; i < 40; i++) {
  state.leads.push({
    id: state.nextId++,
    phone: `55859998${String(i).padStart(4, "0")}`,
    status: "cold",
    outreachStatus: "sent",
    outreachSentAt: new Date("2026-08-11T12:30:00.000Z"), // 09h30 SP, hoje
  });
}
r = await rodarCicloDeAbordagem(TERCA_14H);
ok("bloqueado pelo limite do dia", r.enviou === false && r.motivo === "limite_dia", JSON.stringify(r));
ok("nada saiu", wa.enviadas.length === 0);

secao("ciclo completo — limite horário respeitado com dados reais");
filaCom([{ name: "Carlos" }]);
for (let i = 0; i < 8; i++) {
  state.leads.push({
    id: state.nextId++,
    phone: `55859997${String(i).padStart(4, "0")}`,
    status: "cold",
    outreachStatus: "sent",
    outreachSentAt: new Date(TERCA_14H.getTime() - 10 * 60 * 1000), // 10 min atrás
  });
}
r = await rodarCicloDeAbordagem(TERCA_14H);
ok("bloqueado pelo limite da hora", r.enviou === false && r.motivo === "limite_hora", JSON.stringify(r));
ok("nada saiu", wa.enviadas.length === 0);

secao("ciclo completo — modelo devolveu vazio: lead segue na fila");
ctrl.reply = "";
filaCom([{ name: "Carlos" }]);
r = await rodarCicloDeAbordagem(TERCA_14H);
ok("reporta mensagem vazia", r.enviou === false && r.motivo === "mensagem_vazia", JSON.stringify(r));
ok("nada saiu", wa.enviadas.length === 0);
ok("lead continua pending", state.leads[0].outreachStatus === "pending");
ctrl.reply = "Oi! Posso te fazer uma pergunta?";

delete process.env.OUTREACH_ENABLED;
fim();
