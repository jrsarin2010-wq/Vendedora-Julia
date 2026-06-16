import { db } from "@workspace/db";
import { followUpsTable, leadsTable, leadMessagesTable } from "@workspace/db";
import { eq, lte, and } from "drizzle-orm";
import { sendWhatsAppMessage } from "./integrations";
import { logger } from "./logger";

export function startFollowUpScheduler(): void {
  // Run every 5 minutes
  const INTERVAL_MS = 5 * 60 * 1000;

  const run = async () => {
    try {
      const now = new Date();

      // Find pending follow-ups that are due
      const due = await db
        .select({
          followUp: followUpsTable,
          lead: leadsTable,
        })
        .from(followUpsTable)
        .innerJoin(leadsTable, eq(followUpsTable.leadId, leadsTable.id))
        .where(
          and(
            eq(followUpsTable.status, "pending"),
            lte(followUpsTable.scheduledAt, now)
          )
        )
        .limit(20);

      for (const { followUp, lead } of due) {
        // Skip if lead is closed/lost
        if (lead.status === "closed" || lead.status === "lost") {
          await db
            .update(followUpsTable)
            .set({ status: "cancelled" })
            .where(eq(followUpsTable.id, followUp.id));
          continue;
        }

        const message = followUp.messageTemplate ?? `Oi! Sou a Júlia do OdontoFlow. Você ainda tem interesse em conhecer nossa secretária IA? Posso te ajudar! 😊`;

        await sendWhatsAppMessage(lead.phone, message);

        // Save outbound follow-up message
        await db.insert(leadMessagesTable).values({
          leadId: lead.id,
          direction: "outbound",
          content: message,
          messageType: "text",
        });

        // Mark as sent
        await db
          .update(followUpsTable)
          .set({ status: "sent" })
          .where(eq(followUpsTable.id, followUp.id));

        logger.info({ leadId: lead.id, touchNumber: followUp.touchNumber }, "Follow-up sent");
      }
    } catch (err) {
      logger.error({ err }, "Follow-up scheduler error");
    }
  };

  // Run immediately then on interval
  run();
  setInterval(run, INTERVAL_MS);
  logger.info("Follow-up scheduler started");
}
