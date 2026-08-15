/**
 * O RITMO FRIO É UM SÓ (Rodada 51) — a contagem que os dois agendadores dividem.
 *
 * Antes, cada agendador contava só as próprias mensagens: a cota de
 * OUTREACH_PER_DAY valia para as ABERTURAS, e os toques de abordagem (+3d/+10d)
 * e as reativações saíam POR FORA. Numa campanha de 40 leads, o dia D+3 podia
 * somar 40 aberturas novas MAIS os 40 toques vencidos — o dobro da cota, num
 * número sem histórico. E o intervalo mínimo também era por agendador: um toque
 * podia sair segundos depois de uma abertura, porque nenhum dos dois sabia do
 * outro.
 *
 * Este módulo é a fonte única: TODA mensagem fria — abertura, toque de
 * abordagem, reativação — conta no mesmo balde, e é este balde que alimenta o
 * limite por hora, o limite por dia e o intervalo mínimo nos dois agendadores
 * (e na prévia do painel, para os contadores baterem com a realidade).
 *
 * Follow-up de CONVERSA fica de fora, de propósito: quem respondeu pediu o
 * contato, e a cota existe para proteger o número de quem não pediu.
 */
import { db } from "@workspace/db";
import { leadsTable, followUpsTable } from "@workspace/db";
import { and, eq, gte, isNotNull, inArray } from "drizzle-orm";

/**
 * Janela de envios buscada no banco para contar o ritmo. 26 horas cobre o dia
 * inteiro de São Paulo com folga, em qualquer fuso do servidor.
 *
 * Contar pelo BANCO, e não por um contador em memória, é o que faz o limite
 * sobreviver a um restart: sem isso, um deploy no meio da tarde zeraria a
 * conta e a Júlia poderia mandar tudo de novo no mesmo dia.
 */
export const JANELA_DE_CONTAGEM_MS = 26 * 60 * 60 * 1000;

/**
 * As datas de TODOS os envios frios da janela: aberturas (carimbo em
 * leads.outreachSentAt) e toques de abordagem/reativação (carimbo em
 * follow_ups.sentAt). Não há sobreposição — a abertura não vira follow-up.
 * Quem chama passa o resultado para `contarEnvios` (lib/outreach.ts).
 */
export async function datasDeEnviosFrios(agora: Date): Promise<Date[]> {
  const corte = new Date(agora.getTime() - JANELA_DE_CONTAGEM_MS);

  // As chaves da projeção repetem o nome da coluna de propósito: o stub de
  // teste do banco devolve a linha crua, ignorando a projeção — com outro
  // nome, o teste leria `undefined` e a contagem daria zero em silêncio.
  const aberturas = await db
    .select({ outreachSentAt: leadsTable.outreachSentAt })
    .from(leadsTable)
    .where(
      and(
        isNotNull(leadsTable.outreachSentAt),
        gte(leadsTable.outreachSentAt, corte),
      ),
    );

  const toques = await db
    .select({ sentAt: followUpsTable.sentAt })
    .from(followUpsTable)
    .where(
      and(
        inArray(followUpsTable.kind, ["abordagem", "reativacao"]),
        eq(followUpsTable.status, "sent"),
        isNotNull(followUpsTable.sentAt),
        gte(followUpsTable.sentAt, corte),
      ),
    );

  return [
    ...aberturas.map((r) => r.outreachSentAt),
    ...toques.map((r) => r.sentAt),
  ].filter((d): d is Date => d instanceof Date);
}
