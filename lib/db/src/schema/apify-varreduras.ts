import {
  pgTable,
  serial,
  text,
  char,
  integer,
  numeric,
  timestamp,
  pgEnum,
  uniqueIndex,
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
    //
    // É ÍNDICE ÚNICO, e não `unique()`, por um motivo medido: o drizzle-kit
    // 0.31.10 não casa uma unique COMPOSTA declarada como constraint com o
    // que já existe no banco, e repropunha a criação dela a cada push. Numa
    // tabela vazia isso passava batido; com as 54 linhas da fila virou uma
    // pergunta interativa ("quer truncar a tabela?") que morre no contêiner —
    // e o drizzle saía com código 0, deixando o deploy verde e o schema por
    // aplicar. Testado: com nome automático o problema é idêntico, então não
    // era o nome. Ver lib/db/README.md.
    //
    // A garantia é a mesma: índice único também sustenta o
    // `ON CONFLICT (termo_busca, cidade, uf)` do seed.
    uniqueIndex("uq_varredura").on(t.termoBusca, t.cidade, t.uf),
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
