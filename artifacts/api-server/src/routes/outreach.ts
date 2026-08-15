/**
 * MODO DE CONFERÊNCIA — GET /api/leads/:id/outreach-preview
 *
 * Mostra a mensagem que SERIA enviada para um lead, sem enviar nada.
 *
 * Esta rota não tem `sendWhatsAppMessage` em lugar nenhum, e é de propósito:
 * ela existe justamente para ser usada com a trava mestra desligada, antes de
 * a primeira mensagem sair de verdade. A geração passa pela MESMA função que
 * o agendador usa — uma prévia que gerasse o texto por outro caminho poderia
 * mostrar uma coisa e enviar outra, que é o pior resultado possível para uma
 * ferramenta cujo trabalho é dar confiança.
 *
 * Além do texto, devolve os motivos pelos quais o envio não aconteceria — a
 * pergunta seguinte à "como ficou a mensagem?" é sempre "e por que não saiu?".
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  lerConfig,
  leadElegivel,
  podeDispararAgora,
  contarEnvios,
  momentoEmSaoPaulo,
  EXPLICACAO_BLOQUEIO,
  EXPLICACAO_INELEGIVEL,
} from "../lib/outreach";
import { gerarMensagemDeAbordagem } from "../lib/outreach-message";
import { datasDeEnviosFrios } from "../lib/ritmo-frio";

const router: IRouter = Router();

router.get("/leads/:id/outreach-preview", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return void res.status(400).json({ error: "Invalid id" });
    }

    const lead = (
      await db.select().from(leadsTable).where(eq(leadsTable.id, id)).limit(1)
    )[0];
    if (!lead) return void res.status(404).json({ error: "Lead not found" });

    const config = lerConfig();
    const agora = new Date();

    // Por que este lead não seria abordado (se for o caso).
    const { elegivel, motivo: motivoLead } = leadElegivel(lead);

    // Por que o ritmo não deixaria sair agora (se for o caso). Usa intervalo
    // mínimo cravado, e não sorteado: numa conferência interessa o cenário
    // previsível, não um número diferente a cada F5. A contagem é a mesma dos
    // agendadores (aberturas + toques, lib/ritmo-frio.ts) — os contadores da
    // tela têm que bater com o que o número de fato mandou.
    const { naUltimaHora, hoje, ultimo } = contarEnvios(
      await datasDeEnviosFrios(agora),
      agora,
    );

    const ritmo = podeDispararAgora({
      config,
      agora,
      enviadosNaUltimaHora: naUltimaHora,
      enviadosHoje: hoje,
      ultimoEnvio: ultimo,
      intervaloExigidoSegundos: config.intervaloMinimoSegundos,
    });

    // A mensagem é gerada mesmo que o lead seja inelegível: o objetivo aqui é
    // ver como a Júlia escreve, e o Dr. Sarinho pode querer conferir o texto
    // de alguém que hoje está fora da fila.
    let mensagem: string | null = null;
    let erroAoGerar: string | null = null;
    try {
      mensagem = await gerarMensagemDeAbordagem(lead);
    } catch (err) {
      req.log.warn({ err, leadId: id }, "Falha ao gerar prévia de abordagem");
      erroAoGerar = "Não consegui gerar a mensagem agora. Tente de novo.";
    }

    const momento = momentoEmSaoPaulo(agora);

    res.json({
      enviado: false, // sempre. Esta rota nunca envia.
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        clinicName: lead.clinicName,
        city: lead.city,
        instagram: lead.instagram,
        status: lead.status,
        outreachStatus: lead.outreachStatus,
      },
      mensagem,
      erroAoGerar,
      elegivel,
      motivoInelegivel: motivoLead ? EXPLICACAO_INELEGIVEL[motivoLead] : null,
      ritmo: {
        pode: ritmo.pode,
        motivo: ritmo.motivo ? EXPLICACAO_BLOQUEIO[ritmo.motivo] : null,
      },
      agoraEmSaoPaulo: `${momento.dia} ${String(momento.hora).padStart(2, "0")}h`,
      contadores: { naUltimaHora, hoje },
      config,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to build outreach preview");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
