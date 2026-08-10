/**
 * Rodada 25 — a URL da Evolution.
 *
 * Ressalva importante para quem ler isto depois: o ESPAÇO do nome atual
 * ("Vendedora CaptaClin") não estava quebrando nada. O parser de URL do Node
 * normaliza espaço para %20 sozinho, então o código antigo funcionava.
 *
 * O que justifica estes testes são os caracteres que o parser NÃO normaliza,
 * porque já têm significado na URL: "#" trunca o resto, "?" vira query string
 * e "/" vira outro segmento de caminho. O nome da instância é configuração —
 * pode mudar sem ninguém revisar o código — e um desses caracteres mandaria a
 * requisição para o lugar errado em silêncio.
 *
 * Este arquivo NÃO usa o stub de integrações: ele importa o módulo de verdade,
 * porque é justamente a montagem da URL que está sob teste.
 */
import { ok, secao, fim } from "./assert";
// O "?real" pula o stub de integrações — ver test/run.mjs.
import { urlDaEvolution } from "../src/lib/integrations?real";

const BASE = "https://n8n-evolution-api.mq6ww5.easypanel.host";

function comAmbiente(url: string, instancia: string, f: () => void) {
  const antesUrl = process.env.EVOLUTION_API_URL;
  const antesInst = process.env.EVOLUTION_INSTANCE;
  process.env.EVOLUTION_API_URL = url;
  process.env.EVOLUTION_INSTANCE = instancia;
  try {
    f();
  } finally {
    if (antesUrl === undefined) delete process.env.EVOLUTION_API_URL;
    else process.env.EVOLUTION_API_URL = antesUrl;
    if (antesInst === undefined) delete process.env.EVOLUTION_INSTANCE;
    else process.env.EVOLUTION_INSTANCE = antesInst;
  }
}

secao("nome de instância com espaço é codificado");
comAmbiente(BASE, "Vendedora CaptaClin", () => {
  const u = urlDaEvolution("message/sendText");
  ok("espaço vira %20", u === `${BASE}/message/sendText/Vendedora%20CaptaClin`, u);
  ok("não sobra espaço cru na URL", !u.includes(" "), u);
});

secao("as três chamadas usam o mesmo caminho codificado");
comAmbiente(BASE, "Vendedora CaptaClin", () => {
  for (const caminho of [
    "message/sendText",
    "message/sendWhatsAppAudio",
    "chat/getBase64FromMediaMessage",
  ]) {
    const u = urlDaEvolution(caminho);
    ok(`${caminho} codifica a instância`, u.endsWith("/Vendedora%20CaptaClin"), u);
    ok(`${caminho} sem espaço cru`, !u.includes(" "), u);
    ok(`${caminho} monta o caminho certo`, u === `${BASE}/${caminho}/Vendedora%20CaptaClin`, u);
  }
});

secao("outros caracteres que quebrariam a URL");
for (const [instancia, esperado] of [
  ["Vendedora CaptaClin", "Vendedora%20CaptaClin"],
  ["júlia", "j%C3%BAlia"],
  ["a/b", "a%2Fb"], // barra viraria outro segmento de caminho
  ["a?b", "a%3Fb"], // "?" viraria query string
  ["a#b", "a%23b"], // "#" truncaria a URL inteira
  ["a&b", "a%26b"],
  ["a+b", "a%2Bb"],
] as const) {
  comAmbiente(BASE, instancia, () => {
    const u = urlDaEvolution("message/sendText");
    ok(`"${instancia}" → ${esperado}`, u === `${BASE}/message/sendText/${esperado}`, u);
  });
}

secao("barra sobrando no fim da URL base");
for (const base of [BASE, `${BASE}/`, `${BASE}//`]) {
  comAmbiente(base, "Vendedora CaptaClin", () => {
    const u = urlDaEvolution("message/sendText");
    ok(
      `"${base.slice(-3)}" não gera barra dupla`,
      u === `${BASE}/message/sendText/Vendedora%20CaptaClin`,
      u,
    );
  });
}

secao("instância simples continua igual");
comAmbiente(BASE, "julia", () => {
  ok(
    "sem caractere especial, nada muda",
    urlDaEvolution("message/sendText") === `${BASE}/message/sendText/julia`,
  );
});

secao("a configuração é lida a cada chamada");
comAmbiente(BASE, "primeira", () => {
  ok("lê 'primeira'", urlDaEvolution("x").endsWith("/primeira"));
});
comAmbiente(BASE, "segunda", () => {
  ok("depois lê 'segunda'", urlDaEvolution("x").endsWith("/segunda"));
});

fim();
