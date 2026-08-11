/**
 * A ficha do lead e os templates de follow-up — as partes da persona que são
 * determinísticas e, portanto, testáveis sem chamar o modelo.
 */
import { ok, secao, fim } from "./assert";
import {
  FOLLOW_UP_TEMPLATES,
  JULIA_SYSTEM_PROMPT,
  JULIA_OUTREACH_PROMPT,
  buildLeadBriefing,
  buildOutreachBriefing,
} from "../src/julia-persona";
import { detectarTratamento, saudacao } from "../src/lib/tratamento";

const ficha = (name: string | null, origin: string | null = null) =>
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
  "no MODO A ela responde a pergunta dele antes de fazer as dela",
  JULIA_SYSTEM_PROMPT.includes("RESPONDA primeiro"),
);
ok("no MODO B ela pede licença", JULIA_SYSTEM_PROMPT.includes("PEÇA LICENÇA de verdade"));
ok(
  "no MODO B ela não vende na primeira mensagem",
  JULIA_SYSTEM_PROMPT.includes("Não venda nada na primeira mensagem"),
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
  "o trial diz o limite (2 conversas, 15 mensagens)",
  JULIA_SYSTEM_PROMPT.includes("2 conversas, com até 15 mensagens"),
);
ok("o trial não pede cartão", JULIA_SYSTEM_PROMPT.includes("7 dias, SEM cartão"));
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
  "manda responder a pergunta primeiro e emendar o nome",
  JULIA_SYSTEM_PROMPT.includes("Mesmo quando ele já chega com uma pergunta, você PRECISA do nome dele"),
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

secao("Rodada 31 — ela pergunta quantos profissionais antes de recomendar");
ok(
  "a regra tem o mesmo peso da do R$97 (mesmo cabeçalho de regra inquebrável)",
  JULIA_SYSTEM_PROMPT.includes("⚠️ REGRA QUE VOCÊ NUNCA QUEBRA — PERGUNTE QUANTOS PROFISSIONAIS"),
);
ok(
  "a pergunta está escrita, pronta para usar",
  JULIA_SYSTEM_PROMPT.includes('"Quantos profissionais atendem hoje na clínica, além de você?"'),
);
ok(
  "a pergunta também entra na fase de descoberta, onde a conversa realmente passa",
  JULIA_SYSTEM_PROMPT.includes("é ela que decide se o Básico pode ou não entrar na conversa"),
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
  const regra = JULIA_SYSTEM_PROMPT.indexOf("PERGUNTE QUANTOS PROFISSIONAIS");
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
ok("mais de uma pergunta está proibido", JULIA_OUTREACH_PROMPT.includes("Mais de UMA pergunta"));

secao("Rodada 34 — o que entra, e a licença");
ok(
  "manda pedir licença de verdade, com as frases prontas",
  JULIA_OUTREACH_PROMPT.includes("Um pedido de licença de verdade") &&
    JULIA_OUTREACH_PROMPT.includes("posso te roubar um minuto?"),
);
ok(
  "manda dizer de onde viu a clínica, usando a ficha",
  JULIA_OUTREACH_PROMPT.includes("DE ONDE você viu a clínica — está na ficha do lead"),
);
ok(
  "e proíbe inventar quando a ficha não permitir citar",
  JULIA_OUTREACH_PROMPT.includes("Se a\n   ficha disser que a origem NÃO é citável, não invente"),
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
  "e ela sai na primeira negativa, sem insistir",
  JULIA_OUTREACH_PROMPT.includes("AGRADEÇA E SAIA") &&
    JULIA_OUTREACH_PROMPT.includes("SE ELE PEDIR PARA PARAR: pare na hora"),
);

secao("Rodada 34 — três exemplos de tom, com ordem de preferência e ordem de variar");
{
  const exemplos = JULIA_OUTREACH_PROMPT.split("\n").filter((l) => l.startsWith('- "Oi'));
  ok("são três exemplos", exemplos.length === 3, exemplos.join(" | "));
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
ok(
  "o mais curto e seguro é o ponto de partida",
  JULIA_OUTREACH_PROMPT.includes("o PRIMEIRO é o formato preferido") &&
    JULIA_OUTREACH_PROMPT.includes("comece por ele"),
);
ok(
  "o que elogia só vale com Instagram na ficha",
  JULIA_OUTREACH_PROMPT.includes("só quando\na ficha trouxer Instagram de verdade"),
);
ok(
  "e o terceiro é para quando não dá para dizer de onde viu",
  JULIA_OUTREACH_PROMPT.includes("quando a ficha NÃO permitir\ndizer de onde você viu a clínica"),
);
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
  fichaFria({ instagram: "@odontovida" }).includes("no Instagram da clínica (diga isso, é verdade)"),
);
ok(
  'origin "maps" continua citável',
  fichaFria({ origin: "maps" }).includes("no Google, procurando clínica na região (diga isso, é verdade)"),
);
ok(
  "e quando é citável não vem o aviso de não inventar",
  !fichaFria({ instagram: "@odontovida" }).includes("NÃO SABEMOS"),
);

fim();
