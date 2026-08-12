/**
 * ANÁLISE DO PROMPT — o que pesa, o que está repetido, o que está travado.
 *
 *   node scripts/analisar-prompt.mjs
 *
 * Rode ISTO antes de aumentar o TETO_DE_TOKENS (julia-persona.ts). O teto
 * existe para o prompt não voltar a crescer sem ninguém perceber: entre as
 * Rodadas 40 e 42 ele engordou 8,6% sem que nenhuma delas fosse "sobre o
 * prompt". Aumentar o teto sem olhar o que engordou é como desligar o alarme.
 *
 * POR QUE TOKEN IMPORTA (Rodada 43/44): o limite da conta na OpenAI é por
 * MINUTO (TPM), e cada resposta paga o prompt inteiro. Com ~200 mil tokens por
 * minuto e ~15 mil por resposta, o teto é de aproximadamente doze respostas
 * simultâneas — e uma rajada de dentistas respondendo junto estoura isso.
 *
 * Só mede. Não altera nada.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");
const CRASE = String.fromCharCode(96);
const BARRA = String.fromCharCode(92);

/**
 * Caracteres por token, calibrado contra medição REAL de produção: o erro 429
 * de 12/08/2026 reportou "Requested 15519" para uma resposta feita com o prompt
 * do commit 591fcdc (55.107 caracteres). Descontando o teto de saída (512) e
 * uma folga para ficha e histórico, dá 3,85 — bem melhor que os 3,3 que um
 * chute para português produziria.
 */
export const CHARS_POR_TOKEN = 3.85;

const ler = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

export function extrairPrompt(nome = "JULIA_SYSTEM_PROMPT") {
  const src = ler(path.join(RAIZ, "src/julia-persona.ts"));
  const i = src.indexOf(`export const ${nome} = ${CRASE}`);
  if (i < 0) throw new Error(`${nome} não encontrado`);
  const ini = src.indexOf(CRASE, i) + 1;
  let j = ini;
  while (j < src.length) {
    if (src[j] === CRASE && src[j - 1] !== BARRA) break;
    j++;
  }
  return src.slice(ini, j);
}

export const emTokens = (t) => Math.round(t.length / CHARS_POR_TOKEN);

// `pathToFileURL` e não uma string montada à mão: no Windows o caminho vira
// file:///C:/... com TRÊS barras, e a comparação ingênua nunca casa — o script
// rodava e não imprimia nada.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prompt = extrairPrompt();

  // ── Seções, da maior para a menor ─────────────────────────────────────────
  const secoes = [];
  let atual = { titulo: "(abertura)", linhas: [] };
  for (const l of prompt.split("\n")) {
    if (/^## /.test(l)) {
      secoes.push(atual);
      atual = { titulo: l.replace(/^## /, "").trim(), linhas: [] };
    }
    atual.linhas.push(l);
  }
  secoes.push(atual);
  for (const s of secoes) {
    s.texto = s.linhas.join("\n");
    s.exemplos = s.linhas.filter((l) => /^\s*[-*]?\s*"/.test(l)).length;
  }

  console.log(`PROMPT: ${prompt.length} chars ≈ ${emTokens(prompt)} tokens\n`);
  console.log("  tokens     %  exemplos  seção");
  for (const s of [...secoes].sort((a, b) => b.texto.length - a.texto.length)) {
    console.log(
      `  ${String(emTokens(s.texto)).padStart(6)}  ${((s.texto.length / prompt.length) * 100).toFixed(1).padStart(4)}%  ${String(s.exemplos).padStart(8)}  ${s.titulo.slice(0, 60)}`,
    );
  }

  // ── Quanto é exemplo de fala ──────────────────────────────────────────────
  const charsExemplo = prompt
    .split("\n")
    .filter((l) => /^\s*[-*]?\s*"/.test(l))
    .reduce((a, l) => a + l.length + 1, 0);
  console.log(
    `\nExemplos de fala: ${Math.round(charsExemplo / CHARS_POR_TOKEN)} tokens (${((charsExemplo / prompt.length) * 100).toFixed(1)}% do prompt)`,
  );

  // ── Redundância entre seções ──────────────────────────────────────────────
  const normalizar = (t) =>
    t
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const N = 7;
  const onde = new Map();
  secoes.forEach((s, i) => {
    const p = normalizar(s.texto).split(" ");
    for (let k = 0; k + N <= p.length; k++) {
      const chave = p.slice(k, k + N).join(" ");
      if (!onde.has(chave)) onde.set(chave, new Set());
      onde.get(chave).add(i);
    }
  });
  const pares = new Map();
  for (const [chave, idxs] of onde) {
    if (idxs.size < 2) continue;
    const l = [...idxs].sort((a, b) => a - b);
    for (let a = 0; a < l.length; a++)
      for (let b = a + 1; b < l.length; b++) {
        const k = `${l[a]}|${l[b]}`;
        if (!pares.has(k)) pares.set(k, []);
        pares.get(k).push(chave);
      }
  }
  console.log(`\nREDUNDÂNCIA — trechos de ${N}+ palavras em duas seções:`);
  const top = [...pares.entries()]
    .map(([k, t]) => {
      const u = [];
      for (const x of t.sort()) if (!u.some((y) => y.includes(x.slice(0, 30)))) u.push(x);
      return { k, u };
    })
    .sort((a, b) => b.u.length - a.u.length)
    .slice(0, 8);
  for (const { k, u } of top) {
    const [a, b] = k.split("|").map(Number);
    console.log(`  ${u.length}×  ${secoes[a].titulo.slice(0, 40)} ↔ ${secoes[b].titulo.slice(0, 40)}`);
    console.log(`        "…${u[0]}…"`);
  }

  // ── O que está travado por asserção ───────────────────────────────────────
  const literais = [];
  for (const arq of ["julia-persona.test.ts", "landing.test.ts"]) {
    const t = ler(path.join(RAIZ, "test", arq));
    for (const re of [
      /includes\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g,
      /includes\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g,
      /indexOf\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g,
    ]) {
      for (const m of t.matchAll(re)) literais.push(m[1].replace(/\\(["'])/g, "$1"));
    }
  }
  const noPrompt = [...new Set(literais)].filter((l) => l.length >= 8 && prompt.includes(l));
  console.log(`\nTRAVADO POR TESTE: ${noPrompt.length} asserções citam texto do prompt`);
  console.log("  asserções  seção");
  for (const s of [...secoes].sort((a, b) => b.texto.length - a.texto.length)) {
    const n = noPrompt.filter((l) => s.texto.includes(l)).length;
    console.log(`  ${String(n).padStart(9)}  ${s.titulo.slice(0, 56)}${n === 0 ? "  ← sem asserção" : ""}`);
  }
  console.log(
    "\nATENÇÃO: 'sem asserção' NÃO é 'seguro cortar'. SUA CARTA NA MANGA não tem",
  );
  console.log(
    "asserção e é intocável — é ela que ensina o modelo a emitir [DEMO:...], e os",
  );
  console.log("testes de demo alimentam a resposta direto, sem passar pelo modelo.");
}
