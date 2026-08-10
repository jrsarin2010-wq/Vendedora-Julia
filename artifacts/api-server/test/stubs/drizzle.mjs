/**
 * Stub do drizzle-orm. O stub do banco ignora as condições, então estas
 * funções só precisam existir e devolver algo inofensivo.
 */
export const eq = (a, b) => ({ eq: [a, b] });
export const desc = (a) => ({ desc: a });
export const and = (...xs) => ({ and: xs });
export const lte = (a, b) => ({ lte: [a, b] });
export const inArray = (a, b) => ({ inArray: [a, b] });
export const ilike = (a, b) => ({ ilike: [a, b] });
export const or = (...xs) => ({ or: xs });
export const sql = () => ({ sql: true });
