import { Router, type IRouter } from "express";
import atencaoRouter from "./atencao";
import authRouter from "./auth";
import healthRouter from "./health";
import leadsRouter from "./leads";
import leadsCanonicalizarRouter from "./leads-canonicalizar";
import leadsImportRouter from "./leads-import";
import outreachRouter from "./outreach";
import prospectsRouter from "./prospects";
import statsRouter from "./stats";
import varredurasRouter from "./varreduras";
import varredurasSeedRouter from "./varreduras-seed";
import verificacaoRouter from "./verificacao";
import webhookRouter from "./webhook";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// Rotas públicas
router.use(authRouter); // login / logout / me
router.use(healthRouter); // health check
router.use(webhookRouter); // recebe mensagens — protegido por WEBHOOK_SECRET

// Rotas protegidas: só com login válido no painel.
// A importação vem ANTES de leadsRouter porque "/leads/:id" casaria com
// "/leads/import" — o GET pegaria "import" como id. São métodos diferentes
// (POST vs GET), então hoje não colidiria; a ordem é para não depender disso.
router.use(requireAuth, leadsImportRouter);
// Mesma razão da importação: "/leads/canonicalizar" vem antes de "/leads/:id"
// para não depender de os métodos serem diferentes.
router.use(requireAuth, leadsCanonicalizarRouter);
// Também antes de leadsRouter: "/leads/:id/outreach-preview" é mais
// específico que "/leads/:id", e os dois são GET.
router.use(requireAuth, outreachRouter);
// Antes de leadsRouter pelo mesmo motivo: "/leads/:id/atencao/resolver" é mais
// específico que "/leads/:id".
router.use(requireAuth, atencaoRouter);
router.use(requireAuth, leadsRouter);
router.use(requireAuth, statsRouter);
router.use(requireAuth, varredurasSeedRouter); // fila de varreduras Apify
// Etapa 3B — a tela de prospecção: controle da varredura e leitura das
// clínicas captadas. Todas as rotas são literais (nenhuma tem `:id`), então
// não há ordem a preservar aqui.
router.use(requireAuth, varredurasRouter);
// Etapa 3A — o controle da verificação de WhatsApp, na mesma tela.
router.use(requireAuth, verificacaoRouter);
router.use(requireAuth, prospectsRouter);

export default router;
