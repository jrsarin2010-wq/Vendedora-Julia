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
  periodoDoDia,
  contarEnvios,
  sortearIntervalo,
  atrasoDaLargada,
  LARGADA_MAXIMA_MINUTOS,
  EXPLICACAO_BLOQUEIO,
  type ConfigOutreach,
} from "../src/lib/outreach";
import { rodarCicloDeAbordagem } from "../src/lib/outreach-scheduler";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";
import { abordagemNoPainel } from "./painel";

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

// Rodada 55 — a abordagem abre pela saudação do horário, e é este corte que
// decide qual delas. As fronteiras são as da fala comum, não as da janela de
// disparo: meio-dia já é tarde, e 18h já é noite, mesmo com o expediente
// contando aquela hora como dia.
secao("período do dia — o que decide entre bom dia, boa tarde e boa noite");
ok("9h é manhã", periodoDoDia(9) === "manha");
ok("11h ainda é manhã", periodoDoDia(11) === "manha");
ok("meio-dia já é tarde", periodoDoDia(12) === "tarde");
ok("17h ainda é tarde", periodoDoDia(17) === "tarde");
ok("18h já é noite, mesmo dentro da janela de disparo", periodoDoDia(18) === "noite");
ok("23h é noite", periodoDoDia(23) === "noite");
ok("meia-noite é noite", periodoDoDia(0) === "noite");
ok("3h da madrugada é noite, não manhã", periodoDoDia(3) === "noite");
ok("5h já é manhã", periodoDoDia(5) === "manha");
ok(
  "e ele lê a hora do fuso da clínica, não a do servidor",
  periodoDoDia(momentoEmSaoPaulo(new Date("2026-08-11T23:00:00.000Z")).hora) === "noite",
);

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

// ---------------------------------------------------------------------------
// O RITMO PADRÃO (19/08/2026) — decisão do dono: de 40/8/180 para 15/2/1200.
//
// Estes números vivem em variável de ambiente e mudam no Railway sem deploy, o
// que torna tentador deixar o default do código como estava. Não pode: o
// default é o que vale no ambiente que sobe sem as variáveis, e "o código diz
// 40" é a mentira que reaparece no dia em que alguém criar um serviço novo.
// ---------------------------------------------------------------------------
secao("o ritmo padrão do código é o que foi decidido, não o antigo");
{
  for (const chave of [
    "OUTREACH_PER_HOUR",
    "OUTREACH_PER_DAY",
    "OUTREACH_MIN_GAP_SECONDS",
  ]) {
    delete process.env[chave];
  }
  const padrao = lerConfig();
  ok("15 por dia (era 40)", padrao.porDia === 15, String(padrao.porDia));
  ok("2 por hora (era 8)", padrao.porHora === 2, String(padrao.porHora));
  ok(
    "1200s de intervalo mínimo (era 180) — sorteado, vira 20 a 40 minutos",
    padrao.intervaloMinimoSegundos === 1200,
    String(padrao.intervaloMinimoSegundos),
  );
  ok(
    "o intervalo é grande o bastante para as 15 do dia caberem nas 9h da janela sem rajada",
    (padrao.intervaloMinimoSegundos * 1.5 * padrao.porDia) / 3600 <= 9,
    String((padrao.intervaloMinimoSegundos * 1.5 * padrao.porDia) / 3600),
  );
  // A variável continua mandando — é ela que permite corrigir sem deploy.
  process.env.OUTREACH_PER_DAY = "7";
  ok("e a env continua tendo a palavra final", lerConfig().porDia === 7);
  delete process.env.OUTREACH_PER_DAY;
}

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
  "17h59 SP ainda passa",
  estado({ agora: new Date("2026-08-11T20:59:00.000Z") }).pode,
);

// ---------------------------------------------------------------------------
// A LARGADA DO DIA (19/08/2026).
//
// Até aqui, 09h SP em ponto passava — e passava TODO dia útil, porque à
// meia-noite o contador zera e o último envio já tem quinze horas, então o
// intervalo mínimo também já venceu. O resultado era a primeira mensagem
// saindo entre 09:00 e 09:01 todo santo dia. Número que começa a trabalhar no
// mesmo minuto todos os dias não é operado por gente.
// ---------------------------------------------------------------------------
secao("largada do dia — a janela abre 9h, mas o primeiro envio é sorteado");
{
  const NOVE_EM_PONTO = new Date("2026-08-11T12:00:00.000Z");
  const atraso = atrasoDaLargada("2026-08-11");

  ok(
    "o atraso de hoje cabe na faixa (0 a 45 minutos)",
    atraso >= 0 && atraso <= LARGADA_MAXIMA_MINUTOS,
    String(atraso),
  );
  ok(
    "9h em ponto NÃO passa mais — a menos que o sorteio de hoje tenha dado zero",
    atraso === 0
      ? estado({ agora: NOVE_EM_PONTO }).pode
      : estado({ agora: NOVE_EM_PONTO }).motivo === "largada_do_dia",
    `${atraso} — ${JSON.stringify(estado({ agora: NOVE_EM_PONTO }))}`,
  );
  ok(
    "passada a largada, libera",
    estado({
      agora: new Date(NOVE_EM_PONTO.getTime() + (atraso + 1) * 60 * 1000),
    }).pode,
  );
  ok(
    "e um minuto antes dela, ainda não",
    atraso === 0 ||
      estado({
        agora: new Date(NOVE_EM_PONTO.getTime() + (atraso - 1) * 60 * 1000),
      }).motivo === "largada_do_dia",
  );

  // O ponto inteiro da função: ESTÁVEL dentro do dia, DIFERENTE entre dias.
  // Se variasse dentro do dia, o ciclo de 60 segundos acharia um sorteio baixo
  // em poucos minutos e a mensagem sairia às 9h de qualquer jeito.
  ok(
    "o sorteio não muda dentro do mesmo dia",
    atrasoDaLargada("2026-08-11") === atraso &&
      atrasoDaLargada("2026-08-11") === atraso,
  );
  const trintaDias = Array.from({ length: 30 }, (_, i) =>
    atrasoDaLargada(`2026-09-${String(i + 1).padStart(2, "0")}`),
  );
  ok(
    "mas muda de um dia para o outro — em 30 dias, pelo menos 10 largadas diferentes",
    new Set(trintaDias).size >= 10,
    trintaDias.join(","),
  );
  ok(
    "nenhuma delas estoura a faixa",
    trintaDias.every((m) => m >= 0 && m <= LARGADA_MAXIMA_MINUTOS),
    trintaDias.join(","),
  );

  // Fora da primeira hora ela não tem o que fazer — 14h passa como sempre.
  ok("às 14h a largada já passou faz tempo", estado().pode);

  // E ela vem DEPOIS da janela: 8h da manhã continua sendo "fora da janela",
  // que é a frase que o dono precisa ler, não "a largada ainda não saiu".
  ok(
    "8h SP continua dizendo fora_da_janela, não largada_do_dia",
    estado({ agora: new Date("2026-08-11T11:00:00.000Z") }).motivo === "fora_da_janela",
  );
  ok(
    "e o painel tem o que dizer sobre ela",
    EXPLICACAO_BLOQUEIO.largada_do_dia.includes("assinatura de robô"),
  );
}

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
ok(
  "número que rejeitou 3 envios não volta — e com motivo próprio, para o painel mandar conferir o telefone",
  leadElegivel({ status: "cold", outreachStatus: "nao_entregavel", phone: "x" }).motivo === "nao_entregavel",
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
  // Etapa 4: a trava virou híbrida. O `state.reset()` acabou de apagar a chave
  // do painel, e chave ausente é DESLIGADA — sem esta linha, todo cenário
  // abaixo pararia pelo motivo errado e os testes de ritmo não provariam nada.
  abordagemNoPainel(true);
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

secao("ciclo completo — toques e reativações CONTAM na cota (Rodada 51)");
// 8 toques de abordagem saíram na última hora, nenhuma abertura. Antes da
// Rodada 51 a abertura sairia assim mesmo (a contagem só via aberturas);
// agora o balde é um só.
filaCom([{ name: "Carlos" }]);
for (let i = 0; i < 8; i++) {
  state.followUps.push({
    id: state.nextId++,
    leadId: 900 + i,
    kind: "abordagem",
    status: "sent",
    touchNumber: 1,
    scheduledAt: new Date(TERCA_14H.getTime() - 60 * 60 * 1000),
    sentAt: new Date(TERCA_14H.getTime() - 10 * 60 * 1000),
  });
}
r = await rodarCicloDeAbordagem(TERCA_14H);
ok("bloqueado pelo limite da hora", r.enviou === false && r.motivo === "limite_hora", JSON.stringify(r));
ok("nada saiu", wa.enviadas.length === 0);

secao("ciclo completo — o intervalo mínimo vale depois de QUALQUER mensagem fria");
filaCom([{ name: "Carlos" }]);
// Uma reativação (do outro agendador) saiu 30 segundos atrás. O sorteio do
// intervalo nunca fica abaixo do mínimo (180s), então 30s bloqueia sempre.
state.followUps.push({
  id: state.nextId++,
  leadId: 901,
  kind: "reativacao",
  status: "sent",
  touchNumber: 1,
  scheduledAt: new Date(TERCA_14H.getTime() - 60 * 60 * 1000),
  sentAt: new Date(TERCA_14H.getTime() - 30 * 1000),
});
r = await rodarCicloDeAbordagem(TERCA_14H);
ok(
  "abertura espera o intervalo desde o toque do outro agendador",
  r.enviou === false && r.motivo === "intervalo_minimo",
  JSON.stringify(r),
);

secao("ciclo completo — número rejeitado 3 vezes sai da fila e DESTRAVA os outros");
{
  // O buraco que a Rodada 51 fecha: o mais antigo da fila com número morto era
  // escolhido de novo a cada ciclo, para sempre — e a Marina, atrás dele,
  // nunca recebia nada.
  filaCom([
    { name: "Carlos", phone: "5585999990111" },
    { name: "Marina", phone: "5585999990222" },
  ]);
  wa.entrega = false;
  wa.falhaPermanente = true;

  r = await rodarCicloDeAbordagem(TERCA_14H);
  ok("1ª rejeição: reporta não entregue", r.motivo === "nao_entregue", JSON.stringify(r));
  ok("e anota a falha no lead", state.leads[0].falhasDeEnvio === 1, String(state.leads[0].falhasDeEnvio));
  ok("continua pending (ainda vai tentar)", state.leads[0].outreachStatus === "pending");

  r = await rodarCicloDeAbordagem(TERCA_14H);
  ok("2ª rejeição: ainda pending", state.leads[0].outreachStatus === "pending" && state.leads[0].falhasDeEnvio === 2);
  ok("sem alerta até aqui", wa.naoEntregaveis.length === 0);

  r = await rodarCicloDeAbordagem(TERCA_14H);
  ok("3ª rejeição: desiste", r.motivo === "nao_entregavel", JSON.stringify(r));
  ok("o lead sai da fila", state.leads[0].outreachStatus === "nao_entregavel", state.leads[0].outreachStatus);
  ok("o Telegram foi avisado uma vez", wa.naoEntregaveis.length === 1, JSON.stringify(wa.naoEntregaveis));
  ok("nada entrou no histórico", state.messages.length === 0);

  // A fila anda: com a Evolution de volta, o próximo ciclo alcança a Marina.
  wa.entrega = true;
  wa.falhaPermanente = false;
  r = await rodarCicloDeAbordagem(TERCA_14H);
  ok("o ciclo seguinte envia para o PRÓXIMO da fila", r.enviou === true && r.leadId === state.leads[1].id, JSON.stringify(r));
  ok("para o número da Marina", wa.enviadas[wa.enviadas.length - 1].phone === "5585999990222");
}

secao("ciclo completo — Evolution fora do ar NÃO condena o lead");
{
  // Falha transitória (timeout, 5xx): pode se repetir cem vezes que o lead
  // não perde nada — quando a Evolution voltar, ele ainda é o primeiro.
  filaCom([{ name: "Carlos" }]);
  wa.entrega = false;
  wa.falhaPermanente = false;
  for (let i = 0; i < 4; i++) {
    r = await rodarCicloDeAbordagem(TERCA_14H);
  }
  ok("4 quedas depois, segue pending", state.leads[0].outreachStatus === "pending");
  ok("sem contar falha nenhuma", !state.leads[0].falhasDeEnvio, String(state.leads[0].falhasDeEnvio));
  ok("sem alerta de número morto", wa.naoEntregaveis.length === 0);
  wa.entrega = true;
  r = await rodarCicloDeAbordagem(TERCA_14H);
  ok("Evolution voltou: o mesmo lead recebe", r.enviou === true && r.leadId === state.leads[0].id, JSON.stringify(r));
}

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
