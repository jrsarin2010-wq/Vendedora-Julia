/**
 * FORMA CANÔNICA DO TELEFONE — quem decide é o WhatsApp, não nós.
 *
 * O problema, medido na instância de produção (v2.3.7): mandamos
 * "5585992008899" (13 dígitos) e a resposta traz
 * `jid: "558592008899@s.whatsapp.net"` — 12 dígitos, SEM o nono. Conta antiga
 * vive na forma de 8 dígitos locais, e essa é a identidade real dela.
 *
 * Consequência prática: a mesma clínica entra como 13 dígitos pela importação
 * (que normaliza a partir da planilha) e como 12 pelo webhook (que copia o
 * `remoteJid`). Aí a checagem "já é lead?" do leads-import compara duas
 * strings diferentes, não acha ninguém, e a Júlia aborda de novo quem já é
 * lead — em silêncio, sem erro nenhum no log.
 *
 * A saída NÃO é comparar as duas formas para sempre: é gravar UMA só, a que o
 * WhatsApp define, já na entrada. Depois disso a comparação volta a ser
 * igualdade simples.
 *
 * Duas regras que vêm da resposta real e não podem ser afrouxadas:
 *
 * 1. Casar pelo campo `number` (o eco do que enviamos), NUNCA por posição no
 *    array. A resposta veio em ordem no teste, mas depender disso é apostar.
 * 2. Ler o `jid` SÓ quando `exists === true`. Para número inexistente a
 *    Evolution também devolve `jid`, montado a partir do que pedimos — grava-lo
 *    seria inventar identidade de conta que não existe.
 */
import { consultarNumerosNoWhatsApp } from "./integrations";
import { pareceCelularReal } from "./filtro-spam";
import { logger } from "./logger";

/**
 * Quantos números vão por chamada. O limite real do endpoint é DESCONHECIDO —
 * o teste em produção usou dois. 50 é conservador de propósito; quando alguém
 * medir o teto de verdade, muda-se aqui e mais nada.
 */
export const MAXIMO_POR_BLOCO = 50;

export interface TelefoneCanonico {
  /** A forma que o WhatsApp reconhece, ou null quando não há veredito confiável. */
  canonico: string | null;
  /**
   * true = existe, false = não existe, null = NÃO SEI (falha de rede, número
   * ausente da resposta, jid impossível de ler).
   *
   * `null` jamais pode ser tratado como `false`: falha de rede não é veredito,
   * e descartar lead bom por instabilidade da Evolution é prejuízo silencioso.
   */
  existe: boolean | null;
}

/** Os dígitos antes do "@" do jid, ou null se não der para aproveitar. */
export function numeroDoJid(jid: string | undefined): string | null {
  if (typeof jid !== "string") return null;
  // O jid pode trazer sufixo de dispositivo ("5585...:12@s.whatsapp.net").
  const antesDoArroba = jid.split("@")[0] ?? "";
  const digitos = (antesDoArroba.split(":")[0] ?? "").replace(/\D/g, "");
  if (!digitos) return null;
  // A mesma validação que barra robô de banco no webhook. Um jid que não passa
  // aqui é coisa que não sabemos tratar (grupo, broadcast, número estranho):
  // melhor devolver "não sei" do que gravar lixo como telefone.
  return pareceCelularReal(digitos) ? digitos : null;
}

/** Quebra a lista em blocos de no máximo `tamanho`. */
function emBlocos<T>(itens: T[], tamanho: number): T[][] {
  const blocos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    blocos.push(itens.slice(i, i + tamanho));
  }
  return blocos;
}

/**
 * Descobre a forma canônica de cada número, em lote.
 *
 * Recebe números JÁ passados por `normalizarTelefone()`. Devolve um mapa
 * indexado pelo número ENVIADO — quem chama procura pelo que tinha em mãos.
 *
 * Todo número entra no mapa, sempre: o que não obtiver veredito confiável sai
 * como `{ canonico: null, existe: null }`. Nunca some da resposta em silêncio.
 */
export async function canonicalizarTelefones(
  numeros: string[],
): Promise<Map<string, TelefoneCanonico>> {
  const mapa = new Map<string, TelefoneCanonico>();
  const unicos = [...new Set(numeros.filter((n) => Boolean(n)))];
  for (const numero of unicos) {
    mapa.set(numero, { canonico: null, existe: null });
  }

  if (unicos.length === 0) return mapa;

  for (const bloco of emBlocos(unicos, MAXIMO_POR_BLOCO)) {
    const resposta = await consultarNumerosNoWhatsApp(bloco);

    if (!resposta.ok) {
      // O bloco inteiro fica "não sei". Nada de escrita, nada de descarte.
      logger.warn(
        { enviados: bloco.length },
        "Consulta de números falhou — bloco inteiro fica indeterminado",
      );
      continue;
    }

    let respondidos = 0;
    for (const item of resposta.itens) {
      const enviado = typeof item?.number === "string" ? item.number : "";
      // Resposta sobre número que não pedimos: ignora em vez de confiar.
      if (!mapa.has(enviado)) continue;
      respondidos++;

      if (item.exists === true) {
        const canonico = numeroDoJid(item.jid);
        // exists true com jid ilegível não vira veredito: sem forma canônica
        // não há o que gravar, e chutar a forma enviada traria de volta
        // exatamente o bug que este módulo existe para fechar.
        //
        // O warn existe para essa recusa ser VISÍVEL. Sem ele, um jid fora do
        // padrão (`@g.us`, `@lid`, sufixo novo de uma versão futura da
        // Evolution) vira só mais um "não sei" na contagem, e o número volta à
        // fila para sempre sem ninguém entender por quê. O sufixo entra no log
        // e os dígitos NÃO: é ele que diz o que mudou, e telefone completo não
        // entra em log neste repo.
        if (!canonico) {
          logger.warn(
            { sufixo: typeof item.jid === "string" ? item.jid.split("@")[1] ?? "sem @" : "sem jid" },
            "Evolution disse exists:true com jid que não dá para aproveitar — tratado como indeterminado",
          );
        }
        mapa.set(
          enviado,
          canonico ? { canonico, existe: true } : { canonico: null, existe: null },
        );
        continue;
      }

      if (item.exists === false) {
        mapa.set(enviado, { canonico: null, existe: false });
      }
      // `exists` ausente ou não-booleano: fica como está, ou seja, "não sei".
    }

    // Só contagens: número completo não entra em log.
    logger.info(
      { enviados: bloco.length, respondidos, divergentes: bloco.length - respondidos },
      "Consulta de números no WhatsApp concluída",
    );
  }

  return mapa;
}

export interface LeadParaCanonicalizar {
  id: number;
  phone: string;
}

export interface TrocaDeTelefone {
  leadId: number;
  de: string;
  para: string;
}

export interface ColisaoDeTelefone extends TrocaDeTelefone {
  /** O lead que JÁ ocupa a forma canônica — provavelmente o mesmo dentista. */
  leadIdConflitante: number;
}

export interface PlanoDeCanonicalizacao {
  total: number;
  /** Já estava na forma canônica: nada a fazer. */
  jaCanonico: number;
  aAtualizar: TrocaDeTelefone[];
  /** `exists: false` — não mexer. O lead existe e a conversa dele também. */
  semWhatsapp: number[];
  /** `existe === null` — não sei, então não toco. */
  indeterminado: number[];
  colisoes: ColisaoDeTelefone[];
}

/**
 * Monta o plano SEM tocar no banco: é a mesma função que serve ao dry-run e à
 * aplicação, para o que foi revisado ser exatamente o que roda.
 *
 * A COLISÃO é o caso que exige cuidado. `leads.phone` é UNIQUE: se o lead A
 * está com 13 dígitos, o lead B com 12, e canonicalizar A produz o telefone de
 * B, o UPDATE violaria a restrição.
 *
 * Isso não é defeito do plano — é a descoberta de que A e B são o MESMO
 * dentista, duplicado pelas duas portas de entrada. E fundir os dois (qual
 * histórico vale? quem tem o opt-out? qual estágio do funil sobrevive?) é
 * decisão de negócio, não de script. Por isso a colisão é registrada e o item
 * é pulado, nunca resolvido sozinho.
 */
export function planejarCanonicalizacao(
  leads: LeadParaCanonicalizar[],
  mapa: Map<string, TelefoneCanonico>,
): PlanoDeCanonicalizacao {
  const plano: PlanoDeCanonicalizacao = {
    total: leads.length,
    jaCanonico: 0,
    aAtualizar: [],
    semWhatsapp: [],
    indeterminado: [],
    colisoes: [],
  };

  // Quem ocupa cada telefone hoje. É contra este mapa que a colisão é medida.
  const donoDoTelefone = new Map<string, number>();
  for (const lead of leads) {
    if (!donoDoTelefone.has(lead.phone)) donoDoTelefone.set(lead.phone, lead.id);
  }
  // Alvos já reservados nesta mesma rodada: dois leads podem canonicalizar
  // para o mesmo número sem que nenhum dos dois já o ocupe.
  const alvoReservado = new Map<string, number>();

  for (const lead of leads) {
    const resultado = mapa.get(lead.phone);

    if (!resultado || resultado.existe === null) {
      plano.indeterminado.push(lead.id);
      continue;
    }

    if (resultado.existe === false) {
      plano.semWhatsapp.push(lead.id);
      continue;
    }

    const canonico = resultado.canonico;
    if (!canonico) {
      // exists true sem forma canônica utilizável: "não sei", por segurança.
      plano.indeterminado.push(lead.id);
      continue;
    }

    if (canonico === lead.phone) {
      plano.jaCanonico++;
      continue;
    }

    const ocupante = donoDoTelefone.get(canonico) ?? alvoReservado.get(canonico);
    if (ocupante !== undefined && ocupante !== lead.id) {
      plano.colisoes.push({
        leadId: lead.id,
        de: lead.phone,
        para: canonico,
        leadIdConflitante: ocupante,
      });
      continue;
    }

    alvoReservado.set(canonico, lead.id);
    plano.aAtualizar.push({ leadId: lead.id, de: lead.phone, para: canonico });
  }

  return plano;
}
