/**
 * AGENDADOR DA VERIFICAÇÃO DE WHATSAPP — a Etapa 3A.
 *
 * Quarto `setInterval` do sistema, no molde do outreach-scheduler e do
 * varredura-scheduler: ciclo de 60 segundos e NO MÁXIMO UMA AÇÃO por ciclo.
 *
 * O que ele resolve: a varredura entrega clínica com o telefone que o Google
 * mostra, e telefone do Google não é telefone de WhatsApp. Sem alguém
 * perguntar, `tem_whatsapp` fica nulo para sempre e nada sai de `novo` — a
 * fila cresce e a taxa de aproveitamento da varredura continua desconhecida,
 * que é justamente o número que decide se vale gastar o crédito restante do
 * Apify.
 *
 * O que ele NÃO faz: promover a lead. Isso é a Etapa 3C e continua manual.
 * Verificar é uma CONSULTA; promover é mensagem para dentista de verdade.
 */
import { db } from "@workspace/db";
import { clinicasProspectTable } from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, asc } from "drizzle-orm";
import { canonicalizarTelefones } from "./canonicalizar-telefone";
import { logger } from "./logger";
import { sendTelegramVerificacao } from "./integrations";
import { verificacaoAtivaNoPainel } from "./configuracoes";
import {
  lerConfigDeVerificacao,
  triar,
  aplicarVeredito,
  loteMudo,
  resumirJanela,
  intervaloCumprido,
  TAMANHO_DO_LOTE,
  TETO_DIARIO,
  JANELA_DA_COTA_MS,
  LOTES_MUDOS_ATE_PAUSAR,
} from "./verificacao";

/** De quanto em quanto tempo o ciclo roda. */
const INTERVALO_DO_CICLO_MS = 60 * 1000;

export interface ResultadoDoCicloDeVerificacao {
  acao: "nada" | "verificou";
  motivo?: string;
  /** Quantos prospects entraram no lote. */
  lote?: number;
}

/**
 * PAUSA POR LOTES MUDOS — mesmo raciocínio da pausa da varredura.
 *
 * Se um lote inteiro volta com todos `existe === null`, isso não são 50
 * números ruins ao mesmo tempo: é a Evolution fora do ar ou credencial ruim.
 * Sem esta regra, uma queda vira o worker repetindo os mesmos 50 números de
 * minuto em minuto, indefinidamente — e como nada é gravado, nem a cota diária
 * o segura.
 *
 * Dois lotes seguidos para valer como sinal: o primeiro pode ser um soluço de
 * rede, e pausar no soluço custaria um reinício manual à toa.
 *
 * A pausa vive em memória de propósito: consertar a causa (variável, instância
 * da Evolution) reinicia o serviço, e o reinício é exatamente o gesto que deve
 * retomar. Não há estado morto para alguém esquecer de limpar.
 */
let pausa: { motivo: string } | null = null;
let lotesMudosSeguidos = 0;

/** Só para o teste: em produção quem retoma é o reinício do processo. */
export function retomarVerificacao(): void {
  pausa = null;
  lotesMudosSeguidos = 0;
}

/** A pausa, para o painel poder EXPLICAR por que nada está andando. */
export function estadoDaPausaDaVerificacao(): {
  pausada: boolean;
  motivo: string | null;
} {
  return { pausada: pausa !== null, motivo: pausa?.motivo ?? null };
}

/**
 * As datas de verificação dentro da janela de 24h.
 *
 * A consulta é filtrada no banco (e não "traz tudo e conta aqui", como as
 * rotas de resumo fazem) porque `clinicas_prospect` é a única tabela do
 * sistema que cresce sem teto: a Onda 1 prevê ~810 linhas, mas a Onda 2 não
 * tem esse limite. O filtro mantém o custo preso ao teto diário, não ao
 * tamanho da tabela.
 */
async function lerJanela(agora: Date) {
  const desde = new Date(agora.getTime() - JANELA_DA_COTA_MS);
  const linhas = await db
    .select({ verificadoWhatsappEm: clinicasProspectTable.verificadoWhatsappEm })
    .from(clinicasProspectTable)
    .where(gte(clinicasProspectTable.verificadoWhatsappEm, desde));
  return resumirJanela(
    linhas.map((l) => l.verificadoWhatsappEm),
    agora,
  );
}

async function pausarVerificacao(motivo: string): Promise<void> {
  pausa = { motivo };
  logger.error(
    { motivo, lotes: lotesMudosSeguidos },
    "Verificação PAUSADA — a Evolution não deu veredito nenhum. Nenhuma clínica foi descartada",
  );
  await sendTelegramVerificacao({ tipo: "pausada", motivo, lotes: lotesMudosSeguidos });
}

/**
 * Roda UM ciclo. Exportado para o teste exercitar o ciclo inteiro sem depender
 * de setInterval nem de relógio real.
 */
export async function rodarCicloDeVerificacao(
  agora: Date = new Date(),
): Promise<ResultadoDoCicloDeVerificacao> {
  // TRAVA HÍBRIDA, igual à da varredura: a env é o interruptor geral e a chave
  // do banco é a do dia a dia. Exigir as DUAS é o que permite ligar e desligar
  // pelo painel sem reiniciar, sem perder a capacidade de derrubar tudo pelo
  // Railway se algo der muito errado.
  //
  // A env vem primeiro de propósito: com o interruptor geral desligado não há
  // motivo para ir ao banco de minuto em minuto.
  if (!lerConfigDeVerificacao().habilitado) {
    return { acao: "nada", motivo: "desligada" };
  }

  if (pausa) {
    return { acao: "nada", motivo: "pausada" };
  }

  if (!(await verificacaoAtivaNoPainel())) {
    return { acao: "nada", motivo: "desligada_no_painel" };
  }

  const janela = await lerJanela(agora);

  if (!intervaloCumprido(janela.ultimo, agora)) {
    return { acao: "nada", motivo: "intervalo_minimo" };
  }

  if (janela.verificados >= TETO_DIARIO) {
    return { acao: "nada", motivo: "cota_diaria" };
  }

  // `sem_telefone` nunca entra: a coluna nula é o critério, e é ela que separa
  // "o Maps não deu telefone" de "o telefone que ele deu não presta".
  const candidatos = await db
    .select()
    .from(clinicasProspectTable)
    .where(
      and(
        eq(clinicasProspectTable.statusProspeccao, "novo"),
        isNotNull(clinicasProspectTable.telefoneRaw),
      ),
    )
    .orderBy(asc(clinicasProspectTable.id))
    .limit(TAMANHO_DO_LOTE);

  if (candidatos.length === 0) {
    return { acao: "nada", motivo: "fila_vazia" };
  }

  const { aprovados, reprovados } = triar(candidatos);

  // Reprovado na triagem sai de `novo` sem custar chamada externa — e por isso
  // NÃO ganha `verificado_whatsapp_em`: aquela coluna significa "a Evolution
  // olhou", e a cota diária existe para proteger a Evolution. Contar aqui
  // gastaria cota que ninguém usou.
  if (reprovados.length > 0) {
    await db
      .update(clinicasProspectTable)
      .set({ statusProspeccao: "telefone_invalido", atualizadoEm: agora })
      .where(inArray(clinicasProspectTable.id, reprovados));
  }

  if (aprovados.length === 0) {
    logger.info(
      { lote: candidatos.length, invalidos: reprovados.length },
      "Lote inteiro reprovado na triagem — nenhuma consulta à Evolution",
    );
    return { acao: "verificou", motivo: "so_invalidos", lote: candidatos.length };
  }

  const mapa = await canonicalizarTelefones(aprovados.map((a) => a.numero));
  const veredito = aplicarVeredito(aprovados, mapa);

  if (loteMudo(veredito)) {
    lotesMudosSeguidos++;
    if (lotesMudosSeguidos >= LOTES_MUDOS_ATE_PAUSAR) {
      await pausarVerificacao(
        `${lotesMudosSeguidos} lotes seguidos sem nenhum veredito da Evolution`,
      );
      return { acao: "nada", motivo: "pausada", lote: candidatos.length };
    }
    logger.warn(
      { lote: candidatos.length, consultados: aprovados.length, seguidos: lotesMudosSeguidos },
      "Lote inteiro voltou indeterminado — mais um assim e a verificação pausa",
    );
    return { acao: "verificou", motivo: "lote_mudo", lote: candidatos.length };
  }

  lotesMudosSeguidos = 0;

  // Um UPDATE por apto porque cada um grava o SEU número canônico; os outros
  // dois desfechos vão em lote, que é o que a maioria das linhas é.
  for (const apto of veredito.aptos) {
    await db
      .update(clinicasProspectTable)
      .set({
        statusProspeccao: "apto",
        telefoneWhatsapp: apto.canonico,
        temWhatsapp: true,
        verificadoWhatsappEm: agora,
        atualizadoEm: agora,
      })
      .where(eq(clinicasProspectTable.id, apto.id));
  }

  if (veredito.semWhatsapp.length > 0) {
    // `telefone_whatsapp` continua NULO: não existe conta, então não existe
    // forma canônica — inventar uma seria gravar identidade de quem não tem.
    await db
      .update(clinicasProspectTable)
      .set({
        statusProspeccao: "sem_whatsapp",
        temWhatsapp: false,
        verificadoWhatsappEm: agora,
        atualizadoEm: agora,
      })
      .where(inArray(clinicasProspectTable.id, veredito.semWhatsapp));
  }

  // A DISTRIBUIÇÃO do lote, em toda rodada.
  //
  // Ninguém testou o endpoint com telefone FIXO: a suposição é que ele volta
  // `exists: false` limpo, como o número inexistente. Se vier diferente, é
  // aqui que aparece — um `indeterminados` alto no primeiro lote significa que
  // a suposição caiu e a regra muda. O warn de jid ilegível, dentro de
  // canonicalizar-telefone.ts, é a outra metade dessa auditoria.
  logger.info(
    {
      lote: candidatos.length,
      consultados: aprovados.length,
      comWhatsapp: veredito.aptos.length,
      semWhatsapp: veredito.semWhatsapp.length,
      indeterminados: veredito.indeterminados.length,
      invalidos: reprovados.length,
      verificadosNa24h: janela.verificados + veredito.aptos.length + veredito.semWhatsapp.length,
      tetoDiario: TETO_DIARIO,
    },
    "Lote de verificação concluído",
  );

  return { acao: "verificou", lote: candidatos.length };
}

export function startVerificacaoScheduler(): void {
  const { habilitado } = lerConfigDeVerificacao();
  logger.info(
    { habilitado, tamanhoDoLote: TAMANHO_DO_LOTE, tetoDiario: TETO_DIARIO },
    habilitado
      ? "Verificação de WhatsApp: interruptor geral LIGADO (o botão do painel decide o resto)"
      : "Verificação de WhatsApp desligada (VERIFICACAO_ENABLED != true) — a Evolution não será consultada",
  );

  const rodar = async () => {
    try {
      const r = await rodarCicloDeVerificacao();
      // Estados de repouso não viram log: são verdadeiros a cada minuto, e
      // repeti-los afogaria o que importa.
      if (
        r.acao === "nada" &&
        r.motivo &&
        !["desligada", "desligada_no_painel", "fila_vazia", "intervalo_minimo", "cota_diaria"].includes(
          r.motivo,
        )
      ) {
        logger.debug({ motivo: r.motivo }, "Verificação não rodou");
      }
    } catch (err) {
      logger.error({ err }, "Erro no ciclo de verificação de WhatsApp");
    }
  };

  setInterval(rodar, INTERVALO_DO_CICLO_MS);
}
