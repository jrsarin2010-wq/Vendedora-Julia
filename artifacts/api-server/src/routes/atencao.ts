/**
 * CENTRAL DE VIGIA — as duas rotas que o painel usa.
 *
 * Fora do contrato OpenAPI de propósito, no mesmo esquema da importação e do
 * login: são rotas de operação do painel, não do modelo de dados. Assim esta
 * rodada não precisa regerar os clientes (orval) para entregar valor.
 */
import { Router, type IRouter } from "express";
import { db, leadsTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { MOTIVO_PT, type MotivoAtencao, limparAtencao } from "../lib/atencao";

const router: IRouter = Router();

/**
 * GET /api/atencao
 *
 * Os leads que precisam de gente, com o motivo já em português e o telefone
 * como link de WhatsApp — é por ali que ele vai responder, não pelo painel.
 */
router.get("/atencao", async (req, res) => {
  try {
    const marcados = await db
      .select()
      .from(leadsTable)
      .where(isNotNull(leadsTable.atencao));

    const itens = marcados
      .map((lead) => ({
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        whatsapp: `https://wa.me/${lead.phone.replace(/\D/g, "")}`,
        motivo: lead.atencao,
        motivoTexto: MOTIVO_PT[lead.atencao as MotivoAtencao] ?? lead.atencao,
        detalhe: lead.atencaoDetalhe,
        desde: lead.atencaoDesde,
        painPoints: lead.painPoints,
      }))
      // Mais antigo primeiro: quem está esperando há mais tempo é quem mais
      // precisa. Sem `desde`, vai para o fim em vez de quebrar a ordenação.
      .sort((a, b) => {
        const ta = a.desde ? new Date(a.desde).getTime() : Number.MAX_SAFE_INTEGER;
        const tb = b.desde ? new Date(b.desde).getTime() : Number.MAX_SAFE_INTEGER;
        return ta - tb;
      });

    res.json({ itens, total: itens.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list leads needing attention");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/leads/:id/atencao/resolver — o botão "Já cuidei disso".
 *
 * POST e não PATCH porque é uma AÇÃO, não a edição de um campo que o painel
 * conhece. Também mantém a marcação fora do `UpdateLeadBody`, onde alguém
 * poderia escrever um motivo à mão e furar a precedência.
 */
router.post("/leads/:id/atencao/resolver", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const lead = (
      await db.select().from(leadsTable).where(eq(leadsTable.id, id)).limit(1)
    )[0];
    if (!lead) return void res.status(404).json({ error: "Lead not found" });

    // Idempotente: resolver o que já estava resolvido responde 200 com
    // `resolvido: false`. Dois cliques no botão não podem virar erro na tela.
    const resolvido = await limparAtencao(lead, "botão do painel");

    req.log.info({ leadId: id, resolvido }, "Atenção resolvida pelo painel");
    res.json({ resolvido, id });
  } catch (err) {
    req.log.error({ err }, "Failed to resolve lead attention");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
