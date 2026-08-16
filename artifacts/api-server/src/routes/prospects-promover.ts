/**
 * PROMOÇÃO DE CLÍNICA A DENTISTA — POST /api/prospects/promover (Etapa 3C).
 *
 * É aqui que a clínica captada no Maps atravessa a fronteira e vira um lead que
 * a Júlia pode abordar. Do outro lado tem dentista de verdade recebendo
 * mensagem, então esta rota é MANUAL por decisão, não por cautela genérica: a
 * abertura fria é escrita pelo modelo a cada lead, não existe template para
 * revisar antes, e a única forma de ver o que ela escreve é ela escrever.
 *
 * Três escolhas que sustentam isso:
 *
 * 1. LISTA EXPLÍCITA DE IDS. Nada de "promova todos os aptos". Somado ao teto
 *    de 50 e ao diálogo do painel que lista os NOMES, o caminho natural vira
 *    promover pouca gente e ler as conversas.
 *
 * 2. NÃO INSERE DIRETO — chama `importarLeads()` (routes/leads-import.ts). Tudo
 *    que a promoção precisa já mora lá: dedup, opt-out, canonicalização e o
 *    `outreachStatus: "pending"` explícito. O default da coluna é 'none' e o
 *    agendador só olha 'pending' — um insert próprio criaria dentista que nunca
 *    é abordado, em silêncio.
 *
 * 3. RECANONICALIZA. Sim, a Etapa 3A já perguntou à Evolution quando marcou a
 *    clínica como `apto`. Perguntar de novo é UMA chamada por lote e é
 *    bem-vinda: número verificado dias atrás pode ter mudado de dono.
 */
import { Router, type IRouter } from "express";
import { db, clinicasProspectTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { normalizarTelefone } from "../lib/filtro-spam";
import { importarLeads } from "./leads-import";

const router: IRouter = Router();

/**
 * Teto por chamada. Diferente do teto da importação (2000), este é limite de
 * NEGÓCIO: é o que impede uma leva grande de sair antes de alguém ter lido as
 * primeiras conversas. Ver o processo no cabeçalho.
 */
const MAXIMO_POR_CHAMADA = 50;

interface Promovido {
  prospectId: number;
  nome: string;
  leadId: number | null;
}

interface JaExistente extends Promovido {
  motivo: "duplicado" | "opt-out";
}

interface SemLead {
  prospectId: number;
  nome: string;
}

interface Recusado {
  prospectId: number;
  motivo: string;
}

/** Nada foi processado: a resposta é toda vazia menos os recusados. */
function nadaFeito(solicitados: number, modo: string, recusados: Recusado[]) {
  return {
    solicitados,
    modo,
    promovidos: [] as Promovido[],
    jaExistentes: [] as JaExistente[],
    semWhatsapp: [] as SemLead[],
    adiados: [] as SemLead[],
    recusados,
  };
}

router.post("/prospects/promover", async (req, res) => {
  try {
    const corpo = req.body as { prospectIds?: unknown; modo?: unknown };

    // O modo é conferido ANTES da lista de propósito: sem ele não dá para saber
    // se a requisição queria escrever, e "na dúvida não escreve" só funciona se
    // a dúvida for recusada em vez de resolvida por padrão.
    const modo = corpo?.modo;
    if (modo !== "simular" && modo !== "aplicar") {
      return void res.status(400).json({
        error: 'Corpo inválido: esperado { "modo": "simular" | "aplicar" }',
      });
    }

    const ids = corpo?.prospectIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      return void res.status(400).json({
        error: 'Corpo inválido: esperado { "prospectIds": [1, 2, 3] }',
      });
    }
    if (!ids.every((i) => Number.isInteger(i))) {
      return void res
        .status(400)
        .json({ error: "prospectIds só aceita números inteiros." });
    }
    if (ids.length > MAXIMO_POR_CHAMADA) {
      return void res.status(413).json({
        error: `Máximo de ${MAXIMO_POR_CHAMADA} clínicas por vez. Promova em levas — e leia as conversas entre uma e outra.`,
      });
    }

    const solicitados = [...new Set(ids as number[])];

    const prospects = await db
      .select()
      .from(clinicasProspectTable)
      .where(inArray(clinicasProspectTable.id, solicitados));

    const porId = new Map(prospects.map((p) => [p.id, p]));

    // ---- pré-checagem: ou vale a lista inteira, ou não vale nada ----------
    // Recusar item por item e processar o resto seria pior: quem clicou viu uma
    // lista de nomes no diálogo e espera que aquela lista tenha ido. Metade dela
    // ter ido, com o motivo escondido num campo da resposta, é o tipo de coisa
    // que só se descobre pela conversa que não aconteceu.
    const recusados: Recusado[] = [];
    for (const id of solicitados) {
      const p = porId.get(id);
      if (!p) {
        recusados.push({ prospectId: id, motivo: "não encontrado" });
        continue;
      }
      if (p.statusProspeccao !== "apto") {
        recusados.push({
          prospectId: id,
          motivo: `status_prospeccao=${p.statusProspeccao}`,
        });
        continue;
      }
      // `apto` sem telefone canônico é registro que se contradiz: quem marca
      // `apto` é a Etapa 3A, e ela grava as duas coisas na mesma linha. Se
      // aparecer, é bug nosso — e bug nosso tem que ser barulhento, não virar
      // "adiado" para sempre numa lista que ninguém revisa.
      if (!p.telefoneWhatsapp || !normalizarTelefone(p.telefoneWhatsapp)) {
        recusados.push({
          prospectId: id,
          motivo: "apto sem telefone_whatsapp utilizável",
        });
      }
    }

    if (recusados.length > 0) {
      req.log.warn(
        { solicitados: solicitados.length, recusados: recusados.length },
        "Promoção recusada: a lista tem clínica fora de 'apto'",
      );
      return void res
        .status(409)
        .json(nadaFeito(solicitados.length, modo, recusados));
    }

    const escolhidas = solicitados.map((id) => porId.get(id)!);

    // ---- a importação decide, com as mesmas regras de sempre ---------------
    const { desfechos } = await importarLeads(
      escolhidas.map((p) => ({
        // A forma canônica gravada pela 3A — a mesma que `leads.phone` guarda.
        phone: p.telefoneWhatsapp,
        clinicName: p.nome,
        city: p.cidade,
        // O nome do DENTISTA não está na ficha da clínica, e inventar seria a
        // pior forma possível de começar. A Júlia pergunta na abertura.
        name: null,
        // NUNCA copiado, e enviado explicitamente nulo.
        //
        // Em julia-persona.ts o campo `instagram` do lead VENCE o `origin` ao
        // dizer onde a clínica foi encontrada: com ele preenchido, a Júlia
        // afirma "vi no Instagram da clínica" mesmo com origin "maps". Hoje
        // `clinicas_prospect.instagram` é sempre nulo e nada acontece; no dia
        // em que alguém captar Instagram na varredura, copiá-lo aqui faria a
        // Júlia MENTIR sobre a origem do contato — sem ninguém pedir e sem
        // sintoma nenhum, porque a frase continuaria bem escrita.
        instagram: null,
        // A reputação do Google é COPIADA, ao contrário do Instagram acima: aqui
        // o dado é verdadeiro e é da mesma clínica que estamos abordando. É o
        // único material que diferencia uma clínica da outra na abertura fria —
        // sem ele a ficha de todo lead promovido fica igual (nome nulo,
        // Instagram nulo, origem "maps"), e ficha igual gera mensagem igual.
        //
        // Quem decide se isso pode ser DITO é julia-persona.ts, que só cita
        // reputação alta e com volume. Copiar aqui não autoriza citar.
        nota: p.nota,
        totalAvaliacoes: p.totalAvaliacoes,
      })),
      {
        // Faz a Júlia dizer "vi no Google, procurando clínica na região". É
        // verdade: foi exatamente assim que a varredura achou a clínica.
        origin: "maps",
        simular: modo === "simular",
      },
    );

    const promovidos: Promovido[] = [];
    const jaExistentes: JaExistente[] = [];
    const semWhatsapp: SemLead[] = [];
    const adiados: SemLead[] = [];
    const gravacoes: {
      id: number;
      status: "promovido" | "ja_existente" | "sem_whatsapp";
      leadId: number | null;
    }[] = [];

    escolhidas.forEach((p, i) => {
      const d = desfechos[i]!;
      const identificacao = { prospectId: p.id, nome: p.nome };

      switch (d.desfecho) {
        case "importado":
          promovidos.push({ ...identificacao, leadId: d.leadId });
          gravacoes.push({ id: p.id, status: "promovido", leadId: d.leadId });
          break;
        case "duplicado":
          jaExistentes.push({ ...identificacao, leadId: d.leadId, motivo: "duplicado" });
          gravacoes.push({ id: p.id, status: "ja_existente", leadId: d.leadId });
          break;
        // Opt-out é DEFINITIVO. Vira `ja_existente` e para ali: nunca
        // promovido, nunca reabordado. Quem pediu para a Júlia parar não pode
        // voltar à fila só porque a varredura recapturou a clínica dele.
        case "optOut":
          jaExistentes.push({ ...identificacao, leadId: d.leadId, motivo: "opt-out" });
          gravacoes.push({ id: p.id, status: "ja_existente", leadId: d.leadId });
          break;
        case "semWhatsapp":
          // O número existia na 3A e não existe mais. O fato mudou: grava.
          semWhatsapp.push(identificacao);
          gravacoes.push({ id: p.id, status: "sem_whatsapp", leadId: null });
          break;
        // "não sei" (Evolution muda) e o inválido que a pré-checagem já teria
        // barrado. Continuam `apto`, sem gravação nenhuma, e voltam na próxima
        // tentativa. Tratar indeterminado como "não tem" descartaria clínica boa
        // por instabilidade da Evolution.
        case "indeterminado":
        case "invalido":
          adiados.push(identificacao);
          break;
      }
    });

    // ---- grava do lado do prospect ----------------------------------------
    // Um UPDATE por clínica porque cada uma leva o SEU lead_id. São no máximo
    // 50 — o mesmo desenho do agendador da verificação.
    if (modo === "aplicar" && gravacoes.length > 0) {
      const agora = new Date();
      for (const g of gravacoes) {
        await db
          .update(clinicasProspectTable)
          .set({
            statusProspeccao: g.status,
            leadId: g.leadId,
            atualizadoEm: agora,
          })
          .where(eq(clinicasProspectTable.id, g.id));
      }
    }

    const resposta = {
      solicitados: solicitados.length,
      modo,
      promovidos,
      jaExistentes,
      semWhatsapp,
      adiados,
      recusados: [] as Recusado[],
    };

    req.log.info(
      {
        modo,
        solicitados: solicitados.length,
        promovidos: promovidos.length,
        jaExistentes: jaExistentes.length,
        semWhatsapp: semWhatsapp.length,
        adiados: adiados.length,
      },
      modo === "aplicar"
        ? "Clínicas promovidas a dentistas"
        : "Simulação de promoção (nada gravado)",
    );

    res.json(resposta);
  } catch (err) {
    req.log.error({ err }, "Failed to promote prospects");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
