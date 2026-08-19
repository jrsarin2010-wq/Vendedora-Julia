/**
 * Geração das mensagens FRIAS: a primeira abordagem e os dois toques de quem
 * nunca respondeu.
 *
 * A abertura fica num arquivo próprio porque tem DOIS donos: o agendador que
 * envia de verdade e a rota de prévia que só mostra. É essencial que os dois
 * passem exatamente por aqui — uma prévia que gerasse a mensagem por outro
 * caminho poderia mostrar um texto e enviar outro, que é o pior resultado
 * possível para uma ferramenta cuja função é dar confiança antes de ligar o
 * disparo.
 *
 * Os toques entraram aqui em 19/08/2026, quando deixaram de ser texto fixo.
 * Moram no mesmo arquivo porque falham do mesmo jeito e dividem a chamada ao
 * modelo (ver `gerarTextoFrio`) — o que muda entre eles é o prompt e a ficha.
 */
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  JULIA_OUTREACH_PROMPT,
  buildOutreachBriefing,
  JULIA_TOQUE_PROMPT,
  buildToqueBriefing,
} from "../julia-persona";
import { comRepique, esperasDeRepique } from "./repique";
// Nome e default do modelo moram em lib/modelos.ts (fonte única, conferida
// pela sonda de boot).
import { OUTREACH_MODEL, TETO_ABORDAGEM } from "./modelos";
import { logger } from "./logger";


export interface DadosDoLead {
  name: string | null;
  clinicName: string | null;
  city: string | null;
  instagram: string | null;
  origin: string | null;
  /**
   * Reputação no Google, para leads vindos da varredura. Opcionais porque o
   * lead que chegou pelo WhatsApp não tem nenhuma das duas — e porque a trava
   * de quando isso pode ser dito é da ficha (julia-persona.ts), não daqui.
   */
  nota?: string | number | null;
  totalAvaliacoes?: number | null;
}

/**
 * Devolve o texto da primeira mensagem, ou null se o modelo não produziu nada
 * aproveitável. Nunca lança: quem chama decide o que fazer com o null.
 */
export async function gerarMensagemDeAbordagem(
  lead: DadosDoLead,
  /**
   * O instante do envio — a mensagem abre pela saudação do horário, e o
   * horário que vale é o da clínica. Entra por parâmetro porque os dois donos
   * já o têm em mãos: o agendador recebe o instante da rodada, e a prévia usa
   * o de agora. Um `new Date()` escondido aqui dentro tiraria do teste a
   * única pergunta que importa — ela abre com bom dia às 9h e com boa tarde
   * às 15h?
   */
  agora: Date,
): Promise<string | null> {
  const briefing = buildOutreachBriefing({
    name: lead.name,
    clinicName: lead.clinicName,
    city: lead.city,
    instagram: lead.instagram,
    origin: lead.origin,
    nota: lead.nota,
    totalAvaliacoes: lead.totalAvaliacoes,
    agora,
  });

  return gerarTextoFrio(JULIA_OUTREACH_PROMPT, briefing, "Abordagem");
}

/**
 * Devolve o texto de um TOQUE (a segunda mensagem, ou a despedida) para quem
 * nunca respondeu — ou null se o modelo não produziu nada aproveitável.
 *
 * Existe desde 19/08/2026. Antes os dois toques eram texto literal em
 * `julia-persona.ts`, idêntico para todo dentista, e o segundo ainda levava o
 * link do site: era o maior sinal de robô que sobrava depois de reduzir o
 * volume, porque a cota não muda em nada o fato de N números receberem a mesma
 * sentença. O porquê inteiro está no comentário de `JULIA_TOQUE_PROMPT`.
 *
 * Gerado NA HORA DO ENVIO, e não quando a cadência é armada. É o mesmo desenho
 * da reativação (que também nasce com `messageTemplate: null`), e aqui o motivo
 * é duplo: a saudação tem que ser a do relógio de três ou dez dias DEPOIS, e o
 * modelo precisa ver o que já foi mandado para não repetir as próprias
 * palavras — coisa que não existia ainda no momento em que a fila foi armada.
 */
export async function gerarMensagemDeToque(
  lead: Pick<DadosDoLead, "name" | "clinicName" | "city">,
  toque: 1 | 2,
  /** O que a Júlia já mandou para este dentista, da mais antiga para a mais nova. */
  jaEnviadas: string[],
  /** Dias corridos desde a primeira mensagem, ou null se não dá para saber. */
  diasDesdeAAbordagem: number | null,
  agora: Date,
): Promise<string | null> {
  const briefing = buildToqueBriefing({
    toque,
    name: lead.name,
    clinicName: lead.clinicName,
    city: lead.city,
    diasDesdeAAbordagem,
    jaEnviadas,
    agora,
  });

  return gerarTextoFrio(JULIA_TOQUE_PROMPT, briefing, `Toque ${toque}`);
}

/**
 * A chamada ao modelo que a abertura e os toques dividem: repique, teto,
 * diagnóstico do vazio e limpeza das aspas.
 *
 * Um lugar só de propósito. As duas mensagens frias falham exatamente pelos
 * mesmos motivos — teto estourado, conteúdo vazio, texto que volta entre aspas
 * — e foi um desses casos (a prévia muda de 18/08) que mostrou o preço de ter
 * o diagnóstico em quem chama: um dono logava, o outro não, e o defeito
 * escolheu justamente o lado cego.
 *
 * `rotulo` é o que aparece no log ("Abordagem", "Toque 1") — sem ele as três
 * mensagens de erro ficariam indistinguíveis, que é o mesmo buraco por outro
 * caminho.
 */
async function gerarTextoFrio(
  prompt: string,
  briefing: string,
  rotulo: string,
): Promise<string | null> {
  // Repique CURTO (Rodada 43): aqui ninguém está esperando — se falhar de vez,
  // o agendador devolve o lead para a fila e tenta no ciclo seguinte, daqui a
  // um minuto. A segunda chance existe só para não gastar um ciclo inteiro por
  // causa de um 429 passageiro. Esperar 19 segundos seria pior: o ciclo da
  // prospecção é justamente o que espalha os envios pela janela do dia.
  const resposta = await comRepique(
    () =>
      openai.chat.completions.create(
        {
          model: OUTREACH_MODEL,
          max_completion_tokens: TETO_ABORDAGEM,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: briefing },
          ],
        },
        { timeout: 30_000 },
      ),
    { esperas: esperasDeRepique().slice(0, 1) },
  );

  // O DIAGNÓSTICO MORA AQUI, e não em quem chama.
  //
  // O null saía mudo deste arquivo. O agendador tinha o seu próprio log ("o
  // modelo devolveu vazia"), a rota de prévia não tinha nenhum — então a prévia
  // que falhava assim não deixava rastro NENHUM: nem na tela, nem no log, e a
  // única pista era um campo nulo no JSON. Um dos dois donos sabia, o outro
  // não, e o defeito escolheu justamente o lado cego.
  //
  // O `finish_reason` e a contagem entram no log porque sem eles "veio vazia"
  // não distingue estouro de teto de recusa do modelo — e foram exatamente
  // esses dois números que faltaram para explicar a prévia muda de 18/08.
  const escolha = resposta.choices[0];
  const texto = escolha?.message?.content?.trim();
  if (!texto) {
    logger.error(
      {
        modelo: OUTREACH_MODEL,
        finishReason: escolha?.finish_reason ?? null,
        tetoDeSaida: TETO_ABORDAGEM,
        // `completion_tokens` conta o raciocínio junto; o detalhe separa os
        // dois quando a API o manda, e é ele que diz se o teto ficou curto.
        tokensGerados: resposta.usage?.completion_tokens ?? null,
        tokensDeRaciocinio:
          resposta.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      },
      escolha?.finish_reason === "length"
        ? `${rotulo}: o modelo estourou o teto de saída e não sobrou texto — suba TETO_ABORDAGEM em lib/modelos.ts`
        : `${rotulo}: o modelo devolveu conteúdo vazio`,
    );
    return null;
  }

  // O modelo às vezes devolve o texto entre aspas, apesar da instrução.
  // Numa mensagem de WhatsApp isso fica visivelmente errado.
  const limpo = texto.replace(/^["“”']+|["“”']+$/g, "").trim();
  if (!limpo) {
    logger.error(
      { modelo: OUTREACH_MODEL, texto },
      `${rotulo}: sobrou só aspas depois da limpeza`,
    );
    return null;
  }
  return limpo;
}
