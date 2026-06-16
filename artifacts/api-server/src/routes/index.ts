import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import leadsRouter from "./leads";
import statsRouter from "./stats";
import webhookRouter from "./webhook";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// Rotas públicas
router.use(authRouter); // login / logout / me
router.use(healthRouter); // health check
router.use(webhookRouter); // recebe mensagens — protegido por WEBHOOK_SECRET

// Rotas protegidas: só com login válido no painel
router.use(requireAuth, leadsRouter);
router.use(requireAuth, statsRouter);

export default router;
