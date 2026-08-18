/**
 * MEDE A INSISTENCIA — quantas vezes a Julia repetiu a mesma pergunta.
 *
 * POR QUE ESTE SCRIPT EXISTE, e nao um teste: a causa 4 (pergunta obrigatoria
 * sem porta de saida) e a unica das cinco da auditoria que vive FORA do alcance
 * do teste. Da para provar que a instrucao tem condicao de parada, que a ficha
 * carrega o estado e que o detector dispara — nada disso prova que ela parou de
 * insistir. Isso so as conversas de verdade dizem.
 *
 * O metodo e comparar duas janelas separadas pela data do deploy.
 *
 * ⚠️ O BASELINE NAO PRECISA SER MEDIDO ANTES DE SUBIR. Isto contraria o
 * instinto (e o que eu mesmo escrevi na primeira versao), entao vale escrito:
 * a medicao le `lead_messages`, que e BANCO, nao log. O deploy nao apaga
 * mensagem nenhuma — as colunas desta frente nascem anulaveis e sem backfill.
 * Entao o "antes" continua inteiro depois de subir, e se recupera com `--ate`.
 * Nao confundir com [[o-log-morre-com-o-deploy]]: aquilo vale para LOG.
 *
 * SOMENTE LEITURA. Nao escreve nada, nao apaga nada, nao manda mensagem.
 *
 * Uso:
 *   DATABASE_URL=... node scripts/medir-repeticao.mjs
 *   DATABASE_URL=... node scripts/medir-repeticao.mjs --ate 2026-08-18    # ANTES
 *   DATABASE_URL=... node scripts/medir-repeticao.mjs --desde 2026-08-18  # DEPOIS
 *
 * Use a data do DEPLOY nos dois, e os dois numeros sao comparaveis: `--ate`
 * pega so o que nasceu sob as regras velhas, `--desde` so o que nasceu sob as
 * novas. Rodar sem nenhum dos dois mistura as duas eras e nao responde nada.
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL nao definida. Este script so LE o banco.");
  process.exit(1);
}

/**
 * Aceita data (AAAA-MM-DD) OU carimbo completo (2026-08-18T02:57:30Z).
 *
 * O carimbo existe porque o corte de verdade e o INSTANTE em que o container
 * novo passou a atender, e ele quase nunca cai na virada do dia: neste deploy
 * foi 02:57:30Z. Com corte so por data, as mensagens entre 00:00Z e 02:57Z —
 * geradas pelo codigo VELHO — cairiam no balde da era NOVA e sujariam
 * justamente a medicao que se quer limpa.
 */
function instanteDoArgumento(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const valor = process.argv[i + 1] ?? "";
  const soData = /^\d{4}-\d{2}-\d{2}$/.test(valor);
  const comHora = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(valor);
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

/**
 * Os mesmos fragmentos de `src/lib/descoberta.ts`, e a mesma regra de "so conta
 * dentro de pergunta".
 *
 * Copiados de proposito, e nao importados: este arquivo e `.mjs` e roda contra
 * o banco de PRODUCAO sem passar pelo build. Importar o `.ts` exigiria o
 * esbuild no caminho, e um script de medicao que depende do build e um script
 * que ninguem roda na hora do aperto. O custo e lembrar de atualizar os dois —
 * por isso o teste confere que as listas nao divergiram.
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
  quem_responde: [
    "quem responde o whatsapp", "quem cuida do whatsapp",
    "quem atende o whatsapp", "quem responde as mensagens",
  ],
  fora_do_horario: [
    "quando chega mensagem", "chega mensagem a noite",
    "como fica no fim de semana", "e no fim de semana", "e quando e de noite",
  ],
  volume_perdido: [
    "quantos voce acha que somem", "quantos somem", "quantos pacientes somem",
    "quantos ficam sem resposta",
  ],
};

const semAcento = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");

function dentroDePergunta(texto, posicao) {
  const fim = texto.slice(posicao).search(/[.!?]/);
  if (fim === -1) return false;
  return texto[posicao + fim] === "?";
}

function topicosPerguntados(texto) {
  const alvo = semAcento(texto ?? "");
  const achados = [];
  for (const [topico, fragmentos] of Object.entries(PERGUNTAS)) {
    for (const f of fragmentos) {
      const onde = alvo.indexOf(semAcento(f));
      if (onde !== -1 && dentroDePergunta(alvo, onde)) {
        achados.push(topico);
        break;
      }
    }
  }
  return achados;
}

const cliente = new pg.Client({ connectionString: url });
await cliente.connect();

const condicoes = ["direction = 'outbound'"];
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
  `SELECT lead_id, content, created_at
     FROM lead_messages
    WHERE ${condicoes.join(" AND ")}
    ORDER BY lead_id, created_at`,
  parametros,
);
await cliente.end();

/** leadId -> topico -> quantas vezes ela perguntou */
const porLead = new Map();
for (const linha of rows) {
  const topicos = topicosPerguntados(linha.content);
  if (topicos.length === 0) continue;
  if (!porLead.has(linha.lead_id)) porLead.set(linha.lead_id, {});
  const conta = porLead.get(linha.lead_id);
  for (const t of topicos) conta[t] = (conta[t] ?? 0) + 1;
}

const TOPICOS = Object.keys(PERGUNTAS);
const totalLeads = porLead.size;
let leadsComRepeticao = 0;
let piorLead = null;
let piorContagem = 0;
const porTopico = Object.fromEntries(TOPICOS.map((t) => [t, { leads: 0, repetidos: 0 }]));

for (const [leadId, conta] of porLead) {
  let repetiuNesteLead = false;
  for (const [t, n] of Object.entries(conta)) {
    porTopico[t].leads++;
    if (n > 1) {
      porTopico[t].repetidos++;
      repetiuNesteLead = true;
      if (n > piorContagem) {
        piorContagem = n;
        piorLead = { leadId, topico: t };
      }
    }
  }
  if (repetiuNesteLead) leadsComRepeticao++;
}

const pct = (a, b) => (b === 0 ? "  -  " : `${((a / b) * 100).toFixed(0).padStart(3)}%`);

console.log("");
const janela = desde && ate ? `de ${desde} a ${ate}`
  : desde ? `desde ${desde} — a era NOVA`
  : ate ? `ate ${ate} — a era VELHA, o baseline`
  : "historico inteiro (as duas eras misturadas: nao compara nada)";
console.log(`INSISTENCIA (${janela})`);
console.log("");
console.log(`  mensagens nossas lidas .............. ${rows.length}`);
console.log(`  conversas com pergunta de descoberta  ${totalLeads}`);
console.log(
  `  conversas com ALGUMA repeticao ..... ${leadsComRepeticao}  (${pct(leadsComRepeticao, totalLeads)})`,
);
console.log(
  `  pior caso .......................... ${
    piorLead ? `${piorContagem}x "${piorLead.topico}" no lead ${piorLead.leadId}` : "nenhuma repeticao"
  }`,
);
console.log("");
console.log("  por topico:            perguntado em   repetido em");
for (const t of TOPICOS) {
  const { leads, repetidos } = porTopico[t];
  console.log(
    `    ${t.padEnd(20)} ${String(leads).padStart(6)} leads  ${String(repetidos).padStart(6)} leads  ${pct(repetidos, leads)}`,
  );
}
console.log("");
console.log("  CRITERIO, declarado antes de medir:");
console.log("    passou ............ nenhuma conversa com repeticao");
console.log("    passou com ressalva <=5% das conversas, e nenhuma apos recusa");
console.log("    falhou ............ repeticao apos recusa explicita, ou >5%");
console.log("");
console.log("  So tem significado com ~20 conversas novas. Com menos que isso,");
console.log("  o alarme da central de vigia vale mais que esta estatistica.");
console.log("");
