/**
 * Stub do src/lib/integrations: nada sai para o WhatsApp nem para o Telegram.
 * O teste configura se a entrega "funciona" e depois inspeciona o que teria
 * sido enviado.
 */
export const wa = {
  /** sendWhatsAppMessage entregou? */
  entrega: true,
  /**
   * Quando a entrega falha (entrega=false), a falha é PERMANENTE (a Evolution
   * rejeitou o número, HTTP 400) ou transitória (fora do ar)? Só faz efeito
   * com entrega=false — ver enviarWhatsAppComDiagnostico.
   */
  falhaPermanente: false,
  /** sendWhatsAppAudio entregou? */
  entregaAudio: true,
  /** base64 devolvido por fetchWhatsAppMediaBase64 (null = não conseguiu). */
  media: null,
  /**
   * Tudo que foi enviado: [{ tipo, phone, message, primeiraResposta }].
   * `primeiraResposta` é o sinalizador da Rodada 35 — é o que decide se o teto
   * de "digitando..." é 3s ou 12s, e só quem chama sabe disso.
   */
  enviadas: [],
  /** Alertas de handoff disparados. */
  alertas: [],
  /** Avisos de "humano assumiu a conversa" disparados. */
  pausas: [],
  /** Alertas da central de vigia (Rodada 33). */
  atencoes: [],
  /** Alertas da sonda de modelo (boot). */
  sondas: [],
  /** Alertas de número não entregável (Rodada 51). */
  naoEntregaveis: [],
  /** Alertas da varredura Apify (Etapa 2): orçamento, falhou, fila vazia. */
  varreduras: [],
  /** Alertas da verificação de WhatsApp (Etapa 3A): só a pausa por lotes mudos. */
  verificacoes: [],
  /**
   * Consulta de existência no WhatsApp (Etapa 1.5).
   *
   * `responder` é o comportamento: recebe o bloco enviado e devolve
   * `{ ok, itens }`, igual à borda de verdade. Com `null` (o padrão), todo
   * número "existe" e o jid é o próprio número — assim os testes que não têm
   * nada a ver com canonicalização seguem valendo sem mudar uma linha.
   *
   * `blocos` guarda cada lote enviado, que é como se verifica o fatiamento.
   */
  numeros: {
    responder: null,
    blocos: [],
  },
  /**
   * Limpa só o que foi REGISTRADO. Os flags de comportamento (entrega, media)
   * são configurados pelo teste e não devem ser zerados entre chamadas.
   */
  reset() {
    this.enviadas = [];
    this.alertas = [];
    this.pausas = [];
    this.atencoes = [];
    this.sondas = [];
    this.naoEntregaveis = [];
    this.varreduras = [];
    this.verificacoes = [];
    // Só o registro: `responder` é comportamento configurado pelo teste, como
    // `entrega` e `media`, e não pode ser zerado no meio de um cenário.
    this.numeros.blocos = [];
  },
};

export async function consultarNumerosNoWhatsApp(numeros) {
  wa.numeros.blocos.push([...numeros]);
  if (typeof wa.numeros.responder === "function") {
    return wa.numeros.responder(numeros);
  }
  return {
    ok: true,
    itens: numeros.map((n) => ({
      number: n,
      exists: true,
      jid: `${n}@s.whatsapp.net`,
      name: n,
    })),
  };
}

export async function sendWhatsAppMessage(phone, message, primeiraResposta = false) {
  wa.enviadas.push({ tipo: "text", phone, message, primeiraResposta });
  return wa.entrega;
}

export async function enviarWhatsAppComDiagnostico(phone, message, primeiraResposta = false) {
  wa.enviadas.push({ tipo: "text", phone, message, primeiraResposta });
  return { entregue: wa.entrega, falhaPermanente: !wa.entrega && wa.falhaPermanente };
}
export async function sendWhatsAppAudio(phone) {
  wa.enviadas.push({ tipo: "audio", phone });
  return wa.entregaAudio;
}
export async function fetchWhatsAppMediaBase64() {
  return wa.media;
}
export async function sendTelegramAlert(alert) {
  wa.alertas.push(alert);
}
export async function sendTelegramPausa(alert) {
  wa.pausas.push(alert);
}
export async function sendTelegramAtencao(alert) {
  wa.atencoes.push(alert);
}
export async function sendTelegramSondaModelo(modelo, papeis, detalhe) {
  wa.sondas.push({ modelo, papeis, detalhe });
}
export async function sendTelegramNaoEntregavel(alert) {
  wa.naoEntregaveis.push(alert);
}
export async function sendTelegramVarredura(alerta) {
  wa.varreduras.push(alerta);
}
export async function sendTelegramVerificacao(alerta) {
  wa.verificacoes.push(alerta);
}
export function linkDoWhatsApp(phone) {
  return `https://wa.me/${String(phone).replace(/\D/g, "")}`;
}
