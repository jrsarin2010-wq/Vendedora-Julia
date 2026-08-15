/**
 * Etapa 2 — worker de varredura Apify.
 *
 * O que este arquivo protege, acima de tudo: dinheiro. Cada asserção de
 * orçamento, cota e "uma ação por ciclo" existe porque o erro correspondente
 * não aparece em tela nenhuma — aparece no crédito do mês, depois de gasto.
 */
import { ok, secao, fim } from "./assert";
import {
  rodarCicloDeVarredura,
  esquecerAlertasDeVarredura,
} from "../src/lib/varredura-scheduler";
import {
  calcularOrcamento,
  custoPrevisto,
  escolherProxima,
  inputDoAtor,
  prepararItem,
  prepararLote,
  runPendurada,
  USD_POR_LUGAR,
  TETO_MENSAL_USD,
  MAX_TOTAL_CHARGE_USD,
} from "../src/lib/varredura";
import { normalizarTelefone } from "../src/lib/filtro-spam";
import { state } from "./stubs/db.mjs";
import { apify } from "./stubs/apify.mjs";
import { wa } from "./stubs/integrations.mjs";

const AGORA = new Date("2026-08-15T12:00:00Z");
const minutos = (n: number) => n * 60 * 1000;
const horas = (n: number) => n * 60 * minutos(1);

function limpar() {
  state.reset();
  wa.reset();
  apify.reset();
  esquecerAlertasDeVarredura();
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

function varredura(over: Record<string, unknown> = {}) {
  const v = {
    id: state.nextId++,
    termoBusca: "clínica odontológica",
    cidade: "São Paulo",
    uf: "SP",
    maxResultados: 15,
    prioridade: 1,
    status: "pendente",
    apifyRunId: null,
    apifyDatasetId: null,
    resultadosRecebidos: 0,
    custoRealUsd: "0",
    tentativas: 0,
    erroMensagem: null,
    disparadaEm: null,
    concluidaEm: null,
    criadaEm: AGORA,
    ...over,
  };
  state.varreduras.push(v);
  return v as any;
}

const doBanco = (id: number) => state.varreduras.find((v: any) => v.id === id) as any;
const clinica = (placeId: string) =>
  state.clinicas.find((c: any) => c.placeId === placeId) as any;

const ITEM_COMPLETO = {
  placeId: "ChIJ-alfa",
  title: "Clínica Alfa",
  phoneUnformatted: "+5511950402340",
  website: "https://alfa.com.br",
  address: "Rua das Flores, 100 - São Paulo, SP",
  city: "São Paulo",
  neighborhood: "Parelheiros",
  postalCode: "04800-000",
  categoryName: "Dentista",
  totalScore: 4.8,
  reviewsCount: 132,
  location: { lat: -23.82, lng: -46.73 },
  claimThisBusiness: false,
  isAdvertisement: true,
  state: "São Paulo",
};

secao("orçamento — a conta que decide se o dinheiro sai");
ok("15 resultados custam US$ 0,075", custoPrevisto(15) === 0.075, String(custoPrevisto(15)));
ok(
  "fechar exatamente no teto ainda passa",
  calcularOrcamento({ gastoNoMes: 4.425, resultadosEmVoo: 0, maxResultados: 15 }).pode === true,
  JSON.stringify(calcularOrcamento({ gastoNoMes: 4.425, resultadosEmVoo: 0, maxResultados: 15 })),
);
ok(
  "um centavo acima do teto não passa",
  calcularOrcamento({ gastoNoMes: 4.43, resultadosEmVoo: 0, maxResultados: 15 }).pode === false,
);
{
  // A reserva em voo é o que impede disparar contra crédito já comprometido:
  // o custo real de uma run só existe quando ela termina.
  const semReserva = calcularOrcamento({ gastoNoMes: 4.0, resultadosEmVoo: 0, maxResultados: 15 });
  const comReserva = calcularOrcamento({ gastoNoMes: 4.0, resultadosEmVoo: 90, maxResultados: 15 });
  ok("sem nada em voo, dispara", semReserva.pode === true);
  ok("com 90 resultados em voo, NÃO dispara", comReserva.pode === false, JSON.stringify(comReserva));
  ok("a reserva entra na conta", comReserva.reservaEmVoo === 0.45, String(comReserva.reservaEmVoo));
  ok("o teto é US$ 4,50", TETO_MENSAL_USD === 4.5);
  ok("o preço por lugar é o medido na calibração", USD_POR_LUGAR === 0.005);
}

secao("input do ator — nomes de campo confirmados na calibração");
{
  const input = inputDoAtor({
    termoBusca: "dentista",
    cidade: "Recife",
    uf: "PE",
    maxResultados: 15,
  }) as any;
  ok("searchStringsArray", JSON.stringify(input.searchStringsArray) === '["dentista"]');
  ok("locationQuery com o Brazil no fim", input.locationQuery === "Recife, PE, Brazil");
  ok("maxCrawledPlacesPerSearch = tamanho da rodada", input.maxCrawledPlacesPerSearch === 15);
  ok("idioma pt-BR", input.language === "pt-BR");
  ok("maxTotalChargeUsd vai em toda run", input.maxTotalChargeUsd === MAX_TOTAL_CHARGE_USD);
  ok(
    "NENHUM add-on ligado (no Free custam 20× o dado base)",
    Object.keys(input).length === 5,
    JSON.stringify(Object.keys(input)),
  );
}

secao("mapeamento — a UF vem da varredura, nunca do item");
{
  const { linha } = prepararItem(
    { placeId: "x", title: "Clínica Y", state: "São Paulo" },
    { id: 7, cidade: "Recife", uf: "PE" } as any,
  );
  ok("uf = PE (da varredura), não 'São Paulo'", linha?.uf === "PE", String(linha?.uf));
  ok("cidade cai para a da varredura quando o item não traz", linha?.cidade === "Recife");
  ok("varredura_id preenchido", linha?.varreduraId === 7);
  ok("telefone_whatsapp continua nulo nesta etapa", linha?.telefoneWhatsapp === null);
  ok("tem_whatsapp continua nulo nesta etapa", linha?.temWhatsapp === null);
  ok("instagram nulo (não há fonte sem add-on)", linha?.instagram === null);
}

secao("mapeamento — telefone com + é preservado e é consumível pela Etapa 3");
{
  const { linha } = prepararItem(ITEM_COMPLETO, { id: 1, cidade: "São Paulo", uf: "SP" } as any);
  ok("telefone_raw guarda o que veio, com o +", linha?.telefoneRaw === "+5511950402340");
  ok(
    "e a Etapa 3 consegue normalizar isso",
    normalizarTelefone(linha?.telefoneRaw as string) === "5511950402340",
    String(normalizarTelefone(linha?.telefoneRaw as string)),
  );
  ok("status novo quando há telefone", linha?.statusProspeccao === "novo");
  ok("bairro guardado (é o que mede a concentração da busca)", linha?.bairro === "Parelheiros");
  ok("perfil reivindicado = !claimThisBusiness", linha?.perfilReivindicado === true);
  ok("nota vira texto (coluna numeric)", linha?.nota === "4.8");
  ok("avaliações", linha?.totalAvaliacoes === 132);
  ok("latitude/longitude viram texto", linha?.latitude === "-23.82" && linha?.longitude === "-46.73");
}

secao("mapeamento — o que falta vira nulo, não erro");
{
  const { linha } = prepararItem(
    { placeId: "z", title: "Sem nada" },
    { id: 1, cidade: "São Paulo", uf: "SP" } as any,
  );
  ok("nota nula", linha?.nota === null);
  ok("avaliações nulas", linha?.totalAvaliacoes === null);
  ok("coordenadas nulas", linha?.latitude === null && linha?.longitude === null);
  ok("sem telefone → status sem_telefone", linha?.statusProspeccao === "sem_telefone");
  ok(
    "claimThisBusiness ausente NÃO vira 'reivindicado'",
    linha?.perfilReivindicado === null,
    String(linha?.perfilReivindicado),
  );
}

secao("lote — item ruim não derruba os outros");
{
  const lote = prepararLote(
    [
      ITEM_COMPLETO,
      { title: "Sem place id", phoneUnformatted: "+551133335555" },
      { placeId: "ChIJ-fechada", title: "Fechada", permanentlyClosed: true },
      { placeId: "ChIJ-temp", title: "Temporária", temporarilyClosed: true },
      { placeId: "ChIJ-alfa", title: "Alfa repetida" },
    ],
    { id: 1, cidade: "São Paulo", uf: "SP" } as any,
  );
  // Dos 5: a completa e a temporariamente fechada entram; sem place_id,
  // permanentemente fechada e a repetida ficam de fora.
  ok("2 linhas aproveitadas", lote.linhas.length === 2, JSON.stringify(lote.linhas.map((l) => l.placeId)));
  ok("1 sem place_id contado", lote.semPlaceId === 1);
  ok("1 permanentemente fechada descartada", lote.fechados === 1);
  ok("1 repetida no mesmo lote", lote.repetidos === 1);
  ok(
    "fechada TEMPORARIAMENTE entra (ainda é mercado)",
    lote.linhas.some((l) => l.placeId === "ChIJ-temp"),
  );
  ok(
    "anúncio no Maps entra (é clínica igual)",
    lote.linhas.some((l) => l.placeId === "ChIJ-alfa"),
  );
}

secao("fila — prioridade primeiro, depois o id");
{
  const escolhida = escolherProxima([
    { id: 30, prioridade: 2 },
    { id: 10, prioridade: 1 },
    { id: 5, prioridade: 2 },
    { id: 20, prioridade: 1 },
  ]);
  ok("a de prioridade 1 com menor id", escolhida?.id === 10, JSON.stringify(escolhida));
  ok("fila vazia devolve null", escolherProxima([]) === null);
}

secao("run pendurada — o relógio de 30 minutos");
ok("29 min ainda não", runPendurada(new Date(AGORA.getTime() - minutos(29)), AGORA) === false);
ok("31 min sim", runPendurada(new Date(AGORA.getTime() - minutos(31)), AGORA) === true);
ok("sem disparada_em não é pendurada", runPendurada(null, AGORA) === false);

secao("trava mestra desligada — nada sai, nem consulta");
limpar();
process.env.APIFY_SWEEP_ENABLED = "false";
varredura();
let r = await rodarCicloDeVarredura(AGORA);
ok("ação nenhuma", r.acao === "nada" && r.motivo === "desligado", JSON.stringify(r));
ok("nenhum disparo", apify.disparos.length === 0);
ok("nem chegou a consultar o banco do Apify", apify.consultas.length === 0);
process.env.APIFY_SWEEP_ENABLED = "true";

secao("UMA ação por ciclo — com run em voo, verifica e NÃO dispara");
limpar();
varredura({ id: 1, status: "executando", apifyRunId: "run-9", disparadaEm: new Date(AGORA.getTime() - minutos(1)) });
varredura({ id: 2, status: "pendente" });
apify.estado = { ok: true, situacao: "rodando", statusCru: "RUNNING", custoUsd: null, campoDoCusto: null };
r = await rodarCicloDeVarredura(AGORA);
ok("verificou", r.acao === "verificou" && r.motivo === "rodando", JSON.stringify(r));
ok("consultou a run em voo", JSON.stringify(apify.consultas) === '["run-9"]');
ok("NÃO disparou a pendente no mesmo ciclo", apify.disparos.length === 0);
ok("a pendente continua pendente", doBanco(2).status === "pendente");

secao("cota diária — 10 em 24h e para");
limpar();
for (let i = 0; i < 10; i++) {
  varredura({
    status: "concluida",
    disparadaEm: new Date(AGORA.getTime() - horas(2)),
    concluidaEm: new Date(AGORA.getTime() - horas(2)),
    custoRealUsd: "0.075",
  });
}
varredura({ status: "pendente" });
r = await rodarCicloDeVarredura(AGORA);
ok("bloqueado pela cota", r.acao === "nada" && r.motivo === "cota_diaria", JSON.stringify(r));
ok("nada disparado", apify.disparos.length === 0);
// 25h depois, as dez saíram da janela e a fila anda de novo.
r = await rodarCicloDeVarredura(new Date(AGORA.getTime() + horas(25)));
ok("passadas 25h, dispara", r.acao === "disparou", JSON.stringify(r));

secao("trava de orçamento — bloqueia e alerta UMA vez por dia");
limpar();
varredura({
  status: "concluida",
  custoRealUsd: "4.45",
  disparadaEm: new Date(AGORA.getTime() - horas(48)),
  concluidaEm: new Date(AGORA.getTime() - horas(48)),
});
varredura({ status: "pendente" });
r = await rodarCicloDeVarredura(AGORA);
ok("não dispara", r.acao === "nada" && r.motivo === "orcamento", JSON.stringify(r));
ok("nada foi pedido ao Apify", apify.disparos.length === 0);
ok("alertou uma vez", wa.varreduras.length === 1, JSON.stringify(wa.varreduras));
ok("o alerta é o de orçamento", wa.varreduras[0].tipo === "orcamento");
r = await rodarCicloDeVarredura(new Date(AGORA.getTime() + minutos(1)));
ok("no minuto seguinte NÃO alerta de novo", wa.varreduras.length === 1, JSON.stringify(wa.varreduras));
r = await rodarCicloDeVarredura(new Date(AGORA.getTime() + horas(24)));
ok("no dia seguinte volta a alertar", wa.varreduras.length === 2, JSON.stringify(wa.varreduras));

secao("gasto de MESES anteriores não conta no teto do mês");
limpar();
varredura({
  status: "concluida",
  custoRealUsd: "4.49",
  disparadaEm: new Date("2026-07-10T12:00:00Z"),
  concluidaEm: new Date("2026-07-10T12:00:00Z"),
});
varredura({ status: "pendente" });
r = await rodarCicloDeVarredura(AGORA);
ok("o crédito virou: dispara normalmente", r.acao === "disparou", JSON.stringify(r));

secao("disparo — grava run id, dataset e o horário");
limpar();
varredura({ id: 1, status: "pendente", prioridade: 2, cidade: "Recife", uf: "PE", termoBusca: "dentista" });
varredura({ id: 2, status: "pendente", prioridade: 1 });
apify.inicio = { ok: true, runId: "run-77", datasetId: "ds-77" };
r = await rodarCicloDeVarredura(AGORA);
ok("disparou a de prioridade 1", r.acao === "disparou" && r.varreduraId === 2, JSON.stringify(r));
ok("um disparo só", apify.disparos.length === 1);
ok(
  "com o input da varredura escolhida",
  (apify.disparos[0] as any).locationQuery === "São Paulo, SP, Brazil",
  JSON.stringify(apify.disparos[0]),
);
ok("status executando", doBanco(2).status === "executando");
ok("run id gravado", doBanco(2).apifyRunId === "run-77");
ok("dataset gravado", doBanco(2).apifyDatasetId === "ds-77");
ok("disparada_em = agora", doBanco(2).disparadaEm === AGORA);
ok("a outra segue intacta", doBanco(1).status === "pendente");

secao("falha ao INICIAR a run conta tentativa e não deixa fantasma em voo");
limpar();
varredura({ id: 1, status: "pendente" });
apify.inicio = { ok: false, erro: "HTTP 402: payment required" };
r = await rodarCicloDeVarredura(AGORA);
ok("não disparou", r.acao === "nada" && r.motivo === "falha_ao_disparar", JSON.stringify(r));
ok("continua pendente (não ficou 'executando')", doBanco(1).status === "pendente");
ok("tentativa contada", doBanco(1).tentativas === 1);
ok("erro gravado", String(doBanco(1).erroMensagem).includes("402"), doBanco(1).erroMensagem);

secao("run com sucesso — ingere, grava custo real e SÓ ENTÃO conclui");
limpar();
varredura({
  id: 1,
  status: "executando",
  apifyRunId: "run-1",
  apifyDatasetId: "ds-1",
  disparadaEm: new Date(AGORA.getTime() - minutos(1)),
});
apify.dataset = {
  ok: true,
  itens: [
    ITEM_COMPLETO,
    { placeId: "ChIJ-beta", title: "Clínica Beta", city: "São Paulo" },
    { placeId: "ChIJ-fechada", title: "Fechada", permanentlyClosed: true, phoneUnformatted: "+551133334444" },
    { title: "Sem place id", phoneUnformatted: "+551133335555" },
  ],
};
r = await rodarCicloDeVarredura(AGORA);
ok("concluiu", r.acao === "verificou" && r.motivo === "concluida", JSON.stringify(r));
ok("2 clínicas gravadas (fechada e sem place_id fora)", state.clinicas.length === 2, JSON.stringify(state.clinicas.map((c: any) => c.placeId)));
ok("a completa entrou como 'novo'", clinica("ChIJ-alfa").statusProspeccao === "novo");
ok("a sem telefone entrou como 'sem_telefone'", clinica("ChIJ-beta").statusProspeccao === "sem_telefone");
ok("a permanentemente fechada NÃO entrou", clinica("ChIJ-fechada") === undefined);
ok("uf da varredura, não do item", clinica("ChIJ-alfa").uf === "SP");
ok("varredura_id preenchido", clinica("ChIJ-alfa").varreduraId === 1);
ok("status concluida", doBanco(1).status === "concluida");
ok("custo REAL da run gravado", doBanco(1).custoRealUsd === "0.075", doBanco(1).custoRealUsd);
ok("resultados_recebidos conta os itens do dataset", doBanco(1).resultadosRecebidos === 4, String(doBanco(1).resultadosRecebidos));
ok("concluida_em preenchido", doBanco(1).concluidaEm === AGORA);

secao("ingestão repetida do mesmo dataset não duplica nada");
// Simula o processo ter morrido depois de inserir e antes de concluir: a
// varredura volta a 'executando' e o ciclo reprocessa o mesmo dataset.
doBanco(1).status = "executando";
doBanco(1).concluidaEm = null;
r = await rodarCicloDeVarredura(AGORA);
ok("concluiu de novo", r.motivo === "concluida", JSON.stringify(r));
ok("continua com 2 clínicas, nenhuma duplicada", state.clinicas.length === 2, JSON.stringify(state.clinicas.map((c: any) => c.placeId)));

secao("custo ausente na run — calcula, avisa, e NUNCA grava zero");
limpar();
varredura({ id: 1, status: "executando", apifyRunId: "run-1", apifyDatasetId: "ds-1", disparadaEm: AGORA });
apify.estado = {
  ok: true,
  situacao: "sucesso",
  statusCru: "SUCCEEDED",
  custoUsd: null,
  campoDoCusto: null,
  datasetId: "ds-1",
};
apify.dataset = {
  ok: true,
  itens: [
    { placeId: "a", title: "A" },
    { placeId: "b", title: "B" },
    { placeId: "c", title: "C" },
  ],
};
r = await rodarCicloDeVarredura(AGORA);
ok("concluiu mesmo assim", r.motivo === "concluida", JSON.stringify(r));
ok(
  "custo calculado por lugar (3 × 0,005)",
  doBanco(1).custoRealUsd === "0.015",
  doBanco(1).custoRealUsd,
);
ok("não gravou zero", Number(doBanco(1).custoRealUsd) > 0);

secao("dataset que não baixa — segura a varredura em voo para tentar de novo");
limpar();
varredura({ id: 1, status: "executando", apifyRunId: "run-1", apifyDatasetId: "ds-1", disparadaEm: AGORA });
apify.dataset = { ok: false, itens: [], erro: "HTTP 500" };
r = await rodarCicloDeVarredura(AGORA);
ok("não concluiu", r.motivo === "dataset_falhou", JSON.stringify(r));
ok("segue 'executando' para o próximo ciclo", doBanco(1).status === "executando");
ok("não gravou clínica nenhuma", state.clinicas.length === 0);
ok("não contou tentativa (a run está boa; o download é que falhou)", doBanco(1).tentativas === 0);

secao("run que falha — volta para a fila; na terceira, desiste e alerta");
limpar();
varredura({ id: 1, status: "executando", apifyRunId: "run-x", disparadaEm: new Date(AGORA.getTime() - minutos(2)), tentativas: 0 });
apify.estado = { ok: true, situacao: "falha", statusCru: "FAILED", custoUsd: null, campoDoCusto: null };
r = await rodarCicloDeVarredura(AGORA);
ok("1ª falha: volta para pendente", doBanco(1).status === "pendente", JSON.stringify(doBanco(1)));
ok("tentativas = 1", doBanco(1).tentativas === 1);
ok("sem alerta ainda", wa.varreduras.length === 0);
doBanco(1).status = "executando";
r = await rodarCicloDeVarredura(AGORA);
ok("2ª falha: ainda volta para pendente", doBanco(1).status === "pendente");
ok("tentativas = 2", doBanco(1).tentativas === 2);
ok("ainda sem alerta", wa.varreduras.length === 0);
doBanco(1).status = "executando";
r = await rodarCicloDeVarredura(AGORA);
ok("3ª falha: desiste", doBanco(1).status === "falhou", JSON.stringify(doBanco(1)));
ok("tentativas = 3", doBanco(1).tentativas === 3);
ok("alertou uma vez", wa.varreduras.length === 1, JSON.stringify(wa.varreduras));
ok("o alerta diz qual combinação morreu", wa.varreduras[0].tipo === "falhou" && wa.varreduras[0].cidade === "São Paulo", JSON.stringify(wa.varreduras[0]));
ok("e o motivo ficou gravado", String(doBanco(1).erroMensagem).includes("FAILED"), doBanco(1).erroMensagem);

secao("run pendurada há mais de 30 min é tratada como falha");
limpar();
varredura({ id: 1, status: "executando", apifyRunId: "run-y", disparadaEm: new Date(AGORA.getTime() - minutos(31)) });
apify.estado = { ok: true, situacao: "rodando", statusCru: "RUNNING", custoUsd: null, campoDoCusto: null };
r = await rodarCicloDeVarredura(AGORA);
ok("virou falha", doBanco(1).status === "pendente" && doBanco(1).tentativas === 1, JSON.stringify(doBanco(1)));
ok("com o motivo explícito", String(doBanco(1).erroMensagem).includes("pendurada"), doBanco(1).erroMensagem);

secao("consulta ao Apify que falha não condena a run (a não ser que penda)");
limpar();
varredura({ id: 1, status: "executando", apifyRunId: "run-z", disparadaEm: new Date(AGORA.getTime() - minutos(2)) });
apify.estado = { ok: false, custoUsd: null, campoDoCusto: null, erro: "HTTP 503" };
r = await rodarCicloDeVarredura(AGORA);
ok("só espera", r.motivo === "consulta_falhou", JSON.stringify(r));
ok("segue executando, sem tentativa contada", doBanco(1).status === "executando" && doBanco(1).tentativas === 0);

secao("fila vazia — alerta uma vez; tabela vazia não alerta nada");
limpar();
r = await rodarCicloDeVarredura(AGORA);
ok("fila vazia", r.acao === "nada" && r.motivo === "fila_vazia", JSON.stringify(r));
ok("tabela vazia NÃO alerta (é seed que não rodou, não Onda 1 concluída)", wa.varreduras.length === 0);
limpar();
varredura({
  status: "concluida",
  custoRealUsd: "0.075",
  disparadaEm: new Date(AGORA.getTime() - horas(48)),
  concluidaEm: new Date(AGORA.getTime() - horas(48)),
});
r = await rodarCicloDeVarredura(AGORA);
ok("com a fila terminada, alerta", wa.varreduras.length === 1 && wa.varreduras[0].tipo === "fila_vazia", JSON.stringify(wa.varreduras));
r = await rodarCicloDeVarredura(new Date(AGORA.getTime() + minutos(5)));
ok("e não repete no mesmo dia", wa.varreduras.length === 1);

fim();
