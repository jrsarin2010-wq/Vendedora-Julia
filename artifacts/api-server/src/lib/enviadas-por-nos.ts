/**
 * QUEM MANDOU ESTA MENSAGEM: nós ou o humano no celular?
 *
 * O webhook da Evolution entrega `key.fromMe: true` para TODA mensagem que sai
 * do número da clínica — tanto as que a Júlia envia pela API quanto as que uma
 * pessoa digita no celular. Até a Rodada 28 isso não importava, porque o código
 * descartava todo `fromMe`. Agora importa: a mensagem digitada no celular é o
 * sinal de que um humano assumiu a conversa e a Júlia deve se calar. Se ela não
 * souber distinguir, ela se auto-pausa a cada resposta e nunca mais fala.
 *
 * ─── Por que a identidade, e não o campo `source` ───────────────────────────
 *
 * O candidato mais simples seria o `source` do payload ("android", "ios",
 * "web"). Fui ler como a Evolution o produz, em `prepareMessage`:
 *
 *     source: getDevice(message.key.id)
 *
 * Ou seja: `source` NÃO é informação de transporte. É um palpite calculado a
 * partir do FORMATO DO ID da mensagem, e nada mais. Isso o torna impróprio
 * aqui por um motivo concreto: os IDs que o Baileys gera para o que nós
 * enviamos usam o mesmo prefixo `3EB0` da linhagem do WhatsApp Web. Se o
 * humano responder pelo WhatsApp Web ou Desktop em vez do celular, os dois
 * lados podem cair na mesma classificação — e o erro é silencioso e nos dois
 * sentidos (ou ela nunca pausa, ou pausa sozinha e emudece).
 *
 * Então usamos IDENTIDADE em vez de inferência: guardamos o `key.id` de cada
 * mensagem que NÓS mandamos, direto da resposta do `sendText`/`sendWhatsAppAudio`.
 * Qualquer `fromMe` com um id que não está aqui foi digitado por uma pessoa.
 * Não depende de formato de id, de aparelho, nem de versão da Evolution.
 *
 * ─── O limite honesto disto ─────────────────────────────────────────────────
 *
 * O cache é de memória e morre no restart. Se o processo reiniciar exatamente
 * entre o nosso envio e a chegada do webhook daquele envio, aquela mensagem
 * vira "humana" e a Júlia se cala por 5 minutos naquela conversa. A janela é de
 * segundos, o efeito expira sozinho e o painel tem o botão de retomar. Achei
 * melhor documentar isso do que trocar por um sinal que erra em silêncio.
 */

/** id da mensagem -> quando registramos (epoch ms). */
const enviadas = new Map<string, number>();

/**
 * Dez minutos. O webhook do que enviamos chega em segundos; a folga existe só
 * para reenvio/retry da Evolution. Não precisa ser maior — depois disso a
 * mensagem já não é candidata a nada.
 */
const TTL_MS = 10 * 60 * 1000;

function limpar(agora: number): void {
  for (const [id, t] of enviadas) {
    if (agora - t > TTL_MS) enviadas.delete(id);
  }
}

/** Anota que esta mensagem saiu da nossa API. Ignora id vazio. */
export function registrarEnviadaPorNos(id: string | null | undefined): void {
  if (!id) return;
  const agora = Date.now();
  limpar(agora);
  enviadas.set(id, agora);
}

/**
 * Fomos nós que enviamos esta mensagem?
 *
 * NÃO consome o registro: a Evolution manda mais de um evento para a mesma
 * mensagem (upsert e depois update de status), e apagar na primeira leitura
 * faria a segunda passar por humana — que é exatamente o bug que este módulo
 * existe para evitar.
 *
 * Sem id não dá para afirmar que foi nossa. Devolve `false`, que é o lado
 * seguro: no máximo a Júlia se cala por 5 minutos, em vez de ignorar um humano
 * que assumiu a conversa.
 */
export function enviadaPorNos(id: string | null | undefined): boolean {
  if (!id) return false;
  const t = enviadas.get(id);
  if (t === undefined) return false;
  if (Date.now() - t > TTL_MS) {
    enviadas.delete(id);
    return false;
  }
  return true;
}

/** Só para teste: zera o cache entre cenários. */
export function limparEnviadas(): void {
  enviadas.clear();
}
