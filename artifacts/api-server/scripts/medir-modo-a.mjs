/**
 * MEDE O MODO A — quem veio ate nos (landing ou WhatsApp do nada).
 *
 * POR QUE ESTE SCRIPT EXISTE ANTES DA REVISAO DO MODO A, e nao depois: script
 * escrito depois mede o depois. A revisao do MODO A esta parada esperando duas
 * conversas reais, e quando ela sair vai ser preciso comparar com o que havia
 * antes — se o instrumento so nascer junto com a mudanca, o "antes" nao existe
 * mais em lugar nenhum e a comparacao vira opiniao.
 *
 * ⚠️ O BASELINE DESTE SCRIPT E A PRIMEIRA RODADA DELE. Os outros dois scripts
 * de medicao trazem o baseline cravado no proprio texto (a insistencia tinha o
 * caso das seis perguntas; a dor espontanea tinha ZERO em sete). Aqui NAO ha
 * numero cravado, e isso e proposital: ninguem leu uma conversa do MODO A
 * ainda. Rode, GUARDE A SAIDA, e ela vira o baseline. Sem isso, a proxima
 * rodada mede o depois contra nada.
 *
 * SAO DUAS PERGUNTAS, e as duas sobre o mesmo publico — por isso um script so:
 *
 *   1. EM QUANTAS MENSAGENS ela chega a recomendar um plano. Quem veio da
 *      landing ja leu a pagina e veio buscar resposta; se ela leva muitas
 *      mensagens ate recomendar, esta interrogando quem veio comprar.
 *   2. QUANTAS CONVERSAS RECEBEM O AUDIO de demonstracao. O gargalo do MODO A
 *      nao e entender, e ACREDITAR que funciona na clinica dele — e o audio e a
 *      unica prova que existe. Perto de zero significa que a ferramenta que
 *      resolve o gargalo deste modo nao esta sendo usada.
 *
 * ⚠️ O QUE ESTE SCRIPT NAO MEDE, e e metade do criterio: se a recomendacao veio
 * "com o motivo ligado ao que ele contou". Isso e semantico e nenhuma lista de
 * fragmentos decide — entao o script conta a recomendacao e o `--trechos`
 * imprime a mensagem, para o julgamento ser feito por quem le. Fingir que o
 * numero cobre essa metade seria pior que nao te-la.
 *
 * SOMENTE LEITURA. Nao escreve nada, nao apaga nada, nao manda mensagem.
 *
 * Uso:
 *   DATABASE_URL=... node scripts/medir-modo-a.mjs
 *   DATABASE_URL=... node scripts/medir-modo-a.mjs --ate 2026-08-20    # ANTES
 *   DATABASE_URL=... node scripts/medir-modo-a.mjs --desde 2026-08-20  # DEPOIS
 *   ... --trechos          mostra a mensagem que contou como recomendacao
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
 * QUEM E MODO A. Copia de lib/origem-site.ts (`ehModoA`), como os outros
 * scripts copiam os fragmentos de pergunta — o script roda contra producao sem
 * passar pelo build. Ha teste amarrando as duas listas: divergir aqui faz a
 * medicao contar OUTRO publico e ninguem perceberia, porque os dois lados
 * continuariam "funcionando".
 *
 * MODO A e quem nos procurou. "site" e o botao da landing; "whatsapp" e o que o
 * webhook grava quando ele manda mensagem do nada; "inbound" e o valor antigo,
 * que lead velho ainda tem; e NULO e o mesmo caso escrito de outro jeito.
 */
const ORIGEM_SITE = "site";
const ORIGENS_DE_QUEM_CHEGOU_SOZINHO = ["whatsapp", "inbound"];
const ehModoA = (origin) =>
  !origin || ORIGENS_DE_QUEM_CHEGOU_SOZINHO.includes(origin) || origin === ORIGEM_SITE;

const semAcento = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");

/**
 * A MENSAGEM RECOMENDA UM PLANO?
 *
 * Nome de plano E valor na mesma mensagem. As duas condicoes juntas, porque
 * cada uma sozinha erra para o lado ruim: nome de plano aparece em explicacao
 * que nao recomenda nada ("o Basico nao serve pra voces"), e valor aparece
 * sozinho na resposta de quem so perguntou o preco.
 *
 * "Pro" e conferido com CAIXA, no texto cru, e nao junto dos outros: em
 * portugues falado "pro" e "para o" ("pro dentista", "pro paciente"), e essa
 * palavra esta em todo lugar deste prompt. Minusculo, ela sozinha faria a
 * medicao inteira dizer que toda mensagem recomenda um plano.
 */
const PLANOS_MINUSCULOS = [/\bbasico\b/, /\bessencial\b/];
const PLANO_PRO = /\bPro\b/;
const VALOR = /R\$\s?\d/;

function recomendaPlano(texto) {
  const cru = texto ?? "";
  const alvo = semAcento(cru);
  const temPlano = PLANOS_MINUSCULOS.some((r) => r.test(alvo)) || PLANO_PRO.test(cru);
  return temPlano && VALOR.test(cru);
}

const cliente = new pg.Client({ connectionString: url });
await cliente.connect();

const condicoes = [];
const parametros = [];
if (desde) {
  parametros.push(desde);
  condicoes.push(`m.created_at >= $${parametros.length}`);
}
if (ate) {
  parametros.push(ate);
  condicoes.push(`m.created_at < $${parametros.length}`);
}

const { rows } = await cliente.query(
  `SELECT m.lead_id, m.direction, m.message_type, m.content, l.origin
     FROM lead_messages m
     JOIN leads l ON l.id = m.lead_id
    ${condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : ""}
    ORDER BY m.lead_id, m.created_at`,
  parametros,
);
await cliente.end();

/**
 * Varre em ordem. `nossas` conta as mensagens NOSSAS desde o inicio da conversa
 * — e a definicao de "trocas" que este script usa, dita aqui porque numero sem
 * definicao nao se compara com nada: quantas mensagens ela precisou MANDAR ate
 * recomendar, contando a propria recomendacao.
 */
const porLead = new Map();
let leadAtual = null;

for (const linha of rows) {
  if (!ehModoA(linha.origin)) continue;
  if (linha.lead_id !== leadAtual) leadAtual = linha.lead_id;
  if (!porLead.has(linha.lead_id)) {
    porLead.set(linha.lead_id, {
      origin: linha.origin,
      nossas: 0,
      ateRecomendar: null,
      trechoDaRecomendacao: null,
      audios: 0,
    });
  }
  const conta = porLead.get(linha.lead_id);
  if (linha.direction !== "outbound") continue;

  if (linha.message_type === "audio") {
    conta.audios++;
    continue;
  }
  conta.nossas++;
  if (conta.ateRecomendar === null && recomendaPlano(linha.content)) {
    conta.ateRecomendar = conta.nossas;
    conta.trechoDaRecomendacao = (linha.content ?? "").slice(0, 160).replace(/\s+/g, " ");
  }
}

const conversas = [...porLead.values()];
const total = conversas.length;
const comRecomendacao = conversas.filter((c) => c.ateRecomendar !== null);
const semRecomendacao = total - comRecomendacao.length;
const comAudio = conversas.filter((c) => c.audios > 0).length;
const doSite = conversas.filter((c) => c.origin === ORIGEM_SITE).length;

const contagens = comRecomendacao.map((c) => c.ateRecomendar).sort((a, b) => a - b);
const mediana = contagens.length
  ? contagens.length % 2
    ? contagens[(contagens.length - 1) / 2]
    : (contagens[contagens.length / 2 - 1] + contagens[contagens.length / 2]) / 2
  : null;
const dentroDeQuatro = contagens.filter((n) => n <= 4).length;

const pct = (a, b) => (b === 0 ? "  -  " : `${((a / b) * 100).toFixed(0).padStart(3)}%`);

const janela = desde && ate ? `de ${desde} a ${ate}`
  : desde ? `desde ${desde} — a era NOVA`
  : ate ? `ate ${ate} — a era VELHA, o baseline`
  : "historico inteiro";

console.log("");
console.log(`MODO A — quem veio ate nos (${janela})`);
console.log("");
console.log(`  mensagens lidas .................... ${rows.length}`);
console.log(`  conversas do MODO A ................ ${total}   (do botao da landing: ${doSite})`);
console.log("");
console.log("  1) EM QUANTAS MENSAGENS NOSSAS ELA CHEGA A RECOMENDAR UM PLANO");
console.log(`     chegou a recomendar ............. ${comRecomendacao.length}  (${pct(comRecomendacao.length, total)})`);
// O denominador aparece junto de proposito: conversa que NUNCA recomendou some
// da mediana, e some justamente por ser o pior caso possivel.
console.log(`     NUNCA recomendou ............... ${semRecomendacao}  (${pct(semRecomendacao, total)})`);
console.log(`     mediana das que recomendaram ... ${mediana ?? "-"}`);
console.log(`     dentro de 4 mensagens .......... ${dentroDeQuatro}  (${pct(dentroDeQuatro, contagens.length)})`);
console.log("");
console.log("  2) QUANTAS RECEBERAM O AUDIO DE DEMONSTRACAO");
console.log(`     com pelo menos um audio ........ ${comAudio}  (${pct(comAudio, total)})`);

if (mostrarTrechos) {
  console.log("");
  console.log("  TRECHOS — o script NAO julga se o motivo esta ligado ao que ele");
  console.log("  contou. Essa metade se le aqui:");
  for (const [leadId, c] of porLead) {
    if (!c.trechoDaRecomendacao) continue;
    console.log(`    lead ${String(leadId).padStart(4)} (${c.ateRecomendar}a msg) ${c.trechoDaRecomendacao}`);
  }
}

console.log("");
console.log("  CRITERIO, declarado antes de medir:");
console.log("    recomendacao");
console.log("      passou ............ mediana <= 4 mensagens, e <10% sem recomendar");
console.log("      passou com ressalva mediana <= 6");
console.log("      falhou ............ mediana > 6, ou >25% que nunca recomendam");
console.log("    audio");
console.log("      passou ............ >=1 em cada 3 conversas");
console.log("      passou com ressalva qualquer conversa com audio");
console.log("      falhou ............ zero, ou perto disso");
console.log("");
console.log("  ⚠️ BASELINE: nao ha numero cravado aqui, ao contrario dos outros dois");
console.log("     scripts — ninguem leu uma conversa do MODO A ainda. A PRIMEIRA");
console.log("     rodada deste script E o baseline: guarde esta saida.");
console.log("");
console.log("  E confira o tamanho antes de concluir: abaixo de ~10 conversas do");
console.log("  MODO A, a porcentagem descreve o acaso, nao o comportamento.");
console.log("");
