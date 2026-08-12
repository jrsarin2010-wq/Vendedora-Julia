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

const OUTREACH_MODEL = process.env.JULIA_OUTREACH_MODEL ?? "gpt-5.4-mini";

export interface DadosDoLead {
  name: string | null;
  clinicName: string | null;
  city: string | null;
  instagram: string | null;
  origin: string | null;
}

/**
 * Devolve o texto da primeira mensagem, ou null se o modelo não produziu nada
 * aproveitável. Nunca lança: quem chama decide o que fazer com o null.
 */
export async function gerarMensagemDeAbordagem(
  lead: DadosDoLead,
): Promise<string | null> {
  const briefing = buildOutreachBriefing({
    name: lead.name,
    clinicName: lead.clinicName,
    city: lead.city,
    instagram: lead.instagram,
    origin: lead.origin,
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
          max_completion_tokens: 200,
          messages: [
            { role: "system", content: JULIA_OUTREACH_PROMPT },
            { role: "user", content: briefing },
          ],
        },
        { timeout: 30_000 },
      ),
    { esperas: esperasDeRepique().slice(0, 1) },
  );

  const texto = resposta.choices[0]?.message?.content?.trim();
  if (!texto) return null;

  // O modelo às vezes devolve o texto entre aspas, apesar da instrução.
  // Numa mensagem de WhatsApp isso fica visivelmente errado.
  return texto.replace(/^["“”']+|["“”']+$/g, "").trim() || null;
}
