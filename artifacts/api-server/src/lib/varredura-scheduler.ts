/**
 * AGENDADOR DA VARREDURA APIFY — a fila de captação anda sozinha.
 *
 * Terceiro `setInterval` do sistema, no molde do outreach-scheduler: ciclo de
 * 60 segundos e NO MÁXIMO UMA AÇÃO por ciclo.
 *
 * A ordem dentro do ciclo é deliberada:
 *
 *   1. existe run em execução?  → verifica UMA e encerra o ciclo
 *   2. senão, pode disparar?    → dispara UMA e encerra o ciclo
 *   3. senão                    → não faz nada
 *
 * Terminar o que já começou vem antes de começar mais: sem isso, uma run lenta
 * faria o worker acumular runs em voo, e o custo de cada uma só aparece quando
 * ela termina — ou seja, gastaria às cegas.
 *
 * A escolha por POLLING (e não webhook) é pelo que já existe: o ciclo já
 * acorda de minuto em minuto, e perguntar "terminou?" nele custa nada. Webhook
 * exigiria endpoint público novo, com segredo e validação — superfície de
 * ataque a mais para resolver o que o ciclo já resolve. E como a ingestão é
 * idempotente (`ON CONFLICT (place_id) DO NOTHING`), verificar duas vezes a
 * mesma run é inofensivo.
 */
import { db } from "@workspace/db";
import { apifyVarredurasTable, clinicasProspectTable, type ApifyVarredura } from "@workspace/db";
import { eq } from "drizzle-orm";
import { iniciarRun, consultarRun, baixarDataset, type EstadoDaRun } from "./apify";
import { logger } from "./logger";
import { sendTelegramVarredura } from "./integrations";
import {
  lerConfigDeVarredura,
  calcularOrcamento,
  escolherProxima,
  inputDoAtor,
  prepararLote,
  runPendurada,
  telefoneAproveitavel,
  arredondarUsd,
  USD_POR_LUGAR,
  TETO_MENSAL_USD,
  MAXIMO_RODADAS_POR_DIA,
  LIMITE_DE_TENTATIVAS,
  type ItemDoMaps,
} from "./varredura";

/** De quanto em quanto tempo o ciclo roda. */
const INTERVALO_DO_CICLO_MS = 60 * 1000;

const VINTE_E_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000;

export interface ResultadoDoCicloDeVarredura {
  acao: "nada" | "verificou" | "disparou";
  motivo?: string;
  varreduraId?: number;
}

/**
 * Último dia em que cada tipo de alerta saiu. Existe porque dois dos três
 * gatilhos (orçamento e fila vazia) são ESTADOS, não eventos: eles continuam
 * verdadeiros a cada ciclo, e sem esta trava o Telegram receberia um aviso por
 * minuto até alguém mexer.
 */
const ultimoAlerta = new Map<string, string>();

function podeAlertar(tipo: string, agora: Date): boolean {
  const dia = agora.toISOString().slice(0, 10);
  if (ultimoAlerta.get(tipo) === dia) return false;
  ultimoAlerta.set(tipo, dia);
  return true;
}

/** Só para o teste: zera a memória de alertas entre cenários. */
export function esquecerAlertasDeVarredura(): void {
  ultimoAlerta.clear();
}

/** Mesmo ano e mesmo mês — a janela do crédito do Apify. */
function noMesmoMes(data: Date, agora: Date): boolean {
  const d = new Date(data);
  return d.getUTCFullYear() === agora.getUTCFullYear() && d.getUTCMonth() === agora.getUTCMonth();
}

function gastoDoMes(todas: ApifyVarredura[], agora: Date): number {
  return todas
    .filter((v) => v.status === "concluida" && v.concluidaEm && noMesmoMes(v.concluidaEm, agora))
    .reduce((soma, v) => soma + Number(v.custoRealUsd ?? 0), 0);
}

/**
 * Conta a falha e decide se ainda vale tentar. Devolve o que aconteceu para
 * quem chamou montar o resultado do ciclo.
 *
 * `disparada_em` NÃO é limpo de propósito: a tentativa que falhou consumiu um
 * disparo de verdade, e a cota diária tem de continuar enxergando isso.
 */
async function registrarFalha(
  varredura: ApifyVarredura,
  motivo: string,
  agora: Date,
): Promise<{ desistiu: boolean; tentativas: number }> {
  const tentativas = varredura.tentativas + 1;
  const desistiu = tentativas >= LIMITE_DE_TENTATIVAS;

  await db
    .update(apifyVarredurasTable)
    .set({
      status: desistiu ? "falhou" : "pendente",
      tentativas,
      erroMensagem: motivo,
      ...(desistiu ? { concluidaEm: agora } : {}),
    })
    .where(eq(apifyVarredurasTable.id, varredura.id));

  logger.error(
    { varreduraId: varredura.id, tentativas, motivo, desistiu },
    desistiu
      ? "Varredura FALHOU em definitivo — saiu da fila"
      : "Varredura falhou — volta para a fila",
  );

  if (desistiu) {
    await sendTelegramVarredura({
      tipo: "falhou",
      termo: varredura.termoBusca,
      cidade: varredura.cidade,
      uf: varredura.uf,
      tentativas,
      erro: motivo,
    });
  }

  return { desistiu, tentativas };
}

/** Ingere o dataset e só ENTÃO fecha a varredura. */
async function ingerir(
  varredura: ApifyVarredura,
  estado: EstadoDaRun,
  agora: Date,
): Promise<ResultadoDoCicloDeVarredura> {
  const datasetId = estado.datasetId ?? varredura.apifyDatasetId;
  if (!datasetId) {
    const { desistiu } = await registrarFalha(varredura, "run concluída sem dataset", agora);
    return {
      acao: "verificou",
      motivo: desistiu ? "falhou" : "vai_tentar_de_novo",
      varreduraId: varredura.id,
    };
  }

  const baixado = await baixarDataset(datasetId);
  if (!baixado.ok) {
    // A varredura CONTINUA "executando" e o próximo ciclo tenta de novo. Não é
    // falha da run — é falha nossa de download, e a ingestão é idempotente.
    logger.warn(
      { varreduraId: varredura.id, datasetId, erro: baixado.erro },
      "Não consegui baixar o dataset — tento no próximo ciclo",
    );
    return { acao: "verificou", motivo: "dataset_falhou", varreduraId: varredura.id };
  }

  const lote = prepararLote(baixado.itens as ItemDoMaps[], varredura);

  let inseridas = 0;
  if (lote.linhas.length > 0) {
    const gravadas = await db
      .insert(clinicasProspectTable)
      .values(lote.linhas)
      .onConflictDoNothing({ target: clinicasProspectTable.placeId })
      .returning({ id: clinicasProspectTable.id });
    inseridas = gravadas.length;
  }

  // O custo real vem do objeto de run. Se o campo não for encontrado, calcula
  // pelo que foi recebido e DIZ que calculou — gravar zero faria a trava de
  // orçamento achar que o mês inteiro é de graça, que é o pior erro possível
  // aqui.
  const custo = estado.custoUsd ?? arredondarUsd(baixado.itens.length * USD_POR_LUGAR);
  if (estado.custoUsd === null) {
    logger.warn(
      { varreduraId: varredura.id, itens: baixado.itens.length, custoCalculado: custo },
      "Custo não veio na run — usando o cálculo por lugar (confira o nome do campo em lib/apify.ts)",
    );
  } else {
    logger.info(
      { varreduraId: varredura.id, campo: estado.campoDoCusto, custo },
      "Custo real lido da run",
    );
  }

  await db
    .update(apifyVarredurasTable)
    .set({
      status: "concluida",
      resultadosRecebidos: baixado.itens.length,
      custoRealUsd: String(custo),
      concluidaEm: agora,
      apifyDatasetId: datasetId,
    })
    .where(eq(apifyVarredurasTable.id, varredura.id));

  logger.info(
    {
      varreduraId: varredura.id,
      recebidos: baixado.itens.length,
      inseridas,
      jaExistiam: lote.linhas.length - inseridas,
      semPlaceId: lote.semPlaceId,
      fechados: lote.fechados,
      repetidosNoLote: lote.repetidos,
      comTelefoneUtil: lote.linhas.filter((l) => telefoneAproveitavel(l.telefoneRaw ?? null)).length,
    },
    "Varredura concluída e ingerida",
  );

  return { acao: "verificou", motivo: "concluida", varreduraId: varredura.id };
}

/** Ação A — olhar a run que está em voo. */
async function verificar(
  varredura: ApifyVarredura,
  agora: Date,
): Promise<ResultadoDoCicloDeVarredura> {
  const falhar = async (motivo: string): Promise<ResultadoDoCicloDeVarredura> => {
    const { desistiu } = await registrarFalha(varredura, motivo, agora);
    return {
      acao: "verificou",
      motivo: desistiu ? "falhou" : "vai_tentar_de_novo",
      varreduraId: varredura.id,
    };
  };

  if (!varredura.apifyRunId) {
    return falhar("varredura marcada como executando sem run id");
  }

  const estado = await consultarRun(varredura.apifyRunId);

  if (!estado.ok) {
    // A consulta falhou: a run pode estar ótima, só não sabemos. Espera —
    // a não ser que já tenha passado do tempo em que ela poderia terminar.
    if (runPendurada(varredura.disparadaEm, agora)) {
      return falhar(`run pendurada e sem resposta do Apify (${estado.erro ?? "sem detalhe"})`);
    }
    return { acao: "verificou", motivo: "consulta_falhou", varreduraId: varredura.id };
  }

  if (estado.situacao === "rodando") {
    if (runPendurada(varredura.disparadaEm, agora)) {
      return falhar(`run pendurada há mais de 30 min (status ${estado.statusCru})`);
    }
    return { acao: "verificou", motivo: "rodando", varreduraId: varredura.id };
  }

  if (estado.situacao === "falha") {
    return falhar(`run terminou como ${estado.statusCru}`);
  }

  return ingerir(varredura, estado, agora);
}

/**
 * Roda UM ciclo. Exportado para o teste exercitar o ciclo inteiro sem depender
 * de setInterval nem de relógio real.
 */
export async function rodarCicloDeVarredura(
  agora: Date = new Date(),
): Promise<ResultadoDoCicloDeVarredura> {
  const config = lerConfigDeVarredura();

  // Trava mestra antes de qualquer consulta: desligado é desligado.
  if (!config.habilitado) {
    return { acao: "nada", motivo: "desligado" };
  }

  // A fila inteira são 54 linhas: buscar tudo e contar aqui sai mais barato
  // que três consultas com agregação, e mantém a decisão em código testável.
  const todas = await db.select().from(apifyVarredurasTable);

  const emVoo = todas.filter((v) => v.status === "executando");
  if (emVoo[0]) {
    return verificar(emVoo[0], agora);
  }

  const limite24h = agora.getTime() - VINTE_E_QUATRO_HORAS_MS;
  const disparadasNas24h = todas.filter(
    (v) => v.disparadaEm && new Date(v.disparadaEm).getTime() >= limite24h,
  ).length;
  if (disparadasNas24h >= MAXIMO_RODADAS_POR_DIA) {
    return { acao: "nada", motivo: "cota_diaria" };
  }

  const proxima = escolherProxima(todas.filter((v) => v.status === "pendente"));
  if (!proxima) {
    // Tabela vazia não é "fila esvaziou": é seed que ainda não rodou. Avisar
    // que "a Onda 1 acabou" nesse caso seria mentira.
    if (todas.length > 0 && podeAlertar("fila_vazia", agora)) {
      await sendTelegramVarredura({
        tipo: "fila_vazia",
        concluidas: todas.filter((v) => v.status === "concluida").length,
        gastoNoMes: gastoDoMes(todas, agora),
      });
    }
    return { acao: "nada", motivo: "fila_vazia" };
  }

  // `resultadosEmVoo` é derivado, não fixado em zero: hoje ele é sempre zero
  // porque o ciclo já teria saído lá em cima se houvesse run em voo, mas se
  // um dia a ordem mudar, a conta continua certa em vez de calar.
  const decisao = calcularOrcamento({
    gastoNoMes: gastoDoMes(todas, agora),
    resultadosEmVoo: emVoo.reduce((soma, v) => soma + v.maxResultados, 0),
    maxResultados: proxima.maxResultados,
  });

  if (!decisao.pode) {
    logger.warn(
      { comprometido: decisao.comprometido, teto: TETO_MENSAL_USD },
      "Trava de orçamento: varredura não disparada",
    );
    if (podeAlertar("orcamento", agora)) {
      await sendTelegramVarredura({
        tipo: "orcamento",
        comprometido: decisao.comprometido,
        teto: TETO_MENSAL_USD,
      });
    }
    return { acao: "nada", motivo: "orcamento" };
  }

  const inicio = await iniciarRun(inputDoAtor(proxima));
  if (!inicio.ok) {
    const { desistiu } = await registrarFalha(
      proxima,
      inicio.erro ?? "falha ao iniciar a run",
      agora,
    );
    return {
      acao: "nada",
      motivo: desistiu ? "falhou" : "falha_ao_disparar",
      varreduraId: proxima.id,
    };
  }

  await db
    .update(apifyVarredurasTable)
    .set({
      status: "executando",
      apifyRunId: inicio.runId ?? null,
      apifyDatasetId: inicio.datasetId ?? null,
      disparadaEm: agora,
      erroMensagem: null,
    })
    .where(eq(apifyVarredurasTable.id, proxima.id));

  logger.info(
    {
      varreduraId: proxima.id,
      termo: proxima.termoBusca,
      cidade: `${proxima.cidade}/${proxima.uf}`,
      previsto: decisao.previsto,
      comprometido: decisao.comprometido,
    },
    "Varredura disparada",
  );

  return { acao: "disparou", varreduraId: proxima.id };
}

export function startVarreduraScheduler(): void {
  const config = lerConfigDeVarredura();
  logger.info(
    { habilitado: config.habilitado, teto: TETO_MENSAL_USD, porDia: MAXIMO_RODADAS_POR_DIA },
    config.habilitado
      ? "Varredura Apify LIGADA"
      : "Varredura Apify desligada (APIFY_SWEEP_ENABLED != true) — nada será gasto",
  );

  const rodar = async () => {
    try {
      const r = await rodarCicloDeVarredura();
      // "desligado" e "fila_vazia" a cada minuto seriam só ruído.
      if (r.acao === "nada" && r.motivo && !["desligado", "fila_vazia"].includes(r.motivo)) {
        logger.debug({ motivo: r.motivo }, "Varredura não disparou");
      }
    } catch (err) {
      logger.error({ err }, "Erro no ciclo de varredura");
    }
  };

  setInterval(rodar, INTERVALO_DO_CICLO_MS);
}
