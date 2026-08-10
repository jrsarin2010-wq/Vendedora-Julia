/**
 * GERA OS ÁUDIOS DE DEMONSTRAÇÃO — roda UMA vez, não em produção.
 *
 *   node scripts/gerar-demos.mjs --key-file ../../cartesia-key.txt
 *   node scripts/gerar-demos.mjs                 (usa CARTESIA_API_KEY do ambiente)
 *   node scripts/gerar-demos.mjs --out /tmp/previa   (para ouvir antes de valer)
 *
 * Os MP3 vão para assets/demos/ e são commitados. Em produção nada é
 * sintetizado: o webhook lê o arquivo pronto. Custo por conversa: zero.
 *
 * Duas decisões que valem explicação:
 *
 * 1. O texto vem do `ROTEIROS` em src/lib/demos.ts, não daqui. Uma cópia do
 *    roteiro dentro do script envelheceria em silêncio, e o código passaria a
 *    descrever um áudio diferente do que está no arquivo.
 *
 * 2. A OpenAI é trocada por um stub que LANÇA. O `gerarVoz` normal cai para a
 *    OpenAI quando a Cartesia falha — ótimo em produção, desastre aqui: geraria
 *    os áudios definitivos com outra voz, e ninguém perceberia até um dentista
 *    ouvir. Por isso este script usa a Cartesia pura e falha alto.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const require = createRequire(path.join(pkgRoot, "package.json"));
const esbuild = require("esbuild");

function arg(nome) {
  const i = process.argv.indexOf(nome);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const destino = path.resolve(arg("--out") ?? path.join(pkgRoot, "assets/demos"));

// A chave: de um arquivo (que não vai para o git) ou do ambiente. Nunca é
// impressa — nem no erro.
const arquivoChave = arg("--key-file");
if (arquivoChave) {
  const bruto = await readFile(path.resolve(arquivoChave), "utf8");
  process.env.CARTESIA_API_KEY = bruto.split("\n")[0].trim();
}
if (!process.env.CARTESIA_API_KEY) {
  console.error(
    "Falta a chave da Cartesia. Use --key-file <arquivo> ou defina CARTESIA_API_KEY.",
  );
  process.exit(1);
}

/** Bundla os módulos de verdade, trocando só as bordas que atrapalhariam. */
const tempDir = path.join(pkgRoot, "scripts/.build");
await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });
const bundle = path.join(tempDir, "motor.mjs");

// Os stubs precisam existir antes do bundle resolver os imports.
await writeFile(
  path.join(tempDir, "logger.mjs"),
  `export const logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {}, child: () => logger };\nexport default logger;\n`,
);
await writeFile(
  path.join(tempDir, "sem-openai.mjs"),
  `export async function textToSpeech() { throw new Error("A geração das demos não pode cair para a OpenAI — a voz sairia diferente."); }\n`,
);

await esbuild.build({
  stdin: {
    contents: [
      `export { gerarVozCartesia } from ${JSON.stringify(path.join(pkgRoot, "src/lib/tts.ts").replace(/\\/g, "/"))};`,
      `export { DEMOS, ROTEIROS } from ${JSON.stringify(path.join(pkgRoot, "src/lib/demos.ts").replace(/\\/g, "/"))};`,
    ].join("\n"),
    resolveDir: pkgRoot,
    sourcefile: "entrada.ts",
    loader: "ts",
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
  plugins: [
    {
      name: "bordas",
      setup(build) {
        // O pino de verdade carrega workers e usa __dirname, que não existe
        // neste bundle. Aqui log é console e pronto.
        build.onResolve({ filter: /(^|\/)logger$/ }, () => ({
          path: path.join(tempDir, "logger.mjs"),
        }));
        // Ver a decisão 2 no cabeçalho: a queda para a OpenAI é proibida aqui.
        build.onResolve({ filter: /^@workspace\/integrations-openai-ai-server$/ }, () => ({
          path: path.join(tempDir, "sem-openai.mjs"),
        }));
      },
    },
  ],
});

const { gerarVozCartesia, DEMOS, ROTEIROS } = await import(
  `file://${bundle.replace(/\\/g, "/")}`
);

await mkdir(destino, { recursive: true });
console.log(`Gerando ${DEMOS.length} áudios em ${destino}\n`);

for (const nome of DEMOS) {
  const texto = ROTEIROS[nome];
  if (!texto) {
    console.error(`  ${nome}: SEM ROTEIRO — pulando`);
    process.exitCode = 1;
    continue;
  }
  process.stdout.write(`  ${nome} ... `);
  const mp3 = await gerarVozCartesia(texto);
  const arquivo = path.join(destino, `${nome}.mp3`);
  await writeFile(arquivo, mp3);
  const segundos = (mp3.length / (128000 / 8)).toFixed(1);
  console.log(`${(mp3.length / 1024).toFixed(0)} kB, ~${segundos}s`);
}

await rm(tempDir, { recursive: true, force: true });
console.log(`\nPronto. Ouça os arquivos antes de commitar.`);
