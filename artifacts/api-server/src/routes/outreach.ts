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
import { leadsTable, leadMessagesTable } from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import {
  lerConfig,
  leadElegivel,
  podeDispararAgora,
  contarEnvios,
  janelaFechada,
  momentoEmSaoPaulo,
  EXPLICACAO_BLOQUEIO,
  EXPLICACAO_INELEGIVEL,
} from "../lib/outreach";
import {
  outreachAtivoNoPainel,
  definirOutreachAtivo,
} from "../lib/configuracoes";
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
      mensagem = await gerarMensagemDeAbordagem(lead, agora);
    } catch (err) {
      req.log.warn({ err, leadId: id }, "Falha ao gerar prévia de abordagem");
      erroAoGerar = "Não consegui gerar a mensagem agora. Tente de novo.";
    }

    // AS DUAS FALHAS TÊM QUE APARECER, e antes desta linha só uma aparecia.
    //
    // Gerar pode falhar de dois jeitos: a chamada explode (o catch acima) ou ela
    // volta sem texto aproveitável (null, sem exceção nenhuma). O segundo caso
    // saía daqui com mensagem nula E erro nulo — e o painel, que só sabe mostrar
    // um dos dois, não mostrava nada. Quem olhava não tinha como distinguir
    // "falhou" de "ainda está carregando".
    //
    // O porquê do null já foi para o log dentro de gerarMensagemDeAbordagem, com
    // finish_reason e contagem de tokens. Aqui fica só o que a tela precisa: uma
    // frase diferente da outra, para o próximo relato dizer QUAL das duas foi.
    if (!mensagem && !erroAoGerar) {
      erroAoGerar =
        "O modelo respondeu, mas veio sem texto. O motivo está no log desta requisição.";
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

// ---------------------------------------------------------------------------
// ETAPA 4 — o interruptor da abordagem, no Painel.
//
// Por que ele existe, e por que é diferente dos botões da varredura e da
// verificação: aqueles se liga e esquece. Este se desliga NO SUSTO, quando a
// primeira conversa sai errada — e nesse momento abrir o Railway, achar a
// variável, salvar e esperar o serviço reiniciar são minutos com a Júlia
// mandando mensagem.
//
// O que ele governa: abordar quem nunca foi abordado (a primeira mensagem, os
// dois toques de quem não respondeu, e a reativação — toque frio depois de 30
// dias é abordagem, não continuidade).
//
// O que ele NUNCA governa: responder quem já está conversando. Desligar a
// varredura no meio não perde nada, a fila fica onde está; desligar a resposta
// deixaria dentista falando sozinho depois de a Júlia ter puxado assunto, que é
// pior do que nunca tê-lo abordado. O webhook não consulta nada disto — e o
// teste "com o botão desligado, mensagem recebida continua sendo respondida"
// existe para que continue assim.
// ---------------------------------------------------------------------------

/** Corte da janela deslizante dos contadores. */
const JANELA_DE_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Monta o retrato completo. Existe como função porque o POST responde
 * EXATAMENTE o mesmo shape do GET — a tela troca o estado com a resposta do
 * clique, sem uma segunda ida ao servidor que poderia contar outra história.
 * Mesma decisão das rotas de varredura e verificação.
 *
 * EXPORTADA, e com `agora` de fora, pelo mesmo motivo que os ciclos dos
 * agendadores são: tudo aqui é janela de 24h, horário comercial e intervalo
 * mínimo. Testar isso pelo HTTP amarraria as asserções ao relógio da máquina —
 * "dentro da janela" passaria de dia e falharia à noite.
 */
export async function montarStatusDaAbordagem(agora: Date = new Date()) {
  const config = lerConfig();
  const ativo = await outreachAtivoNoPainel();

  // A fila inteira, e não um count(*): "quem está na fila" é decidido por
  // `leadElegivel` (lib/outreach.ts), a MESMA função do agendador — um lead que
  // virou "lost" depois de importado continua `pending` na coluna e não é fila
  // nenhuma. Contar no banco daria um número maior que o real, e o painel
  // prometeria abordagens que nunca vão acontecer.
  const pendentes = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.outreachStatus, "pending"));
  const naFila = pendentes.filter((l) => leadElegivel(l).elegivel).length;

  const desde = new Date(agora.getTime() - JANELA_DE_24H_MS);

  const [abordados] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(leadsTable)
    .where(
      and(
        isNotNull(leadsTable.outreachSentAt),
        gte(leadsTable.outreachSentAt, desde),
      ),
    );

  // AGUARDANDO RESPOSTA: foi abordado e nunca disse nada. Medido pela ausência
  // de mensagem `inbound`, e não por etapa do funil, porque é isso que a frase
  // quer dizer — e porque a etapa muda por outros motivos.
  const abordadosTodos = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.outreachStatus, "sent"));

  let aguardandoResposta = 0;
  if (abordadosTodos.length > 0) {
    const respostas = await db
      .select()
      .from(leadMessagesTable)
      .where(
        and(
          eq(leadMessagesTable.direction, "inbound"),
          inArray(
            leadMessagesTable.leadId,
            abordadosTodos.map((l) => l.id),
          ),
        ),
      );
    const responderam = new Set(respostas.map((m) => m.leadId));
    aguardandoResposta = abordadosTodos.filter((l) => !responderam.has(l.id)).length;
  }

  // QUANTO FALTA PARA A PRÓXIMA. Só faz sentido com tudo ligado e gente na
  // fila; fora disso é `null` e a tela conta a história com palavras ("fora do
  // horário", "ninguém na fila") em vez de um número que promete envio.
  let proximoEnvioEm: number | null = null;
  if (ativo && config.habilitado && naFila > 0) {
    const { naUltimaHora, hoje, ultimo } = contarEnvios(
      await datasDeEnviosFrios(agora),
      agora,
    );
    const decisao = podeDispararAgora({
      config,
      agora,
      enviadosNaUltimaHora: naUltimaHora,
      enviadosHoje: hoje,
      ultimoEnvio: ultimo,
      // Cravado, não sorteado: um número que muda a cada F5 não é informação.
      intervaloExigidoSegundos: config.intervaloMinimoSegundos,
    });

    if (decisao.pode) {
      // Zero quer dizer "no próximo ciclo", que é de um minuto — não "agora".
      proximoEnvioEm = 0;
    } else if (decisao.motivo === "intervalo_minimo" && ultimo) {
      const faltamSegundos =
        config.intervaloMinimoSegundos - (agora.getTime() - ultimo.getTime()) / 1000;
      proximoEnvioEm = Math.max(0, Math.ceil(faltamSegundos / 60));
    }
    // Nos outros bloqueios (cota da hora, cota do dia) fica null: dizer "em 47
    // minutos" quando o que falta é a virada da hora seria chute.
  }

  return {
    /** O botão do painel (chave `outreach_ativo` no banco). */
    ativo,
    /** A variável `OUTREACH_ENABLED` do Railway. */
    interruptorGeral: config.habilitado,
    dentroDaJanela: janelaFechada(config, agora) === null,
    janela: { inicio: config.horaInicio, fim: config.horaFim },
    naFila,
    abordadosNas24h: abordados?.total ?? 0,
    aguardandoResposta,
    proximoEnvioEm,
  };
}

// GET /api/outreach/status
router.get("/outreach/status", async (req, res) => {
  try {
    res.json(await montarStatusDaAbordagem());
  } catch (err) {
    req.log.error({ err }, "Failed to get outreach status");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/outreach/ativo — o botão.
 *
 * Aceita SÓ booleano de verdade, como as rotas gêmeas: `Boolean()` num corpo
 * distraído transforma a string "false" em `true`, e um botão que LIGA a
 * abordagem quando o corpo diz "false" é, dos três, o pior desfecho possível.
 */
router.post("/outreach/ativo", async (req, res) => {
  try {
    const ativo = (req.body as { ativo?: unknown })?.ativo;
    if (typeof ativo !== "boolean") {
      return void res
        .status(400)
        .json({ error: 'Corpo inválido: esperado { "ativo": true | false }' });
    }

    await definirOutreachAtivo(ativo);
    req.log.info({ ativo }, "Abordagem ligada/desligada pelo painel");

    res.json(await montarStatusDaAbordagem());
  } catch (err) {
    req.log.error({ err }, "Failed to set outreach ativo");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
