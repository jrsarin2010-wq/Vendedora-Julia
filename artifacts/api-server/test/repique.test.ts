/**
 * Rodada 43 — repique quando a OpenAI recusa.
 *
 * O caso real (12/08/2026, 12:23–12:25): uma rajada estourou o limite de tokens
 * por minuto da conta e a OpenAI devolveu 429 quinze vezes. Cada uma virou uma
 * linha de log e nada mais — quinze dentistas escreveram e receberam silêncio.
 *
 * O que estes testes travam: erro passageiro é repicado, erro de configuração
 * NÃO é (senão o dentista espera 19s pelo mesmo silêncio), e o que sobra vira
 * caso de gente na central de vigia — nunca log solto.
 */
import { ok, secao, fim } from "./assert";
import { chamar, evento, logs } from "./driver";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";
import {
  comRepique,
  ehRecusaTemporaria,
  descreverErro,
  esperasDeRepique,
  ESPERAS_PADRAO_MS,
} from "../src/lib/repique";
import { AVISO_DE_ESPERA } from "../src/julia-persona";
import { pareceMensagemComPromessa } from "../src/lib/atencao";

// Nos testes as esperas são zero: o que se verifica é a DECISÃO de repicar e
// quantas tentativas acontecem, não a passagem do tempo. Esperar 19 segundos de
// verdade só tornaria a suíte lenta.
process.env.REPIQUE_ESPERAS_MS = "0,0,0";

const erroCom = (status: number, msg = "falhou") => {
  const e: Error & { status?: number } = new Error(msg);
  e.status = status;
  return e;
};

// ── O que merece repique ────────────────────────────────────────────────────

secao("ehRecusaTemporaria — passageiro sim, configuração não");
ok("429 (limite de tokens) → repica", ehRecusaTemporaria(erroCom(429)));
ok("408 (estourou o tempo) → repica", ehRecusaTemporaria(erroCom(408)));
ok("500 → repica", ehRecusaTemporaria(erroCom(500)));
ok("502 → repica", ehRecusaTemporaria(erroCom(502)));
ok("503 → repica", ehRecusaTemporaria(erroCom(503)));
ok("599 → repica", ehRecusaTemporaria(erroCom(599)));
ok(
  "queda de conexão (ECONNRESET) → repica",
  ehRecusaTemporaria(Object.assign(new Error("socket"), { code: "ECONNRESET" })),
);
ok(
  "APIConnectionTimeoutError do SDK → repica",
  ehRecusaTemporaria(Object.assign(new Error("timeout"), { name: "APIConnectionTimeoutError" })),
);

ok("401 (chave errada) → NÃO repica", !ehRecusaTemporaria(erroCom(401)));
ok("400 (payload inválido) → NÃO repica", !ehRecusaTemporaria(erroCom(400)));
ok("404 → NÃO repica", !ehRecusaTemporaria(erroCom(404)));
ok("erro sem forma nenhuma → NÃO repica", !ehRecusaTemporaria("qualquer coisa"));
ok("null → NÃO repica", !ehRecusaTemporaria(null));

secao("descreverErro — o detalhe que vai para a central de vigia");
{
  const d = descreverErro(erroCom(429, "Rate limit reached on tokens per min (TPM)"));
  ok("traz o status", d.includes("HTTP 429"), d);
  ok("traz a mensagem", d.includes("tokens per min"), d);
}

// ── As esperas ──────────────────────────────────────────────────────────────

secao("as esperas: três repiques, crescentes");
ok(
  "o padrão é 2s, 5s e 12s",
  JSON.stringify(ESPERAS_PADRAO_MS) === JSON.stringify([2000, 5000, 12000]),
  JSON.stringify(ESPERAS_PADRAO_MS),
);
ok(
  "são crescentes (repique de intervalo fixo só repete a mesma recusa)",
  ESPERAS_PADRAO_MS.every((v, i) => i === 0 || v > ESPERAS_PADRAO_MS[i - 1]),
);
{
  const salvo = process.env.REPIQUE_ESPERAS_MS;
  process.env.REPIQUE_ESPERAS_MS = "100,200";
  ok(
    "o ambiente manda (dá para calibrar sem redeploy)",
    JSON.stringify(esperasDeRepique()) === JSON.stringify([100, 200]),
  );
  for (const invalido of ["lixo,,,", "2000,,5000", "abc", "2000,-1", "  ,  "]) {
    process.env.REPIQUE_ESPERAS_MS = invalido;
    ok(
      `configuração inválida (${JSON.stringify(invalido)}) cai no padrão inteiro`,
      JSON.stringify(esperasDeRepique()) === JSON.stringify(ESPERAS_PADRAO_MS),
      JSON.stringify(esperasDeRepique()),
    );
  }
  // O caso que motivou a trava: `Number("")` é 0, então "2000,,5000" viraria
  // uma espera de ZERO no meio — repique sem espera martela a OpenAI
  // justamente quando ela já está recusando.
  delete process.env.REPIQUE_ESPERAS_MS;
  ok(
    "sem configuração, o padrão",
    JSON.stringify(esperasDeRepique()) === JSON.stringify(ESPERAS_PADRAO_MS),
  );
  process.env.REPIQUE_ESPERAS_MS = salvo;
}

// ── comRepique ──────────────────────────────────────────────────────────────

secao("comRepique — quantas tentativas, e quando para");
{
  let chamadas = 0;
  const r = await comRepique(
    async () => {
      chamadas++;
      if (chamadas < 3) throw erroCom(429);
      return "respondeu";
    },
    { esperas: [0, 0, 0] },
  );
  ok("devolve o resultado da tentativa que deu certo", r === "respondeu", String(r));
  ok("parou assim que funcionou (3 chamadas)", chamadas === 3, String(chamadas));
}
{
  let chamadas = 0;
  let lancou: unknown = null;
  try {
    await comRepique(
      async () => {
        chamadas++;
        throw erroCom(429, "sempre 429");
      },
      { esperas: [0, 0, 0] },
    );
  } catch (e) {
    lancou = e;
  }
  ok("com 3 esperas, tenta 4 vezes ao todo", chamadas === 4, String(chamadas));
  ok("e LANÇA o último erro (quem chama decide o desfecho)", lancou !== null);
  ok(
    "o erro que sai é o da OpenAI, não um genérico",
    descreverErro(lancou).includes("sempre 429"),
    descreverErro(lancou),
  );
}
{
  let chamadas = 0;
  try {
    await comRepique(
      async () => {
        chamadas++;
        throw erroCom(401, "chave inválida");
      },
      { esperas: [0, 0, 0] },
    );
  } catch {
    /* esperado */
  }
  ok(
    "erro de configuração falha na PRIMEIRA — não faz o dentista esperar à toa",
    chamadas === 1,
    String(chamadas),
  );
}

secao("comRepique — o aviso antes da última tentativa");
{
  const quando: number[] = [];
  let chamadas = 0;
  await comRepique(
    async () => {
      chamadas++;
      if (chamadas < 4) throw erroCom(429);
      return "ok";
    },
    { esperas: [0, 0, 0], antesDaUltima: async () => quando.push(chamadas) },
  );
  ok("o aviso saiu UMA vez só", quando.length === 1, JSON.stringify(quando));
  ok(
    "e saiu depois da 3ª falha, antes da 4ª tentativa",
    quando[0] === 3,
    JSON.stringify(quando),
  );
}
{
  let chamadas = 0;
  let avisou = false;
  const r = await comRepique(
    async () => {
      chamadas++;
      if (chamadas < 2) throw erroCom(429);
      return "ok";
    },
    { esperas: [0, 0, 0], antesDaUltima: async () => void (avisou = true) },
  );
  ok("recuperou cedo: nenhum aviso é enviado", !avisou && r === "ok");
}
{
  // Um aviso que falha (WhatsApp fora do ar) não pode matar a tentativa que
  // ainda pode dar certo — o aviso é bônus, a resposta é o que importa.
  let chamadas = 0;
  const r = await comRepique(
    async () => {
      chamadas++;
      if (chamadas < 4) throw erroCom(429);
      return "ok";
    },
    {
      esperas: [0, 0, 0],
      antesDaUltima: async () => {
        throw new Error("WhatsApp fora do ar");
      },
    },
  );
  ok("aviso que lança não derruba o repique", r === "ok" && chamadas === 4);
}

// ── O texto do aviso ────────────────────────────────────────────────────────

secao("o aviso de espera — sinal de vida, não resposta");
ok(
  "com nome masculino, trata por Dr.",
  AVISO_DE_ESPERA("Fernando") === "Dr. Fernando, só um instante — já te respondo.",
  AVISO_DE_ESPERA("Fernando"),
);
ok(
  "com nome feminino, por Dra.",
  AVISO_DE_ESPERA("Marina").startsWith("Dra. Marina, "),
  AVISO_DE_ESPERA("Marina"),
);
ok(
  "nome ambíguo não vira chute de gênero",
  AVISO_DE_ESPERA("Alex").startsWith("Alex, "),
  AVISO_DE_ESPERA("Alex"),
);
ok(
  "sem nome, a frase começa maiúscula e sem vocativo",
  AVISO_DE_ESPERA(null) === "Só um instante — já te respondo.",
  AVISO_DE_ESPERA(null),
);
ok(
  'NUNCA escreve "Dr(a)." — o prompt proíbe em qualquer lugar',
  !["Fernando", "Marina", "Alex", null].some((n) => AVISO_DE_ESPERA(n).includes("Dr(a)")),
);
ok(
  "sem emoji, como todo texto fixo (Rodada 38)",
  !/\p{Extended_Pictographic}/u.test(AVISO_DE_ESPERA("Fernando")),
);
ok(
  // Se a última tentativa também falhar, este aviso vira a última mensagem da
  // conversa. Sem estar na lista de promessas, o toque 1 do follow-up cairia em
  // cima dele dizendo "a conversa ficou pela metade" — o bug da Rodada 36.
  "o aviso é reconhecido como PROMESSA pendente (Rodada 36)",
  Boolean(pareceMensagemComPromessa(AVISO_DE_ESPERA("Fernando"))),
  AVISO_DE_ESPERA("Fernando"),
);

// ── O webhook de ponta a ponta ──────────────────────────────────────────────

const NUMERO = "5585999998888";

/** Cenário do zero, com N recusas simuladas à frente. */
async function conversaCom(falhas: number, status = 429): Promise<void> {
  state.reset();
  wa.reset();
  ctrl.reset();
  logs.length = 0;
  ctrl.reply = "Oi! Eu sou a Júlia, do CaptaClin. Antes de tudo, como posso te chamar?";
  ctrl.falhasRestantes = falhas;
  ctrl.falhaStatus = status;
  await chamar(evento("oi, vim pelo site", NUMERO));
}

const textos = () => wa.enviadas.map((e: any) => e.message);
const lead = () => state.leads[0] as any;

secao("webhook — a IA recusa duas vezes e depois responde");
{
  await conversaCom(2);
  ok("o dentista recebe a resposta", textos().length === 1, JSON.stringify(textos()));
  ok("e é a resposta de verdade", textos()[0].includes("Júlia"), textos()[0]);
  ok("nenhum aviso de espera (recuperou cedo)", !textos()[0].includes("já te respondo"));
  ok("o lead NÃO vai para a central de vigia", !lead().atencao, String(lead().atencao));
  ok(
    "e o repique ficou registrado no log",
    logs.some((l) => l.msg.includes("repicando")),
    JSON.stringify(logs.map((l) => l.msg)),
  );
}

secao("webhook — recusa até a última, e aí sim responde (com aviso no meio)");
{
  await conversaCom(3);
  ok("saíram duas mensagens: o aviso e a resposta", textos().length === 2, JSON.stringify(textos()));
  ok("a primeira é o aviso de vida", textos()[0].includes("já te respondo"), textos()[0]);
  ok("a segunda é a resposta de verdade", textos()[1].includes("Júlia"), textos()[1]);
  ok(
    "as duas entraram no histórico",
    state.messages.filter((m: any) => m.direction === "outbound").length === 2,
    JSON.stringify(state.messages.map((m: any) => m.direction)),
  );
  ok("o lead não vai para a vigia — ele foi atendido", !lead().atencao);
}

secao("webhook — a IA recusa em TODAS: vira caso de gente, não log solto");
{
  await conversaCom(99);
  ok(
    "o dentista recebeu ao menos o aviso de vida",
    textos().length === 1 && textos()[0].includes("já te respondo"),
    JSON.stringify(textos()),
  );
  ok(
    "o lead foi para a central de vigia",
    lead().atencao === "julia_estranha",
    String(lead().atencao),
  );
  ok(
    "com o detalhe técnico do erro (senão o dono não entende por que está lá)",
    String(lead().atencaoDetalhe).includes("429") ||
      String(lead().atencaoDetalhe).includes("Rate limit"),
    String(lead().atencaoDetalhe),
  );
  ok(
    "o detalhe diz quantas tentativas houve",
    String(lead().atencaoDetalhe).includes("4 tentativas"),
    String(lead().atencaoDetalhe),
  );
  ok(
    "a mensagem do dentista continua gravada (ela volta com contexto)",
    state.messages.some((m: any) => m.direction === "inbound"),
  );
  ok(
    "nenhuma leva de follow-up é armada — é caso de gente, não de robô",
    state.followUps.length === 0,
    JSON.stringify(state.followUps),
  );
  ok(
    "e a falha aparece no log com o motivo",
    logs.some((l) => l.msg.includes("todas as tentativas")),
    JSON.stringify(logs.map((l) => l.msg)),
  );
}

secao("webhook — erro de configuração (401) não faz ninguém esperar");
{
  await conversaCom(99, 401);
  const chamadasDeChat = ctrl.calls.length;
  ok("uma tentativa só, sem repique", chamadasDeChat === 1, String(chamadasDeChat));
  ok("sem aviso de espera (não houve última tentativa a anunciar)", textos().length === 0, JSON.stringify(textos()));
  ok("mesmo assim o lead vai para a vigia", lead().atencao === "julia_estranha");
  ok(
    "com o 401 no detalhe, que é o que aponta para a chave",
    String(lead().atencaoDetalhe).includes("401"),
    String(lead().atencaoDetalhe),
  );
}

secao("webhook — a IA cai (500) e volta");
{
  await conversaCom(1, 500);
  ok("repicou e respondeu", textos().length === 1 && textos()[0].includes("Júlia"));
  ok("sem marcação de vigia", !lead().atencao);
}

fim();
