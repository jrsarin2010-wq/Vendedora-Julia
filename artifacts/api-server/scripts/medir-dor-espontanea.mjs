/**
 * MEDE SE A DOR SAIU SOZINHA — o dentista falou de perda sem ser perguntado?
 *
 * POR QUE ESTE SCRIPT EXISTE, e nao um teste: o teste prova que as tres
 * perguntas estao no prompt, que o teto cabe e que o topico e rastreado. Nada
 * disso prova que o dentista RECONHECEU a perda — e reconhecer e o objetivo
 * inteiro da rodada. Isso so as conversas de verdade dizem.
 *
 * O SINAL NAO E "ELE RESPONDEU". As sete conversas lidas em 19/08/2026
 * responderam todas, e nenhuma chegou a dinheiro: a resposta a uma pergunta de
 * logistica e confortavel e nao custa nada. O sinal e ele falar de perda
 * ESPONTANEAMENTE — contar de um paciente que sumiu, reclamar do tempo de
 * resposta, dizer que anuncia e nao converte. Nesse momento a venda comeca.
 *
 * "Espontaneamente" aqui tem definicao operacional: a mensagem dele menciona
 * perda E a ULTIMA mensagem nossa antes dela nao perguntou sobre isso. Se a
 * Julia acabou de perguntar, a resposta e resposta — nao e a dor saindo.
 *
 * BASELINE, medido antes de subir: ZERO em sete conversas.
 *
 * SOMENTE LEITURA. Nao escreve nada, nao apaga nada, nao manda mensagem.
 *
 * Uso:
 *   DATABASE_URL=... node scripts/medir-dor-espontanea.mjs
 *   DATABASE_URL=... node scripts/medir-dor-espontanea.mjs --ate 2026-08-19    # ANTES
 *   DATABASE_URL=... node scripts/medir-dor-espontanea.mjs --desde 2026-08-19  # DEPOIS
 *   ... --trechos          mostra as frases que contaram, para conferir na mao
 *
 * Use o INSTANTE do deploy nos dois cortes, pelo mesmo motivo do
 * medir-repeticao.mjs: o container novo quase nunca passa a atender na virada
 * do dia, e por data as mensagens da madrugada caem no balde errado.
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL nao definida. Este script so LE o banco.");
  process.exit(1);
}

function instanteDoArgumento(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const valor = process.argv[i + 1] ?? "";
  const soData = /^\d{4}-\d{2}-\d{2}$/.test(valor);
  const comHora =
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(valor);
  if (!soData && !comHora) {
    console.error(`${flag} precisa de AAAA-MM-DD ou AAAA-MM-DDTHH:MM:SSZ`);
    process.exit(1);
  }
  if (Number.isNaN(Date.parse(valor))) {
    console.error(`${flag}: "${valor}" nao e uma data valida`);
    process.exit(1);
  }
  return valor;
}

const desde = instanteDoArgumento("--desde");
const ate = instanteDoArgumento("--ate");
const mostrarTrechos = process.argv.includes("--trechos");

/**
 * COMO SE RECONHECE A JULIA PERGUNTANDO cada assunto.
 *
 * Copia de lib/descoberta.ts, como no medir-repeticao.mjs e pelo mesmo motivo
 * (o script roda contra producao sem passar pelo build). Ha teste amarrando as
 * listas: divergir aqui faz a medicao medir outra coisa, e ninguem perceberia.
 *
 * Aqui elas servem ao contrario do outro script: nao para contar quantas vezes
 * ela perguntou, e sim para DESCONTAR a resposta que veio porque ela perguntou.
 */
const PERGUNTAS = {
  anuncia: [
    "voce anuncia", "vc anuncia", "voces anunciam", "chega a anunciar",
    "faz anuncio", "trabalha com anuncio", "roda anuncio",
    "anuncia no instagram", "anuncia no google",
  ],
  verba: [
    "quanto voce investe", "quanto investe", "quanto voces investem",
    "investe por mes", "quanto poe por mes",
  ],
  profissionais: [
    "quantos profissionais", "quantas pessoas atendem", "quantos dentistas",
    "voces sao quantos", "sao quantos ai",
  ],
  quem_trabalha: [
    "o que acontece com quem", "o que acontece com esse contato",
    "o que acontece com esse paciente", "pergunta preco e some",
    "pergunta o preco e some", "some depois de perguntar",
  ],
  retoma_sumidos: [
    "alguem volta a chamar", "volta a chamar quem", "alguem chama de volta",
    "chama de volta quem", "voces retomam", "alguem retoma",
  ],
  quem_capta: [
    "alguem dedicado a trazer", "alguem so para trazer",
    "alguem cuidando de trazer", "quem cuida de trazer paciente",
    "a recepcao acumula", "recepcao acumula isso",
  ],
  volume_perdido: [
    "quantos voce acha que somem", "quantos somem", "quantos pacientes somem",
    "quantos ficam sem resposta",
  ],
};

/**
 * O QUE CONTA COMO ELE FALANDO DE PERDA.
 *
 * Lista larga de proposito, e por isso o `--trechos` existe: o custo de um
 * falso positivo aqui e uma linha conferida a mao, e o custo de um falso
 * negativo e concluir que a rodada falhou quando ela funcionou. Numa medicao
 * cujo baseline e ZERO, errar para menos apaga o unico sinal que interessa.
 *
 * Tres familias, uma por dor: quem chegou e se perdeu, quem ja veio e sumiu, e
 * o braco que falta para correr atras.
 */
const PERDA = {
  "quem chega e se perde": [
    "fica sem resposta", "ficam sem resposta", "sem resposta",
    "demoro para responder", "demora para responder", "demoramos para responder",
    "nao consigo responder", "nao dou conta", "deixo de responder",
    "perco paciente", "perdi paciente", "a gente perde", "perdemos paciente",
    "vai pro concorrente", "vai para o concorrente", "procura outro",
    "pergunta o preco e some", "pergunta preco e some",
  ],
  "quem some depois": [
    "sumiu", "sumiram", "some", "somem", "sumem",
    "nao voltou", "nao voltaram", "nao apareceu", "nao apareceram",
    "furou", "furam", "desmarcou", "desmarcam", "desmarcam em cima",
    "parou de vir", "pararam de vir", "parou de aparecer",
    "nao fechou o orcamento", "nao aceitou o orcamento",
  ],
  "falta braco": [
    "nao tenho tempo", "nao temos tempo", "falta tempo",
    "a recepcao nao da conta", "nao da conta", "acumula tudo",
    "ninguem faz isso", "ninguem cuida disso", "ninguem liga de volta",
    "nao ligo de volta", "anuncio e nao converte", "nao converte",
  ],
};

const semAcento = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");

function dentroDePergunta(texto, posicao) {
  const fim = texto.slice(posicao).search(/[.!?]/);
  if (fim === -1) return false;
  return texto[posicao + fim] === "?";
}

/** Esta mensagem NOSSA perguntou sobre alguma dor? */
function perguntouAlgo(texto) {
  const alvo = semAcento(texto ?? "");
  for (const fragmentos of Object.values(PERGUNTAS)) {
    for (const f of fragmentos) {
      const onde = alvo.indexOf(semAcento(f));
      if (onde !== -1 && dentroDePergunta(alvo, onde)) return true;
    }
  }
  return false;
}

/** Que familias de perda esta mensagem DELE menciona. */
function perdasMencionadas(texto) {
  const alvo = semAcento(texto ?? "");
  const achadas = [];
  for (const [familia, fragmentos] of Object.entries(PERDA)) {
    if (fragmentos.some((f) => alvo.includes(semAcento(f)))) achadas.push(familia);
  }
  return achadas;
}

const cliente = new pg.Client({ connectionString: url });
await cliente.connect();

const condicoes = [];
const parametros = [];
if (desde) {
  parametros.push(desde);
  condicoes.push(`created_at >= $${parametros.length}`);
}
if (ate) {
  parametros.push(ate);
  condicoes.push(`created_at < $${parametros.length}`);
}

const { rows } = await cliente.query(
  `SELECT lead_id, direction, content, created_at
     FROM lead_messages
    ${condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : ""}
    ORDER BY lead_id, created_at`,
  parametros,
);
await cliente.end();

/**
 * Varre em ordem, guardando se a ULTIMA mensagem nossa perguntou alguma coisa.
 * E o que separa "ele reconheceu a perda" de "ele respondeu o que foi
 * perguntado" — e sem isso a medicao contaria a segunda como se fosse a
 * primeira, que e exatamente o erro que ela existe para nao cometer.
 */
const porLead = new Map();
let leadAtual = null;
let ultimaNossaPerguntou = false;

for (const linha of rows) {
  if (linha.lead_id !== leadAtual) {
    leadAtual = linha.lead_id;
    ultimaNossaPerguntou = false;
  }
  if (linha.direction === "outbound") {
    ultimaNossaPerguntou = perguntouAlgo(linha.content);
    continue;
  }
  if (!porLead.has(linha.lead_id)) {
    porLead.set(linha.lead_id, { dele: 0, espontaneas: [], respondidas: 0 });
  }
  const conta = porLead.get(linha.lead_id);
  conta.dele++;

  const perdas = perdasMencionadas(linha.content);
  if (perdas.length === 0) continue;
  if (ultimaNossaPerguntou) conta.respondidas++;
  else conta.espontaneas.push({ perdas, trecho: linha.content.slice(0, 120) });
}

const totalLeads = porLead.size;
const comEspontanea = [...porLead.values()].filter((c) => c.espontaneas.length > 0).length;
const totalEspontaneas = [...porLead.values()].reduce((n, c) => n + c.espontaneas.length, 0);
const totalRespondidas = [...porLead.values()].reduce((n, c) => n + c.respondidas, 0);
const porFamilia = Object.fromEntries(Object.keys(PERDA).map((f) => [f, 0]));
for (const conta of porLead.values()) {
  for (const e of conta.espontaneas) for (const f of e.perdas) porFamilia[f]++;
}

const pct = (a, b) => (b === 0 ? "  -  " : `${((a / b) * 100).toFixed(0).padStart(3)}%`);

const janela = desde && ate ? `de ${desde} a ${ate}`
  : desde ? `desde ${desde} — a era NOVA`
  : ate ? `ate ${ate} — a era VELHA, o baseline`
  : "historico inteiro (as duas eras misturadas: nao compara nada)";

console.log("");
console.log(`DOR ESPONTANEA (${janela})`);
console.log("");
console.log(`  mensagens lidas .................... ${rows.length}`);
console.log(`  conversas com resposta dele ........ ${totalLeads}`);
console.log(
  `  conversas em que a dor saiu SOZINHA  ${comEspontanea}  (${pct(comEspontanea, totalLeads)})`,
);
console.log(`  mencoes espontaneas (total) ........ ${totalEspontaneas}`);
console.log(`  mencoes que responderam a pergunta . ${totalRespondidas}  (nao contam)`);
console.log("");
console.log("  por familia de perda (so as espontaneas):");
for (const [familia, n] of Object.entries(porFamilia)) {
  console.log(`    ${familia.padEnd(22)} ${String(n).padStart(4)}`);
}

if (mostrarTrechos) {
  console.log("");
  console.log("  TRECHOS, para conferir na mao (a lista de perda e larga de proposito):");
  for (const [leadId, conta] of porLead) {
    for (const e of conta.espontaneas) {
      console.log(`    lead ${String(leadId).padStart(4)} [${e.perdas.join(", ")}] ${e.trecho}`);
    }
  }
}

console.log("");
console.log("  CRITERIO, declarado antes de medir (baseline: ZERO em sete conversas):");
console.log("    passou ............ >=1 em cada 4 conversas com dor espontanea");
console.log("    passou com ressalva qualquer conversa com dor espontanea");
console.log("    falhou ............ zero, como antes das tres perguntas novas");
console.log("");
console.log("  So tem significado com ~20 conversas novas. E confira os trechos");
console.log("  antes de comemorar: a lista de perda erra para MAIS de proposito.");
console.log("");
