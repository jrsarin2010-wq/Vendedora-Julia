/**
 * CONTROLE DA VARREDURA — as duas rotas do painel (Etapa 3B).
 *
 * Fora do contrato OpenAPI, no mesmo esquema da central de vigia e da
 * importação: são rotas de OPERAÇÃO do painel, não do modelo de dados. Assim
 * esta etapa não precisa regerar os clientes (orval) para entregar tela.
 *
 * O que a tela precisa saber, e por quê:
 *   - `ativa` e `interruptorGeral` são coisas DIFERENTES. Sem separar, o
 *     usuário clicaria num botão que não faz nada quando a env está desligada,
 *     e não teria como descobrir o motivo sem abrir o Railway.
 *   - `pausadaPorErro` existe porque o incidente de 15/08 (token errado) deixa
 *     a fila parada com o botão ligado. Sem o motivo na tela, isso é um
 *     mistério; com ele, é uma frase.
 */
import { Router, type IRouter } from "express";
import { db, apifyVarredurasTable } from "@workspace/db";
import {
  gastoDoMes,
  disparadasNas24h,
  TETO_MENSAL_USD,
  MAXIMO_RODADAS_POR_DIA,
} from "../lib/varredura";
import { lerConfigDeVarredura } from "../lib/varredura";
import { varreduraAtivaNoPainel, definirVarreduraAtiva } from "../lib/configuracoes";
import { estadoDaPausa } from "../lib/varredura-scheduler";

const router: IRouter = Router();

const STATUS_DA_FILA = [
  "pendente",
  "executando",
  "concluida",
  "falhou",
  "cancelada",
] as const;

export interface ContagemDaFila {
  pendente: number;
  executando: number;
  concluida: number;
  falhou: number;
  cancelada: number;
}

/**
 * Monta o retrato completo. Existe como função porque o POST responde
 * EXATAMENTE o mesmo shape do GET — a tela troca o estado com a resposta do
 * clique, sem uma segunda ida ao servidor que poderia contar outra história.
 */
async function montarStatus(agora: Date = new Date()) {
  // A fila inteira são 54 linhas: buscar tudo e contar aqui é a mesma decisão
  // (e o mesmo custo) do worker, e mantém as duas contas no mesmo código.
  const todas = await db.select().from(apifyVarredurasTable);

  const fila = Object.fromEntries(
    STATUS_DA_FILA.map((s) => [s, todas.filter((v) => v.status === s).length]),
  ) as unknown as ContagemDaFila;

  const concluidas = todas
    .filter((v) => v.status === "concluida" && v.concluidaEm)
    .sort(
      (a, b) =>
        new Date(b.concluidaEm as Date).getTime() -
        new Date(a.concluidaEm as Date).getTime(),
    );
  const ultima = concluidas[0];

  const pausa = estadoDaPausa();

  return {
    ativa: await varreduraAtivaNoPainel(),
    interruptorGeral: lerConfigDeVarredura().habilitado,
    pausadaPorErro: pausa.pausada,
    motivoPausa: pausa.motivo,
    fila,
    // Arredondado no 4º decimal como o custo gravado: a tela mostra dólar, e
    // 0.07500000000000001 na barra de orçamento é ruído de ponto flutuante.
    gastoMesUsd: Math.round(gastoDoMes(todas, agora) * 10_000) / 10_000,
    tetoUsd: TETO_MENSAL_USD,
    // Janela deslizante de 24h — é a mesma conta que trava o disparo. Ver
    // disparadasNas24h em lib/varredura.ts.
    rodadasHoje: disparadasNas24h(todas, agora),
    tetoDiario: MAXIMO_RODADAS_POR_DIA,
    ultimaVarredura: ultima
      ? {
          termo: ultima.termoBusca,
          cidade: ultima.cidade,
          uf: ultima.uf,
          concluidaEm: ultima.concluidaEm,
        }
      : null,
  };
}

// GET /api/varreduras/status
router.get("/varreduras/status", async (req, res) => {
  try {
    res.json(await montarStatus());
  } catch (err) {
    req.log.error({ err }, "Failed to get varredura status");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/varreduras/ativa — o botão.
 *
 * Aceita SÓ booleano de verdade. "true" como string viraria `true` num
 * `Boolean()` distraído, mas também viraria `true` a string "false" — e um
 * botão que liga a varredura quando o corpo diz "false" é o pior desfecho
 * possível aqui.
 */
router.post("/varreduras/ativa", async (req, res) => {
  try {
    const ativa = (req.body as { ativa?: unknown })?.ativa;
    if (typeof ativa !== "boolean") {
      return void res
        .status(400)
        .json({ error: 'Corpo inválido: esperado { "ativa": true | false }' });
    }

    await definirVarreduraAtiva(ativa);
    req.log.info({ ativa }, "Varredura ligada/desligada pelo painel");

    res.json(await montarStatus());
  } catch (err) {
    req.log.error({ err }, "Failed to set varredura ativa");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
