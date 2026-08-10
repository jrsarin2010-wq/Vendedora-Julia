import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
// A importação de leads manda um lote grande de uma vez (até 2000 dentistas),
// e o limite padrão de 100kb do express.json rejeitaria o corpo antes de a
// rota ver qualquer coisa — com um erro feio do próprio express, em vez da
// mensagem que explica o que fazer. Este parser cobre SÓ essa rota e vem
// ANTES do global; o global depois enxerga o corpo já lido e não faz nada.
// Fica restrito assim de propósito: o webhook continua com o limite apertado.
app.use("/api/leads/import", express.json({ limit: "2mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve o PAINEL (frontend buildado) no mesmo servidor — assim o deploy é um
// só. O painel é copiado para dist/public durante o build. Se a pasta não
// existir (ex.: rodando só a API em dev), simplesmente não serve nada disso.
const staticDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "public",
);
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  // Qualquer GET que NÃO seja /api e não seja arquivo estático volta pro
  // index.html (app de página única). Escrito como middleware para ser
  // compatível com o Express 5.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
  logger.info({ staticDir }, "Servindo o painel a partir do mesmo servidor");
}

export default app;
