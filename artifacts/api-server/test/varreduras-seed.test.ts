/**
 * Etapa 1 da varredura Apify — seed idempotente das 54 rodadas.
 *
 * A propriedade que importa: rodar o seed duas vezes (ou depois de a fila já
 * ter andado) NUNCA duplica varredura. Disparo duplicado da mesma combinação
 * é o erro mais caro do pipeline — paga o ator de novo pelas mesmas clínicas.
 */
import { ok, secao, fim } from "./assert";
import { handlerDe, chamarRota } from "./rota";
import seedRouter from "../src/routes/varreduras-seed";
import { state } from "./stubs/db.mjs";

const handler = handlerDe(seedRouter);

interface Resumo {
  total: number;
  inseridas: number;
  jaExistiam: number;
}

interface Varredura {
  termoBusca: string;
  cidade: string;
  uf: string;
  prioridade: number;
}

const varreduras = () => state.varreduras as Varredura[];

secao("primeira chamada — as 54 combinações entram");
state.reset();
let r = await chamarRota(handler, {});
ok("status 200", r.status === 200, JSON.stringify(r.body));
let resumo = r.body as Resumo;
ok("total = 54", resumo.total === 54, JSON.stringify(resumo));
ok("54 inseridas", resumo.inseridas === 54, JSON.stringify(resumo));
ok("0 já existiam", resumo.jaExistiam === 0, JSON.stringify(resumo));
ok("54 no banco", varreduras().length === 54);

secao("composição da fila");
const combos = new Set(
  varreduras().map((v) => `${v.termoBusca}|${v.cidade}|${v.uf}`),
);
ok("nenhuma combinação repetida", combos.size === 54);
const termos = new Set(varreduras().map((v) => v.termoBusca));
ok(
  "exatamente os 2 termos decididos",
  termos.size === 2 && termos.has("dentista") && termos.has("clínica odontológica"),
  [...termos].join(", "),
);
ok(
  "27 cidades por termo",
  varreduras().filter((v) => v.termoBusca === "dentista").length === 27,
);
ok(
  "20 com prioridade 1 (10 maiores mercados × 2 termos)",
  varreduras().filter((v) => v.prioridade === 1).length === 20,
);
ok(
  "34 com prioridade 2 (17 capitais × 2 termos)",
  varreduras().filter((v) => v.prioridade === 2).length === 34,
);
ok(
  "toda UF tem 2 letras maiúsculas",
  varreduras().every((v) => /^[A-Z]{2}$/.test(v.uf)),
);
ok(
  "São Paulo é prioridade 1",
  varreduras().some((v) => v.cidade === "São Paulo" && v.uf === "SP" && v.prioridade === 1),
);
ok(
  "Palmas é prioridade 2",
  varreduras().some((v) => v.cidade === "Palmas" && v.uf === "TO" && v.prioridade === 2),
);

secao("segunda chamada — idempotente, nada duplica");
r = await chamarRota(handler, {});
resumo = r.body as Resumo;
ok("status 200", r.status === 200);
ok("0 inseridas", resumo.inseridas === 0, JSON.stringify(resumo));
ok("54 já existiam", resumo.jaExistiam === 54, JSON.stringify(resumo));
ok("banco continua com 54", varreduras().length === 54);

secao("fila que já andou — o seed só completa o que falta");
state.reset();
// Uma varredura pré-existente, já concluída: o seed não pode recriá-la nem
// mexer nela.
state.varreduras.push({
  id: state.nextId++,
  termoBusca: "dentista",
  cidade: "São Paulo",
  uf: "SP",
  prioridade: 1,
  status: "concluida",
});
r = await chamarRota(handler, {});
resumo = r.body as Resumo;
ok("53 inseridas", resumo.inseridas === 53, JSON.stringify(resumo));
ok("1 já existia", resumo.jaExistiam === 1, JSON.stringify(resumo));
ok("54 no banco", varreduras().length === 54);
const preExistente = varreduras().find(
  (v) => v.termoBusca === "dentista" && v.cidade === "São Paulo",
) as Varredura & { status?: string };
ok("a concluída NÃO foi tocada", preExistente?.status === "concluida");

fim();
