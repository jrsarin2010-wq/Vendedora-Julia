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
  /**
   * Quantas das PRÓXIMAS chamadas de chat devem falhar (Rodada 43). Cada
   * chamada consome uma. Zero = tudo normal.
   */
  falhasRestantes: 0,
  /** O status HTTP da falha simulada: 429 (limite), 500 (a OpenAI caiu), 401… */
  falhaStatus: 429,
  /** Mensagem do erro simulado. */
  falhaMensagem: "429 Rate limit reached for gpt-5.4-mini on tokens per min (TPM)",
  reset() {
    this.calls = [];
    this.ttsCalls = [];
    this.falhasRestantes = 0;
    this.falhaStatus = 429;
  },
};

export const openai = {
  chat: {
    completions: {
      create: async (params) => {
        ctrl.calls.push(params.model);
        // Falha simulada: o erro imita o do SDK da OpenAI, que traz `status`.
        // É por ele que `ehRecusaTemporaria` decide repicar ou desistir.
        if (ctrl.falhasRestantes > 0) {
          ctrl.falhasRestantes--;
          const erro = new Error(ctrl.falhaMensagem);
          erro.status = ctrl.falhaStatus;
          throw erro;
        }
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
