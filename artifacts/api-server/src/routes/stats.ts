import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  leadsTable,
  leadMessagesTable,
  followUpsTable,
} from "@workspace/db";
import { eq, and, sql, desc, isNotNull, inArray } from "drizzle-orm";
import { GetRecentActivityQueryParams } from "@workspace/api-zod";
import { contarAssuntos } from "../lib/duvidas-do-site";
import { faixaDaTemperatura, type Faixa } from "../lib/temperatura";

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

/**
 * GET /api/stats/duvidas-do-site — "O que a landing não responde" (Rodada 35).
 *
 * Cada linha é um buraco na página, com número em vez de palpite: se cinco
 * dentistas clicaram no botão por causa de recarga, a página tem um problema
 * na recarga.
 *
 * Fora do contrato OpenAPI, no mesmo esquema da central de vigia: é uma tela de
 * operação do painel, não modelo de dados, então não obriga a regerar o cliente.
 *
 * A contagem é feita em memória, e não com GROUP BY, de propósito: os assuntos
 * precisam ser normalizados antes de agrupar (senão "Recarga" e "recarga" viram
 * duas linhas de 1 em vez de uma de 2), e a normalização mora em
 * `contarAssuntos`. O volume é o de leads que vieram do site — cabe.
 */
router.get("/stats/duvidas-do-site", async (req, res) => {
  try {
    const comDuvida = await db
      .select()
      .from(leadsTable)
      .where(isNotNull(leadsTable.duvidaDoSite));

    const assuntos = contarAssuntos(comDuvida.map((l) => l.duvidaDoSite));
    const total = assuntos.reduce((soma, a) => soma + a.total, 0);

    res.json({ assuntos, total });
  } catch (err) {
    req.log.error({ err }, "Failed to get landing questions");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/stats/temperatura — quantos leads em cada faixa (Rodada 41).
 *
 * É a leitura mais útil do funil que existe: quantos estão só olhando, quantos
 * avaliando, quantos decidindo. Fora do contrato OpenAPI, no mesmo esquema das
 * dúvidas do site: tela de operação do painel, não modelo de dados.
 *
 * Cliente e perdido ficam de fora da conta — a temperatura é leitura de quem
 * ainda está no funil, e um "fervendo" que já assinou só inflaria o número.
 */
router.get("/stats/temperatura", async (req, res) => {
  try {
    const leads = await db
      .select({ temperatura: leadsTable.temperatura, status: leadsTable.status })
      .from(leadsTable);

    const contagem: Record<Faixa, number> = { frio: 0, morno: 0, quente: 0, fervendo: 0 };
    for (const l of leads) {
      if (l.status === "closed" || l.status === "lost") continue;
      contagem[faixaDaTemperatura(l.temperatura ?? 0)]++;
    }

    res.json(contagem);
  } catch (err) {
    req.log.error({ err }, "Failed to get temperature stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/stats/reativacao — quem está na fila longa (Rodada 41).
 *
 * Um lead aparece uma vez, com o PRÓXIMO toque dele (o pendente mais cedo).
 * Fora do contrato OpenAPI, como as outras telas de operação.
 */
router.get("/stats/reativacao", async (req, res) => {
  try {
    const pendentes = await db
      .select()
      .from(followUpsTable)
      .where(
        and(
          eq(followUpsTable.kind, "reativacao"),
          eq(followUpsTable.status, "pending"),
        ),
      );

    // O próximo toque de cada lead = o pendente com o menor scheduledAt.
    const proximoPorLead = new Map<number, { touchNumber: number; scheduledAt: Date }>();
    for (const f of pendentes) {
      const atual = proximoPorLead.get(f.leadId);
      if (!atual || new Date(f.scheduledAt) < new Date(atual.scheduledAt)) {
        proximoPorLead.set(f.leadId, {
          touchNumber: f.touchNumber,
          scheduledAt: f.scheduledAt,
        });
      }
    }

    const ids = [...proximoPorLead.keys()];
    const leads = ids.length
      ? await db.select().from(leadsTable).where(inArray(leadsTable.id, ids))
      : [];

    const itens = leads
      .map((l) => {
        const proximo = proximoPorLead.get(l.id)!;
        return {
          id: l.id,
          name: l.name,
          phone: l.phone,
          proximoToque: proximo.touchNumber,
          agendadoPara: new Date(proximo.scheduledAt).toISOString(),
        };
      })
      .sort((a, b) => a.agendadoPara.localeCompare(b.agendadoPara));

    res.json({ itens, total: itens.length });
  } catch (err) {
    req.log.error({ err }, "Failed to get reactivation queue");
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
