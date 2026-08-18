/**
 * Etapa 3B — listagem e resumo das clínicas captadas.
 *
 * O que este arquivo protege: a PAGINAÇÃO. Uma paginação que devolve `total`
 * errado, ou que ignora o `offset`, não quebra a tela — ela mostra menos
 * clínica do que existe, em silêncio, e ninguém descobre olhando a página 1.
 *
 * O `porBairro` também é testado a sério: ele existe porque 7 das 15 primeiras
 * clínicas vieram do mesmo bairro, e essa distorção precisa aparecer.
 */
import { ok, secao, fim } from "./assert";
import { handlerDe, chamarRota } from "./rota";
import prospectsRouter from "../src/routes/prospects";
import { state } from "./stubs/db.mjs";

const resumoHandler = handlerDe(prospectsRouter, 0);
const listaHandler = handlerDe(prospectsRouter, 1);

interface Lista {
  itens: { id: number; nome: string; uf: string | null; cidade: string | null }[];
  total: number;
  limite: number;
  offset: number;
}

interface Resumo {
  porStatus: Record<string, number>;
  porBairro: { bairro: string; total: number }[];
  comTelefone: number;
  comWhatsapp: number | null;
  total: number;
}

/**
 * O padrão imita o que a varredura REALMENTE grava (ver prepararItem em
 * lib/varredura.ts): `telefone_raw` como veio do Maps e `telefone_whatsapp`
 * NULO — quem preenche a forma canônica é a Etapa 3A, que ainda não existe.
 *
 * Antes este fixture preenchia as duas colunas, o que não acontece em
 * produção nenhuma. Foi essa mentira que deixou passar o bug do `comTelefone`
 * contando a coluna errada: com as duas cheias, contar qualquer uma dava o
 * mesmo número, e o teste passava enquanto a tela mostrava zero.
 */
function clinica(campos: Record<string, unknown>) {
  state.clinicas.push({
    id: state.nextId++,
    placeId: `place-${state.nextId}`,
    nome: "Clínica Teste",
    telefoneRaw: "(11) 99999-8888",
    telefoneWhatsapp: null,
    temWhatsapp: null,
    bairro: null,
    cidade: "São Paulo",
    uf: "SP",
    statusProspeccao: "novo",
    ...campos,
  });
}

const nomes = (r: { body: unknown }) => (r.body as Lista).itens.map((i) => i.nome);

// ---------------------------------------------------------------------------
secao("lista vazia — responde estrutura, não erro");
state.reset();
let r = await chamarRota(listaHandler, {});
ok("status 200", r.status === 200, JSON.stringify(r.body));
ok("itens vazio", (r.body as Lista).itens.length === 0);
ok("total 0", (r.body as Lista).total === 0);

secao("sem filtro — devolve tudo, com o total certo");
state.reset();
clinica({ nome: "Odonto Vida", bairro: "Parelheiros" });
clinica({ nome: "Sorriso Real", bairro: "Parelheiros" });
clinica({ nome: "Clínica Norte", bairro: "Santana", uf: "SP" });
clinica({ nome: "Dental Recife", cidade: "Recife", uf: "PE", statusProspeccao: "sem_telefone" });
r = await chamarRota(listaHandler, {});
ok("4 itens", (r.body as Lista).itens.length === 4, JSON.stringify(nomes(r)));
ok("total 4", (r.body as Lista).total === 4);
ok("limite padrão 50", (r.body as Lista).limite === 50);
ok("offset padrão 0", (r.body as Lista).offset === 0);

secao("filtro por status, isolado");
r = await chamarRota(listaHandler, { query: { status: "sem_telefone" } });
ok("1 item", (r.body as Lista).itens.length === 1, JSON.stringify(nomes(r)));
ok("é a de Recife", nomes(r)[0] === "Dental Recife");
ok("e o total acompanha o filtro", (r.body as Lista).total === 1);

secao("status desconhecido é recusado, não ignorado");
r = await chamarRota(listaHandler, { query: { status: "inventado" } });
ok("400", r.status === 400, JSON.stringify(r.body));

/*
 * O filtro rápido da tela ("A trabalhar" e "Já resolvidas") manda VÁRIOS
 * status de uma vez. O que este bloco protege é o recorte continuar sendo do
 * servidor: se a lista virasse um OR frouxo, ou se só o primeiro status
 * contasse, a tela mostraria menos clínica do que existe embaixo de um total
 * que diz outra coisa — e ninguém descobre isso olhando a página 1.
 */
secao("filtro por VÁRIOS status — a lista separada por vírgula");
r = await chamarRota(listaHandler, { query: { status: "novo,sem_telefone" } });
ok("4 itens (3 novas + 1 sem telefone)", (r.body as Lista).itens.length === 4, JSON.stringify(nomes(r)));
ok("total acompanha", (r.body as Lista).total === 4);
r = await chamarRota(listaHandler, { query: { status: "sem_telefone,apto" } });
ok(
  "só a de Recife — 'apto' não tem ninguém e não alarga o resultado",
  nomes(r).join() === "Dental Recife",
  JSON.stringify(nomes(r)),
);

secao("espaço em volta da vírgula não quebra a lista");
r = await chamarRota(listaHandler, { query: { status: "novo , sem_telefone" } });
ok("4 itens", (r.body as Lista).itens.length === 4, JSON.stringify(nomes(r)));

secao("um status inválido no meio derruba a lista inteira");
r = await chamarRota(listaHandler, { query: { status: "novo,inventado" } });
ok("400, e não uma lista mais larga do que a pedida", r.status === 400, JSON.stringify(r.body));

secao("lista combinada com UF — o AND vale para o grupo inteiro");
r = await chamarRota(listaHandler, { query: { uf: "PE", status: "novo,sem_telefone" } });
ok("só a de Recife", nomes(r).join() === "Dental Recife", JSON.stringify(nomes(r)));

secao("filtro por UF, isolado — e aceita minúscula");
r = await chamarRota(listaHandler, { query: { uf: "pe" } });
ok("1 item", (r.body as Lista).itens.length === 1, JSON.stringify(nomes(r)));
ok("total 1", (r.body as Lista).total === 1);
r = await chamarRota(listaHandler, { query: { uf: "SP" } });
ok("3 em SP", (r.body as Lista).itens.length === 3, JSON.stringify(nomes(r)));

secao("filtro por cidade, isolado");
r = await chamarRota(listaHandler, { query: { cidade: "Recife" } });
ok("1 item", (r.body as Lista).itens.length === 1, JSON.stringify(nomes(r)));

secao("busca por nome, isolada — parcial e sem diferenciar caixa");
r = await chamarRota(listaHandler, { query: { busca: "sorriso" } });
ok("achou 'Sorriso Real' buscando minúsculo", nomes(r).join() === "Sorriso Real", JSON.stringify(nomes(r)));

secao("filtros COMBINADOS — o AND é de verdade");
r = await chamarRota(listaHandler, { query: { uf: "SP", status: "novo" } });
ok("3 itens", (r.body as Lista).itens.length === 3, JSON.stringify(nomes(r)));
r = await chamarRota(listaHandler, { query: { uf: "PE", status: "novo" } });
ok(
  "UF certa + status errado = nenhum (não caiu em OR)",
  (r.body as Lista).itens.length === 0,
  JSON.stringify(nomes(r)),
);
r = await chamarRota(listaHandler, { query: { uf: "SP", busca: "odonto" } });
ok("UF + busca combinam", nomes(r).join() === "Odonto Vida", JSON.stringify(nomes(r)));

// ---------------------------------------------------------------------------
secao("paginação — limite e offset respeitados, total é o do FILTRO");
state.reset();
for (let i = 1; i <= 12; i++) clinica({ nome: `Clínica ${i}` });

r = await chamarRota(listaHandler, { query: { limite: "5" } });
ok("5 itens na página 1", (r.body as Lista).itens.length === 5, JSON.stringify(nomes(r)));
ok("total continua 12", (r.body as Lista).total === 12, String((r.body as Lista).total));
const pagina1 = nomes(r);

r = await chamarRota(listaHandler, { query: { limite: "5", offset: "5" } });
ok("5 itens na página 2", (r.body as Lista).itens.length === 5);
ok("total continua 12", (r.body as Lista).total === 12);
const pagina2 = nomes(r);
ok(
  "página 2 não repete nada da página 1",
  pagina2.every((n) => !pagina1.includes(n)),
  `${pagina1.join()} | ${pagina2.join()}`,
);

r = await chamarRota(listaHandler, { query: { limite: "5", offset: "10" } });
ok("sobram 2 na última página", (r.body as Lista).itens.length === 2, JSON.stringify(nomes(r)));

r = await chamarRota(listaHandler, { query: { limite: "5", offset: "999" } });
ok("offset além do fim devolve vazio, não erro", (r.body as Lista).itens.length === 0);
ok("e o total continua honesto", (r.body as Lista).total === 12);

secao("paginação — limite fora da faixa é contido, não obedecido");
r = await chamarRota(listaHandler, { query: { limite: "100000" } });
ok("limite teto 200", (r.body as Lista).limite === 200, String((r.body as Lista).limite));
r = await chamarRota(listaHandler, { query: { limite: "0" } });
ok("limite piso 1", (r.body as Lista).limite === 1, String((r.body as Lista).limite));
r = await chamarRota(listaHandler, { query: { limite: "abc", offset: "-5" } });
ok("lixo vira o padrão", (r.body as Lista).limite === 50, String((r.body as Lista).limite));
ok("offset negativo vira 0", (r.body as Lista).offset === 0, String((r.body as Lista).offset));

secao("paginação combinada com filtro — o total é o do filtro, não da tabela");
state.reset();
for (let i = 1; i <= 8; i++) clinica({ nome: `SP ${i}`, uf: "SP" });
for (let i = 1; i <= 3; i++) clinica({ nome: `PE ${i}`, uf: "PE" });
r = await chamarRota(listaHandler, { query: { uf: "SP", limite: "3" } });
ok("3 na página", (r.body as Lista).itens.length === 3);
ok("total 8 (só os de SP)", (r.body as Lista).total === 8, String((r.body as Lista).total));

// ---------------------------------------------------------------------------
secao("resumo — os 9 status aparecem, mesmo zerados");
state.reset();
clinica({ nome: "A", statusProspeccao: "novo", bairro: "Parelheiros" });
clinica({ nome: "B", statusProspeccao: "novo", bairro: "Parelheiros" });
clinica({ nome: "C", statusProspeccao: "novo", bairro: "Parelheiros" });
clinica({ nome: "D", statusProspeccao: "sem_telefone", telefoneRaw: null, bairro: "Santana" });
clinica({ nome: "E", statusProspeccao: "apto", bairro: "Santana" });
clinica({ nome: "F", statusProspeccao: "apto", bairro: null });

r = await chamarRota(resumoHandler, {});
ok("status 200", r.status === 200, JSON.stringify(r.body));
let resumo = r.body as Resumo;
ok("9 chaves de status", Object.keys(resumo.porStatus).length === 9, JSON.stringify(resumo.porStatus));
ok("novo = 3", resumo.porStatus.novo === 3);
ok("apto = 2", resumo.porStatus.apto === 2);
ok("sem_telefone = 1", resumo.porStatus.sem_telefone === 1);
ok("promovido = 0 e não sumiu", resumo.porStatus.promovido === 0);
ok("total 6", resumo.total === 6);

secao("resumo — concentração por bairro, do maior para o menor");
ok("2 bairros (o nulo não vira 'null')", resumo.porBairro.length === 2, JSON.stringify(resumo.porBairro));
ok("Parelheiros primeiro com 3", resumo.porBairro[0].bairro === "Parelheiros" && resumo.porBairro[0].total === 3, JSON.stringify(resumo.porBairro));
ok("Santana depois com 2", resumo.porBairro[1].bairro === "Santana" && resumo.porBairro[1].total === 2);

secao("resumo — comTelefone conta telefone_raw, NÃO telefone_whatsapp");
// A regressão: no cenário acima as 6 clínicas estão como a varredura grava —
// `telefone_whatsapp` nulo em TODAS. Contando aquela coluna, este número seria
// 0 mesmo com 5 clínicas tendo telefone, que foi o bug visto na tela.
ok(
  "5 com telefone (só a sem_telefone tem raw nulo)",
  resumo.comTelefone === 5,
  String(resumo.comTelefone),
);
ok(
  "e nenhuma delas tem telefone_whatsapp — é a coluna errada de propósito",
  (state.clinicas as { telefoneWhatsapp: string | null }[]).every(
    (c) => c.telefoneWhatsapp === null,
  ),
);

secao("resumo — a 3A preenchendo telefone_whatsapp NÃO muda o comTelefone");
// Quando a Etapa 3A chegar, `telefone_whatsapp` começa a ser preenchido. Isso
// não pode mexer neste número: ele mede cobertura do dado do Maps, não do
// nosso trabalho de verificação.
state.reset();
clinica({ nome: "Só raw", telefoneRaw: "(11) 90000-0001" });
clinica({ nome: "Raw + canônico", telefoneRaw: "(11) 90000-0002", telefoneWhatsapp: "5511900000002" });
clinica({ nome: "Sem telefone", telefoneRaw: null, statusProspeccao: "sem_telefone" });
resumo = (await chamarRota(resumoHandler, {})).body as Resumo;
ok("2 com telefone", resumo.comTelefone === 2, String(resumo.comTelefone));

secao("resumo — telefone que o Maps deu mas a normalização recusou ainda conta");
// `telefone_invalido` significa que HAVIA telefone: o buraco é da nossa
// normalização, não do Google. Separar isso é o motivo de os dois status
// existirem — somá-los aqui apagaria a diferença que eles medem.
state.reset();
clinica({ nome: "Inválido", telefoneRaw: "0800 111 2222", statusProspeccao: "telefone_invalido" });
clinica({ nome: "Bom", telefoneRaw: "(11) 90000-0003" });
resumo = (await chamarRota(resumoHandler, {})).body as Resumo;
ok("2 com telefone", resumo.comTelefone === 2, String(resumo.comTelefone));
ok("1 marcado como inválido", resumo.porStatus.telefone_invalido === 1);

secao("resumo — comWhatsapp é NULO enquanto ninguém foi verificado");
ok(
  "null, e não 0 — 0 leria como 'conferimos e nenhuma tem'",
  resumo.comWhatsapp === null,
  String(resumo.comWhatsapp),
);

secao("resumo — com veredito na mesa, vira número");
state.reset();
clinica({ nome: "A", temWhatsapp: true });
clinica({ nome: "B", temWhatsapp: true });
clinica({ nome: "C", temWhatsapp: false });
resumo = (await chamarRota(resumoHandler, {})).body as Resumo;
ok("comWhatsapp = 2", resumo.comWhatsapp === 2, String(resumo.comWhatsapp));

secao("resumo — tabela vazia não quebra");
state.reset();
resumo = (await chamarRota(resumoHandler, {})).body as Resumo;
ok("total 0", resumo.total === 0);
ok("porBairro vazio", resumo.porBairro.length === 0);
ok("comWhatsapp null", resumo.comWhatsapp === null);
ok("os 9 status continuam lá", Object.keys(resumo.porStatus).length === 9);

fim();
