import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  leadsTable,
  leadMessagesTable,
  followUpsTable,
} from "@workspace/db";
import { eq, desc, ilike, and, or, sql, inArray } from "drizzle-orm";
import {
  ListLeadsQueryParams,
  UpdateLeadBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /api/leads
router.get("/leads", async (req, res) => {
  try {
    const query = ListLeadsQueryParams.parse(req.query);
    const { status, funnelStage, search, limit = 50, offset = 0 } = query;

    const conditions = [];
    if (status) conditions.push(eq(leadsTable.status, status as "hot" | "warm" | "cold" | "closed" | "lost"));
    if (funnelStage) conditions.push(eq(leadsTable.funnelStage, funnelStage as "new" | "contacted" | "qualified" | "interested" | "objection" | "closing" | "closed" | "lost"));
    if (search) {
      conditions.push(
        or(
          ilike(leadsTable.name, `%${search}%`),
          ilike(leadsTable.phone, `%${search}%`)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [leads, totalResult] = await Promise.all([
      db
        .select()
        .from(leadsTable)
        .where(whereClause)
        .orderBy(desc(leadsTable.lastMessageAt), desc(leadsTable.updatedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(leadsTable)
        .where(whereClause),
    ]);

    // Quantas mensagens cada lead tem (Rodada 42). Alimenta o diálogo de
    // exclusão do painel: "todo o histórico (47 mensagens)" pesa mais que
    // "todo o histórico", e evita o clique distraído. Uma consulta agregada
    // para a página inteira, não uma por lead.
    const ids = leads.map((l) => l.id);
    const contagens = ids.length
      ? await db
          .select({
            leadId: leadMessagesTable.leadId,
            total: sql<number>`count(*)::int`,
          })
          .from(leadMessagesTable)
          .where(inArray(leadMessagesTable.leadId, ids))
          .groupBy(leadMessagesTable.leadId)
      : [];
    const mensagensPorLead = new Map(contagens.map((c) => [c.leadId, c.total]));

    res.json({
      leads: leads.map((l) => ({
        ...l,
        totalMensagens: mensagensPorLead.get(l.id) ?? 0,
      })),
      total: totalResult[0]?.count ?? 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list leads");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/leads/:id
router.get("/leads/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const lead = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.id, id))
      .limit(1);

    if (!lead[0]) return void res.status(404).json({ error: "Lead not found" });

    res.json(lead[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to get lead");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/leads/:id
router.patch("/leads/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const body = UpdateLeadBody.parse(req.body);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) updateData.name = body.name;
    if (body.funnelStage !== undefined) updateData.funnelStage = body.funnelStage;
    if (body.painPoints !== undefined) updateData.painPoints = body.painPoints;
    if (body.mainObjection !== undefined) updateData.mainObjection = body.mainObjection;
    if (body.planInterest !== undefined) updateData.planInterest = body.planInterest;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.handoffRequested !== undefined) updateData.handoffRequested = body.handoffRequested;
    // Retomar a Júlia antes dos 5 minutos. O schema só admite null, então isto
    // nunca cria uma pausa pelo painel — quem pausa é o humano respondendo pelo
    // WhatsApp. Aqui a única operação possível é liberar.
    if (body.pausedUntil !== undefined) updateData.pausedUntil = null;

    const updated = await db
      .update(leadsTable)
      .set(updateData)
      .where(eq(leadsTable.id, id))
      .returning();

    if (!updated[0]) return void res.status(404).json({ error: "Lead not found" });

    res.json(updated[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to update lead");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/leads/import-pending
 *
 * Faxina em lote dos leads de teste: apaga os que vieram por IMPORTAÇÃO e que
 * ainda NÃO receberam a primeira mensagem.
 *
 * Escolhi este recorte, e não uma seleção por caixinhas na lista, por ser o
 * mais simples que resolve o problema real (limpar a planilha de teste antes
 * de ligar o disparo) sem poder machucar: quem já conversou com a Júlia, quem
 * chegou sozinho pelo WhatsApp e quem já foi abordado ficam todos de fora, por
 * construção. Não há como errar o clique e apagar uma conversa de verdade.
 *
 * Precisa vir ANTES de "/leads/:id" para o ":id" não capturar "import-pending".
 */
router.delete("/leads/import-pending", async (req, res) => {
  try {
    const alvos = await db
      .select({ id: leadsTable.id })
      .from(leadsTable)
      .where(
        and(
          eq(leadsTable.origin, "import"),
          eq(leadsTable.outreachStatus, "pending"),
        ),
      );

    let apagados = 0;
    for (const alvo of alvos) {
      await apagarLeadEDependentes(alvo.id);
      apagados++;
    }

    req.log.info({ apagados }, "Faxina de leads importados pendentes");
    res.json({ apagados });
  } catch (err) {
    req.log.error({ err }, "Failed to bulk delete pending imported leads");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Apaga o lead e tudo que depende dele.
 *
 * As mensagens e os follow-ups são apagados EXPLICITAMENTE, antes do lead,
 * mesmo com as chaves estrangeiras já tendo `onDelete: "cascade"`. Duas
 * razões: a ordem fica óbvia para quem lê, e a garantia deixa de depender de
 * uma configuração de schema que ninguém revisa. Custa duas consultas.
 */
async function apagarLeadEDependentes(
  id: number,
): Promise<{ mensagens: number; followUps: number }> {
  const mensagens = await db
    .delete(leadMessagesTable)
    .where(eq(leadMessagesTable.leadId, id))
    .returning();

  const followUps = await db
    .delete(followUpsTable)
    .where(eq(followUpsTable.leadId, id))
    .returning();

  await db.delete(leadsTable).where(eq(leadsTable.id, id));

  return { mensagens: mensagens.length, followUps: followUps.length };
}

// DELETE /api/leads/:id
router.delete("/leads/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const existente = await db
      .select({ id: leadsTable.id, phone: leadsTable.phone })
      .from(leadsTable)
      .where(eq(leadsTable.id, id))
      .limit(1);

    if (!existente[0]) return void res.status(404).json({ error: "Lead not found" });

    const apagados = await apagarLeadEDependentes(id);

    req.log.info(
      { leadId: id, phone: existente[0].phone, ...apagados },
      "Lead apagado",
    );

    res.json({
      apagado: true,
      id,
      mensagensApagadas: apagados.mensagens,
      followUpsApagados: apagados.followUps,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to delete lead");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/leads/:id/messages
router.get("/leads/:id/messages", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const lead = await db
      .select({ id: leadsTable.id })
      .from(leadsTable)
      .where(eq(leadsTable.id, id))
      .limit(1);
    if (!lead[0]) return void res.status(404).json({ error: "Lead not found" });

    const messages = await db
      .select()
      .from(leadMessagesTable)
      .where(eq(leadMessagesTable.leadId, id))
      .orderBy(leadMessagesTable.createdAt)
      .limit(200);

    res.json(messages);
  } catch (err) {
    req.log.error({ err }, "Failed to get lead messages");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/leads/:id/followups
router.get("/leads/:id/followups", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const followups = await db
      .select()
      .from(followUpsTable)
      .where(eq(followUpsTable.leadId, id))
      .orderBy(followUpsTable.scheduledAt);

    res.json(followups);
  } catch (err) {
    req.log.error({ err }, "Failed to get lead followups");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
