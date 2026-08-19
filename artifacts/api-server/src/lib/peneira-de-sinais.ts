/**
 * A PENEIRA DOS SINAIS DE TEMPERATURA — o extrator propõe, o código confere.
 *
 * O caso que a criou (lead 49, 18/08/2026): o extrator devolveu
 * `perguntou_como_assinar` (+30) e `disse_quantos_prof` (+10) numa conversa em
 * que ele NUNCA perguntou como assinar e em que a Júlia perguntou duas vezes
 * quantos profissionais são, sem nunca ser respondida. Quarenta dos 53 pontos
 * do lead vieram de coisa que não aconteceu.
 *
 * NÃO foi falta de instrução. O prompt do extrator já proíbe isso em três
 * lugares ("só os que REALMENTE apareceram", "Liste apenas o que aconteceu de
 * fato. Na dúvida, não inclua", "Julgue pelo que o DENTISTA fez"). Uma quarta
 * linha proibindo é a jogada que já falhou quatro vezes neste repositório —
 * instrução genérica perde para o que o modelo acha que viu.
 *
 * O QUE ESTAVA FALTANDO era a diferença entre `sinais` e todo o resto da
 * extração: `name`, `interlocutor`, `funnelStage`, `planInterest`, `descoberta`
 * e `duvidaDoSite` passam por validação em código; `wantsToStop` e `irritado`
 * têm detector próprio no webhook. Em `sinais`, só o NOME era validado
 * (registrarSinais descarta nome inventado) — se o fato ACONTECEU era fé no
 * modelo. E é o campo com mais alavanca: um sinal de 30 pula a faixa morna
 * inteira, de frio direto para quente, numa mensagem só.
 *
 * A DECISÃO JÁ EXISTIA, PELA METADE. `pediu_pessoa` também vale 30 e foi
 * deliberadamente tirado do extrator — tem detector próprio no webhook, e por
 * isso nem aparece na lista do prompt. O repositório já tinha concluído que
 * sinal de 30 não se confia ao modelo, e aplicou a conclusão a UM dos três.
 * `pediu_link` e `perguntou_como_assinar` ficaram para trás. Esta peneira é a
 * outra metade daquela decisão, não uma disciplina nova.
 *
 * Duas travas, para dois defeitos diferentes:
 *
 * 1. COERÊNCIA INTERNA — sinal desmentido por outro campo do PRÓPRIO JSON.
 *    Não custa token nenhum: a prova já veio junto.
 * 2. EVIDÊNCIA CITADA — só para os dois sinais de 30. O extrator tem que
 *    apontar as palavras literais dele, e o código confere que essas palavras
 *    estão mesmo numa mensagem DELE.
 */

/** Os sinais que, sozinhos, pulam o lead de frio para quente. */
export const SINAIS_QUE_EXIGEM_PROVA = ["pediu_link", "perguntou_como_assinar"] as const;

/**
 * Tamanho mínimo do trecho, já normalizado.
 *
 * Seis, e não vinte: a busca é feita SÓ nas mensagens dele, então qualquer
 * trecho encontrado é, por construção, coisa que o dentista escreveu — o
 * mínimo existe só para barrar a citação trivial ("sim", "ok") que casa com
 * quase tudo e não prova sinal nenhum. Seis deixa passar "o link", que é
 * curto e é prova de verdade.
 */
export const MINIMO_DO_TRECHO = 6;

export interface SinalDescartado {
  sinal: string;
  motivo: string;
}

export interface ResultadoDaPeneira {
  aceitos: string[];
  descartados: SinalDescartado[];
}

/**
 * Deixa o texto comparável: sem acento, sem caixa, sem pontuação, com um
 * espaço só entre palavras.
 *
 * O extrator cita "de cabeça" e erra pontuação e acento o tempo todo. Exigir
 * a citação caractere a caractere transformaria a trava numa loteria e faria
 * cair sinal verdadeiro — que é o erro caro na outra direção.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    // `\p{Diacritic}` em vez da faixa de caracteres combinantes: a faixa se
    // escreve com acento solto dentro da regex, que e invisivel no editor e
    // some no primeiro copiar-e-colar. Aqui a fonte fica em ASCII puro.
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface ProvasDaConversa {
  /** O objeto `descoberta` do próprio extrator, como veio. */
  descoberta?: Record<string, unknown> | null;
  /** O `painPoints` do próprio extrator. */
  painPoints?: string | null;
  /** `{ sinal: "palavras literais dele" }`, do próprio extrator. */
  trechos?: Record<string, unknown> | null;
  /** O conteúdo das mensagens INBOUND — só o que ELE escreveu. */
  mensagensDele: string[];
}

/**
 * Separa o que o extrator conseguiu sustentar do que ele só afirmou.
 *
 * Sinal descartado NÃO vira erro: a conversa segue, a temperatura sai menor, e
 * o motivo vai para o log. Errar para o lado de deixar o lead mais frio é
 * barato — ele reaparece quente na próxima mensagem se o sinal for real. Errar
 * para o lado quente cobra do dono uma prioridade que ninguém demonstrou.
 */
export function peneirarSinais(
  sinais: string[],
  provas: ProvasDaConversa,
): ResultadoDaPeneira {
  const aceitos: string[] = [];
  const descartados: SinalDescartado[] = [];

  const corpo = provas.mensagensDele.map(normalizar).filter(Boolean);
  const trechos = (provas.trechos ?? {}) as Record<string, unknown>;

  for (const sinal of sinais) {
    const recusa = motivoParaRecusar(sinal, provas, trechos, corpo);
    if (recusa) descartados.push({ sinal, motivo: recusa });
    else aceitos.push(sinal);
  }

  return { aceitos, descartados };
}

function motivoParaRecusar(
  sinal: string,
  provas: ProvasDaConversa,
  trechos: Record<string, unknown>,
  corpo: string[],
): string | null {
  // ---------------------------------------------------- trava 1: coerência
  //
  // O extrator se contradiz dentro do mesmo JSON, e a contradição é
  // verificável sem custo nenhum: ele já mandou a resposta da descoberta e a
  // dor. Foi exatamente o que aconteceu no lead 49 — `disse_quantos_prof`
  // junto de uma descoberta que dizia que a pergunta ficou sem resposta.
  if (sinal === "disse_quantos_prof") {
    const resposta = provas.descoberta?.["profissionais"];
    if (resposta === undefined || resposta === null || resposta === "") {
      return "o extrator não gravou descoberta.profissionais — ele não disse quantos são";
    }
    if (String(resposta).trim().toLowerCase() === "sem_resposta") {
      return "descoberta.profissionais é sem_resposta: a pergunta foi feita e não foi respondida";
    }
  }

  if (sinal === "contou_a_dor" && !provas.painPoints?.trim()) {
    return "o extrator não gravou painPoints — não há dor contada para pontuar";
  }

  // ------------------------------------------------- trava 2: prova citada
  if ((SINAIS_QUE_EXIGEM_PROVA as readonly string[]).includes(sinal)) {
    const bruto = trechos[sinal];
    if (typeof bruto !== "string" || !bruto.trim()) {
      // Ausência do trecho DESCARTA, e não passa por omissão. É a direção
      // segura: sinal verdadeiro sem prova volta na mensagem seguinte, e vale
      // os mesmos 30; sinal falso com prova ausente valeria 30 para sempre,
      // porque `sinaisVistos` nunca zera.
      return "vale 30 pontos e veio sem trecho que o comprove";
    }
    const trecho = normalizar(bruto);
    if (trecho.length < MINIMO_DO_TRECHO) {
      return `o trecho citado ("${bruto}") é curto demais para provar coisa alguma`;
    }
    if (!corpo.some((m) => m.includes(trecho))) {
      // Isto pega DUAS coisas de uma vez: a citação inventada, e a citação
      // que existe mas é da JÚLIA — o corpo só tem mensagem dele, então
      // qualquer fala dela reprova aqui sem precisar de regra própria.
      return `o trecho citado ("${bruto}") não aparece em nenhuma mensagem dele`;
    }
  }

  return null;
}
