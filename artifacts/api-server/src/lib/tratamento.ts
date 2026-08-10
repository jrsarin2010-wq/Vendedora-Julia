/**
 * TRATAMENTO — Dr. ou Dra.?
 *
 * Descobre o gênero pelo primeiro nome pra Júlia escrever "Dr. Carlos" ou
 * "Dra. Marina" — nunca o horrível "Dr(a). Fulano", que soa a formulário.
 *
 * Quando o nome é genuinamente ambíguo (Alex, Darci), NÃO chutamos: a saída é
 * tratar pelo nome puro ("Oi, Alex!"), que soa natural e não erra.
 */

/** Nomes femininos que NÃO terminam em -a (a regra sozinha erraria). */
const FEMININOS_EXCECAO = new Set([
  "michele", "michelle", "raquel", "rachel", "isabel", "isabelle", "beatriz",
  "ester", "esther", "ines", "inês", "iris", "íris", "lais", "laís", "eliane",
  "adriane", "cristiane", "luciane", "rosane", "simone", "ivone", "leone",
  "sueli", "eli", "noemi", "noemia", "miriam", "myriam", "carmen", "carmem",
  "ingrid", "astrid", "heloise", "eloise", "denise", "elise", "louise",
  "jaqueline", "jacqueline", "caroline", "karoline", "evelin", "evelyn",
  "kelly", "kelli", "shirley", "wesley", "nathaly", "nataly", "hellen",
  "helen", "ellen", "gisele", "giselle", "gabriele", "gabrielle", "danielle",
  "estefani", "stefani", "jennifer", "jenifer", "jussara", "solange",
  "marlene", "irene", "helene", "yasmin", "iasmin", "karin", "karen",
  "sharon", "doris", "lourdes", "mercedes", "consuelo", "eunice", "berenice",
  "clarice", "alice", "ruth", "judith", "edith", "liz", "lis", "mari",
]);

/** Nomes masculinos terminados em -a (a regra sozinha erraria). */
const MASCULINOS_EXCECAO = new Set([
  "joshua", "josua", "elias", "matias", "mathias", "tobias", "zacarias",
  "jeremias", "isaias", "isaías", "farias", "cauã", "caua", "juca", "nica",
  "sacha", "kenma", "aya", "luca", "lucca", "noa", "nicola", "andrea",
  "andréa", "jean-luca", "gerbera", "duda", "iuri",
  // Masculinos em -e que a regra de terminação classificaria como femininos
  // por conterem "i" (ver o teste de /(ce|ne|se|te|le)$/ mais abaixo).
  "vicente", "vicenzo", "aristide", "deusdedite", "higino", "ubirajara",
]);

/** Nomes usados por homens e mulheres — não dá pra decidir com segurança. */
const AMBIGUOS = new Set([
  "alex", "ariel", "darci", "darcy", "dani", "eli", "jaci", "jacy", "juca",
  "lou", "mel", "nicola", "rene", "rené", "renê", "robin", "sam", "sasha",
  "sacha", "val", "vania", "yuri", "iuri", "andrea", "andréa", "cris",
  "chris", "jean", "kim", "lee", "mika", "nikita", "noa", "remy", "riley",
  "sidney", "sydney", "tal", "tay", "toni", "tony",
]);

export type Tratamento = "dr" | "dra" | "neutro";

/** Normaliza: minúsculo, sem acento, só o primeiro nome. */
function normalizar(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)[0]
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Decide o tratamento a partir do primeiro nome.
 * Retorna "neutro" quando não dá pra saber com segurança.
 */
export function detectarTratamento(nomeCompleto: string | null): Tratamento {
  if (!nomeCompleto || !nomeCompleto.trim()) return "neutro";

  const nome = normalizar(nomeCompleto);
  if (nome.length < 2) return "neutro";

  // 1) Ambíguo vence tudo: melhor não arriscar.
  if (AMBIGUOS.has(nome)) return "neutro";

  // 2) Exceções conhecidas.
  if (FEMININOS_EXCECAO.has(nome)) return "dra";
  if (MASCULINOS_EXCECAO.has(nome)) return "dr";

  // 3) Regra por terminação (funciona bem para nomes brasileiros).
  if (/a$/.test(nome)) return "dra";           // Marina, Paula, Fernanda
  if (/(o|r|l|u|s|z|n|m|e)$/.test(nome)) {
    // -e é traiçoeiro (Felipe = h, Michele = m) — já tratado nas exceções acima.
    if (/e$/.test(nome)) {
      // terminações femininas comuns em -e não pegas pelas exceções
      if (/(ce|ne|se|te|le)$/.test(nome) && /^(.*(i|y))/.test(nome)) return "dra";
      return "dr";
    }
    return "dr";                                // Carlos, Renato, Gabriel, Vitor
  }
  if (/i$/.test(nome)) return "neutro";        // Yuri, Jaci... arriscado

  return "neutro";
}

/**
 * Monta a saudação com o tratamento certo.
 * - "dr"     → "Dr. Carlos, "
 * - "dra"    → "Dra. Marina, "
 * - "neutro" → "Alex, "   (usa só o nome, sem errar o gênero)
 * - sem nome → ""         (a mensagem começa sem vocativo)
 */
export function saudacao(nomeCompleto: string | null): string {
  if (!nomeCompleto || !nomeCompleto.trim()) return "";
  const primeiro = nomeCompleto.trim().split(/\s+/)[0];
  const capitalizado = primeiro.charAt(0).toUpperCase() + primeiro.slice(1);

  switch (detectarTratamento(nomeCompleto)) {
    case "dr":
      return `Dr. ${capitalizado}, `;
    case "dra":
      return `Dra. ${capitalizado}, `;
    default:
      return `${capitalizado}, `;
  }
}
