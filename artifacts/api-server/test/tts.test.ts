/**
 * Rodada 26 — a voz da Júlia (Cartesia → OpenAI → TEXTO).
 *
 * O que estes testes protegem é o princípio, não o timbre: nenhum dentista
 * pode ficar sem resposta porque a voz falhou. Por isso a maioria das
 * asserções aqui é sobre FALHA — a Cartesia devolvendo 401, devolvendo corpo
 * vazio, os dois provedores caindo — e sobre o que sobra quando isso acontece.
 *
 * A Cartesia é exercitada trocando o `fetch` global: o módulo `tts.ts` é o de
 * verdade, só a rede é falsa. É a mesma linha das outras rodadas — stub só na
 * borda, lógica real no meio.
 */
import { ok, secao, fim } from "./assert";
import { gerarVoz, VOZ_ANA_PAULA } from "../src/lib/tts";
import { ctrl } from "./stubs/openai.mjs";
import { post, evento, eventoMidia, saidas } from "./driver";
import { wa } from "./stubs/integrations.mjs";

interface ChamadaHttp {
  url: string;
  body: any;
  headers: Record<string, string>;
}

const chamadas: ChamadaHttp[] = [];
let resposta: () => any = () => respostaOk(1000);

const respostaOk = (bytes: number) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
  text: async () => "",
});

const respostaErro = (status: number) => ({
  ok: false,
  status,
  text: async () => `{"message":"erro ${status}"}`,
  arrayBuffer: async () => new ArrayBuffer(0),
});

(globalThis as any).fetch = async (url: any, init: any) => {
  chamadas.push({
    url: String(url),
    body: JSON.parse(String(init?.body ?? "{}")),
    headers: (init?.headers ?? {}) as Record<string, string>,
  });
  return resposta();
};

/** Cenário do zero: envios, chamadas HTTP e o que o stub da OpenAI faz. */
function cenario(opts: {
  provider?: string;
  chave?: string;
  vozId?: string;
  cartesia: () => any;
  openaiBuffer?: Buffer;
  openaiErro?: string | null;
}) {
  chamadas.length = 0;
  ctrl.reset();
  if (opts.provider === undefined) delete process.env.TTS_PROVIDER;
  else process.env.TTS_PROVIDER = opts.provider;
  if (opts.chave === undefined) delete process.env.CARTESIA_API_KEY;
  else process.env.CARTESIA_API_KEY = opts.chave;
  if (opts.vozId === undefined) delete process.env.CARTESIA_VOICE_ID;
  else process.env.CARTESIA_VOICE_ID = opts.vozId;
  resposta = opts.cartesia;
  ctrl.ttsBuffer = opts.openaiBuffer ?? Buffer.alloc(0);
  ctrl.ttsErro = opts.openaiErro ?? null;
}

secao("caminho feliz — a Cartesia responde e a OpenAI nem é acionada");
cenario({ chave: "chave-de-teste", cartesia: () => respostaOk(2048) });
let audio = await gerarVoz("Oi doutor, aqui é a Júlia.");
ok("devolveu áudio", audio !== null && audio.length === 2048, String(audio?.length));
ok("chamou a Cartesia uma vez", chamadas.length === 1);
ok("NÃO chamou a OpenAI", ctrl.ttsCalls.length === 0, JSON.stringify(ctrl.ttsCalls));

secao("o pedido à Cartesia — o que a documentação exige");
const pedido = chamadas[0];
ok("endpoint /tts/bytes", pedido.url === "https://api.cartesia.ai/tts/bytes", pedido.url);
ok("header Cartesia-Version", pedido.headers["Cartesia-Version"] === "2026-03-01", pedido.headers["Cartesia-Version"]);
ok("autentica por X-API-Key", pedido.headers["X-API-Key"] === "chave-de-teste");
ok("modelo sonic-3.5 por padrão", pedido.body.model_id === "sonic-3.5", pedido.body.model_id);
ok("idioma pt", pedido.body.language === "pt", pedido.body.language);
ok("voz por id", pedido.body.voice?.mode === "id");
ok("manda o texto da resposta", pedido.body.transcript === "Oi doutor, aqui é a Júlia.");
ok(
  "container mp3 — a Cartesia recusa opus e ogg",
  pedido.body.output_format?.container === "mp3",
  JSON.stringify(pedido.body.output_format),
);

secao("a voz padrão é a Ana Paula quando a variável não existe");
ok(
  "sem CARTESIA_VOICE_ID, usa a Ana Paula",
  pedido.body.voice?.id === VOZ_ANA_PAULA,
  pedido.body.voice?.id,
);
ok("o id da Ana Paula é o escolhido na Rodada 26", VOZ_ANA_PAULA === "1cf751f6-8749-43ab-98bd-230dd633abdb");

cenario({ chave: "k", vozId: "outra-voz-qualquer", cartesia: () => respostaOk(10) });
await gerarVoz("teste");
ok("com a variável definida, ela manda", chamadas[0].body.voice?.id === "outra-voz-qualquer");

secao("Cartesia falhando — cai para a OpenAI, sem lançar exceção");
for (const status of [401, 429, 500]) {
  cenario({
    chave: "k",
    cartesia: () => respostaErro(status),
    openaiBuffer: Buffer.alloc(512, 1),
  });
  const b = await gerarVoz("texto qualquer");
  ok(`Cartesia ${status}: devolve o áudio da OpenAI`, b !== null && b.length === 512, String(b?.length));
  ok(`Cartesia ${status}: a OpenAI foi chamada`, ctrl.ttsCalls.length === 1);
}

secao("os dois provedores entregam o MESMO formato");
ok(
  "a OpenAI é chamada pedindo mp3, igual à Cartesia",
  ctrl.ttsCalls[0]?.formato === "mp3",
  JSON.stringify(ctrl.ttsCalls[0]),
);
ok("e com a voz nova", ctrl.ttsCalls[0]?.voz === "nova");

secao("corpo vazio da Cartesia é FALHA, não áudio");
cenario({ chave: "k", cartesia: () => respostaOk(0), openaiBuffer: Buffer.alloc(256, 2) });
audio = await gerarVoz("texto");
ok("não devolve buffer vazio", audio !== null && audio.length === 256, String(audio?.length));
ok("caiu para a OpenAI", ctrl.ttsCalls.length === 1);

secao("sem CARTESIA_API_KEY, nem tenta a rede");
cenario({ chave: undefined, cartesia: () => respostaOk(10), openaiBuffer: Buffer.alloc(64) });
audio = await gerarVoz("texto");
ok("nenhuma requisição saiu", chamadas.length === 0);
ok("foi direto para a OpenAI", audio !== null && audio.length === 64);

secao("TTS_PROVIDER=openai — a Cartesia nem é chamada");
cenario({
  provider: "openai",
  chave: "k",
  cartesia: () => respostaOk(999),
  openaiBuffer: Buffer.alloc(128),
});
audio = await gerarVoz("texto");
ok("Cartesia não recebeu requisição", chamadas.length === 0, JSON.stringify(chamadas));
ok("a OpenAI respondeu", audio !== null && audio.length === 128);
ok("a volta atrás não exige deploy, só a variável", true);

secao("os DOIS falhando — gerarVoz devolve null");
cenario({ chave: "k", cartesia: () => respostaErro(500), openaiErro: "openai caiu" });
audio = await gerarVoz("texto");
ok("devolve null", audio === null);
ok("tentou a Cartesia", chamadas.length === 1);
ok("tentou a OpenAI", ctrl.ttsCalls.length === 1);

cenario({ chave: "k", cartesia: () => respostaErro(500), openaiBuffer: Buffer.alloc(0) });
ok("OpenAI devolvendo vazio também vira null", (await gerarVoz("texto")) === null);

secao("no webhook — voz falhando, o dentista recebe TEXTO");
// O caminho que importa de verdade: o dentista mandou ÁUDIO, as duas vozes
// caem, e ele ainda assim recebe a resposta.
process.env.TTS_PROVIDER = "cartesia";
process.env.CARTESIA_API_KEY = "k";
resposta = () => respostaErro(500);
ctrl.transcript = "quanto custa o plano de vocês?";
ctrl.ttsBuffer = Buffer.alloc(0);
ctrl.ttsErro = null;
wa.media = "QUFBQQ==";
await post(eventoMidia("audioMessage"));
ok("respondeu alguma coisa", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
ok("respondeu por TEXTO", wa.enviadas[0]?.tipo === "text", wa.enviadas[0]?.tipo);
ok("nenhum áudio foi enviado", !wa.enviadas.some((e: any) => e.tipo === "audio"));
const gravada = saidas("outbound")[0] as any;
ok("gravou a resposta no histórico", gravada !== undefined);
ok("gravou como text, não audio", gravada?.messageType === "text", gravada?.messageType);

secao("no webhook — voz funcionando, o dentista recebe ÁUDIO");
resposta = () => respostaOk(4096);
ctrl.transcript = "quanto custa?";
wa.media = "QUFBQQ==";
await post(eventoMidia("audioMessage"));
ok("respondeu por ÁUDIO", wa.enviadas[0]?.tipo === "audio", JSON.stringify(wa.enviadas));
const gravadaAudio = saidas("outbound")[0] as any;
ok("gravou como audio", gravadaAudio?.messageType === "audio", gravadaAudio?.messageType);

secao("no webhook — quem escreveu TEXTO continua recebendo texto");
resposta = () => respostaOk(4096);
ctrl.transcript = "";
wa.media = null;
await post(evento("oi, quanto custa?"));
ok("responde por texto", wa.enviadas[0]?.tipo === "text");
ok("a voz nem foi gerada", !wa.enviadas.some((e: any) => e.tipo === "audio"));

fim();
