/**
 * Rodada 24 — exclusão de leads.
 *
 * O que mais importa aqui é o que NÃO fica para trás: apagar um dentista tem
 * que levar junto as mensagens e os follow-ups dele. Mensagem órfã não
 * aparece em tela nenhuma, mas fica no banco para sempre; follow-up órfão é
 * pior, porque o agendador ainda o encontra.
 */
import { ok, secao, fim } from "./assert";
import { handlerDe, chamarRota, type RespostaFake } from "./rota";
import leadsRouter from "../src/routes/leads";
import roteadorPrincipal from "../src/routes/index";
import { requireAuth } from "../src/lib/auth";
import { state } from "./stubs/db.mjs";

/**
 * Acha o handler de uma rota pelo método e caminho, para o teste não depender
 * da ordem em que elas foram registradas no arquivo.
 */
function acharRota(router: unknown, metodo: string, caminho: string) {
  const camada = (router as any).stack.find(
    (l: any) => l.route?.path === caminho && l.route?.methods?.[metodo],
  );
  if (!camada) throw new Error(`Rota ${metodo.toUpperCase()} ${caminho} não existe`);
  return camada.route.stack[camada.route.stack.length - 1].handle;
}

const apagarUm = acharRota(leadsRouter, "delete", "/leads/:id");
const faxina = acharRota(leadsRouter, "delete", "/leads/import-pending");

/** Cria um lead com mensagens e follow-ups pendurados nele. */
function leadCom(id: number, extras: Record<string, unknown> = {}, mensagens = 3, followUps = 4) {
  state.leads.push({
    id,
    phone: `55859999${String(id).padStart(4, "0")}`,
    status: "warm",
    origin: "whatsapp",
    outreachStatus: "none",
    ...extras,
  });
  for (let i = 0; i < mensagens; i++) {
    state.messages.push({ id: state.nextId++, leadId: id, direction: "inbound", content: `m${i}` });
  }
  for (let i = 0; i < followUps; i++) {
    state.followUps.push({ id: state.nextId++, leadId: id, status: "pending" });
  }
}

const corpo = (r: RespostaFake) => r.body as Record<string, number | boolean>;

secao("a rota existe e está registrada");
ok("DELETE /leads/:id existe", typeof apagarUm === "function");
ok("DELETE /leads/import-pending existe", typeof faxina === "function");

secao("exige login");

// 1) O middleware em si: sem cookie válido, barra com 401 e NÃO chama next().
let chamouNext = false;
let statusDoMiddleware = 0;
let corpoDoMiddleware: unknown = null;
const resFalso: any = {
  status(c: number) {
    statusDoMiddleware = c;
    return resFalso;
  },
  json(b: unknown) {
    corpoDoMiddleware = b;
    return resFalso;
  },
};
requireAuth({ cookies: {} } as any, resFalso, () => {
  chamouNext = true;
});
ok("sem cookie → responde 401", statusDoMiddleware === 401, String(statusDoMiddleware));
ok("sem cookie → NÃO deixa passar", chamouNext === false);
ok("responde erro unauthorized", JSON.stringify(corpoDoMiddleware) === '{"error":"unauthorized"}');

chamouNext = false;
statusDoMiddleware = 0;
requireAuth({ cookies: { julia_session: "inventado.assinatura" } } as any, resFalso, () => {
  chamouNext = true;
});
ok("cookie forjado → 401", statusDoMiddleware === 401 && chamouNext === false);

// 2) O encadeamento: as rotas de leads estão MONTADAS atrás desse middleware.
// Comparação por identidade da função — se alguém remover o requireAuth do
// roteador principal, isto quebra.
const camadas = (roteadorPrincipal as any).stack ?? [];
const montaRequireAuth = camadas.some((l: any) => l.handle === requireAuth);
ok("o roteador principal monta requireAuth", montaRequireAuth, `camadas=${camadas.length}`);

// E as rotas de exclusão não estão registradas na parte pública (antes dele).
const indiceDoPrimeiroAuth = camadas.findIndex((l: any) => l.handle === requireAuth);
const publicas = camadas.slice(0, indiceDoPrimeiroAuth);
const alcancaLeadsSemAuth = publicas.some((l: any) =>
  ((l.handle as any)?.stack ?? []).some((s: any) => String(s.route?.path ?? "").startsWith("/leads")),
);
ok("nenhuma rota /leads fica antes do requireAuth", !alcancaLeadsSemAuth);

secao("apagar um lead não deixa mensagem nem follow-up órfãos");
state.reset();
state.nextId = 100;
leadCom(1, {}, 3, 4);
leadCom(2, {}, 5, 2); // vizinho que NÃO pode ser tocado
ok("cenário montado", state.leads.length === 2 && state.messages.length === 8 && state.followUps.length === 6);

let r = await chamarRota(apagarUm, { params: { id: "1" } });
ok("status 200", r.status === 200, JSON.stringify(r));
ok("responde apagado", corpo(r).apagado === true);
ok("conta as mensagens apagadas", corpo(r).mensagensApagadas === 3, JSON.stringify(r.body));
ok("conta os follow-ups apagados", corpo(r).followUpsApagados === 4, JSON.stringify(r.body));

ok("o lead sumiu", !state.leads.some((l: any) => l.id === 1));
ok("nenhuma mensagem órfã", !state.messages.some((m: any) => m.leadId === 1), JSON.stringify(state.messages));
ok("nenhum follow-up órfão", !state.followUps.some((f: any) => f.leadId === 1), JSON.stringify(state.followUps));

secao("o vizinho fica intacto");
ok("lead 2 continua", state.leads.some((l: any) => l.id === 2));
ok("as 5 mensagens dele continuam", state.messages.filter((m: any) => m.leadId === 2).length === 5);
ok("os 2 follow-ups dele continuam", state.followUps.filter((f: any) => f.leadId === 2).length === 2);

secao("id inexistente e id inválido");
state.reset();
r = await chamarRota(apagarUm, { params: { id: "999" } });
ok("inexistente → 404", r.status === 404, JSON.stringify(r));
r = await chamarRota(apagarUm, { params: { id: "abc" } });
ok("id não numérico → 400", r.status === 400, JSON.stringify(r));

secao("apagar lead sem mensagem nem follow-up");
state.reset();
state.nextId = 200;
leadCom(7, {}, 0, 0);
r = await chamarRota(apagarUm, { params: { id: "7" } });
ok("funciona igual", r.status === 200 && corpo(r).apagado === true);
ok("zero mensagens apagadas", corpo(r).mensagensApagadas === 0);
ok("zero follow-ups apagados", corpo(r).followUpsApagados === 0);
ok("banco vazio", state.leads.length === 0);

secao("faxina — só importados que ainda NÃO foram abordados");
state.reset();
state.nextId = 300;
leadCom(1, { origin: "import", outreachStatus: "pending" }, 1, 1); // alvo
leadCom(2, { origin: "import", outreachStatus: "pending" }, 2, 0); // alvo
leadCom(3, { origin: "import", outreachStatus: "sent" }, 4, 1); // já abordado: fica
leadCom(4, { origin: "whatsapp", outreachStatus: "none" }, 6, 2); // chegou sozinho: fica
leadCom(5, { origin: "import", outreachStatus: "skipped" }, 0, 0); // descartado: fica

r = await chamarRota(faxina, {});
ok("status 200", r.status === 200, JSON.stringify(r));
ok("apagou exatamente 2", corpo(r).apagados === 2, JSON.stringify(r.body));

const idsRestantes = state.leads.map((l: any) => l.id).sort();
ok("sobraram 3, 4 e 5", JSON.stringify(idsRestantes) === JSON.stringify([3, 4, 5]), JSON.stringify(idsRestantes));
ok("quem já foi abordado ficou", state.leads.some((l: any) => l.id === 3));
ok("quem chegou pelo WhatsApp ficou", state.leads.some((l: any) => l.id === 4));

secao("a faxina também não deixa órfão");
ok("sem mensagem do lead 1", !state.messages.some((m: any) => m.leadId === 1));
ok("sem mensagem do lead 2", !state.messages.some((m: any) => m.leadId === 2));
ok("sem follow-up do lead 1", !state.followUps.some((f: any) => f.leadId === 1));
ok(
  "as mensagens de quem ficou continuam",
  state.messages.filter((m: any) => m.leadId === 3).length === 4 &&
    state.messages.filter((m: any) => m.leadId === 4).length === 6,
);

secao("faxina sem nada para apagar");
state.reset();
state.nextId = 400;
leadCom(9, { origin: "whatsapp", outreachStatus: "none" }, 1, 1);
r = await chamarRota(faxina, {});
ok("apagados = 0", corpo(r).apagados === 0, JSON.stringify(r.body));
ok("nada foi tocado", state.leads.length === 1 && state.messages.length === 1 && state.followUps.length === 1);

fim();
