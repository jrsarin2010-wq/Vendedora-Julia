/**
 * BACKFILL DA REPUTAÇÃO DO GOOGLE — POST /api/prospects/backfill-reputacao
 *
 * As colunas `leads.nota` e `leads.total_avaliacoes` nasceram DEPOIS da Etapa
 * 3C, então todo lead promovido antes delas tem as duas nulas — e a ficha da
 * abordagem, que só cita reputação alta com volume, não tem o que citar. Esta
 * rota copia o que já está em `clinicas_prospect`, pelo `lead_id` que a própria
 * promoção gravou.
 *
 * POR QUE É ROTA, e não script de linha de comando: o `DATABASE_URL` de
 * produção não sai do contêiner. A CLI do Railway local está autenticada em
 * outra conta (a da CaptaClin) e não enxerga este projeto, e o token de projeto
 * exigiria verificação de conta. Rodando por dentro, o segredo não passa por
 * ninguém e o acesso é a sessão do painel, que já existe.
 *
 * DOIS MODOS, e o padrão é o que não escreve — igual ao leads-canonicalizar:
 *
 *   { "modo": "dry-run" }  (padrão) — só o relatório, nenhum UPDATE.
 *   { "modo": "aplicar" }           — grava os itens de aAtualizar.
 *
 * A ordem é obrigatória: dry-run → alguém lê o relatório → aplicar. Os dois
 * modos montam o plano pela MESMA função, para o que foi revisado ser
 * exatamente o que roda.
 *
 * TRÊS TRAVAS, e nenhuma é opcional:
 *
 * 1. NUNCA SOBRESCREVE. Só preenche onde o lead tem NULL nas duas colunas. Lead
 *    promovido depois da mudança já veio com os números e não é tocado; rodar
 *    duas vezes não faz nada na segunda.
 *
 * 2. SÓ `promovido`. Prospect com status `ja_existente` também carrega um
 *    `lead_id`, mas aquele lead veio de outro lugar (planilha, WhatsApp) e pode
 *    até ser um opt-out. Copiar reputação para ele misturaria a procedência do
 *    dado sem ninguém ter pedido.
 *
 * 3. A TRAVA DA FICHA (4.5 / 20 avaliações) NÃO é aplicada na escrita. A coluna
 *    guarda o FATO; quem decide se o fato é citável é julia-persona.ts. Filtrar
 *    aqui faria "sem dado" e "dado reprovado" virarem a mesma linha no banco —
 *    exatamente a confusão que a coluna existe para desfazer. O relatório
 *    marca `citavelNaFicha` só para conferência.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { leadsTable, clinicasProspectTable } from "@workspace/db";
import { and, eq, ilike, inArray, isNull, isNotNull } from "drizzle-orm";

const router: IRouter = Router();

const MODOS = ["dry-run", "aplicar"] as const;
type Modo = (typeof MODOS)[number];

/**
 * A mesma trava de julia-persona.ts, repetida aqui SÓ para o relatório dizer o
 * que aconteceria na abertura. Não governa escrita nenhuma — se um dia os
 * números divergirem, o que vale é o da persona, e a coluna do relatório fica
 * errada sem estragar dado.
 */
const CITAVEL_NOTA = 4.5;
const CITAVEL_AVALIACOES = 20;

interface ItemDoPlano {
  leadId: number;
  clinica: string | null;
  cidade: string | null;
  prospectId: number;
  nota: string | null;
  totalAvaliacoes: number | null;
  /** Passaria na trava da ficha? Leitura, não decisão. */
  citavelNaFicha: boolean;
}

interface FalhaAoAplicar {
  leadId: number;
  motivo: string;
}

/**
 * Monta o plano em DUAS consultas em vez de um join, de propósito.
 *
 * `clinicas_prospect` e `leads` têm as duas uma coluna `nota` e uma
 * `total_avaliacoes`, e a condição precisa de sentidos OPOSTOS nas duas
 * (preenchida na origem, vazia no destino). Escrito como join, é uma linha em
 * que trocar a tabela de uma das pontas inverte o filtro sem erro de sintaxe e
 * sem sintoma — o backfill simplesmente não acharia ninguém, ou acharia quem
 * não devia. Separado, cada consulta diz uma coisa só.
 */
async function planejarBackfill(cidade: string | null): Promise<ItemDoPlano[]> {
  // 1) A origem: clínicas promovidas que TÊM reputação para doar.
  const prospects = await db
    .select()
    .from(clinicasProspectTable)
    .where(
      and(
        eq(clinicasProspectTable.statusProspeccao, "promovido"),
        isNotNull(clinicasProspectTable.leadId),
        isNotNull(clinicasProspectTable.nota),
        isNotNull(clinicasProspectTable.totalAvaliacoes),
      ),
    );

  const idsDeLead = prospects
    .map((p) => p.leadId)
    .filter((id): id is number => id !== null);
  if (idsDeLead.length === 0) return [];

  // 2) O destino: desses leads, os que ainda estão SEM os dois campos.
  //
  // O filtro de cidade é pela cidade do LEAD, que é a que a ficha da abordagem
  // usa — `clinicas_prospect.cidade` é a de captação, e as duas podem divergir
  // se alguém tiver corrigido o lead à mão.
  const condicoes = [
    inArray(leadsTable.id, idsDeLead),
    isNull(leadsTable.nota),
    isNull(leadsTable.totalAvaliacoes),
  ];
  if (cidade) condicoes.push(ilike(leadsTable.city, `%${cidade}%`));

  const leads = await db
    .select()
    .from(leadsTable)
    .where(and(...condicoes));

  const leadPorId = new Map(leads.map((l) => [l.id, l]));

  const plano: ItemDoPlano[] = [];
  for (const p of prospects) {
    const lead = p.leadId === null ? undefined : leadPorId.get(p.leadId);
    if (!lead) continue; // já tinha dado, ou ficou fora do filtro de cidade

    const n = Number(p.nota);
    plano.push({
      leadId: lead.id,
      clinica: lead.clinicName,
      cidade: lead.city,
      prospectId: p.id,
      nota: p.nota,
      totalAvaliacoes: p.totalAvaliacoes,
      citavelNaFicha:
        Number.isFinite(n) &&
        n >= CITAVEL_NOTA &&
        (p.totalAvaliacoes ?? 0) >= CITAVEL_AVALIACOES,
    });
  }
  return plano.sort((a, b) => a.leadId - b.leadId);
}

// POST /api/prospects/backfill-reputacao
router.post("/prospects/backfill-reputacao", async (req, res) => {
  try {
    const corpo = req.body as { modo?: unknown; cidade?: unknown };

    const modoBruto = corpo?.modo ?? "dry-run";
    if (typeof modoBruto !== "string" || !MODOS.includes(modoBruto as Modo)) {
      return void res.status(400).json({
        error: `modo inválido: use ${MODOS.map((m) => `"${m}"`).join(" ou ")}`,
      });
    }
    const modo = modoBruto as Modo;

    // Cidade é filtro opcional. String vazia vira "sem filtro" em vez de virar
    // um ilike '%%' — que casaria com todo mundo e é a mesma coisa, mas dito
    // por acidente.
    const cidade =
      typeof corpo?.cidade === "string" && corpo.cidade.trim()
        ? corpo.cidade.trim()
        : null;

    const aAtualizar = await planejarBackfill(cidade);

    if (modo === "dry-run") {
      req.log.info(
        { cidade, aAtualizar: aAtualizar.length },
        "Backfill de reputação (dry-run) — nenhuma escrita",
      );
      return void res.json({
        modo,
        cidade,
        total: aAtualizar.length,
        aAtualizar,
        aplicadas: 0,
      });
    }

    const falhas: FalhaAoAplicar[] = [];
    let aplicadas = 0;
    for (const item of aAtualizar) {
      try {
        const r = await db
          .update(leadsTable)
          .set({
            nota: item.nota,
            totalAvaliacoes: item.totalAvaliacoes,
            updatedAt: new Date(),
          })
          // As condições de NULL são repetidas aqui, e não só no plano: entre a
          // leitura e a escrita alguém pode ter promovido a mesma clínica de
          // novo. Sem isto o backfill sobrescreveria dado mais novo com dado
          // mais velho — em silêncio, porque os dois "parecem" certos.
          .where(
            and(
              eq(leadsTable.id, item.leadId),
              isNull(leadsTable.nota),
              isNull(leadsTable.totalAvaliacoes),
            ),
          )
          .returning({ id: leadsTable.id });
        if (r.length > 0) aplicadas++;
      } catch (err) {
        // Um item que falha não derruba a correção dos outros — mesmo desenho
        // do leads-canonicalizar.
        falhas.push({
          leadId: item.leadId,
          motivo: err instanceof Error ? err.message : String(err),
        });
      }
    }

    req.log.info(
      { cidade, aplicadas, planejadas: aAtualizar.length, falhas: falhas.length },
      "Backfill de reputação aplicado",
    );
    res.json({
      modo,
      cidade,
      total: aAtualizar.length,
      aAtualizar,
      aplicadas,
      falhas,
    });
  } catch (err) {
    req.log.error({ err }, "Falha no backfill de reputação");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
