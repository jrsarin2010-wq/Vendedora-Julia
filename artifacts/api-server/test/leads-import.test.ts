/**
 * Rodada 23.1/23.2 — importação de leads.
 *
 * As quatro regras inegociáveis, com atenção especial à do opt-out: quem
 * pediu para parar não pode voltar à fila só porque reapareceu na planilha.
 */
import { ok, secao, fim } from "./assert";
import { handlerDe, chamarRota, type RespostaFake } from "./rota";
import importRouter from "../src/routes/leads-import";
import { normalizarTelefone, pareceCelularReal } from "../src/lib/filtro-spam";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";

const handler = handlerDe(importRouter);

interface Resumo {
  importados: number;
  duplicados: number;
  invalidos: number;
  ignoradosPorOptOut: number;
}

async function importar(leads: unknown[]): Promise<RespostaFake> {
  return chamarRota(handler, { body: { leads } });
}

const resumoDe = (r: RespostaFake) => r.body as Resumo;

/** Põe um lead já existente no "banco", como se tivesse vindo do WhatsApp. */
function jaNoBanco(phone: string, status: string) {
  state.leads.push({ id: state.nextId++, phone, status, origin: "whatsapp" });
}

secao("normalizarTelefone — reaproveita a validação do filtro anti-spam");
const equivalentes = [
  "85999998888",
  "(85) 99999-8888",
  "+55 85 99999-8888",
  "55 85 99999 8888",
  "5585999998888",
  "85 9 9999-8888",
];
for (const bruto of equivalentes) {
  ok(`"${bruto}" → 5585999998888`, normalizarTelefone(bruto) === "5585999998888", String(normalizarTelefone(bruto)));
}
ok("8 dígitos + DDD também vale", normalizarTelefone("(85) 3333-4444") === "558533334444");
// DDD 55 (Santa Maria/RS) é a armadilha: começa com "55" sem ser código de país.
ok("DDD 55 não perde o código do país", normalizarTelefone("55999998888") === "5555999998888");
for (const ruim of ["4004", "0800", "08007771234", "abc", "", "123", "5585999998888999"]) {
  ok(`rejeita "${ruim || "(vazio)"}"`, normalizarTelefone(ruim) === null);
}
ok(
  "usa mesmo o pareceCelularReal do webhook",
  pareceCelularReal(normalizarTelefone("85999998888") as string),
);

secao("regra 1 — telefone inválido conta em invalidos");
state.reset();
let r = await importar([
  { phone: "85999998888", name: "Carlos" },
  { phone: "4004" },
  { phone: "0800" },
  { phone: "" },
  {},
]);
ok("status 200", r.status === 200);
ok("1 importado", resumoDe(r).importados === 1, JSON.stringify(r.body));
ok("4 inválidos", resumoDe(r).invalidos === 4, JSON.stringify(r.body));
ok("só o válido foi gravado", state.leads.length === 1);

secao("regra 2 — já existente não é sobrescrito nem re-prospectado");
state.reset();
jaNoBanco("5585999998888", "warm");
r = await importar([
  { phone: "85999998888", name: "Nome Novo", clinicName: "Clinica Nova" },
  { phone: "85977776666", name: "Marina" },
]);
ok("1 duplicado", resumoDe(r).duplicados === 1, JSON.stringify(r.body));
ok("1 importado", resumoDe(r).importados === 1);
ok("total no banco = 2", state.leads.length === 2);
const antigo = state.leads.find((l: any) => l.phone === "5585999998888");
ok("o existente NÃO foi sobrescrito", antigo.name === undefined && antigo.origin === "whatsapp", JSON.stringify(antigo));
ok(
  "o existente NÃO virou pendente de prospecção",
  antigo.outreachStatus === undefined,
  JSON.stringify(antigo),
);

secao("regra 3 — NUNCA reativar quem pediu para parar");
state.reset();
jaNoBanco("5585999998888", "lost");
r = await importar([{ phone: "85999998888", name: "Carlos" }]);
ok("conta como ignoradoPorOptOut", resumoDe(r).ignoradosPorOptOut === 1, JSON.stringify(r.body));
ok("NÃO conta como duplicado", resumoDe(r).duplicados === 0, JSON.stringify(r.body));
ok("NÃO foi importado", resumoDe(r).importados === 0);
ok("nenhum lead novo criado", state.leads.length === 1);
const perdido = state.leads[0];
ok("continua com status lost", perdido.status === "lost");
ok("NÃO ganhou outreachStatus pending", perdido.outreachStatus === undefined, JSON.stringify(perdido));
ok("insistir na mesma planilha não muda nada", true);
r = await importar([{ phone: "85999998888" }, { phone: "+5585999998888" }]);
ok("...mesmo repetido na planilha", resumoDe(r).importados === 0 && state.leads.length === 1, JSON.stringify(r.body));

secao("lost x duplicado — o motivo tem que ser o certo");
state.reset();
jaNoBanco("5585911112222", "lost");
jaNoBanco("5585933334444", "hot");
r = await importar([{ phone: "85911112222" }, { phone: "85933334444" }, { phone: "85955556666" }]);
ok("1 optOut", resumoDe(r).ignoradosPorOptOut === 1, JSON.stringify(r.body));
ok("1 duplicado", resumoDe(r).duplicados === 1, JSON.stringify(r.body));
ok("1 importado", resumoDe(r).importados === 1, JSON.stringify(r.body));

secao("regra 4 — o que entra, entra pendente de prospecção");
state.reset();
r = await importar([
  { phone: "85999998888", name: "Carlos", clinicName: "Clínica Sorriso", instagram: "@sorriso", city: "Fortaleza" },
]);
const novo = state.leads[0];
ok("origin = import", novo.origin === "import", JSON.stringify(novo));
ok("outreachStatus = pending", novo.outreachStatus === "pending");
ok("status = cold", novo.status === "cold");
ok("funnelStage = new", novo.funnelStage === "new");
ok("guarda o nome da clínica", novo.clinicName === "Clínica Sorriso");
ok("guarda o instagram", novo.instagram === "@sorriso");
ok("guarda a cidade", novo.city === "Fortaleza");
ok("NÃO marca outreachSentAt", novo.outreachSentAt === undefined);

secao("nada pode ser enviado nesta rodada");
// A Rodada 23.2 só popula a lista. O disparo é a 23.3, que ainda não existe.
// Se alguém ligar o envio aqui por engano, estes contadores saem de zero.
state.reset();
wa.reset();
await importar([
  { phone: "85999998888", name: "Carlos" },
  { phone: "85977776666", name: "Marina" },
]);
ok("importou os dois", state.leads.length === 2);
ok("nenhuma mensagem de WhatsApp saiu", wa.enviadas.length === 0, JSON.stringify(wa.enviadas));
ok("nenhum alerta de Telegram saiu", wa.alertas.length === 0, JSON.stringify(wa.alertas));

secao("telefone repetido dentro do próprio arquivo");
state.reset();
r = await importar([
  { phone: "85999998888", name: "Carlos" },
  { phone: "(85) 99999-8888", name: "Carlos de novo" },
  { phone: "5585999998888", name: "Carlos terceira vez" },
]);
ok("só 1 importado", resumoDe(r).importados === 1, JSON.stringify(r.body));
ok("2 contados como duplicados", resumoDe(r).duplicados === 2, JSON.stringify(r.body));
ok("banco com 1 lead só", state.leads.length === 1);

secao("corpo inválido");
state.reset();
ok("sem leads → 400", (await chamarRota(handler, { body: {} })).status === 400);
ok("leads não é lista → 400", (await chamarRota(handler, { body: { leads: "x" } })).status === 400);
ok("lista vazia → 400", (await importar([])).status === 400);
const demais = Array.from({ length: 2001 }, (_, i) => ({ phone: `8599999${String(i).padStart(4, "0")}` }));
const respostaGrande = await importar(demais);
ok("acima de 2000 → 413", respostaGrande.status === 413, JSON.stringify(respostaGrande));
ok("e não importa nada", state.leads.length === 0);

secao("resumo sempre traz os quatro contadores");
state.reset();
r = await importar([{ phone: "4004" }]);
const chaves = Object.keys(resumoDe(r)).sort();
ok(
  "importados, duplicados, invalidos, ignoradosPorOptOut",
  JSON.stringify(chaves) === JSON.stringify(["duplicados", "ignoradosPorOptOut", "importados", "invalidos"]),
  JSON.stringify(chaves),
);

fim();
