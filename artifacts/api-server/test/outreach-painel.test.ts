/**
 * Etapa 4 — o interruptor da abordagem no Painel.
 *
 * O que este arquivo protege, em ordem de prejuízo:
 *
 *   1. O PRINCÍPIO: com o botão desligado, quem já está conversando CONTINUA
 *      sendo respondido. Falhar aqui deixa dentista falando sozinho depois de
 *      a Júlia ter puxado assunto — pior do que nunca tê-lo abordado, e sem
 *      sintoma nenhum no log.
 *   2. A TRAVA HÍBRIDA. Duas chaves, e o agendador exige as duas. Falhar
 *      aberto aqui é mensagem fria saindo depois de alguém ter clicado em
 *      "pausar" no susto.
 *   3. O que o botão governa ALÉM da primeira mensagem: os toques de quem
 *      nunca respondeu e a reativação. Desligar a abertura e continuar
 *      mandando o toque 2 seria desligar pela metade.
 *
 * As asserções de "não fez" valem mais que as de "fez": o que roda todo mundo
 * percebe na hora.
 */
import { ok, secao, fim } from "./assert";
import { handlerDe, chamarRota } from "./rota";
import { chamar, evento } from "./driver";
import outreachRouter, { montarStatusDaAbordagem } from "../src/routes/outreach";
import prospectsRouter from "../src/routes/prospects";
import roteadorPrincipal from "../src/routes/index";
import { requireAuth } from "../src/lib/auth";
import { rodarCicloDeAbordagem } from "../src/lib/outreach-scheduler";
import { rodarCicloDeFollowUp } from "../src/lib/follow-up-scheduler";
import { CHAVE_OUTREACH_ATIVO } from "../src/lib/configuracoes";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";
import { abordagemNoPainel } from "./painel";

// A rota de prévia é a [0] deste router desde a Rodada 23; as duas da Etapa 4
// entraram depois, nesta ordem.
const statusHandler = handlerDe(outreachRouter, 1);
const ativoHandler = handlerDe(outreachRouter, 2);
const resumoHandler = handlerDe(prospectsRouter, 0);

/** Terça-feira, 14h em São Paulo: dentro da janela. */
const TERCA_14H = new Date("2026-08-11T17:00:00.000Z");
/** Terça, 20h em São Paulo: fora dela. */
const TERCA_20H = new Date("2026-08-11T23:00:00.000Z");
/** Sábado, 14h em São Paulo. */
const SABADO_14H = new Date("2026-08-15T17:00:00.000Z");

const NUMERO = "5585999997777";

interface Status {
  ativo: boolean;
  interruptorGeral: boolean;
  dentroDaJanela: boolean;
  janela: { inicio: number; fim: number };
  naFila: number;
  abordadosNas24h: number;
  aguardandoResposta: number;
  proximoEnvioEm: number | null;
}

function limpar() {
  state.reset();
  wa.reset();
  ctrl.reset();
  ctrl.reply = "Oi, Dra. Marina! Aqui é a Júlia, do CaptaClin. Posso te fazer uma pergunta?";
  wa.entrega = true;
  wa.falhaPermanente = false;
  process.env.OUTREACH_ENABLED = "true";
}

/** Um lead esperando a primeira mensagem. */
function naFila(extra: Record<string, unknown> = {}) {
  const linha = {
    id: state.nextId++,
    phone: NUMERO,
    name: "Marina",
    clinicName: "Odonto Vida",
    city: null,
    instagram: null,
    origin: "import",
    status: "cold",
    funnelStage: "new",
    outreachStatus: "pending",
    createdAt: new Date(),
    ...extra,
  };
  state.leads.push(linha);
  return linha;
}

/** Um lead já abordado, com um toque FRIO vencido esperando. */
function comToqueVencido(kind: "abordagem" | "reativacao") {
  const lead = {
    id: state.nextId++,
    phone: NUMERO,
    name: "Marina",
    status: kind === "reativacao" ? "warm" : "cold",
    funnelStage: "contacted",
    outreachStatus: "sent",
    atencao: null,
    painPoints: "paciente some no fim de semana",
    createdAt: new Date(),
  };
  state.leads.push(lead);
  state.followUps.push({
    id: state.nextId++,
    leadId: lead.id,
    kind,
    status: "pending",
    touchNumber: 1,
    scheduledAt: new Date(TERCA_14H.getTime() - 1000),
    messageTemplate: kind === "abordagem" ? "toque de abordagem" : null,
  });
  return lead;
}

const pendentes = () => state.followUps.filter((f: any) => f.status === "pending");

// ---------------------------------------------------------------------------
secao("A TRAVA HÍBRIDA — o agendador exige as DUAS chaves");

limpar();
process.env.OUTREACH_ENABLED = "false";
abordagemNoPainel(true);
naFila();
let r = await rodarCicloDeAbordagem(TERCA_14H);
ok("env off + banco on → NÃO aborda", r.enviou === false && r.motivo === "desligado", JSON.stringify(r));
ok("nada saiu", wa.enviadas.length === 0);
ok("nem chamou o modelo", ctrl.calls.length === 0);
ok("o lead segue na fila", state.leads[0].outreachStatus === "pending");

limpar();
abordagemNoPainel(false);
naFila();
r = await rodarCicloDeAbordagem(TERCA_14H);
ok(
  "env on + banco off → NÃO aborda",
  r.enviou === false && r.motivo === "desligado_no_painel",
  JSON.stringify(r),
);
ok("nada saiu", wa.enviadas.length === 0);
ok("nem chamou o modelo", ctrl.calls.length === 0);
ok("o lead segue na fila — pausar não destrói a fila", state.leads[0].outreachStatus === "pending");

limpar();
naFila();
r = await rodarCicloDeAbordagem(TERCA_14H);
ok(
  "env on + chave AUSENTE → NÃO aborda (ausente é desligada)",
  r.enviou === false && r.motivo === "desligado_no_painel",
  JSON.stringify(r),
);

limpar();
abordagemNoPainel(true);
naFila();
r = await rodarCicloDeAbordagem(TERCA_14H);
ok("as duas ligadas → aborda", r.enviou === true, JSON.stringify(r));
ok("uma mensagem saiu", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));

secao("a chave só liga com o texto exato 'true' — como a env");
for (const valor of ["true", "false", "1", "sim", "TRUE", ""]) {
  limpar();
  state.configuracoes.push({ chave: CHAVE_OUTREACH_ATIVO, valor });
  naFila();
  r = await rodarCicloDeAbordagem(TERCA_14H);
  ok(
    `outreach_ativo=${JSON.stringify(valor)} → ${valor === "true" ? "aborda" : "NÃO aborda"}`,
    r.enviou === (valor === "true"),
    JSON.stringify(r),
  );
}

// ---------------------------------------------------------------------------
secao("O PRINCÍPIO — com o botão desligado, quem já conversa continua sendo respondido");
{
  limpar();
  abordagemNoPainel(false);
  // Um dentista que a Júlia abordou e que agora respondeu. É o caso exato do
  // "desliguei no susto": a abordagem dele já saiu, e ele está falando.
  state.leads.push({
    id: state.nextId++,
    phone: NUMERO,
    name: "Marina",
    status: "cold",
    funnelStage: "contacted",
    outreachStatus: "sent",
    outreachSentAt: new Date(TERCA_14H.getTime() - 60 * 60 * 1000),
    createdAt: new Date(),
  });
  ctrl.reply = "Claro! O CaptaClin responde o WhatsApp da clínica sozinho 😊";

  await chamar(evento("Oi, como funciona?", NUMERO));

  ok(
    "a Júlia RESPONDEU — o botão não governa conversa em andamento",
    wa.enviadas.length > 0,
    JSON.stringify(wa.enviadas),
  );
  ok(
    "e a resposta é a do modelo, não um aviso de sistema",
    wa.enviadas.some((e: any) => String(e.message).includes("CaptaClin")),
    JSON.stringify(wa.enviadas),
  );
  ok("a mensagem dele entrou no histórico", state.messages.some((m: any) => m.direction === "inbound"));
}

secao("o mesmo vale para quem chega do NADA com o botão desligado");
{
  // Dentista que viu a landing e escreveu por conta própria. Ele nunca foi
  // abordado — e ainda assim não pode receber silêncio: quem escreveu primeiro
  // não é abordagem nenhuma.
  limpar();
  abordagemNoPainel(false);
  ctrl.reply = "Oi! Aqui é a Júlia, do CaptaClin 😊";
  await chamar(evento("Vi o site de vocês, quanto custa?", "5511988887777"));
  ok("respondeu", wa.enviadas.length > 0, JSON.stringify(wa.enviadas));
  ok("e criou o lead normalmente", state.leads.length === 1, JSON.stringify(state.leads));
}

secao("follow-up de CONVERSA sai com o botão desligado");
{
  // Quem respondeu pediu o contato. A cadência de conversa dele não é
  // abordagem, e nunca passou pela trava — este teste é o que garante que a
  // Etapa 4 não a arrastou junto por engano.
  limpar();
  abordagemNoPainel(false);
  const lead = {
    id: state.nextId++,
    phone: NUMERO,
    name: "Marina",
    status: "warm",
    funnelStage: "interested",
    atencao: null,
    createdAt: new Date(),
  };
  state.leads.push(lead);
  state.followUps.push({
    id: state.nextId++,
    leadId: lead.id,
    kind: "conversa",
    status: "pending",
    touchNumber: 2,
    scheduledAt: new Date(TERCA_14H.getTime() - 1000),
    messageTemplate: "toque de conversa",
  });

  await rodarCicloDeFollowUp(TERCA_14H);
  ok(
    "o toque de conversa SAIU mesmo com a abordagem pausada",
    wa.enviadas.length === 1,
    JSON.stringify(wa.enviadas),
  );
  ok("e virou 'sent'", state.followUps[0].status === "sent", state.followUps[0].status);
}

// ---------------------------------------------------------------------------
secao("o botão governa os toques FRIOS — e eles ADIAM, não morrem");

limpar();
abordagemNoPainel(false);
comToqueVencido("abordagem");
await rodarCicloDeFollowUp(TERCA_14H);
ok("toque de abordagem NÃO sai", wa.enviadas.length === 0, JSON.stringify(wa.enviadas));
ok("e segue pendente para quando religar", pendentes().length === 1);

abordagemNoPainel(true);
await rodarCicloDeFollowUp(TERCA_14H);
ok("religado, o toque sai", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));

limpar();
abordagemNoPainel(false);
comToqueVencido("reativacao");
await rodarCicloDeFollowUp(TERCA_14H);
ok(
  "reativação NÃO sai — toque frio depois de 30 dias é abordagem, não continuidade",
  wa.enviadas.length === 0,
  JSON.stringify(wa.enviadas),
);
ok("e segue pendente", pendentes().length === 1);

abordagemNoPainel(true);
await rodarCicloDeFollowUp(TERCA_14H);
ok("religada, a reativação sai", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));

// ---------------------------------------------------------------------------
secao("a janela de horário vale mesmo com as duas ligadas");

limpar();
abordagemNoPainel(true);
naFila();
r = await rodarCicloDeAbordagem(TERCA_20H);
ok("20h → não aborda", r.enviou === false && r.motivo === "fora_da_janela", JSON.stringify(r));

limpar();
abordagemNoPainel(true);
naFila();
r = await rodarCicloDeAbordagem(SABADO_14H);
ok("sábado → não aborda", r.enviou === false && r.motivo === "fim_de_semana", JSON.stringify(r));
ok("nada saiu em nenhum dos dois", wa.enviadas.length === 0);

// ---------------------------------------------------------------------------
// O STATUS. Medido com o relógio injetado (`montarStatusDaAbordagem`), e não
// pelo HTTP: tudo aqui é janela de 24h e horário comercial, e amarrar as
// asserções ao relógio da máquina faria o teste passar de dia e falhar à noite.
// O handler HTTP tem o seu próprio teste logo abaixo, de forma.
// ---------------------------------------------------------------------------
secao("status — base vazia, nada inventado");
limpar();
let s = (await montarStatusDaAbordagem(TERCA_14H)) as Status;
ok("ativo = false quando a chave nem existe", s.ativo === false);
ok("interruptorGeral reflete a env", s.interruptorGeral === true);
ok("a janela vem do ambiente (9h–18h por padrão)", s.janela.inicio === 9 && s.janela.fim === 18, JSON.stringify(s.janela));
ok("fila vazia", s.naFila === 0);
ok("ninguém abordado", s.abordadosNas24h === 0);
ok("ninguém aguardando", s.aguardandoResposta === 0);
ok("sem previsão de envio", s.proximoEnvioEm === null);

secao("status — a env desligada aparece na tela em vez de virar botão morto");
limpar();
process.env.OUTREACH_ENABLED = "false";
abordagemNoPainel(true);
naFila();
s = (await montarStatusDaAbordagem(TERCA_14H)) as Status;
ok("ativo = true (o painel diz sim)", s.ativo === true);
ok("interruptorGeral = false (o Railway diz não)", s.interruptorGeral === false);
ok("e sem previsão: com a env off nada sai", s.proximoEnvioEm === null);

secao("status — a abordagem pausada no painel também não promete envio");
limpar();
abordagemNoPainel(false);
naFila();
s = (await montarStatusDaAbordagem(TERCA_14H)) as Status;
ok("tem gente na fila", s.naFila === 1);
ok("mas a previsão é nula — pausada não manda nada", s.proximoEnvioEm === null, String(s.proximoEnvioEm));

secao("status — naFila conta quem o agendador REALMENTE pegaria");
limpar();
abordagemNoPainel(true);
naFila({ phone: "5585911110001" });
naFila({ phone: "5585911110002" });
// Estes três estão "pending" na coluna e não são fila nenhuma.
naFila({ phone: "5585911110003", status: "lost" });
naFila({ phone: "5585911110004", status: "closed" });
naFila({ phone: "5585911110005", outreachStatus: "sent" });
s = (await montarStatusDaAbordagem(TERCA_14H)) as Status;
ok(
  "2 na fila — o opt-out, o cliente e o já abordado ficam de fora",
  s.naFila === 2,
  String(s.naFila),
);

secao("status — abordados em 24h e aguardando resposta");
limpar();
abordagemNoPainel(true);
const horasAtras = (n: number) => new Date(TERCA_14H.getTime() - n * 60 * 60 * 1000);
// Dois abordados dentro da janela deslizante, um fora dela.
state.leads.push({ id: 1, phone: "5585911110001", outreachStatus: "sent", outreachSentAt: horasAtras(2), status: "cold" });
state.leads.push({ id: 2, phone: "5585911110002", outreachStatus: "sent", outreachSentAt: horasAtras(10), status: "cold" });
state.leads.push({ id: 3, phone: "5585911110003", outreachStatus: "sent", outreachSentAt: horasAtras(30), status: "cold" });
// O lead 2 respondeu; os outros dois seguem calados.
state.messages.push({ id: 90, leadId: 2, direction: "inbound", content: "oi" });
state.messages.push({ id: 91, leadId: 1, direction: "outbound", content: "abordagem" });
s = (await montarStatusDaAbordagem(TERCA_14H)) as Status;
ok("2 abordados nas 24h — o de 30h atrás saiu da janela", s.abordadosNas24h === 2, String(s.abordadosNas24h));
ok(
  "2 aguardando resposta — quem respondeu sai da conta, e mensagem NOSSA não vale como resposta dele",
  s.aguardandoResposta === 2,
  `${s.aguardandoResposta} — ${JSON.stringify(state.messages)}`,
);

secao("status — dentroDaJanela segue a mesma conta do agendador");
limpar();
abordagemNoPainel(true);
naFila();
s = (await montarStatusDaAbordagem(TERCA_14H)) as Status;
ok("terça 14h → dentro", s.dentroDaJanela === true);
ok("com fila e nada travando, a previsão é 0 (o próximo ciclo)", s.proximoEnvioEm === 0, String(s.proximoEnvioEm));

s = (await montarStatusDaAbordagem(TERCA_20H)) as Status;
ok("terça 20h → fora", s.dentroDaJanela === false);
ok("e sem previsão: fora da janela nada sai hoje", s.proximoEnvioEm === null, String(s.proximoEnvioEm));

s = (await montarStatusDaAbordagem(SABADO_14H)) as Status;
ok("sábado 14h → fora (dias úteis)", s.dentroDaJanela === false);

secao("status — com o intervalo mínimo correndo, a previsão vem em minutos");
limpar();
abordagemNoPainel(true);
naFila();
// Uma abordagem saiu 60s atrás; o mínimo é 180s, então faltam 2 minutos.
state.leads.push({
  id: state.nextId++,
  phone: "5585911119999",
  outreachStatus: "sent",
  status: "cold",
  outreachSentAt: new Date(TERCA_14H.getTime() - 60 * 1000),
});
s = (await montarStatusDaAbordagem(TERCA_14H)) as Status;
ok("faltam 2 minutos", s.proximoEnvioEm === 2, String(s.proximoEnvioEm));

secao("status — fila vazia não promete envio nenhum");
limpar();
abordagemNoPainel(true);
s = (await montarStatusDaAbordagem(TERCA_14H)) as Status;
ok("ativo, mas sem ninguém: previsão nula", s.ativo === true && s.proximoEnvioEm === null, JSON.stringify(s));

secao("GET /outreach/status — o handler HTTP devolve o mesmo shape");
limpar();
abordagemNoPainel(true);
const resposta = await chamarRota(statusHandler, {});
ok("status 200", resposta.status === 200, JSON.stringify(resposta.body));
ok(
  "com as oito chaves do contrato, e só elas",
  JSON.stringify(Object.keys(resposta.body as object).sort()) ===
    JSON.stringify([
      "abordadosNas24h",
      "aguardandoResposta",
      "ativo",
      "dentroDaJanela",
      "interruptorGeral",
      "janela",
      "naFila",
      "proximoEnvioEm",
    ]),
  JSON.stringify(Object.keys(resposta.body as object).sort()),
);
ok("e lê o botão do banco", (resposta.body as Status).ativo === true);

// ---------------------------------------------------------------------------
secao("POST /outreach/ativo — grava e devolve o status já atualizado");
limpar();
r = await chamarRota(ativoHandler, { body: { ativo: true } });
ok("status 200", r.status === 200, JSON.stringify(r.body));
ok("a resposta já diz ativo", (r.body as Status).ativo === true);
ok("gravou uma linha", state.configuracoes.length === 1, JSON.stringify(state.configuracoes));
ok(
  "com a chave certa",
  state.configuracoes[0].chave === "outreach_ativo" && state.configuracoes[0].valor === "true",
  JSON.stringify(state.configuracoes[0]),
);
ok("e o GET concorda", ((await chamarRota(statusHandler, {})).body as Status).ativo === true);

secao("POST /outreach/ativo — desligar ATUALIZA a linha, não cria outra");
r = await chamarRota(ativoHandler, { body: { ativo: false } });
ok("a resposta diz pausada", (r.body as Status).ativo === false);
ok("continua UMA linha só", state.configuracoes.length === 1, JSON.stringify(state.configuracoes));
ok("com o valor novo", state.configuracoes[0].valor === "false");

secao("POST /outreach/ativo — corpo inválido é recusado, não interpretado");
for (const corpo of [{ ativo: "true" }, { ativo: "false" }, { ativo: 1 }, {}, { ativo: null }, { ativa: true }]) {
  const resp = await chamarRota(ativoHandler, { body: corpo });
  ok(`400 para ${JSON.stringify(corpo)}`, resp.status === 400, JSON.stringify(resp.body));
}
ok("e nada foi alterado", state.configuracoes[0].valor === "false");

secao("o botão do painel e o agendador falam da MESMA chave");
{
  // Um teste que parece bobo e não é: se a rota gravasse uma chave e o
  // agendador lesse outra, os dois testes acima passariam e o botão não faria
  // absolutamente nada em produção.
  limpar();
  naFila();
  await chamarRota(ativoHandler, { body: { ativo: true } });
  const r1 = await rodarCicloDeAbordagem(TERCA_14H);
  ok("clicou em ligar → o agendador aborda", r1.enviou === true, JSON.stringify(r1));

  limpar();
  naFila();
  await chamarRota(ativoHandler, { body: { ativo: true } });
  await chamarRota(ativoHandler, { body: { ativo: false } });
  const r2 = await rodarCicloDeAbordagem(TERCA_14H);
  ok(
    "clicou em pausar → o agendador para",
    r2.enviou === false && r2.motivo === "desligado_no_painel",
    JSON.stringify(r2),
  );
}

// ---------------------------------------------------------------------------
secao("o aviso da Prospecção espelha o estado COMBINADO");
limpar();
abordagemNoPainel(true);
let resumo = (await chamarRota(resumoHandler, {})).body as { juliaLigada: boolean };
ok("as duas ligadas → juliaLigada true", resumo.juliaLigada === true, JSON.stringify(resumo));

abordagemNoPainel(false);
resumo = (await chamarRota(resumoHandler, {})).body as { juliaLigada: boolean };
ok("botão pausado → juliaLigada false, mesmo com a env ligada", resumo.juliaLigada === false);

abordagemNoPainel(true);
process.env.OUTREACH_ENABLED = "false";
resumo = (await chamarRota(resumoHandler, {})).body as { juliaLigada: boolean };
ok("env desligada → juliaLigada false, mesmo com o botão ligado", resumo.juliaLigada === false);
process.env.OUTREACH_ENABLED = "true";

// ---------------------------------------------------------------------------
secao("sem sessão — as rotas do interruptor respondem 401");
{
  let statusRecebido = 0;
  let passou = false;
  const res: any = {
    status(c: number) {
      statusRecebido = c;
      return res;
    },
    json() {
      return res;
    },
  };
  requireAuth({ cookies: {} } as never, res, () => {
    passou = true;
  });
  ok("não deixou passar", passou === false);
  ok("respondeu 401", statusRecebido === 401, String(statusRecebido));

  // E as rotas estão MONTADAS atrás dele. Sem esta segunda parte, o teste acima
  // provaria só que o middleware funciona — não que alguém o usa.
  const camadas = (roteadorPrincipal as unknown as { stack: unknown[] }).stack ?? [];
  const primeiroAuth = camadas.findIndex((l: any) => l.handle === requireAuth);
  ok("o roteador principal monta requireAuth", primeiroAuth >= 0, `camadas=${camadas.length}`);
  const publicas = camadas.slice(0, primeiroAuth);
  const alcancaSemAuth = publicas.some((l: any) =>
    ((l.handle as any)?.stack ?? []).some((s: any) =>
      String(s.route?.path ?? "").startsWith("/outreach"),
    ),
  );
  ok("nenhuma rota /outreach fica antes do requireAuth", !alcancaSemAuth);
}

// ---------------------------------------------------------------------------
// A PRÉVIA QUE FALHA TEM QUE DIZER QUE FALHOU (18/08/2026).
//
// Gerar a prévia falha de dois jeitos, e até aqui só um chegava à tela:
//
//   - a chamada EXPLODE (400, 429, timeout) → o catch enche `erroAoGerar`;
//   - a chamada VOLTA SEM TEXTO → `gerarMensagemDeAbordagem` devolve null, sem
//     exceção nenhuma, e a rota devolvia mensagem nula E erro nulo. O painel,
//     que só sabe mostrar um dos dois, não mostrava nada — indistinguível de
//     "ainda carregando".
//
// Aconteceu de verdade: com o teto de saída em 200 tokens, o modelo de
// raciocínio ora estourava com 400, ora devolvia conteúdo vazio. Metade dos
// relatos vinha com erro na tela, metade com a tela muda, e as duas metades
// eram o MESMO defeito — o que atrasou o diagnóstico.
//
// O agendador já tinha o log da mensagem vazia; a rota não tinha nada. Mesma
// disciplina, um lugar só: quem sabe do vazio é quem gera, e a rota garante
// que a tela nunca fique sem resposta.
// ---------------------------------------------------------------------------
const previaHandler = handlerDe(outreachRouter, 0);

secao("prévia — o modelo devolve VAZIO: a tela recebe um erro, não o silêncio");
{
  limpar();
  const lead = naFila();
  ctrl.reply = "";
  const r = await chamarRota(previaHandler, { params: { id: String(lead.id) } });
  const corpo = r.body as { mensagem: string | null; erroAoGerar: string | null };
  ok("responde 200 (a rota nunca quebra por causa disso)", r.status === 200, String(r.status));
  ok("sem mensagem", corpo.mensagem === null, JSON.stringify(corpo.mensagem));
  ok(
    "MAS com erro preenchido — nunca os dois nulos",
    typeof corpo.erroAoGerar === "string" && corpo.erroAoGerar.length > 0,
    JSON.stringify(corpo.erroAoGerar),
  );
}

secao("prévia — o modelo ESTOURA o teto: mesmo desfecho, e o log é que separa");
{
  limpar();
  const lead = naFila();
  // O par que a OpenAI devolve quando o teto acaba antes do texto: conteúdo
  // vazio E finish_reason "length". É a metade silenciosa da falha.
  ctrl.reply = "";
  ctrl.finishReason = "length";
  const r = await chamarRota(previaHandler, { params: { id: String(lead.id) } });
  const corpo = r.body as { mensagem: string | null; erroAoGerar: string | null };
  ok("sem mensagem", corpo.mensagem === null);
  ok("e a tela recebe erro", !!corpo.erroAoGerar, JSON.stringify(corpo.erroAoGerar));
  ctrl.finishReason = "stop";
}

secao("prévia — a chamada EXPLODE: erro diferente do da resposta vazia");
{
  limpar();
  const lead = naFila();
  ctrl.falhasRestantes = 1;
  // 400 de propósito: `ehRecusaTemporaria` só repica 429/408/5xx, então o erro
  // sobe na primeira tentativa — como subiu o 400 de teto estourado.
  ctrl.falhaStatus = 400;
  ctrl.falhaMensagem = "400 Could not finish the message because max_tokens was reached";
  const r = await chamarRota(previaHandler, { params: { id: String(lead.id) } });
  const corpo = r.body as { mensagem: string | null; erroAoGerar: string | null };
  ok("sem mensagem", corpo.mensagem === null);
  ok("com erro", !!corpo.erroAoGerar, JSON.stringify(corpo.erroAoGerar));

  // As duas frases têm que ser DIFERENTES. É o que faz o próximo relato do
  // dono já dizer qual das duas falhas foi, sem ninguém abrir log.
  limpar();
  const outro = naFila();
  ctrl.reply = "";
  const vazio = (await chamarRota(previaHandler, { params: { id: String(outro.id) } }))
    .body as { erroAoGerar: string | null };
  ok(
    "a tela distingue explodiu de veio-vazio",
    corpo.erroAoGerar !== vazio.erroAoGerar,
    `${corpo.erroAoGerar} | ${vazio.erroAoGerar}`,
  );
}

secao("prévia — o caminho feliz continua devolvendo a mensagem, e sem erro");
{
  limpar();
  const lead = naFila();
  const r = await chamarRota(previaHandler, { params: { id: String(lead.id) } });
  const corpo = r.body as { mensagem: string | null; erroAoGerar: string | null };
  ok("veio mensagem", typeof corpo.mensagem === "string" && corpo.mensagem.length > 0, JSON.stringify(corpo.mensagem));
  ok("e nenhum erro", corpo.erroAoGerar === null, JSON.stringify(corpo.erroAoGerar));
}

delete process.env.OUTREACH_ENABLED;
fim();
