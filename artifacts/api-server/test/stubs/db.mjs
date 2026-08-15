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
  duvidaDoSite: "duvidaDoSite",
  outreachStatus: "outreachStatus",
  outreachSentAt: "outreachSentAt",
  funnelStage: "funnelStage",
  name: "name",
  lastMessageAt: "lastMessageAt",
  pausedUntil: "pausedUntil",
  handoffRequested: "handoffRequested",
  atencao: "atencao",
  atencaoDesde: "atencaoDesde",
  atencaoDetalhe: "atencaoDetalhe",
  notes: "notes",
  painPoints: "painPoints",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

export const leadMessagesTable = {
  __t: "messages",
  id: "id",
  leadId: "leadId",
  direction: "direction",
  content: "content",
  messageType: "messageType",
  createdAt: "createdAt",
};

export const followUpsTable = {
  __t: "followUps",
  id: "id",
  leadId: "leadId",
  status: "status",
  scheduledAt: "scheduledAt",
  touchNumber: "touchNumber",
  kind: "kind",
  messageTemplate: "messageTemplate",
  sentAt: "sentAt",
};

export const apifyVarredurasTable = {
  __t: "varreduras",
  id: "id",
  termoBusca: "termoBusca",
  cidade: "cidade",
  uf: "uf",
  maxResultados: "maxResultados",
  prioridade: "prioridade",
  status: "status",
  apifyRunId: "apifyRunId",
  apifyDatasetId: "apifyDatasetId",
  resultadosRecebidos: "resultadosRecebidos",
  custoRealUsd: "custoRealUsd",
  tentativas: "tentativas",
  erroMensagem: "erroMensagem",
  disparadaEm: "disparadaEm",
  concluidaEm: "concluidaEm",
  criadaEm: "criadaEm",
};

export const clinicasProspectTable = {
  __t: "clinicas",
  id: "id",
  placeId: "placeId",
  nome: "nome",
  telefoneRaw: "telefoneRaw",
  telefoneWhatsapp: "telefoneWhatsapp",
  temWhatsapp: "temWhatsapp",
  verificadoWhatsappEm: "verificadoWhatsappEm",
  website: "website",
  instagram: "instagram",
  endereco: "endereco",
  cidade: "cidade",
  uf: "uf",
  bairro: "bairro",
  cep: "cep",
  categoria: "categoria",
  nota: "nota",
  totalAvaliacoes: "totalAvaliacoes",
  latitude: "latitude",
  longitude: "longitude",
  perfilReivindicado: "perfilReivindicado",
  varreduraId: "varreduraId",
  leadId: "leadId",
  statusProspeccao: "statusProspeccao",
  criadoEm: "criadoEm",
  atualizadoEm: "atualizadoEm",
};

export const configuracoesTable = {
  __t: "configuracoes",
  chave: "chave",
  valor: "valor",
  atualizadoEm: "atualizadoEm",
};

export const state = {
  leads: [],
  messages: [],
  followUps: [],
  varreduras: [],
  clinicas: [],
  configuracoes: [],
  nextId: 1,
  reset() {
    this.leads = [];
    this.messages = [];
    this.followUps = [];
    this.varreduras = [];
    this.clinicas = [];
    this.configuracoes = [];
    this.nextId = 1;
  },
};

function linhasDe(tabela) {
  if (tabela.__t === "leads") return state.leads;
  if (tabela.__t === "messages") return state.messages;
  if (tabela.__t === "varreduras") return state.varreduras;
  if (tabela.__t === "clinicas") return state.clinicas;
  if (tabela.__t === "configuracoes") return state.configuracoes;
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
  const b = { _cond: null, _limite: null, _offset: 0 };
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
    // Paginação de verdade: a rota de prospects usa limit + offset, e sem isto
    // o bundle do teste quebraria em "b.offset is not a function".
    offset(n) {
      b._offset = n ?? 0;
      return b;
    },
    orderBy() {
      return b;
    },
    // Aceito e ignorado, como o orderBy: nenhum teste depende do agregado, mas
    // a rota de listagem usa GROUP BY e não pode quebrar o bundle.
    groupBy() {
      return b;
    },
    innerJoin(tabela, cond) {
      b._join = { tabela, cond };
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
    // Como nas tabelas do stub cada coluna é a string do próprio nome, o
    // `target` já chega como a lista de chaves a comparar.
    onConflictDoNothing(opts) {
      const alvo = opts?.target ?? null;
      // O drizzle aceita uma coluna só ou uma lista; aqui vira sempre lista.
      b._conflito = alvo === null ? null : Array.isArray(alvo) ? alvo : [alvo];
      return b;
    },
    // Upsert: a linha que já existe é ATUALIZADA com `set`, em vez de
    // descartada. É o que a gravação de configuração usa.
    onConflictDoUpdate(opts) {
      const alvo = opts?.target ?? null;
      b._conflito = alvo === null ? null : Array.isArray(alvo) ? alvo : [alvo];
      b._atualizarNoConflito = opts?.set ?? {};
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

/** Aplica where, offset e limit sobre uma lista de linhas — nesta ordem. */
function filtrar(linhas, b) {
  const casadas = linhas.filter((l) => casa(l, b._cond));
  const apos = b._offset ? casadas.slice(b._offset) : casadas;
  return b._limite === null ? apos : apos.slice(0, b._limite);
}

/**
 * A projeção é um `count(*)`? No stub do drizzle, `sql` devolve
 * `{ tipo: "sql" }`, então é isso que distingue
 * `select({ count: sql`count(*)` })` de `select({ phone: leadsTable.phone })`,
 * que é projeção de colunas e continua devolvendo as linhas cruas.
 */
function projecaoDeContagem(projecao) {
  if (!projecao) return null;
  const chaves = Object.entries(projecao);
  if (chaves.length === 0) return null;
  return chaves.every(([, v]) => v?.tipo === "sql") ? chaves.map(([k]) => k) : null;
}

export const db = {
  /**
   * `projecao` só é usada quando há `innerJoin` — é o
   * `select({ followUp: followUpsTable, lead: leadsTable })` do agendador de
   * follow-ups. Sem ela o retorno continua sendo a lista de linhas cruas, que
   * é o que todo o resto do código espera.
   */
  select(projecao) {
    return thenable((b) => {
      const linhas = linhasDe(b._t);
      // O webhook pede as mensagens em ordem decrescente e inverte depois.
      const base = b._t.__t === "messages" ? linhas.slice().reverse() : linhas.slice();
      const casadas = filtrar(base, b);

      // count(*): devolve UMA linha com o total, como o Postgres. Sem isto,
      // `total` na resposta paginada seria sempre 0 no teste — e o teste
      // passaria enquanto a paginação real estivesse quebrada.
      const contagem = projecaoDeContagem(projecao);
      if (contagem) {
        return [Object.fromEntries(contagem.map((k) => [k, casadas.length]))];
      }

      if (!b._join || !projecao) return casadas;

      // A condição do join vem como { col, val }, e nas tabelas do stub cada
      // coluna é a string do próprio nome — então `col` é a coluna da tabela
      // base e `val` a da tabela juntada. `eq(followUps.leadId, leads.id)`
      // vira { col: "leadId", val: "id" }.
      const { tabela, cond } = b._join;
      const outras = linhasDe(tabela);
      const juntadas = [];
      for (const linha of casadas) {
        const par = outras.find((o) => o[cond.val] === linha[cond.col]);
        if (!par) continue; // innerJoin: sem par, a linha some
        const registro = {};
        for (const [chave, t] of Object.entries(projecao)) {
          registro[chave] = t.__t === tabela.__t ? par : linha;
        }
        juntadas.push(registro);
      }
      return juntadas;
    });
  },

  insert(t) {
    const b = thenable(() => {
      const existentes = linhasDe(t);
      let novas = Array.isArray(b._v) ? b._v : [b._v];
      // ON CONFLICT DO NOTHING: linha cujo alvo já existe é descartada em
      // silêncio, e `returning` devolve só o que entrou — igual ao Postgres.
      // Com DO UPDATE, a que já existe é atualizada antes de sair da lista.
      if (b._conflito) {
        novas = novas.filter((r) => {
          const conflitante = existentes.find((e) =>
            b._conflito.every((c) => e[c] === r[c]),
          );
          if (!conflitante) return true;
          if (b._atualizarNoConflito) {
            Object.assign(conflitante, b._atualizarNoConflito);
          }
          return false;
        });
      }
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
