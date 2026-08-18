/**
 * MEDE A INSISTENCIA — quantas vezes a Julia repetiu a mesma pergunta.
 *
 * POR QUE ESTE SCRIPT EXISTE, e nao um teste: a causa 4 (pergunta obrigatoria
 * sem porta de saida) e a unica das cinco da auditoria que vive FORA do alcance
 * do teste. Da para provar que a instrucao tem condicao de parada, que a ficha
 * carrega o estado e que o detector dispara — nada disso prova que ela parou de
 * insistir. Isso so as conversas de verdade dizem.
 *
 * Entao o metodo e: rodar ANTES de subir, guardar a saida, rodar DEPOIS, e
 * comparar. Guardar importa — o log morre com o deploy, e sem a copia o numero
 * de antes deixa de existir.
 *
 * SOMENTE LEITURA. Nao escreve nada, nao apaga nada, nao manda mensagem.
 *
 * Uso:
 *   DATABASE_URL=... node scripts/medir-repeticao.mjs
 *   DATABASE_URL=... node scripts/medir-repeticao.mjs --desde 2026-08-18
 *
 * O `--desde` e o que separa o depois do antes: com a data do deploy, so entram
 * conversas que ja nasceram sob as regras novas. Sem ele, mede tudo.
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL nao definida. Este script so LE o banco.");
  process.exit(1);
}

const i = process.argv.indexOf("--desde");
const desde = i !== -1 ? process.argv[i + 1] : null;
if (i !== -1 && !/^\d{4}-\d{2}-\d{2}$/.test(desde ?? "")) {
  console.error("--desde precisa de uma data AAAA-MM-DD");
  process.exit(1);
}

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

const { rows } = await cliente.query(
  `SELECT lead_id, content, created_at
     FROM lead_messages
    WHERE direction = 'outbound'
      ${desde ? "AND created_at >= $1" : ""}
    ORDER BY lead_id, created_at`,
  desde ? [desde] : [],
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
console.log(`INSISTENCIA${desde ? ` (desde ${desde})` : " (historico inteiro)"}`);
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
