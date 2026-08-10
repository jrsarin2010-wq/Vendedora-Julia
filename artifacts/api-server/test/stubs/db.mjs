/**
 * Stub do @workspace/db: guarda tudo em memória e responde as consultas que o
 * webhook faz. Só o suficiente pra exercitar o fluxo real do handler, sem
 * Postgres nenhum — o objetivo é testar a LÓGICA da Júlia, não o drizzle.
 */
export const leadsTable = { __t: "leads", id: "id", phone: "phone" };
export const leadMessagesTable = { __t: "messages", leadId: "leadId", createdAt: "createdAt" };
export const followUpsTable = { __t: "followUps", leadId: "leadId", status: "status", id: "id" };

export const state = {
  leads: [],
  messages: [],
  followUps: [],
  nextId: 1,
  reset() {
    this.leads = [];
    this.messages = [];
    this.followUps = [];
    this.nextId = 1;
  },
};

function rowsOf(table) {
  if (table.__t === "leads") return state.leads;
  if (table.__t === "messages") return state.messages;
  return state.followUps;
}

// Builder encadeável e "thenable": aceita a mesma sequência de chamadas do
// drizzle (.from().where().limit()) e só executa quando alguém dá await.
function thenable(fn) {
  const b = {
    from(t) { b._t = t; return b; },
    where() { return b; },
    limit() { return b; },
    orderBy() { return b; },
    innerJoin() { return b; },
    set(v) { b._v = v; return b; },
    values(v) { b._v = v; return b; },
    returning() { b._ret = true; return b; },
    then(res, rej) { return Promise.resolve().then(() => fn(b)).then(res, rej); },
  };
  return b;
}

export const db = {
  select() {
    return thenable((b) => {
      if (b._t.__t === "leads") return state.leads.slice();
      // O webhook pede as mensagens em ordem decrescente e inverte depois.
      if (b._t.__t === "messages") return state.messages.slice().reverse();
      return state.followUps.slice();
    });
  },
  insert(t) {
    const b = thenable(() => {
      const rows = Array.isArray(b._v) ? b._v : [b._v];
      const saved = rows.map((r) => ({ id: state.nextId++, createdAt: new Date(), ...r }));
      rowsOf(t).push(...saved);
      return b._ret ? saved : undefined;
    });
    return b;
  },
  update(t) {
    const b = thenable(() => {
      for (const r of rowsOf(t)) Object.assign(r, b._v);
      return undefined;
    });
    return b;
  },
};
