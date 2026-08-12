/**
 * Rodada 36 — o toque 1 não sai por cima de promessa pendente da própria Júlia.
 *
 * O caso real: o dentista pediu o contrato, ela respondeu "vou pedir pra alguém
 * do time te mandar", ninguém mandou — e uma hora depois o follow-up automático
 * chegou com "a gente começou a conversar e acabou ficando pela metade". Do
 * lado dele: pediu documento, não recebeu, e ainda levou um "vamos continuar?".
 *
 * A regra que estes testes travam: se a última mensagem da conversa é NOSSA e
 * contém uma promessa, ou se o lead já está na central de vigia, o toque 1 é
 * CANCELADO (não adiado) e o lead vai para atenção — é caso de gente entregar
 * o prometido, não de robô puxar assunto.
 */
import { ok, secao, fim } from "./assert";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { linhas } from "./stubs/logger.mjs";
import { rodarCicloDeFollowUp } from "../src/lib/follow-up-scheduler";
import { pareceMensagemComPromessa } from "../src/lib/atencao";

// ── O detector, isolado ─────────────────────────────────────────────────────

secao("pareceMensagemComPromessa — os jeitos dela de prometer");
ok(
  'pega o "vou pedir pra alguém do time" da conversa real',
  pareceMensagemComPromessa("Vou pedir pra alguém do time te mandar o contrato, tá?") ===
    "vou pedir pra",
);
ok(
  'pega o "deixa eu confirmar certinho e te falo" do SE NÃO SOUBER',
  Boolean(
    pareceMensagemComPromessa(
      "Essa eu não sei te responder de cabeça — deixa eu confirmar certinho e te falo.",
    ),
  ),
);
ok("ignora acento e caixa", Boolean(pareceMensagemComPromessa("VOU TE MANDAR sim!")));
ok(
  "mensagem normal de venda não é promessa",
  pareceMensagemComPromessa(
    "O Essencial tá R$297 nos 3 primeiros meses. Quer que eu te explique como funciona?",
  ) === null,
);
ok(
  "link já entregue na própria mensagem não é promessa",
  pareceMensagemComPromessa("Tá tudo aqui: https://www.captaclin.com.br 😊") === null,
);

// ── O agendador ─────────────────────────────────────────────────────────────

const NUMERO = "5585999998888";

function armar(opts: {
  direction: "inbound" | "outbound";
  content: string;
  atencao?: string | null;
  touchNumber?: number;
}): void {
  state.reset();
  wa.reset();
  linhas.length = 0;
  state.leads.push({
    id: 1,
    phone: NUMERO,
    name: "Fernando",
    status: "warm",
    funnelStage: "interested",
    atencao: opts.atencao ?? null,
    createdAt: new Date(),
  });
  state.messages.push(
    {
      id: 10,
      leadId: 1,
      direction: "inbound",
      content: "cadê o contrato?",
      createdAt: new Date(Date.now() - 60_000),
    },
    {
      id: 11,
      leadId: 1,
      direction: opts.direction,
      content: opts.content,
      createdAt: new Date(),
    },
  );
  state.followUps.push({
    id: 900,
    leadId: 1,
    kind: "conversa",
    status: "pending",
    touchNumber: opts.touchNumber ?? 1,
    scheduledAt: new Date(Date.now() - 1000), // vencido
    messageTemplate: "toque de teste",
  });
}
const meuToque = () => state.followUps.find((f: any) => f.id === 900) as any;

secao("última mensagem é NOSSA e promete algo → o toque 1 não sai");
{
  armar({
    direction: "outbound",
    content: "Vou pedir pra alguém do time te mandar o contrato ainda hoje, tá?",
  });
  await rodarCicloDeFollowUp();
  ok("nada foi enviado", wa.enviadas.length === 0, JSON.stringify(wa.enviadas));
  ok("o toque foi CANCELADO, não adiado", meuToque().status === "cancelled", meuToque().status);
  ok(
    "o lead foi para a central de vigia",
    state.leads[0].atencao === "julia_estranha",
    String(state.leads[0].atencao),
  );
  ok(
    "com o detalhe apontando a promessa",
    Boolean(state.leads[0].atencaoDetalhe?.includes("Vou pedir")),
    String(state.leads[0].atencaoDetalhe),
  );
  ok(
    "e o motivo está no log",
    linhas.some((l: any) => l.msg.includes("Toque 1 suprimido")),
    JSON.stringify(linhas),
  );
}

secao("última mensagem é DELE → o toque 1 sai normal");
{
  armar({ direction: "inbound", content: "vou pensar" });
  await rodarCicloDeFollowUp();
  ok("o toque saiu", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
  ok("virou 'sent'", meuToque().status === "sent", meuToque().status);
  ok("sem marcação de atenção", !state.leads[0].atencao, String(state.leads[0].atencao));
}

secao("última mensagem é nossa mas NÃO promete nada → o toque 1 sai");
{
  // A rede não pode matar todo toque 1: a última mensagem QUASE SEMPRE é nossa
  // (a resposta da Júlia). Só promessa segura o toque.
  armar({ direction: "outbound", content: "Boa! Qualquer dúvida é só me chamar 😊" });
  await rodarCicloDeFollowUp();
  ok("o toque saiu", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
  ok("virou 'sent'", meuToque().status === "sent", meuToque().status);
}

secao("lead já marcado para atenção → o toque 1 não sai, e a marcação fica");
{
  armar({
    direction: "inbound",
    content: "quero falar com uma pessoa",
    atencao: "pediu_pessoa",
  });
  await rodarCicloDeFollowUp();
  ok("nada foi enviado", wa.enviadas.length === 0, JSON.stringify(wa.enviadas));
  ok("o toque foi cancelado", meuToque().status === "cancelled", meuToque().status);
  ok(
    "a marcação mais grave NÃO foi rebaixada",
    state.leads[0].atencao === "pediu_pessoa",
    String(state.leads[0].atencao),
  );
}

secao("a supressão é SÓ do toque 1 — os seguintes saem mesmo com promessa");
{
  // Se ninguém resolveu a pendência em 24h, silêncio eterno seria pior que o
  // toque: o lead esfria de vez e a promessa morre junto.
  armar({
    direction: "outbound",
    content: "Vou pedir pra alguém do time te mandar o contrato ainda hoje, tá?",
    touchNumber: 2,
  });
  await rodarCicloDeFollowUp();
  ok("o toque 2 saiu", wa.enviadas.length === 1, JSON.stringify(wa.enviadas));
  ok("virou 'sent'", meuToque().status === "sent", meuToque().status);
}

fim();
