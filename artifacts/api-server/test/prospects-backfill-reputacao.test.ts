/**
 * BACKFILL DA REPUTAÇÃO — POST /api/prospects/backfill-reputacao.
 *
 * É escrita manual em dado de produção, então o que este arquivo protege, em
 * ordem de gravidade se quebrar:
 *
 *   1. O DRY-RUN NÃO ESCREVE. É o modo padrão, e é o que alguém lê antes de
 *      autorizar. Se ele escrevesse, a autorização viraria teatro.
 *   2. NUNCA SOBRESCREVE. Lead que já tem reputação não é tocado — inclusive
 *      quando só UMA das duas colunas está preenchida, que é o estado meio
 *      gravado de onde sai o pior tipo de dado: metade novo, metade velho.
 *   3. SÓ `promovido`. Prospect `ja_existente` também carrega lead_id, mas
 *      aquele lead veio de planilha ou do WhatsApp e pode ser um opt-out.
 *   4. A TRAVA DA FICHA NÃO FILTRA A ESCRITA. Nota reprovada é gravada do
 *      mesmo jeito: a coluna guarda o fato, julia-persona.ts decide se cita.
 */
import { ok, secao, fim } from "./assert";
import { handlerDe, chamarRota, type RespostaFake } from "./rota";
import backfillRouter from "../src/routes/prospects-backfill-reputacao";
import { state } from "./stubs/db.mjs";

const backfill = handlerDe(backfillRouter);

interface Item {
  leadId: number;
  clinica: string | null;
  cidade: string | null;
  prospectId: number;
  nota: string | null;
  totalAvaliacoes: number | null;
  citavelNaFicha: boolean;
}
interface Resposta {
  modo: string;
  cidade: string | null;
  total: number;
  aAtualizar: Item[];
  aplicadas: number;
  falhas?: { leadId: number; motivo: string }[];
}

/** Um lead promovido, do jeito que a Etapa 3C o deixava ANTES das colunas. */
function lead(campos: Record<string, unknown> = {}) {
  const linha = {
    id: state.nextId++,
    phone: `55859${state.nextId}`,
    name: null,
    clinicName: "Odonto Vida",
    city: "Fortaleza",
    instagram: null,
    origin: "maps",
    nota: null,
    totalAvaliacoes: null,
    ...campos,
  };
  state.leads.push(linha);
  return linha;
}

/** A clínica captada, com reputação, já promovida e apontando para o lead. */
function prospect(leadId: number | null, campos: Record<string, unknown> = {}) {
  const linha = {
    id: state.nextId++,
    placeId: `place-${state.nextId}`,
    nome: "Odonto Vida",
    cidade: "Fortaleza",
    uf: "CE",
    nota: "4.8",
    totalAvaliacoes: 137,
    leadId,
    statusProspeccao: "promovido",
    ...campos,
  };
  state.clinicas.push(linha);
  return linha;
}

const corpo = (r: RespostaFake) => r.body as Resposta;
const chamar = (body: unknown = {}) => chamarRota(backfill, { body });

// ---------------------------------------------------------------------------
secao("dry-run é o padrão, e NÃO escreve");
state.reset();
const l1 = lead();
prospect(l1.id);

let r = await chamar({});
ok("modo padrão é dry-run", corpo(r).modo === "dry-run", corpo(r).modo);
ok("achou o lead", corpo(r).total === 1, JSON.stringify(corpo(r).aAtualizar));
ok("aplicadas = 0", corpo(r).aplicadas === 0);
ok(
  "e o lead continua SEM reputação no banco",
  state.leads[0].nota === null && state.leads[0].totalAvaliacoes === null,
);
ok(
  "o relatório traz nota, avaliações e o prospect de origem",
  corpo(r).aAtualizar[0]!.nota === "4.8" &&
    corpo(r).aAtualizar[0]!.totalAvaliacoes === 137 &&
    corpo(r).aAtualizar[0]!.prospectId === state.clinicas[0].id,
);
ok(
  "e diz se passaria na trava da ficha",
  corpo(r).aAtualizar[0]!.citavelNaFicha === true,
);

secao("aplicar grava — e o plano é o mesmo que o dry-run mostrou");
r = await chamar({ modo: "aplicar" });
ok("aplicadas = 1", corpo(r).aplicadas === 1);
ok(
  "o lead recebeu os dois campos",
  state.leads[0].nota === "4.8" && state.leads[0].totalAvaliacoes === 137,
);
ok("sem falhas", (corpo(r).falhas ?? []).length === 0);

secao("idempotente — a segunda passada não acha mais ninguém");
r = await chamar({ modo: "aplicar" });
ok("nada a fazer", corpo(r).total === 0 && corpo(r).aplicadas === 0);

// ---------------------------------------------------------------------------
secao("NUNCA sobrescreve quem já tem dado");
state.reset();
const jaTem = lead({ nota: "3.9", totalAvaliacoes: 11 });
prospect(jaTem.id, { nota: "4.9", totalAvaliacoes: 900 });

r = await chamar({ modo: "aplicar" });
ok("não entra no plano", corpo(r).total === 0, JSON.stringify(corpo(r).aAtualizar));
ok(
  "e o dado dele fica intacto",
  state.leads[0].nota === "3.9" && state.leads[0].totalAvaliacoes === 11,
);

secao("meio preenchido também é intocável (uma coluna só não é 'sem dado')");
state.reset();
const meio = lead({ nota: "4.4", totalAvaliacoes: null });
prospect(meio.id);
r = await chamar({ modo: "aplicar" });
ok("fica de fora do plano", corpo(r).total === 0);
ok("e a nota que estava lá não muda", state.leads[0].nota === "4.4");

// ---------------------------------------------------------------------------
secao("só statusProspeccao = 'promovido'");
state.reset();
const deOutraOrigem = lead();
prospect(deOutraOrigem.id, { statusProspeccao: "ja_existente" });
r = await chamar({ modo: "aplicar" });
ok(
  "prospect 'ja_existente' NÃO doa reputação — o lead dele veio de outro lugar",
  corpo(r).total === 0 && state.leads[0].nota === null,
);

secao("prospect sem reputação não gera trabalho");
state.reset();
const semDoacao = lead();
prospect(semDoacao.id, { nota: null, totalAvaliacoes: null });
r = await chamar({});
ok("plano vazio", corpo(r).total === 0);

// ---------------------------------------------------------------------------
secao("a trava da ficha NÃO filtra a escrita — só informa");
state.reset();
const ruim = lead();
prospect(ruim.id, { nota: "3.2", totalAvaliacoes: 400 });

r = await chamar({ modo: "aplicar" });
ok("a nota reprovada É gravada", state.leads[0].nota === "3.2");
ok(
  "mas o relatório marca que a ficha não vai citar",
  corpo(r).aAtualizar[0]!.citavelNaFicha === false,
);

secao("nota alta com pouca avaliação: grava, e avisa que não cita");
state.reset();
const poucas = lead();
prospect(poucas.id, { nota: "5.0", totalAvaliacoes: 3 });
r = await chamar({ modo: "aplicar" });
ok("gravou", state.leads[0].totalAvaliacoes === 3);
ok("não citável", corpo(r).aAtualizar[0]!.citavelNaFicha === false);

// ---------------------------------------------------------------------------
secao("filtro de cidade");
state.reset();
const forta = lead({ city: "Fortaleza", clinicName: "Odonto Vida" });
const sampa = lead({ city: "São Paulo", clinicName: "Sorriso SP" });
prospect(forta.id);
prospect(sampa.id);

r = await chamar({ cidade: "Fortaleza" });
ok("só o de Fortaleza entra", corpo(r).total === 1, JSON.stringify(corpo(r).aAtualizar));
ok("e é o lead certo", corpo(r).aAtualizar[0]!.leadId === forta.id);
ok("a cidade volta no relatório", corpo(r).cidade === "Fortaleza");

r = await chamar({});
ok("sem filtro, os dois entram", corpo(r).total === 2);

r = await chamar({ cidade: "   " });
ok(
  "cidade em branco é 'sem filtro', não um ilike que casa com todos por acidente",
  corpo(r).cidade === null && corpo(r).total === 2,
);

// ---------------------------------------------------------------------------
secao("modo inválido é recusado antes de qualquer leitura");
state.reset();
const x = lead();
prospect(x.id);
r = await chamar({ modo: "aplicar-tudo" });
ok("responde 400", r.status === 400, String(r.status));
ok("nada foi escrito", state.leads[0].nota === null);

fim();
