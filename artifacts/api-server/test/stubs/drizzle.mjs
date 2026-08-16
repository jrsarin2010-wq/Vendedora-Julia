/**
 * Stub do drizzle-orm.
 *
 * As condições devolvem uma ESTRUTURA descrevendo o filtro, em vez de um
 * objeto opaco. É isso que permite ao stub do banco aplicar o `where` de
 * verdade — sem isso, um teste de "apagar o lead não deixa mensagem órfã"
 * passaria mesmo com a rota apagando tudo, ou nada.
 *
 * A primeira posição de cada condição é o NOME da coluna: nas tabelas do stub
 * cada coluna é a própria string do seu nome (ver db.mjs).
 */
export const eq = (col, val) => ({ tipo: "eq", col, val });
export const inArray = (col, vals) => ({ tipo: "inArray", col, vals });
export const isNotNull = (col) => ({ tipo: "isNotNull", col });
export const isNull = (col) => ({ tipo: "isNull", col });
export const gte = (col, val) => ({ tipo: "gte", col, val });
export const lte = (col, val) => ({ tipo: "lte", col, val });
export const ilike = (col, val) => ({ tipo: "ilike", col, val });
export const and = (...conds) => ({ tipo: "and", conds });
export const or = (...conds) => ({ tipo: "or", conds });

// Ordenação e SQL cru não afetam quais linhas casam.
export const desc = (col) => ({ tipo: "ordem", col, dir: "desc" });
export const asc = (col) => ({ tipo: "ordem", col, dir: "asc" });
export const sql = () => ({ tipo: "sql" });

/** Uma linha casa com a condição? Condição desconhecida não filtra nada. */
export function casa(linha, cond) {
  if (!cond || typeof cond !== "object") return true;
  const valor = linha[cond.col];
  switch (cond.tipo) {
    case "eq":
      return valor === cond.val;
    case "inArray":
      return Array.isArray(cond.vals) && cond.vals.includes(valor);
    case "isNotNull":
      return valor !== null && valor !== undefined;
    // Coluna ausente do fixture conta como NULL, como no Postgres: o teste não
    // precisa escrever `nota: null` em toda linha para dizer "não tem nota".
    case "isNull":
      return valor === null || valor === undefined;
    case "gte":
      return valor instanceof Date && cond.val instanceof Date
        ? valor.getTime() >= cond.val.getTime()
        : valor >= cond.val;
    case "lte":
      return valor instanceof Date && cond.val instanceof Date
        ? valor.getTime() <= cond.val.getTime()
        : valor <= cond.val;
    case "ilike":
      return String(valor ?? "")
        .toLowerCase()
        .includes(String(cond.val ?? "").replace(/%/g, "").toLowerCase());
    case "and":
      return cond.conds.every((c) => casa(linha, c));
    case "or":
      return cond.conds.some((c) => casa(linha, c));
    default:
      return true;
  }
}
