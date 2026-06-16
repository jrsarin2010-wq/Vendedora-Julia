import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "audio",
  "image",
]);

export const leadMessagesTable = pgTable("lead_messages", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leadsTable.id, { onDelete: "cascade" }),
  direction: messageDirectionEnum("direction").notNull(),
  content: text("content").notNull(),
  messageType: messageTypeEnum("message_type").notNull().default("text"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLeadMessageSchema = createInsertSchema(leadMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertLeadMessage = z.infer<typeof insertLeadMessageSchema>;
export type LeadMessage = typeof leadMessagesTable.$inferSelect;
