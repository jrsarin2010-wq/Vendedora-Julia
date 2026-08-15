/**
 * CLÍNICAS CAPTADAS — leitura da antessala da tabela `leads` (Etapa 3B).
 *
 * Só LEITURA nesta etapa. Promover prospect a lead é a Etapa 3C, e ela depende
 * de uma decisão que ainda não foi tomada (o `origin` da rota de importação é
 * fixo em "import", ver leads-import.ts).
 *
 * PAGINAÇÃO NO SERVIDOR desde a primeira linha, de propósito. A lista de
 * dentistas do painel nasceu com um rodapé de paginação que nunca foi
 * implementado, e ali são poucas centenas de leads; aqui a Onda 1 prevê ~810
 * clínicas, e mandar tudo para o navegador a cada filtro seria criar o mesmo
 * problema sabendo que ele existe.
 */
import { Router, type IRouter } from "express";
import { db, clinicasProspectTable } from "@workspace/db";
import { eq, and, ilike, sql, desc } from "drizzle-orm";

const router: IRouter = Router();

/** Os 9 estados do enum `prospeccao_status` (lib/db/src/schema/clinicas-prospect.ts). */
const STATUS_PROSPECCAO = [
  "novo",
  "sem_telefone",
  "telefone_invalido",
  "sem_whatsapp",
  "apto",
  "na_fila",
  "promovido",
  "ja_existente",
  "descartado",
] as const;

type StatusProspeccao = (typeof STATUS_PROSPECCAO)[number];

const LIMITE_PADRAO = 50;
/**
 * Teto por página. Não é preferência: é o que impede um `limite=100000` na
 * barra de endereço de puxar a tabela inteira e desfazer a paginação.
 */
const LIMITE_MAXIMO = 200;

/** Número inteiro vindo da querystring, com piso, teto e valor padrão. */
function inteiro(valor: unknown, padrao: number, minimo: number, maximo: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(Math.trunc(n), minimo), maximo);
}

/**
 * GET /api/prospects/resumo
 *
 * Declarado ANTES da listagem por hábito do repo (o mais específico primeiro),
 * ainda que hoje não haja `/prospects/:id` para colidir.
 */
router.get("/prospects/resumo", async (req, res) => {
  try {
    // Agregação em memória sobre a tabela inteira, como o worker já faz com a
    // fila: são ~810 linhas na Onda 1, e manter a regra em código testável
    // vale mais que três consultas com GROUP BY.
    const todas = await db.select().from(clinicasProspectTable);

    const porStatus = Object.fromEntries(
      STATUS_PROSPECCAO.map((s) => [
        s,
        todas.filter((c) => c.statusProspeccao === s).length,
      ]),
    ) as Record<StatusProspeccao, number>;

    const contagemPorBairro = new Map<string, number>();
    for (const c of todas) {
      if (!c.bairro) continue;
      contagemPorBairro.set(c.bairro, (contagemPorBairro.get(c.bairro) ?? 0) + 1);
    }
    const porBairro = [...contagemPorBairro.entries()]
      .map(([bairro, total]) => ({ bairro, total }))
      .sort((a, b) => b.total - a.total || a.bairro.localeCompare(b.bairro));

    // "Verificado" é ter veredito, não ser positivo: enquanto NINGUÉM foi
    // verificado (a Etapa 3A ainda não existe), devolver 0 leria como
    // "conferimos e nenhuma tem WhatsApp", que é mentira. Nulo diz "não sei".
    const algumVerificado = todas.some((c) => c.temWhatsapp !== null);

    res.json({
      porStatus,
      porBairro,
      // É `telefoneRaw`, e NÃO `telefoneWhatsapp`. As duas colunas parecem
      // intercambiáveis e não são:
      //
      //   telefone_raw       → como veio do Maps. É o que a varredura grava.
      //   telefone_whatsapp  → a forma canônica que o WhatsApp devolve no jid,
      //                        preenchida só na Etapa 3A (prepararItem grava
      //                        `telefoneWhatsapp: null` de propósito).
      //
      // Contando a segunda, este número era ZERO por construção enquanto a 3A
      // não existisse — e zero aqui não parece bug, parece varredura ruim. Foi
      // exatamente assim que passou: a tela dizia "0 com telefone" com 13 das
      // 15 clínicas tendo telefone.
      comTelefone: todas.filter((c) => c.telefoneRaw !== null).length,
      comWhatsapp: algumVerificado
        ? todas.filter((c) => c.temWhatsapp === true).length
        : null,
      total: todas.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to summarize prospects");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/prospects
router.get("/prospects", async (req, res) => {
  try {
    const q = req.query as Record<string, unknown>;

    const status = typeof q.status === "string" && q.status ? q.status : null;
    if (status && !STATUS_PROSPECCAO.includes(status as StatusProspeccao)) {
      return void res.status(400).json({ error: `Status desconhecido: ${status}` });
    }

    const uf = typeof q.uf === "string" && q.uf ? q.uf.toUpperCase() : null;
    const cidade = typeof q.cidade === "string" && q.cidade ? q.cidade : null;
    const busca = typeof q.busca === "string" && q.busca ? q.busca : null;

    const limite = inteiro(q.limite, LIMITE_PADRAO, 1, LIMITE_MAXIMO);
    const offset = inteiro(q.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    const condicoes = [];
    if (status) {
      condicoes.push(
        eq(clinicasProspectTable.statusProspeccao, status as StatusProspeccao),
      );
    }
    if (uf) condicoes.push(eq(clinicasProspectTable.uf, uf));
    if (cidade) condicoes.push(ilike(clinicasProspectTable.cidade, `%${cidade}%`));
    if (busca) condicoes.push(ilike(clinicasProspectTable.nome, `%${busca}%`));

    const filtro = condicoes.length > 0 ? and(...condicoes) : undefined;

    const [itens, contagem] = await Promise.all([
      db
        .select()
        .from(clinicasProspectTable)
        .where(filtro)
        .orderBy(desc(clinicasProspectTable.id))
        .limit(limite)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(clinicasProspectTable)
        .where(filtro),
    ]);

    // `total` é o tamanho do RESULTADO FILTRADO, não da tabela: é o número que
    // a paginação da tela usa para saber se existe próxima página.
    res.json({ itens, total: contagem[0]?.count ?? 0, limite, offset });
  } catch (err) {
    req.log.error({ err }, "Failed to list prospects");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
