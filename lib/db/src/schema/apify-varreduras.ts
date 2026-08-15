import {
  pgTable,
  serial,
  text,
  char,
  integer,
  numeric,
  timestamp,
  pgEnum,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * "cancelada" existe desde já, mesmo sem uso: é o jeito de abortar uma rodada
 * sem apagar histórico, e acrescentar valor a um enum do Postgres depois é
 * mudança de tipo — melhor nascer completo.
 */
export const varreduraStatusEnum = pgEnum("varredura_status", [
  "pendente",
  "executando",
  "concluida",
  "falhou",
  "cancelada",
]);

/**
 * FILA DE VARREDURAS DO APIFY — cada linha é uma rodada do ator
 * `compass/crawler-google-places`: um termo de busca numa cidade.
 *
 * O worker (Etapa 2) consome esta fila devagar, com teto diário e trava de
 * orçamento. As linhas nascem pela rota de seed (routes/varreduras-seed.ts),
 * nunca pelo deploy.
 */
export const apifyVarredurasTable = pgTable(
  "apify_varreduras",
  {
    id: serial("id").primaryKey(),
    termoBusca: text("termo_busca").notNull(),
    cidade: text("cidade").notNull(),
    uf: char("uf", { length: 2 }).notNull(),
    // 15 não é preferência, é consequência do crédito Free do Apify: medido na
    // calibração, o lugar custa US$ 0,005, e 54 × 15 × 0,005 = US$ 4,05, que
    // cabe no teto de 4,50. Se migrar de plano, sobe aqui (é dado, não código).
    maxResultados: integer("max_resultados").notNull().default(15),
    // 1 = os 10 maiores mercados, disparados primeiro.
    prioridade: integer("prioridade").notNull().default(2),
    status: varreduraStatusEnum("status").notNull().default("pendente"),
    apifyRunId: text("apify_run_id"),
    apifyDatasetId: text("apify_dataset_id"),
    resultadosRecebidos: integer("resultados_recebidos").notNull().default(0),
    // Custo EFETIVO lido do objeto de run do Apify, não estimativa. É a soma
    // deste campo no mês corrente que a trava de orçamento do worker confere
    // antes de disparar qualquer rodada.
    custoRealUsd: numeric("custo_real_usd", { precision: 10, scale: 4 })
      .notNull()
      .default("0"),
    tentativas: integer("tentativas").notNull().default(0),
    erroMensagem: text("erro_mensagem"),
    // Base da cota diária ("no máximo 10 rodadas/dia" conta por esta data).
    disparadaEm: timestamp("disparada_em"),
    concluidaEm: timestamp("concluida_em"),
    criadaEm: timestamp("criada_em").notNull().defaultNow(),
  },
  (t) => [
    // Disparar a mesma combinação duas vezes é o erro mais caro deste
    // pipeline: paga o ator de novo para receber as mesmas clínicas. A
    // restrição no banco torna o engano impossível, não só improvável.
    unique("uq_varredura").on(t.termoBusca, t.cidade, t.uf),
    index("idx_varreduras_fila").on(t.status, t.prioridade, t.id),
  ],
);

export const insertApifyVarreduraSchema = createInsertSchema(
  apifyVarredurasTable,
).omit({
  id: true,
  criadaEm: true,
});
export type InsertApifyVarredura = z.infer<typeof insertApifyVarreduraSchema>;
export type ApifyVarredura = typeof apifyVarredurasTable.$inferSelect;
