import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  leadsTable,
  leadMessagesTable,
  followUpsTable,
} from "@workspace/db";
import { eq, desc, ilike, and, or, sql } from "drizzle-orm";
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

    res.json({ leads, total: totalResult[0]?.count ?? 0 });
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
