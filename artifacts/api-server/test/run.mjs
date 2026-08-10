/**
 * RODA OS TESTES — `pnpm test` no api-server cai aqui.
 *
 * Não usa framework de teste. Cada arquivo `*.test.ts` desta pasta é
 * empacotado com o esbuild (o mesmo que o build de produção já usa) trocando
 * as bordas do sistema por stubs, e rodado num processo separado.
 *
 * Processo separado porque o webhook guarda estado em módulo (o cache de IDs
 * já processados, por exemplo). Um arquivo não pode contaminar o outro.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync, mkdirSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const require = createRequire(path.join(pkgRoot, "package.json"));
const esbuild = require("esbuild");

const stubDir = path.join(here, "stubs");

/**
 * Troca as bordas do sistema por stubs. Tudo que NÃO estiver aqui é o código
 * de verdade — é esse o ponto: o teste exercita a lógica real da Júlia.
 */
const plugin = {
  name: "stubs",
  setup(build) {
    // Saída de emergência: um import terminado em "?real" carrega o módulo DE
    // VERDADE, mesmo que ele esteja na lista de trocas abaixo. Serve para o
    // teste que precisa exercitar a própria integração — hoje, a montagem da
    // URL da Evolution. Registrado ANTES das trocas porque o esbuild usa a
    // primeira regra que casar.
    build.onResolve({ filter: /\?real$/ }, (args) => ({
      path: path.resolve(
        path.dirname(args.importer),
        `${args.path.replace(/\?real$/, "")}.ts`,
      ),
    }));

    const trocas = [
      [/^@workspace\/db$/, "db.mjs"],
      [/^@workspace\/integrations-openai-ai-server$/, "openai.mjs"],
      [/^drizzle-orm$/, "drizzle.mjs"],
      // Só o módulo de integrações externas (WhatsApp/Telegram). Os outros
      // arquivos de src/lib (tratamento, filtro-spam, outreach) são testados
      // de verdade.
      //
      // O padrão precisa cobrir "../lib/integrations" (visto de routes/) E
      // "./integrations" (visto de dentro de lib/). Com o filtro amarrado em
      // "lib/", os agendadores escapavam do stub e tentavam falar com a
      // Evolution de verdade — o teste falhava com "não entregue" enquanto o
      // stub ficava zerado, que é um sintoma bem difícil de ler.
      [/(^|\/)integrations$/, "integrations.mjs"],
      // O pino de verdade carrega workers e usa `__dirname`, que não existe
      // no bundle ESM do teste.
      [/(^|\/)logger$/, "logger.mjs"],
    ];
    for (const [filter, arquivo] of trocas) {
      build.onResolve({ filter }, () => ({ path: path.join(stubDir, arquivo) }));
    }
  },
};

const buildDir = path.join(here, ".build");
rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

const arquivos = readdirSync(here)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

if (arquivos.length === 0) {
  console.error("Nenhum arquivo *.test.ts encontrado em test/");
  process.exit(1);
}

const falharam = [];

for (const arquivo of arquivos) {
  const saida = path.join(buildDir, arquivo.replace(/\.ts$/, ".mjs"));

  await esbuild.build({
    entryPoints: [path.join(here, arquivo)],
    outfile: saida,
    bundle: true,
    platform: "node",
    format: "esm",
    plugins: [plugin],
    logLevel: "warning",
    // O express é CJS e faz require("node:events") lá dentro. Sem um `require`
    // no escopo do módulo ESM gerado, o bundle quebra ao carregar.
    banner: {
      js: [
        `import { createRequire as __cr } from 'node:module';`,
        `const require = __cr(${JSON.stringify(path.join(pkgRoot, "package.json").replace(/\\/g, "/"))});`,
      ].join("\n"),
    },
  });

  console.log(`\n=== ${arquivo} ===`);
  const r = spawnSync(process.execPath, [saida], { stdio: "inherit" });
  if (r.status !== 0) falharam.push(arquivo);
}

console.log("");
if (falharam.length > 0) {
  console.error(`FALHOU: ${falharam.join(", ")}`);
  process.exit(1);
}
console.log(`Todos os ${arquivos.length} arquivos de teste passaram.`);
