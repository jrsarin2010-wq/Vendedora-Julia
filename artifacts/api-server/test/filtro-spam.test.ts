/**
 * Rodada 22 — a Júlia para de responder banco, crédito e mensagem automática.
 */
import { ok, secao, fim } from "./assert";
import { pareceCelularReal, padraoDeServico } from "../src/lib/filtro-spam";
import {
  post,
  chamar,
  evento,
  eventoMidia,
  logs,
  temLog,
  respondeu,
  criouLead,
} from "./driver";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";

ctrl.reply = "Oi! Aqui é a Júlia 😊";

secao("pareceCelularReal");
for (const n of [
  "5585999998888", // celular novo (9 dígitos)
  "558599998888", // 8 dígitos (fixo/celular antigo)
  "5511987654321",
  "351912345678", // internacional com 12 dígitos
]) {
  ok(`aceita ${n}`, pareceCelularReal(n));
}
for (const n of [
  "4004", // número curto de banco
  "0800",
  "08007771234",
  "32004545",
  "BANCO", // remetente alfanumérico
  "NUBANK",
  "5585", // curto demais
  "558599998888123", // longo demais
  "55859999888a", // dígito + letra
  "5501999998888", // DDD 01 não existe
  "",
]) {
  ok(`rejeita ${n || "(vazio)"}`, !pareceCelularReal(n));
}

secao("padraoDeServico — pega mensagem de robô");
for (const s of [
  "Seu código de verificação é 123456",
  "Crédito pré-aprovado de R$ 20.000",
  "CRÉDITO LIBERADO! Confira agora",
  "Antecipação do saque FGTS disponível",
  "Seu limite do cartão aumentou",
  "Novo limite do seu cartão liberado",
  "Fatura de cartão disponível para pagamento",
  "A fatura do seu cartão fechou",
  "Não compartilhe esse código com ninguém",
  "Pix recebido no valor de R$ 150,00",
  "Compra aprovada no seu cartão final 1234",
  "Transação negada",
  "Boleto vencido, regularize",
  "Negocie sua dívida com desconto",
  "Consulte seu score de crédito no Serasa",
  "Esta é uma mensagem automática, não responda",
  "Para cancelar, responda SAIR",
  "Ganhe até R$ 500 de bônus",
  "Clique aqui para resgatar seu prêmio",
  "Empréstimo consignado com a menor taxa",
  "Token de acesso gerado",
]) {
  ok(`pega: "${s.slice(0, 40)}"`, padraoDeServico(s) !== null, s);
}

secao("padraoDeServico — deixa passar dentista de verdade");
for (const s of [
  "oi, quero saber o preço",
  "Bom dia! Vi vocês no Instagram, como funciona?",
  "Sou o Dr. Carlos, tenho uma clínica em Fortaleza",
  "quanto custa o plano básico?",
  "minha secretária não dá conta do WhatsApp",
  "tenho interesse no teste grátis",
  "Vocês atendem convênio?",
  // O CaptaClin TEM promoção (3 primeiros meses). Este é exatamente o lead
  // que a gente mais quer, e ele não pode ser silenciado.
  "vi a promoção exclusiva de vocês, me conta mais",
  "quero saber da promoção",
  "",
  "   ",
]) {
  ok(`deixa passar: "${s.slice(0, 40) || "(vazio)"}"`, padraoDeServico(s) === null, s);
}

secao("no webhook — tabela da Rodada 22");

await post(evento("oi, quero saber o preço"));
ok("celular real + pergunta de preço → passa", respondeu() && criouLead());

await post(evento("qualquer coisa", "4004"));
ok("4004 → ignorado pelo número", !respondeu() && !criouLead() && temLog("não parece celular"));

await post(evento("Promoção imperdível", "08007771234"));
ok("0800 → ignorado pelo número", !respondeu() && !criouLead() && temLog("não parece celular"));

await post(evento("Seu código de verificação é 123456"));
ok(
  "código de verificação → ignorado pelo conteúdo",
  !respondeu() && !criouLead() && temLog("banco/crédito/verificação"),
);

await post(evento("Crédito pré-aprovado de R$ 20.000"));
ok("crédito pré-aprovado → ignorado pelo conteúdo", !respondeu() && !criouLead());

secao("a trava: conversa já iniciada nunca é descartada por conteúdo");

await post(evento("oi, tenho uma clínica em Fortaleza"));
ok("1ª mensagem legítima cria o lead", criouLead() && respondeu());
const antes = wa.enviadas.length;
await chamar(evento("tô pagando empréstimo, tá apertado"));
ok(
  "lead em conversa falando 'empréstimo' → PASSA",
  wa.enviadas.length === antes + 1 && state.leads.length === 1,
  `enviadas=${wa.enviadas.length} leads=${state.leads.length}`,
);
ok("...e não foi logado como spam", !temLog("banco/crédito/verificação"));

secao("o robô nunca ganha a imunidade");
await post(evento("Crédito pré-aprovado de R$ 20.000", "5585911112222"));
ok("1ª mensagem do banco não cria lead", !criouLead());
await chamar(evento("Crédito liberado, confira", "5585911112222"));
ok("2ª mensagem do banco cai no mesmo filtro", !criouLead() && !respondeu());

secao("detalhes do log");
await post(evento("Seu código de verificação é 123456"));
ok("é warn, não info", logs.some((l) => l.nivel === "warn"), JSON.stringify(logs));
ok("o texto barrado NÃO vai para o log", !JSON.stringify(logs).includes("123456"));

secao("regressão — o filtro não atrapalha o que já funcionava");
await post(eventoMidia("imageMessage"));
ok("imagem de celular válido continua respondida", respondeu());
await post(eventoMidia("imageMessage", "4004"));
ok("imagem de número curto é cortada antes de tudo", !respondeu() && !criouLead());
await post(evento("oi", "5511987654321"));
ok("outro DDD válido continua passando", respondeu());

fim();
