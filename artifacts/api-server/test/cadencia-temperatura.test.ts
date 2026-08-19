/**
 * Rodada 41, Parte 2 — cadência por temperatura.
 *
 * Um lead que pediu o link e um que mandou "oi" não podem receber a mesma
 * sequência: é lenta demais para quem está decidindo e insistente demais para
 * quem só olhou. A leva é armada na cadência da faixa — e rearmada a cada
 * resposta dele, então esquentar troca a cadência sozinho.
 */
import { ok, secao, fim } from "./assert";
import { post, chamar, evento } from "./driver";
import { state } from "./stubs/db.mjs";
import { ctrl } from "./stubs/openai.mjs";
import {
  CADENCIA_POR_FAIXA,
  INTERVALO_MINIMO_HORAS,
  MAXIMO_DE_TOQUES,
  FAIXAS,
} from "../src/lib/temperatura";

// ── As regras que protegem o número ─────────────────────────────────────────

secao("nenhuma faixa quebra as travas de proteção do número");
for (const faixa of FAIXAS) {
  const cadencia = CADENCIA_POR_FAIXA[faixa];
  ok(
    `${faixa}: nenhum intervalo menor que ${INTERVALO_MINIMO_HORAS}h`,
    cadencia.every((h) => h >= INTERVALO_MINIMO_HORAS),
    JSON.stringify(cadencia),
  );
  ok(
    `${faixa}: no máximo ${MAXIMO_DE_TOQUES} toques`,
    cadencia.length <= MAXIMO_DE_TOQUES,
    String(cadencia.length),
  );
  ok(
    `${faixa}: os toques são crescentes no tempo`,
    cadencia.every((h, i) => i === 0 || h > cadencia[i - 1]),
    JSON.stringify(cadencia),
  );
}

secao("temperatura mais alta = mais toques, e mais rápido");
ok("fervendo: 4 toques", CADENCIA_POR_FAIXA.fervendo.length === 4);
ok("quente: 4 toques", CADENCIA_POR_FAIXA.quente.length === 4);
ok("morno: 3 toques", CADENCIA_POR_FAIXA.morno.length === 3);
ok("frio: 2 toques, e para", CADENCIA_POR_FAIXA.frio.length === 2);
ok(
  "o primeiro toque do fervendo (2h) chega antes do primeiro do frio (48h)",
  CADENCIA_POR_FAIXA.fervendo[0] < CADENCIA_POR_FAIXA.frio[0],
);

// ── O webhook armando a leva ────────────────────────────────────────────────

/**
 * Um extrator SINCERO: junto de cada sinal, manda a prova que a peneira exige
 * (lib/peneira-de-sinais.ts). Antes desta rodada o ajudante afirmava sinal sem
 * prova nenhuma — modelava justamente o extrator que o lead 49 revelou, e por
 * isso a fixture parou de passar quando a peneira entrou.
 *
 * O trecho de prova tem que existir na mensagem que o cenário POSTA: é a fala
 * dele que sustenta o sinal, e é ela que o código vai procurar.
 */
const PROVA: Record<string, string> = {
  pediu_link: "me manda o link",
  perguntou_como_assinar: "como faço pra assinar",
};

const extracao = (sinais: string[]): string =>
  JSON.stringify({
    painPoints: sinais.includes("contou_a_dor")
      ? "ninguém responde o whatsapp quando está com paciente"
      : null,
    mainObjection: null,
    name: null,
    planInterest: null,
    funnelStage: null,
    isCustomer: false,
    wantsToStop: false,
    sinais,
    descoberta: sinais.includes("disse_quantos_prof") ? { profissionais: "2" } : {},
    trechos: Object.fromEntries(
      sinais.filter((s) => s in PROVA).map((s) => [s, PROVA[s]]),
    ),
  });

const pendentes = () => state.followUps.filter((f: any) => f.status === "pending");
const horasDoToque = (f: any): number =>
  Math.round((new Date(f.scheduledAt).getTime() - Date.now()) / (60 * 60 * 1000));

secao("lead FRIO (só 'oi') recebe a leva curta");
{
  ctrl.extraction = extracao([]);
  await post(evento("oi"));
  ok("2 toques armados", pendentes().length === 2, String(pendentes().length));
  ok(
    "nos horários do frio (48h e 168h)",
    horasDoToque(pendentes()[0]) === 48 && horasDoToque(pendentes()[1]) === 168,
    JSON.stringify(pendentes().map(horasDoToque)),
  );
  ok(
    "o último toque é a despedida ('minha última mensagem')",
    String(pendentes()[1].messageTemplate).includes("última mensagem"),
    String(pendentes()[1].messageTemplate),
  );
}

secao("lead FERVENDO recebe 4 toques rápidos");
{
  // pediu_link(30) + perguntou_como_assinar(30) + respondeu_algo(3) = 63
  ctrl.extraction = extracao(["pediu_link", "perguntou_como_assinar"]);
  await post(evento("como faço pra assinar? me manda o link"));
  ok("4 toques armados", pendentes().length === 4, String(pendentes().length));
  ok(
    "nos horários do fervendo (2h, 12h, 24h, 72h)",
    JSON.stringify(pendentes().map(horasDoToque)) === JSON.stringify([2, 12, 24, 72]),
    JSON.stringify(pendentes().map(horasDoToque)),
  );
}

secao("lead que ESQUENTA tem a cadência recalculada");
{
  ctrl.extraction = extracao([]);
  await post(evento("oi"));
  const levaFria = pendentes();
  ok("começou frio, com 2 toques", levaFria.length === 2, String(levaFria.length));

  // Ele volta e pergunta o preço: perguntou_preco(15) + respondeu_algo(3) = 18 → morno
  ctrl.extraction = extracao(["perguntou_preco"]);
  await chamar(evento("quanto custa isso?"));

  ok(
    "a leva fria pendente foi substituída (cancelada)",
    levaFria.every((f: any) => f.status === "cancelled"),
    JSON.stringify(levaFria.map((f: any) => f.status)),
  );
  ok("a leva nova tem os 3 toques do morno", pendentes().length === 3, String(pendentes().length));
  ok(
    "nos horários do morno (24h, 72h, 168h)",
    JSON.stringify(pendentes().map(horasDoToque)) === JSON.stringify([24, 72, 168]),
    JSON.stringify(pendentes().map(horasDoToque)),
  );
}

fim();
