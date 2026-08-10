/**
 * A VOZ DA JÚLIA
 *
 * Provedor configurável. Padrão: Cartesia, voz Ana Paula (brasileira, "warm,
 * friendly female for natural, informal dialogue"). Se a Cartesia falhar, cai
 * para a OpenAI. Se as duas falharem, `gerarVoz` devolve null e quem chama
 * manda TEXTO — o dentista nunca fica sem resposta.
 *
 *   Cartesia → (falhou) → OpenAI TTS → (falhou) → null, e o webhook usa texto
 *
 * A voz é enfeite; a resposta é o produto.
 *
 * Variáveis de ambiente:
 *   TTS_PROVIDER      "cartesia" (padrão) | "openai"
 *   CARTESIA_API_KEY  chave da Cartesia
 *   CARTESIA_VOICE_ID padrão: Ana Paula
 *   CARTESIA_MODEL_ID padrão: sonic-3.5
 *
 * Para voltar à OpenAI basta TTS_PROVIDER=openai no Railway. Sem deploy.
 */
import { textToSpeech as openaiTextToSpeech } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

/** Ana Paula - Marketer, escolhida na Rodada 26. */
export const VOZ_ANA_PAULA = "1cf751f6-8749-43ab-98bd-230dd633abdb";

/**
 * Versão da API confirmada na documentação em 10/08/2026. A Cartesia exige o
 * header e trata a versão como contrato: mudar aqui pode mudar o formato do
 * corpo aceito.
 */
const CARTESIA_VERSION = "2026-03-01";

/**
 * MP3 nos DOIS provedores, de propósito.
 *
 * A produção vinha pedindo "opus" à OpenAI, mas a Cartesia recusa opus e ogg
 * ("unsupported format") — ela só entrega wav, mp3 e raw. Como o áudio segue
 * para o mesmo `sendWhatsAppAudio`, os dois lados precisam devolver o mesmo
 * container: senão o envio passaria a depender de QUAL provedor respondeu, que
 * é exatamente o tipo de diferença que só aparece no dia em que o primeiro
 * falha. O Evolution converte o que recebe para nota de voz de qualquer forma.
 */
const FORMATO = "mp3" as const;

const TTS_TIMEOUT_MS = 30_000;

/**
 * Lida a CADA chamada, não uma vez no carregamento do módulo. Mesma decisão da
 * Rodada 25 na Evolution: o valor efetivo é sempre o que está no ambiente
 * agora, e o teste consegue trocar de provedor sem recarregar nada.
 */
function configTts() {
  return {
    provedor: (process.env.TTS_PROVIDER ?? "cartesia").toLowerCase().trim(),
    chave: process.env.CARTESIA_API_KEY ?? "",
    voz: process.env.CARTESIA_VOICE_ID ?? VOZ_ANA_PAULA,
    modelo: process.env.CARTESIA_MODEL_ID ?? "sonic-3.5",
  };
}

/**
 * Cartesia pura, sem rede de segurança. Exportada para o `gerar-demos.mjs`:
 * ali a queda para a OpenAI seria um desastre silencioso — gravaria os áudios
 * definitivos com OUTRA voz, e ninguém perceberia até um dentista ouvir. Na
 * geração das demos, falhar alto é o comportamento certo.
 */
export async function gerarVozCartesia(texto: string): Promise<Buffer> {
  return cartesiaTextToSpeech(texto);
}

async function cartesiaTextToSpeech(texto: string): Promise<Buffer> {
  const { chave, voz, modelo } = configTts();
  if (!chave) throw new Error("CARTESIA_API_KEY não configurada");

  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": chave,
      "Cartesia-Version": CARTESIA_VERSION,
    },
    body: JSON.stringify({
      model_id: modelo,
      transcript: texto,
      voice: { mode: "id", id: voz },
      // "pt" é o código da documentação. O sotaque brasileiro vem da VOZ
      // (Ana Paula é country=BR), não deste campo.
      language: "pt",
      output_format: {
        container: FORMATO,
        sample_rate: 44100,
        bit_rate: 128000,
      },
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });

  if (!response.ok) {
    const corpo = await response.text();
    throw new Error(`Cartesia ${response.status}: ${corpo.slice(0, 200)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error("Cartesia devolveu áudio vazio");
  return buffer;
}

/**
 * Gera a voz da Júlia. Devolve null se nenhum provedor funcionar — quem chama
 * DEVE cair para texto nesse caso, nunca deixar o dentista sem resposta.
 */
export async function gerarVoz(texto: string): Promise<Buffer | null> {
  const { provedor } = configTts();

  if (provedor === "cartesia") {
    try {
      return await cartesiaTextToSpeech(texto);
    } catch (err) {
      logger.warn({ err }, "Cartesia falhou — tentando a OpenAI");
    }
  }

  try {
    const buffer = await openaiTextToSpeech(texto, "nova", FORMATO);
    if (buffer.length > 0) return buffer;
    logger.warn("OpenAI TTS devolveu áudio vazio — a resposta vai por texto");
  } catch (err) {
    logger.warn({ err }, "OpenAI TTS falhou — a resposta vai por texto");
  }

  return null;
}
