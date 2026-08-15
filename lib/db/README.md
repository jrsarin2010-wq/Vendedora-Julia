# @workspace/db — schema e aplicação no banco

O schema mora em `src/schema/*.ts` (Drizzle). Não existe pasta de migrations:
o banco converge para o TypeScript via `drizzle-kit push`, que o Railway roda
como `preDeployCommand` a cada deploy (ver `railway.json` na raiz).

## Os três scripts, e qual usar

| Script | O que faz | Quando usar |
|---|---|---|
| `push` | `drizzle-kit push` cru | desenvolvimento, com terminal de verdade |
| `push:ci` | o mesmo, com **código de saída honesto** | é o que deve rodar em deploy |
| `push-force` | `drizzle-kit push --force` | **quase nunca** — leia o aviso abaixo |

## ⛔ `push-force` NÃO pode virar `preDeployCommand`

O `--force` existe para pular as perguntas de confirmação do drizzle-kit. O
problema é *qual* pergunta ele pula.

Quando o drizzle quer criar uma constraint única numa tabela que já tem
linhas, ele pergunta:

```
· You're about to add uq_varredura unique constraint to the table, which
  contains 54 items. Do you want to truncate apify_varreduras table?
```

`--force` responde **sim** a isso. Em produção, isso significa **apagar a fila
de varreduras inteira** — as 54 combinações de termo × cidade, com o histórico
de custo e de tentativas junto. Sem aviso, sem log de "apaguei 54 linhas", e
com o deploy ficando verde.

Se um dia o `push` reclamar de confirmação interativa, o caminho é entender o
diff — nunca calar o drizzle com `--force`.

## Por que existe o `push:ci`

Medido em produção em 15/08/2026: o `drizzle-kit push` **falha e mesmo assim
sai com código 0**.

```
· You're about to add uq_varredura unique constraint ... Do you want to truncate?
Error: Interactive prompts require a TTY terminal ...
===== EXIT_CODE=0 =====
```

O Railway confia no código de saída, então o deploy foi para SUCCESS **com o
schema não aplicado**. Deploy verde com banco desatualizado é pior que deploy
vermelho: o próximo `ALTER TABLE` seria ignorado em silêncio, e o erro só
apareceria como "coluna não existe" horas depois, em produção.

O `push:ci` (`push-ci.mjs`) roda o mesmo comando, lê a saída e só sai 0 se
encontrar prova de que aplicou — `Changes applied` ou `No changes detected` —
e nenhum `Error:` no caminho.

## A constraint fantasma (resolvida em 15/08/2026)

O `drizzle-kit 0.31.10` repropunha a unique composta de `apify_varreduras` a
cada push, mesmo ela existindo no banco. Medido com três declarações
diferentes, contra o banco real:

| Declaração no schema | O que o drizzle propõe |
|---|---|
| `unique("uq_varredura").on(...)` (atual) | adicionar a constraint de novo → pergunta do truncate |
| `unique().on(...)` (nome automático) | **mesma coisa** — logo, não é o nome |
| `uniqueIndex("uq_varredura").on(...)` | `DROP CONSTRAINT` + `CREATE UNIQUE INDEX` — um diff real e finito |

Ou seja: o problema é a **unique composta declarada como constraint**, não o
nome customizado. Enquanto a tabela estava vazia isso passava batido (aplicava
em silêncio); com linhas, virou a pergunta do truncate.

O schema passou a declarar `uniqueIndex("uq_varredura")`, e o banco foi
convertido numa **transação única**:

```sql
BEGIN;
ALTER TABLE "apify_varreduras" DROP CONSTRAINT "uq_varredura";
CREATE UNIQUE INDEX "uq_varredura" ON "apify_varreduras"
  USING btree ("termo_busca","cidade","uf");
COMMIT;
```

A conversão foi feita à mão, e não pelo deploy, por um motivo verificado no
código do drizzle-kit: ele aplica os statements num laço simples
(`for (const dStmnt of statementsToExecute) await db.query(dStmnt)`), **sem
transação**. Pelo deploy, existiria um instante entre o `DROP` e o `CREATE`
sem nenhuma garantia de unicidade.

Depois da conversão, o push com o schema novo responde `No changes detected`.

Esse mesmo trecho do drizzle-kit termina em `catch (e4) { console.error(e4) }`
— o erro é impresso e engolido, sem afetar o código de saída. É a causa exata
do "verde mentiroso" que o `push:ci` cobre.
