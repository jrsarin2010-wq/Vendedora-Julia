/**
 * NÚMERO NÃO ENTREGÁVEL (Rodada 51) — quando desistir de um telefone.
 *
 * O buraco que isto fecha: o agendador de abordagem pega sempre o lead
 * PENDENTE mais antigo. Se o envio para ele falha para sempre (número fixo,
 * sem WhatsApp, digitado errado na planilha), ele continuava "pending" e
 * voltava a ser o escolhido a CADA ciclo — nenhum outro lead recebia nada, e
 * cada tentativa gastava uma chamada de modelo. Com a janela de 9h, eram até
 * ~540 gerações por dia queimadas num número morto, em silêncio.
 *
 * A regra: só falha PERMANENTE conta (a Evolution rejeitou o destinatário —
 * ver `EnvioWhatsApp.falhaPermanente` em integrations.ts). Queda ou timeout da
 * Evolution não incrementa nada: o lead não tem culpa da infra, e uma hora de
 * instabilidade não pode condenar a fila inteira. Na terceira permanente
 * seguida, desiste-se do número: sai da fila, os follow-ups pendentes morrem e
 * o Dr. Sarinho é avisado no Telegram — porque número errado em planilha é
 * consertável, e desistência silenciosa não se conserta.
 */
import { db } from "@workspace/db";
import { leadsTable, followUpsTable, type Lead } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendTelegramNaoEntregavel } from "./integrations";
import { logger } from "./logger";

/**
 * Três, e não uma: o 400 da Evolution é determinístico na teoria, mas uma
 * resposta espúria não pode descartar um lead sozinha. Três ciclos são 3
 * minutos na abordagem — barato o bastante para não travar a fila, caro o
 * bastante para não descartar por soluço.
 */
export const MAX_FALHAS_DE_ENVIO = 3;

/** O que `registrarFalhaPermanente` precisa saber do lead. */
type LeadComFalhas = Pick<
  Lead,
  "id" | "name" | "phone" | "clinicName" | "outreachStatus"
> & { falhasDeEnvio?: number | null };

export interface ResultadoDaFalha {
  /** true quando ESTA falha esgotou as tentativas e o número foi descartado. */
  desistiu: boolean;
  falhas: number;
}

/**
 * Registra uma falha permanente de envio para este lead. Na terceira, desiste:
 * tira da fila de prospecção (se ainda estava nela), cancela TODOS os
 * follow-ups pendentes — se o número não recebe, nenhum toque futuro recebe —
 * e alerta o Telegram.
 *
 * `contexto` é o que estava sendo enviado ("abordagem", "toque de abordagem"),
 * para o alerta e o log contarem a história completa.
 */
export async function registrarFalhaPermanente(
  lead: LeadComFalhas,
  contexto: string,
): Promise<ResultadoDaFalha> {
  const falhas = (lead.falhasDeEnvio ?? 0) + 1;

  if (falhas < MAX_FALHAS_DE_ENVIO) {
    await db
      .update(leadsTable)
      .set({ falhasDeEnvio: falhas, updatedAt: new Date() })
      .where(eq(leadsTable.id, lead.id));
    logger.warn(
      { leadId: lead.id, phone: lead.phone, falhas, contexto },
      `Evolution rejeitou o número (falha permanente ${falhas}/${MAX_FALHAS_DE_ENVIO}) — ainda vai tentar de novo`,
    );
    return { desistiu: false, falhas };
  }

  await db
    .update(leadsTable)
    .set({
      falhasDeEnvio: falhas,
      updatedAt: new Date(),
      // Só quem ainda esperava a primeira mensagem muda de estado: um lead já
      // "sent" mantém o histórico do que de fato aconteceu com ele.
      ...(lead.outreachStatus === "pending"
        ? { outreachStatus: "nao_entregavel" as const }
        : {}),
    })
    .where(eq(leadsTable.id, lead.id));

  await db
    .update(followUpsTable)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(followUpsTable.leadId, lead.id),
        eq(followUpsTable.status, "pending"),
      ),
    );

  await sendTelegramNaoEntregavel({ lead, tentativas: falhas, contexto });

  logger.error(
    { leadId: lead.id, phone: lead.phone, falhas, contexto },
    "Número não entregável: saiu da fila, follow-ups cancelados, Telegram avisado",
  );

  return { desistiu: true, falhas };
}

/**
 * Um envio ENTREGUE zera a contagem — as falhas têm que ser seguidas. Sem
 * isto, duas rejeições espúrias com meses de distância somariam com uma
 * terceira e descartariam um número que funciona.
 *
 * Só escreve no banco quando há o que zerar, para o caminho feliz (que é
 * quase sempre) não pagar um update extra.
 */
export async function limparFalhasDeEnvio(
  lead: Pick<Lead, "id"> & { falhasDeEnvio?: number | null },
): Promise<void> {
  if (!lead.falhasDeEnvio) return;
  await db
    .update(leadsTable)
    .set({ falhasDeEnvio: 0, updatedAt: new Date() })
    .where(eq(leadsTable.id, lead.id));
}
