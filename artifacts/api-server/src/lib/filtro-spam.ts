/**
 * REGRAS DE TELEFONE E DE CONTEÚDO — o que NÃO é dentista falando.
 *
 * Sem isto, qualquer mensagem que chegue no número vira lead e recebe resposta:
 * banco, operadora, promoção, código de verificação, corretora de empréstimo.
 * Três prejuízos ao mesmo tempo — gasta crédito de IA, polui o painel com lead
 * que não existe, e a Júlia fica entregando pitch de venda para um robô.
 *
 * São dois filtros independentes, e o segundo tem uma trava importante:
 * conversa JÁ INICIADA nunca é descartada por conteúdo (ver o webhook).
 */

/**
 * Um lead de verdade vem de celular. Número curto (0800, 4004, 32004545),
 * remetente alfanumérico ("BANCO", "Sua Operadora") ou tamanho fora do padrão
 * é serviço/robô, não dentista.
 *
 * Celular brasileiro no formato do WhatsApp tem 12 ou 13 dígitos com o 55:
 * 55 + DDD (2) + 8 dígitos (fixo/celular antigo) ou 9 dígitos (celular novo).
 */
export function pareceCelularReal(phone: string): boolean {
  if (!/^\d+$/.test(phone)) return false; // tem letra = remetente de serviço
  if (phone.length < 12 || phone.length > 13) return false; // 55 + DDD + 8/9 dígitos
  if (!phone.startsWith("55")) return true; // internacional: deixa passar
  const semPais = phone.slice(2);
  const ddd = Number(semPais.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false; // DDD inválido
  return true;
}

/**
 * Põe um telefone digitado à mão no formato do WhatsApp (só dígitos, com o
 * 55 na frente), ou devolve null se não der para aproveitar.
 *
 * Aceita o que vem de planilha: "(85) 99999-8888", "+55 85 99999-8888",
 * "85 99999 8888", "5585999998888".
 *
 * A decisão de pôr ou não o 55 é pelo TAMANHO, nunca por "já começa com 55".
 * O DDD 55 existe de verdade (Santa Maria/RS): o número 55999998888 tem 11
 * dígitos e começa com "55", mas esse "55" é o DDD, não o país. Pela regra de
 * tamanho ele vira 5555999998888, que é o certo; pela regra de prefixo ficaria
 * com 11 dígitos e seria descartado como inválido.
 */
export function normalizarTelefone(bruto: string): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  // 10 = DDD + 8 dígitos, 11 = DDD + 9 dígitos → falta o código do país.
  const comPais =
    digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
  // A validação é a MESMA usada no webhook para barrar robô de banco.
  return pareceCelularReal(comPais) ? comPais : null;
}

/**
 * Padrões de mensagem automática de banco, crédito, cobrança e verificação.
 * Se bater, não é dentista conversando — é robô.
 */
const PADROES_SERVICO: RegExp[] = [
  /\bcr[eé]dito (pr[eé][- ]?aprovado|liberado|dispon[ií]vel)\b/i,
  /\bempr[eé]stimo\b/i,
  /\bconsignado\b/i,
  /\bfgts\b/i,
  /\bantecipa[çc][ãa]o (do|de) (saque|fgts|sal[áa]rio)\b/i,
  // "do (seu)?" opcional dos dois lados: o banco escreve das três formas
  // ("limite do cartão", "limite do seu cartão", "limite cartão").
  /\blimite (do (seu )?)?cart[ãa]o\b/i,
  /\bfatura (do|de) (seu )?cart[ãa]o\b/i,
  /\bseu c[óo]digo (de verifica[çc][ãa]o|é|e)\b/i,
  /\bc[óo]digo de seguran[çc]a\b/i,
  /\bn[ãa]o compartilhe (esse|este) c[óo]digo\b/i,
  /\btoken de acesso\b/i,
  /\bpix (recebido|enviado) (no valor|de r\$)/i,
  /\bcompra aprovada\b/i,
  /\btransa[çc][ãa]o (aprovada|negada)\b/i,
  /\bboleto (dispon[ií]vel|vencido|gerado)\b/i,
  /\bfatura dispon[ií]vel\b/i,
  /\bd[íi]vida (negociada|em aberto)\b/i,
  /\bnegocie sua d[íi]vida\b/i,
  /\bserasa\b/i,
  /\bscore de cr[eé]dito\b/i,
  /\bpara (cancelar|sair), (responda|envie|digite)\b/i,
  /\bmensagem autom[áa]tica\b/i,
  /\bn[ãa]o responda (esta|essa) mensagem\b/i,
  // NÃO existe padrão para "promoção exclusiva" aqui, e é de propósito: o
  // próprio CaptaClin tem promoção (os 3 primeiros meses), então um dentista
  // interessado pode perfeitamente abrir com "vi a promoção de vocês". Barrar
  // isso silenciaria justamente o lead que a gente mais quer.
  /\bganhe (at[eé] )?r\$/i,
  /\bclique (aqui|no link) para (resgatar|ativar|desbloquear)\b/i,
];

/**
 * Devolve o padrão que bateu, ou null se a mensagem não parece de serviço.
 *
 * Devolve o PADRÃO, e não um booleano, de propósito: quem chama loga qual
 * regra silenciou a mensagem. Se um dentista de verdade for barrado por engano,
 * o log diz exatamente qual linha desta lista precisa mudar. Logar o texto em
 * si seria pior — a mensagem barrada é muitas vezes um código de verificação
 * do próprio Dr. Sarinho, que não tem por que ficar guardado no log.
 */
export function padraoDeServico(texto: string): RegExp | null {
  if (!texto.trim()) return null;
  return PADROES_SERVICO.find((p) => p.test(texto)) ?? null;
}
