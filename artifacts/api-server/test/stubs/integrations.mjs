/**
 * Stub do src/lib/integrations: nada sai para o WhatsApp nem para o Telegram.
 * O teste configura se a entrega "funciona" e depois inspeciona o que teria
 * sido enviado.
 */
export const wa = {
  /** sendWhatsAppMessage entregou? */
  entrega: true,
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
  },
};

export async function sendWhatsAppMessage(phone, message, primeiraResposta = false) {
  wa.enviadas.push({ tipo: "text", phone, message, primeiraResposta });
  return wa.entrega;
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
export function linkDoWhatsApp(phone) {
  return `https://wa.me/${String(phone).replace(/\D/g, "")}`;
}
