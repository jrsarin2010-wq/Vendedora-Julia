/**
 * Etapa 3B — controle da varredura pelo painel.
 *
 * O que este arquivo protege: a TRAVA HÍBRIDA. A partir daqui existem duas
 * chaves (env do Railway e linha no banco), e o worker só anda com as duas
 * ligadas. Uma delas falhando aberta significa varredura disparando quando o
 * operador acha que desligou — ou seja, crédito saindo sem ninguém olhando.
 *
 * As asserções de "não roda" valem mais que as de "roda": a que roda todo
 * mundo percebe na hora.
 */
import { ok, secao, fim } from "./assert";
import { handlerDe, chamarRota } from "./rota";
import varredurasRouter from "../src/routes/varreduras";
import {
  rodarCicloDeVarredura,
  esquecerAlertasDeVarredura,
  retomarVarredura,
} from "../src/lib/varredura-scheduler";
import { requireAuth } from "../src/lib/auth";
import { state } from "./stubs/db.mjs";
import { apify } from "./stubs/apify.mjs";
import { wa } from "./stubs/integrations.mjs";

const statusHandler = handlerDe(varredurasRouter, 0);
const ativaHandler = handlerDe(varredurasRouter, 1);

const AGORA = new Date("2026-08-15T12:00:00Z");

interface Status {
  ativa: boolean;
  interruptorGeral: boolean;
  pausadaPorErro: boolean;
  motivoPausa: string | null;
  fila: Record<string, number>;
  gastoMesUsd: number;
  tetoUsd: number;
  rodadasHoje: number;
  tetoDiario: number;
  ultimaVarredura: { termo: string; cidade: string; uf: string } | null;
}

function limpar() {
  state.reset();
  wa.reset();
  apify.reset();
  esquecerAlertasDeVarredura();
  retomarVarredura();
  process.env.APIFY_SWEEP_ENABLED = "true";
  apify.inicio = { ok: true, runId: "run-1", datasetId: "ds-1" };
  apify.estado = {
    ok: true,
    situacao: "sucesso",
    statusCru: "SUCCEEDED",
    custoUsd: 0.075,
    campoDoCusto: "chargedTotalUsd",
    datasetId: "ds-1",
  };
  apify.dataset = { ok: true, itens: [] };
}

function ligarNoPainel(ativa: boolean) {
  state.configuracoes.push({ chave: "varredura_ativa", valor: ativa ? "true" : "false" });
}

function varredura(campos: Record<string, unknown>) {
  state.varreduras.push({
    id: state.nextId++,
    termoBusca: "clínica odontológica",
    cidade: "São Paulo",
    uf: "SP",
    maxResultados: 15,
    prioridade: 1,
    status: "pendente",
    custoRealUsd: "0",
    tentativas: 0,
    disparadaEm: null,
    concluidaEm: null,
    ...campos,
  });
}

// ---------------------------------------------------------------------------
secao("status — fila vazia, tudo zerado e nada inventado");
limpar();
let r = await chamarRota(statusHandler, {});
ok("status 200", r.status === 200, JSON.stringify(r.body));
let s = r.body as Status;
ok("ativa = false quando a chave nem existe", s.ativa === false);
ok("interruptorGeral reflete a env", s.interruptorGeral === true);
ok("não pausada", s.pausadaPorErro === false && s.motivoPausa === null);
ok("fila toda em zero", Object.values(s.fila).every((n) => n === 0), JSON.stringify(s.fila));
ok("gasto zero", s.gastoMesUsd === 0);
ok("teto mensal 4.5", s.tetoUsd === 4.5);
ok("teto diário 10", s.tetoDiario === 10);
ok("sem última varredura", s.ultimaVarredura === null);

secao("status — a env desligada aparece na tela em vez de virar botão morto");
limpar();
process.env.APIFY_SWEEP_ENABLED = "false";
ligarNoPainel(true);
s = (await chamarRota(statusHandler, {})).body as Status;
ok("ativa = true (o painel diz sim)", s.ativa === true);
ok("interruptorGeral = false (o Railway diz não)", s.interruptorGeral === false);

secao("status — fila cheia: contagem por estado, gasto do mês e cota");
limpar();
ligarNoPainel(true);
varredura({ status: "concluida", custoRealUsd: "0.0750", concluidaEm: AGORA, disparadaEm: AGORA });
varredura({ status: "concluida", custoRealUsd: "0.0750", concluidaEm: new Date("2026-07-10T12:00:00Z"), disparadaEm: new Date("2026-07-10T12:00:00Z") });
varredura({ status: "executando", disparadaEm: AGORA });
varredura({ status: "falhou", tentativas: 3 });
varredura({ status: "pendente" });
varredura({ status: "pendente" });
s = (await chamarRota(statusHandler, {})).body as Status;
ok("2 pendentes", s.fila.pendente === 2, JSON.stringify(s.fila));
ok("1 executando", s.fila.executando === 1);
ok("2 concluídas", s.fila.concluida === 2);
ok("1 falhou", s.fila.falhou === 1);
ok("0 canceladas", s.fila.cancelada === 0);
ok(
  "gasto do mês ignora julho — só 0.075",
  s.gastoMesUsd === 0.075,
  `veio ${s.gastoMesUsd}`,
);
ok("última varredura é a concluída mais recente", s.ultimaVarredura?.uf === "SP");

secao("status — pausa por erro chega na tela COM o motivo");
limpar();
ligarNoPainel(true);
varredura({ status: "pendente" });
apify.inicio = { ok: false, culpaNossa: true, erro: "HTTP 401 user-or-token-not-found" };
r = await chamarRota(statusHandler, {});
ok("antes do ciclo, não está pausada", (r.body as Status).pausadaPorErro === false);
const ciclo = await rodarCicloDeVarredura(AGORA);
ok("o ciclo pausou", ciclo.motivo === "pausada", JSON.stringify(ciclo));
s = (await chamarRota(statusHandler, {})).body as Status;
ok("pausadaPorErro = true", s.pausadaPorErro === true);
ok(
  "e o motivo é o texto do erro, não um código",
  typeof s.motivoPausa === "string" && s.motivoPausa.includes("401"),
  String(s.motivoPausa),
);

// ---------------------------------------------------------------------------
secao("POST /varreduras/ativa — grava e devolve o status já atualizado");
limpar();
r = await chamarRota(ativaHandler, { body: { ativa: true } });
ok("status 200", r.status === 200, JSON.stringify(r.body));
ok("a resposta já diz ativa", (r.body as Status).ativa === true);
ok("gravou uma linha", state.configuracoes.length === 1, JSON.stringify(state.configuracoes));
ok(
  "com a chave certa",
  state.configuracoes[0].chave === "varredura_ativa" && state.configuracoes[0].valor === "true",
  JSON.stringify(state.configuracoes[0]),
);
ok("e o GET concorda", ((await chamarRota(statusHandler, {})).body as Status).ativa === true);

secao("POST /varreduras/ativa — desligar ATUALIZA a linha, não cria outra");
r = await chamarRota(ativaHandler, { body: { ativa: false } });
ok("status 200", r.status === 200);
ok("a resposta diz desligada", (r.body as Status).ativa === false);
ok("continua UMA linha só", state.configuracoes.length === 1, JSON.stringify(state.configuracoes));
ok("com o valor novo", state.configuracoes[0].valor === "false");

secao("POST /varreduras/ativa — corpo inválido é recusado, não interpretado");
for (const corpo of [{ ativa: "true" }, { ativa: 1 }, {}, { ativa: null }]) {
  const resp = await chamarRota(ativaHandler, { body: corpo });
  ok(`400 para ${JSON.stringify(corpo)}`, resp.status === 400, JSON.stringify(resp.body));
}
ok("e nada foi alterado", state.configuracoes[0].valor === "false");

// ---------------------------------------------------------------------------
secao("A TRAVA HÍBRIDA — o worker exige as DUAS");

limpar();
process.env.APIFY_SWEEP_ENABLED = "false";
ligarNoPainel(true);
varredura({ status: "pendente" });
let c = await rodarCicloDeVarredura(AGORA);
ok("env false + banco true → NÃO roda", c.acao === "nada" && c.motivo === "desligado", JSON.stringify(c));
ok("e nada foi disparado no Apify", apify.disparos.length === 0, String(apify.disparos.length));

limpar();
process.env.APIFY_SWEEP_ENABLED = "true";
ligarNoPainel(false);
varredura({ status: "pendente" });
c = await rodarCicloDeVarredura(AGORA);
ok(
  "env true + banco false → NÃO roda",
  c.acao === "nada" && c.motivo === "desligada_no_painel",
  JSON.stringify(c),
);
ok("e nada foi disparado no Apify", apify.disparos.length === 0, String(apify.disparos.length));

limpar();
process.env.APIFY_SWEEP_ENABLED = "true";
varredura({ status: "pendente" });
c = await rodarCicloDeVarredura(AGORA);
ok(
  "env true + chave AUSENTE → NÃO roda (ausente é desligada)",
  c.acao === "nada" && c.motivo === "desligada_no_painel",
  JSON.stringify(c),
);

limpar();
process.env.APIFY_SWEEP_ENABLED = "true";
ligarNoPainel(true);
varredura({ status: "pendente" });
c = await rodarCicloDeVarredura(AGORA);
ok("as duas ligadas → dispara", c.acao === "disparou", JSON.stringify(c));
ok("e o Apify foi chamado uma vez", apify.disparos.length === 1, String(apify.disparos.length));

secao("a pausa por erro vence as duas travas");
limpar();
process.env.APIFY_SWEEP_ENABLED = "true";
ligarNoPainel(true);
varredura({ status: "pendente" });
apify.inicio = { ok: false, culpaNossa: true, erro: "HTTP 401" };
await rodarCicloDeVarredura(AGORA);
apify.inicio = { ok: true, runId: "run-2", datasetId: "ds-2" };
c = await rodarCicloDeVarredura(new Date(AGORA.getTime() + 60_000));
ok("segue pausada mesmo com tudo ligado", c.motivo === "pausada", JSON.stringify(c));

// ---------------------------------------------------------------------------
secao("sem sessão — as rotas do painel respondem 401");
{
  let statusRecebido = 0;
  let corpo: unknown = null;
  let passou = false;
  const res: any = {
    status(c: number) {
      statusRecebido = c;
      return res;
    },
    json(b: unknown) {
      corpo = b;
      return res;
    },
  };
  requireAuth({ cookies: {} } as never, res, () => {
    passou = true;
  });
  ok("não deixou passar", passou === false);
  ok("respondeu 401", statusRecebido === 401);
  ok("com erro unauthorized", (corpo as { error?: string })?.error === "unauthorized");
}

fim();
