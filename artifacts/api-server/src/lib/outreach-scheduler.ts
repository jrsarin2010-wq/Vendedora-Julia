/**
 * AGENDADOR DA PROSPECÇÃO ATIVA — a Júlia puxa conversa.
 *
 * Separado do agendador de follow-up de propósito: os dois têm ritmos e riscos
 * completamente diferentes. Follow-up fala com quem já respondeu; este fala
 * com quem nunca pediu contato, e por isso anda devagar e com trava mestra.
 *
 * Manda UMA mensagem por ciclo, no máximo. É assim que o intervalo aleatório
 * entre mensagens acontece de verdade — em vez de despejar um lote e depois
 * ficar em silêncio, o que é exatamente o padrão que denuncia robô.
 */
import { db } from "@workspace/db";
import { leadsTable, leadMessagesTable } from "@workspace/db";
import { eq, and, isNotNull, gte, asc } from "drizzle-orm";
import { sendWhatsAppMessage } from "./integrations";
import { logger } from "./logger";
import {
  lerConfig,
  podeDispararAgora,
  sortearIntervalo,
  leadElegivel,
  contarEnvios,
  EXPLICACAO_BLOQUEIO,
  EXPLICACAO_INELEGIVEL,
} from "./outreach";
import { gerarMensagemDeAbordagem } from "./outreach-message";

/** De quanto em quanto tempo o ciclo roda. */
const INTERVALO_DO_CICLO_MS = 60 * 1000;

/**
 * Janela de envios que buscamos no banco para contar o ritmo. 26 horas cobre
 * o dia inteiro de São Paulo com folga, em qualquer fuso do servidor.
 *
 * Contar pelo BANCO, e não por um contador em memória, é o que faz o limite
 * sobreviver a um restart: sem isso, um deploy no meio da tarde zeraria a
 * conta e a Júlia poderia mandar 40 mensagens de novo no mesmo dia.
 */
const JANELA_DE_CONTAGEM_MS = 26 * 60 * 60 * 1000;

export interface ResultadoDoCiclo {
  enviou: boolean;
  motivo?: string;
  leadId?: number;
}

/**
 * Roda UM ciclo. Exportado para o teste conseguir exercitar o ciclo inteiro
 * sem depender de setInterval nem de relógio real.
 */
export async function rodarCicloDeAbordagem(
  agora: Date = new Date(),
): Promise<ResultadoDoCiclo> {
  const config = lerConfig();

  // A trava mestra é checada ANTES de qualquer consulta ao banco: desligado
  // é desligado, e nem chega a olhar quem está na fila.
  if (!config.habilitado) {
    return { enviou: false, motivo: "desligado" };
  }

  // Envios recentes, para contar o ritmo.
  const recentes = await db
    .select({ outreachSentAt: leadsTable.outreachSentAt })
    .from(leadsTable)
    .where(
      and(
        isNotNull(leadsTable.outreachSentAt),
        gte(leadsTable.outreachSentAt, new Date(agora.getTime() - JANELA_DE_CONTAGEM_MS)),
      ),
    );

  const datas = recentes
    .map((r) => r.outreachSentAt)
    .filter((d): d is Date => d instanceof Date);

  const { naUltimaHora, hoje, ultimo } = contarEnvios(datas, agora);

  const decisao = podeDispararAgora({
    config,
    agora,
    enviadosNaUltimaHora: naUltimaHora,
    enviadosHoje: hoje,
    ultimoEnvio: ultimo,
    intervaloExigidoSegundos: sortearIntervalo(config.intervaloMinimoSegundos),
  });

  if (!decisao.pode) {
    return { enviou: false, motivo: decisao.motivo };
  }

  // O próximo da fila: o mais antigo esperando. Buscamos alguns e não um só
  // porque o primeiro pode ter virado "lost" depois de importado.
  const candidatos = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.outreachStatus, "pending"))
    .orderBy(asc(leadsTable.createdAt))
    .limit(10);

  // Um humano falando com o lead agora congela a abordagem — mas NÃO é
  // inelegibilidade. Fica fora de `leadElegivel` de propósito: aquilo é uma
  // decisão permanente (marca "skipped" logo abaixo), e a pausa é temporária.
  // Se entrasse lá, cinco minutos de conversa do Dr. Sarinho tirariam o lead da
  // fila para sempre.
  //
  // O caso real: ele manda mensagem pelo celular para uma clínica importada
  // antes da Júlia. Sem esta trava, a abordagem fria dela cairia por cima da
  // mensagem dele, para a mesma pessoa.
  const pausado = (c: { pausedUntil: Date | null }) =>
    Boolean(c.pausedUntil && new Date(c.pausedUntil).getTime() > Date.now());

  const lead = candidatos.find((c) => !pausado(c) && leadElegivel(c).elegivel);

  if (!lead) {
    // Marca como "skipped" quem está travado na fila por ser inelegível, para
    // não reavaliar os mesmos leads a cada minuto para sempre.
    for (const c of candidatos) {
      if (pausado(c)) {
        logger.info(
          { leadId: c.id, pausedUntil: c.pausedUntil },
          "Lead pausado (humano assumiu) — abordagem adiada, segue na fila",
        );
        continue;
      }
      const { elegivel, motivo } = leadElegivel(c);
      if (!elegivel && motivo) {
        await db
          .update(leadsTable)
          .set({ outreachStatus: "skipped", updatedAt: new Date() })
          .where(eq(leadsTable.id, c.id));
        logger.info(
          { leadId: c.id, motivo },
          `Lead saiu da fila de abordagem: ${EXPLICACAO_INELEGIVEL[motivo]}`,
        );
      }
    }
    return { enviou: false, motivo: "fila_vazia" };
  }

  // Gera a mensagem. Se o modelo falhar, o lead FICA na fila para a próxima
  // rodada — não é motivo para descartá-lo.
  let mensagem: string | null = null;
  try {
    mensagem = await gerarMensagemDeAbordagem(lead);
  } catch (err) {
    logger.error({ err, leadId: lead.id }, "Falha ao gerar mensagem de abordagem");
    return { enviou: false, motivo: "erro_ao_gerar", leadId: lead.id };
  }

  if (!mensagem) {
    logger.error(
      { leadId: lead.id },
      "Modelo devolveu mensagem de abordagem vazia — lead segue na fila",
    );
    return { enviou: false, motivo: "mensagem_vazia", leadId: lead.id };
  }

  const entregue = await sendWhatsAppMessage(lead.phone, mensagem);

  // Mesma regra da Rodada 21: só entra no histórico o que realmente chegou.
  // E o lead só sai da fila se a mensagem saiu — se o envio falhou, ele
  // continua "pending" e a próxima rodada tenta de novo.
  if (!entregue) {
    logger.error(
      { leadId: lead.id, phone: lead.phone },
      "Abordagem NÃO entregue — lead segue na fila",
    );
    return { enviou: false, motivo: "nao_entregue", leadId: lead.id };
  }

  await db.insert(leadMessagesTable).values({
    leadId: lead.id,
    direction: "outbound",
    content: mensagem,
    messageType: "text",
  });

  // A partir daqui o lead entra no fluxo normal: se responder, cai no webhook
  // e a cadência de follow-up é armada como em qualquer conversa.
  await db
    .update(leadsTable)
    .set({
      outreachStatus: "sent",
      outreachSentAt: agora,
      funnelStage: "contacted",
      lastMessageAt: agora,
      updatedAt: new Date(),
    })
    .where(eq(leadsTable.id, lead.id));

  logger.info(
    { leadId: lead.id, naUltimaHora: naUltimaHora + 1, hoje: hoje + 1 },
    "Abordagem enviada",
  );

  return { enviou: true, leadId: lead.id };
}

export function startOutreachScheduler(): void {
  const config = lerConfig();
  logger.info(
    {
      habilitado: config.habilitado,
      porHora: config.porHora,
      porDia: config.porDia,
      janela: `${config.horaInicio}h-${config.horaFim}h`,
      soDiasUteis: config.soDiasUteis,
    },
    config.habilitado
      ? "Prospecção ativa LIGADA"
      : "Prospecção ativa desligada (OUTREACH_ENABLED=false) — nada será enviado",
  );

  const rodar = async () => {
    try {
      const r = await rodarCicloDeAbordagem();
      // Só registra o que é útil: "desligado" a cada minuto seria só ruído.
      if (!r.enviou && r.motivo && !["desligado", "fila_vazia", "intervalo_minimo"].includes(r.motivo)) {
        const explicacao =
          EXPLICACAO_BLOQUEIO[r.motivo as keyof typeof EXPLICACAO_BLOQUEIO] ?? r.motivo;
        logger.debug({ motivo: r.motivo }, `Abordagem não saiu: ${explicacao}`);
      }
    } catch (err) {
      logger.error({ err }, "Erro no ciclo de prospecção ativa");
    }
  };

  setInterval(rodar, INTERVALO_DO_CICLO_MS);
}
