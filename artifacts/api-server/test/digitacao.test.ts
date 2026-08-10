/**
 * Rodada 28 — digitação humanizada.
 *
 * O que está sob teste é a borda de envio de verdade, então este arquivo
 * importa `integrations` com "?real" (pula o stub) e troca só o `fetch` e o
 * `AbortSignal.timeout` — assim dá para inspecionar o que sai no corpo da
 * requisição e quanto tempo de paciência foi pedido, sem tocar a rede.
 *
 * O ponto que justifica o teste do timeout: o `delay` da Evolution é
 * BLOQUEANTE. Em `sendMessageWithTyping` ela faz `await delay(options.delay)`
 * dentro do handler, antes de mandar a mensagem — a resposta HTTP só volta
 * depois. Com o timeout antigo de 10s fixo, um texto longo (atraso de até 12s)
 * seria abortado por nós e a mensagem não sairia. Um teste que só olhasse o
 * corpo não pegaria isso.
 */
import { ok, secao, fim } from "./assert";
import {
  tempoDeDigitacao,
  MAXIMO_DIGITACAO_MS,
  sendWhatsAppMessage,
  sendWhatsAppAudio,
} from "../src/lib/integrations?real";

const MINIMO_MS = 2_000;

// ── Parte 1: o cálculo puro ────────────────────────────────────────────────

secao("tempo de digitação — nunca instantâneo, nunca eterno");
ok("texto vazio ainda espera o mínimo", tempoDeDigitacao("") >= MINIMO_MS);
ok('"Oi!" espera o mínimo', tempoDeDigitacao("Oi!") >= MINIMO_MS, String(tempoDeDigitacao("Oi!")));
ok(
  "texto curto de verdade (uma linha) ≥ 2s",
  tempoDeDigitacao("Claro, posso te explicar!") >= MINIMO_MS,
);

const TEXTAO = "a".repeat(5_000);
ok("texto muito longo ≤ 12s", tempoDeDigitacao(TEXTAO) <= MAXIMO_DIGITACAO_MS, String(tempoDeDigitacao(TEXTAO)));
ok("MAXIMO_DIGITACAO_MS é mesmo 12s", MAXIMO_DIGITACAO_MS === 12_000);

secao("o intervalo vale para qualquer entrada");
{
  let foraDoIntervalo = 0;
  for (let n = 0; n <= 600; n += 7) {
    const t = tempoDeDigitacao("x".repeat(n));
    if (t < MINIMO_MS || t > MAXIMO_DIGITACAO_MS) foraDoIntervalo++;
  }
  ok("nenhum tamanho escapa de [2s, 12s]", foraDoIntervalo === 0, `${foraDoIntervalo} fora`);
}

secao("um texto médio cresce com o tamanho (não é sempre o mínimo)");
{
  // 150 caracteres: 150 × 45ms = 6750ms, longe dos dois limites, então a
  // variação aparece sem ser engolida pelo clamp.
  const medio = "m".repeat(150);
  const amostras = Array.from({ length: 40 }, () => tempoDeDigitacao(medio));
  ok("fica acima do mínimo", Math.min(...amostras) > MINIMO_MS, String(Math.min(...amostras)));
  ok("fica abaixo do máximo", Math.max(...amostras) < MAXIMO_DIGITACAO_MS, String(Math.max(...amostras)));
}

secao("dois textos idênticos dão atrasos diferentes (tempo exato é robô)");
{
  const medio = "m".repeat(150);
  const distintos = new Set(Array.from({ length: 40 }, () => tempoDeDigitacao(medio)));
  ok("a variação existe", distintos.size > 1, `${distintos.size} valores distintos em 40`);
}

// ── Parte 2: o que realmente sai na requisição ─────────────────────────────

/**
 * Troca `fetch` e `AbortSignal.timeout` por espiões. Devolve o que foi
 * enviado: corpo já desserializado e o prazo pedido ao AbortSignal.
 */
async function espiar(
  f: () => Promise<boolean>,
): Promise<{ corpo: any; url: string; timeoutMs: number; resultado: boolean }> {
  const fetchAntes = globalThis.fetch;
  const timeoutAntes = AbortSignal.timeout;

  let corpo: any = null;
  let url = "";
  let timeoutMs = -1;

  AbortSignal.timeout = ((ms: number) => {
    timeoutMs = ms;
    return timeoutAntes.call(AbortSignal, ms);
  }) as typeof AbortSignal.timeout;

  globalThis.fetch = (async (u: any, init: any) => {
    url = String(u);
    corpo = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) } as any;
  }) as typeof fetch;

  try {
    const resultado = await f();
    return { corpo, url, timeoutMs, resultado };
  } finally {
    globalThis.fetch = fetchAntes;
    AbortSignal.timeout = timeoutAntes;
  }
}

process.env.EVOLUTION_API_URL = "https://evolution.exemplo";
process.env.EVOLUTION_API_KEY = "chave-de-teste";
process.env.EVOLUTION_INSTANCE = "julia";

secao("o texto vai com delay e presença de digitando");
{
  const texto = "Oi, Dr. Carlos! Deixa eu te perguntar uma coisa rápida sobre o WhatsApp da clínica.";
  const { corpo, url, timeoutMs, resultado } = await espiar(() =>
    sendWhatsAppMessage("5511999999999", texto),
  );
  ok("entregou", resultado === true);
  ok("bateu no sendText", url.includes("/message/sendText/julia"), url);
  ok("mandou o texto", corpo.text === texto);
  ok("mandou delay", typeof corpo.delay === "number", JSON.stringify(corpo.delay));
  ok('presence é "composing"', corpo.presence === "composing", corpo.presence);
  ok("delay dentro de [2s, 12s]", corpo.delay >= MINIMO_MS && corpo.delay <= MAXIMO_DIGITACAO_MS, String(corpo.delay));

  secao("o timeout cobre o atraso — senão a mensagem não sairia");
  ok("o timeout foi registrado", timeoutMs > 0, String(timeoutMs));
  ok(
    "timeout > delay (o atraso é bloqueante do nosso lado)",
    timeoutMs > corpo.delay,
    `timeout=${timeoutMs} delay=${corpo.delay}`,
  );
  ok(
    "sobra a folga inteira de 10s para rede e processamento",
    timeoutMs === corpo.delay + 10_000,
    `timeout=${timeoutMs} delay=${corpo.delay}`,
  );
  ok(
    "o timeout antigo (10s fixo) teria sido insuficiente para este caso extremo",
    MAXIMO_DIGITACAO_MS > 10_000,
  );
}

secao("o pior caso — textão no limite dos 12s — continua cabendo no timeout");
{
  const { corpo, timeoutMs } = await espiar(() =>
    sendWhatsAppMessage("5511999999999", "a".repeat(5_000)),
  );
  ok("o delay saturou em 12s", corpo.delay === MAXIMO_DIGITACAO_MS, String(corpo.delay));
  ok("e o timeout acompanhou (22s)", timeoutMs === 22_000, String(timeoutMs));
}

secao("áudio de demonstração NÃO leva atraso de digitação");
{
  const { corpo, url, timeoutMs, resultado } = await espiar(() =>
    sendWhatsAppAudio("5511999999999", "QUFB"),
  );
  ok("entregou", resultado === true);
  ok("bateu no sendWhatsAppAudio", url.includes("/message/sendWhatsAppAudio/julia"), url);
  ok("sem delay no corpo", corpo.delay === undefined, JSON.stringify(corpo.delay));
  ok("sem presence no corpo", corpo.presence === undefined, JSON.stringify(corpo.presence));
  ok("timeout continua sendo o padrão de 10s", timeoutMs === 10_000, String(timeoutMs));
}

secao("sem configuração da Evolution, nada é enviado (e não estoura)");
{
  const antes = process.env.EVOLUTION_API_URL;
  delete process.env.EVOLUTION_API_URL;
  const { resultado, timeoutMs } = await espiar(() => sendWhatsAppMessage("5511999999999", "oi"));
  ok("devolve false", resultado === false);
  ok("nem chegou a montar timeout (não houve fetch)", timeoutMs === -1, String(timeoutMs));
  process.env.EVOLUTION_API_URL = antes;
}

fim();
