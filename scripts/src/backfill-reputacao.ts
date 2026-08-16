/**
 * BACKFILL DA REPUTAÇÃO DO GOOGLE nos leads já promovidos.
 *
 * As colunas `leads.nota` e `leads.total_avaliacoes` nasceram DEPOIS da Etapa
 * 3C, então todo lead promovido antes delas tem as duas nulas — e a ficha da
 * abordagem, que só cita reputação alta com volume, não tem o que citar. Este
 * script copia o que já está em `clinicas_prospect`, pelo `lead_id` que a
 * própria promoção gravou.
 *
 * É de uso ÚNICO por natureza: promoção nova já copia os dois campos
 * (routes/prospects-promover.ts). Fica versionado porque é escrita manual em
 * dado de produção, e escrita manual sem código revisável é como se perde a
 * conta do que foi mexido.
 *
 * TRÊS TRAVAS, e nenhuma delas é opcional:
 *
 * 1. DRY-RUN É O PADRÃO. Sem `--aplicar` nada é escrito. A lista sai igual nos
 *    dois modos, então o que você lê no ensaio é exatamente o que vai acontecer.
 *
 * 2. NUNCA SOBRESCREVE. Só preenche onde o lead tem NULL. Um lead que já tenha
 *    nota — porque foi promovido depois da mudança — não é tocado, e rodar duas
 *    vezes não faz nada na segunda.
 *
 * 3. SÓ `promovido`. Prospect com status `ja_existente` também carrega um
 *    `lead_id`, mas aquele lead veio de outro lugar (planilha, WhatsApp) e pode
 *    até ser um opt-out. Copiar reputação para ele misturaria a procedência do
 *    dado sem ninguém ter pedido.
 *
 * USO:
 *   DATABASE_URL=... pnpm --filter @workspace/scripts exec tsx src/backfill-reputacao.ts
 *   DATABASE_URL=... pnpm --filter @workspace/scripts exec tsx src/backfill-reputacao.ts --cidade=Fortaleza
 *   DATABASE_URL=... pnpm --filter @workspace/scripts exec tsx src/backfill-reputacao.ts --cidade=Fortaleza --aplicar
 */
import { db, pool, leadsTable, clinicasProspectTable } from "@workspace/db";
import { and, eq, ilike, isNull, isNotNull } from "drizzle-orm";

const argv = process.argv.slice(2);
const aplicar = argv.includes("--aplicar");
const cidadeArg = argv.find((a) => a.startsWith("--cidade="));
const cidade = cidadeArg ? cidadeArg.slice("--cidade=".length).trim() : null;

async function main(): Promise<void> {
  const condicoes = [
    eq(clinicasProspectTable.statusProspeccao, "promovido"),
    isNotNull(clinicasProspectTable.leadId),
    // Sem dado na origem não há backfill a fazer. Filtrar aqui, e não depois,
    // mantém a contagem do relatório honesta: o que aparece na lista é o que
    // seria escrito.
    isNotNull(clinicasProspectTable.nota),
    isNotNull(clinicasProspectTable.totalAvaliacoes),
    // Trava 2: só quem está sem os dados hoje.
    isNull(leadsTable.nota),
    isNull(leadsTable.totalAvaliacoes),
  ];
  // O filtro é pela cidade do LEAD, que é a que a ficha da abordagem usa —
  // `clinicas_prospect.cidade` é a de captação, e as duas podem divergir se
  // alguém tiver corrigido o lead à mão.
  if (cidade) condicoes.push(ilike(leadsTable.city, `%${cidade}%`));

  const alvos = await db
    .select({
      leadId: leadsTable.id,
      clinica: leadsTable.clinicName,
      cidadeLead: leadsTable.city,
      prospectId: clinicasProspectTable.id,
      nota: clinicasProspectTable.nota,
      totalAvaliacoes: clinicasProspectTable.totalAvaliacoes,
    })
    .from(clinicasProspectTable)
    .innerJoin(leadsTable, eq(clinicasProspectTable.leadId, leadsTable.id))
    .where(and(...condicoes))
    .orderBy(leadsTable.id);

  const escopo = cidade ? `cidade ~ "${cidade}"` : "todas as cidades";
  console.log(
    `\n${aplicar ? "APLICANDO" : "ENSAIO (nada será escrito)"} — ${escopo}`,
  );
  console.log(`${alvos.length} lead(s) a preencher.\n`);

  if (alvos.length === 0) {
    console.log("Nada a fazer.");
    return;
  }

  // A trava da ficha (nota >= 4.5 E avaliações >= 20) NÃO é aplicada aqui de
  // propósito: a coluna guarda o fato, e é julia-persona.ts que decide se o
  // fato é citável. Filtrar na escrita esconderia a reputação ruim do painel
  // e das estatísticas, e faria "sem dado" e "dado reprovado" virarem a mesma
  // linha no banco — que é justamente a confusão que a coluna existe para
  // desfazer. A coluna "citável?" abaixo é só leitura, para conferência.
  const CITAVEL_NOTA = 4.5;
  const CITAVEL_AVALIACOES = 20;

  for (const a of alvos) {
    const n = Number(a.nota);
    const citavel =
      Number.isFinite(n) &&
      n >= CITAVEL_NOTA &&
      (a.totalAvaliacoes ?? 0) >= CITAVEL_AVALIACOES;
    console.log(
      `  lead ${String(a.leadId).padStart(4)} | ${a.clinica ?? "(sem nome)"} — ${a.cidadeLead ?? "(sem cidade)"}\n` +
        `             prospect ${a.prospectId} → nota ${a.nota}, ${a.totalAvaliacoes} avaliações` +
        `   [ficha ${citavel ? "CITA" : "não cita"}]`,
    );
  }

  if (!aplicar) {
    console.log("\nEnsaio. Rode de novo com --aplicar para escrever.");
    return;
  }

  // Um UPDATE por lead: cada um leva os SEUS números, e são poucos. Mesmo
  // desenho da gravação da promoção.
  let escritos = 0;
  for (const a of alvos) {
    const r = await db
      .update(leadsTable)
      .set({
        nota: a.nota,
        totalAvaliacoes: a.totalAvaliacoes,
        updatedAt: new Date(),
      })
      // As condições de NULL são repetidas no UPDATE, e não só no SELECT: entre
      // a leitura e a escrita alguém pode ter promovido a mesma clínica de
      // novo. Sem isto o backfill sobrescreveria dado mais novo com dado mais
      // velho — silenciosamente, porque os dois "parecem" certos.
      .where(
        and(
          eq(leadsTable.id, a.leadId),
          isNull(leadsTable.nota),
          isNull(leadsTable.totalAvaliacoes),
        ),
      )
      .returning({ id: leadsTable.id });
    if (r.length > 0) escritos++;
  }

  console.log(
    `\n${escritos} lead(s) atualizados.` +
      (escritos === alvos.length
        ? ""
        : ` ${alvos.length - escritos} pulados: já tinham dado quando o UPDATE rodou.`),
  );
}

main()
  .catch((err) => {
    console.error("\nBackfill falhou — nada além do que já foi logado mudou.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
