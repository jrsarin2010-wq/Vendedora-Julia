import { db } from "@workspace/db";
import { followUpsTable, leadsTable, leadMessagesTable } from "@workspace/db";
import { eq, lte, and, asc, desc, inArray } from "drizzle-orm";
import { enviarWhatsAppComDiagnostico } from "./integrations";
import { logger } from "./logger";
import { saudacao } from "./tratamento";
import {
  verificarSemResposta,
  marcarAtencao,
  pareceMensagemComPromessa,
} from "./atencao";
import {
  lerConfig,
  podeDispararAgora,
  contarEnvios,
  foraDoHorarioDeConversa,
  momentoEmSaoPaulo,
  sortearIntervalo,
  EXPLICACAO_BLOQUEIO,
} from "./outreach";
import { datasDeEnviosFrios } from "./ritmo-frio";
import { outreachAtivoNoPainel } from "./configuracoes";
import { registrarFalhaPermanente, limparFalhasDeEnvio } from "./nao-entregavel";
import {
  estadoDaPausaDaAbordagem,
  motivoDaPausa,
  pausarAbordagem,
  registrarEnvioEntregue,
  registrarFalhaDeEnvio,
} from "./restricao";
import {
  ABORDAGEM_DELAYS_HOURS,
  TOQUES_REATIVACAO,
  REATIVACAO_DELAYS_DIAS,
  conversaFoiProfunda,
} from "../julia-persona";
import {
  gerarMensagemDeToque,
  gerarMensagemDeToqueDeConversa,
} from "./outreach-message";
import {
  LIMITE_REATIVACOES_POR_DIA,
  EXPLICACAO_FORA,
  elegivelParaReativacao,
  decidirToqueDeReativacao,
  lerNovidade,
  contarReativacoesDeHoje,
} from "./reativacao";

/**
 * O ritmo frio deste ciclo: quanto já saiu (de QUALQUER agendador) e quando
 * foi o último. Carregado do banco uma vez por ciclo, na primeira vez que um
 * toque frio vence, e atualizado em memória a cada envio do próprio ciclo.
 */
interface RitmoFrio {
  naUltimaHora: number;
  hoje: number;
  ultimo: Date | null;
}

/**
 * Um toque de ABORDAGEM (ou de REATIVAÇÃO) pode sair NESTE instante?
 *
 * A abordagem não é follow-up de conversa: quem recebe nunca respondeu nada,
 * então é mensagem fria e vale a MESMA janela da prospecção — inclusive a
 * trava mestra. A reativação pega a mesma regra por outro motivo: quem está
 * nela ficou 30+ dias sem notícia nossa, e "passei pra te contar uma novidade"
 * no domingo à noite tem o mesmo cheiro de robô que a mensagem fria.
 * Se o Dr. Sarinho desligar OUTREACH_ENABLED porque as entregas começaram a
 * falhar, os toques já agendados precisam parar junto; senão a trava de
 * emergência protege metade do problema e ele descobre isso do pior jeito.
 *
 * O mesmo vale para o BOTÃO do painel (Etapa 4), e é por isso que ele chega
 * aqui como parâmetro: desligar a abordagem e continuar mandando o toque 2 de
 * quem nunca respondeu seria desligar pela metade. A reativação entra junto —
 * toque frio depois de 30 dias de silêncio é abordagem, não continuidade.
 *
 * O que NÃO passa por esta função, de propósito: o follow-up de CONVERSA.
 * Quem respondeu está falando com a gente, e o botão nunca governa isso.
 *
 * Sem isto, um toque agendado para 3 dias depois de uma quinta-feira cairia num
 * domingo: "passei por aqui de novo" no domingo é exatamente o que faz um
 * dentista denunciar o número.
 *
 * Os contadores vão CHEIOS (Rodada 51): o toque bebe do mesmo balde de
 * OUTREACH_PER_HOUR/PER_DAY que as aberturas — antes ele saía por fora da
 * cota, e um dia de pico somava as aberturas MAIS os toques vencidos, o dobro
 * do volume calibrado.
 *
 * O intervalo mínimo agora vai SORTEADO, como na abordagem (19/08/2026). Ia
 * cravado, e a justificativa escrita aqui era que o ciclo de 5 minutos já
 * espaçava mais que o dobro do mínimo — verdade com 180s, falsa desde que o
 * mínimo virou 1200s. Cravado, o toque frio passaria a sair no primeiro tique
 * de 5 minutos depois dos 20 exatos: um grid, que é a regularidade que o
 * sorteio existe para desfazer.
 */
function toqueFrioPodeSair(
  agora: Date,
  ritmo: RitmoFrio,
  ativoNoPainel: boolean,
): { pode: boolean; motivo?: string } {
  const config = lerConfig();
  const decisao = podeDispararAgora({
    config,
    agora,
    enviadosNaUltimaHora: ritmo.naUltimaHora,
    enviadosHoje: ritmo.hoje,
    ultimoEnvio: ritmo.ultimo,
    intervaloExigidoSegundos: sortearIntervalo(config.intervaloMinimoSegundos),
  });
  if (!decisao.pode) return { pode: false, motivo: decisao.motivo };
  // Depois da env, como nos outros dois agendadores.
  if (!ativoNoPainel) return { pode: false, motivo: "desligado_no_painel" };
  return { pode: true };
}

/**
 * Quantos toques frios saem por rodada. UM.
 *
 * O agendador roda a cada 5 minutos e pega até 20 vencidos de uma vez. Numa
 * campanha de 40 leads, todos os toques do dia 3 vencem em bloco — e vinte
 * mensagens de texto IDÊNTICO saindo no mesmo segundo para vinte números é a
 * assinatura de robô mais óbvia que existe. Um por rodada espalha os envios
 * pela janela do dia, do mesmo jeito que o agendador de abordagem faz.
 */
const TOQUES_FRIOS_POR_CICLO = 1;

/**
 * Reativações por rodada: UMA, pelo mesmo motivo dos toques frios. Com o
 * agendador rodando a cada 5 minutos, é isso que espalha os envios pela janela
 * do dia com intervalo irregular — dez leads vencendo juntos no dia +30 sairiam
 * em bloco, e reativação em bloco é assinatura de robô.
 */
const REATIVACOES_POR_CICLO = 1;

/**
 * Toques de CONVERSA por rodada: UM, desde 22/08/2026.
 *
 * Era ilimitado — o laço mandava todos os vencidos que coubessem nos 20 da
 * consulta. Ficou invisível enquanto nada segurou a fila, porque os quatro
 * toques de um lead vencem espaçados e raramente coincidem.
 *
 * O QUE REVELOU: a pausa por erro nosso (lib/restricao.ts) segurou tudo por
 * três dias, e no minuto em que ela caiu o represado saiu junto — NOVE
 * mensagens em seis minutos, pelo mesmo número que o WhatsApp tinha
 * restringido quatro dias antes. Rajada seguida de silêncio é exatamente o
 * padrão que o agendador de abordagem já existia para evitar, e agora está
 * escrito onde faltava: **toda pausa longa é um acumulador**, e o gesto de
 * retomar é o momento de maior volume que este sistema produz.
 *
 * O que NÃO entra junto, de propósito: o toque de conversa continua fora da
 * cota da prospecção (OUTREACH_PER_DAY/PER_HOUR), fora da janela de 9h-18h e
 * fora do botão do painel — quem respondeu está conversando, e nada disso o
 * governa (ver `foraDoHorarioDeConversa`, que é a única trava de horário que
 * vale aqui). O que entra é só o ESPAÇAMENTO: um por rodada de 5 minutos, o
 * mesmo teto dos outros dois, que desfaz a rajada sem tirar o toque de
 * ninguém.
 */
const TOQUES_DE_CONVERSA_POR_CICLO = 1;

/**
 * A identidade de um toque: (lead, cadência, número do toque).
 *
 * É por ela que se sabe que duas linhas da tabela são a MESMA mensagem. Não é
 * pelo texto: desde 22/08 o texto do toque de conversa nasce do modelo e sai
 * diferente nas duas linhas — comparar texto deixaria de pegar exatamente o
 * caso que a deduplicação existe para pegar. O que define "é o mesmo toque" é
 * o LUGAR dele na cadência, não a frase que calhou de sair.
 */
function chaveDoToque(leadId: number, kind: string, touchNumber: number): string {
  return `${leadId}|${kind}|${touchNumber}`;
}

/**
 * Uma passada do agendador: pega os follow-ups vencidos e manda os que devem
 * sair. Exportada (como `rodarCicloDeAbordagem`, do outreach) para o teste
 * conseguir exercitar a decisão sem depender de `setInterval`.
 *
 * `agora` também vem de fora pelo mesmo motivo que lá: desde que os toques de
 * abordagem respeitam a janela da prospecção, "domingo à noite não sai" é uma
 * decisão testável — e testá-la esperando domingo não é opção.
 */
export async function rodarCicloDeFollowUp(agora: Date = new Date()): Promise<void> {
  try {
    const now = agora;

    // A PAUSA POR ERRO NOSSO GOVERNA TODO O CICLO, inclusive o toque de
    // CONVERSA — e é a única trava da abordagem que faz isso.
    //
    // As outras não valem aqui de propósito (o botão do painel governa quem
    // ainda NÃO conversa; a cota diária protege contra volume frio). Esta vale,
    // e a diferença é o que está em jogo: quando o WhatsApp restringe o número,
    // qualquer mensagem que NÓS iniciamos agrava a punição, e o toque de
    // conversa é uma mensagem que nós iniciamos — o dentista não pediu por ela
    // naquele instante.
    //
    // Foi o que aconteceu em 18/08/2026: desligar a abordagem no painel parou
    // as aberturas e NÃO parou os toques de conversa, que continuaram batendo
    // no número restringido e queimando a cadência de conversas vivas.
    //
    // Responder quem escreveu continua liberado: isso é o webhook, não passa
    // por aqui, e é justamente o que a restrição do WhatsApp não proíbe.
    const pausa = await estadoDaPausaDaAbordagem();
    if (pausa.pausada) {
      logger.warn(
        { motivo: pausa.motivo },
        "Follow-up parado: a abordagem está pausada por erro nosso. Nenhum toque sai enquanto isso",
      );
      return;
    }
    let toquesFriosNesteCiclo = 0;
    let reativacoesNesteCiclo = 0;
    let toquesDeConversaNesteCiclo = 0;
    // Contado no banco (não em memória) para o limite diário sobreviver a
    // restart — mesma decisão do agendador de abordagem. Preguiçoso: só
    // consulta quando uma reativação de fato vence neste ciclo.
    let reativacoesDeHoje: number | null = null;
    // O balde compartilhado do ritmo frio (Rodada 51) — também preguiçoso, e
    // atualizado em memória a cada envio frio DESTE ciclo, para o segundo
    // toque da mesma rodada já enxergar o primeiro.
    let ritmoFrio: RitmoFrio | null = null;
    const ritmoFrioAtual = async (): Promise<RitmoFrio> => {
      if (ritmoFrio === null) {
        ritmoFrio = contarEnvios(await datasDeEnviosFrios(now), now);
      }
      return ritmoFrio;
    };
    const contabilizarEnvioFrio = () => {
      if (ritmoFrio === null) return; // impossível: o envio passou pela checagem
      ritmoFrio.naUltimaHora++;
      ritmoFrio.hoje++;
      ritmoFrio.ultimo = now;
    };

    // O botão do painel (Etapa 4), lido no MÁXIMO uma vez por ciclo e só
    // quando um toque frio de fato vence — mesmo desenho preguiçoso do ritmo
    // acima. Uma consulta por toque vencido seria até 20 idas ao banco a cada
    // 5 minutos para responder a mesma pergunta; e guardar entre ciclos criaria
    // a janela em que a tela diz "pausada" e o toque ainda sai, que é
    // exatamente o que o botão existe para impedir.
    let ativoNoPainel: boolean | null = null;
    const ativoNoPainelAtual = async (): Promise<boolean> => {
      if (ativoNoPainel === null) ativoNoPainel = await outreachAtivoNoPainel();
      return ativoNoPainel;
    };

    // Find pending follow-ups that are due.
    //
    // EM ORDEM DE VENCIMENTO, e isso passou a importar em 22/08: com cota por
    // ciclo (`TOQUES_DE_CONVERSA_POR_CICLO`), "qual dos vencidos sai primeiro"
    // deixou de ser indiferente. Sem `ORDER BY` o Postgres devolve na ordem que
    // for mais barata para ele, e num represamento o mesmo toque atrasado
    // poderia perder a vez a cada rodada, indefinidamente, enquanto outros
    // passam na frente. Cota sem ordem não é cota: é sorteio.
    const due = await db
      .select({
        followUp: followUpsTable,
        lead: leadsTable,
      })
      .from(followUpsTable)
      .innerJoin(leadsTable, eq(followUpsTable.leadId, leadsTable.id))
      .where(
        and(
          eq(followUpsTable.status, "pending"),
          lte(followUpsTable.scheduledAt, now),
        ),
      )
      .orderBy(asc(followUpsTable.scheduledAt))
      .limit(20);

    /**
     * OS TOQUES QUE JÁ SAÍRAM para estes leads, por `chaveDoToque`.
     *
     * Existe porque a tabela TEM linhas duplicadas e vai continuar tendo. Até
     * 17/08/2026 o webhook não serializava por lead: duas respostas quase
     * simultâneas cancelavam a leva pendente e inseriam DUAS levas novas. A
     * trava de `lib/turno-do-lead.ts` conserta a PRODUÇÃO de duplicatas — ela
     * não apaga as que já estavam gravadas, e ninguém tinha feito essa segunda
     * pergunta.
     *
     * O estrago só apareceu em 22/08, quando a pausa de três dias caiu e a fila
     * represada saiu de uma vez: um lead recebeu a MESMA mensagem duas vezes,
     * com 11 segundos entre elas, porque as duas linhas venceram juntas e o
     * laço não tinha como saber que eram a mesma coisa. O sintoma chega ao dono
     * idêntico ao defeito de 17/08 — "a Júlia está repetindo mensagem" — e faz
     * duvidar da trava, que estava certa e no ar.
     *
     * ⚠️ A CHAVE SOZINHA NÃO BASTA, e a cerca pegou isto: (lead, kind, número)
     * se REPETE de leva em leva. Toda resposta do dentista cancela a leva
     * pendente e arma outra começando do toque 1 — então um lead que responde
     * depois de já ter recebido o toque 1 tem, legitimamente, um toque 1 novo
     * pendente e um toque 1 antigo `sent`. Cancelar por chave calaria justamente
     * quem voltou a falar, que é o oposto do que se quer. O mesmo vale para a
     * reativação, que é rearmada toda vez que uma cadência de conversa esgota.
     *
     * O que separa o gêmeo do rearme é o RELÓGIO: o toque de uma leva nova é
     * agendado DEPOIS de o anterior ter saído, e o gêmeo é agendado no mesmo
     * instante do irmão — ou seja, antes de ele sair. Então a condição é
     * `sentAt >= scheduledAt`: o irmão saiu quando esta linha já estava
     * vencida, e duas linhas vencidas para o mesmo lugar da cadência são a
     * mesma mensagem.
     *
     * `sentAt` nulo (linha anterior à coluna) não conclui nada e não cancela:
     * errar para o lado de mandar de novo custa uma mensagem; errar para o
     * outro cala uma conversa viva.
     *
     * Uma consulta por ciclo, só para os leads que têm toque vencido agora.
     */
    const enviadoEm = new Map<string, number>();
    if (due.length > 0) {
      const enviados = await db
        .select()
        .from(followUpsTable)
        .where(
          and(
            eq(followUpsTable.status, "sent"),
            inArray(followUpsTable.leadId, [
              ...new Set(due.map(({ lead }) => lead.id)),
            ]),
          ),
        );
      for (const f of enviados) {
        if (!f.sentAt) continue;
        const chave = chaveDoToque(f.leadId, f.kind, f.touchNumber);
        const quando = new Date(f.sentAt).getTime();
        const atual = enviadoEm.get(chave);
        if (atual === undefined || quando > atual) enviadoEm.set(chave, quando);
      }
    }

    /** Este toque já saiu, e saiu como GÊMEO desta linha (ver `enviadoEm`)? */
    const jaSaiuIgual = (chave: string, scheduledAt: Date | string): boolean => {
      const quando = enviadoEm.get(chave);
      return quando !== undefined && quando >= new Date(scheduledAt).getTime();
    };

    for (const { followUp, lead } of due) {
      // Skip if lead is closed/lost
      if (lead.status === "closed" || lead.status === "lost") {
        await db
          .update(followUpsTable)
          .set({ status: "cancelled" })
          .where(eq(followUpsTable.id, followUp.id));
        continue;
      }

      // ESTE TOQUE JÁ SAIU PARA ESTE LEAD (22/08/2026) — ver `jaSaiu`.
      //
      // CANCELADO, e não adiado. É a única coisa deste laço que cancela sem o
      // lead ter virado closed/lost, e a diferença é o que está sendo tratado:
      // todo o resto aqui adia porque o toque ainda TEM que sair um dia; duas
      // linhas para o mesmo lugar da cadência não são um toque atrasado, são um
      // toque a mais. Deixá-las pendentes só adia a mensagem repetida para a
      // rodada seguinte, e ela voltaria para sempre.
      //
      // Vem ANTES de qualquer trava de horário e de qualquer geração de texto:
      // uma linha duplicada não deve custar nem uma chamada de modelo.
      const chave = chaveDoToque(lead.id, followUp.kind, followUp.touchNumber);
      if (jaSaiuIgual(chave, followUp.scheduledAt)) {
        await db
          .update(followUpsTable)
          .set({ status: "cancelled" })
          .where(eq(followUpsTable.id, followUp.id));
        logger.warn(
          {
            leadId: lead.id,
            followUpId: followUp.id,
            kind: followUp.kind,
            touchNumber: followUp.touchNumber,
          },
          "Toque duplicado cancelado: este lead ja recebeu este toque desta cadencia",
        );
        continue;
      }

      // A COTA DO TOQUE DE CONVERSA (22/08/2026), pelo mesmo desenho do
      // `TOQUES_FRIOS_POR_CICLO`. Fica PENDING: a próxima rodada é daqui a 5
      // minutos, e perder o toque é pior que atrasá-lo — mesmo tratamento da
      // pausa humana, da madrugada e do toque frio fora da janela.
      //
      // Depois da deduplicação de propósito: linha duplicada tem que sumir
      // mesmo com a cota estourada, senão limpar o estoque de duplicatas
      // andaria a uma por rodada junto com os toques de verdade.
      if (
        followUp.kind === "conversa" &&
        toquesDeConversaNesteCiclo >= TOQUES_DE_CONVERSA_POR_CICLO
      ) {
        continue;
      }

      // O humano está conversando com este lead agora. Um follow-up caindo no
      // meio disso é a Júlia atravessando a conversa dele — pior do que o
      // follow-up atrasar.
      //
      // Fica "pending" de propósito, sem cancelar: o agendador roda a cada 5
      // minutos, então assim que a pausa vencer o toque sai na rodada
      // seguinte. Cancelar aqui perderia o follow-up para sempre por causa de
      // uma janela de 5 minutos.
      if (
        lead.pausedUntil &&
        new Date(lead.pausedUntil).getTime() > now.getTime()
      ) {
        logger.info(
          {
            leadId: lead.id,
            touchNumber: followUp.touchNumber,
            pausedUntil: lead.pausedUntil,
          },
          "Lead pausado (humano assumiu) — follow-up adiado, segue pendente",
        );
        continue;
      }

      // A MADRUGADA (18/08/2026). O toque de conversa não passava por janela
      // nenhuma — o lead 59 recebeu o toque 2 à 01:28 da manhã.
      //
      // Fica PENDING, não cancelado: é o mesmo tratamento da pausa humana logo
      // acima e do toque frio fora da janela, e pelo mesmo motivo — perder o
      // toque é pior que atrasá-lo. Assim que o horário abrir, ele sai na
      // rodada seguinte, com o texto que já estava gravado.
      //
      // Só as HORAS: o botão do painel e a cota são da prospecção, e quem já
      // conversa não responde a nenhum dos dois (ver foraDoHorarioDeConversa).
      if (followUp.kind === "conversa" && foraDoHorarioDeConversa(lerConfig(), now)) {
        logger.info(
          {
            leadId: lead.id,
            touchNumber: followUp.touchNumber,
            horaEmSP: momentoEmSaoPaulo(now).hora,
          },
          "Follow-up de conversa fora do horário — adiado, segue pendente",
        );
        continue;
      }

      // RODADA 36 — o toque 1 de conversa não sai por cima de pendência NOSSA.
      //
      // O caso real: a Júlia prometeu o contrato, ninguém mandou, e uma hora
      // depois o toque 1 chegou com "a gente começou a conversar e acabou
      // ficando pela metade". A conversa não ficou pela metade — ficou com uma
      // promessa dela em aberto. Do lado do dentista, o toque soa como ela
      // ignorando o que ele pediu.
      //
      // Por isso, antes do toque 1: se o lead já está marcado para atenção
      // (central de vigia, Rodada 33), ou se a ÚLTIMA mensagem da conversa é
      // nossa e contém uma promessa ("vou pedir pra", "deixa eu confirmar"...),
      // o toque é CANCELADO — não adiado — e o lead vai para a central. É caso
      // de gente entregar o prometido, não de robô puxar assunto. Os toques
      // seguintes (24h em diante) ficam: se ninguém resolveu até lá, silêncio
      // eterno seria pior.
      if (followUp.kind === "conversa" && followUp.touchNumber === 1) {
        let motivo: string | null = null;

        if (lead.atencao) {
          motivo = `lead já marcado para atenção (${lead.atencao})`;
        } else {
          const ultima = (
            await db
              .select()
              .from(leadMessagesTable)
              .where(eq(leadMessagesTable.leadId, lead.id))
              .orderBy(desc(leadMessagesTable.createdAt))
              .limit(1)
          )[0];
          const promessa =
            ultima && ultima.direction === "outbound"
              ? pareceMensagemComPromessa(ultima.content)
              : null;
          if (promessa) {
            motivo = `última mensagem é nossa e promete algo ("${promessa}")`;
            await marcarAtencao(lead, "julia_estranha", ultima.content);
          }
        }

        if (motivo) {
          await db
            .update(followUpsTable)
            .set({ status: "cancelled" })
            .where(eq(followUpsTable.id, followUp.id));
          logger.info(
            { leadId: lead.id, touchNumber: followUp.touchNumber, motivo },
            "Toque 1 suprimido: promessa pendente é caso de gente, não de robô",
          );
          continue;
        }
      }

      // TOQUE DE REATIVAÇÃO (Rodada 41): a fila longa, +30/+60/+90 dias depois
      // do fim da cadência de conversa. O texto é montado AQUI, na hora do
      // envio, porque a dor anotada e a novidade configurada 60 dias atrás
      // podem não ser as de hoje.
      const ehReativacao = followUp.kind === "reativacao";
      let mensagemDeReativacao: string | null = null;
      if (ehReativacao) {
        if (reativacoesNesteCiclo >= REATIVACOES_POR_CICLO) continue;

        // Mesma janela, dias úteis, trava mestra, BOTÃO DO PAINEL e cota da
        // prospecção. Fora dela o toque ADIA (segue pendente) — inclusive com
        // OUTREACH_ENABLED desligado ou a abordagem pausada no painel: é a
        // mesma trava de emergência, e emergência para a fila sem destruí-la.
        const janela = toqueFrioPodeSair(
          now,
          await ritmoFrioAtual(),
          await ativoNoPainelAtual(),
        );
        if (!janela.pode) {
          logger.debug(
            { leadId: lead.id, touchNumber: followUp.touchNumber, motivo: janela.motivo },
            `Reativação adiada: ${
              EXPLICACAO_BLOQUEIO[janela.motivo as keyof typeof EXPLICACAO_BLOQUEIO] ??
              janela.motivo
            }`,
          );
          continue;
        }

        if (reativacoesDeHoje === null) {
          const enviadas = await db
            .select()
            .from(followUpsTable)
            .where(
              and(
                eq(followUpsTable.kind, "reativacao"),
                eq(followUpsTable.status, "sent"),
              ),
            );
          reativacoesDeHoje = contarReativacoesDeHoje(
            enviadas.map((f) => f.sentAt),
            now,
          );
        }
        if (reativacoesDeHoje >= LIMITE_REATIVACOES_POR_DIA) {
          logger.info(
            { leadId: lead.id, hoje: reativacoesDeHoje },
            "Limite diário de reativações atingido — fica para amanhã",
          );
          continue;
        }

        // Em 30+ dias muita coisa muda: virou cliente, pediu para parar, caiu
        // na vigia, ou é o toque 2 sem novidade configurada. Nesses casos o
        // toque MORRE (cancelled) — quem saiu da elegibilidade não volta a ela
        // esperando o próximo ciclo.
        const decisao = decidirToqueDeReativacao(
          followUp.touchNumber,
          lead,
          lerNovidade(),
        );
        if (!decisao.envia) {
          if (decisao.cancela) {
            await db
              .update(followUpsTable)
              .set({ status: "cancelled" })
              .where(eq(followUpsTable.id, followUp.id));
          }
          logger.info(
            { leadId: lead.id, touchNumber: followUp.touchNumber, motivo: decisao.motivo },
            "Toque de reativação não sai",
          );
          continue;
        }

        mensagemDeReativacao =
          followUp.touchNumber === 1
            ? TOQUES_REATIVACAO[1](lead.name, lead.painPoints)
            : followUp.touchNumber === 2
              ? TOQUES_REATIVACAO[2](lead.name, lerNovidade())
              : TOQUES_REATIVACAO[3](lead.name);
      }

      // Toque de ABORDAGEM: mensagem fria, para quem nunca respondeu. Só sai na
      // janela da prospecção, com a trava mestra ligada E com a abordagem ativa
      // no painel; fora disso continua "pending" e sai na primeira rodada
      // liberada — mesmo tratamento da pausa humana logo acima, e pelo mesmo
      // motivo (perder o toque é pior que atrasá-lo).
      const ehAbordagem = followUp.kind === "abordagem";
      let mensagemDeToqueFrio: string | null = null;
      if (ehAbordagem) {
        if (toquesFriosNesteCiclo >= TOQUES_FRIOS_POR_CICLO) continue;

        const janela = toqueFrioPodeSair(
          now,
          await ritmoFrioAtual(),
          await ativoNoPainelAtual(),
        );
        if (!janela.pode) {
          logger.debug(
            { leadId: lead.id, touchNumber: followUp.touchNumber, motivo: janela.motivo },
            `Toque de abordagem adiado: ${
              EXPLICACAO_BLOQUEIO[janela.motivo as keyof typeof EXPLICACAO_BLOQUEIO] ??
              janela.motivo
            }`,
          );
          continue;
        }

        // O TEXTO NASCE AQUI (19/08/2026), como o da reativação. Até então os
        // dois toques eram frase fixa, igual para todo dentista, e a segunda
        // ainda levava o link do site — o maior sinal de robô que sobrava
        // depois de baixar o volume. O porquê inteiro está em
        // `JULIA_TOQUE_PROMPT` (julia-persona.ts).
        //
        // O modelo precisa ver O QUE JÁ MANDAMOS, senão "não repita a frase
        // anterior" é uma instrução que ninguém tem como cumprir. São no
        // máximo duas mensagens (a abertura e o toque 1), porque quem chega
        // aqui nunca respondeu nada.
        const jaEnviadas = (
          await db
            .select()
            .from(leadMessagesTable)
            .where(eq(leadMessagesTable.leadId, lead.id))
            .orderBy(asc(leadMessagesTable.createdAt))
        )
          .filter((m) => m.direction === "outbound")
          .map((m) => m.content);

        const dias = lead.outreachSentAt
          ? Math.max(
              0,
              Math.round(
                (now.getTime() - new Date(lead.outreachSentAt).getTime()) /
                  (24 * 60 * 60 * 1000),
              ),
            )
          : null;

        try {
          mensagemDeToqueFrio = await gerarMensagemDeToque(
            lead,
            followUp.touchNumber >= 2 ? 2 : 1,
            jaEnviadas,
            dias,
            now,
          );
        } catch (err) {
          logger.error(
            { err, leadId: lead.id, touchNumber: followUp.touchNumber },
            "Falha ao gerar o toque de abordagem — segue pendente",
          );
          continue;
        }

        // Falhou de gerar: o toque fica PENDING e a próxima rodada (5 min)
        // tenta de novo, mesmo tratamento de todo o resto deste laço. Não
        // existe texto de reserva de propósito — um fallback fixo aqui seria a
        // porta dos fundos por onde a frase idêntica voltaria, e ela voltaria
        // justamente no dia em que a OpenAI estivesse instável, ou seja, para
        // vários leads de uma vez.
        //
        // E NÃO conta contra o lead: erro nosso não gasta a chance dele.
        if (!mensagemDeToqueFrio) {
          logger.error(
            { leadId: lead.id, touchNumber: followUp.touchNumber },
            "Toque de abordagem veio vazio do modelo — segue pendente",
          );
          continue;
        }
      }

      // O TOQUE DE CONVERSA TAMBÉM NASCE DO MODELO (22/08/2026).
      //
      // Era o último texto congelado que restava: os quatro
      // `FOLLOW_UP_TEMPLATES` eram gravados em `message_template` no instante
      // em que a leva era armada e saíam dias depois exatamente iguais — a
      // mesma sentença para todo dentista, e com a saudação do dia do
      // armamento em vez da do relógio de hoje.
      const ehConversa = followUp.kind === "conversa";
      let mensagemDeConversa: string | null = null;
      if (ehConversa) {
        // O PAPEL do toque, que NÃO é o número dele.
        //
        // O último toque de qualquer cadência é a despedida: numa cadência de
        // dois, prometer "essa é minha última mensagem" e nunca mandá-la
        // deixaria a porta entreaberta para sempre, e mandar um toque do meio
        // como final quebraria a promessa ao contrário. Quem decide isso é o
        // webhook, na hora de armar (`idx === cadencia.length - 1`) — mas o
        // TAMANHO da cadência não fica gravado em lugar nenhum, então aqui se
        // descobre pela fila: é o último se não sobrou nenhum depois dele.
        const pendentesDaLeva = await db
          .select()
          .from(followUpsTable)
          .where(
            and(
              eq(followUpsTable.leadId, lead.id),
              eq(followUpsTable.kind, "conversa"),
              eq(followUpsTable.status, "pending"),
            ),
          );
        const ehUltimo = !pendentesDaLeva.some(
          (f) => f.touchNumber > followUp.touchNumber,
        );
        const papel = (ehUltimo ? 4 : Math.min(followUp.touchNumber, 3)) as
          | 1
          | 2
          | 3
          | 4;

        const mensagens = await db
          .select()
          .from(leadMessagesTable)
          .where(eq(leadMessagesTable.leadId, lead.id))
          .orderBy(asc(leadMessagesTable.createdAt));

        // A conversa ANDOU? Conta as mensagens DELE, não o total: as respostas
        // da Júlia inflariam o número e fariam toda conversa parecer profunda.
        // Mesma conta do webhook, que é onde esta distinção nasceu (Rodada 53)
        // — e é ela que decide entre "ficou pela metade" e "a gente conversou
        // bastante", que era o defeito de escolher o texto pelo índice.
        const profunda = conversaFoiProfunda(
          mensagens.filter((m) => m.direction === "inbound").length,
        );
        const jaEnviadas = mensagens
          .filter((m) => m.direction === "outbound")
          .map((m) => m.content);

        try {
          mensagemDeConversa = await gerarMensagemDeToqueDeConversa(
            {
              name: lead.name,
              clinicName: lead.clinicName,
              painPoints: lead.painPoints,
            },
            papel,
            profunda,
            jaEnviadas,
            now,
          );
        } catch (err) {
          // Ao contrário do toque frio, aqui NÃO se adia: cai no texto gravado
          // logo abaixo. É a diferença de quem está do outro lado — o frio não
          // pediu nada e pode esperar o próximo ciclo; este respondeu, e o
          // silêncio depois de uma conversa custa mais que uma frase repetida.
          logger.error(
            { err, leadId: lead.id, touchNumber: followUp.touchNumber, papel },
            "Falha ao gerar o toque de conversa — cai no texto gravado",
          );
        }
      }

      // A ORDEM É A DECISÃO. Texto gerado na hora vence texto gravado, sempre.
      //
      // Para a ABORDAGEM isso vale desde 19/08/2026, e para a CONVERSA desde
      // 22/08: as linhas armadas antes dessas datas ainda carregam a frase fixa
      // antiga no banco (com o link no fim), e respeitá-la faria os toques já
      // agendados saírem com exatamente o texto que estas mudanças existem para
      // eliminar. O `messageTemplate` sobrou como o que ele sempre deveria ter
      // sido: o que sai quando o modelo falha, e não o normal.
      //
      // ⚠️ Ele é uma porta dos fundos conhecida — se a OpenAI cair, a frase
      // idêntica volta para vários leads de uma vez, que é exatamente o cenário
      // que o toque frio recusou ter (lá não há rede: ou nasce do modelo, ou
      // não sai). Aqui a rede ficou porque quem recebe já conversou, e deixá-lo
      // no silêncio é pior. É uma escolha, não um esquecimento.
      //
      // A última linha é a rede da rede: só cai nela um follow-up de conversa
      // criado sem template nenhum. Tom igual ao dos templates — curto, com o
      // mesmo `saudacao()` dos demais, sem prometer nada.
      const message =
        mensagemDeReativacao ??
        mensagemDeToqueFrio ??
        mensagemDeConversa ??
        followUp.messageTemplate ??
        `${saudacao(lead.name)}aqui é a Júlia do CaptaClin 😊 Passando pra saber se o WhatsApp da sua clínica ainda te incomoda. Se quiser dar uma olhada por conta: https://www.captaclin.com.br`;

      const envio = await enviarWhatsAppComDiagnostico(lead.phone, message);

      // Se não entregou, NÃO grava no histórico e NÃO marca como enviado: o
      // follow-up fica "pending" e a próxima rodada (5 min) tenta de novo.
      // Sem isso, o painel mostraria um toque que o dentista nunca recebeu.
      //
      // Falha PERMANENTE (a Evolution rejeitou o número) conta para desistir
      // (Rodada 51): na terceira, lib/nao-entregavel.ts cancela TODOS os
      // pendentes deste lead — este toque incluso — e avisa o Telegram. Vale
      // para qualquer cadência: se o número não recebe, adiar não conserta.
      if (!envio.entregue) {
        // Mesma rajada da abordagem, e de propósito o MESMO contador: os dois
        // agendadores saem pelo mesmo número de WhatsApp, então uma restrição
        // atinge os dois. Contadores separados precisariam de três leads em
        // CADA um para concluir a mesma coisa, e dobrariam o estrago.
        const rajada = registrarFalhaDeEnvio(lead.id);

        // Bloqueio nosso não conta tentativa contra o lead. Aqui a conta é
        // ainda mais cara que na abordagem: ao desistir, TODOS os follow-ups
        // pendentes deste lead são cancelados — inclusive os de uma conversa
        // viva, que a restrição do WhatsApp nem sequer impede de continuar.
        if (envio.falhaPermanente && !envio.bloqueioNosso) {
          const { desistiu } = await registrarFalhaPermanente(
            lead,
            `toque de ${followUp.kind}`,
          );
          if (desistiu) continue;
        }

        if (rajada.deveParar) {
          await pausarAbordagem(
            motivoDaPausa(
              rajada.leadsSeguidos,
              envio.bloqueioNosso
                ? "a Evolution recusou o envio pelo NOSSO lado"
                : "envio recusado",
            ),
            now,
          );
          return;
        }

        logger.error(
          { leadId: lead.id, touchNumber: followUp.touchNumber, bloqueioNosso: envio.bloqueioNosso },
          "Follow-up NÃO entregue — segue pendente para nova tentativa",
        );
        continue;
      }

      // Entregou: zera a contagem de falhas permanentes, que precisa ser de
      // falhas SEGUIDAS para condenar um número (só escreve se havia o quê).
      await limparFalhasDeEnvio(lead);
      // Entregou: o caminho esta aberto, a rajada morre aqui.
      registrarEnvioEntregue();

      // Save outbound follow-up message
      await db.insert(leadMessagesTable).values({
        leadId: lead.id,
        direction: "outbound",
        content: message,
        messageType: "text",
      });

      // Mark as sent. O carimbo de quando saiu alimenta o limite diário da
      // reativação e o balde do ritmo frio (lib/ritmo-frio.ts) — é o `now` do
      // ciclo, o mesmo relógio das decisões, para a contagem ser reproduzível.
      await db
        .update(followUpsTable)
        .set({ status: "sent", sentAt: now })
        .where(eq(followUpsTable.id, followUp.id));

      // A partir daqui este toque existe para o resto do ciclo. É o que faz a
      // deduplicação pegar o gêmeo que está no MESMO lote de vencidos — o caso
      // real de 22/08, e o único que a consulta do `enviadoEm` não podia ter
      // visto, porque quando ela rodou nenhum dos dois tinha saído ainda.
      //
      // Carimba com `now`, o mesmo relógio gravado em `sentAt` logo acima: é o
      // que faz a comparação com o `scheduledAt` do gêmeo dar o mesmo veredito
      // que daria no ciclo seguinte, lendo do banco.
      enviadoEm.set(chave, now.getTime());

      if (ehReativacao) {
        reativacoesNesteCiclo++;
        if (reativacoesDeHoje !== null) reativacoesDeHoje++;
        contabilizarEnvioFrio();
      }

      // FIM DA CADÊNCIA DE CONVERSA → arma a fila longa (Rodada 41).
      //
      // O gatilho é o último toque de conversa sair sem sobrar nada pendente —
      // não um número fixo de toque, porque a cadência tem tamanho variável
      // (2 a 4 toques, conforme a temperatura). Se o dentista responder
      // qualquer coisa depois, o webhook cancela esta fila junto com todo
      // pendente e arma uma cadência de conversa nova — e quando ELA acabar,
      // a reativação é rearmada daqui, contando do zero.
      if (followUp.kind === "conversa") {
        toquesDeConversaNesteCiclo++;

        const restantes = await db
          .select()
          .from(followUpsTable)
          .where(
            and(
              eq(followUpsTable.leadId, lead.id),
              eq(followUpsTable.status, "pending"),
            ),
          );
        if (restantes.length === 0) {
          const { elegivel, motivo } = elegivelParaReativacao(lead);
          if (elegivel) {
            await db.insert(followUpsTable).values(
              REATIVACAO_DELAYS_DIAS.map((dias, i) => ({
                leadId: lead.id,
                scheduledAt: new Date(now.getTime() + dias * 24 * 60 * 60 * 1000),
                touchNumber: i + 1,
                kind: "reativacao" as const,
                // Sem template de propósito: o texto nasce na hora do envio,
                // com a dor e a novidade daquele dia.
                messageTemplate: null,
                status: "pending" as const,
              })),
            );
            logger.info(
              { leadId: lead.id, dias: REATIVACAO_DELAYS_DIAS },
              "Cadência de conversa esgotada — lead entrou na fila de reativação",
            );
          } else if (motivo) {
            logger.info(
              { leadId: lead.id, motivo },
              `Fim da cadência sem reativação: ${EXPLICACAO_FORA[motivo]}`,
            );
          }
        }
      }

      if (ehAbordagem) {
        toquesFriosNesteCiclo++;
        contabilizarEnvioFrio();

        // Último toque da cadência: acabou, e para sempre. Marcar o lead aqui,
        // em vez de deduzir depois "não tem follow-up pendente", é o que dá ao
        // painel a diferença entre "abordado, ainda pode responder" e "os dois
        // toques saíram, ele nunca respondeu, não procure mais".
        if (followUp.touchNumber >= ABORDAGEM_DELAYS_HOURS.length) {
          await db
            .update(leadsTable)
            .set({ outreachStatus: "nao_respondeu", updatedAt: new Date() })
            .where(eq(leadsTable.id, lead.id));
          logger.info(
            { leadId: lead.id },
            "Cadência de abordagem esgotada sem resposta — silêncio permanente",
          );
        }
      }

      logger.info(
        { leadId: lead.id, touchNumber: followUp.touchNumber, kind: followUp.kind },
        "Follow-up sent",
      );
    }
  } catch (err) {
    logger.error({ err }, "Follow-up scheduler error");
  }
}

/**
 * Uma passada do agendador: os follow-ups vencidos e, na sequência, a vigia de
 * conversas sem resposta (gatilho 4 da central).
 *
 * Pega carona neste agendador em vez de criar outro `setInterval`: a cadência de
 * 5 minutos é a mesma que o gatilho precisa, e um timer só é um lugar só para
 * olhar quando algo não roda. A vigia vem DEPOIS dos follow-ups e num try
 * próprio — se ela falhar, os follow-ups já saíram.
 */
async function rodarCiclo(): Promise<void> {
  await rodarCicloDeFollowUp();
  try {
    await verificarSemResposta();
  } catch (err) {
    logger.error({ err }, "Vigia de sem-resposta falhou");
  }
}

export function startFollowUpScheduler(): void {
  // Run every 5 minutes
  const INTERVAL_MS = 5 * 60 * 1000;

  // Run immediately then on interval
  rodarCiclo();
  setInterval(rodarCiclo, INTERVAL_MS);
  logger.info("Follow-up scheduler started");
}
