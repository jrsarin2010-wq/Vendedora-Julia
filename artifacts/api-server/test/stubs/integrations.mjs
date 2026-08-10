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
  /** Tudo que foi enviado: [{ tipo, phone, message }]. */
  enviadas: [],
  /** Alertas de handoff disparados. */
  alertas: [],
  /**
   * Limpa só o que foi REGISTRADO. Os flags de comportamento (entrega, media)
   * são configurados pelo teste e não devem ser zerados entre chamadas.
   */
  reset() {
    this.enviadas = [];
    this.alertas = [];
  },
};

export async function sendWhatsAppMessage(phone, message) {
  wa.enviadas.push({ tipo: "text", phone, message });
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
