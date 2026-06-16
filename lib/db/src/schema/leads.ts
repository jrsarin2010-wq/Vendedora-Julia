import { pgTable, serial, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const funnelStageEnum = pgEnum("funnel_stage", [
  "new",
  "contacted",
  "qualified",
  "interested",
  "objection",
  "closing",
  "closed",
  "lost",
]);

export const leadStatusEnum = pgEnum("lead_status", [
  "hot",
  "warm",
  "cold",
  "closed",
  "lost",
]);

export const planInterestEnum = pgEnum("plan_interest", [
  "basic",
  "essencial",
  "pro",
]);

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  name: text("name"),
  phone: text("phone").notNull().unique(),
  origin: text("origin"),
  funnelStage: funnelStageEnum("funnel_stage").notNull().default("new"),
  painPoints: text("pain_points"),
  mainObjection: text("main_objection"),
  planInterest: planInterestEnum("plan_interest"),
  status: leadStatusEnum("status").notNull().default("cold"),
  notes: text("notes"),
  lastMessageAt: timestamp("last_message_at"),
  handoffRequested: boolean("handoff_requested").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertLeadSchema = createInsertSchema(leadsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
