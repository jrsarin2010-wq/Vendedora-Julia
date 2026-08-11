/**
 * Rodada 33 — a central de vigia.
 *
 * O teste que decide esta rodada é o do desacordo comercial: "tá caro" e "não
 * tenho interesse" NÃO podem marcar irritação. Se marcarem, o dono da clínica
 * recebe alerta em toda negociação normal, para de olhar os alertas, e aí os
 * casos reais passam batido — ou seja, errar para o lado do falso positivo não
 * deixa a vigia chata, deixa a vigia INÚTIL.
 *
 * O resto trava as duas coisas fáceis de quebrar: a precedência (um
 * `sem_resposta` nunca apaga um `pediu_pessoa`) e o alcance do Telegram (só os
 * dois motivos que precisam dele agora).
 */
import { ok, secao, fim } from "./assert";
import { chamarRota } from "./rota";
import { post, chamar, evento, eventoFromMe } from "./driver";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";
import { linhas } from "./stubs/logger.mjs";
import { limparEnviadas } from "../src/lib/enviadas-por-nos";
import { JULIA_EXTRACTION_PROMPT } from "../src/julia-persona";
import atencaoRouter from "../src/routes/atencao";
import {
  MOTIVOS_ATENCAO,
  MOTIVO_PT,
  avisaNoTelegram,
  deveSubstituir,
  pareceConfuso,
  pareceIrritado,
  recortarDetalhe,
  respostaLonga,
  respostaRepetida,
  similaridade,
  verificarSemResposta,
} from "../src/lib/atencao";

const NUMERO = "5585999998888";
const EXTRACAO_NEUTRA =
  '{"painPoints":null,"mainObjection":null,"name":null,"planInterest":null,"funnelStage":null,"isCustomer":false,"wantsToStop":false}';

const marcacao = (): string | null => state.leads[0]?.atencao ?? null;
const detalhe = (): string => String(state.leads[0]?.atencaoDetalhe ?? "");

/** Acha o handler pelo método e caminho, sem depender da ordem de registro. */
function acharRota(router: unknown, metodo: string, caminho: string) {
  const camada = (router as any).stack.find(
    (l: any) => l.route?.path === caminho && l.route?.methods?.[metodo],
  );
  if (!camada) throw new Error(`Rota ${metodo.toUpperCase()} ${caminho} não existe`);
  return camada.route.stack[camada.route.stack.length - 1].handle;
}

// ── Precedência ────────────────────────────────────────────────────────────

secao("precedência — o mais grave manda");
ok("lead sem marcação aceita qualquer motivo", deveSubstituir(null, "sem_resposta"));
ok(
  "sem_resposta NÃO sobrescreve pediu_pessoa",
  !deveSubstituir("pediu_pessoa", "sem_resposta"),
);
ok("irritado NÃO sobrescreve pediu_pessoa", !deveSubstituir("pediu_pessoa", "irritado"));
ok("irritado sobrescreve julia_estranha", deveSubstituir("julia_estranha", "irritado"));
ok(
  "julia_estranha sobrescreve sem_resposta",
  deveSubstituir("sem_resposta", "julia_estranha"),
);
// É deste empate que sai o "um alerta por episódio", sem contador nenhum.
ok("empate NÃO substitui", !deveSubstituir("irritado", "irritado"));
ok(
  "motivo desconhecido no banco cede para um válido",
  deveSubstituir("motivo_que_nunca_existiu", "sem_resposta"),
);
ok(
  "a ordem da lista é do mais grave para o menos grave",
  MOTIVOS_ATENCAO[0] === "pediu_pessoa" && MOTIVOS_ATENCAO[3] === "sem_resposta",
  MOTIVOS_ATENCAO.join(","),
);

// ── O caso que decide a rodada ─────────────────────────────────────────────

secao("desacordo comercial NÃO é irritação (o caso mais importante)");
for (const frase of [
  "tá caro",
  "ta caro",
  "achei caro",
  "tá caro demais pra mim",
  "não tenho interesse",
  "nao tenho interesse",
  "não é pra mim",
  "não quero",
  "to sem tempo agora",
  "depois eu vejo",
  "vou pensar",
  "agora não dá",
]) {
  ok(`"${frase}" não marca irritação`, pareceIrritado(frase) === null, String(pareceIrritado(frase)));
}

secao("irritação de verdade é pega");
for (const frase of [
  "já falei isso duas vezes",
  "ja falei isso duas vezes",
  "isso não funciona",
  "que perda de tempo",
  "você não me entende",
  "cansei",
  "não é isso que eu perguntei",
  "que péssimo atendimento",
]) {
  ok(`"${frase}" marca irritação`, pareceIrritado(frase) !== null);
}

// ── Sinais do gatilho 3, isolados ──────────────────────────────────────────

secao("gatilho 3.1 — ele reclamou de não ser entendido");
ok('"não entendi nada" é confusão', pareceConfuso("não entendi nada") !== null);
ok("sem acento também vale", pareceConfuso("nao entendi") !== null);
ok('"como assim?" é confusão', pareceConfuso("como assim?") !== null);
ok('"tá caro" NÃO é confusão', pareceConfuso("tá caro") === null);

secao("gatilho 3.3 — textão (ela quebrou a própria regra)");
ok("400 caracteres ainda passa", !respostaLonga("a".repeat(400)));
ok("401 já é textão", respostaLonga("a".repeat(401)));

secao("gatilho 3.2 — repetição");
ok("resposta idêntica é repetição", respostaRepetida("mesma coisa", "mesma coisa"));
ok("sem resposta anterior não há repetição", !respostaRepetida("qualquer coisa", null));
ok(
  "assuntos diferentes não são repetição",
  !respostaRepetida(
    "O Essencial sai R$297 nos 3 primeiros meses.",
    "Quantos profissionais atendem hoje na clínica?",
  ),
);
ok(
  "quase igual conta como repetição",
  respostaRepetida(
    "O Básico sai R$197 nos três primeiros meses, depois vai para R$297",
    "O Básico sai R$197 nos 3 primeiros meses, depois vai pra R$297",
  ),
);
ok("similaridade de textos iguais é 1", similaridade("abc", "abc") === 1);
ok("similaridade de textos sem nada em comum é baixa", similaridade("abcdef", "uvwxyz") < 0.2);

secao("o detalhe que vai para a tela é curto");
ok("detalhe longo é cortado", (recortarDetalhe("a".repeat(600)) ?? "").length <= 281);
ok("detalhe só com espaços vira null", recortarDetalhe("   ") === null);
ok("detalhe nulo continua nulo", recortarDetalhe(null) === null);

// ── Telegram: o alcance ────────────────────────────────────────────────────

secao("Telegram só para os dois que precisam dele AGORA");
ok("pediu_pessoa avisa", avisaNoTelegram("pediu_pessoa"));
ok("irritado avisa", avisaNoTelegram("irritado"));
ok("julia_estranha NÃO avisa", !avisaNoTelegram("julia_estranha"));
ok("sem_resposta NÃO avisa", !avisaNoTelegram("sem_resposta"));

// ── O prompt do extrator ───────────────────────────────────────────────────

secao("o extrator ganhou o campo irritado, e conservador");
ok('o JSON pede "irritado"', JULIA_EXTRACTION_PROMPT.includes('"irritado": <true ou false>'));
ok(
  "manda ser conservador",
  JULIA_EXTRACTION_PROMPT.includes('Regras de "irritado" (seja CONSERVADOR — na dúvida, false)'),
);
ok(
  "diz explicitamente que discordar não é estar irritado",
  JULIA_EXTRACTION_PROMPT.includes("Discordar NÃO é estar irritado"),
);
ok(
  'nomeia "tá caro" e "não tenho interesse" como false',
  JULIA_EXTRACTION_PROMPT.includes('false para desacordo comercial normal: "tá caro"') &&
    JULIA_EXTRACTION_PROMPT.includes('"não tenho interesse"'),
);

// ── Gatilho 2 no fluxo real ────────────────────────────────────────────────

secao("gatilho 2 — irritação marca e avisa no Telegram");
ctrl.reply = "Puxa, me desculpe. Deixa eu te explicar melhor.";
await post(evento("já falei isso duas vezes, isso não funciona", NUMERO));
ok("marcou irritado", marcacao() === "irritado", String(marcacao()));
ok("guardou o trecho que disparou", detalhe().includes("já falei isso duas vezes"), detalhe());
ok("guardou desde quando", Boolean(state.leads[0]?.atencaoDesde));
ok("avisou no Telegram", wa.atencoes.length === 1, JSON.stringify(wa.atencoes));
ok(
  "o alerta traz o motivo em português",
  wa.atencoes[0]?.motivo === MOTIVO_PT.irritado,
  String(wa.atencoes[0]?.motivo),
);
ok("o alerta aponta o lead certo", wa.atencoes[0]?.lead?.phone === NUMERO);

secao("o alerta de irritação sai UMA vez por episódio, não a cada mensagem");
await chamar(evento("de novo a mesma coisa, cansei", NUMERO));
ok("continua marcado como irritado", marcacao() === "irritado", String(marcacao()));
ok(
  "mas NÃO saiu um segundo Telegram",
  wa.atencoes.length === 1,
  JSON.stringify(wa.atencoes),
);

secao('"tá caro" no fluxo real não vira alerta nenhum');
ctrl.reply = "Entendo. Deixa eu te mostrar a conta do que ele devolve.";
await post(evento("tá caro", NUMERO));
ok("não marcou nada", marcacao() === null, String(marcacao()));
ok(
  "nem Telegram de atenção, nem de handoff",
  wa.atencoes.length === 0 && wa.alertas.length === 0,
  JSON.stringify({ atencoes: wa.atencoes, alertas: wa.alertas }),
);

ctrl.reply = "Sem problema. Se mudar de ideia, é só me chamar.";
await post(evento("não tenho interesse", NUMERO));
ok('"não tenho interesse" também não marca', marcacao() === null, String(marcacao()));
ok("e não avisa ninguém", wa.atencoes.length === 0, JSON.stringify(wa.atencoes));

// ── Gatilho 1 ──────────────────────────────────────────────────────────────

secao("gatilho 1 — pediu para falar com uma pessoa");
ctrl.reply = "Claro! Já aviso alguém do time pra falar com você.";
await post(evento("quero falar com uma pessoa", NUMERO));
ok("marcou pediu_pessoa", marcacao() === "pediu_pessoa", String(marcacao()));
ok("guardou o pedido dele como detalhe", detalhe().includes("falar com uma pessoa"), detalhe());
// O handoff já tinha alerta próprio desde a Rodada 17 (detalhado). Esta rodada
// não duplica: o que ela adiciona é a marcação no painel.
ok("o alerta de handoff que já existia continua saindo", wa.alertas.length === 1, JSON.stringify(wa.alertas));
ok(
  "e NÃO saiu um alerta de atenção em cima dele",
  wa.atencoes.length === 0,
  JSON.stringify(wa.atencoes),
);

secao("precedência no fluxo real — sem_resposta não apaga pediu_pessoa");
{
  // Mesmo lead da seção acima, já marcado como pediu_pessoa. Deixa a última
  // mensagem sendo dele, velha, que é o cenário exato do gatilho 4.
  state.messages.length = 0;
  state.messages.push({
    id: 5001,
    leadId: state.leads[0].id,
    direction: "inbound",
    content: "e aí, alguém vem falar comigo?",
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
  });
  state.leads[0].pausedUntil = null;

  const r = await verificarSemResposta();
  ok("o motivo continua pediu_pessoa", state.leads[0].atencao === "pediu_pessoa", String(state.leads[0].atencao));
  ok("e nada foi remarcado", r.marcados === 0, JSON.stringify(r));
  ok("o detalhe original não foi trocado", detalhe().includes("falar com uma pessoa"), detalhe());
}

// ── Gatilho 3 no fluxo real ────────────────────────────────────────────────

secao("gatilho 3 — a Júlia repetiu a resposta");
ctrl.reply = "Posso te explicar como funciona o agendamento automático?";
await post(evento("oi", NUMERO));
ok("a primeira resposta não marca nada", marcacao() === null, String(marcacao()));
await chamar(evento("e sobre o preço?", NUMERO));
ok("a segunda resposta igual marca julia_estranha", marcacao() === "julia_estranha", String(marcacao()));
ok(
  "e isso NÃO vai para o Telegram (é reclamação sobre ela, não lead pegando fogo)",
  wa.atencoes.length === 0 && wa.alertas.length === 0,
  JSON.stringify(wa.atencoes),
);

secao("gatilho 3 — textão passa de 400 caracteres");
ctrl.reply = "a".repeat(420);
await post(evento("me explica tudo sobre os planos", NUMERO));
ok("marcou julia_estranha", marcacao() === "julia_estranha", String(marcacao()));
ok("o detalhe diz o tamanho", detalhe().includes("420"), detalhe());
ok("sem Telegram", wa.atencoes.length === 0, JSON.stringify(wa.atencoes));

secao("gatilho 3 — a resposta não foi entregue");
ctrl.reply = "Oi! Tudo bem? Sou a Júlia.";
wa.entrega = false;
await post(evento("oi", NUMERO));
ok("marcou julia_estranha", marcacao() === "julia_estranha", String(marcacao()));
ok(
  "o detalhe explica que a resposta não chegou",
  detalhe().includes("não foi entregue"),
  detalhe(),
);
ok("sem Telegram", wa.atencoes.length === 0, JSON.stringify(wa.atencoes));
wa.entrega = true;

secao("gatilho 3.1 no fluxo real — ele diz que não entendeu");
ctrl.reply = "Vou reformular: ela responde o WhatsApp sozinha, 24h.";
await post(evento("não entendi nada do que você falou", NUMERO));
ok("marcou julia_estranha", marcacao() === "julia_estranha", String(marcacao()));
ok("sem Telegram", wa.atencoes.length === 0, JSON.stringify(wa.atencoes));

// ── Segunda camada da irritação ────────────────────────────────────────────

secao("segunda camada — o extrator pega o que a lista fixa não pega");
{
  ctrl.extraction =
    '{"painPoints":null,"mainObjection":null,"name":null,"planInterest":null,"funnelStage":null,"isCustomer":false,"wantsToStop":false,"irritado":true}';
  ctrl.reply = "Desculpe. Vou ser mais direta.";
  // Nenhuma palavra da lista fixa aqui: quem marca é o extrator.
  await post(evento("esquece", NUMERO));
  ok("marcou irritado sem a lista fixa", marcacao() === "irritado", String(marcacao()));
  ok("e avisou no Telegram", wa.atencoes.length === 1, JSON.stringify(wa.atencoes));
  ctrl.extraction = EXTRACAO_NEUTRA;
}

secao("lista fixa e extrator na mesma mensagem = um alerta só");
{
  ctrl.extraction =
    '{"painPoints":null,"mainObjection":null,"name":null,"planInterest":null,"funnelStage":null,"isCustomer":false,"wantsToStop":false,"irritado":true}';
  ctrl.reply = "Me desculpe mesmo.";
  await post(evento("que perda de tempo, cansei disso", NUMERO));
  ok("marcou irritado", marcacao() === "irritado", String(marcacao()));
  ok(
    "as duas camadas juntas não dobram o alerta",
    wa.atencoes.length === 1,
    JSON.stringify(wa.atencoes),
  );
  ctrl.extraction = EXTRACAO_NEUTRA;
}

// ── Gatilho 4 ──────────────────────────────────────────────────────────────

/** Monta um cenário do zero para a vigia periódica. */
function cenarioSemResposta(opcoes: {
  minutosAtras: number;
  direcao?: "inbound" | "outbound";
  status?: string;
  pausadoPor?: number;
  atencao?: string | null;
}) {
  state.reset();
  wa.reset();
  linhas.length = 0;
  state.leads.push({
    id: 1,
    phone: "5511999990000",
    name: "Marina",
    status: opcoes.status ?? "warm",
    funnelStage: "qualified",
    origin: "whatsapp",
    outreachStatus: "none",
    atencao: opcoes.atencao ?? null,
    atencaoDesde: opcoes.atencao ? new Date() : null,
    atencaoDetalhe: opcoes.atencao ? "detalhe anterior" : null,
    pausedUntil: opcoes.pausadoPor ? new Date(Date.now() + opcoes.pausadoPor * 60_000) : null,
    createdAt: new Date(),
  });
  state.messages.push({
    id: 10,
    leadId: 1,
    direction: opcoes.direcao ?? "inbound",
    content: "consegue me passar o valor?",
    createdAt: new Date(Date.now() - opcoes.minutosAtras * 60_000),
  });
}

secao("gatilho 4 — mais de 15 min sem resposta");
{
  cenarioSemResposta({ minutosAtras: 20 });
  const r = await verificarSemResposta();
  ok("marcou sem_resposta", state.leads[0].atencao === "sem_resposta", String(state.leads[0].atencao));
  ok("contou 1 marcado", r.marcados === 1, JSON.stringify(r));
  ok(
    "o detalhe é a última mensagem dele",
    String(state.leads[0].atencaoDetalhe).includes("consegue me passar o valor"),
    String(state.leads[0].atencaoDetalhe),
  );
  ok(
    "e NÃO manda Telegram",
    wa.atencoes.length === 0 && wa.alertas.length === 0,
    JSON.stringify(wa.atencoes),
  );
}

secao("gatilho 4 — 10 minutos ainda não é abandono");
{
  cenarioSemResposta({ minutosAtras: 10 });
  await verificarSemResposta();
  ok("não marcou", state.leads[0].atencao === null, String(state.leads[0].atencao));
}

secao("gatilho 4 — lead PAUSADO não vira sem_resposta");
{
  // O silêncio é intencional: ele assumiu a conversa. Cobrar resposta aqui
  // seria o sistema reclamando do próprio dono.
  cenarioSemResposta({ minutosAtras: 40, pausadoPor: 5 });
  const r = await verificarSemResposta();
  ok("não marcou", state.leads[0].atencao === null, String(state.leads[0].atencao));
  ok("nada foi marcado no ciclo", r.marcados === 0, JSON.stringify(r));
}

secao("gatilho 4 — cliente e perdido não geram cobrança");
for (const status of ["closed", "lost"]) {
  cenarioSemResposta({ minutosAtras: 60, status });
  await verificarSemResposta();
  ok(`status "${status}" não vira sem_resposta`, state.leads[0].atencao === null, String(state.leads[0].atencao));
}

secao("gatilho 4 — se a Júlia respondeu depois, o motivo se desfaz");
{
  cenarioSemResposta({ minutosAtras: 30, direcao: "outbound", atencao: "sem_resposta" });
  const r = await verificarSemResposta();
  ok("a marcação saiu", state.leads[0].atencao === null, String(state.leads[0].atencao));
  ok("o detalhe saiu junto", state.leads[0].atencaoDetalhe === null);
  ok("contou 1 limpo", r.limpos === 1, JSON.stringify(r));
}

secao("gatilho 4 — mas ele NÃO limpa os motivos que exigem uma pessoa");
for (const motivo of ["pediu_pessoa", "irritado", "julia_estranha"]) {
  cenarioSemResposta({ minutosAtras: 30, direcao: "outbound", atencao: motivo });
  await verificarSemResposta();
  ok(
    `"${motivo}" continua pendente até alguém cuidar`,
    state.leads[0].atencao === motivo,
    String(state.leads[0].atencao),
  );
}

secao("gatilho 4 — nada a fazer é silêncio no log");
{
  cenarioSemResposta({ minutosAtras: 5 });
  await verificarSemResposta();
  ok(
    "ciclo sem novidade não vira linha de log",
    !linhas.some((l: any) => l.msg.includes("Vigia de sem-resposta")),
    JSON.stringify(linhas),
  );
}

// ── Limpeza ────────────────────────────────────────────────────────────────

secao("limpeza — um fromMe humano tira da lista");
{
  ctrl.reply = "Claro, já aviso alguém do time.";
  await post(evento("quero falar com uma pessoa", NUMERO));
  ok("o lead está marcado", marcacao() === "pediu_pessoa", String(marcacao()));

  linhas.length = 0;
  limparEnviadas(); // nada que venha agora foi registrado como nosso
  await chamar(eventoFromMe("Oi doutor, é o Renato, deixa comigo", NUMERO, "CELULAR-33"));

  ok("a marcação saiu", marcacao() === null, String(marcacao()));
  ok("o detalhe saiu junto", state.leads[0].atencaoDetalhe === null);
  ok(
    "e ficou registrado no log",
    linhas.some((l: any) => l.msg.includes("Atenção resolvida")),
    JSON.stringify(linhas),
  );
}

secao("limpeza — a resposta da própria Júlia NÃO tira da lista");
{
  // Se a resposta dela limpasse, um lead irritado sairia da lista assim que a
  // Júlia dissesse qualquer coisa — que é justamente quando ele mais precisa
  // de uma pessoa.
  ctrl.reply = "Me desculpe, vou te explicar de novo.";
  await post(evento("já falei isso, você não me entende", NUMERO));
  ok("marcou irritado", marcacao() === "irritado", String(marcacao()));
  ctrl.reply = "Outra resposta, bem diferente da anterior, sobre agendamento.";
  await chamar(evento("tá", NUMERO));
  ok("continua marcado depois de ela responder", marcacao() === "irritado", String(marcacao()));
}

// ── As rotas do painel ─────────────────────────────────────────────────────

const listar = acharRota(atencaoRouter, "get", "/atencao");
const resolver = acharRota(atencaoRouter, "post", "/leads/:id/atencao/resolver");

secao("as rotas da central existem");
ok("GET /atencao existe", typeof listar === "function");
ok("POST /leads/:id/atencao/resolver existe", typeof resolver === "function");

secao("GET /atencao — o que o painel mostra");
{
  state.reset();
  wa.reset();
  state.leads.push({
    id: 7,
    phone: "5511900000001",
    name: "Marina",
    status: "warm",
    atencao: "irritado",
    atencaoDesde: new Date(Date.now() - 60_000),
    atencaoDetalhe: "já falei isso duas vezes",
    painPoints: "perde paciente fora do horário",
    createdAt: new Date(),
  });
  // Um lead SEM marcação, para provar que a rota filtra.
  state.leads.push({
    id: 8,
    phone: "5511900000002",
    name: "Carlos",
    status: "warm",
    atencao: null,
    createdAt: new Date(),
  });

  const r = await chamarRota(listar);
  const corpo = r.body as any;
  ok("responde 200", r.status === 200, String(r.status));
  ok("traz só quem está marcado", corpo.total === 1, JSON.stringify(corpo));
  ok("com o motivo em português", corpo.itens[0].motivoTexto === MOTIVO_PT.irritado, corpo.itens[0].motivoTexto);
  ok("com o código do motivo, para o selo da lista", corpo.itens[0].motivo === "irritado");
  ok(
    "com o telefone como link de WhatsApp (é ali que ele responde)",
    corpo.itens[0].whatsapp === "https://wa.me/5511900000001",
    corpo.itens[0].whatsapp,
  );
  ok("com o trecho que disparou", corpo.itens[0].detalhe === "já falei isso duas vezes");
  ok("e com a dor, para ele entrar com contexto", corpo.itens[0].painPoints === "perde paciente fora do horário");
}

secao("GET /atencao — o mais antigo vem primeiro");
{
  state.leads[1].atencao = "sem_resposta";
  state.leads[1].atencaoDesde = new Date(Date.now() - 5 * 60_000); // mais antigo
  const corpo = (await chamarRota(listar)).body as any;
  ok("dois marcados", corpo.total === 2, JSON.stringify(corpo));
  ok(
    "quem espera há mais tempo aparece antes",
    corpo.itens[0].id === 8 && corpo.itens[1].id === 7,
    corpo.itens.map((i: any) => i.id).join(","),
  );
}

secao('o botão "Já cuidei disso" limpa a marcação');
{
  const r = await chamarRota(resolver, { params: { id: "7" } });
  ok("responde 200", r.status === 200, String(r.status));
  ok("diz que resolveu", (r.body as any).resolvido === true, JSON.stringify(r.body));

  const lead = state.leads.find((l: any) => l.id === 7);
  ok("a marcação saiu do banco", lead.atencao === null, String(lead.atencao));
  ok("o detalhe saiu junto", lead.atencaoDetalhe === null);
  ok("e o 'desde' também", lead.atencaoDesde === null);

  const corpo = (await chamarRota(listar)).body as any;
  ok("e ele saiu da lista", !corpo.itens.some((i: any) => i.id === 7), JSON.stringify(corpo));
}

secao("resolver é idempotente — dois cliques não viram erro");
{
  const r = await chamarRota(resolver, { params: { id: "7" } });
  ok("continua 200", r.status === 200, String(r.status));
  ok("mas informa que não havia nada", (r.body as any).resolvido === false, JSON.stringify(r.body));
}

secao("resolver — id inexistente e id inválido");
{
  const inexistente = await chamarRota(resolver, { params: { id: "9999" } });
  ok("lead inexistente → 404", inexistente.status === 404, String(inexistente.status));
  const invalido = await chamarRota(resolver, { params: { id: "abc" } });
  ok("id não numérico → 400", invalido.status === 400, String(invalido.status));
}

fim();
