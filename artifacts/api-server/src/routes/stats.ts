import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  leadsTable,
  leadMessagesTable,
  followUpsTable,
} from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { GetRecentActivityQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /api/stats
router.get("/stats", async (req, res) => {
  try {
    const [totals, pending, handoffs] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          hot: sql<number>`sum(case when status = 'hot' then 1 else 0 end)::int`,
          closed: sql<number>`sum(case when status = 'closed' then 1 else 0 end)::int`,
          lost: sql<number>`sum(case when status = 'lost' then 1 else 0 end)::int`,
        })
        .from(leadsTable),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(followUpsTable)
        .where(eq(followUpsTable.status, "pending")),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(leadsTable)
        .where(eq(leadsTable.handoffRequested, true)),
    ]);

    const row = totals[0];
    const total = row?.total ?? 0;
    const closedCount = row?.closed ?? 0;
    const conversionRate = total > 0 ? Math.round((closedCount / total) * 100) : 0;

    res.json({
      totalLeads: total,
      hotLeads: row?.hot ?? 0,
      closedLeads: closedCount,
      lostLeads: row?.lost ?? 0,
      conversionRate,
      pendingFollowups: pending[0]?.count ?? 0,
      handoffsPending: handoffs[0]?.count ?? 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/stats/funnel
router.get("/stats/funnel", async (req, res) => {
  try {
    const stages = [
      "new",
      "contacted",
      "qualified",
      "interested",
      "objection",
      "closing",
      "closed",
      "lost",
    ];

    const result = await db
      .select({
        stage: leadsTable.funnelStage,
        count: sql<number>`count(*)::int`,
      })
      .from(leadsTable)
      .groupBy(leadsTable.funnelStage);

    const countMap = new Map(result.map((r) => [r.stage, r.count]));
    const funnel = stages.map((stage) => ({
      stage,
      count: countMap.get(stage as "new" | "contacted" | "qualified" | "interested" | "objection" | "closing" | "closed" | "lost") ?? 0,
    }));

    res.json(funnel);
  } catch (err) {
    req.log.error({ err }, "Failed to get funnel stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/stats/recent-activity
router.get("/stats/recent-activity", async (req, res) => {
  try {
    const query = GetRecentActivityQueryParams.parse(req.query);
    const limit = query.limit ?? 10;

    const recent = await db
      .select({
        leadId: leadsTable.id,
        leadName: leadsTable.name,
        phone: leadsTable.phone,
        funnelStage: leadsTable.funnelStage,
        status: leadsTable.status,
        lastMessageAt: leadsTable.lastMessageAt,
        updatedAt: leadsTable.updatedAt,
      })
      .from(leadsTable)
      .orderBy(desc(leadsTable.updatedAt))
      .limit(limit);

    const activity = recent.map((lead) => ({
      leadId: lead.leadId,
      leadName: lead.leadName,
      phone: lead.phone,
      event: `Estágio: ${lead.funnelStage}`,
      funnelStage: lead.funnelStage,
      status: lead.status,
      timestamp: (lead.lastMessageAt ?? lead.updatedAt).toISOString(),
    }));

    res.json(activity);
  } catch (err) {
    req.log.error({ err }, "Failed to get recent activity");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
