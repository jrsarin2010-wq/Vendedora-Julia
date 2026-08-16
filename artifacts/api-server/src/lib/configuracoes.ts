/**
 * LEITURA E ESCRITA DAS CHAVES OPERACIONAIS (tabela `configuracoes`).
 *
 * Só o suficiente para os botões do painel. Nada de cache: a leitura acontece
 * uma vez por ciclo de 60s, e um cache aqui só criaria a janela em que a tela
 * diz "desligado" e o worker ainda dispara — que é justamente o que estes
 * botões existem para impedir.
 */
import { db, configuracoesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
/**
 * ALIAS OBRIGATÓRIO. Existem DUAS funções chamadas `lerConfig` no projeto: a
 * daqui, que lê uma chave do banco, e a de lib/outreach.ts, que lê as
 * variáveis de ambiente da prospecção. Um relatório já leu o nome e concluiu a
 * origem errada do `juliaLigada` — este é o único arquivo onde as duas se
 * encontram, e importar sem apelido seria reproduzir a confusão em código.
 */
import { lerConfig as lerConfigDeOutreach } from "./outreach";

/** A chave do botão de liga/desliga da varredura. */
export const CHAVE_VARREDURA_ATIVA = "varredura_ativa";

/** A chave do botão de liga/desliga da verificação de WhatsApp (Etapa 3A). */
export const CHAVE_VERIFICACAO_ATIVA = "verificacao_ativa";

/** A chave do botão de liga/desliga da abordagem (Etapa 4). */
export const CHAVE_OUTREACH_ATIVO = "outreach_ativo";

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

/**
 * A verificação de WhatsApp está ligada NO PAINEL?
 *
 * Ausente = DESLIGADA, pelo mesmo princípio da varredura. Aqui o que se gasta
 * não é crédito, é a instância da Evolution que atende os dentistas — e um
 * banco recém-migrado não pode começar a competir com conversa real porque
 * ninguém escreveu a linha ainda.
 */
export async function verificacaoAtivaNoPainel(): Promise<boolean> {
  return (await lerConfig(CHAVE_VERIFICACAO_ATIVA)) === "true";
}

export async function definirVerificacaoAtiva(ativa: boolean): Promise<void> {
  await gravarConfig(CHAVE_VERIFICACAO_ATIVA, ativa ? "true" : "false");
}

/**
 * A abordagem está ligada NO PAINEL? (Etapa 4)
 *
 * Ausente = DESLIGADA, pelo mesmo princípio das outras duas. Aqui o que está em
 * jogo é o mais caro dos três: mensagem fria saindo para dentista que nunca
 * pediu contato. Um banco recém-migrado não pode começar a abordar gente
 * porque ninguém escreveu a linha ainda.
 */
export async function outreachAtivoNoPainel(): Promise<boolean> {
  return (await lerConfig(CHAVE_OUTREACH_ATIVO)) === "true";
}

export async function definirOutreachAtivo(ativo: boolean): Promise<void> {
  await gravarConfig(CHAVE_OUTREACH_ATIVO, ativo ? "true" : "false");
}

/**
 * AS DUAS CAMADAS JUNTAS — a resposta a "a Júlia vai abordar alguém?".
 *
 * Existe para haver UMA definição do estado combinado. Ela é lida em três
 * lugares que precisam concordar: o status do painel, o aviso ao lado do botão
 * de promover, e (em partes, para o motivo do log ser específico) os
 * agendadores. Três `env && banco` copiados divergiriam no primeiro dia em que
 * alguém mexesse num só.
 *
 * O `&&` avalia a env primeiro de propósito: é a mesma ordem dos agendadores,
 * e com o interruptor geral desligado não há motivo para ir ao banco.
 *
 * O que ela NÃO governa: responder quem já está conversando. Isso não passa
 * por aqui nem por nenhuma trava — ver o comentário do webhook.
 */
export async function abordagemLigada(): Promise<boolean> {
  return lerConfigDeOutreach().habilitado && (await outreachAtivoNoPainel());
}
