/**
 * SEED DA VARREDURA APIFY — POST /api/varreduras/seed
 *
 * Enche a fila de varreduras com as 54 combinações da Onda 1 (27 capitais ×
 * 2 termos de busca). NÃO dispara nada no Apify: só popula a fila que o
 * worker da Etapa 2 vai consumir, devagar e com trava de orçamento.
 *
 * É rota de admin, e não seed no deploy, porque o `drizzle-kit push` do
 * preDeployCommand não faz seed — e um seed embutido rodaria a cada deploy.
 *
 * Idempotente por construção: o UNIQUE (termo, cidade, uf) da tabela + o
 * ON CONFLICT DO NOTHING fazem a segunda chamada ser inofensiva. O resumo
 * devolve quantas entraram e quantas já existiam, para quem chamou saber a
 * diferença entre "populou" e "já estava populado".
 */
import { Router, type IRouter } from "express";
import { db, apifyVarredurasTable } from "@workspace/db";

const router: IRouter = Router();

const TERMOS = ["clínica odontológica", "dentista"] as const;

/**
 * As 27 capitais. Prioridade 1 = os 10 maiores mercados, que o worker dispara
 * primeiro (a fila ordena por prioridade e depois por id).
 */
const CAPITAIS: { cidade: string; uf: string; prioridade: 1 | 2 }[] = [
  { cidade: "São Paulo", uf: "SP", prioridade: 1 },
  { cidade: "Rio de Janeiro", uf: "RJ", prioridade: 1 },
  { cidade: "Belo Horizonte", uf: "MG", prioridade: 1 },
  { cidade: "Brasília", uf: "DF", prioridade: 1 },
  { cidade: "Salvador", uf: "BA", prioridade: 1 },
  { cidade: "Fortaleza", uf: "CE", prioridade: 1 },
  { cidade: "Curitiba", uf: "PR", prioridade: 1 },
  { cidade: "Recife", uf: "PE", prioridade: 1 },
  { cidade: "Porto Alegre", uf: "RS", prioridade: 1 },
  { cidade: "Goiânia", uf: "GO", prioridade: 1 },
  { cidade: "Manaus", uf: "AM", prioridade: 2 },
  { cidade: "Belém", uf: "PA", prioridade: 2 },
  { cidade: "São Luís", uf: "MA", prioridade: 2 },
  { cidade: "Maceió", uf: "AL", prioridade: 2 },
  { cidade: "Campo Grande", uf: "MS", prioridade: 2 },
  { cidade: "Natal", uf: "RN", prioridade: 2 },
  { cidade: "Teresina", uf: "PI", prioridade: 2 },
  { cidade: "João Pessoa", uf: "PB", prioridade: 2 },
  { cidade: "Cuiabá", uf: "MT", prioridade: 2 },
  { cidade: "Aracaju", uf: "SE", prioridade: 2 },
  { cidade: "Florianópolis", uf: "SC", prioridade: 2 },
  { cidade: "Vitória", uf: "ES", prioridade: 2 },
  { cidade: "Porto Velho", uf: "RO", prioridade: 2 },
  { cidade: "Macapá", uf: "AP", prioridade: 2 },
  { cidade: "Rio Branco", uf: "AC", prioridade: 2 },
  { cidade: "Boa Vista", uf: "RR", prioridade: 2 },
  { cidade: "Palmas", uf: "TO", prioridade: 2 },
];

// POST /api/varreduras/seed
router.post("/varreduras/seed", async (req, res) => {
  try {
    const linhas = TERMOS.flatMap((termo) =>
      CAPITAIS.map((c) => ({
        termoBusca: termo,
        cidade: c.cidade,
        uf: c.uf,
        prioridade: c.prioridade,
      })),
    );

    // `returning` devolve SÓ o que entrou de verdade — é o que separa
    // "inseridas" de "jaExistiam" sem uma segunda consulta.
    const inseridas = await db
      .insert(apifyVarredurasTable)
      .values(linhas)
      .onConflictDoNothing({
        target: [
          apifyVarredurasTable.termoBusca,
          apifyVarredurasTable.cidade,
          apifyVarredurasTable.uf,
        ],
      })
      .returning({ id: apifyVarredurasTable.id });

    const resumo = {
      total: linhas.length,
      inseridas: inseridas.length,
      jaExistiam: linhas.length - inseridas.length,
    };

    req.log.info(resumo, "Seed de varreduras concluído");
    res.json(resumo);
  } catch (err) {
    req.log.error({ err }, "Falha no seed de varreduras");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
