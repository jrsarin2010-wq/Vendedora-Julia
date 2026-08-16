import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const funnelStageEnum = pgEnum("funnel_stage", [
  "new",
  "contacted",
  "qualified",
  "interested",
  "objection",
  "closing",
  "closed",
  "lost",
]);

export const leadStatusEnum = pgEnum("lead_status", [
  "hot",
  "warm",
  "cold",
  "closed",
  "lost",
]);

export const planInterestEnum = pgEnum("plan_interest", [
  "basic",
  "essencial",
  "pro",
]);

/**
 * Situação do lead na PROSPECÇÃO ATIVA (quando é a Júlia que puxa conversa).
 * Nada a ver com o funil de venda: um lead pode estar "sent" aqui e ainda
 * assim em qualquer etapa do funil, conforme o que ele responder.
 */
export const outreachStatusEnum = pgEnum("outreach_status", [
  "none", // não é lead de prospecção — chegou sozinho pelo WhatsApp
  "pending", // importado, esperando a primeira mensagem
  "sent", // primeira mensagem enviada
  "skipped", // descartado (telefone inválido, duplicado, opt-out prévio)
  // Recebeu a abordagem e os dois toques da cadência, e não respondeu nenhum.
  // Daqui não sai mais nada: silêncio permanente.
  //
  // O nome é "nao_respondeu", e não "sem_resposta", para não colidir com o
  // motivo de atenção `sem_resposta` (lib/atencao.ts), que significa quase o
  // OPOSTO: lá é o dentista que falou e ficou sem resposta NOSSA.
  "nao_respondeu",
  // A Evolution rejeitou o número três vezes seguidas (sem WhatsApp, fixo,
  // digitado errado). Sem este estado, o lead mais antigo da fila com número
  // morto era escolhido de novo a CADA ciclo — nenhum outro lead recebia nada
  // e cada tentativa gastava uma chamada de modelo. Ver lib/nao-entregavel.ts.
  "nao_entregavel",
]);

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  name: text("name"),
  phone: text("phone").notNull().unique(),
  // "whatsapp" (chegou sozinho), "site" (clicou no botão da landing),
  // "import", "maps", "instagram"
  origin: text("origin"),
  // O assunto da PRIMEIRA dúvida de quem veio da landing ("recarga de
  // conversas", "contrato e fidelidade"). Gravado uma única vez, porque é a
  // dúvida que fez ele clicar — as seguintes já nasceram da conversa.
  //
  // Não serve para vender: serve para consertar a página. Cada assunto que se
  // repete é um buraco na landing, com número em vez de palpite. Ver
  // api-server/src/lib/duvidas-do-site.ts.
  duvidaDoSite: text("duvida_do_site"),
  // Dados da clínica, preenchidos na importação para a Júlia ter o que dizer
  // na primeira mensagem ("vi a Odonto Vida no Instagram").
  clinicName: text("clinic_name"),
  instagram: text("instagram"),
  city: text("city"),
  // Reputação no Google, copiada da ficha do Maps na promoção (Etapa 3C). Só
  // existe para leads que vieram da varredura: quem chegou por planilha ou pelo
  // WhatsApp nasce com os dois nulos, e nulo aqui significa "não sabemos", nunca
  // "é ruim".
  //
  // Mesmo tipo de clinicas_prospect.nota — `numeric` volta como STRING no
  // driver, e quem for comparar precisa converter antes. É a razão de
  // buildOutreachBriefing aceitar string | number.
  //
  // A trava de quando isso pode ser DITO na abertura mora em julia-persona.ts,
  // não aqui: a coluna guarda o fato, o prompt decide se o fato é citável.
  nota: numeric("nota", { precision: 2, scale: 1 }),
  totalAvaliacoes: integer("total_avaliacoes"),
  outreachStatus: outreachStatusEnum("outreach_status").notNull().default("none"),
  outreachSentAt: timestamp("outreach_sent_at"),
  // Falhas PERMANENTES de envio seguidas (a Evolution rejeitou o destinatário
  // — HTTP 400). Só conta o que repetir não conserta: queda ou timeout da
  // Evolution não incrementa, senão uma hora fora do ar condenaria leads bons.
  // Zera no primeiro envio entregue; ao chegar em MAX_FALHAS_DE_ENVIO
  // (lib/nao-entregavel.ts) o lead vira "nao_entregavel" e sai da fila.
  falhasDeEnvio: integer("falhas_de_envio").notNull().default(0),
  funnelStage: funnelStageEnum("funnel_stage").notNull().default("new"),
  painPoints: text("pain_points"),
  mainObjection: text("main_objection"),
  planInterest: planInterestEnum("plan_interest"),
  status: leadStatusEnum("status").notNull().default("cold"),
  // TEMPERATURA POR SINAL (Rodada 41). A pontuação acumulada da conversa —
  // pediu link vale 30, perguntou preço 15, respondeu qualquer coisa 3. As
  // faixas (frio/morno/quente/fervendo) e a tabela de pontos moram em
  // api-server/src/lib/temperatura.ts. O `status` acima vira DERIVADO disto
  // para hot/warm/cold; "closed" e "lost" continuam terminais.
  temperatura: integer("temperatura").notNull().default(0),
  // Os sinais que JÁ pontuaram nesta conversa ("perguntou_preco,contou_a_dor"),
  // para o mesmo sinal não somar duas vezes. Mesmo formato do demosEnviadas.
  sinaisVistos: text("sinais_vistos"),
  notes: text("notes"),
  // Áudios de demonstração já enviados a este lead, separados por vírgula
  // ("vou_pensar,fora_do_horario"). É o que impede repetir a mesma demo, que
  // destruiria o efeito, e passar do teto de duas por conversa.
  demosEnviadas: text("demos_enviadas"),
  lastMessageAt: timestamp("last_message_at"),
  // Até quando a Júlia fica calada nesta conversa porque um humano assumiu.
  // Preenchido quando chega uma mensagem `fromMe` que NÃO fomos nós que
  // enviamos — ou seja, alguém respondeu pelo celular. Nulo (ou no passado)
  // significa conversa normal.
  pausedUntil: timestamp("paused_until"),
  handoffRequested: boolean("handoff_requested").notNull().default(false),
  // CENTRAL DE VIGIA: por que esta conversa precisa de uma pessoa agora.
  // Um de "pediu_pessoa" | "irritado" | "julia_estranha" | "sem_resposta", ou
  // null quando não precisa (ou quando já foi resolvido). Quando dois gatilhos
  // batem no mesmo lead, prevalece o mais grave — a ordem está em
  // api-server/src/lib/atencao.ts, que é quem escreve aqui.
  atencao: text("atencao"),
  atencaoDesde: timestamp("atencao_desde"),
  // O trecho que disparou, para o painel explicar o motivo sem obrigar a abrir
  // a conversa inteira.
  atencaoDetalhe: text("atencao_detalhe"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertLeadSchema = createInsertSchema(leadsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
