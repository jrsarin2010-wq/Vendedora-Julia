/**
 * `push:ci` — o `drizzle-kit push` com CÓDIGO DE SAÍDA HONESTO.
 *
 * Por que isto existe (medido em 15/08/2026, dentro do contêiner de produção):
 * o drizzle-kit pode falhar e mesmo assim sair com código 0. A saída real foi
 *
 *     · You're about to add uq_varredura unique constraint to the table,
 *       which contains 54 items. Do you want to truncate apify_varreduras?
 *     Error: Interactive prompts require a TTY terminal ...
 *     ===== EXIT_CODE=0 =====
 *
 * Ou seja: o schema NÃO foi aplicado e o Railway marcou o deploy como SUCCESS.
 * Deploy verde com schema não aplicado é pior que deploy vermelho — o próximo
 * `ALTER TABLE` seria ignorado sem ninguém perceber, e o bug só apareceria
 * como "coluna não existe" em produção, horas depois.
 *
 * A regra aqui é simples: só sai 0 quem PROVAR que aplicou. Prova é uma das
 * duas marcas que o drizzle imprime quando termina de verdade — "Changes
 * applied" ou "No changes detected". Silêncio não conta, e erro no meio da
 * saída derruba mesmo que o processo tenha saído 0.
 *
 * NUNCA troque isto por `--force` (o script `push-force`): o force responde
 * "sim" à sugestão de TRUNCATE e apagaria as linhas da tabela.
 */
import { spawn } from "node:child_process";

/** O drizzle terminou o trabalho? Uma destas tem que aparecer. */
const MARCAS_DE_SUCESSO = [/Changes applied/i, /No changes detected/i];

/**
 * Marcas de falha que o drizzle imprime SEM refletir no código de saída.
 * A do TTY é a que nos mordeu; "Error:" no começo de linha cobre o resto.
 */
const MARCAS_DE_FALHA = [/Interactive prompts require a TTY/i, /^Error:/im];

const filho = spawn("drizzle-kit", ["push", "--config", "./drizzle.config.ts"], {
  shell: true,
  env: process.env,
});

let saida = "";

filho.stdout.on("data", (pedaco) => {
  const texto = pedaco.toString();
  saida += texto;
  process.stdout.write(texto);
});

filho.stderr.on("data", (pedaco) => {
  const texto = pedaco.toString();
  saida += texto;
  process.stderr.write(texto);
});

filho.on("error", (err) => {
  console.error(`\n[push:ci] não consegui executar o drizzle-kit: ${err.message}`);
  process.exit(1);
});

filho.on("close", (codigo) => {
  const erroNaSaida = MARCAS_DE_FALHA.find((marca) => marca.test(saida));
  const provaDeSucesso = MARCAS_DE_SUCESSO.some((marca) => marca.test(saida));

  if (codigo !== 0) {
    console.error(`\n[push:ci] drizzle-kit saiu com código ${codigo} — schema NÃO aplicado.`);
    process.exit(1);
  }

  if (erroNaSaida) {
    console.error(
      "\n[push:ci] o drizzle-kit saiu com código 0, mas imprimiu erro " +
        `(${erroNaSaida}) — o schema NÃO foi aplicado.\n` +
        "[push:ci] derrubando o deploy de propósito: subir o app com o banco " +
        "desatualizado esconde o problema até alguém tropeçar nele em produção.",
    );
    process.exit(1);
  }

  if (!provaDeSucesso) {
    console.error(
      "\n[push:ci] não encontrei 'Changes applied' nem 'No changes detected' na " +
        "saída do drizzle-kit. Sem prova de que aplicou, o deploy não segue.",
    );
    process.exit(1);
  }

  console.log("\n[push:ci] schema aplicado (ou já estava em dia).");
});
