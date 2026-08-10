import { db } from "@workspace/db";
import { followUpsTable, leadsTable, leadMessagesTable } from "@workspace/db";
import { eq, lte, and } from "drizzle-orm";
import { sendWhatsAppMessage } from "./integrations";
import { logger } from "./logger";
import { saudacao } from "./tratamento";

/**
 * Uma passada do agendador: pega os follow-ups vencidos e manda os que devem
 * sair. Exportada (como `rodarCicloDeAbordagem`, do outreach) para o teste
 * conseguir exercitar a decisão sem depender de `setInterval`.
 */
export async function rodarCicloDeFollowUp(): Promise<void> {
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
          lte(followUpsTable.scheduledAt, now),
        ),
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

      // O humano está conversando com este lead agora. Um follow-up caindo no
      // meio disso é a Júlia atravessando a conversa dele — pior do que o
      // follow-up atrasar.
      //
      // Fica "pending" de propósito, sem cancelar: o agendador roda a cada 5
      // minutos, então assim que a pausa vencer o toque sai na rodada
      // seguinte. Cancelar aqui perderia o follow-up para sempre por causa de
      // uma janela de 5 minutos.
      if (
        lead.pausedUntil &&
        new Date(lead.pausedUntil).getTime() > now.getTime()
      ) {
        logger.info(
          {
            leadId: lead.id,
            touchNumber: followUp.touchNumber,
            pausedUntil: lead.pausedUntil,
          },
          "Lead pausado (humano assumiu) — follow-up adiado, segue pendente",
        );
        continue;
      }

      // Rede de segurança: só cai aqui se o follow-up foi criado sem template.
      // Tom igual ao dos templates: curto, usa o mesmo saudacao() dos demais
      // (Dr./Dra. conforme o nome, ou só o nome quando ambíguo) e não promete
      // nada — só abre a porta e deixa o link.
      const message =
        followUp.messageTemplate ??
        `${saudacao(lead.name)}aqui é a Júlia do CaptaClin 😊 Passando pra saber se o WhatsApp da sua clínica ainda te incomoda. Se quiser dar uma olhada por conta: https://www.captaclin.com.br`;

      const delivered = await sendWhatsAppMessage(lead.phone, message);

      // Se não entregou, NÃO grava no histórico e NÃO marca como enviado: o
      // follow-up fica "pending" e a próxima rodada (5 min) tenta de novo.
      // Sem isso, o painel mostraria um toque que o dentista nunca recebeu.
      if (!delivered) {
        logger.error(
          { leadId: lead.id, touchNumber: followUp.touchNumber },
          "Follow-up NÃO entregue — segue pendente para nova tentativa",
        );
        continue;
      }

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

      logger.info(
        { leadId: lead.id, touchNumber: followUp.touchNumber },
        "Follow-up sent",
      );
    }
  } catch (err) {
    logger.error({ err }, "Follow-up scheduler error");
  }
}

export function startFollowUpScheduler(): void {
  // Run every 5 minutes
  const INTERVAL_MS = 5 * 60 * 1000;

  // Run immediately then on interval
  rodarCicloDeFollowUp();
  setInterval(rodarCicloDeFollowUp, INTERVAL_MS);
  logger.info("Follow-up scheduler started");
}
