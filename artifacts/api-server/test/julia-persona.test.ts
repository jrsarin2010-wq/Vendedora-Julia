/**
 * A ficha do lead e os templates de follow-up — as partes da persona que são
 * determinísticas e, portanto, testáveis sem chamar o modelo.
 */
import { ok, secao, fim } from "./assert";
import {
  ABORDAGEM_TOQUES,
  FOLLOW_UP_TEMPLATES,
  JULIA_SYSTEM_PROMPT,
  JULIA_OUTREACH_PROMPT,
  TETO_DE_TOKENS,
  tamanhoEmTokens,
  buildLeadBriefing,
  buildOutreachBriefing,
} from "../src/julia-persona";
import { detectarTratamento, saudacao } from "../src/lib/tratamento";

const ficha = (
  name: string | null,
  origin: string | null = null,
  // RODADA 52: o título "Dr."/"Dra." é do DENTISTA, então a ficha só o entrega
  // quando sabe que é com ele que se está falando. Estas asserções sempre
  // testaram a regra de GÊNERO, e o gênero só é consultado depois dessa
  // pergunta — por isso a pré-condição vira explícita aqui, em vez de
  // implícita como era quando o sistema presumia que todo mundo era o dono.
  interlocutor: string | null = "dentista_dono",
) =>
  buildLeadBriefing({
    name,
    funnelStage: "qualified",
    painPoints: null,
    mainObjection: null,
    planInterest: null,
    daysSinceLastMessage: 2,
    isReturning: true,
    totalMessages: 8,
    origin,
    interlocutor,
  });

secao("Dr./Dra. determinístico na ficha do lead");
ok('"Michele" → Dra.', ficha("Michele").includes("trate como: Dra. Michele"));
ok('"Carlos" → Dr.', ficha("Carlos").includes("trate como: Dr. Carlos"));
ok('"Raquel" → Dra.', ficha("Raquel").includes("trate como: Dra. Raquel"));
ok('"Alex" → ambíguo', ficha("Alex").includes("nome ambíguo"));
ok('"Yuri" → ambíguo', ficha("Yuri").includes("nome ambíguo"));
ok('"raquel silva" → só o primeiro nome, capitalizado', ficha("raquel silva").includes("trate como: Dra. Raquel"));
ok("sem nome → manda perguntar", ficha(null).includes("ainda não sei"));
ok('nunca escreve "Dr(a)."', !ficha("Alex").includes("Dr(a)"));

// RODADA 52 — o título não sai por padrão, só quando se sabe que é o dentista.
// Sem esta cerca, a regra de gênero acima (que é boa) voltaria a ser aplicada a
// quem não é dentista, que foi como uma assistente virtual virou "Dr. Romero".
ok(
  "sem saber quem é do outro lado, nome feminino NÃO vira Dra.",
  !ficha("Marina", null, null).includes("Dra. Marina"),
  ficha("Marina", null, null),
);
ok(
  "e a ficha diz que não sabe, em vez de calar e deixar o modelo supor",
  ficha("Marina", null, null).includes("ainda NÃO SABE"),
);

secao("origem do lead na ficha — a Júlia não inventa de onde ele veio");
// O bug real: ela abria com "vi que você deu uma olhada na gente" para quem
// tinha mandado só um "oi". Sem origem conhecida, a ficha tem que dizer isso.
ok("sem origem → manda não inventar", ficha("Carlos", null).includes("Não invente origem"));
ok(
  '"whatsapp" NÃO é origem: é o lead que chegou sozinho',
  ficha("Carlos", "whatsapp").includes("Não invente origem"),
);
ok('"inbound" também conta como chegou sozinho', ficha("Carlos", "inbound").includes("Não invente origem"));
ok(
  "chegou sozinho → a ficha nunca autoriza citar",
  !ficha("Carlos", "whatsapp").includes("pode citar"),
);
ok('"instagram" → autoriza citar', ficha("Carlos", "instagram").includes("instagram (pode citar, é verdade)"));
ok('"maps" → autoriza citar', ficha("Carlos", "maps").includes("maps (pode citar, é verdade)"));
ok(
  "origem conhecida não traz o aviso de não inventar",
  !ficha("Carlos", "instagram").includes("Não invente origem"),
);

secao("prompt da Júlia — a abertura não afirma o que ela não sabe");
ok("a regra de ouro está no prompt", JULIA_SYSTEM_PROMPT.includes("REGRA DE OURO, vale nos dois"));
ok(
  "o exemplo que virou script saiu do prompt",
  !JULIA_SYSTEM_PROMPT.includes("Vi que você deu uma olhada na gente. Antes de mais nada"),
);
ok("a abertura manda variar", JULIA_SYSTEM_PROMPT.includes("VARIE."));
ok(
  "o prompt oferece mais de um exemplo de tom",
  JULIA_SYSTEM_PROMPT.includes("Como posso te chamar?") &&
    JULIA_SYSTEM_PROMPT.includes("Com quem eu tenho o prazer?"),
);

secao('"que produto é esse?" — a pergunta do lead que nunca ouviu falar do CaptaClin');
{
  const inicio = JULIA_SYSTEM_PROMPT.indexOf(
    "## QUANDO A PERGUNTA É SOBRE O PRODUTO, NÃO SOBRE PLANO",
  );
  const fim = JULIA_SYSTEM_PROMPT.indexOf("## O CAPTACLIN NÃO TEM CONCORRENTE");
  ok("a seção existe", inicio > -1 && fim > inicio);
  const secaoProduto = JULIA_SYSTEM_PROMPT.slice(inicio, fim);

  ok(
    "explica no vocabulário de secretária digital, sem termo técnico",
    secaoProduto.includes("uma secretária\n   digital que atende o WhatsApp da clínica") &&
      secaoProduto.includes("nenhum termo técnico"),
    secaoProduto,
  );
  ok(
    "manda caber em uma ou duas frases",
    secaoProduto.includes("em uma ou duas frases"),
  );
  ok(
    "e devolver UMA pergunta que dimensione a situação dele",
    secaoProduto.includes("UMA pergunta que dimensione a situação dele"),
  );
  ok(
    "sem link, sem plano, sem valor — nada disso foi perguntado",
    secaoProduto.includes("NÃO ENTRA NESTA RESPOSTA: link, nome de plano, valor"),
  );
  ok(
    "e amarra na regra de preço como o passo anterior dela",
    secaoProduto.includes("NUNCA DÊ PREÇO NA PRIMEIRA\nRESPOSTA SOBRE PLANO"),
  );
  // A lição das quatro rodadas da abordagem: frase pronta no prompt vira frase
  // transcrita na saída. Esta seção descreve comportamento — se alguém um dia
  // acrescentar uma fala de exemplo aqui, ela vira o roteiro de toda explicação
  // do produto, que é o pior lugar possível para uma resposta decorada.
  {
    // A única linha entre aspas legítima é a de GATILHOS — as perguntas que o
    // DENTISTA faz. Qualquer aspa a mais seria uma fala da Júlia, e aí a
    // explicação do produto vira roteiro decorado.
    const comAspas = secaoProduto.split("\n").filter((l) => l.trim().startsWith('"'));
    ok(
      "a única linha entre aspas é a das perguntas DELE, não uma fala pronta dela",
      comAspas.length === 1 && comAspas[0]!.includes("Que negócio é esse?"),
      comAspas.join(" | "),
    );
  }
}

secao("recusa comercial no MODO B — a resposta mais provável de quem não pediu contato");
{
  // As 14 objeções mapeadas pressupõem alguém INTERESSADO: todas ensinam a
  // reenquadrar e continuar. Um "não tenho interesse" lido como objeção comum
  // faz a Júlia responder com trial ou comparação de custo — exatamente o
  // comportamento que gera denúncia em quem nunca pediu esse contato. A regra
  // do AGRADEÇA E SAIA existia só no prompt de ABORDAGEM, e faltava aqui, que
  // é onde a conversa de verdade acontece.
  const inicio = JULIA_SYSTEM_PROMPT.indexOf("## OBJEÇÕES");
  const primeiraObjecao = JULIA_SYSTEM_PROMPT.indexOf('"Eu atendo convênio"');
  const portao = JULIA_SYSTEM_PROMPT.slice(inicio, primeiraObjecao);

  ok(
    "o portão vem ANTES da primeira objeção da lista",
    inicio > -1 && primeiraObjecao > inicio,
  );
  ok(
    "separa objeção de recusa pelo critério certo",
    portao.includes('OBJEÇÃO é "não vejo valor nisso"') &&
      portao.includes('RECUSA é "não quero falar"') &&
      portao.includes("Objeção se RESPONDE") &&
      portao.includes("Recusa se RESPEITA"),
    portao,
  );
  ok(
    "nomeia as recusas típicas de quem não pediu contato",
    ["não tenho interesse", "não quero", "não uso essas\ncoisas", "obrigado mas não"].every(
      (r) => portao.includes(r),
    ),
    portao,
  );
  ok(
    "a regra VENCE as 14 objeções, e diz isso",
    portao.includes("esta regra vence TUDO abaixo") &&
      portao.includes("Nenhuma objeção\nabaixo se aplica"),
  );
  ok(
    "proíbe as quatro saídas que a lista abaixo ensinaria",
    portao.includes("NÃO reenquadre") &&
      portao.includes("NÃO ofereça o trial") &&
      portao.includes("NÃO compare custo") &&
      portao.includes("NÃO\nfaça mais uma pergunta"),
    portao,
  );
  ok(
    "e nem o link de consolação",
    portao.includes('NÃO deixe o link "caso mude de ideia"'),
  );
  ok(
    "é inegociável no MODO B, com o motivo (denúncia derruba o número inteiro)",
    portao.includes("No MODO B é inegociável") &&
      portao.includes("denúncia derruba o número inteiro"),
  );
  // A trava contrária: sair cedo demais de conversa viva também é erro.
  ok(
    "adiamento e 'tá caro' continuam sendo objeção, não recusa",
    portao.includes("NÃO CONFUNDA COM ADIAMENTO") &&
      ["vou pensar", "agora não", "me chama semana que\nvem", "tá caro"].every((a) =>
        portao.includes(a),
      ),
    portao,
  );
  ok(
    "o portão descreve comportamento, sem fala pronta para copiar",
    portao.split("\n").filter((l) => l.trim().startsWith('"')).length === 0,
    portao,
  );
}

secao("FASE 2 no MODO B — descoberta não pode virar interrogatório");
{
  const inicio = JULIA_SYSTEM_PROMPT.indexOf("FASE 2 — DESCOBERTA");
  const fim = JULIA_SYSTEM_PROMPT.indexOf("FASE 3 — FAZER SENTIR");
  const fase2 = JULIA_SYSTEM_PROMPT.slice(inicio, fim);

  ok("a ressalva do MODO B vem no começo da FASE 2", fase2.includes("NO MODO B, COMECE MAIS LEVE"));
  ok(
    "explica por quê: as perguntas pressupõem interesse que ele não demonstrou",
    fase2.includes("pressupõem um interesse que ele ainda não demonstrou"),
  );
  ok(
    "segura as perguntas de dinheiro e volume até ELE puxar o assunto",
    fase2.includes("não entre em número de paciente, dinheiro perdido nem") &&
      fase2.includes("enquanto ELE não puxar o assunto"),
    fase2,
  );
  ok(
    "e nomeia o que conta como ele puxar o assunto",
    fase2.includes("perguntando como\nfunciona, reclamando do WhatsApp, contando da clínica"),
  );
  ok("uma pergunta por vez", fase2.includes("UMA pergunta por vez"));
}

secao("Rodada 28 — dois modos de abertura");
ok("existe MODO A (ele chamou)", JULIA_SYSTEM_PROMPT.includes("MODO A — ELE CHAMOU VOCÊ"));
ok("existe MODO B (ela chamou)", JULIA_SYSTEM_PROMPT.includes("MODO B — VOCÊ CHAMOU ELE"));
ok(
  "o MODO A casa com o texto que a ficha escreve para quem chegou sozinho",
  JULIA_SYSTEM_PROMPT.includes('ficha diz "chegou sozinho pelo WhatsApp"') &&
    ficha("Carlos", null).includes("ele chegou sozinho pelo WhatsApp"),
);
ok(
  "o MODO B cita as origens que a ficha realmente grava",
  JULIA_SYSTEM_PROMPT.includes("ficha diz import, maps ou instagram"),
);
ok(
  // Rodada 42 reescreveu a abertura: a pergunta dele não é ignorada — o
  // essencial vai em uma frase, com o pedido do nome na mesma mensagem.
  "no MODO A a pergunta dele não é ignorada para pedir o nome",
  JULIA_SYSTEM_PROMPT.includes("ignorar a pergunta dele para pedir o nome irrita"),
);
// O MODO B DESCREVIA A MENSAGEM ERRADA. Ele ensinava a escrever a PRIMEIRA
// mensagem do lead frio — que hoje é do JULIA_OUTREACH_PROMPT e já saiu quando
// este prompt roda. O webhook só é chamado quando o dentista RESPONDE, então
// tudo que o MODO B governa acontece da segunda mensagem em diante.
ok(
  "o MODO B governa a conversa DEPOIS que ele respondeu, não a abertura",
  JULIA_SYSTEM_PROMPT.includes("MODO B — VOCÊ CHAMOU ELE, E ELE RESPONDEU") &&
    JULIA_SYSTEM_PROMPT.includes("A primeira mensagem JÁ SAIU") &&
    JULIA_SYSTEM_PROMPT.includes("conversa começa na sua segunda mensagem"),
);
ok(
  "e a FASE 1 avisa que os dois modos escrevem mensagens diferentes",
  JULIA_SYSTEM_PROMPT.includes("No MODO A você está escrevendo a PRIMEIRA mensagem"),
);
ok(
  "não manda repetir a origem, que a abordagem fria já disse",
  JULIA_SYSTEM_PROMPT.includes("Ele JÁ SABE de onde você viu a clínica"),
);
// As duas frases prontas de licença tinham sido removidas do prompt de
// abordagem por causar transcrição literal, e sobreviveram AQUI porque ninguém
// tinha auditado este arquivo. No MODO B elas eram duplamente erradas: frase
// pronta, e frase para uma mensagem que este prompt nem escreve.
ok(
  "e as frases prontas de licença não sobrevivem em NENHUM dos dois prompts",
  !JULIA_SYSTEM_PROMPT.includes("Posso te roubar um minuto?") &&
    !JULIA_SYSTEM_PROMPT.includes("PEÇA LICENÇA de verdade"),
);
ok(
  "no MODO B ela não emenda venda na primeira resposta dele",
  JULIA_SYSTEM_PROMPT.includes("Não emende venda na primeira resposta dele"),
);
ok(
  "não pergunta o nome duas vezes",
  JULIA_SYSTEM_PROMPT.includes("se ele já disse o nome, não pergunte de novo"),
);

secao("Rodada 28 — conhecimento completo dos planos");
ok(
  "define o que é uma conversa (é a dúvida nº1 de quem chega pela landing)",
  JULIA_SYSTEM_PROMPT.includes("1 conversa = TODAS as mensagens trocadas com 1 paciente em até 24h"),
);
for (const [plano, conversas] of [
  ["BÁSICO", "200 conversas por mês"],
  ["ESSENCIAL", "300 conversas por mês"],
  ["PRO", "500 conversas por mês"],
] as const) {
  ok(`${plano} tem a cota de conversas`, JULIA_SYSTEM_PROMPT.includes(conversas));
}
ok("recarga de 200 por R$97", JULIA_SYSTEM_PROMPT.includes("200 extras por R$97"));
ok("recarga de 400 por R$177", JULIA_SYSTEM_PROMPT.includes("400 extras por R$177"));
ok(
  "profissional adicional soma conversas",
  JULIA_SYSTEM_PROMPT.includes("Profissional adicional: R$97/mês (some +100 conversas/mês)"),
);
ok(
  "o Pro já vem com um profissional extra",
  JULIA_SYSTEM_PROMPT.includes("1 profissional extra JÁ INCLUSO"),
);
ok(
  "ligação por IA continua sendo 'em breve', sem data",
  JULIA_SYSTEM_PROMPT.includes("EM BREVE, ainda não existe. Nunca prometa data"),
);
ok(
  "cada plano diz o que NÃO tem (admitir falha cria confiança)",
  (JULIA_SYSTEM_PROMPT.match(/NÃO tem:/g) ?? []).length >= 2,
);
ok(
  "o link do site sobreviveu à troca da seção",
  JULIA_SYSTEM_PROMPT.includes("https://www.captaclin.com.br (mande o link no fechamento"),
);

secao("Rodada 29 — trial e garantia são coisas DIFERENTES");
ok(
  // Rodada 45 corrigiu o limite: são 3 dias OU 2 conversas, o que vier
  // primeiro. O teto de mensagens por conversa NÃO existe na fonte.
  "o trial diz os dois limites que existem",
  JULIA_SYSTEM_PROMPT.includes("3 DIAS ou 2 CONVERSAS, o que vier primeiro"),
);
ok("o trial não pede cartão", JULIA_SYSTEM_PROMPT.includes("SEM cartão"));
ok(
  "a garantia é apresentada como direito de arrependimento",
  JULIA_SYSTEM_PROMPT.includes("direito de\narrependimento, previsto em lei"),
);
ok(
  "a sequência que usa os dois juntos existe",
  JULIA_SYSTEM_PROMPT.includes("COMO USAR OS DOIS JUNTOS"),
);
ok(
  "ela é mandada ser honesta sobre o limite",
  JULIA_SYSTEM_PROMPT.includes("SEJA HONESTA SOBRE O LIMITE"),
);
// O erro que esta rodada corrige: vender o trial como se fosse o produto
// liberado por 7 dias. O dentista entra, esbarra em 2 conversas e se sente
// enganado — que é o oposto exato da arma dela.
ok(
  'a promessa falsa "7 dias grátis, sem cartão" como prova na clínica sumiu',
  !JULIA_SYSTEM_PROMPT.includes("são 7 dias de teste grátis, sem cartão"),
);
ok(
  "ninguém mais promete ver as conversas reais da clínica antes de pagar",
  !JULIA_SYSTEM_PROMPT.includes("você vê as conversas reais acontecendo na sua clínica antes de pagar"),
);
ok(
  "há um aviso explícito contra prometer testar 7 dias na clínica sem pagar",
  JULIA_SYSTEM_PROMPT.includes('NUNCA diga que ele pode "testar 7 dias na clínica sem pagar"'),
);
{
  // Rede de proteção ampla: nenhuma frase pode juntar "7 dias" com "grátis"
  // fora do bloco do trial, porque é essa colagem que cria a expectativa errada.
  const linhasRuins = JULIA_SYSTEM_PROMPT.split("\n").filter(
    (l) => /7 dias/.test(l) && /grátis/i.test(l) && !/TRIAL/i.test(l),
  );
  ok(
    '"7 dias" + "grátis" só aparecem juntos no bloco do trial',
    linhasRuins.length === 0,
    linhasRuins.join(" | "),
  );
}
ok(
  "o follow-up 3 não vende mais 7 dias grátis",
  !FOLLOW_UP_TEMPLATES[3]("Marina", null).includes("7 dias grátis"),
);
ok(
  "o follow-up 3 fala da garantia",
  FOLLOW_UP_TEMPLATES[3]("Marina", null).includes("pedir o dinheiro de volta"),
);

secao("Rodada 28 — tráfego pago é o gancho do diferencial");
ok(
  "a seção existe",
  JULIA_SYSTEM_PROMPT.includes("SEU MAIOR DIFERENCIAL: PACIENTE DE TRÁFEGO PAGO"),
);
ok("ela pergunta cedo se ele anuncia", JULIA_SYSTEM_PROMPT.includes('"Você anuncia? Instagram, Google?"'));
ok(
  "quem anuncia recebe Essencial ou Pro",
  JULIA_SYSTEM_PROMPT.includes("Recomende ESSENCIAL ou PRO"),
);
ok(
  "quem NÃO anuncia não leva plano empurrado",
  JULIA_SYSTEM_PROMPT.includes("Se ele NÃO anuncia, não force"),
);
ok(
  "o gancho vem antes da tabela de planos (ele justifica a recomendação)",
  JULIA_SYSTEM_PROMPT.indexOf("PACIENTE DE TRÁFEGO PAGO") <
    JULIA_SYSTEM_PROMPT.indexOf("## PLANOS E PREÇOS"),
);

secao("Rodada 29 — ela não entrega o nome do dono");
ok(
  "a seção agora é genérica",
  JULIA_SYSTEM_PROMPT.includes("## QUANDO PASSAR PARA UMA PESSOA"),
);
ok(
  "a antiga seção com o nome sumiu",
  !JULIA_SYSTEM_PROMPT.includes("QUANDO CHAMAR O DR. SARINHO"),
);
ok(
  "ela oferece 'alguém do suporte' / 'alguém do time'",
  JULIA_SYSTEM_PROMPT.includes("alguém do suporte") &&
    JULIA_SYSTEM_PROMPT.includes("alguém do time"),
);
ok(
  "depois de avisar, ela para de vender",
  JULIA_SYSTEM_PROMPT.includes("PARE de vender"),
);
ok(
  "a credencial 'criado por um dentista' continua viva",
  JULIA_SYSTEM_PROMPT.includes("criado por um DENTISTA"),
);
{
  // O ponto da rodada: o nome não pode estar disponível para ela citar. A
  // única ocorrência tolerada é dentro da própria regra que a proíbe de dizer.
  // (A Rodada 38 liberou o primeiro nome — "Dr. Renato" faz parte da história
  // de origem. O que segue proibido é o SOBRENOME e o nome completo.)
  const linhasComNome = JULIA_SYSTEM_PROMPT.split("\n").filter((l) => /Sarinho/.test(l));
  ok(
    "o nome aparece no máximo uma vez, e só dentro da proibição",
    linhasComNome.length === 1 && linhasComNome[0].startsWith("NUNCA diga"),
    linhasComNome.join(" | "),
  );
  ok(
    "o nome completo saiu de vez do prompt",
    !JULIA_SYSTEM_PROMPT.includes("José Renato"),
  );
}
ok(
  "a LGPD não oferece mais o dono como atendente",
  !JULIA_SYSTEM_PROMPT.includes("ofereça falar com o Dr. Sarinho") &&
    !JULIA_SYSTEM_PROMPT.includes("contato do Dr. Sarinho"),
);

secao("tratamento.ts — unidade");
ok("Michele é feminino apesar de não terminar em -a", detectarTratamento("Michele") === "dra");
ok("Elias é masculino apesar de terminar em -s", detectarTratamento("Elias") === "dr");
ok("Andrea é ambíguo", detectarTratamento("Andrea") === "neutro");
ok("saudação com Dr.", saudacao("carlos") === "Dr. Carlos, ");
ok("saudação ambígua usa só o nome", saudacao("alex") === "Alex, ");
ok("sem nome, sem vocativo", saudacao(null) === "");

secao("follow-ups — usam a dor quando existe");
const DOR = "perde paciente que chama fora do horário.";
for (const t of [1, 2, 3, 4] as const) {
  const com = FOLLOW_UP_TEMPLATES[t]("Marina", DOR);
  const sem = FOLLOW_UP_TEMPLATES[t]("Marina", null);
  ok(`toque ${t}: usa a dor quando existe`, com.includes("perde paciente que chama fora do horário"), com);
  ok(`toque ${t}: cai no texto genérico quando não existe`, !sem.includes("perde paciente"));
  ok(`toque ${t}: sem pontuação duplicada`, !com.includes("..") && !com.includes(" ,"), com);
  ok(`toque ${t}: mantém o link (com dor)`, com.includes("https://www.captaclin.com.br"));
  ok(`toque ${t}: mantém o link (sem dor)`, sem.includes("https://www.captaclin.com.br"));
  ok(`toque ${t}: trata como Dra. Marina`, com.startsWith("Dra. Marina, "));
}
ok(
  "dor só com espaços conta como sem dor",
  FOLLOW_UP_TEMPLATES[3]("Marina", "   ") === FOLLOW_UP_TEMPLATES[3]("Marina", null),
);
ok(
  "toque 4 isola a dor entre travessões (não quebra a regência)",
  FOLLOW_UP_TEMPLATES[4]("Marina", DOR).includes("— perde paciente que chama fora do horário —"),
);

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 30 — o que a primeira conversa real (dentista vindo da landing)
// mostrou que faltava. Ela disse "cobre o titular mais até 4 profissionais
// extras" e ENGOLIU o "(R$97/mês cada)" que já estava na lista de planos: o
// dentista ia assinar esperando R$297 e receber R$394. Estas asserções travam
// as cinco regras que nasceram daquela conversa.
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 30 — profissional adicional nunca sai sem preço");
ok(
  // O título "profissional adicional CUSTA" foi generalizado na Rodada 32 (o
  // mesmo erro já apareceu com áudio), mas a instrução específica do R$97
  // continua obrigatória — é ela que a conversa real mostrou faltando.
  "a regra de nunca omitir o R$97 está no prompt",
  JULIA_SYSTEM_PROMPT.includes("O caso mais comum é o profissional adicional") &&
    JULIA_SYSTEM_PROMPT.includes("sem dizer que cada um custa R$97/mês"),
);
ok("traz a conta fechada dos dois profissionais", JULIA_SYSTEM_PROMPT.includes("R$297 + R$97 = R$394"));
ok(
  "marca como ERRADO exatamente a frase que ela usou na conversa real",
  JULIA_SYSTEM_PROMPT.includes('ERRADO: "O Essencial cobre o titular mais até 4 profissionais extras."'),
);
ok(
  "registra a exceção do Pro (segundo profissional já incluso)",
  JULIA_SYSTEM_PROMPT.includes("no PRO, o primeiro profissional extra JÁ ESTÁ INCLUSO"),
);

secao("Rodada 30 — nome sempre, e nunca 'Dr.' no vácuo");
ok('proíbe "Dr." sozinho', JULIA_SYSTEM_PROMPT.includes('NUNCA escreva "Dr." sozinho, sem nome'));
ok(
  // O texto da Rodada 30 ("você PRECISA do nome dele") virou a sequência da
  // Rodada 42 — a exigência do nome continua, mais forte: ele não é opcional.
  "manda pedir o nome mesmo quando ele chega com pergunta",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "Boa pergunta! Já te explico certinho. Eu sou a Júlia, do CaptaClin — antes, como posso te chamar?",
  ),
);

secao("Rodada 30 — preço se fala");
ok("a regra PREÇO SE FALA está no prompt", JULIA_SYSTEM_PROMPT.includes("PREÇO SE FALA"));
ok(
  "a promoção dos 3 meses entra como argumento",
  JULIA_SYSTEM_PROMPT.includes("R$297 nos 3 primeiros meses, depois vai pra R$397"),
);

secao("Rodada 30 — fechar no sinal de compra");
ok(
  "existe a seção de sinal de compra",
  JULIA_SYSTEM_PROMPT.includes("## RECONHEÇA O SINAL DE COMPRA E PARE DE VENDER"),
);
for (const sinal of ["como faço para assinar?", "pode ser", "qual você indica?"]) {
  ok(`lista o sinal de compra: ${sinal}`, JULIA_SYSTEM_PROMPT.includes(sinal));
}
ok("manda PARAR de vender depois do sinal", JULIA_SYSTEM_PROMPT.includes("3. PARE."));

secao("Rodada 30 — jargão traduzido");
ok(
  "traduz Remarketing de leads",
  JULIA_SYSTEM_PROMPT.includes('"Remarketing de leads"') &&
    JULIA_SYSTEM_PROMPT.includes("ela volta a chamar quem sumiu sem marcar"),
);
ok(
  "traduz CRM de leads",
  JULIA_SYSTEM_PROMPT.includes('"CRM de leads"') &&
    JULIA_SYSTEM_PROMPT.includes("você vê todo mundo que chamou a clínica"),
);
ok(
  "só usa o termo técnico se o dentista usar primeiro",
  JULIA_SYSTEM_PROMPT.includes("Use o nome técnico só se o próprio dentista usar primeiro"),
);

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 31 — o Básico não aceita profissional adicional NENHUM, nem pagando.
// Conferido na fonte real (bundle de produção do CaptaClin): a cota de extras
// por plano é trial 0, basic 0, essencial 4, pro 3, e o gate de "profissional
// adicional" libera só essencial e pro. O Tutor IA do próprio produto diz, com
// estas palavras: "No plano Básico, somente o profissional titular é
// permitido."
//
// A armadilha é a mesma da Rodada 30, e pior: lá o dentista pagava mais do que
// esperava; aqui ele assina o Básico para uma clínica de dois e não consegue
// cadastrar a sócia. O prompt ajudava a errar — listava "Profissional
// adicional: R$97/mês" debaixo de um cabeçalho que dizia "(valem para todos)".
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 31 — o Básico é uma agenda só, e não tem adicional");
ok(
  "o Básico diz que não aceita adicional nem pagando",
  JULIA_SYSTEM_PROMPT.includes("O Básico NÃO aceita profissional\n  adicional — nem pagando"),
);
ok(
  "o 'NÃO tem' do Básico lista o profissional adicional",
  JULIA_SYSTEM_PROMPT.includes("NÃO tem: profissional adicional (nem pagando)"),
);
ok(
  'o cabeçalho mentiroso "(valem para todos)" saiu dos EXTRAS',
  !JULIA_SYSTEM_PROMPT.includes("EXTRAS (valem para todos)"),
);
ok(
  "o extra de profissional declara o alcance real (Essencial e Pro)",
  JULIA_SYSTEM_PROMPT.includes("existe SÓ no\n  Essencial (até 4) e no Pro (até 3, além do que já vem incluso)"),
);
ok("e diz explicitamente que no Básico não existe", JULIA_SYSTEM_PROMPT.includes("NO BÁSICO NÃO EXISTE"));
ok(
  "a recarga de conversas continua valendo em qualquer plano pago",
  JULIA_SYSTEM_PROMPT.includes("vale em qualquer plano pago, inclusive no Básico"),
);
// O preço e o bônus de conversas do adicional não podem ter se perdido no
// meio da correção — é a asserção da Rodada 30 vista por outro ângulo.
ok(
  "o R$97 e o +100 conversas sobreviveram à reescrita dos EXTRAS",
  JULIA_SYSTEM_PROMPT.includes("Profissional adicional: R$97/mês (some +100 conversas/mês)"),
);

secao("Rodada 31 → 54 — o inquebrável mudou de OBJETO: do perguntar para o recomendar");
// RODADA 54. A regra continua tendo o peso da do R$97 — o que mudou é sobre o
// QUÊ ela é. Antes obrigava a arrancar a resposta ("PERGUNTE QUANTOS
// PROFISSIONAIS"), e foi um dos seis blocos que fizeram a mesma pergunta sair
// seis vezes numa conversa real. Agora obriga o RESULTADO: não oferecer o
// Básico sem saber. A segurança é a mesma; a insistência morreu.
ok(
  "a regra tem o mesmo peso da do R$97 (mesmo cabeçalho de regra inquebrável)",
  JULIA_SYSTEM_PROMPT.includes("⚠️ REGRA QUE VOCÊ NUNCA QUEBRA — O BÁSICO SÓ SAI COM A RESPOSTA NA MÃO"),
);
ok(
  "e ela é sobre o que se RECOMENDA, não sobre arrancar a resposta",
  JULIA_SYSTEM_PROMPT.includes("O que nunca se quebra é o que você RECOMENDA, não arrancar a resposta"),
);
ok(
  "existe caminho sem a resposta, em vez de a conversa travar esperando",
  JULIA_SYSTEM_PROMPT.includes("SEM RESPOSTA, recomende o ESSENCIAL"),
);
ok(
  "a pergunta está escrita, pronta para usar",
  JULIA_SYSTEM_PROMPT.includes('"Quantos profissionais atendem hoje na clínica, além de você?"'),
);
ok(
  "a pergunta também entra na fase de descoberta, onde a conversa realmente passa",
  JULIA_SYSTEM_PROMPT.includes("decide se o Básico pode"),
);
ok(
  "2 ou mais profissionais tira o Básico da mesa",
  JULIA_SYSTEM_PROMPT.includes("Se forem 2 OU MAIS, o BÁSICO ESTÁ FORA"),
);
ok(
  "fecha a porta do 'começa no Básico e adiciona depois'",
  JULIA_SYSTEM_PROMPT.includes("NÃO deixe ele imaginar que dá pra começar no Básico") &&
    JULIA_SYSTEM_PROMPT.includes("NÃO DÁ."),
);
{
  // A regra tem que vir ANTES da tabela de planos ser usada para recomendar —
  // ela é pré-condição da recomendação, não uma ressalva no rodapé.
  const regra = JULIA_SYSTEM_PROMPT.indexOf("O BÁSICO SÓ SAI COM A RESPOSTA NA MÃO");
  const precoSeFala = JULIA_SYSTEM_PROMPT.indexOf("PREÇO SE FALA");
  ok("a regra está dentro da seção de planos, antes do 'preço se fala'", regra > 0 && regra < precoSeFala);
}

secao("Rodada 31 — a comparação de 2 profissionais está fechada");
ok(
  "Essencial + adicional promocional = R$394",
  JULIA_SYSTEM_PROMPT.includes("R$297 + R$97 = R$394/mês nos 3 primeiros meses"),
);
ok(
  "Essencial + adicional depois da promoção = R$494",
  JULIA_SYSTEM_PROMPT.includes("R$397 + R$97 = R$494/mês"),
);
ok(
  "Pro = R$497 com o segundo já incluso",
  JULIA_SYSTEM_PROMPT.includes("R$497/mês, com o segundo profissional JÁ INCLUSO"),
);
ok(
  "marca como ERRADO recomendar Básico para uma clínica de dois",
  JULIA_SYSTEM_PROMPT.includes('ERRADO: "O Básico já resolve pra vocês"'),
);
ok(
  "o exemplo de 'recomende um plano' ganhou a ressalva do atende sozinho",
  JULIA_SYSTEM_PROMPT.includes("Só recomende o Básico depois de confirmar que ele atende sozinho"),
);
{
  // Rede de proteção: o prompt não pode ter sobrado nenhuma linha que ofereça
  // adicional sem excluir o Básico. Toda linha que fala de "profissional
  // adicional"/"profissionais extras" precisa nomear onde ele existe ou onde
  // não existe — senão volta a ambiguidade que criou o problema.
  // A janela é de três linhas (anterior, atual, seguinte) porque o prompt quebra
  // frase no meio: em "o Básico não serve: ele cobre uma agenda só e não / aceita
  // profissional adicional", quem nomeia o plano é a linha de cima.
  const linhas = JULIA_SYSTEM_PROMPT.split("\n");
  const soltas = linhas.filter((l, i) => {
    if (!/profissional adicional|profissionais extras/i.test(l)) return false;
    if (l.trimStart().startsWith("⚠️")) return false; // cabeçalho de regra, não oferta
    const janela = [linhas[i - 1] ?? "", l, linhas[i + 1] ?? ""].join("\n");
    return !/Básico|Essencial|Pro\b|R\$ ?97|nem pagando/i.test(janela);
  });
  ok("nenhuma linha oferece adicional sem dizer em que plano ele existe", soltas.length === 0, soltas.join(" | "));
}

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 32 — a recarga de áudio existe e ela não sabia.
// O prompt prometia "30 min inclusos" e não tinha resposta para o "e se
// acabar?". Terceiro caso da MESMA classe (R$97 omitido, Básico sem adicional,
// áudio sem recarga), e por isso a regra da Rodada 30 deixou de ser sobre
// profissional adicional e passou a ser sobre qualquer limite.
//
// Preços conferidos na fonte real (bundle de produção): os pacotes são
// 27.000 / 54.000 / 108.000 caracteres por R$25 / R$40 / R$70. Os três preços
// batem com a especificação. Os MINUTOS não: a 1.350 caracteres por minuto —
// taxa que o próprio app usa para exibir saldo e cota — dão 20 / 40 / 80 min,
// não 30 / 60 / 120. Por isso o prompt diz "até", que é a palavra do próprio
// site, e proíbe número exato.
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 32 — recarga de áudio: os três pacotes");
for (const pacote of ["R$25 → até 30 minutos", "R$40 → até 1 hora", "R$70 → até 2 horas"]) {
  ok(`o pacote está no prompt: ${pacote}`, JULIA_SYSTEM_PROMPT.includes(pacote));
}
ok("a seção da recarga de áudio existe", JULIA_SYSTEM_PROMPT.includes("RECARGA DE ÁUDIO — quando os minutos acabam"));
ok(
  "a recarga de áudio não existe no Básico",
  JULIA_SYSTEM_PROMPT.includes("o Básico não tem áudio, então não recarrega"),
);
ok(
  "a recarga é avulsa e não mexe na mensalidade",
  JULIA_SYSTEM_PROMPT.includes("É avulsa, não mexe na mensalidade"),
);
// Achados da fonte que não estavam no prompt: a cota mensal renova (não
// acumula) e o saldo comprado é uma bolsa separada que soma com o que sobrou.
ok(
  "diz que os minutos do plano renovam e não acumulam",
  JULIA_SYSTEM_PROMPT.includes("RENOVAM no começo de cada mês — não acumulam"),
);
ok(
  "diz que o saldo de recarga é uma bolsa separada",
  JULIA_SYSTEM_PROMPT.includes("saldo de recarga é uma bolsa separada"),
);
// A trava que nasceu da divergência entre o rótulo do site e a conversão real.
ok(
  'proíbe prometer número exato de minutos (o "até" é obrigatório)',
  JULIA_SYSTEM_PROMPT.includes('Diga "até", nunca um número exato'),
);
{
  // Nenhum pacote pode ser anunciado como quantidade aproximada ou fechada: a
  // 1.350 caracteres/minuto o de R$25 rende 20 min, não 30. "até" é o teto que
  // o próprio site publica; "cerca de" viraria promessa de 50% a mais.
  const aproximacoes = ["cerca de 30 minutos", "cerca de 1 hora", "cerca de 2 horas", "aproximadamente"];
  const encontradas = aproximacoes.filter((a) => JULIA_SYSTEM_PROMPT.includes(a));
  ok("nenhum pacote de áudio é anunciado como quantidade aproximada", encontradas.length === 0, encontradas.join(" | "));
}

secao("Rodada 32 — ela emenda a recarga sem esperar a pergunta");
ok("existe a instrução de como falar disso", JULIA_SYSTEM_PROMPT.includes("COMO FALAR DISSO"));
ok(
  'nomeia a pergunta que vem depois ("e se acabar?")',
  JULIA_SYSTEM_PROMPT.includes('a pergunta seguinte\ndele quase sempre é "e se acabar?"'),
);
ok(
  "traz a frase pronta que emenda a recarga no minuto incluso",
  JULIA_SYSTEM_PROMPT.includes("Se acabar, dá pra recarregar") &&
    JULIA_SYSTEM_PROMPT.includes("a partir de R$25, e isso não mexe na mensalidade"),
);

secao("Rodada 32 — a regra de custo virou geral, não só do profissional");
ok(
  "o título não fala mais só de profissional adicional",
  JULIA_SYSTEM_PROMPT.includes("⚠️ REGRA QUE VOCÊ NUNCA QUEBRA — nenhum custo aparece depois") &&
    !JULIA_SYSTEM_PROMPT.includes("REGRA QUE VOCÊ NUNCA QUEBRA — profissional adicional CUSTA"),
);
ok(
  "a regra lista os três tipos de limite",
  JULIA_SYSTEM_PROMPT.includes("algo que tem limite (conversas, minutos de áudio,\nprofissionais)"),
);
ok(
  "manda dizer o que acontece quando o limite acaba e quanto custa passar dele",
  JULIA_SYSTEM_PROMPT.includes("o que acontece quando o limite acaba e\nquanto custa passar dele"),
);
ok(
  "na dúvida, fala o custo agora",
  JULIA_SYSTEM_PROMPT.includes("Na dúvida entre falar de um custo agora ou deixar pra depois: fale agora"),
);

{
  // Rede de proteção no espírito da Rodada 31: toda linha que AFIRMA uma
  // quantidade de minutos de áudio tem que ter a recarga na vizinhança. É o
  // "e se acabar?" ficar sem resposta que criou esta rodada. Exige um número
  // junto — "citar os minutos inclusos" é instrução, não promessa de cota.
  const linhas = JULIA_SYSTEM_PROMPT.split("\n");
  const semSaida = linhas.filter((l, i) => {
    if (!/\d+\s*min(?:utos)?\s+inclusos|\d+\s*minutos? de áudio/i.test(l)) return false;
    const janela = [linhas[i - 1] ?? "", l, linhas[i + 1] ?? ""].join("\n");
    // "recarga" e "recarrega" não têm prefixo comum ("recarg" vs "recarr") —
    // testar só um dos dois deixa a rede cega para metade das linhas.
    return !/recarga|recarreg/i.test(janela);
  });
  ok(
    "nenhuma linha promete minutos de áudio sem a recarga por perto",
    semSaida.length === 0,
    semSaida.join(" | "),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 34 — a PRIMEIRA mensagem, revisada.
//
// É a mensagem mais delicada do sistema: chega em quem não pediu nada, e cada
// uma é um tiro na reputação do número. O objetivo dela é UM — conseguir uma
// resposta —, e quase tudo que parece "vender melhor" (preço, urgência, "você
// está perdendo paciente") reduz a chance disso acontecer.
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 34 — o objetivo da primeira mensagem é resposta, não venda");
ok(
  "o objetivo único está declarado",
  JULIA_OUTREACH_PROMPT.includes("SEU ÚNICO OBJETIVO NESTA MENSAGEM: conseguir uma resposta"),
);
ok(
  "e o que ele NÃO é vem junto (senão o modelo vende assim mesmo)",
  JULIA_OUTREACH_PROMPT.includes("Não é vender. Não é explicar o produto. Não é despertar desejo"),
);

secao("Rodada 34 — o que não entra na abordagem fria");
ok(
  "preço, plano, trial, garantia e link estão proibidos juntos",
  JULIA_OUTREACH_PROMPT.includes("Preço, plano, trial, garantia, link"),
);
ok(
  "a perda de paciente/dinheiro é proibida COM o motivo (é presunçoso vindo de estranho)",
  JULIA_OUTREACH_PROMPT.includes("perdendo paciente/dinheiro") &&
    JULIA_OUTREACH_PROMPT.includes("presunçoso e ofensivo"),
);
ok("urgência e escassez estão proibidas", JULIA_OUTREACH_PROMPT.includes("Urgência, escassez, promoção"));
ok(
  "prova social está proibida porque não existe — e inventar já era proibido",
  JULIA_OUTREACH_PROMPT.includes("não existe prova social ainda, e inventar está proibido"),
);
// A REPUTAÇÃO ERA OFERECIDA E PROIBIDA AO MESMO TEMPO. A ficha entregava
// "4.9 de 5, com 169 avaliações" com permissão de elogiar, e esta mesma lista
// dizia "Qualquer número [...] DE JEITO NENHUM" — 5 prévias do lead 33 não
// citaram nada, obedecendo (corretamente) à regra categórica em vez da
// condicional. A proibição continua de pé; o que entrou foi uma exceção
// nomeada e estreita.
ok(
  "a proibição de número agora é do número NOSSO",
  JULIA_OUTREACH_PROMPT.includes("Qualquer número NOSSO"),
);
ok(
  "com exceção nomeada para o número que é DELE e está na ficha",
  JULIA_OUTREACH_PROMPT.includes("ÚNICA EXCEÇÃO") &&
    JULIA_OUTREACH_PROMPT.includes("um número que é DELE e está na ficha") &&
    JULIA_OUTREACH_PROMPT.includes("reputação da clínica no Google"),
);
ok(
  "e a exceção se fecha atrás de si — nenhum outro número escapa",
  JULIA_OUTREACH_PROMPT.includes("Nenhum outro número escapa desta regra"),
);
ok("mais de uma pergunta está proibido", JULIA_OUTREACH_PROMPT.includes("Mais de UMA pergunta"));

secao("Rodada 34 — o que entra, e a licença");
// A SEGUNDA METADE DA REPETIÇÃO DO LEAD 33. Tirar a âncora do exemplo não
// bastava: o item 3 entregava DUAS frases prontas de pedido de licença, e as 6
// prévias alternaram exatamente entre elas — o modelo não estava variando,
// estava escolhendo num cardápio de dois. Frase pronta no prompt vira frase
// repetida na saída, e a instrução agora descreve o que é pedir licença sem
// dar nenhum texto.
ok(
  "manda pedir licença de verdade, e explica o que é",
  JULIA_OUTREACH_PROMPT.includes("Um pedido de licença DE VERDADE") &&
    JULIA_OUTREACH_PROMPT.includes("esperando a permissão"),
);
ok(
  "NÃO entrega frase pronta de licença — nem as duas que causaram a repetição",
  !JULIA_OUTREACH_PROMPT.includes('"posso te roubar um minuto?"') &&
    !JULIA_OUTREACH_PROMPT.includes('"posso te fazer uma pergunta rápida?"'),
);
ok(
  "e diz explicitamente que não existe frase certa para isso",
  JULIA_OUTREACH_PROMPT.includes("NÃO existe frase certa para isso") &&
    JULIA_OUTREACH_PROMPT.includes("diferente a cada dentista"),
);
{
  // Os quatro exemplos não podem pedir licença do mesmo jeito: três exemplos
  // repetindo a mesma fórmula reintroduzem o cardápio pela porta dos fundos,
  // mesmo sem nenhuma frase pronta na instrução.
  const pedidos = JULIA_OUTREACH_PROMPT.split("\n")
    .filter((l) => l.startsWith('- "Oi'))
    .map((l) => {
      const m = l.match(/(Posso[^?]*\?|Tem um minuto[^?]*\?|Uma pergunta[^:]*:)/);
      return m ? m[1]!.toLowerCase() : l;
    });
  ok(
    "os quatro exemplos pedem licença de quatro jeitos diferentes",
    new Set(pedidos).size === 4,
    pedidos.join(" | "),
  );
}
ok(
  "manda dizer de onde viu a clínica, usando a ficha",
  JULIA_OUTREACH_PROMPT.includes("DE ONDE você viu a clínica — está na ficha do lead"),
);
ok(
  "e proíbe inventar quando a ficha não permitir citar",
  JULIA_OUTREACH_PROMPT.includes("Se a ficha disser que a origem NÃO é citável, não\n   invente"),
);
// A TERCEIRA VEZ DO MESMO VÍCIO (7 prévias, mesma sentença de 15 palavras).
// A origem virou roteiro porque a ficha entregava a frase pronta; agora ela
// entrega o fato. O prompt precisa dizer que a origem cabe em poucas palavras,
// senão a frase própria da Júlia nasce do mesmo tamanho da que ela copiava.
ok(
  "diz que a origem se resolve em POUCAS PALAVRAS",
  JULIA_OUTREACH_PROMPT.includes("Isso se resolve em POUCAS PALAVRAS") &&
    JULIA_OUTREACH_PROMPT.includes("não precisa da logística da sua"),
);
ok(
  "e que a ficha dá o FATO, não a frase",
  JULIA_OUTREACH_PROMPT.includes("A ficha te dá o FATO, não a frase"),
);
ok(
  "pede UMA pergunta fácil de responder",
  JULIA_OUTREACH_PROMPT.includes("UMA pergunta fácil de responder"),
);
ok(
  "o elogio só vale se ela tiver visto do que fala",
  JULIA_OUTREACH_PROMPT.includes("ELOGIO: só se for verdade") &&
    JULIA_OUTREACH_PROMPT.includes("bajulação vazia"),
);
ok(
  "e as bases legítimas do elogio são DUAS, as duas vindas da ficha",
  JULIA_OUTREACH_PROMPT.includes("Existem DUAS\nbases legítimas") &&
    JULIA_OUTREACH_PROMPT.includes("o Instagram da clínica, quando a ficha trouxer") &&
    JULIA_OUTREACH_PROMPT.includes("a reputação dela no Google, quando a ficha trouxer"),
);
ok(
  "a regra do elogio autoriza DIZER o número, fechando a contradição com a ficha",
  JULIA_OUTREACH_PROMPT.includes("pode elogiar por ele, e pode dizer o número"),
);
ok(
  "e continua fechada: fora dessas duas bases, não elogia",
  JULIA_OUTREACH_PROMPT.includes("Fora dessas duas, não elogie"),
);
{
  // O contrato entre a ficha e o prompt: a ficha diz "Reputação no Google", e
  // a regra do elogio precisa apontar para ESSE rótulo. Se um dos dois for
  // renomeado sozinho, a permissão deixa de encontrar o dado — que é
  // exatamente o buraco que as 5 prévias mudas expuseram.
  const fichaComReputacao = buildOutreachBriefing({
    name: null,
    clinicName: "Odonto Vida",
    city: "Fortaleza",
    instagram: null,
    origin: "maps",
    nota: "4.9",
    totalAvaliacoes: 169,
  });
  ok(
    "o rótulo citado no prompt é o mesmo que a ficha escreve",
    fichaComReputacao.includes("- Reputação no Google:") &&
      JULIA_OUTREACH_PROMPT.includes('"Reputação no\n  Google"'),
    fichaComReputacao,
  );
}
ok(
  "e ela sai na primeira negativa, sem insistir",
  JULIA_OUTREACH_PROMPT.includes("AGRADEÇA E SAIA") &&
    JULIA_OUTREACH_PROMPT.includes("SE ELE PEDIR PARA PARAR: pare na hora"),
);

secao("Rodada 34 — os exemplos de tom, escolhidos pela origem e não por preferência");
{
  const exemplos = JULIA_OUTREACH_PROMPT.split("\n").filter((l) => l.startsWith('- "Oi'));
  ok("são quatro exemplos", exemplos.length === 4, exemplos.join(" | "));
  ok(
    "e nenhum deles vende (preço, plano ou link)",
    !exemplos.some((e) => /R\$|plano|captaclin\.com\.br/i.test(e)),
    exemplos.join(" | "),
  );
  ok(
    "todos pedem licença ou fazem uma pergunta",
    exemplos.every((e) => e.includes("?")),
  );
}
ok(
  "manda VARIAR SEMPRE, e diz por quê (eles comparam print)",
  JULIA_OUTREACH_PROMPT.includes("VARIE SEMPRE") &&
    JULIA_OUTREACH_PROMPT.includes("comparam print em grupo de WhatsApp"),
);
ok(
  "os exemplos são declarados como TOM, não como modelo para copiar",
  JULIA_OUTREACH_PROMPT.includes("são de TOM, não\nmodelos para copiar"),
);
// A REPETIÇÃO DAS 6 PRÉVIAS (lead 33). Seis gerações saíram quase idênticas
// porque o prompt mandava "comece pelo primeiro exemplo" e o primeiro exemplo é
// uma frase literal — de origem Instagram, com vocativo, servindo mal a um lead
// de Maps sem nome. O modelo fazia a EDIÇÃO MÍNIMA daquela frase, e edição
// mínima a partir de uma âncora fixa dá sempre o mesmo texto.
//
// A âncora não pode voltar: é ela que anula o "VARIE SEMPRE" logo acima.
ok(
  "NÃO existe exemplo preferido nem exemplo por onde começar",
  !JULIA_OUTREACH_PROMPT.includes("comece por ele") &&
    !JULIA_OUTREACH_PROMPT.includes("formato preferido, porque") &&
    JULIA_OUTREACH_PROMPT.includes("Não existe formato\npreferido"),
);
ok(
  "a escolha do exemplo é feita pela ORIGEM declarada na ficha",
  JULIA_OUTREACH_PROMPT.includes("use o exemplo da ORIGEM QUE A FICHA DECLAROU"),
);
ok(
  "e manda reescrever com as próprias palavras, não copiar o exemplo",
  JULIA_OUTREACH_PROMPT.includes("ESCREVA COM AS SUAS PALAVRAS") &&
    JULIA_OUTREACH_PROMPT.includes("puder ser confundida com o\nexemplo, ela está errada"),
);
ok(
  "o que elogia só vale com Instagram na ficha",
  JULIA_OUTREACH_PROMPT.includes("só quando a ficha trouxer Instagram de verdade"),
);
ok(
  "o terceiro é para quando não dá para dizer de onde viu",
  JULIA_OUTREACH_PROMPT.includes("quando a ficha NÃO permitir dizer de onde\n  você viu a clínica"),
);
{
  // O exemplo que faltava, e cuja ausência causou a repetição: Maps + sem nome.
  // Sem ele o modelo cai no exemplo de Instagram e o adapta sempre igual.
  const quarto = JULIA_OUTREACH_PROMPT.split("\n").filter((l) =>
    l.startsWith('- "Oi'),
  )[3] as string;
  ok("o quarto exemplo é de Google Maps", quarto.includes("no Google Maps"), quarto);
  ok(
    "e não tem vocativo, porque clínica do Maps não traz o nome do dentista",
    !/Dr\.|Dra\./.test(quarto),
    quarto,
  );
  ok(
    "a regra explica por que ele não tem vocativo",
    JULIA_OUTREACH_PROMPT.includes("não tem vocativo, porque"),
  );
}
{
  // Rede no espírito das Rodadas 31 e 32: nenhuma linha do prompt pode oferecer
  // preço, link ou promoção como coisa a dizer. As únicas ocorrências toleradas
  // são as das próprias proibições.
  const linhas = JULIA_OUTREACH_PROMPT.split("\n");
  const ofertas = linhas.filter((l) => {
    if (!/R\$|captaclin\.com\.br|desconto|promoç/i.test(l)) return false;
    return !/NÃO ENTRA|Preço, plano, trial|Urgência, escassez/.test(l);
  });
  ok("nenhuma linha oferece preço, link ou promoção", ofertas.length === 0, ofertas.join(" | "));
}

secao("Rodada 34 — a ficha da abordagem não inventa de onde a Júlia viu a clínica");
const fichaFria = (over: Partial<Parameters<typeof buildOutreachBriefing>[0]> = {}) =>
  buildOutreachBriefing({
    name: "Marina",
    clinicName: "Odonto Vida",
    city: null,
    instagram: null,
    origin: "import",
    ...over,
  });
ok(
  "lead de planilha: NÃO SABEMOS de onde veio",
  fichaFria().includes("NÃO SABEMOS") && fichaFria().includes("não invente origem"),
  fichaFria(),
);
ok(
  "e a saída oferecida é a credencial verdadeira (quem criou é dentista)",
  fichaFria().includes("quem criou o CaptaClin é dentista"),
);
ok(
  'a invenção antiga ("procurando clínica na região") sumiu do caso sem origem',
  !fichaFria().includes("procurando clínica de odontologia na região"),
);
ok(
  "com Instagram na ficha, pode dizer que viu no Instagram",
  fichaFria({ instagram: "@odontovida" }).includes(
    "você viu o perfil da clínica no Instagram",
  ),
  fichaFria({ instagram: "@odontovida" }),
);
ok(
  'origin "maps" continua citável, dizendo a cidade',
  fichaFria({ origin: "maps", city: "Fortaleza" }).includes(
    "você estava vendo clínicas de odontologia em Fortaleza no Google Maps",
  ),
  fichaFria({ origin: "maps", city: "Fortaleza" }),
);
ok(
  'maps sem cidade não deixa um "em " pendurado',
  fichaFria({ origin: "maps", city: null }).includes(
    "você estava vendo clínicas de odontologia no Google Maps",
  ) && !fichaFria({ origin: "maps", city: null }).includes(" em  "),
  fichaFria({ origin: "maps", city: null }),
);

// A ficha declara o FATO e proíbe a cópia. Enquanto ela entregava a origem já
// redigida, o modelo transcrevia: 7 prévias abriram com a MESMA sentença de 15
// palavras. Vale para TODA origem citável, não só a do Maps.
{
  const citaveis = [
    fichaFria({ origin: "maps", city: "Fortaleza" }),
    fichaFria({ instagram: "@odontovida" }),
    fichaFria({ origin: "instagram" }),
  ];
  ok(
    "toda origem citável manda escrever com as próprias palavras, curto",
    citaveis.every((f) => f.includes("Diga com as SUAS palavras, curto")),
  );
  ok(
    "e proíbe copiar a linha da ficha, explicitamente",
    citaveis.every((f) => f.includes("NÃO copie esta linha")),
  );
  ok(
    "a linha descreve o que ela FEZ, não uma frase pronta para transcrever",
    citaveis.every((f) => f.includes("- Como você chegou nela: você ")),
    citaveis.join("\n---\n"),
  );
}
ok(
  "o quarto exemplo resolve a origem em poucas palavras, como manda a regra",
  (JULIA_OUTREACH_PROMPT.split("\n").filter((l) => l.startsWith('- "Oi'))[3] as string)
    .includes("no Google Maps aqui de Fortaleza"),
);
ok(
  "e quando é citável não vem o aviso de não inventar",
  !fichaFria({ instagram: "@odontovida" }).includes("NÃO SABEMOS"),
);

secao("Reputação do Google na ficha — só nota alta COM volume é citável");
const reputacao = (nota: string | number | null, total: number | null) =>
  fichaFria({ origin: "maps", city: "Fortaleza", nota, totalAvaliacoes: total });
ok(
  "4.8 com 120 avaliações entra na ficha",
  reputacao("4.8", 120).includes("Reputação no Google: 4.8 de 5, com 120 avaliações"),
  reputacao("4.8", 120),
);
ok(
  "exatamente no limite (4.5 e 20) entra — a trava é >=, não >",
  reputacao("4.5", 20).includes("Reputação no Google: 4.5 de 5, com 20 avaliações"),
  reputacao("4.5", 20),
);
ok(
  "nota boa com POUCA avaliação não entra (5.0 com 3 é acaso, não reputação)",
  !reputacao("5.0", 3).includes("Reputação no Google"),
  reputacao("5.0", 3),
);
ok(
  "nota mediana com muito volume não entra",
  !reputacao("4.1", 400).includes("Reputação no Google"),
  reputacao("4.1", 400),
);
ok(
  "e o número reprovado NÃO aparece em lugar nenhum da ficha",
  !reputacao("3.2", 400).includes("3.2") && !reputacao("3.2", 400).includes("Reputação"),
  reputacao("3.2", 400),
);
ok(
  "sem os dados (lead de planilha) a linha simplesmente não existe",
  !reputacao(null, null).includes("Reputação no Google"),
);
ok(
  "nota sem contagem não entra: uma trava sozinha não basta",
  !reputacao("4.9", null).includes("Reputação no Google") &&
    !reputacao(null, 300).includes("Reputação no Google"),
);
ok(
  "aceita numeric como string (é assim que o driver devolve) e como number",
  reputacao("4.7", 50).includes("4.7 de 5") && reputacao(4.7, 50).includes("4.7 de 5"),
);
ok(
  "lixo no lugar da nota não vira citação",
  !reputacao("sem nota", 300).includes("Reputação no Google"),
);

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 36 — o que a conversa do Dr. Fernando (5 profissionais, medo de golpe)
// revelou. Ela não sabia o CNPJ — que está no rodapé da própria landing de onde
// ele veio —, prometeu contrato três vezes sem entregar, e recomendou o plano
// MAIS CARO depois de ele reclamar do preço três vezes.
//
// Dados da empresa conferidos na fonte real (bundle de produção): legalName
// "CAPTACLIN TECNOLOGIA LTDA", taxId "68.395.596/0001-00", Av. Cristóvão
// Colombo, 2144, Sala 408 — Floresta, Porto Alegre/RS. O teto de profissionais
// também: inclusos + extras dá 5 em TODO plano (essencial 1+4, pro 2+3).
// E a conta fechada: o Essencial ganha do Pro por preço em TODA linha —
// R$103 na promoção, R$3 depois dela. O Pro só se justifica por recurso.
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 36 — ela sabe quem somos (CNPJ, razão social, endereço)");
ok("a seção QUEM SOMOS existe", JULIA_SYSTEM_PROMPT.includes("## QUEM SOMOS"));
ok("razão social", JULIA_SYSTEM_PROMPT.includes("CAPTACLIN TECNOLOGIA LTDA"));
ok("CNPJ", JULIA_SYSTEM_PROMPT.includes("68.395.596/0001-00"));
ok(
  "endereço completo",
  JULIA_SYSTEM_PROMPT.includes("Av. Cristóvão Colombo, 2144, Sala 408") &&
    JULIA_SYSTEM_PROMPT.includes("Porto Alegre / RS"),
);
ok("e-mail de contato", JULIA_SYSTEM_PROMPT.includes("contato@captaclin.com.br"));
ok(
  // Na Rodada 38 a "MAIOR ARMA" virou a história de origem, mas a ordem
  // continua a mesma: os dados frios da empresa vêm antes da narrativa.
  "vem antes da história de origem (é resposta de medo, não de venda)",
  JULIA_SYSTEM_PROMPT.indexOf("## QUEM SOMOS") <
    JULIA_SYSTEM_PROMPT.indexOf("## DE ONDE VEM O CAPTACLIN"),
);
ok(
  "manda responder na hora, sem hesitar",
  JULIA_SYSTEM_PROMPT.includes("Responda na hora, com os dados na mão"),
);
ok(
  "desconfiança é tratada como sinal de dentista sério",
  JULIA_SYSTEM_PROMPT.includes("Desconfiança é sinal de dentista sério"),
);

// A Rodada 36 apontava contrato e termo para o cadastro porque as páginas
// públicas não existiam. Na Rodada 37 elas entraram no ar e a resposta virou
// mandar o link — o que sobrevive da 36 é o núcleo: nunca entregar o site no
// lugar do documento, e handoff de verdade para o que os links não cobrem.
secao("Rodada 36 — o que sobreviveu à chegada dos links públicos");
ok(
  "o erro da conversa real continua marcado (o site no lugar do documento)",
  JULIA_SYSTEM_PROMPT.includes(
    "NUNCA mande o endereço da página inicial achando que é o documento",
  ),
);
ok(
  "a LGPD não promete mais mandar o termo",
  !JULIA_SYSTEM_PROMPT.includes("Quer que eu te mande o termo"),
);
ok(
  "a regra final não manda mais 'oferecer o documento'",
  !JULIA_SYSTEM_PROMPT.includes("ofereça o documento"),
);

secao("Rodada 36 — a conta certa por número de profissionais");
ok(
  "a regra das duas contas existe",
  JULIA_SYSTEM_PROMPT.includes("⚠️ SEMPRE FAÇA AS DUAS CONTAS ANTES DE RECOMENDAR"),
);
for (const linha of [
  "2 profissionais → Essencial R$394  |  Pro R$497",
  "3 profissionais → Essencial R$491  |  Pro R$594",
  "4 profissionais → Essencial R$588  |  Pro R$691",
  "5 profissionais → Essencial R$685  |  Pro R$788",
]) {
  ok(`tabela: ${linha.slice(0, 18)}…`, JULIA_SYSTEM_PROMPT.includes(linha));
}
ok(
  "o Pro se justifica por recursos, não por preço",
  JULIA_SYSTEM_PROMPT.includes("O Pro NÃO se justifica por preço") &&
    JULIA_SYSTEM_PROMPT.includes("se justifica pelos recursos"),
);
ok(
  'a mentira "muitas vezes o Pro sai mais barato" morreu',
  !JULIA_SYSTEM_PROMPT.includes("o Pro sai mais barato"),
);
ok(
  "a âncora alta está proibida (foi ela que criou o 'tudo isso?')",
  JULIA_SYSTEM_PROMPT.includes("E CUIDADO COM A ÂNCORA") &&
    JULIA_SYSTEM_PROMPT.includes("não jogue o total mais alto na primeira frase"),
);

secao("Rodada 36 — o teto absoluto de 5 profissionais");
ok(
  "a regra existe, em qualquer plano",
  JULIA_SYSTEM_PROMPT.includes("⚠️ O MÁXIMO É 5 PROFISSIONAIS, EM QUALQUER PLANO"),
);
ok(
  "as duas somas estão fechadas",
  JULIA_SYSTEM_PROMPT.includes("titular + até 4 extras = 5 no total") &&
    JULIA_SYSTEM_PROMPT.includes("2 inclusos + até 3 extras = 5 no total"),
);
ok(
  "diz com todas as letras que não existe plano para 6 ou mais",
  JULIA_SYSTEM_PROMPT.includes("NÃO EXISTE plano para 6 ou mais"),
);
{
  // Rede de proteção: nenhuma linha do prompt pode sugerir que algum plano
  // cobre 6 ou mais profissionais. As menções a "6 ou mais"/"mais que isso" só
  // podem existir dentro da própria proibição.
  const linhas = JULIA_SYSTEM_PROMPT.split("\n");
  const sugerem = linhas.filter((l, i) => {
    if (!/\b([6-9]|\d{2,})\s*(profissionais|agendas|extras)/i.test(l)) return false;
    const janela = [linhas[i - 2] ?? "", linhas[i - 1] ?? "", l].join("\n");
    return !/NÃO EXISTE|passariam disso|atende até 5/i.test(janela);
  });
  ok("nenhuma linha sugere plano para 6 ou mais", sugerem.length === 0, sugerem.join(" | "));
}

secao("Rodada 36 — quando ele diz que está caro: a comparação com contratar gente");
ok(
  "a seção existe",
  JULIA_SYSTEM_PROMPT.includes("## QUANDO ELE DIZ QUE ESTÁ CARO"),
);
ok(
  // Rodada 45 trocou a faixa "R$1.800 a R$1.900" por um número só, e levou a
  // conta até o contador e o total anual — o salário sozinho nunca foi o ponto.
  "os números do custo real estão lá (salário e encargos)",
  JULIA_SYSTEM_PROMPT.includes("por volta de R$1.900 de salário") &&
    JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes("passa de R$2.700 por mês"),
);
ok(
  "os encargos são nomeados (é o que o dentista não conta de cabeça)",
  JULIA_SYSTEM_PROMPT.includes("férias, 13º, FGTS e INSS"),
);
ok(
  "proíbe dizer que substitui a secretária",
  JULIA_SYSTEM_PROMPT.includes("Nunca diga que substitui a secretária"),
);
ok(
  "os números vão como aproximação, nunca exatos",
  JULIA_SYSTEM_PROMPT.includes('Use os números como "cerca de", "por volta de"'),
);
ok(
  "só entra quando ele reclamar do preço",
  JULIA_SYSTEM_PROMPT.includes("Só use quando ele disser que está caro"),
);
ok(
  "depois da comparação, silêncio",
  JULIA_SYSTEM_PROMPT.includes("DEPOIS DA CONTA, PARE. Deixe ele reagir"),
);

secao("Rodada 36 — os dois diferenciais que ela nunca citava");
ok(
  "a seção do que só o CaptaClin faz existe",
  JULIA_SYSTEM_PROMPT.includes("## O QUE SÓ O CAPTACLIN FAZ"),
);
ok(
  "vídeo/áudio de boas-vindas, com o alcance certo (Essencial e Pro)",
  JULIA_SYSTEM_PROMPT.includes("VÍDEO OU ÁUDIO DE BOAS-VINDAS DO PRÓPRIO DENTISTA (Essencial e Pro)"),
);
ok(
  // Conferido na fonte: o site diz "no minuto em que a consulta é confirmada,
  // seu paciente recebe as boas-vindas". Não é na chegada do paciente — e
  // prometer o momento errado é a classe de erro destas rodadas.
  "o vídeo dispara na confirmação da consulta, como a fonte diz",
  JULIA_SYSTEM_PROMPT.includes("Na hora em que o paciente confirma a consulta"),
);
ok(
  "portfólio automático, com o alcance certo (Essencial e Pro)",
  JULIA_SYSTEM_PROMPT.includes("PORTFÓLIO ENVIADO AUTOMATICAMENTE (Essencial e Pro)"),
);
ok(
  "o enquadramento é conexão/empatia/autoridade",
  JULIA_SYSTEM_PROMPT.includes("CONEXÃO, EMPATIA e") &&
    JULIA_SYSTEM_PROMPT.includes("AUTORIDADE do profissional"),
);
ok(
  "e não é para despejar tudo de uma vez",
  JULIA_SYSTEM_PROMPT.includes("Não jogue tudo de uma vez"),
);

secao("Rodada 36 — CRC × secretária: papéis diferentes, complementares");
ok(
  "a seção existe",
  JULIA_SYSTEM_PROMPT.includes("## VOCÊ NÃO É UMA SECRETÁRIA. VOCÊ É UMA CRC."),
);
ok(
  "define os dois papéis",
  JULIA_SYSTEM_PROMPT.includes("SECRETÁRIA: parte administrativa e operacional") &&
    JULIA_SYSTEM_PROMPT.includes("CRC (Consultora de Relacionamento com o Cliente)"),
);
ok(
  "um não substitui o outro",
  JULIA_SYSTEM_PROMPT.includes("Os dois papéis são complementares — um não substitui o outro"),
);
ok(
  "a frase que separa robô de CRC",
  JULIA_SYSTEM_PROMPT.includes("Robô responde pergunta; CRC conduz o"),
);
ok(
  // Rodada 45 moveu a carta da CRC para o fecho da objeção "não vou mandar
  // minha secretária embora", que é onde ela desarma em vez de comparar.
  "a carta da CRC fecha o reenquadramento da secretária",
  JULIA_SYSTEM_PROMPT.includes(
    "não é papel de secretária, é papel de CRC",
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 37 — links públicos, revelação de IA e calibragem de emoji.
// As páginas /termos e /contrato foram conferidas no ar antes de os links
// entrarem no prompt (rotas registradas no bundle de produção da landing —
// mesma fonte real dos planos).
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 37 — contrato e termo têm link público, e ela manda");
ok(
  "o link dos termos está no prompt",
  JULIA_SYSTEM_PROMPT.includes("https://captaclin.com.br/termos"),
);
ok(
  "o link do contrato está no prompt",
  JULIA_SYSTEM_PROMPT.includes("https://captaclin.com.br/contrato"),
);
ok(
  "a resposta pronta é mandar o link, resolve na hora",
  JULIA_SYSTEM_PROMPT.includes("CONTRATO E TERMO — mande o link, resolve na hora"),
);
ok(
  "a instrução de apontar só para o cadastro morreu",
  !JULIA_SYSTEM_PROMPT.includes("você NÃO envia documento") &&
    !JULIA_SYSTEM_PROMPT.includes("lê os dois na hora do"),
);
ok(
  "pedir documento continua sendo sinal de dentista sério",
  JULIA_SYSTEM_PROMPT.replace(/\n/g, " ").includes(
    "quem não pensa em assinar não pede contrato",
  ),
);
ok(
  "o handoff sobrevive para o que os links não cobrem",
  JULIA_SYSTEM_PROMPT.includes("algo que os links não cobrem"),
);
ok(
  "a objeção de LGPD manda o link do termo",
  JULIA_SYSTEM_PROMPT.includes("Se quiser ler agora, tá público: https://captaclin.com.br/termos"),
);

secao("Rodada 37 — a revelação de IA");
ok(
  "a seção existe",
  JULIA_SYSTEM_PROMPT.includes("## O MOMENTO DE CONTAR QUE VOCÊ É UMA IA"),
);
ok(
  "os gatilhos de aprovação que autorizam a revelação estão listados",
  JULIA_SYSTEM_PROMPT.includes("só depois de ele demonstrar aprovação") &&
    JULIA_SYSTEM_PROMPT.includes('"vou assinar", "pode mandar o link", "vamos lá"') &&
    JULIA_SYSTEM_PROMPT.includes('"você é atenciosa", "gostei do jeito que você explica"'),
);
ok(
  "proíbe revelar com ele irritado, cético ou reclamando de preço",
  JULIA_SYSTEM_PROMPT.includes("irritado, cético ou reclamando de preço"),
);
ok(
  "pergunta direta tem resposta direta: a verdade na hora",
  JULIA_SYSTEM_PROMPT.includes('perguntar direto "você é um robô?"') &&
    JULIA_SYSTEM_PROMPT.includes("responda a verdade na hora"),
);
ok(
  "não revela na abertura",
  JULIA_SYSTEM_PROMPT.includes("Na abertura. Antes de ele viver a conversa"),
);
ok("uma vez por conversa, nunca duas", JULIA_SYSTEM_PROMPT.includes("UMA vez, nunca duas"));
ok(
  "depois de contar, silêncio — sem emendar argumento",
  JULIA_SYSTEM_PROMPT.includes("DEPOIS DE CONTAR, PARE"),
);
ok(
  "a revelação não vira truque de venda",
  JULIA_SYSTEM_PROMPT.includes("NUNCA use a revelação como truque de venda"),
);

secao("Rodada 37 — emoji: a maioria das mensagens não tem");
ok("a seção existe", JULIA_SYSTEM_PROMPT.includes("## EMOJI — use pouco"));
ok(
  "a maioria das mensagens não tem emoji nenhum",
  JULIA_SYSTEM_PROMPT.replace(/\n/g, " ").includes(
    "a MAIORIA das mensagens não tem emoji nenhum",
  ),
);
ok(
  'a regra antiga "no máximo um por mensagem" saiu da regra de ouro',
  !JULIA_SYSTEM_PROMPT.includes("Emoji: no máximo um"),
);
ok(
  "proíbe emoji em resposta técnica",
  JULIA_SYSTEM_PROMPT.includes(
    "em resposta técnica (preço, plano, número de conversas, como funciona)",
  ),
);
ok(
  "proíbe emoji em duas mensagens seguidas",
  JULIA_SYSTEM_PROMPT.includes("em duas mensagens seguidas"),
);
ok(
  "o teto continua: nunca mais de um na mesma mensagem",
  JULIA_SYSTEM_PROMPT.includes("Nunca mais de um emoji na mesma mensagem"),
);

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 38 — posicionamento de categoria e a história do fundador. A Júlia
// para de dizer "a gente tá começando agora" como desculpa e passa a contar a
// história real (Dr. Renato, o projeto de gestão, os dois engenheiros) e a
// criar a própria categoria: a primeira secretária COMERCIAL da odontologia.
// O que NÃO mudou: inventar número, depoimento ou resultado segue proibido.
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 38 — a história do Dr. Renato");
ok(
  "a seção de origem existe",
  JULIA_SYSTEM_PROMPT.includes("## DE ONDE VEM O CAPTACLIN"),
);
ok(
  "a história completa está lá: projeto de gestão, saída, dois engenheiros",
  JULIA_SYSTEM_PROMPT.includes("projeto grande de gestão em odontologia") &&
    JULIA_SYSTEM_PROMPT.includes("Ele saiu de lá e se juntou a dois engenheiros de software"),
);
ok(
  "o eixo da história: gestão cuida de quem JÁ é paciente",
  JULIA_SYSTEM_PROMPT.includes("Sistema de gestão cuida de quem JÁ é paciente"),
);
ok(
  "a história só sai com gancho, nunca por iniciativa própria",
  JULIA_SYSTEM_PROMPT.includes("QUANDO CONTAR — só com gancho. NUNCA por iniciativa própria"),
);
ok(
  "os ganchos estão listados (desconfiança, origem, comparação, diferencial)",
  JULIA_SYSTEM_PROMPT.includes('"nunca ouvi falar", "como vou confiar?"') &&
    JULIA_SYSTEM_PROMPT.includes('"quem criou?", "como surgiu?"'),
);
ok(
  "e o quando NÃO contar também (abertura, enfeite, confiança já dada, bis)",
  JULIA_SYSTEM_PROMPT.includes("não conhecer sua biografia") &&
    JULIA_SYSTEM_PROMPT.includes("Duas vezes na mesma conversa"),
);
ok(
  "a história entra em pedaços, nunca a saga inteira",
  JULIA_SYSTEM_PROMPT.includes("conte em PEDAÇOS, nunca a saga inteira"),
);
ok(
  "nome completo e Instagram do Dr. Renato: ela diz que não sabe",
  JULIA_SYSTEM_PROMPT.includes("SE ELE PERGUNTAR O NOME COMPLETO OU O INSTAGRAM DO DR. RENATO") &&
    JULIA_SYSTEM_PROMPT.includes('"essa eu não sei te dizer"'),
);
ok(
  "o nome do projeto anterior está proibido de citar",
  JULIA_SYSTEM_PROMPT.includes("NÃO cite o nome do projeto anterior"),
);
ok(
  'a desculpa "a gente tá começando agora" morreu — só sobrevive dentro da proibição',
  JULIA_SYSTEM_PROMPT.split("\n").filter((l) => /começando/.test(l)).length === 1 &&
    JULIA_SYSTEM_PROMPT.includes('nunca diga "a gente tá começando agora" como se fosse'),
);

secao("Rodada 38 — a categoria: primeira secretária comercial da odontologia");
ok(
  "a seção de categoria existe",
  JULIA_SYSTEM_PROMPT.includes("## O CAPTACLIN NÃO TEM CONCORRENTE"),
);
ok(
  "a definição da categoria está lá",
  JULIA_SYSTEM_PROMPT.includes("a primeira secretária COMERCIAL da odontologia"),
);
ok(
  "atendente responde quem chega; comercial vai atrás",
  JULIA_SYSTEM_PROMPT.includes("Atendente responde quem chega. Comercial vai atrás"),
);
for (const item of [
  "USA TÉCNICA DE VENDA",
  "CUIDA DO LEAD DE ANÚNCIO E DE INDICAÇÃO",
  "VAI ATRÁS DE PACIENTE SUMIDO",
  "CRIA CONEXÃO ANTES DA CADEIRA",
  "MANTÉM O DENTISTA INFORMADO",
]) {
  ok(`item do "que só ela faz": ${item}`, JULIA_SYSTEM_PROMPT.includes(item));
}
ok(
  "o enquadramento recepcionista × vendedor está lá",
  JULIA_SYSTEM_PROMPT.includes("comparar recepcionista com"),
);
ok(
  "a frase de posicionamento está na ponta da língua",
  JULIA_SYSTEM_PROMPT.includes("É uma secretária comercial: ela não só responde o paciente"),
);

secao("Rodada 38 — a ligação por IA, no tempo certo do verbo");
ok(
  "a seção existe",
  JULIA_SYSTEM_PROMPT.includes("## O QUE ESTÁ SENDO CONSTRUÍDO: ligação por IA"),
);
ok(
  '"estamos desenvolvendo", nunca "vai ter"',
  JULIA_SYSTEM_PROMPT.includes('Diga "estamos desenvolvendo", nunca "vai ter" nem "logo terá"'),
);
ok(
  "data está proibida, até aproximada",
  JULIA_SYSTEM_PROMPT.includes("NUNCA dê data, nem aproximada"),
);
ok(
  "proibido usar como argumento de fechamento",
  JULIA_SYSTEM_PROMPT.includes("NUNCA use como argumento de fechamento"),
);
ok(
  "a linha dos planos continua conservadora (em breve, sem data)",
  JULIA_SYSTEM_PROMPT.includes("EM BREVE, ainda não existe. Nunca prometa data"),
);

secao("Rodada 38 — o que não podia se perder");
ok(
  "a proibição de inventar continua intacta, palavra por palavra",
  JULIA_SYSTEM_PROMPT.includes(
    "PROIBIDO ABSOLUTO: inventar número, porcentagem, depoimento, nome de clínica ou resultado",
  ),
);
ok(
  "quando ele pedir prova, a resposta continua sendo o trial, não uma história",
  JULIA_SYSTEM_PROMPT.includes("QUANDO ELE PEDIR PROVA OU RESULTADO") &&
    JULIA_SYSTEM_PROMPT.includes("A prova quem faz é você"),
);
ok(
  "o follow-up 3 perdeu a nota de imaturidade e manteve a honestidade",
  !FOLLOW_UP_TEMPLATES[3]("Marina", null).includes("começando") &&
    FOLLOW_UP_TEMPLATES[3]("Marina", null).includes("não vou te mostrar resultado de outra clínica"),
);
ok(
  "o follow-up 3 continua oferecendo trial e garantia, não prova social",
  FOLLOW_UP_TEMPLATES[3]("Marina", null).includes("trial sem cartão") &&
    FOLLOW_UP_TEMPLATES[3]("Marina", null).includes("7 dias pra pedir o dinheiro de volta"),
);

secao("Rodada 38 — emoji nos templates fixos: a maioria não tem");
{
  // A Rodada 37 calibrou o emoji da conversa ao vivo, mas os textos fixos são
  // determinísticos — a regra do prompt não os alcança. Emoji em toda mensagem
  // automática é a assinatura mais óbvia de robô, e estas são justamente as
  // mensagens que o dentista recebe sem pedir.
  const EMOJI = /\p{Extended_Pictographic}/u;
  const fixos = [
    FOLLOW_UP_TEMPLATES[1]("Marina", null),
    FOLLOW_UP_TEMPLATES[2]("Marina", null),
    FOLLOW_UP_TEMPLATES[3]("Marina", null),
    FOLLOW_UP_TEMPLATES[4]("Marina", null),
    ABORDAGEM_TOQUES[1]("Marina"),
    ABORDAGEM_TOQUES[2]("Marina"),
  ];
  const comEmoji = fixos.filter((t) => EMOJI.test(t));
  ok(
    "dos 6 textos fixos, no máximo 2 têm emoji",
    comEmoji.length <= 2,
    comEmoji.join(" | "),
  );
  ok(
    "nenhum toque de abordagem fria tem emoji (emoji de estranho soa forçado)",
    !EMOJI.test(ABORDAGEM_TOQUES[1]("Marina")) &&
      !EMOJI.test(ABORDAGEM_TOQUES[2]("Marina")),
  );
  ok(
    "nenhum texto fixo tem mais de um emoji",
    fixos.every((t) => (t.match(/\p{Extended_Pictographic}/gu) ?? []).length <= 1),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 40 — "como vou pagar isso? é seguro? não é golpe?". Segurança de
// pagamento é MEDO, não objeção de preço — e medo se responde com fato
// verificável: o dinheiro passa pelo Asaas, regulado pelo Banco Central.
// Verificado antes de aplicar (agosto/2026): o bundle de produção do CaptaClin
// diz "Pagamento processado por Asaas"; @captaclin.ia existe e está ativo;
// @asaas.brasil é o perfil oficial verificado do Asaas; asaas.com e a página
// do Reclame Aqui respondem 200.
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 40 — segurança do pagamento: medo se responde com fato");
ok(
  "a seção existe",
  JULIA_SYSTEM_PROMPT.includes('## "COMO VOU PAGAR ISSO? É SEGURO? NÃO É GOLPE?"'),
);
ok(
  "o ponto que resolve: o dinheiro não vem direto pro CaptaClin",
  JULIA_SYSTEM_PROMPT.includes("o CaptaClin NÃO recebe o dinheiro direto"),
);
ok(
  "Asaas como Instituição de Pagamento autorizada pelo Banco Central",
  JULIA_SYSTEM_PROMPT.includes("Instituição de Pagamento autorizada pelo Banco Central"),
);
ok(
  "o Instagram certo do Asaas está lá",
  JULIA_SYSTEM_PROMPT.includes("@asaas.brasil"),
);
ok(
  // A armadilha da pesquisa: existe um perfil quase homônimo que é marca de
  // roupa. O handle errado não pode estar disponível NEM dentro do aviso —
  // texto presente é texto que o modelo pode mandar.
  "o Instagram errado não existe no prompt, nem dentro do aviso",
  !JULIA_SYSTEM_PROMPT.includes("asaasofficial"),
);
ok(
  "o link do Reclame Aqui do Asaas está lá",
  JULIA_SYSTEM_PROMPT.includes(
    "https://www.reclameaqui.com.br/empresa/asaas-gestao-financeira/",
  ),
);
ok(
  "a nota do Reclame Aqui vai como aproximação, nunca cravada",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes("nota em torno de 8,4/10"),
);
ok(
  "o Instagram do CaptaClin está em QUEM SOMOS",
  JULIA_SYSTEM_PROMPT.includes("@captaclin.ia") &&
    JULIA_SYSTEM_PROMPT.indexOf("@captaclin.ia") <
      JULIA_SYSTEM_PROMPT.indexOf('## "COMO VOU PAGAR ISSO?'),
);
ok(
  'proíbe dizer que o Asaas "nunca teve reclamação"',
  JULIA_SYSTEM_PROMPT.includes('Nunca diga que o Asaas "nunca teve reclamação"'),
);
ok(
  "proíbe se ofender com a pergunta sobre golpe",
  JULIA_SYSTEM_PROMPT.includes("Nunca se ofenda com a pergunta") &&
    JULIA_SYSTEM_PROMPT.includes("quem não vai comprar não pergunta se é golpe"),
);
ok(
  "manda parar depois de responder, sem emendar venda",
  JULIA_SYSTEM_PROMPT.includes("DEPOIS DE RESPONDER, PARE"),
);

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 42 — a conversa real que motivou: ela escreveu "se quiser, me diz como
// posso te chamar" (e ele pulou o nome), e respondeu "R$491" na segunda
// mensagem (e a conversa morreu ali). O nome não é opcional, e preço sem dor é
// só um número grande.
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 42 — o nome não é opcional");
{
  // O recorte é o MODO A: é a abertura de quem chama, onde o nome se pede. O
  // "se quiser" existe legitimamente em outros pontos do prompt ("Se quiser
  // ler agora, tá público") — o que não pode é aparecer no pedido do nome.
  const inicioModoA = JULIA_SYSTEM_PROMPT.indexOf("MODO A — ELE CHAMOU VOCÊ");
  const fimModoA = JULIA_SYSTEM_PROMPT.indexOf("MODO B — VOCÊ CHAMOU ELE");
  const modoA = JULIA_SYSTEM_PROMPT.slice(inicioModoA, fimModoA);
  ok("o recorte do MODO A existe", inicioModoA > -1 && fimModoA > inicioModoA);
  ok(
    'o MODO A não contém "se quiser" nem "se puder" soltos no pedido do nome',
    !modoA.toLowerCase().includes("e, se quiser") &&
      !modoA.toLowerCase().includes("se puder, me diz") &&
      modoA.includes('NUNCA escreva "se quiser", "se puder" ou "se preferir" ao pedir o nome'),
  );
  ok(
    "a ordem da abertura é apresentar → pedir o nome → oferecer ajuda",
    modoA.includes("apresentar → PEDIR O NOME → oferecer ajuda"),
  );
  ok("e o nome não é opcional", modoA.includes("o nome NÃO é opcional"));
  ok(
    "se ele chega com dúvida: essencial em uma frase E o nome na mesma mensagem",
    modoA.includes("responda o essencial em UMA frase E peça o nome na MESMA mensagem"),
  );
  ok(
    "proíbe insistir mais de uma vez pelo nome",
    modoA.replace(/\n\s*/g, " ").includes("não insista mais de uma vez") &&
      modoA.includes("chato é pedir duas vezes"),
  );
}

secao("Rodada 42.1 — a apresentação não é cortável");
{
  // Ela mandou "Oi! Claro, me fala 🙂 Antes, como posso te chamar?" para quem
  // tinha escrito "vim pelo site do CaptaClin" — deduziu que ele já sabia quem
  // ela era. O prompt mandava VARIAR a abertura e não travava o que NÃO varia.
  const inicioModoA = JULIA_SYSTEM_PROMPT.indexOf("MODO A — ELE CHAMOU VOCÊ");
  const fimModoA = JULIA_SYSTEM_PROMPT.indexOf("MODO B — VOCÊ CHAMOU ELE");
  const modoA = JULIA_SYSTEM_PROMPT.slice(inicioModoA, fimModoA);
  const corrido = modoA.replace(/\n\s*/g, " ");

  ok(
    "a trava existe: o que varia e o que não varia",
    modoA.includes("O QUE VARIA E O QUE NÃO VARIA NA ABERTURA"),
  );
  ok(
    "varia a palavra, nunca o elemento",
    corrido.includes("Você varia as PALAVRAS, nunca os elementos"),
  );
  ok(
    "elemento 1 — quem ela é, sempre e sem exceção",
    corrido.includes('1. Quem você é: "Júlia, do CaptaClin" — sempre, sem exceção'),
  );
  ok(
    "elemento 2 — o pedido do nome, sem 'se quiser'",
    corrido.includes('2. O pedido do nome, sem "se quiser"'),
  );
  ok(
    "proíbe cortar a apresentação achando que ele já sabe",
    corrido.includes("Não corte a apresentação achando que ele já sabe"),
  );
  ok(
    "e diz o porquê: ele falou com o SITE, não com ela",
    corrido.includes("ele falou com o SITE, não com você — quem atende se apresenta"),
  );
  ok(
    "mesmo com pressa (ele já chegou com a dúvida), a apresentação fica",
    corrido.includes("A apresentação continua obrigatória aqui"),
  );

  // A trava só vale se os EXEMPLOS a obedecerem — foi um exemplo sem
  // apresentação que ela copiou. Toda fala de abertura entre aspas no MODO A
  // que peça o nome tem que dizer quem ela é.
  const pedemONome = (corrido.match(/"[^"]*(?:como posso te chamar|com quem eu falo|qual seu nome|qual é o seu nome)[^"]*"/gi) ?? []);
  ok(
    "o MODO A tem exemplos de abertura pedindo o nome",
    pedemONome.length >= 3,
    `encontrados: ${pedemONome.length}`,
  );
  ok(
    "NENHUM exemplo de abertura pede o nome sem se apresentar",
    pedemONome.every((frase) => /Júlia/.test(frase) && /CaptaClin/.test(frase)),
    pedemONome.filter((f) => !/Júlia/.test(f) || !/CaptaClin/.test(f)).join(" | "),
  );

  // E o "VARIE" lá embaixo, que foi quem autorizou o corte, agora aponta para
  // a trava em vez de mandar variar sem limite.
  ok(
    "o VARIE diz que variar não é cortar elemento",
    JULIA_SYSTEM_PROMPT.includes(
      "Variar é escolher outras PALAVRAS, nunca cortar elementos",
    ),
  );
  ok(
    "os três exemplos do VARIE também se apresentam",
    ["Oi! Aqui é a Júlia, do CaptaClin", "Olá! Júlia falando, do CaptaClin", "Sou a Júlia, do CaptaClin"].every(
      (e) => JULIA_SYSTEM_PROMPT.includes(e),
    ),
  );
}

secao("Rodada 42 — preço antes da dor mata a venda");
ok(
  "a trava existe: nunca dar preço na primeira resposta sobre plano",
  JULIA_SYSTEM_PROMPT.includes("NUNCA DÊ PREÇO NA PRIMEIRA RESPOSTA SOBRE PLANO"),
);
ok(
  "a resposta à pergunta de preço é UMA pergunta que dimensiona a dor",
  JULIA_SYSTEM_PROMPT.includes("a\nresposta NÃO é o valor") ||
    JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes("a resposta NÃO é o valor"),
);
ok(
  "o porquê está dito: preço sem dor é só um número grande",
  JULIA_SYSTEM_PROMPT.includes("Preço sem dor é só um número grande"),
);
ok(
  "se ele insistir, o valor sai na hora — fugir duas vezes queima a confiança",
  JULIA_SYSTEM_PROMPT.includes("SE ELE INSISTIR NO PREÇO") &&
    JULIA_SYSTEM_PROMPT.includes("dê o valor, sem enrolar") &&
    JULIA_SYSTEM_PROMPT.includes("Fugir duas vezes da mesma pergunta irrita"),
);
ok(
  "tráfego pago é o maior gancho — nunca pular direto para o preço",
  JULIA_SYSTEM_PROMPT.includes("E QUANDO ELE DISSER QUE FAZ TRÁFEGO PAGO") &&
    JULIA_SYSTEM_PROMPT.includes("NUNCA passe direto para o preço"),
);
ok(
  'o "PREÇO SE FALA" continua de pé, agora sem contradizer a trava',
  JULIA_SYSTEM_PROMPT.includes("PREÇO SE FALA — a trava acima muda o QUANDO, nunca o SE"),
);
ok(
  "a promoção continua sendo o argumento colado no preço",
  JULIA_SYSTEM_PROMPT.includes("O Essencial tá R$297 nos 3 primeiros meses, depois vai pra R$397"),
);

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 44 — o teto. Cada resposta ao dentista paga o prompt inteiro, e o
// limite da conta na OpenAI é por MINUTO: prompt maior significa menos
// dentistas atendidos por minuto, e foi assim que quinze deles receberam
// silêncio em 12/08. O teto não impede o prompt de crescer — impede que ele
// cresça sem ninguém decidir.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 45 — o trial é de 3 DIAS, não 7. Conferido na fonte real (bundle de
// produção de captaclin.com.br, 12/08/2026): "Dura 3 dias ou 2 conversas (o que
// vier primeiro), sem cartão" e o selo "✅ 3 dias grátis · 7 dias de garantia".
// Os 7 dias que sobrevivem são só os da GARANTIA (CDC art. 49, confirmado no
// mesmo bundle). Prometer sete dias de teste é a mesma classe de erro das
// Rodadas 30, 31 e 36: o dentista entra esperando uma semana e o acesso morre
// no terceiro dia.
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 45 — o trial é de 3 dias");
ok(
  "o prompt diz 3 dias, e diz que é o que vier primeiro",
  JULIA_SYSTEM_PROMPT.includes("3 DIAS ou 2 CONVERSAS, o que vier primeiro"),
);
ok(
  "o exemplo de fala também diz 3 dias",
  JULIA_SYSTEM_PROMPT.includes("3 dias ou\n2 conversas, o que acabar primeiro") ||
    JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
      "3 dias ou 2 conversas, o que acabar primeiro",
    ),
);
ok(
  'o "o que vier primeiro" é explicado, não só citado',
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "quem usa as duas conversas no primeiro dia acaba o teste no primeiro dia",
  ),
);
ok(
  "ela é proibida de vender o trial como uma semana",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "Nunca venda o trial como uma semana",
  ),
);
ok(
  "o aviso explica que os 7 dias são da garantia, não do trial",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "os 7 dias são da GARANTIA e só existem depois de assinar",
  ),
);
ok(
  // Rodada 46 fechou a pendência: o limite de 15 EXISTE — não estava no site,
  // estava no CONTRATO (cláusulas 2.b e 5.2). A Rodada 45 fez certo em tirar
  // em vez de chutar; agora o número volta com fonte.
  "os limites do trial são exatamente três: dias, conversas e mensagens",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "Os limites do trial são exatamente estes três: 3 dias, 2 conversas, 15 mensagens por contato a cada 24h",
  ),
);
ok(
  "inventar teto continua proibido — qualquer número fora desses é chute",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "Qualquer outro número é chute",
  ),
);

secao("Rodada 45 — nenhum 'sete dias' sobrou colado no trial");
{
  // A varredura que a rodada pediu, virada tripwire: toda ocorrência de "7
  // dias" tem que estar perto de um marcador de GARANTIA (é dela que os sete
  // dias são), da CARÊNCIA de pagamento (Rodada 46 — contrato, Seção 9: 7 dias
  // com tudo funcionando antes de suspender) ou dentro de uma PROIBIÇÃO.
  // Qualquer outra é promessa errada.
  const GARANTIA = /garantia|assinar|assinou|assina o plano|reembolso|dinheiro de volta|arrependimento|por lei|CDC|depois de pagar|carência|vencimento|cobrança|suspen/i;
  const PROIBICAO = /NUNCA|não venda|nao venda|achando que|prometer|classe de erro|não diga|nao diga/i;

  const suspeitas: string[] = [];
  const texto = JULIA_SYSTEM_PROMPT;
  for (const m of texto.matchAll(/(7|sete)\s*dias?/gi)) {
    const ini = Math.max(0, (m.index ?? 0) - 180);
    const contexto = texto.slice(ini, (m.index ?? 0) + 180).replace(/\s+/g, " ");
    if (GARANTIA.test(contexto) || PROIBICAO.test(contexto)) continue;
    suspeitas.push(contexto.slice(0, 120));
  }
  ok(
    'todo "7 dias" do prompt é da garantia ou de uma proibição',
    suspeitas.length === 0,
    suspeitas.join(" || "),
  );

  // E o caminho inverso: nenhuma frase pode oferecer o trial por 7 dias.
  const proibidas = [
    "trial grátis de 7 dias",
    "trial de 7 dias",
    "7 dias, SEM cartão",
    "7 dias grátis, sem cartão",
    "de graça por 7 dias",
    "7 dias com tudo liberado",
  ];
  const achadas = proibidas.filter((p) => JULIA_SYSTEM_PROMPT.includes(p));
  ok(
    "nenhuma forma de oferecer o trial por 7 dias sobreviveu",
    achadas.length === 0,
    achadas.join(" | "),
  );
}

secao("Rodada 45 — a comparação com secretária, completa");
ok(
  "o contador entrou na conta",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "Some o contador que processa a folha",
  ),
);
ok(
  "o custo mensal fecha perto de R$3.000",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes("chega perto de R$3.000 por mês"),
);
ok(
  "o número ANUAL existe — é onde a diferença aparece",
  JULIA_SYSTEM_PROMPT.includes("R$36 mil") && JULIA_SYSTEM_PROMPT.includes("R$3.564"),
);
ok(
  "e a diferença anual é dita",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes("A diferença\n passa de R$32 mil") ||
    JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes("A diferença passa de R$32 mil"),
);
ok(
  "a conta é dita em duas partes, mês e ano",
  JULIA_SYSTEM_PROMPT.includes("A CONTA, dita com calma e em DUAS partes"),
);
ok(
  "manda parar depois da conta",
  JULIA_SYSTEM_PROMPT.includes("DEPOIS DA CONTA, PARE"),
);
ok(
  "o que ela NÃO faz cobre madrugada e fim de semana",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "não atende feriado, e não atende de madrugada",
  ),
);

secao("Rodada 45 — 'não vou mandar minha secretária embora'");
ok(
  "a objeção tem seção própria",
  JULIA_SYSTEM_PROMPT.includes('## "MAS EU NÃO VOU MANDAR MINHA SECRETÁRIA EMBORA"'),
);
ok(
  "ela concorda de verdade — o dentista está certo",
  JULIA_SYSTEM_PROMPT.includes("E o dentista está CERTO — concorde de verdade"),
);
ok(
  "proíbe sugerir demissão em qualquer forma, inclusive como hipótese",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "NUNCA sugira demitir ninguém. Nem por insinuação, nem como hipótese, nem como conta",
  ),
);
ok(
  "o reenquadramento é LIBERAÇÃO, não substituição",
  JULIA_SYSTEM_PROMPT.includes("não é de substituição, é de LIBERAÇÃO"),
);
ok(
  'a palavra "libera" aparece no reenquadramento',
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "você libera a sua secretária pra fazer o que ela faz melhor",
  ),
);
ok(
  "a IA fica com agenda e WhatsApp, inclusive quando ela não está lá",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "inclusive de madrugada e no fim de semana, quando ela não está lá",
  ),
);
ok(
  "diz para que serve a comparação — dimensionar, não demitir",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "serve para DIMENSIONAR o valor, não para propor demissão",
  ),
);
ok(
  "a seção vem depois da comparação de custo, que é quando a objeção aparece",
  JULIA_SYSTEM_PROMPT.indexOf('## "MAS EU NÃO VOU MANDAR MINHA SECRETÁRIA EMBORA"') >
    JULIA_SYSTEM_PROMPT.indexOf("## QUANDO ELE DIZ QUE ESTÁ CARO"),
);

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 46 — o que o contrato diz e ela não sabia. Fonte: Contrato de
// Assinatura v2.4, lido INTEIRO em 12/08/2026 na API pública que a página
// /contrato consome (GET /api/dental/tos/public?kind=subscription). As
// cláusulas citadas abaixo são as do texto publicado.
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 46 — o teto de mensagens por contato (cláusula 2.b)");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok(
    "o teto dos planos pagos está lá: 60 por contato",
    corrido.includes("60 nos planos pagos, 15 no trial"),
  );
  ok(
    "atingido o teto, PAUSA e volta — não acaba",
    corrido.includes("é PAUSADO e volta sozinho quando reinicia o ciclo de 24h") &&
      JULIA_SYSTEM_PROMPT.includes("Não é perda, é pausa"),
  );
  ok(
    "o porquê do teto vira argumento, não desculpa",
    corrido.includes("margem folgada pra atendimento normal"),
  );
  ok(
    "omitir o teto é nomeado como a armadilha do R$97",
    corrido.includes("Omitir o teto e ele descobrir depois é a mesma armadilha do R$97"),
  );
  ok(
    "o trial diz as 15 mensagens por contato a cada 24h",
    corrido.includes("Cada conversa admite até 15 mensagens por contato a cada 24h"),
  );
  ok(
    "e o exemplo de fala do trial também",
    corrido.includes("o que acabar primeiro, com até 15 mensagens em cada"),
  );
}

secao("Rodada 46 — se o pagamento falhar (Seção 9)");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok(
    "a seção existe, enquadrada como tranquilidade",
    JULIA_SYSTEM_PROMPT.includes('## "E SE O PAGAMENTO FALHAR? MINHA CLÍNICA PARA?"'),
  );
  ok(
    "7 dias de carência com tudo funcionando",
    corrido.includes("7 dias de carência com tudo funcionando"),
  );
  ok(
    "suspensão só a partir do 8º dia",
    corrido.includes("Suspensão só a partir do 8º dia"),
  );
  ok(
    "reativação imediata, sem taxa e sem prazo limite",
    corrido.includes("sem taxa e sem prazo limite"),
  );
  ok(
    "na suspensão os dados ficam guardados e exportáveis",
    corrido.includes("Os dados ficam guardados e ele pode exportar"),
  );
  ok(
    // Cláusula 9.1 — a nuance que uma leitura apressada perde: NÃO há nova
    // tentativa automática garantida (isso era do gateway antigo, v2.4 tirou).
    // Prometer retry é criar a expectativa exata que o contrato desfez.
    'proíbe prometer "o sistema tenta de novo sozinho"',
    corrido.includes("não existe nova tentativa automática de cobrança garantida") &&
      JULIA_SYSTEM_PROMPT.includes('Nunca diga\n"o sistema tenta de novo sozinho"'),
  );
}

secao("Rodada 46 — recarga: não expira, mas não tem reembolso fácil (4.4/4.4.1)");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok("o saldo de recarga NÃO EXPIRA", JULIA_SYSTEM_PROMPT.includes("O SALDO NÃO EXPIRA"));
  ok(
    "e só é consumido depois da cota do mês",
    corrido.includes("só é consumido depois que a cota do mês acabar"),
  );
  ok(
    "sem cancelamento nem reembolso automático pelo painel",
    corrido.includes("NÃO tem cancelamento nem reembolso automático pelo painel"),
  );
  ok(
    "e ela é mandada não prometer reembolso fácil",
    corrido.includes("não prometa reembolso fácil que o contrato não dá"),
  );
}

secao("Rodada 46 — forma de pagamento por tipo (cláusula 7.1)");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok(
    "assinatura, renovação e mudança de plano: só cartão, com recorrência",
    corrido.includes("Assinatura, renovação e mudança de plano: exclusivamente no cartão"),
  );
  ok(
    // Com o plano nomeado na mesma frase: o tripwire da Rodada 31 proíbe
    // oferecer o adicional sem dizer onde ele existe, e tem razão.
    "PIX paga só o avulso: recargas e o profissional adicional",
    corrido.includes(
      "PIX paga só o que é avulso: as recargas e o profissional adicional de R$97 (que só existe no Essencial e Pro)",
    ),
  );
  ok(
    "o profissional adicional NÃO entra na recorrência do cartão",
    corrido.includes("A cobrança é À PARTE, por PIX — não entra na recorrência do cartão"),
  );
  ok(
    "a conta dos R$394 continua certa, mas como dois pagamentos",
    corrido.includes("são dois pagamentos: a mensalidade no cartão e o adicional no PIX"),
  );
  ok(
    'o antigo "PIX serve só para recarga" morreu — estava incompleto',
    !corrido.includes("PIX serve só para recarga"),
  );
}

secao("Rodada 46 — os achados extras da leitura completa");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok(
    "trial é único por profissional (5.6) — não prometer segundo teste",
    corrido.includes("o trial é ÚNICO por profissional") &&
      corrido.includes("Não prometa um segundo teste"),
  );
  ok(
    "upgrade imediato e proporcional; downgrade no ciclo seguinte (Seção 10)",
    corrido.includes("upgrade vale na hora, pagando só a diferença proporcional") &&
      corrido.includes("downgrade entra no início do ciclo seguinte"),
  );
  ok(
    "cancelou depois da garantia: acesso até o fim do ciclo pago (8.2.b)",
    corrido.includes("mantém o acesso até o fim do ciclo que já pagou"),
  );
  ok(
    "a garantia diz COMO exercer (6.4) e não promete data de devolução (6.3)",
    corrido.includes("o pedido é pelo painel, na área de Assinatura") &&
      corrido.includes("não prometa data para o dinheiro cair"),
  );
  ok(
    "a garantia vale para PJ por liberalidade (6.2)",
    corrido.includes("vale até para pessoa jurídica"),
  );
  ok(
    "na dúvida sobre regra escrita, o link do contrato vence o improviso",
    corrido.includes("mande o link do contrato em vez de arriscar"),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 47 — a Júlia para de pedir permissão pra vender. Conversa real com a
// Dra. Juliana (atende sozinha, R$100/mês de anúncio): seis pedidos de licença
// ("se quiser, eu te comparo..."), contrato oferecido sem ninguém pedir logo
// depois de dissolver o "é golpe?", e o Essencial recomendado três vezes no
// escuro — com três "tá caro" de resposta e nenhuma reconsideração de plano.
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 47 — ela não pede permissão para fazer o próprio trabalho");
ok(
  "a seção existe",
  JULIA_SYSTEM_PROMPT.includes("## VOCÊ NÃO PEDE PERMISSÃO PARA FAZER SEU TRABALHO"),
);
ok(
  "vendedor bom não pergunta se pode mostrar — mostra",
  JULIA_SYSTEM_PROMPT.includes("Vendedor bom não pergunta se pode mostrar. Ele mostra."),
);
ok(
  'proíbe abrir argumento com "se quiser"',
  JULIA_SYSTEM_PROMPT.includes('"Se quiser, eu te comparo com..."') &&
    JULIA_SYSTEM_PROMPT.includes('"Se quiser, eu posso te falar sobre..."'),
);
ok('proíbe "quer que eu te mostre"', JULIA_SYSTEM_PROMPT.includes('"Quer que eu te mostre...?"'));
ok('proíbe "posso te explicar"', JULIA_SYSTEM_PROMPT.includes('"Posso te explicar...?"'));
ok(
  "o porquê está dito: oferta se recusa",
  JULIA_SYSTEM_PROMPT.includes("transforma argumento em OFERTA — e oferta se recusa"),
);
ok(
  "permissão antes de pergunta pessoal continua permitida",
  JULIA_SYSTEM_PROMPT.includes('"Posso te fazer uma pergunta?" antes de perguntar quanto ele fatura'),
);
ok(
  "permissão antes do link de assinatura continua permitida",
  JULIA_SYSTEM_PROMPT.includes('"Quer que eu já te mande o link?" antes do link de assinatura'),
);
ok(
  "o fecho: argumento e informação se mostram, não se perguntam",
  JULIA_SYSTEM_PROMPT.includes(
    "Argumento, comparação, explicação e informação: mostra. Não pergunta.",
  ),
);
ok(
  // A exceção não pode matar os links de conferência da resposta do golpe
  // ("se quiser conferir, tá tudo público" ENTREGA os links na mesma mensagem).
  "entregar link de conferência junto da resposta não é pedir licença",
  JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ").includes(
    "o problema é a mensagem que só oferece e não entrega nada",
  ),
);

secao("Rodada 47 — contrato e termos só entram se ele pedir");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok("a regra existe, colada nos links", JULIA_SYSTEM_PROMPT.includes("MAS SÓ SE ELE PEDIR"));
  ok(
    "o conhecimento do contrato é para conduzir, não para empurrar documento",
    corrido.includes("não para empurrar documento"),
  );
  ok(
    "proíbe oferecer por iniciativa própria",
    corrido.includes("NUNCA ofereça contrato, termos ou política de privacidade por iniciativa própria"),
  );
  ok(
    "o porquê: planta desconfiança que não existia",
    corrido.includes("planta uma desconfiança que não existia"),
  );
  ok(
    "os três casos em que o link entra estão listados",
    corrido.includes("quando ele pedir o documento") &&
      corrido.includes("quer ler antes de assinar") &&
      corrido.includes("regra jurídica delicada"),
  );
  ok(
    'depois de responder "é golpe?", sem emendar documento',
    corrido.includes("E NEM ofereça contrato e termos que ele não pediu"),
  );
  ok(
    "e o porquê de não emendar: parece defesa",
    corrido.includes("emendar mais prova parece que você está insistindo em se defender"),
  );
}

secao('Rodada 47 — "caro" repetido não é objeção, é plano errado');
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok(
    "a regra existe",
    JULIA_SYSTEM_PROMPT.includes('⚠️ "CARO" REPETIDO NÃO É OBJEÇÃO — É PLANO ERRADO'),
  );
  ok(
    "na segunda vez o problema é o plano, não o argumento",
    corrido.includes("na segunda vez o problema não é o argumento — é o plano"),
  );
  ok(
    "reconsiderar em voz alta, sem constrangimento",
    JULIA_SYSTEM_PROMPT.includes("Reconsidere em voz alta, sem constrangimento"),
  );
  ok(
    "a fala pronta desce de plano com os fatos que ela contou",
    corrido.includes("o Essencial é maior do que você precisa agora") &&
      corrido.includes("O Básico resolve o seu caso"),
  );
  ok(
    "descer de plano é virar consultora, e consultora fecha",
    corrido.includes("é virar consultora, e consultora fecha"),
  );
  ok(
    "a regra fica DEPOIS da comparação com a recepcionista (que vale pro primeiro caro)",
    JULIA_SYSTEM_PROMPT.indexOf('"CARO" REPETIDO') >
      JULIA_SYSTEM_PROMPT.indexOf("## QUANDO ELE DIZ QUE ESTÁ CARO") &&
      corrido.includes("A comparação acima vale para o PRIMEIRO"),
  );
}

secao("Rodada 47 — recomendação exige profissionais E verba de anúncio");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok(
    "o pré-requisito existe",
    JULIA_SYSTEM_PROMPT.includes(
      "⚠️ O QUE AFINA A RECOMENDAÇÃO: PROFISSIONAIS E VERBA DE ANÚNCIO",
    ),
  );
  ok(
    "as duas perguntas estão nomeadas",
    corrido.includes("quantos profissionais atendem, e quanto ele investe em anúncio"),
  );
  // RODADA 54. Antes: "sem as duas respostas é CHUTE" — e chute era motivo para
  // insistir. O custo de recomendar no escuro continua escrito (a conversa real
  // do "tá caro" três vezes); o que mudou é o conserto: DIZER o que se assumiu,
  // nunca voltar a perguntar. Sem esta virada, a regra de parada acima seria
  // contradita por esta seção — e o modelo obedece a que vier primeiro.
  ok(
    "recomendar no escuro tem preço, mas o conserto é declarar, não insistir",
    corrido.includes("o conserto é DIZER o que você assumiu — nunca insistir") &&
      corrido.includes('ouviu "tá caro" três vezes'),
  );
  ok(
    "a trava de preço também barra a recomendação no escuro",
    corrido.includes("a resposta NÃO é o valor NEM uma recomendação de plano"),
  );
  ok(
    "os critérios de cada plano existem",
    JULIA_SYSTEM_PROMPT.includes("PARA QUEM CADA PLANO SERVE"),
  );
  ok(
    "BÁSICO: sozinho, verba pequena, não perder quem chama",
    corrido.includes("BÁSICO: atende sozinho, verba de anúncio pequena ou nenhuma"),
  );
  ok(
    "ESSENCIAL: anúncio de verdade, equipe, ou precisa que ela venda",
    corrido.includes("ESSENCIAL: investe de verdade em anúncio") &&
      corrido.includes("precisa que ela VENDA (SPIN, remarketing, CRM) e não só atenda"),
  );
  ok(
    "PRO: recuperação, pós-consulta e relatórios",
    corrido.includes("PRO: quer recuperação de paciente, pós-consulta automático e relatórios"),
  );
  ok(
    "o pré-requisito vem antes do PREÇO SE FALA, dentro da seção de planos",
    JULIA_SYSTEM_PROMPT.indexOf("RECOMENDAÇÃO TEM PRÉ-REQUISITO") <
      JULIA_SYSTEM_PROMPT.indexOf("PREÇO SE FALA"),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 48 — a conta vem antes de descer de plano. Conversa real da Dra.
// Luana (atende sozinha, R$100/mês de anúncio): a Rodada 47 funcionou —
// descoberta completa, desceu para o Básico, tirou o R$97 que o colega não
// precisava — mas a comparação com o custo de secretária (Rodada 45) nunca
// apareceu, com dois "caro" na mesa. O gatilho "está caro" tinha DUAS
// instruções concorrentes e o modelo escolhia uma; e a comparação inteira
// pressupunha secretária existente, então para quem atende sozinho ela
// parecia inaplicável. Agora a ordem é explícita e o caso solo tem fala.
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 48 — o 'tá caro' tem duas respostas, na ordem certa");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok(
    "a ordem é explícita, e as duas acontecem",
    JULIA_SYSTEM_PROMPT.includes('O "TÁ CARO" TEM DUAS RESPOSTAS, NESTA ORDEM — as duas acontecem'),
  );
  ok(
    "a primeira resposta é a conta",
    corrido.includes('No PRIMEIRO "tá caro": MOSTRE A CONTA'),
  );
  ok(
    "o porquê está dito: preço no vácuo é só um número",
    corrido.includes('"R$197" sozinho é só um número'),
  );
  ok(
    "descer de plano sem a conta está proibido",
    corrido.includes("NUNCA desça de plano sem antes ter mostrado a conta"),
  );
  ok(
    "o caro repetido agora exige a conta antes",
    corrido.includes("plano reconsiderado sem a conta é desconto no escuro") &&
      corrido.includes("Se ele repetir que está caro DEPOIS de ver a conta"),
  );
  ok(
    "a regra da Rodada 47 continua de pé (o primeiro caro é da comparação)",
    corrido.includes("A comparação acima vale para o PRIMEIRO"),
  );
  ok(
    "a ordem mora DENTRO da seção do caro, antes dos números",
    JULIA_SYSTEM_PROMPT.indexOf('O "TÁ CARO" TEM DUAS RESPOSTAS') >
      JULIA_SYSTEM_PROMPT.indexOf("## QUANDO ELE DIZ QUE ESTÁ CARO") &&
      JULIA_SYSTEM_PROMPT.indexOf('O "TÁ CARO" TEM DUAS RESPOSTAS') <
        JULIA_SYSTEM_PROMPT.indexOf("OS NÚMEROS (use como"),
  );
}

secao("Rodada 48 — quem atende sozinho também recebe a conta");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok("o caso existe", JULIA_SYSTEM_PROMPT.includes("SE ELE ATENDE SOZINHO"));
  ok(
    "a conta muda de verbo: o que CUSTARIA contratar",
    corrido.includes("compare com o que CUSTARIA contratar"),
  );
  ok(
    "a fala pronta existe e fecha no plano do caso solo",
    corrido.includes("pra contratar alguém só pra responder o WhatsApp") &&
      corrido.includes("O Básico é R$197"),
  );
  ok(
    "os números do caso solo continuam aproximados (uns, não cravados)",
    corrido.includes("uns R$1.900 de salário"),
  );
  ok(
    "o caso solo fica dentro da seção do caro, antes do PARE",
    JULIA_SYSTEM_PROMPT.indexOf("SE ELE ATENDE SOZINHO") >
      JULIA_SYSTEM_PROMPT.indexOf("## QUANDO ELE DIZ QUE ESTÁ CARO") &&
      JULIA_SYSTEM_PROMPT.indexOf("SE ELE ATENDE SOZINHO") <
        JULIA_SYSTEM_PROMPT.indexOf("DEPOIS DA CONTA, PARE"),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 49 — parar quando ele encerra. Conversa real da Dra. Luana, parte 2:
// depois de "Obrigada, vou ver aqui" e "Show", a Júlia insistiu DUAS vezes — a
// segunda repetindo as regras do trial já explicadas. O prompt proibia
// insistir depois de um NÃO; encerramento cordial não tinha casa. E o 15 de
// mensagens do trial foi dito quando o assunto já era o Básico (que tem 60) —
// o produto parecia 4x pior do que é.
//
// A correção 2 do documento (sequência numerada do primeiro "tá caro") NÃO
// entrou, de propósito: os horários provaram que o trecho do primeiro "caro"
// rodou entre 21:45 e 21:52 UTC de 12/08, no deployment do prompt da Rodada
// 47 — o deploy da 48 só entrou no ar às 22:01:15. A regra da 48 nunca foi
// exercitada ali; antes de reforçá-la, o teste dela precisa ser refeito.
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 49 — reconhece o encerramento e para");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok("a seção existe", JULIA_SYSTEM_PROMPT.includes("## RECONHEÇA O ENCERRAMENTO E PARE"));
  ok(
    "encerramento não precisa de um 'não'",
    corrido.includes('a conversa acabou, mesmo sem um "não"'),
  );
  for (const sinal of [
    '"obrigado", "obrigada", "valeu"',
    '"vou ver", "vou olhar", "vou analisar", "vou pensar com calma"',
    '"show", "beleza", "ok", "tá bom", "entendi" — sozinhos, sem pergunta junto',
    '"depois eu te falo", "qualquer coisa eu chamo"',
    "ou simplesmente ele parar de fazer perguntas",
  ]) {
    ok(`sinal listado: ${sinal.slice(0, 40)}…`, JULIA_SYSTEM_PROMPT.includes(sinal));
  }
  ok(
    "a resposta é UMA despedida, e acabou",
    JULIA_SYSTEM_PROMPT.includes("O QUE FAZER: UMA despedida curta e cordial, e ACABOU."),
  );
  ok(
    "proíbe repetir informação já dada",
    corrido.includes("repetir o trial, o preço, o link ou qualquer coisa que você já disse"),
  );
  ok(
    'a muleta exata da conversa real está marcada ("só pra você não ficar com dúvida")',
    JULIA_SYSTEM_PROMPT.includes('"só pra você não ficar com dúvida..."'),
  );
  ok(
    "proíbe pergunta para reabrir a conversa",
    corrido.includes("fazer mais uma pergunta para reabrir a conversa"),
  );
  ok(
    "quem cuida do resto é o follow-up",
    corrido.includes("o follow-up cuida do resto"),
  );
  ok(
    "não briga com a objeção 'vou pensar' (a lição da 48: gatilho ambíguo se desambigua)",
    corrido.includes('um "vou pensar" seco ainda é objeção'),
  );
  ok(
    "o princípio 10 ganhou a exceção do encerramento",
    corrido.includes("depois dele, pergunta não segura conversa — reabre incômodo"),
  );
  ok(
    "a seção fica depois do sinal de compra (os dois 'pare' andam juntos)",
    JULIA_SYSTEM_PROMPT.indexOf("## RECONHEÇA O ENCERRAMENTO E PARE") >
      JULIA_SYSTEM_PROMPT.indexOf("## RECONHEÇA O SINAL DE COMPRA E PARE DE VENDER"),
  );
}

secao("Rodada 49 — 15 é do trial, 60 é dos planos pagos");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok("a distinção existe", JULIA_SYSTEM_PROMPT.includes("NÃO CONFUNDA OS DOIS LIMITES"));
  ok(
    "os dois números estão lado a lado",
    corrido.includes("TRIAL: 15 mensagens por contato a cada 24h") &&
      corrido.includes("PLANOS PAGOS (Básico, Essencial e Pro): 60 por contato a cada 24h"),
  );
  ok(
    "manda dizer a qual dos dois se refere",
    corrido.includes("Diga sempre a qual dos dois você está se referindo"),
  );
  ok(
    "a fala do trial emenda o teto maior do pago",
    corrido.includes("Nos planos pagos são 60, folga de sobra pra atendimento normal"),
  );
  {
    // Rede de proteção no espírito das Rodadas 31/32/36: toda linha que fala
    // em "15 mensagens" precisa do trial na vizinhança. É o 15 solto, longe do
    // trial, que fez o Básico parecer 4x menor numa conversa real.
    const linhas = JULIA_SYSTEM_PROMPT.split("\n");
    const soltas = linhas.filter((l, i) => {
      if (!/15\s*mensagens/i.test(l)) return false;
      const janela = [linhas[i - 2] ?? "", linhas[i - 1] ?? "", l].join("\n");
      return !/trial/i.test(janela);
    });
    ok(
      'todo "15 mensagens" do prompt está colado no trial',
      soltas.length === 0,
      soltas.join(" | "),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rodada 50 — ela para de criar objeção sozinha. Conversa real da Dra. Luana:
// apresentou o Básico e emendou o teto de 60 mensagens e o preço da recarga
// sem ninguém perguntar — "vishi, que coisa chata, tem limitação?". Duas
// mensagens desarmando uma bomba que ela mesma armou. A causa: o "nenhum
// custo aparece depois" (Rodadas 32/36/46) tinha virado "anunciar toda
// restrição". Omitir custo que afeta a decisão continua proibido; anunciar
// limitação que ninguém perguntou cria objeção do nada. As instruções que
// mandavam anunciar foram REESCRITAS (não deixadas no ar, lição da 48): o
// teto do contrato perdeu o "diga junto, não omita", e a regra de custo
// ganhou o escopo "EM DISCUSSÃO".
// ─────────────────────────────────────────────────────────────────────────────

secao("Rodada 50 — não anuncia restrição que ninguém perguntou");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok(
    "a regra existe",
    JULIA_SYSTEM_PROMPT.includes("⚠️ MAS NÃO ANUNCIE RESTRIÇÃO QUE NINGUÉM PERGUNTOU"),
  );
  ok(
    "distingue não-omitir de anunciar",
    corrido.includes("Não omitir custo é diferente de anunciar limitação"),
  );
  ok(
    "a apresentação leva o preço e o que resolve",
    corrido.includes("a mensagem leva o PREÇO e o que ele RESOLVE"),
  );
  ok(
    "teto de mensagens e recarga são os exemplos do que NÃO anunciar",
    corrido.includes("Não leve junto teto de mensagens, preço de recarga de conversas"),
  );
  ok(
    "o ERRADO é o da conversa real, com a reação dela",
    corrido.includes('"que coisa chata, tem limitação?"') &&
      corrido.includes("uma objeção que não existia"),
  );
  ok(
    "o CERTO para no preço + o que resolve",
    corrido.includes('lembra o paciente da consulta." E PARA.'),
  );
  ok(
    "quando a restrição entra: ele perguntou",
    JULIA_SYSTEM_PROMPT.includes('"tem limite?", "e se acabar?", "quantas conversas?"'),
  );
  ok(
    "quando a restrição entra: cenário que alcança o limite",
    corrido.includes("descreveu um cenário em que o limite seria alcançado"),
  );
  ok(
    "quando a restrição entra: afeta a escolha dele agora",
    corrido.includes("ela afeta a escolha DELE agora"),
  );
  ok(
    "a frase-resumo: conhece para responder, não para apresentar",
    corrido.includes("você conhece as limitações para RESPONDER, não para apresentar"),
  );
}

secao("Rodada 50 — as instruções antigas foram reescritas, não deixadas no ar");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok(
    'o "diga junto, não omita" do teto morreu',
    !JULIA_SYSTEM_PROMPT.includes("diga junto, não omita"),
  );
  ok(
    "o teto agora define omitir (esconder quando ele pergunta) e o erro oposto",
    corrido.includes("Omitir, aqui, é ele PERGUNTAR do volume e você esconder o teto") &&
      corrido.includes("Anunciar o teto junto do preço, sem pergunta, é o erro oposto"),
  );
  ok(
    'a regra de custo é escopada a "EM DISCUSSÃO"',
    corrido.includes("Sempre que estiver EM DISCUSSÃO algo que tem limite") &&
      corrido.includes('"Em discussão" = ele perguntou'),
  );
  ok(
    'o "na dúvida, fale agora" ganhou o escopo do custo real',
    corrido.includes("vale para custo que muda a conta dele, não para restrição não perguntada"),
  );
  ok(
    "a recarga de áudio mantém a regra própria, dita na regra nova",
    corrido.includes("citou os minutos inclusos, emenda a recarga; não citou, não puxe o assunto"),
  );
}

secao("Rodada 50 — o que continua obrigatório não se perdeu");
{
  const corrido = JULIA_SYSTEM_PROMPT.replace(/\n\s*/g, " ");
  ok(
    "o R$97 do profissional adicional continua inquebrável",
    JULIA_SYSTEM_PROMPT.includes('ERRADO: "O Essencial cobre o titular mais até 4 profissionais extras."') &&
      corrido.includes("sem dizer que cada um custa R$97/mês"),
  );
  ok(
    "o Básico sem adicional continua inquebrável",
    JULIA_SYSTEM_PROMPT.includes("NO BÁSICO NÃO EXISTE") &&
      corrido.includes("O Básico NÃO aceita profissional adicional — nem pagando"),
  );
  ok(
    "a recarga de áudio continua emendada quando cita minutos",
    corrido.includes("Não espere ele perguntar — emende"),
  );
  ok(
    "os limites do trial continuam ditos por inteiro",
    corrido.includes("Os limites do trial são exatamente estes três: 3 dias, 2 conversas, 15 mensagens por contato a cada 24h"),
  );
  ok(
    "e a nova regra lista essas obrigações como exceção legítima",
    corrido.includes("o Básico que não aceita adicional, os limites do trial"),
  );
}

secao("Rodada 44 — o prompt cabe no orçamento de tokens");
{
  const tokens = tamanhoEmTokens(JULIA_SYSTEM_PROMPT);
  const excesso = tokens - TETO_DE_TOKENS;
  const cresceu = ((excesso / TETO_DE_TOKENS) * 100).toFixed(1);

  ok(
    `o prompt de sistema cabe no teto (${tokens} de ${TETO_DE_TOKENS} tokens)`,
    tokens <= TETO_DE_TOKENS,
    excesso > 0
      ? [
          `O prompt passou do teto: ${tokens} tokens, ${excesso} a mais (+${cresceu}%).`,
          ``,
          `NÃO suba o TETO_DE_TOKENS como primeiro reflexo. Rode:`,
          `    node scripts/analisar-prompt.mjs`,
          ``,
          `Ele mostra qual seção engordou, quanto do prompt é exemplo de fala e`,
          `o que já está dito em outro lugar — na primeira medição havia 12`,
          `trechos repetidos só entre PLANOS e PERSUADE. Cortar o repetido custa`,
          `menos que perder capacidade de atendimento: cada 10% de prompt são`,
          `10% menos dentistas atendidos por minuto.`,
        ].join("\n        ")
      : "",
  );

  // A folga tem que ser pequena para o alarme servir de alarme. Se um dia
  // sobrar mais de 25%, é porque o teto foi afrouxado demais e parou de acusar.
  const folga = ((TETO_DE_TOKENS - tokens) / TETO_DE_TOKENS) * 100;
  ok(
    `a folga do teto continua apertada (${folga.toFixed(1)}%)`,
    folga < 25,
    `Folga de ${folga.toFixed(1)}%: o teto está frouxo demais para acusar crescimento. Baixe TETO_DE_TOKENS para perto do tamanho atual (${tokens}).`,
  );

  ok(
    "o fator de conversão está calibrado contra medição real, não chutado",
    tamanhoEmTokens("x".repeat(3850)) === 1000,
  );
}

fim();
