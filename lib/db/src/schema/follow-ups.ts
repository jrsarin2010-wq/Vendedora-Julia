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
 * "reativacao" — a cadência de conversa acabou sem fechar (Rodada 41). São até
 *   três toques longos (+30/+60/+90 dias), só para quem chegou a esquentar
 *   (warm/hot), cada um com saída explícita. O texto NÃO fica gravado aqui:
 *   é montado na hora do envio, porque a dor e a novidade de 60 dias depois
 *   podem não ser as de hoje.
 *
 * A distinção mora no banco, e não numa dedução em tempo de envio, porque é ela
 * que decide o TEXTO que sai para alguém que não pediu contato. Deduzir errado
 * aqui é a Júlia dizendo "a gente começou a conversar" para quem nunca falou
 * com ela.
 */
export const followUpKindEnum = pgEnum("follow_up_kind", [
  "conversa",
  "abordagem",
  "reativacao",
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
  // Quando REALMENTE saiu (nulo enquanto pendente/cancelado). Existe por causa
  // do limite diário da reativação — "no máximo 10 por dia" precisa saber
  // quantas saíram HOJE, e a data de criação não diz isso.
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFollowUpSchema = createInsertSchema(followUpsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFollowUp = z.infer<typeof insertFollowUpSchema>;
export type FollowUp = typeof followUpsTable.$inferSelect;
