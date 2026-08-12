import { db } from "@workspace/db";
import { followUpsTable, leadsTable, leadMessagesTable } from "@workspace/db";
import { eq, lte, and, desc } from "drizzle-orm";
import { sendWhatsAppMessage } from "./integrations";
import { logger } from "./logger";
import { saudacao } from "./tratamento";
import {
  verificarSemResposta,
  marcarAtencao,
  pareceMensagemComPromessa,
} from "./atencao";
import { lerConfig, podeDispararAgora, EXPLICACAO_BLOQUEIO } from "./outreach";
import {
  ABORDAGEM_TOQUES,
  ABORDAGEM_DELAYS_HOURS,
  TOQUES_REATIVACAO,
  REATIVACAO_DELAYS_DIAS,
} from "../julia-persona";
import {
  LIMITE_REATIVACOES_POR_DIA,
  EXPLICACAO_FORA,
  elegivelParaReativacao,
  decidirToqueDeReativacao,
  lerNovidade,
  contarReativacoesDeHoje,
} from "./reativacao";

/**
 * Um toque de ABORDAGEM (ou de REATIVAÇÃO) pode sair NESTE instante?
 *
 * A abordagem não é follow-up de conversa: quem recebe nunca respondeu nada,
 * então é mensagem fria e vale a MESMA janela da prospecção — inclusive a
 * trava mestra. A reativação pega a mesma regra por outro motivo: quem está
 * nela ficou 30+ dias sem notícia nossa, e "passei pra te contar uma novidade"
 * no domingo à noite tem o mesmo cheiro de robô que a mensagem fria.
 * Se o Dr. Sarinho desligar OUTREACH_ENABLED porque as entregas começaram a
 * falhar, os toques já agendados precisam parar junto; senão a trava de
 * emergência protege metade do problema e ele descobre isso do pior jeito.
 *
 * Sem isto, um toque agendado para 3 dias depois de uma quinta-feira cairia num
 * domingo: "passei por aqui de novo" no domingo é exatamente o que faz um
 * dentista denunciar o número.
 *
 * Os contadores de volume vão zerados de propósito — ver `TOQUES_FRIOS_POR_CICLO`
 * logo abaixo para o que isso significa e o que fica de fora.
 */
function toqueFrioPodeSair(agora: Date): { pode: boolean; motivo?: string } {
  const decisao = podeDispararAgora({
    config: lerConfig(),
    agora,
    enviadosNaUltimaHora: 0,
    enviadosHoje: 0,
    ultimoEnvio: null,
    intervaloExigidoSegundos: 0,
  });
  return { pode: decisao.pode, motivo: decisao.motivo };
}

/**
 * Quantos toques frios saem por rodada. UM.
 *
 * O agendador roda a cada 5 minutos e pega até 20 vencidos de uma vez. Numa
 * campanha de 40 leads, todos os toques do dia 3 vencem em bloco — e vinte
 * mensagens de texto IDÊNTICO saindo no mesmo segundo para vinte números é a
 * assinatura de robô mais óbvia que existe. Um por rodada espalha os envios
 * pela janela do dia, do mesmo jeito que o agendador de abordagem faz.
 *
 * LIMITAÇÃO CONHECIDA, registrada de propósito: os toques NÃO consomem a cota
 * diária de OUTREACH_PER_DAY, que conta só primeiras mensagens. Num dia cheio,
 * o número pode mandar até `porDia` abordagens MAIS os toques que vencerem
 * naquele dia. Quem for calibrar o volume precisa dimensionar OUTREACH_PER_DAY
 * contando com isso.
 */
const TOQUES_FRIOS_POR_CICLO = 1;

/**
 * Reativações por rodada: UMA, pelo mesmo motivo dos toques frios. Com o
 * agendador rodando a cada 5 minutos, é isso que espalha os envios pela janela
 * do dia com intervalo irregular — dez leads vencendo juntos no dia +30 sairiam
 * em bloco, e reativação em bloco é assinatura de robô.
 */
const REATIVACOES_POR_CICLO = 1;

/**
 * Uma passada do agendador: pega os follow-ups vencidos e manda os que devem
 * sair. Exportada (como `rodarCicloDeAbordagem`, do outreach) para o teste
 * conseguir exercitar a decisão sem depender de `setInterval`.
 *
 * `agora` também vem de fora pelo mesmo motivo que lá: desde que os toques de
 * abordagem respeitam a janela da prospecção, "domingo à noite não sai" é uma
 * decisão testável — e testá-la esperando domingo não é opção.
 */
export async function rodarCicloDeFollowUp(agora: Date = new Date()): Promise<void> {
  try {
    const now = agora;
    let toquesFriosNesteCiclo = 0;
    let reativacoesNesteCiclo = 0;
    // Contado no banco (não em memória) para o limite diário sobreviver a
    // restart — mesma decisão do agendador de abordagem. Preguiçoso: só
    // consulta quando uma reativação de fato vence neste ciclo.
    let reativacoesDeHoje: number | null = null;

    // Find pending follow-ups that are due
    const due = await db
      .select({
        followUp: followUpsTable,
        lead: leadsTable,
      })
      .from(followUpsTable)
      .innerJoin(leadsTable, eq(followUpsTable.leadId, leadsTable.id))
      .where(
        and(
          eq(followUpsTable.status, "pending"),
          lte(followUpsTable.scheduledAt, now),
        ),
      )
      .limit(20);

    for (const { followUp, lead } of due) {
      // Skip if lead is closed/lost
      if (lead.status === "closed" || lead.status === "lost") {
        await db
          .update(followUpsTable)
          .set({ status: "cancelled" })
          .where(eq(followUpsTable.id, followUp.id));
        continue;
      }

      // O humano está conversando com este lead agora. Um follow-up caindo no
      // meio disso é a Júlia atravessando a conversa dele — pior do que o
      // follow-up atrasar.
      //
      // Fica "pending" de propósito, sem cancelar: o agendador roda a cada 5
      // minutos, então assim que a pausa vencer o toque sai na rodada
      // seguinte. Cancelar aqui perderia o follow-up para sempre por causa de
      // uma janela de 5 minutos.
      if (
        lead.pausedUntil &&
        new Date(lead.pausedUntil).getTime() > now.getTime()
      ) {
        logger.info(
          {
            leadId: lead.id,
            touchNumber: followUp.touchNumber,
            pausedUntil: lead.pausedUntil,
          },
          "Lead pausado (humano assumiu) — follow-up adiado, segue pendente",
        );
        continue;
      }

      // RODADA 36 — o toque 1 de conversa não sai por cima de pendência NOSSA.
      //
      // O caso real: a Júlia prometeu o contrato, ninguém mandou, e uma hora
      // depois o toque 1 chegou com "a gente começou a conversar e acabou
      // ficando pela metade". A conversa não ficou pela metade — ficou com uma
      // promessa dela em aberto. Do lado do dentista, o toque soa como ela
      // ignorando o que ele pediu.
      //
      // Por isso, antes do toque 1: se o lead já está marcado para atenção
      // (central de vigia, Rodada 33), ou se a ÚLTIMA mensagem da conversa é
      // nossa e contém uma promessa ("vou pedir pra", "deixa eu confirmar"...),
      // o toque é CANCELADO — não adiado — e o lead vai para a central. É caso
      // de gente entregar o prometido, não de robô puxar assunto. Os toques
      // seguintes (24h em diante) ficam: se ninguém resolveu até lá, silêncio
      // eterno seria pior.
      if (followUp.kind === "conversa" && followUp.touchNumber === 1) {
        let motivo: string | null = null;

        if (lead.atencao) {
          motivo = `lead já marcado para atenção (${lead.atencao})`;
        } else {
          const ultima = (
            await db
              .select()
              .from(leadMessagesTable)
              .where(eq(leadMessagesTable.leadId, lead.id))
              .orderBy(desc(leadMessagesTable.createdAt))
              .limit(1)
          )[0];
          const promessa =
            ultima && ultima.direction === "outbound"
              ? pareceMensagemComPromessa(ultima.content)
              : null;
          if (promessa) {
            motivo = `última mensagem é nossa e promete algo ("${promessa}")`;
            await marcarAtencao(lead, "julia_estranha", ultima.content);
          }
        }

        if (motivo) {
          await db
            .update(followUpsTable)
            .set({ status: "cancelled" })
            .where(eq(followUpsTable.id, followUp.id));
          logger.info(
            { leadId: lead.id, touchNumber: followUp.touchNumber, motivo },
            "Toque 1 suprimido: promessa pendente é caso de gente, não de robô",
          );
          continue;
        }
      }

      // TOQUE DE REATIVAÇÃO (Rodada 41): a fila longa, +30/+60/+90 dias depois
      // do fim da cadência de conversa. O texto é montado AQUI, na hora do
      // envio, porque a dor anotada e a novidade configurada 60 dias atrás
      // podem não ser as de hoje.
      const ehReativacao = followUp.kind === "reativacao";
      let mensagemDeReativacao: string | null = null;
      if (ehReativacao) {
        if (reativacoesNesteCiclo >= REATIVACOES_POR_CICLO) continue;

        // Mesma janela, dias úteis e trava mestra da prospecção. Fora dela o
        // toque ADIA (segue pendente) — inclusive com OUTREACH_ENABLED
        // desligado: é a mesma trava de emergência, e emergência para a fila
        // sem destruí-la.
        const janela = toqueFrioPodeSair(now);
        if (!janela.pode) {
          logger.debug(
            { leadId: lead.id, touchNumber: followUp.touchNumber, motivo: janela.motivo },
            `Reativação adiada: ${
              EXPLICACAO_BLOQUEIO[janela.motivo as keyof typeof EXPLICACAO_BLOQUEIO] ??
              janela.motivo
            }`,
          );
          continue;
        }

        if (reativacoesDeHoje === null) {
          const enviadas = await db
            .select()
            .from(followUpsTable)
            .where(
              and(
                eq(followUpsTable.kind, "reativacao"),
                eq(followUpsTable.status, "sent"),
              ),
            );
          reativacoesDeHoje = contarReativacoesDeHoje(
            enviadas.map((f) => f.sentAt),
            now,
          );
        }
        if (reativacoesDeHoje >= LIMITE_REATIVACOES_POR_DIA) {
          logger.info(
            { leadId: lead.id, hoje: reativacoesDeHoje },
            "Limite diário de reativações atingido — fica para amanhã",
          );
          continue;
        }

        // Em 30+ dias muita coisa muda: virou cliente, pediu para parar, caiu
        // na vigia, ou é o toque 2 sem novidade configurada. Nesses casos o
        // toque MORRE (cancelled) — quem saiu da elegibilidade não volta a ela
        // esperando o próximo ciclo.
        const decisao = decidirToqueDeReativacao(
          followUp.touchNumber,
          lead,
          lerNovidade(),
        );
        if (!decisao.envia) {
          if (decisao.cancela) {
            await db
              .update(followUpsTable)
              .set({ status: "cancelled" })
              .where(eq(followUpsTable.id, followUp.id));
          }
          logger.info(
            { leadId: lead.id, touchNumber: followUp.touchNumber, motivo: decisao.motivo },
            "Toque de reativação não sai",
          );
          continue;
        }

        mensagemDeReativacao =
          followUp.touchNumber === 1
            ? TOQUES_REATIVACAO[1](lead.name, lead.painPoints)
            : followUp.touchNumber === 2
              ? TOQUES_REATIVACAO[2](lead.name, lerNovidade())
              : TOQUES_REATIVACAO[3](lead.name);
      }

      // Toque de ABORDAGEM: mensagem fria, para quem nunca respondeu. Só sai na
      // janela da prospecção e com a trava mestra ligada; fora disso continua
      // "pending" e sai na primeira rodada dentro da janela — mesmo tratamento
      // da pausa humana logo acima, e pelo mesmo motivo (perder o toque é pior
      // que atrasá-lo).
      const ehAbordagem = followUp.kind === "abordagem";
      if (ehAbordagem) {
        if (toquesFriosNesteCiclo >= TOQUES_FRIOS_POR_CICLO) continue;

        const janela = toqueFrioPodeSair(now);
        if (!janela.pode) {
          logger.debug(
            { leadId: lead.id, touchNumber: followUp.touchNumber, motivo: janela.motivo },
            `Toque de abordagem adiado: ${
              EXPLICACAO_BLOQUEIO[janela.motivo as keyof typeof EXPLICACAO_BLOQUEIO] ??
              janela.motivo
            }`,
          );
          continue;
        }
      }

      // Rede de segurança: só cai aqui se o follow-up foi criado sem template.
      // Tom igual ao dos templates: curto, usa o mesmo saudacao() dos demais
      // (Dr./Dra. conforme o nome, ou só o nome quando ambíguo) e não promete
      // nada — só abre a porta e deixa o link.
      //
      // O padrão MUDA conforme a cadência, e não é detalhe: o texto de conversa
      // diz "ainda te incomoda", que pressupõe que ele contou que incomoda.
      // Para quem nunca respondeu isso é falso, e é justamente o erro que a
      // cadência de abordagem existe para corrigir — a rede de segurança não
      // pode ser a porta dos fundos por onde ele volta.
      const message =
        mensagemDeReativacao ??
        followUp.messageTemplate ??
        (ehAbordagem
          ? ABORDAGEM_TOQUES[followUp.touchNumber >= 2 ? 2 : 1](lead.name)
          : `${saudacao(lead.name)}aqui é a Júlia do CaptaClin 😊 Passando pra saber se o WhatsApp da sua clínica ainda te incomoda. Se quiser dar uma olhada por conta: https://www.captaclin.com.br`);

      const delivered = await sendWhatsAppMessage(lead.phone, message);

      // Se não entregou, NÃO grava no histórico e NÃO marca como enviado: o
      // follow-up fica "pending" e a próxima rodada (5 min) tenta de novo.
      // Sem isso, o painel mostraria um toque que o dentista nunca recebeu.
      if (!delivered) {
        logger.error(
          { leadId: lead.id, touchNumber: followUp.touchNumber },
          "Follow-up NÃO entregue — segue pendente para nova tentativa",
        );
        continue;
      }

      // Save outbound follow-up message
      await db.insert(leadMessagesTable).values({
        leadId: lead.id,
        direction: "outbound",
        content: message,
        messageType: "text",
      });

      // Mark as sent. O carimbo de quando saiu alimenta o limite diário da
      // reativação — e não custa nada gravar para os outros tipos também.
      await db
        .update(followUpsTable)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(followUpsTable.id, followUp.id));

      if (ehReativacao) {
        reativacoesNesteCiclo++;
        if (reativacoesDeHoje !== null) reativacoesDeHoje++;
      }

      // FIM DA CADÊNCIA DE CONVERSA → arma a fila longa (Rodada 41).
      //
      // O gatilho é o último toque de conversa sair sem sobrar nada pendente —
      // não um número fixo de toque, porque a cadência tem tamanho variável
      // (2 a 4 toques, conforme a temperatura). Se o dentista responder
      // qualquer coisa depois, o webhook cancela esta fila junto com todo
      // pendente e arma uma cadência de conversa nova — e quando ELA acabar,
      // a reativação é rearmada daqui, contando do zero.
      if (followUp.kind === "conversa") {
        const restantes = await db
          .select()
          .from(followUpsTable)
          .where(
            and(
              eq(followUpsTable.leadId, lead.id),
              eq(followUpsTable.status, "pending"),
            ),
          );
        if (restantes.length === 0) {
          const { elegivel, motivo } = elegivelParaReativacao(lead);
          if (elegivel) {
            await db.insert(followUpsTable).values(
              REATIVACAO_DELAYS_DIAS.map((dias, i) => ({
                leadId: lead.id,
                scheduledAt: new Date(now.getTime() + dias * 24 * 60 * 60 * 1000),
                touchNumber: i + 1,
                kind: "reativacao" as const,
                // Sem template de propósito: o texto nasce na hora do envio,
                // com a dor e a novidade daquele dia.
                messageTemplate: null,
                status: "pending" as const,
              })),
            );
            logger.info(
              { leadId: lead.id, dias: REATIVACAO_DELAYS_DIAS },
              "Cadência de conversa esgotada — lead entrou na fila de reativação",
            );
          } else if (motivo) {
            logger.info(
              { leadId: lead.id, motivo },
              `Fim da cadência sem reativação: ${EXPLICACAO_FORA[motivo]}`,
            );
          }
        }
      }

      if (ehAbordagem) {
        toquesFriosNesteCiclo++;

        // Último toque da cadência: acabou, e para sempre. Marcar o lead aqui,
        // em vez de deduzir depois "não tem follow-up pendente", é o que dá ao
        // painel a diferença entre "abordado, ainda pode responder" e "os dois
        // toques saíram, ele nunca respondeu, não procure mais".
        if (followUp.touchNumber >= ABORDAGEM_DELAYS_HOURS.length) {
          await db
            .update(leadsTable)
            .set({ outreachStatus: "nao_respondeu", updatedAt: new Date() })
            .where(eq(leadsTable.id, lead.id));
          logger.info(
            { leadId: lead.id },
            "Cadência de abordagem esgotada sem resposta — silêncio permanente",
          );
        }
      }

      logger.info(
        { leadId: lead.id, touchNumber: followUp.touchNumber, kind: followUp.kind },
        "Follow-up sent",
      );
    }
  } catch (err) {
    logger.error({ err }, "Follow-up scheduler error");
  }
}

/**
 * Uma passada do agendador: os follow-ups vencidos e, na sequência, a vigia de
 * conversas sem resposta (gatilho 4 da central).
 *
 * Pega carona neste agendador em vez de criar outro `setInterval`: a cadência de
 * 5 minutos é a mesma que o gatilho precisa, e um timer só é um lugar só para
 * olhar quando algo não roda. A vigia vem DEPOIS dos follow-ups e num try
 * próprio — se ela falhar, os follow-ups já saíram.
 */
async function rodarCiclo(): Promise<void> {
  await rodarCicloDeFollowUp();
  try {
    await verificarSemResposta();
  } catch (err) {
    logger.error({ err }, "Vigia de sem-resposta falhou");
  }
}

export function startFollowUpScheduler(): void {
  // Run every 5 minutes
  const INTERVAL_MS = 5 * 60 * 1000;

  // Run immediately then on interval
  rodarCiclo();
  setInterval(rodarCiclo, INTERVAL_MS);
  logger.info("Follow-up scheduler started");
}
