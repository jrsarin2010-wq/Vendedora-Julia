/**
 * CANONICALIZAÇÃO DOS TELEFONES JÁ GRAVADOS — POST /api/leads/canonicalizar
 *
 * Conserta a base que nasceu misturada: leads gravados com 13 dígitos pela
 * importação e com 12 pelo webhook são a mesma clínica escrita de dois jeitos,
 * e é por isso que a checagem de duplicado do leads-import falha em silêncio.
 *
 * Roda em DOIS MODOS, e o padrão é o que não escreve:
 *
 *   { "modo": "dry-run" }  (padrão) — só o relatório, nenhum UPDATE.
 *   { "modo": "aplicar" }           — troca o telefone dos itens de aAtualizar.
 *
 * A ordem é obrigatória: dry-run → alguém lê o relatório → aplicar. O plano
 * das duas rodadas sai da MESMA função (planejarCanonicalizacao), para o que
 * foi revisado ser exatamente o que roda.
 *
 * O que esta rota nunca faz: fundir dois leads. Ver a explicação da colisão em
 * lib/canonicalizar-telefone.ts.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  canonicalizarTelefones,
  planejarCanonicalizacao,
  type PlanoDeCanonicalizacao,
} from "../lib/canonicalizar-telefone";

const router: IRouter = Router();

const MODOS = ["dry-run", "aplicar"] as const;
type Modo = (typeof MODOS)[number];

/** Um UPDATE que não passou. Não deveria acontecer (o plano já filtra), mas se
 * acontecer vira relatório, não exceção: os outros leads têm de ser corrigidos
 * de qualquer jeito. */
interface FalhaAoAplicar {
  leadId: number;
  motivo: string;
}

// POST /api/leads/canonicalizar
router.post("/leads/canonicalizar", async (req, res) => {
  try {
    const modoBruto = (req.body as { modo?: unknown })?.modo ?? "dry-run";
    if (typeof modoBruto !== "string" || !MODOS.includes(modoBruto as Modo)) {
      return void res.status(400).json({
        error: `modo inválido: use ${MODOS.map((m) => `"${m}"`).join(" ou ")}`,
      });
    }
    const modo = modoBruto as Modo;

    const leads = await db
      .select({ id: leadsTable.id, phone: leadsTable.phone })
      .from(leadsTable);

    const mapa = await canonicalizarTelefones(leads.map((l) => l.phone));
    const plano: PlanoDeCanonicalizacao = planejarCanonicalizacao(leads, mapa);

    if (modo === "dry-run") {
      req.log.info(
        {
          total: plano.total,
          aAtualizar: plano.aAtualizar.length,
          colisoes: plano.colisoes.length,
          indeterminado: plano.indeterminado.length,
        },
        "Canonicalização (dry-run) — nenhuma escrita",
      );
      return void res.json({ modo, ...plano, aplicadas: 0 });
    }

    const falhas: FalhaAoAplicar[] = [];
    let aplicadas = 0;
    for (const troca of plano.aAtualizar) {
      try {
        await db
          .update(leadsTable)
          .set({ phone: troca.para, updatedAt: new Date() })
          .where(eq(leadsTable.id, troca.leadId));
        aplicadas++;
      } catch (err) {
        // Rede de segurança para a corrida entre o plano e o UPDATE (um lead
        // novo pode ter ocupado o telefone no meio). Um item que falha não
        // pode derrubar a correção dos outros.
        falhas.push({
          leadId: troca.leadId,
          motivo: err instanceof Error ? err.message : String(err),
        });
      }
    }

    req.log.info(
      { aplicadas, falhas: falhas.length, colisoes: plano.colisoes.length },
      "Canonicalização aplicada",
    );
    res.json({ modo, ...plano, aplicadas, falhas });
  } catch (err) {
    req.log.error({ err }, "Falha na canonicalização de telefones");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
