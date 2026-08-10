/**
 * IMPORTAÇÃO DE LEADS — POST /api/leads/import
 *
 * Recebe uma lista de dentistas (colada no painel ou vinda de um CSV) e cria
 * os leads como PENDENTES de prospecção. Esta rota NÃO envia mensagem nenhuma:
 * ela só popula a lista, para o Dr. Sarinho conferir antes de qualquer coisa
 * sair. O disparo é assunto da Rodada 23.3.
 *
 * Quatro regras inegociáveis, nesta ordem de precedência por lead:
 *   1. telefone que não vira celular válido  → invalidos
 *   2. lead existente com status "lost"      → ignoradosPorOptOut
 *   3. lead que já existe (qualquer outro)   → duplicados
 *   4. resto                                 → importados
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { normalizarTelefone } from "../lib/filtro-spam";

const router: IRouter = Router();

/**
 * Teto por requisição. Não é limite de negócio, é rede de segurança contra um
 * arquivo gigante colado por engano. Estourou, a requisição inteira é
 * recusada — nunca importa "os primeiros N" em silêncio.
 */
const MAX_POR_REQUISICAO = 2000;

interface LeadImportado {
  name?: unknown;
  phone?: unknown;
  clinicName?: unknown;
  instagram?: unknown;
  city?: unknown;
}

/** Texto vindo de planilha: corta espaço, e vazio vira null. */
function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo.length > 0 ? limpo : null;
}

// POST /api/leads/import
router.post("/leads/import", async (req, res) => {
  try {
    const entrada = (req.body as { leads?: unknown })?.leads;
    if (!Array.isArray(entrada)) {
      return void res
        .status(400)
        .json({ error: 'Corpo inválido: esperado { "leads": [...] }' });
    }
    if (entrada.length === 0) {
      return void res.status(400).json({ error: "Nenhum lead enviado" });
    }
    if (entrada.length > MAX_POR_REQUISICAO) {
      return void res.status(413).json({
        error: `Máximo de ${MAX_POR_REQUISICAO} leads por importação. Divida o arquivo em partes.`,
      });
    }

    const resumo = {
      importados: 0,
      duplicados: 0,
      invalidos: 0,
      ignoradosPorOptOut: 0,
    };

    // ---- 1) normaliza e valida telefone -----------------------------------
    // Também deduplica DENTRO do próprio arquivo: planilha repetida é comum, e
    // sem isto o insert quebraria na restrição de unicidade do telefone.
    const candidatos: {
      phone: string;
      name: string | null;
      clinicName: string | null;
      instagram: string | null;
      city: string | null;
    }[] = [];
    const vistosNesteArquivo = new Set<string>();

    for (const bruto of entrada as LeadImportado[]) {
      const phone = normalizarTelefone(
        typeof bruto?.phone === "string" ? bruto.phone : "",
      );
      if (!phone) {
        resumo.invalidos++;
        continue;
      }
      if (vistosNesteArquivo.has(phone)) {
        resumo.duplicados++;
        continue;
      }
      vistosNesteArquivo.add(phone);
      candidatos.push({
        phone,
        name: texto(bruto?.name),
        clinicName: texto(bruto?.clinicName),
        instagram: texto(bruto?.instagram),
        city: texto(bruto?.city),
      });
    }

    if (candidatos.length === 0) {
      return void res.json(resumo);
    }

    // ---- 2) confronta com o banco -----------------------------------------
    const existentes = await db
      .select({ phone: leadsTable.phone, status: leadsTable.status })
      .from(leadsTable)
      .where(
        inArray(
          leadsTable.phone,
          candidatos.map((c) => c.phone),
        ),
      );

    const statusPorTelefone = new Map(existentes.map((e) => [e.phone, e.status]));

    const paraInserir = candidatos.filter((c) => {
      const statusExistente = statusPorTelefone.get(c.phone);
      if (statusExistente === undefined) return true;

      // Quem pediu para parar continua fora, mesmo voltando na planilha. Esta
      // checagem vem ANTES da de duplicado porque o motivo importa: no resumo,
      // "ignorei porque ele pediu para não ser incomodado" não é a mesma coisa
      // que "ignorei porque já estava na lista".
      if (statusExistente === "lost") {
        resumo.ignoradosPorOptOut++;
        return false;
      }

      // Já existe: não sobrescreve nada e não re-prospecta. O lead que já
      // conversou com a Júlia não pode voltar para a fila de primeira abordagem.
      resumo.duplicados++;
      return false;
    });

    // ---- 3) insere os novos ------------------------------------------------
    if (paraInserir.length > 0) {
      await db.insert(leadsTable).values(
        paraInserir.map((c) => ({
          phone: c.phone,
          name: c.name,
          clinicName: c.clinicName,
          instagram: c.instagram,
          city: c.city,
          origin: "import",
          status: "cold" as const,
          funnelStage: "new" as const,
          outreachStatus: "pending" as const,
        })),
      );
      resumo.importados = paraInserir.length;
    }

    req.log.info(resumo, "Importação de leads concluída");
    res.json(resumo);
  } catch (err) {
    req.log.error({ err }, "Failed to import leads");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
