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

/**
 * Situação do lead na PROSPECÇÃO ATIVA (quando é a Júlia que puxa conversa).
 * Nada a ver com o funil de venda: um lead pode estar "sent" aqui e ainda
 * assim em qualquer etapa do funil, conforme o que ele responder.
 */
export const outreachStatusEnum = pgEnum("outreach_status", [
  "none", // não é lead de prospecção — chegou sozinho pelo WhatsApp
  "pending", // importado, esperando a primeira mensagem
  "sent", // primeira mensagem enviada
  "skipped", // descartado (telefone inválido, duplicado, opt-out prévio)
]);

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  name: text("name"),
  phone: text("phone").notNull().unique(),
  // "whatsapp" (chegou sozinho), "import", "maps", "instagram"
  origin: text("origin"),
  // Dados da clínica, preenchidos na importação para a Júlia ter o que dizer
  // na primeira mensagem ("vi a Odonto Vida no Instagram").
  clinicName: text("clinic_name"),
  instagram: text("instagram"),
  city: text("city"),
  outreachStatus: outreachStatusEnum("outreach_status").notNull().default("none"),
  outreachSentAt: timestamp("outreach_sent_at"),
  funnelStage: funnelStageEnum("funnel_stage").notNull().default("new"),
  painPoints: text("pain_points"),
  mainObjection: text("main_objection"),
  planInterest: planInterestEnum("plan_interest"),
  status: leadStatusEnum("status").notNull().default("cold"),
  notes: text("notes"),
  // Áudios de demonstração já enviados a este lead, separados por vírgula
  // ("vou_pensar,fora_do_horario"). É o que impede repetir a mesma demo, que
  // destruiria o efeito, e passar do teto de duas por conversa.
  demosEnviadas: text("demos_enviadas"),
  lastMessageAt: timestamp("last_message_at"),
  // Até quando a Júlia fica calada nesta conversa porque um humano assumiu.
  // Preenchido quando chega uma mensagem `fromMe` que NÃO fomos nós que
  // enviamos — ou seja, alguém respondeu pelo celular. Nulo (ou no passado)
  // significa conversa normal.
  pausedUntil: timestamp("paused_until"),
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
