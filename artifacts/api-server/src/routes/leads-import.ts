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
 *
 * ETAPA 1.5 — o telefone é canonicalizado ANTES de qualquer comparação. O
 * número que a planilha traz ("(85) 99999-8888", 13 dígitos com o 55) pode não
 * ser a identidade que o WhatsApp reconhece: conta antiga vive na forma de 12
 * dígitos, sem o nono. Comparar a forma da planilha com o que o webhook gravou
 * (que já vem do jid) não acha o duplicado, e a Júlia aborda de novo quem já é
 * lead. Ver lib/canonicalizar-telefone.ts.
 *
 * Isso acrescenta UMA chamada externa por importação — em lote, não por lead.
 *
 * ETAPA 3C — a decisão passou a ser reaproveitada. A promoção de clínica
 * captada no Maps (routes/prospects-promover.ts) chama `importarLeads()` em vez
 * de inserir direto, porque tudo que ela precisa já mora aqui: dedup,
 * canonicalização, opt-out e — o que mais importa — o `outreachStatus:
 * "pending"` explícito, que é o campo que faz o lead ser abordado. O default da
 * coluna é 'none' e o agendador só olha 'pending': quem inserisse por fora
 * criaria dentista que nunca recebe mensagem, sem erro nenhum.
 *
 * Por isso a função interna devolve DESFECHO POR ITEM (`desfechos`, 1:1 com a
 * entrada) além do agregado. A rota HTTP continua respondendo só o agregado de
 * sempre — quem já consome /api/leads/import não vê diferença.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { normalizarTelefone } from "../lib/filtro-spam";
import { canonicalizarTelefones } from "../lib/canonicalizar-telefone";

const router: IRouter = Router();

/**
 * Teto por requisição. Não é limite de negócio, é rede de segurança contra um
 * arquivo gigante colado por engano. Estourou, a requisição inteira é
 * recusada — nunca importa "os primeiros N" em silêncio.
 */
const MAX_POR_REQUISICAO = 2000;

export interface LeadImportado {
  name?: unknown;
  phone?: unknown;
  clinicName?: unknown;
  instagram?: unknown;
  city?: unknown;
}

/**
 * O que aconteceu com UM item da leva. São os mesmos destinos que o agregado
 * conta — a diferença é que aqui dá para saber QUAL item foi para onde.
 */
export type DesfechoDeLead =
  | "importado"
  | "duplicado"
  | "optOut"
  | "invalido"
  | "semWhatsapp"
  | "indeterminado";

export interface ResultadoPorItem {
  desfecho: DesfechoDeLead;
  /**
   * A forma CANÔNICA do telefone, quando houve veredito. Nula para quem nem
   * chegou lá (inválido, sem WhatsApp, indeterminado).
   */
  phone: string | null;
  /**
   * O lead que este item virou (importado) ou esbarrou (duplicado, optOut).
   * Nulo quando não há lead a apontar — e também nos importados de uma
   * SIMULAÇÃO, que por definição não criou linha nenhuma.
   */
  leadId: number | null;
}

export interface ResumoDaImportacao {
  importados: number;
  duplicados: number;
  invalidos: number;
  ignoradosPorOptOut: number;
  semWhatsapp: number;
  reprocessarDepois: number;
}

export interface ResultadoDaImportacao {
  resumo: ResumoDaImportacao;
  paraReprocessar: string[];
  /** MESMO tamanho e MESMA ordem da entrada — é o que amarra item a desfecho. */
  desfechos: ResultadoPorItem[];
}

export interface OpcoesDeImportacao {
  /**
   * De onde o dentista veio. Vai cru para `leads.origin`, e a Júlia LÊ esse
   * campo para dizer onde encontrou a clínica na abertura fria (ver o `ondeVi`
   * em julia-persona.ts). Por isso é dado de verdade, não etiqueta: "maps" faz
   * ela dizer "vi no Google", e isso precisa ter acontecido.
   */
  origin?: string;
  /** Decide tudo e não grava nada. O agregado e os desfechos saem iguais. */
  simular?: boolean;
}

/** Texto vindo de planilha: corta espaço, e vazio vira null. */
function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo.length > 0 ? limpo : null;
}

interface Candidato {
  /** Posição na entrada — é por ela que o desfecho volta para o item certo. */
  indice: number;
  phone: string;
  name: string | null;
  clinicName: string | null;
  instagram: string | null;
  city: string | null;
}

/**
 * A importação de verdade, sem HTTP no meio.
 *
 * Existe separada da rota para a promoção da Etapa 3C poder chamá-la — e para
 * as duas passarem exatamente pelas mesmas quatro regras. Uma segunda
 * implementação "parecida" seria a forma mais fácil de esquecer o opt-out.
 */
export async function importarLeads(
  entrada: LeadImportado[],
  opcoes: OpcoesDeImportacao = {},
): Promise<ResultadoDaImportacao> {
  const origin = opcoes.origin ?? "import";
  const simular = opcoes.simular === true;

  const resumo: ResumoDaImportacao = {
    importados: 0,
    duplicados: 0,
    invalidos: 0,
    ignoradosPorOptOut: 0,
    // O WhatsApp respondeu que o número não existe. Não vira lead: mandar
    // mensagem para número morto gasta rate limit e queima a reputação do
    // nosso número.
    semWhatsapp: 0,
    // Não houve veredito (Evolution fora do ar, número ausente da resposta).
    // NÃO é o mesmo que "não tem WhatsApp": estes leads não entram agora e
    // voltam na lista `paraReprocessar` para uma segunda tentativa.
    reprocessarDepois: 0,
  };
  const paraReprocessar: string[] = [];

  // Todo item da entrada tem uma posição aqui desde o começo: um desfecho que
  // some é pior que um desfecho errado, porque quem chama não tem como notar.
  const desfechos: ResultadoPorItem[] = entrada.map(() => ({
    desfecho: "indeterminado",
    phone: null,
    leadId: null,
  }));

  // ---- 1) normaliza e valida telefone -----------------------------------
  // Também deduplica DENTRO do próprio arquivo: planilha repetida é comum, e
  // sem isto o insert quebraria na restrição de unicidade do telefone.
  const candidatos: Candidato[] = [];
  const vistosNesteArquivo = new Set<string>();
  /**
   * Repetidos dentro da própria leva. Guardam o número NORMALIZADO (a forma
   * canônica deles nunca foi consultada, porque a primeira ocorrência já tinha
   * sido) para reencontrarem o lead no fim.
   */
  const normalizadoPorIndice = new Map<number, string>();

  for (const [indice, bruto] of entrada.entries()) {
    const phone = normalizarTelefone(
      typeof bruto?.phone === "string" ? bruto.phone : "",
    );
    if (!phone) {
      resumo.invalidos++;
      desfechos[indice] = { desfecho: "invalido", phone: null, leadId: null };
      continue;
    }
    if (vistosNesteArquivo.has(phone)) {
      resumo.duplicados++;
      desfechos[indice] = { desfecho: "duplicado", phone: null, leadId: null };
      normalizadoPorIndice.set(indice, phone);
      continue;
    }
    vistosNesteArquivo.add(phone);
    candidatos.push({
      indice,
      phone,
      name: texto(bruto?.name),
      clinicName: texto(bruto?.clinicName),
      instagram: texto(bruto?.instagram),
      city: texto(bruto?.city),
    });
  }

  // ---- 1.5) troca cada telefone pela forma que o WhatsApp reconhece ------
  // Uma chamada em lote para a importação inteira. Daqui para baixo, TUDO
  // (comparação com o banco e insert) usa a forma canônica — se não, a
  // correção da base dura até a próxima planilha.
  // Lista vazia não vira chamada: `canonicalizarTelefones` sai na primeira
  // linha quando não há número nenhum.
  const canonicos = await canonicalizarTelefones(candidatos.map((c) => c.phone));

  const prontos: Candidato[] = [];
  const vistosCanonicos = new Set<string>();
  const canonicoPorNormalizado = new Map<string, string>();

  for (const candidato of candidatos) {
    const resultado = canonicos.get(candidato.phone);

    if (!resultado || resultado.existe === null) {
      resumo.reprocessarDepois++;
      paraReprocessar.push(candidato.phone);
      desfechos[candidato.indice] = {
        desfecho: "indeterminado",
        phone: null,
        leadId: null,
      };
      continue;
    }
    if (resultado.existe === false) {
      resumo.semWhatsapp++;
      desfechos[candidato.indice] = {
        desfecho: "semWhatsapp",
        phone: null,
        leadId: null,
      };
      continue;
    }
    const phone = resultado.canonico as string;
    canonicoPorNormalizado.set(candidato.phone, phone);

    // Segunda deduplicação, agora pela forma canônica: a planilha pode
    // trazer o MESMO dentista nas duas formas (com e sem o nono dígito), e
    // só depois da canonicalização os dois viram a mesma string.
    if (vistosCanonicos.has(phone)) {
      resumo.duplicados++;
      desfechos[candidato.indice] = { desfecho: "duplicado", phone, leadId: null };
      continue;
    }
    vistosCanonicos.add(phone);
    prontos.push({ ...candidato, phone });
  }

  // ---- 2) confronta com o banco -----------------------------------------
  const existentes =
    prontos.length > 0
      ? await db
          .select({
            id: leadsTable.id,
            phone: leadsTable.phone,
            status: leadsTable.status,
          })
          .from(leadsTable)
          .where(
            inArray(
              leadsTable.phone,
              prontos.map((c) => c.phone),
            ),
          )
      : [];

  const existentePorTelefone = new Map(existentes.map((e) => [e.phone, e]));

  const paraInserir = prontos.filter((c) => {
    const existente = existentePorTelefone.get(c.phone);
    if (existente === undefined) return true;

    // Quem pediu para parar continua fora, mesmo voltando na planilha. Esta
    // checagem vem ANTES da de duplicado porque o motivo importa: no resumo,
    // "ignorei porque ele pediu para não ser incomodado" não é a mesma coisa
    // que "ignorei porque já estava na lista".
    if (existente.status === "lost") {
      resumo.ignoradosPorOptOut++;
      desfechos[c.indice] = {
        desfecho: "optOut",
        phone: c.phone,
        leadId: existente.id,
      };
      return false;
    }

    // Já existe: não sobrescreve nada e não re-prospecta. O lead que já
    // conversou com a Júlia não pode voltar para a fila de primeira abordagem.
    resumo.duplicados++;
    desfechos[c.indice] = {
      desfecho: "duplicado",
      phone: c.phone,
      leadId: existente.id,
    };
    return false;
  });

  // ---- 3) insere os novos ------------------------------------------------
  if (paraInserir.length > 0) {
    resumo.importados = paraInserir.length;

    if (simular) {
      for (const c of paraInserir) {
        desfechos[c.indice] = { desfecho: "importado", phone: c.phone, leadId: null };
      }
    } else {
      const criados = await db
        .insert(leadsTable)
        .values(
          paraInserir.map((c) => ({
            phone: c.phone,
            name: c.name,
            clinicName: c.clinicName,
            instagram: c.instagram,
            city: c.city,
            origin,
            status: "cold" as const,
            funnelStage: "new" as const,
            outreachStatus: "pending" as const,
          })),
        )
        .returning({ id: leadsTable.id, phone: leadsTable.phone });

      const idPorTelefone = new Map(criados.map((l) => [l.phone, l.id]));
      for (const c of paraInserir) {
        desfechos[c.indice] = {
          desfecho: "importado",
          phone: c.phone,
          leadId: idPorTelefone.get(c.phone) ?? null,
        };
      }
    }
  }

  // ---- 4) o duplicado também precisa saber de QUEM é duplicado -----------
  // Um dentista repetido dentro da própria leva vira "duplicado" antes de o
  // banco entrar na conversa, e ficaria sem lead nenhum a que apontar. Aqui ele
  // reencontra o lead que a primeira ocorrência criou (ou que já existia).
  //
  // Sem isso, promover duas clínicas com o mesmo telefone deixaria a segunda
  // marcada como "já é lead" com `lead_id` nulo — uma linha que afirma existir
  // um lead e não diz qual.
  const leadIdPorTelefone = new Map<string, number>();
  for (const d of desfechos) {
    if (d.phone && d.leadId !== null) leadIdPorTelefone.set(d.phone, d.leadId);
  }
  for (let i = 0; i < desfechos.length; i++) {
    const d = desfechos[i] as ResultadoPorItem;
    if (d.desfecho !== "duplicado" || d.leadId !== null) continue;
    const normalizado = normalizadoPorIndice.get(i);
    const phone = d.phone ?? (normalizado ? canonicoPorNormalizado.get(normalizado) : null);
    if (!phone) continue;
    d.phone = phone;
    d.leadId = leadIdPorTelefone.get(phone) ?? null;
  }

  return { resumo, paraReprocessar, desfechos };
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

    // Só o agregado sai daqui. Os desfechos por item existem para a promoção
    // da Etapa 3C, e mudar a resposta desta rota quebraria a tela de importação
    // sem nenhum ganho.
    const { resumo, paraReprocessar } = await importarLeads(
      entrada as LeadImportado[],
    );

    req.log.info(resumo, "Importação de leads concluída");
    res.json({ ...resumo, paraReprocessar });
  } catch (err) {
    req.log.error({ err }, "Failed to import leads");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
