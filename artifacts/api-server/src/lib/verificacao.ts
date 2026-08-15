/**
 * REGRAS DA VERIFICAÇÃO DE WHATSAPP — as decisões, sem banco e sem rede.
 *
 * Mesma divisão de varredura.ts / varredura-scheduler.ts: aqui mora o que dá
 * para testar com uma chamada de função, e o agendador só orquestra.
 *
 * O que esta etapa faz: pega quem a varredura captou (`novo`, com telefone do
 * Maps), descobre se aquele número existe no WhatsApp e deixa a clínica em
 * `apto`. Verificar é CONSULTA. Promover a lead — que é mensagem para dentista
 * de verdade — continua sendo a Etapa 3C, e continua manual.
 */
import { normalizarTelefone } from "./filtro-spam";
import type { TelefoneCanonico } from "./canonicalizar-telefone";

/**
 * Quantos prospects por lote. É o mesmo teto que `canonicalizarTelefones()` já
 * usa por bloco (MAXIMO_POR_BLOCO), então um lote sai numa chamada só.
 */
export const TAMANHO_DO_LOTE = 50;

/**
 * Espaço mínimo entre dois lotes.
 *
 * A instância da Evolution é a MESMA que atende os dentistas: cada consulta
 * daqui disputa a conexão com conversa real. 15 minutos é conservador de
 * propósito — se a instância aguentar mais, isto sobe depois com dado medido,
 * nunca antes.
 */
export const INTERVALO_MINIMO_ENTRE_LOTES_MS = 15 * 60 * 1000;

/** Teto de verificações por dia: ~4 lotes, espalhados. */
export const TETO_DIARIO = 200;

/**
 * A janela da cota é DESLIZANTE, como a das rodadas de varredura
 * (`disparadasNas24h`). Não é "desde a meia-noite": o que protege a instância
 * é o volume nas últimas 24h, e virada de dia não devolve fôlego a ninguém.
 */
export const JANELA_DA_COTA_MS = 24 * 60 * 60 * 1000;

/** Lotes inteiramente mudos, seguidos, antes de pausar. */
export const LOTES_MUDOS_ATE_PAUSAR = 2;

export interface ConfigDeVerificacao {
  habilitado: boolean;
}

/**
 * Lida a CADA chamada, como o resto do repo. Nasce DESLIGADA: um deploy não
 * pode começar a bater na Evolution sozinho.
 */
export function lerConfigDeVerificacao(): ConfigDeVerificacao {
  return { habilitado: process.env.VERIFICACAO_ENABLED === "true" };
}

export interface ProspectParaVerificar {
  id: number;
  telefoneRaw: string | null;
}

export interface Aprovado {
  id: number;
  /** O número JÁ normalizado — é ele que vai para a Evolution. */
  numero: string;
}

export interface Triagem {
  aprovados: Aprovado[];
  /** Ids que `normalizarTelefone()` recusou: viram `telefone_invalido`. */
  reprovados: number[];
}

/**
 * Separa quem merece uma chamada externa de quem já dá para descartar aqui.
 *
 * Reprovar ANTES de ir à Evolution não é otimização: é o que impede um "0800
 * 111 2222" do Maps de consumir uma consulta e ainda voltar com um veredito
 * sem sentido. O critério é o mesmo do webhook e da importação
 * (`pareceCelularReal`, dentro de `normalizarTelefone`), para não existirem
 * duas ideias de telefone válido no sistema.
 */
export function triar(prospects: ProspectParaVerificar[]): Triagem {
  const aprovados: Aprovado[] = [];
  const reprovados: number[] = [];

  for (const p of prospects) {
    // `telefoneRaw` nulo nem deveria chegar aqui (a seleção filtra), mas
    // tratar em vez de confiar custa uma linha.
    const numero = p.telefoneRaw ? normalizarTelefone(p.telefoneRaw) : null;
    if (numero) {
      aprovados.push({ id: p.id, numero });
    } else {
      reprovados.push(p.id);
    }
  }

  return { aprovados, reprovados };
}

export interface AptoParaGravar {
  id: number;
  /**
   * A forma do `jid`, NUNCA a que enviamos. É o que faz a comparação com
   * `leads.phone` na Etapa 3C ser igualdade simples (ver o cabeçalho de
   * canonicalizar-telefone.ts).
   */
  canonico: string;
}

export interface VereditoDoLote {
  aptos: AptoParaGravar[];
  /** `existe === false`: viram `sem_whatsapp`. */
  semWhatsapp: number[];
  /** `existe === null`: NÃO se mexe. Continuam `novo` e voltam no próximo lote. */
  indeterminados: number[];
}

/**
 * Traduz o mapa da Evolution em três listas de ids.
 *
 * A regra que não pode ser afrouxada: `null` é "não sei", nunca "não tem".
 * Evolution fora do ar ou credencial ruim descartaria clínica boa em silêncio —
 * e o prejuízo só apareceria meses depois, como uma cidade que "não rendeu".
 */
export function aplicarVeredito(
  aprovados: Aprovado[],
  mapa: Map<string, TelefoneCanonico>,
): VereditoDoLote {
  const veredito: VereditoDoLote = { aptos: [], semWhatsapp: [], indeterminados: [] };

  for (const a of aprovados) {
    const r = mapa.get(a.numero);

    if (!r || r.existe === null) {
      veredito.indeterminados.push(a.id);
      continue;
    }

    if (r.existe === false) {
      veredito.semWhatsapp.push(a.id);
      continue;
    }

    // `existe: true` sem forma canônica utilizável (um jid `@g.us`, por
    // exemplo) já vem como indeterminado do módulo de canonicalização; este
    // segundo cinto existe porque gravar `telefone_whatsapp` nulo num prospect
    // marcado `apto` seria um registro que se contradiz.
    if (!r.canonico) {
      veredito.indeterminados.push(a.id);
      continue;
    }

    veredito.aptos.push({ id: a.id, canonico: r.canonico });
  }

  return veredito;
}

/**
 * O lote inteiro voltou mudo?
 *
 * 50 números não ficam todos indeterminados por acaso — isso é a Evolution
 * fora do ar ou credencial ruim. Um lote vazio (todo mundo reprovado na
 * triagem) NÃO conta: nada foi perguntado, então não há silêncio a interpretar.
 */
export function loteMudo(veredito: VereditoDoLote): boolean {
  if (veredito.indeterminados.length === 0) return false;
  return veredito.aptos.length === 0 && veredito.semWhatsapp.length === 0;
}

export interface JanelaDaCota {
  /** Quantos ganharam veredito nas últimas 24h. */
  verificados: number;
  /** O veredito mais recente, ou null se a janela está vazia. */
  ultimo: Date | null;
}

/**
 * Resume a janela de 24h a partir das datas de verificação.
 *
 * Uma consulta só serve às duas travas (intervalo e cota) de propósito: são a
 * mesma pergunta ("o que este worker fez ultimamente?") e separá-las em duas
 * idas ao banco só criaria a chance de elas discordarem.
 */
export function resumirJanela(datas: (Date | string | null)[], agora: Date): JanelaDaCota {
  const limite = agora.getTime() - JANELA_DA_COTA_MS;
  let verificados = 0;
  let ultimo: Date | null = null;

  for (const bruta of datas) {
    if (!bruta) continue;
    const data = bruta instanceof Date ? bruta : new Date(bruta);
    const t = data.getTime();
    if (Number.isNaN(t) || t < limite) continue;
    verificados++;
    if (!ultimo || t > ultimo.getTime()) ultimo = data;
  }

  return { verificados, ultimo };
}

/** Já passaram os 15 minutos desde o último lote? Janela vazia = pode. */
export function intervaloCumprido(ultimo: Date | null, agora: Date): boolean {
  if (!ultimo) return true;
  return agora.getTime() - ultimo.getTime() >= INTERVALO_MINIMO_ENTRE_LOTES_MS;
}
