import {
  pgTable,
  serial,
  text,
  char,
  integer,
  numeric,
  boolean,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { apifyVarredurasTable } from "./apify-varreduras";
import { leadsTable } from "./leads";

/**
 * Ciclo de vida da clínica captada no Maps, ANTES de virar lead:
 *
 *   novo
 *    ├─ sem telefone no Maps            → sem_telefone      [fim]
 *    ├─ normalizarTelefone() rejeitou   → telefone_invalido [fim]
 *    └─ normalizado
 *        └─ verificação em lote na Evolution
 *            ├─ não existe → sem_whatsapp [fim]
 *            └─ existe     → apto → na_fila → promovido (grava leadId)
 *                                          └─ ja_existente [fim]
 *
 * "telefone_invalido" é separado de "sem_telefone" de propósito: um mede a
 * cobertura do dado do Maps, o outro a qualidade — e só o segundo diz se a
 * normalização está rejeitando demais.
 *
 * "ja_existente" marca quem o leads-import recusou por já estar na base. É o
 * número que diz se ainda vale raspar aquela cidade.
 *
 * Nada entra na fila da Júlia com `temWhatsapp` nulo: disparo para número
 * morto gasta rate limit e piora a reputação do número.
 */
export const prospeccaoStatusEnum = pgEnum("prospeccao_status", [
  "novo",
  "sem_telefone",
  "telefone_invalido",
  "sem_whatsapp",
  "apto",
  "na_fila",
  "promovido",
  "ja_existente",
  "descartado",
]);

/**
 * CLÍNICAS CAPTADAS PELA VARREDURA — a antessala da tabela `leads`.
 *
 * O `placeId` UNIQUE faz a deduplicação sozinho: a mesma clínica aparece em
 * "dentista" e em "clínica odontológica", e o segundo insert morre no
 * ON CONFLICT DO NOTHING.
 */
export const clinicasProspectTable = pgTable(
  "clinicas_prospect",
  {
    id: serial("id").primaryKey(),
    placeId: text("place_id").notNull().unique(),
    nome: text("nome").notNull(),
    // Como veio do Maps, intocado — se a normalização rejeitar, é daqui que se
    // descobre por quê.
    telefoneRaw: text("telefone_raw"),
    // Dígitos com 55, SEM "+" — o MESMO formato de leads.phone, preenchido por
    // normalizarTelefone() (api-server/src/lib/filtro-spam.ts). É o que faz a
    // checagem "já conversou com a Júlia?" ser um join direto. E.164 literal
    // obrigaria a tirar o "+" em toda comparação.
    telefoneWhatsapp: text("telefone_whatsapp"),
    // NULL = ainda não verificado. Nunca entra na fila assim.
    temWhatsapp: boolean("tem_whatsapp"),
    verificadoWhatsappEm: timestamp("verificado_whatsapp_em"),
    website: text("website"),
    instagram: text("instagram"),
    endereco: text("endereco"),
    cidade: text("cidade"),
    uf: char("uf", { length: 2 }),
    cep: text("cep"),
    categoria: text("categoria"),
    // O Maps ancora a busca num ponto e varre o entorno: os 5 resultados da
    // calibração saíram todos do extremo sul de São Paulo. Sem esta coluna,
    // essa concentração fica invisível e a gente acha que varreu "a capital"
    // quando varreu um punhado de bairros. É o dado que torna a distorção
    // mensurável — e que vai dizer se a Onda 2 precisa buscar por bairro.
    bairro: text("bairro"),
    // `claimThisBusiness: true` no Maps significa que NINGUÉM assumiu a ficha
    // do Google. Guardamos invertido, como pergunta positiva: ficha assumida
    // por alguém é sinal de clínica que cuida da presença digital.
    //
    // Nulo quando o ator não informou: "não sei" não pode virar "não tem".
    perfilReivindicado: boolean("perfil_reivindicado"),
    nota: numeric("nota", { precision: 2, scale: 1 }),
    // Sinal de clínica ativa: zero avaliações costuma ser cadastro morto.
    totalAvaliacoes: integer("total_avaliacoes"),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    // Rastreabilidade da origem. SEM cascade, de propósito: apagar uma
    // varredura não pode levar junto as clínicas que ela captou.
    varreduraId: integer("varredura_id").references(
      () => apifyVarredurasTable.id,
    ),
    // Preenchido na promoção (status "promovido"). "set null", e NÃO cascade,
    // de propósito: se o lead for apagado, o prospect sobrevive como registro
    // histórico — e o place_id UNIQUE dele continua impedindo que a próxima
    // varredura da mesma cidade recapture e RE-PROSPECTE quem foi deletado.
    // Com cascade, apagar um lead reabriria a porta da abordagem fria.
    leadId: integer("lead_id").references(() => leadsTable.id, {
      onDelete: "set null",
    }),
    statusProspeccao: prospeccaoStatusEnum("status_prospeccao")
      .notNull()
      .default("novo"),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    // Sem trigger, como no resto do repo: quem der UPDATE grava a mão.
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => [
    index("idx_clinicas_status").on(t.statusProspeccao),
    index("idx_clinicas_tel").on(t.telefoneWhatsapp),
    index("idx_clinicas_uf").on(t.uf, t.cidade),
  ],
);

export const insertClinicaProspectSchema = createInsertSchema(
  clinicasProspectTable,
).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});
export type InsertClinicaProspect = z.infer<typeof insertClinicaProspectSchema>;
export type ClinicaProspect = typeof clinicasProspectTable.$inferSelect;
