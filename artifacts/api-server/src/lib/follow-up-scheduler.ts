import { db } from "@workspace/db";
import { followUpsTable, leadsTable, leadMessagesTable } from "@workspace/db";
import { eq, lte, and } from "drizzle-orm";
import { sendWhatsAppMessage } from "./integrations";
import { logger } from "./logger";
import { saudacao } from "./tratamento";

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

        // Rede de segurança: só cai aqui se o follow-up foi criado sem template.
        // Tom igual ao dos templates: curto, usa o mesmo saudacao() dos demais
        // (Dr./Dra. conforme o nome, ou só o nome quando ambíguo) e não promete
        // nada — só abre a porta e deixa o link.
        const message =
          followUp.messageTemplate ??
          `${saudacao(lead.name)}aqui é a Júlia do CaptaClin 😊 Passando pra saber se o WhatsApp da sua clínica ainda te incomoda. Se quiser dar uma olhada por conta: https://www.captaclin.com.br`;

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
