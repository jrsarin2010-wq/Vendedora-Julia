/**
 * RESTRIÇÃO DO NÚMERO — quando quem está errado somos nós, a fila não paga.
 *
 * Nasceu do incidente de 18/08/2026: o WhatsApp restringiu o número da Júlia
 * por 23h ("Parece que você pode estar usando ferramentas que não seguem
 * nossos Termos para enviar mensagens automáticas ou em massa"). Ela continuava
 * podendo RESPONDER quem já falava com ela, mas não podia INICIAR conversa.
 *
 * Todo envio de abordagem passou a voltar `400` com "Error: Connection Closed",
 * e o código lia 400 como "este número não existe no WhatsApp" — a regra da
 * Rodada 51. Em doze minutos três dentistas com número BOM foram marcados
 * `nao_entregavel` e saíram da fila para sempre.
 *
 * Duas defesas, de propósito independentes:
 *
 * 1. `classificarFalhaDeEnvio` (integrations.ts) lê o CORPO do 400 e separa
 *    "o destinatário não existe" de "o nosso lado caiu". Depende de conhecer a
 *    frase que a Evolution devolve — ou seja, funciona para o que já vimos.
 *
 * 2. Esta trava aqui NÃO depende de reconhecer frase nenhuma: se falhas
 *    seguidas atingem LEADS DIFERENTES, o problema não é dos números. Nenhuma
 *    coincidência põe três telefones bons em sequência na fila; um número
 *    restringido põe todos. É a defesa que continua de pé quando a Evolution
 *    inventar uma mensagem de erro nova.
 *
 * A pausa mora no BANCO, e não em memória como a da varredura. A diferença é
 * o tempo de vida do problema: credencial errada se conserta trocando a
 * variável, e trocar a variável reinicia o serviço — então lá o reinício é o
 * gesto que deve retomar. Aqui a punição dura 23 horas e sobrevive a qualquer
 * deploy (houve SEIS em 18/08). Pausa em memória evaporaria no primeiro deploy
 * e voltaria a agravar a punição exatamente enquanto ela ainda corre.
 */
import { lerConfig, gravarConfig } from "./configuracoes";
import { logger } from "./logger";

/** A chave da pausa automática. Ausente ou vazia = não pausada. */
export const CHAVE_PAUSA_ABORDAGEM = "outreach_pausa_motivo";

/** Quando a pausa começou, em ISO. Só para a tela contar a história. */
export const CHAVE_PAUSA_DESDE = "outreach_pausa_desde";

/**
 * Três leads DIFERENTES seguidos.
 *
 * Não é o mesmo três do MAX_FALHAS_DE_ENVIO, e não deve ser confundido com
 * ele: lá são três tentativas no MESMO número (é sobre o número); aqui são
 * três números diferentes (é sobre nós). Três porque dois telefones ruins
 * seguidos numa planilha importada é plausível, e três já não é.
 */
export const LEADS_SEGUIDOS_ATE_PAUSAR = 3;

/**
 * Os leads que falharam em sequência, em ordem, sem nenhuma entrega no meio.
 *
 * Fica em memória porque é um contador de rajada, não um fato histórico: se o
 * processo reinicia, a rajada recomeça do zero e, se o problema continuar, três
 * ciclos (três minutos) reconstroem a conclusão. O que precisa sobreviver ao
 * reinício é a PAUSA, e essa está no banco.
 */
const seguidos = new Set<number>();

/** Só para o teste: zera a rajada entre cenários. */
export function esquecerFalhasSeguidas(): void {
  seguidos.clear();
}

/**
 * Um envio ENTREGUE prova que o caminho está aberto. Zera a rajada.
 *
 * Sem isto, falhas espalhadas ao longo de um dia inteiro — com dezenas de
 * entregas no meio — somariam até três e pausariam a abordagem por nada.
 */
export function registrarEnvioEntregue(): void {
  seguidos.clear();
}

export interface VeredictoDaRajada {
  /** Quantos leads diferentes falharam em sequência, contando este. */
  leadsSeguidos: number;
  /** true quando ESTA falha fechou a conta e a abordagem deve parar. */
  deveParar: boolean;
}

/**
 * Registra uma falha de envio e diz se já dá para concluir que o problema é
 * nosso.
 *
 * Conta LEADS distintos, não tentativas: o agendador insiste no mesmo número
 * até três vezes, e contar tentativa faria um único telefone ruim disparar a
 * pausa sozinho — que é o oposto do que esta trava existe para fazer.
 */
export function registrarFalhaDeEnvio(leadId: number): VeredictoDaRajada {
  seguidos.add(leadId);
  return {
    leadsSeguidos: seguidos.size,
    deveParar: seguidos.size >= LEADS_SEGUIDOS_ATE_PAUSAR,
  };
}

export interface EstadoDaPausa {
  pausada: boolean;
  motivo: string | null;
  desde: string | null;
}

/** A pausa, para o painel poder EXPLICAR por que nada está saindo. */
export async function estadoDaPausaDaAbordagem(): Promise<EstadoDaPausa> {
  const motivo = await lerConfig(CHAVE_PAUSA_ABORDAGEM);
  if (!motivo) return { pausada: false, motivo: null, desde: null };
  return { pausada: true, motivo, desde: await lerConfig(CHAVE_PAUSA_DESDE) };
}

/**
 * Pausa a abordagem por erro NOSSO.
 *
 * NÃO mexe no `outreach_ativo`. É uma chave separada de propósito: virar o
 * botão do dono por baixo dele produziria exatamente a confusão que custou uma
 * investigação inteira em 18/08 ("eu tinha desligado e o sistema estava
 * ligado"). Aqui a tela consegue dizer as duas coisas ao mesmo tempo — o botão
 * está como você deixou, e o sistema parou por conta própria, e por quê.
 */
export async function pausarAbordagem(motivo: string, agora: Date): Promise<void> {
  await gravarConfig(CHAVE_PAUSA_ABORDAGEM, motivo);
  await gravarConfig(CHAVE_PAUSA_DESDE, agora.toISOString());
  logger.error(
    { motivo },
    "Abordagem PAUSADA sozinha — o problema é do nosso número, não dos leads. Nenhum lead foi condenado por isto",
  );
}

/**
 * Tira a pausa. Só por gesto explícito de gente: a restrição do WhatsApp tem
 * hora para acabar, mas quem sabe se acabou é quem olha o aparelho — e voltar
 * sozinho, cedo demais, agrava a punição em vez de retomar o trabalho.
 */
export async function retomarAbordagem(): Promise<void> {
  seguidos.clear();
  // Só escreve se havia o que apagar. Ligar a abordagem é o gesto mais comum
  // do painel, e gravar duas linhas vazias a cada clique encheria a tabela de
  // configuração com estado que nunca existiu — mesmo cuidado do
  // `limparFalhasDeEnvio`, que também não paga escrita no caminho feliz.
  if (!(await lerConfig(CHAVE_PAUSA_ABORDAGEM))) return;
  await gravarConfig(CHAVE_PAUSA_ABORDAGEM, "");
  await gravarConfig(CHAVE_PAUSA_DESDE, "");
}

/**
 * O texto do motivo, montado a partir do que se sabe na hora.
 *
 * Diz o que fazer, e não só o que houve: quem lê isso está com a prospecção
 * parada e precisa saber se espera ou se conserta.
 */
export function motivoDaPausa(leadsSeguidos: number, ultimoErro: string): string {
  return (
    `${leadsSeguidos} leads diferentes seguidos falharam no envio, sem nenhuma entrega no meio. ` +
    `Isso não é problema dos números — é do nosso. Último erro: ${ultimoErro}. ` +
    "Suspeita principal: o WhatsApp restringiu o número (aconteceu em 18/08/2026, por 23h). " +
    "Confira o aparelho: se houver aviso de uso de ferramentas automáticas, espere a restrição " +
    "acabar antes de retomar — insistir agrava. Responder quem já conversa continua funcionando."
  );
}
