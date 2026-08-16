/**
 * Os botões do painel, do lado do TESTE.
 *
 * A trava da abordagem é híbrida desde a Etapa 4: a env (`OUTREACH_ENABLED`) e
 * a chave `outreach_ativo` no banco, e o agendador exige as duas. Como
 * `state.reset()` zera a tabela `configuracoes`, e chave ausente significa
 * DESLIGADA, todo cenário que espera a Júlia abordando precisa ligar as duas.
 *
 * Existe como helper compartilhado porque cinco arquivos de teste precisam
 * disso depois de cada reset — e a alternativa (empurrar a linha na mão em
 * cada um) já começaria divergindo no nome da chave.
 */
import { state } from "./stubs/db.mjs";
import { CHAVE_OUTREACH_ATIVO } from "../src/lib/configuracoes";

/** Liga (ou desliga) a abordagem no painel — a camada de BANCO da trava. */
export function abordagemNoPainel(ativo: boolean): void {
  const valor = ativo ? "true" : "false";
  const linha = state.configuracoes.find(
    (c: { chave: string }) => c.chave === CHAVE_OUTREACH_ATIVO,
  );
  if (linha) linha.valor = valor;
  else state.configuracoes.push({ chave: CHAVE_OUTREACH_ATIVO, valor });
}
