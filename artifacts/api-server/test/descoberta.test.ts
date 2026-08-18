/**
 * RODADA 54 — a porta de saida.
 *
 * A mesma pergunta sobre anuncio saiu SEIS vezes numa conversa, com DUAS
 * recusas explicitas no meio. E noutra a Julia repetiu "quantos profissionais"
 * depois de ja ter sido respondida.
 *
 * Duas causas somadas, e as duas precisavam cair:
 *
 * 1) SEIS blocos do prompt mandavam perguntar, nenhum dizia quando parar, e
 *    dois carregavam carimbo de inviolabilidade ("NUNCA QUEBRA", "nao pule
 *    esta"). Agora a regra de parada e canonica e os outros pontos apontam.
 *
 * 2) NAO HAVIA ONDE LEMBRAR. A ficha carregava dor, objecao, etapa e plano, e
 *    nada sobre o que ja tinha sido perguntado — a unica memoria era a janela
 *    de 20 mensagens. Passado disso, a pergunta volta como se fosse a primeira.
 *
 * O principio, do dono: nenhuma pergunta e obrigatoria a ponto de valer mais
 * que a conversa. Perder a informacao custa uma recomendacao imprecisa;
 * insistir custa o dentista.
 */
import { ok, secao, fim } from "./assert";
import { post, chamar, evento, zerar } from "./driver";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";
import { readFileSync } from "node:fs";
import {
  SEM_RESPOSTA,
  TOPICOS,
  blocoDaFicha,
  escreverDescoberta,
  jaPerguntado,
  lerDescoberta,
  limparValor,
  perguntasRepetidas,
  registrarDescoberta,
  topicosPerguntados,
} from "../src/lib/descoberta";
import { JULIA_SYSTEM_PROMPT, JULIA_EXTRACTION_PROMPT, buildLeadBriefing } from "../src/julia-persona";

const extracao = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    painPoints: null,
    mainObjection: null,
    name: null,
    planInterest: null,
    funnelStage: null,
    isCustomer: false,
    wantsToStop: false,
    irritado: false,
    duvidaDoSite: null,
    sinais: [],
    interlocutor: "nao_sei",
    descoberta: {},
    ...extra,
  });

// ── A — ler, escrever e fundir ──────────────────────────────────────────────

secao("A — a coluna guarda o que foi perguntado E a resposta");

ok("le um par", lerDescoberta("anuncia=instagram").anuncia === "instagram");
ok("le varios", lerDescoberta("anuncia=instagram;profissionais=2").profissionais === "2");
ok("topico desconhecido e ignorado", lerDescoberta("bobagem=1").bobagem === undefined);
ok("vazio devolve vazio", Object.keys(lerDescoberta(null)).length === 0);
ok("ida e volta", lerDescoberta(escreverDescoberta({ anuncia: "google" })).anuncia === "google");

ok(
  "separador dentro do valor nao corrompe a linha",
  limparValor("R$500; por=mes") === "R$500 por mes",
  String(limparValor("R$500; por=mes")),
);
ok("valor comprido e cortado", (limparValor("x".repeat(200)) ?? "").length <= 40);

secao("A2 — a fusao, e a precedencia que impede a pergunta de voltar");

ok(
  "o que ja estava fica",
  lerDescoberta(registrarDescoberta("anuncia=instagram", {})).anuncia === "instagram",
);
ok(
  "o novo entra",
  lerDescoberta(registrarDescoberta("anuncia=instagram", { profissionais: "2" }))
    .profissionais === "2",
);
ok(
  "resposta de verdade SUBSTITUI sem_resposta (ele contou depois)",
  lerDescoberta(registrarDescoberta(`anuncia=${SEM_RESPOSTA}`, { anuncia: "google" })).anuncia ===
    "google",
);
// A precedencia que importa: se sem_resposta pudesse apagar uma resposta, um
// turno em que o extrator nao enxergou o assunto faria a pergunta voltar — o
// defeito exato que esta rodada existe para matar.
ok(
  "sem_resposta NAO apaga resposta de verdade",
  lerDescoberta(registrarDescoberta("anuncia=google", { anuncia: SEM_RESPOSTA })).anuncia ===
    "google",
);
ok(
  "topico invalido do modelo e descartado em silencio",
  registrarDescoberta("", { inventado: "x" }) === "",
);

secao("A3 — sem_resposta CONTA como perguntada");

ok("respondida conta", jaPerguntado("anuncia=google", "anuncia"));
ok(
  "e sem_resposta tambem — e esse o coracao da porta de saida",
  jaPerguntado(`anuncia=${SEM_RESPOSTA}`, "anuncia"),
);
ok("o que nunca saiu, nao", !jaPerguntado("profissionais=2", "anuncia"));

// ── B — reconhecer a Julia perguntando ──────────────────────────────────────

secao("B — o detector so conta o que e PERGUNTA");

ok("pergunta de anuncio", topicosPerguntados("E me diz: você anuncia? Instagram, Google?").includes("anuncia"));
ok("pergunta de profissionais", topicosPerguntados("Quantos profissionais atendem aí?").includes("profissionais"));
ok("pergunta de verba", topicosPerguntados("Quanto você investe por mês?").includes("verba"));

// O falso positivo que derrubaria tudo: ela FALA de anuncio o tempo todo no
// argumento de venda. Argumento nao e pergunta.
ok(
  "argumento sobre anuncio NAO conta",
  topicosPerguntados("Cada paciente que some levou junto o dinheiro do anúncio.").length === 0,
  JSON.stringify(topicosPerguntados("Cada paciente que some levou junto o dinheiro do anúncio.")),
);
ok(
  "afirmacao com o mesmo fragmento NAO conta",
  topicosPerguntados("Hoje quem responde o whatsapp é você, e isso custa paciente.").length === 0,
);
ok(
  "mas a mesma frase COM interrogacao conta",
  topicosPerguntados("Hoje quem responde o whatsapp da clínica?").includes("quem_responde"),
);
ok("mensagem sem pergunta nenhuma", topicosPerguntados("Boa noite! Fico à disposição.").length === 0);

secao("B2 — e a cerca: repetir o que ele ja respondeu");

ok(
  "repetiu o que ja estava respondido",
  perguntasRepetidas("E você anuncia?", "anuncia=google").includes("anuncia"),
);
ok(
  "repetiu o que ele se recusou a responder",
  perguntasRepetidas("E você anuncia?", `anuncia=${SEM_RESPOSTA}`).includes("anuncia"),
);
ok(
  "perguntar pela PRIMEIRA vez nao e repetir",
  perguntasRepetidas("E você anuncia?", "profissionais=2").length === 0,
);
ok("sem coluna, nada e repeticao", perguntasRepetidas("E você anuncia?", null).length === 0);

// ── C — a ficha ─────────────────────────────────────────────────────────────

secao("C — a ficha passa a carregar o que ja foi perguntado");

const ficha = (descoberta: string | null) =>
  buildLeadBriefing({
    name: "Marina",
    funnelStage: "qualified",
    painPoints: null,
    mainObjection: null,
    planInterest: null,
    daysSinceLastMessage: 1,
    isReturning: false,
    totalMessages: 6,
    origin: "maps",
    interlocutor: "dentista_dono",
    descoberta,
  });

ok("mostra a resposta", ficha("anuncia=instagram").includes("se anuncia: instagram"));
// O cabecalho, e nao "JA perguntou" solto: essa frase tambem aparece no bloco
// COMO USAR, que sai em toda ficha — a assercao passaria sempre.
ok(
  "lista o que ja saiu",
  ficha("anuncia=instagram").includes("- O que você JÁ perguntou nesta conversa"),
);
ok(
  "e diz explicitamente para nao repetir o que ele NAO respondeu",
  ficha(`anuncia=${SEM_RESPOSTA}`).includes("NÃO respondeu"),
  ficha(`anuncia=${SEM_RESPOSTA}`),
);
ok(
  "sem nada perguntado, o bloco nao existe (ficha vazia e ruido)",
  !ficha(null).includes("- O que você JÁ perguntou nesta conversa"),
);
ok("blocoDaFicha devolve null quando nao ha o que dizer", blocoDaFicha(null) === null);

// ── D — o prompt ────────────────────────────────────────────────────────────

secao("D — a regra de parada existe, e e UMA");

ok(
  "a regra canonica esta la",
  JULIA_SYSTEM_PROMPT.includes("TODA PERGUNTA DE DESCOBERTA SE FAZ UMA VEZ SÓ"),
);
ok(
  "desconversar conta como respondida",
  JULIA_SYSTEM_PROMPT.includes("conta\ncomo respondida com NÃO SEI"),
);
ok("reformular e repetir", JULIA_SYSTEM_PROMPT.includes("Reformular é repetir"));
ok("e a ficha e citada como fonte", JULIA_SYSTEM_PROMPT.includes("A ficha lista o que já saiu"));

secao("D2 — o 'NUNCA QUEBRA' mudou de objeto: do PERGUNTAR para o RECOMENDAR");

ok(
  "a trava de seguranca do Basico continua",
  JULIA_SYSTEM_PROMPT.includes("não\nofereça o Básico sem saber que ele atende sozinho"),
);
ok(
  "mas ela nao manda mais arrancar a resposta",
  !JULIA_SYSTEM_PROMPT.includes("NUNCA QUEBRA — PERGUNTE QUANTOS PROFISSIONAIS"),
);
ok(
  "e existe caminho sem a resposta: recomenda assumindo",
  JULIA_SYSTEM_PROMPT.includes("SEM RESPOSTA, recomende o ESSENCIAL"),
);
ok(
  "dizendo o que assumiu",
  JULIA_SYSTEM_PROMPT.includes("Tô\nconsiderando que tem mais alguém atendendo"),
);
// O sentido da escolha: errar para cima e reversivel, errar para baixo nao.
ok(
  "e o porque da direcao esta escrito",
  JULIA_SYSTEM_PROMPT.includes("errar para baixo ele assina e a sócia não cabe"),
);

secao("D3 — a obrigacao de perguntar anuncio virou UMA");

{
  // Antes eram seis blocos mandando perguntar. O que sobra agora e a pergunta
  // na lista da FASE 2 (uma vez) e a regra de parada. Nenhum outro lugar pode
  // voltar a mandar perguntar.
  const mandaPerguntar = [
    "PERGUNTE CEDO, em toda conversa",
    "não pule esta",
  ].filter((frase) => JULIA_SYSTEM_PROMPT.includes(frase));
  ok(
    "nenhum carimbo de obrigacao sem saida sobrou",
    mandaPerguntar.length === 0,
    JSON.stringify(mandaPerguntar),
  );
}

ok(
  "o extrator sabe devolver o que ja foi perguntado",
  JULIA_EXTRACTION_PROMPT.includes('Regras de "descoberta"'),
);
ok(
  "e sabe que sem_resposta e informacao, nao falha",
  JULIA_EXTRACTION_PROMPT.includes("Isso não é falha — é informação"),
);

// ── E — o webhook ───────────────────────────────────────────────────────────

secao("E — a resposta dele fica guardada, e a ficha seguinte a carrega");

{
  ctrl.extraction = extracao({ descoberta: { anuncia: "instagram" } });
  await post(evento("anuncio no instagram sim"));
  ok("gravou", (state.leads[0] as any).descoberta === "anuncia=instagram", String((state.leads[0] as any).descoberta));

  ctrl.extraction = extracao({ descoberta: { profissionais: "2" } });
  await chamar(evento("somos duas"));
  ok(
    "acumulou sem perder o anterior",
    (state.leads[0] as any).descoberta === "anuncia=instagram;profissionais=2",
    String((state.leads[0] as any).descoberta),
  );
}

secao("E2 — a recusa vira sem_resposta, e nao some");

{
  ctrl.extraction = extracao({ descoberta: { anuncia: SEM_RESPOSTA } });
  await post(evento("prefiro não falar disso"));
  ok(
    "recusa registrada como perguntada",
    jaPerguntado((state.leads[0] as any).descoberta, "anuncia"),
    String((state.leads[0] as any).descoberta),
  );

  // O turno seguinte nao menciona o assunto: o extrator devolve {} e a memoria
  // NAO pode se perder, senao a pergunta volta.
  ctrl.extraction = extracao({ descoberta: {} });
  await chamar(evento("e como funciona o trial?"));
  ok(
    "e a memoria sobrevive ao turno que nao falou do assunto",
    jaPerguntado((state.leads[0] as any).descoberta, "anuncia"),
    String((state.leads[0] as any).descoberta),
  );
}

secao("E3 — se ela repetir assim mesmo, o dono fica sabendo");

{
  ctrl.extraction = extracao({ descoberta: { anuncia: "google" } });
  await post(evento("anuncio no google"));
  ok("primeira passada limpa", !(state.leads[0] as any).atencao);

  ctrl.reply = "Entendi! E me diz uma coisa: você anuncia? Instagram, Google?";
  ctrl.extraction = extracao();
  await chamar(evento("beleza"));
  const lead = state.leads[0] as any;
  ok("o lead foi para a central", lead.atencao === "julia_estranha", String(lead.atencao));
  ok(
    "e o alerta diz QUAL pergunta ela repetiu",
    (lead.atencaoDetalhe ?? "").includes("se anuncia"),
    String(lead.atencaoDetalhe),
  );
  ctrl.reply = "Oi! Como posso te ajudar?";
}

secao("E4 — perguntar pela primeira vez nao acusa nada");

{
  ctrl.extraction = extracao();
  ctrl.reply = "Oi! E me diz: você anuncia? Instagram, Google?";
  await post(evento("oi"));
  ok("nenhuma marcacao", !(state.leads[0] as any).atencao, String((state.leads[0] as any).atencao));
  ctrl.reply = "Oi! Como posso te ajudar?";
}

// ── F — o script de medicao ─────────────────────────────────────────────────

secao("F — o script de medicao nao pode divergir do modulo");

{
  // O script roda contra producao sem passar pelo build, entao ele COPIA os
  // fragmentos em vez de importar. O custo dessa escolha e este: se as duas
  // listas divergirem, a medicao passa a medir outra coisa que nao o que o
  // sistema faz — e ninguem perceberia, porque os dois lados continuariam
  // "funcionando".
  const fonte = readFileSync(new URL("../../scripts/medir-repeticao.mjs", import.meta.url), "utf8");
  const faltando = TOPICOS.filter((t) => !fonte.includes(`${t}:`));
  ok("o script conhece os mesmos topicos", faltando.length === 0, JSON.stringify(faltando));
  ok(
    "e usa a mesma regra de 'so dentro de pergunta'",
    fonte.includes("dentroDePergunta"),
  );
  ok("e e somente leitura", !/INSERT|UPDATE|DELETE/i.test(fonte), "o script escreve no banco!");

  // As DUAS bordas. O baseline nao precisa ser medido antes de subir — as
  // mensagens moram no banco, e o deploy nao apaga nenhuma (as colunas desta
  // frente nascem anulaveis, sem backfill). Sem `--ate` isso deixaria de ser
  // verdade na pratica: o "antes" existiria no banco e nao teria como ser lido.
  ok("sabe cortar para tras (--ate), que e o baseline", fonte.includes('"--ate"'));
  ok("e para frente (--desde), que e a era nova", fonte.includes('"--desde"'));
  // O script importa `pg` diretamente, entao a api-server precisa declara-lo:
  // com o pnpm isolando dependencias, `pg` de lib/db NAO resolve daqui, e o
  // script morria no import antes de rodar uma linha.
  const pacote = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  ok("e a dependencia dele esta declarada", Boolean(pacote.dependencies?.pg), "falta pg");
}

fim();
