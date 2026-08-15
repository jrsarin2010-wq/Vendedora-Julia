/**
 * CONTROLE DA VERIFICAÇÃO DE WHATSAPP — as duas rotas do painel (Etapa 3A).
 *
 * Fora do contrato OpenAPI, no mesmo esquema das rotas de varredura: são rotas
 * de OPERAÇÃO do painel, não do modelo de dados.
 *
 * O shape é deliberadamente parecido com o de /varreduras/status — `ativa`,
 * `interruptorGeral` e `pausadaPorErro` querem dizer a mesma coisa nos dois
 * lugares. Dois controles gêmeos na mesma tela que se comportassem diferente
 * seriam a pior armadilha possível para quem opera.
 */
import { Router, type IRouter } from "express";
import { db, clinicasProspectTable } from "@workspace/db";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import {
  lerConfigDeVerificacao,
  TAMANHO_DO_LOTE,
  TETO_DIARIO,
  JANELA_DA_COTA_MS,
} from "../lib/verificacao";
import {
  verificacaoAtivaNoPainel,
  definirVerificacaoAtiva,
} from "../lib/configuracoes";
import { estadoDaPausaDaVerificacao } from "../lib/verificacao-scheduler";

const router: IRouter = Router();

/**
 * Monta o retrato completo. Existe como função porque o POST responde
 * EXATAMENTE o mesmo shape do GET — a tela troca o estado com a resposta do
 * clique, sem uma segunda ida ao servidor que poderia contar outra história.
 */
async function montarStatus(agora: Date = new Date()) {
  const desde = new Date(agora.getTime() - JANELA_DA_COTA_MS);

  // Duas contagens agregadas em vez de "traz tudo e conta aqui": esta é a
  // tabela que cresce sem teto (ver o comentário em verificacao-scheduler.ts),
  // e a tela recarrega sozinha a cada 30s.
  const [naFila, na24h] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(clinicasProspectTable)
      .where(
        and(
          eq(clinicasProspectTable.statusProspeccao, "novo"),
          isNotNull(clinicasProspectTable.telefoneRaw),
        ),
      ),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(clinicasProspectTable)
      .where(gte(clinicasProspectTable.verificadoWhatsappEm, desde)),
  ]);

  const pausa = estadoDaPausaDaVerificacao();

  return {
    ativa: await verificacaoAtivaNoPainel(),
    interruptorGeral: lerConfigDeVerificacao().habilitado,
    pausadaPorErro: pausa.pausada,
    motivoPausa: pausa.motivo,
    /** Em `novo` COM telefone do Maps: é exatamente quem o worker pega. */
    aVerificar: naFila[0]?.total ?? 0,
    /**
     * Janela DESLIZANTE de 24h, não "desde a meia-noite" — é a mesma conta que
     * trava o worker, e a mesma escolha já feita na cota da varredura. A tela
     * diz "em 24h" e não "hoje" porque é isso que o número é.
     */
    verificadosNa24h: na24h[0]?.total ?? 0,
    tetoDiario: TETO_DIARIO,
    tamanhoDoLote: TAMANHO_DO_LOTE,
  };
}

// GET /api/verificacao/status
router.get("/verificacao/status", async (req, res) => {
  try {
    res.json(await montarStatus());
  } catch (err) {
    req.log.error({ err }, "Failed to get verificacao status");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/verificacao/ativa — o botão.
 *
 * Aceita SÓ booleano de verdade, pelo mesmo motivo da rota gêmea: `Boolean()`
 * num corpo distraído transforma a string "false" em `true`, e um botão que
 * LIGA quando o corpo diz "false" é o pior desfecho possível aqui.
 */
router.post("/verificacao/ativa", async (req, res) => {
  try {
    const ativa = (req.body as { ativa?: unknown })?.ativa;
    if (typeof ativa !== "boolean") {
      return void res
        .status(400)
        .json({ error: 'Corpo inválido: esperado { "ativa": true | false }' });
    }

    await definirVerificacaoAtiva(ativa);
    req.log.info({ ativa }, "Verificação de WhatsApp ligada/desligada pelo painel");

    res.json(await montarStatus());
  } catch (err) {
    req.log.error({ err }, "Failed to set verificacao ativa");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
