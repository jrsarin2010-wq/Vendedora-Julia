import app from "./app";
import { logger } from "./lib/logger";
import { startFollowUpScheduler } from "./lib/follow-up-scheduler";
import { startOutreachScheduler } from "./lib/outreach-scheduler";
import { startVarreduraScheduler } from "./lib/varredura-scheduler";
import { sondarModelosNoBoot } from "./lib/sonda-modelo";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // A primeira coisa depois de abrir a porta: conferir que os modelos
  // configurados existem. Nome de modelo errado não derruba deploy nenhum —
  // derruba a primeira conversa, em silêncio (ver lib/sonda-modelo.ts).
  // `void` de propósito: a sonda avisa, nunca atrasa nem derruba o boot.
  void sondarModelosNoBoot();
  startFollowUpScheduler();
  // Começa desligado: só dispara com OUTREACH_ENABLED=true no ambiente.
  startOutreachScheduler();
  // Também começa desligada: só varre com APIFY_SWEEP_ENABLED=true. Deploy não
  // pode sair gastando crédito do Apify sozinho.
  startVarreduraScheduler();
});
