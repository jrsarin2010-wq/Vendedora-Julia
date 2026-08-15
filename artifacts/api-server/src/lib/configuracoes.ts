/**
 * LEITURA E ESCRITA DAS CHAVES OPERACIONAIS (tabela `configuracoes`).
 *
 * Só o suficiente para o botão da varredura. Nada de cache: a leitura acontece
 * uma vez por ciclo de 60s, e um cache aqui só criaria a janela em que a tela
 * diz "desligado" e o worker ainda dispara — que é justamente o que este botão
 * existe para impedir.
 */
import { db, configuracoesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** A chave do botão de liga/desliga da varredura. */
export const CHAVE_VARREDURA_ATIVA = "varredura_ativa";

/** Lê uma chave. Ausente devolve null — quem chama decide o default. */
export async function lerConfig(chave: string): Promise<string | null> {
  const linhas = await db
    .select()
    .from(configuracoesTable)
    .where(eq(configuracoesTable.chave, chave))
    .limit(1);
  return linhas[0]?.valor ?? null;
}

/**
 * Grava uma chave (cria ou atualiza).
 *
 * `onConflictDoUpdate` em vez de "select e depois insert ou update": entre a
 * leitura e a escrita cabe outro clique, e o upsert do Postgres resolve isso
 * numa ida só.
 */
export async function gravarConfig(chave: string, valor: string): Promise<void> {
  await db
    .insert(configuracoesTable)
    .values({ chave, valor })
    .onConflictDoUpdate({
      target: configuracoesTable.chave,
      set: { valor, atualizadoEm: new Date() },
    });
}

/**
 * A varredura está ligada NO PAINEL?
 *
 * Ausente = DESLIGADA, de propósito. É o mesmo princípio do
 * `APIFY_SWEEP_ENABLED`: o que gasta dinheiro nasce desligado e só anda depois
 * de alguém dizer que sim. Um banco recém-migrado não pode começar a varrer
 * porque ninguém escreveu a linha ainda.
 */
export async function varreduraAtivaNoPainel(): Promise<boolean> {
  return (await lerConfig(CHAVE_VARREDURA_ATIVA)) === "true";
}

/** O que o botão da tela chama. */
export async function definirVarreduraAtiva(ativa: boolean): Promise<void> {
  await gravarConfig(CHAVE_VARREDURA_ATIVA, ativa ? "true" : "false");
}
