/**
 * Asserções mínimas. Zero dependência: o objetivo é que `pnpm test` funcione
 * sem instalar framework nenhum, e que uma falha diga exatamente o que houve.
 */

let falhas = 0;
let total = 0;

export function secao(titulo: string): void {
  console.log(`\n${titulo}`);
}

export function ok(nome: string, condicao: boolean, detalhe = ""): void {
  total++;
  if (condicao) {
    console.log(`  ok    ${nome}`);
    return;
  }
  falhas++;
  console.log(`  FALHA ${nome}${detalhe ? `\n        ${detalhe}` : ""}`);
}

/** Encerra o arquivo de teste com o código de saída certo. */
export function fim(): never {
  if (falhas === 0) {
    console.log(`\n  ${total} asserções, tudo passou\n`);
    process.exit(0);
  }
  console.log(`\n  ${total} asserções, ${falhas} FALHA(S)\n`);
  process.exit(1);
}
