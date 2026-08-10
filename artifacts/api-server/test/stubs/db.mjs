/**
 * Stub do @workspace/db: guarda tudo em memória e responde as consultas que as
 * rotas fazem. Só o suficiente pra exercitar a LÓGICA da Júlia, sem Postgres.
 *
 * Cada coluna é a string do próprio nome, porque é assim que as condições do
 * stub do drizzle identificam o campo a filtrar (ver drizzle.mjs).
 */
import { casa } from "./drizzle.mjs";

export const leadsTable = {
  __t: "leads",
  id: "id",
  phone: "phone",
  status: "status",
  origin: "origin",
  outreachStatus: "outreachStatus",
  outreachSentAt: "outreachSentAt",
  funnelStage: "funnelStage",
  name: "name",
  lastMessageAt: "lastMessageAt",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

export const leadMessagesTable = {
  __t: "messages",
  id: "id",
  leadId: "leadId",
  direction: "direction",
  createdAt: "createdAt",
};

export const followUpsTable = {
  __t: "followUps",
  id: "id",
  leadId: "leadId",
  status: "status",
  scheduledAt: "scheduledAt",
};

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

function linhasDe(tabela) {
  if (tabela.__t === "leads") return state.leads;
  if (tabela.__t === "messages") return state.messages;
  return state.followUps;
}

function guardar(tabela, novas) {
  const alvo = linhasDe(tabela);
  alvo.length = 0;
  alvo.push(...novas);
}

/**
 * Builder encadeável e "thenable": aceita a mesma sequência de chamadas do
 * drizzle e só executa quando alguém dá await.
 *
 * `orderBy` é aceito mas não ordena — nenhum teste depende da ordem, e
 * ordenar de verdade exigiria interpretar o tipo da coluna.
 */
function thenable(executar) {
  const b = { _cond: null, _limite: null };
  Object.assign(b, {
    from(t) {
      b._t = t;
      return b;
    },
    where(cond) {
      b._cond = cond;
      return b;
    },
    limit(n) {
      b._limite = n;
      return b;
    },
    orderBy() {
      return b;
    },
    innerJoin() {
      return b;
    },
    set(v) {
      b._v = v;
      return b;
    },
    values(v) {
      b._v = v;
      return b;
    },
    returning() {
      b._ret = true;
      return b;
    },
    then(res, rej) {
      return Promise.resolve()
        .then(() => executar(b))
        .then(res, rej);
    },
  });
  return b;
}

/** Aplica where e limit sobre uma lista de linhas. */
function filtrar(linhas, b) {
  const casadas = linhas.filter((l) => casa(l, b._cond));
  return b._limite === null ? casadas : casadas.slice(0, b._limite);
}

export const db = {
  select() {
    return thenable((b) => {
      const linhas = linhasDe(b._t);
      // O webhook pede as mensagens em ordem decrescente e inverte depois.
      const base = b._t.__t === "messages" ? linhas.slice().reverse() : linhas.slice();
      return filtrar(base, b);
    });
  },

  insert(t) {
    const b = thenable(() => {
      const novas = Array.isArray(b._v) ? b._v : [b._v];
      const salvas = novas.map((r) => ({
        id: state.nextId++,
        createdAt: new Date(),
        ...r,
      }));
      linhasDe(t).push(...salvas);
      return b._ret ? salvas : undefined;
    });
    return b;
  },

  update(t) {
    const b = thenable(() => {
      const alvo = linhasDe(t);
      const alteradas = [];
      for (const linha of alvo) {
        if (casa(linha, b._cond)) {
          Object.assign(linha, b._v);
          alteradas.push(linha);
        }
      }
      return b._ret ? alteradas : undefined;
    });
    return b;
  },

  delete(t) {
    const b = thenable(() => {
      const alvo = linhasDe(t);
      const apagadas = alvo.filter((l) => casa(l, b._cond));
      guardar(
        t,
        alvo.filter((l) => !casa(l, b._cond)),
      );
      return b._ret ? apagadas : undefined;
    });
    return b;
  },
};
