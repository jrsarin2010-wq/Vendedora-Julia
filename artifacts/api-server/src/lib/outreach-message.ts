/**
 * Geração da primeira mensagem de abordagem.
 *
 * Fica num arquivo próprio porque tem DOIS donos: o agendador que envia de
 * verdade e a rota de prévia que só mostra. É essencial que os dois passem
 * exatamente por aqui — uma prévia que gerasse a mensagem por outro caminho
 * poderia mostrar um texto e enviar outro, que é o pior resultado possível
 * para uma ferramenta cuja função é dar confiança antes de ligar o disparo.
 */
import { openai } from "@workspace/integrations-openai-ai-server";
import { JULIA_OUTREACH_PROMPT, buildOutreachBriefing } from "../julia-persona";
import { comRepique, esperasDeRepique } from "./repique";
// Nome e default do modelo moram em lib/modelos.ts (fonte única, conferida
// pela sonda de boot).
import { OUTREACH_MODEL } from "./modelos";
import { logger } from "./logger";

/**
 * TETO DE SAÍDA — e ele NÃO é o controle de tamanho da mensagem.
 *
 * Quem manda no tamanho é o prompt ("três linhas curtas"). Este número é outra
 * coisa: o teto do que o modelo pode GASTAR para produzir aquelas três linhas —
 * e num modelo de raciocínio o gasto inclui os tokens de raciocínio, que nunca
 * aparecem na resposta. A mensagem final tem ~60 tokens; o resto é pensar.
 *
 * Estava em 200, e 200 bastava enquanto o prompt trazia quatro mensagens
 * prontas: adaptar um exemplo é barato. Quando os exemplos sairam e a Júlia
 * passou a COMPOR a partir de seis partes descritas, o mesmo teto virou 400 da
 * OpenAI ("Could not finish the message because max_tokens... was reached") e,
 * na outra metade das vezes, resposta de conteúdo VAZIO — o mesmo estouro, com
 * duas caras diferentes.
 *
 * Por que 1024, e não os 512 do caminho da conversa: aqui não há razão para
 * economizar. São no máximo 40 mensagens por dia, então o custo é irrelevante
 * perto do que ele evita — e o modo de falhar deste teto é caro e silencioso.
 * Apertá-lo de novo só se passar a existir motivo, e com medição.
 */
const TETO_DE_SAIDA = 1024;

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
          max_completion_tokens: TETO_DE_SAIDA,
          messages: [
            { role: "system", content: JULIA_OUTREACH_PROMPT },
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
        tetoDeSaida: TETO_DE_SAIDA,
        // `completion_tokens` conta o raciocínio junto; o detalhe separa os
        // dois quando a API o manda, e é ele que diz se o teto ficou curto.
        tokensGerados: resposta.usage?.completion_tokens ?? null,
        tokensDeRaciocinio:
          resposta.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      },
      escolha?.finish_reason === "length"
        ? "Abordagem: o modelo estourou o teto de saída e não sobrou texto — suba TETO_DE_SAIDA"
        : "Abordagem: o modelo devolveu conteúdo vazio",
    );
    return null;
  }

  // O modelo às vezes devolve o texto entre aspas, apesar da instrução.
  // Numa mensagem de WhatsApp isso fica visivelmente errado.
  const limpo = texto.replace(/^["“”']+|["“”']+$/g, "").trim();
  if (!limpo) {
    logger.error(
      { modelo: OUTREACH_MODEL, texto },
      "Abordagem: sobrou só aspas depois da limpeza",
    );
    return null;
  }
  return limpo;
}
