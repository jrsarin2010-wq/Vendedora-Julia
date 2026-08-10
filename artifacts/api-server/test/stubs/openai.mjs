/**
 * Stub do @workspace/integrations-openai-ai-server. Nenhuma chamada de rede,
 * nenhum token gasto: o teste controla o que o "modelo" responde.
 */
export const ctrl = {
  /** O que o modelo de resposta devolve. String vazia = resposta vazia. */
  reply: "Oi! Como posso te ajudar?",
  /** O que o speechToText devolve. String vazia = transcrição falhou. */
  transcript: "",
  /** JSON que o extrator devolve. */
  extraction:
    '{"painPoints":null,"mainObjection":null,"name":null,"planInterest":null,"funnelStage":null,"isCustomer":false,"wantsToStop":false}',
  /** Buffer devolvido pelo textToSpeech. Vazio = TTS não produziu áudio. */
  ttsBuffer: Buffer.alloc(0),
  /** Se preenchido, o textToSpeech LANÇA com esta mensagem (a OpenAI caiu). */
  ttsErro: null,
  /** Chamadas ao textToSpeech: [{ texto, voz, formato }]. */
  ttsCalls: [],
  /** Modelos chamados, na ordem. */
  calls: [],
  reset() {
    this.calls = [];
    this.ttsCalls = [];
  },
};

export const openai = {
  chat: {
    completions: {
      create: async (params) => {
        ctrl.calls.push(params.model);
        // O extrator roda no modelo "nano"; a resposta de venda no "mini".
        const ehExtrator = String(params.model).includes("nano");
        return { choices: [{ message: { content: ehExtrator ? ctrl.extraction : ctrl.reply } }] };
      },
    },
  },
};

export async function speechToText() {
  return ctrl.transcript;
}
export async function textToSpeech(texto, voz, formato) {
  ctrl.ttsCalls.push({ texto, voz, formato });
  if (ctrl.ttsErro) throw new Error(ctrl.ttsErro);
  return ctrl.ttsBuffer;
}
export function detectAudioFormat() {
  return "ogg";
}
