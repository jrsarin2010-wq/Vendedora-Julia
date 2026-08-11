import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";

export const followUpStatusEnum = pgEnum("follow_up_status", [
  "pending",
  "sent",
  "cancelled",
]);

/**
 * De QUAL cadência este toque é.
 *
 * "conversa" — o dentista já respondeu alguma coisa. São os quatro toques que
 *   podem citar a dor que ele contou, porque ela existe.
 * "abordagem" — ele recebeu a primeira mensagem e NUNCA respondeu. São dois
 *   toques, e nenhum deles pode citar conversa nem dor: não houve nem uma nem
 *   outra.
 *
 * A distinção mora no banco, e não numa dedução em tempo de envio, porque é ela
 * que decide o TEXTO que sai para alguém que não pediu contato. Deduzir errado
 * aqui é a Júlia dizendo "a gente começou a conversar" para quem nunca falou
 * com ela.
 */
export const followUpKindEnum = pgEnum("follow_up_kind", [
  "conversa",
  "abordagem",
]);

export const followUpsTable = pgTable("follow_ups", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leadsTable.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at").notNull(),
  touchNumber: integer("touch_number").notNull().default(1),
  kind: followUpKindEnum("kind").notNull().default("conversa"),
  messageTemplate: text("message_template"),
  status: followUpStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFollowUpSchema = createInsertSchema(followUpsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFollowUp = z.infer<typeof insertFollowUpSchema>;
export type FollowUp = typeof followUpsTable.$inferSelect;
