import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * CHAVES OPERACIONAIS — o que o painel liga e desliga sem reiniciar o serviço.
 *
 * Nasceu da Etapa 3B: `APIFY_SWEEP_ENABLED` é variável de ambiente, e um botão
 * na tela não muda variável de ambiente. Mudar pela API do Railway resolveria
 * no papel, mas cada clique reiniciaria o serviço — derrubando conversa em
 * andamento para ligar uma varredura.
 *
 * A trava ficou HÍBRIDA, e as duas camadas têm papéis diferentes:
 *
 *   APIFY_SWEEP_ENABLED (Railway) → interruptor geral, mexido raramente
 *   varredura_ativa     (aqui)    → o botão do dia a dia, na tela
 *
 * O worker exige as DUAS verdadeiras. Assim o painel opera sozinho, e se algo
 * der muito errado o interruptor geral derruba tudo mesmo que o banco diga
 * "true".
 *
 * É tabela chave/valor, e não coluna dedicada, porque a próxima chave
 * operacional (e vai haver outra) não deve exigir migração de schema. O valor
 * é `text` pelo mesmo motivo: quem lê converte, como já se faz com as
 * variáveis de ambiente do repo.
 */
export const configuracoesTable = pgTable("configuracoes", {
  chave: text("chave").primaryKey(),
  valor: text("valor").notNull(),
  atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
});

export const insertConfiguracaoSchema = createInsertSchema(
  configuracoesTable,
).omit({
  atualizadoEm: true,
});
export type InsertConfiguracao = z.infer<typeof insertConfiguracaoSchema>;
export type Configuracao = typeof configuracoesTable.$inferSelect;
