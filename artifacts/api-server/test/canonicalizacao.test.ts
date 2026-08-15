/**
 * Etapa 1.5 — a forma canônica do telefone é a que o WhatsApp reconhece.
 *
 * O bug que isto fecha: a planilha traz 13 dígitos, o webhook grava os 12 do
 * jid, e a checagem de duplicado compara duas strings diferentes do MESMO
 * dentista. Ninguém vê erro nenhum — a Júlia só aborda de novo quem já é lead.
 */
import { ok, secao, fim } from "./assert";
import { handlerDe, chamarRota, type RespostaFake } from "./rota";
import canonicalizarRouter from "../src/routes/leads-canonicalizar";
import importRouter from "../src/routes/leads-import";
import {
  canonicalizarTelefones,
  planejarCanonicalizacao,
  numeroDoJid,
  MAXIMO_POR_BLOCO,
} from "../src/lib/canonicalizar-telefone";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";

const handlerCanonicalizar = handlerDe(canonicalizarRouter);
const handlerImport = handlerDe(importRouter);

/** O que a Evolution faz de verdade com conta antiga: some com o nono dígito. */
const semNono = (n: string) => (n.length === 13 ? n.slice(0, 4) + n.slice(5) : n);

/** Resposta "tudo existe", com o jid na forma canônica de conta antiga. */
const respostaCanonica = (bloco: string[]) => ({
  ok: true,
  itens: bloco.map((n) => ({
    number: n,
    exists: true,
    jid: `${semNono(n)}@s.whatsapp.net`,
    name: n,
  })),
});

function limpar() {
  state.reset();
  wa.reset();
  wa.numeros.responder = null;
}

function jaNoBanco(id: number, phone: string, status = "warm") {
  state.leads.push({ id, phone, status, origin: "whatsapp" });
  if (id >= state.nextId) state.nextId = id + 1;
}

const corpo = (r: RespostaFake) => r.body as any;

secao("numeroDoJid — só os dígitos antes do @, e nada de lixo");
ok("tira o sufixo do servidor", numeroDoJid("558592008899@s.whatsapp.net") === "558592008899");
ok(
  "ignora sufixo de dispositivo",
  numeroDoJid("558592008899:12@s.whatsapp.net") === "558592008899",
);
ok("jid ausente vira null", numeroDoJid(undefined) === null);
ok("jid de grupo não vira telefone", numeroDoJid("120363042@g.us") === null);
ok("string vazia vira null", numeroDoJid("") === null);

secao("exists: true — vale a forma do jid, NUNCA a que enviamos");
limpar();
wa.numeros.responder = respostaCanonica;
let mapa = await canonicalizarTelefones(["5585992008899"]);
ok("existe = true", mapa.get("5585992008899")?.existe === true);
ok(
  "canônico é o do jid (12 dígitos, sem o nono)",
  mapa.get("5585992008899")?.canonico === "558592008899",
  JSON.stringify(mapa.get("5585992008899")),
);

secao("exists: false — jid especulativo NÃO pode ser lido");
limpar();
// A resposta real traz jid mesmo para número inexistente. Ler esse jid gravaria
// identidade de uma conta que não existe.
wa.numeros.responder = () => ({
  ok: true,
  itens: [
    { number: "5585987341256", exists: false, jid: "558587341256@s.whatsapp.net" },
  ],
});
mapa = await canonicalizarTelefones(["5585987341256"]);
ok("existe = false", mapa.get("5585987341256")?.existe === false);
ok(
  "canônico continua nulo apesar de a resposta trazer jid",
  mapa.get("5585987341256")?.canonico === null,
  JSON.stringify(mapa.get("5585987341256")),
);

secao("casa pelo `number`, não pela posição — fora de ordem e com item faltando");
limpar();
wa.numeros.responder = (bloco: string[]) => ({
  ok: true,
  // Invertida de propósito, e sem o terceiro número.
  itens: [
    { number: bloco[1], exists: false, jid: `${semNono(bloco[1])}@s.whatsapp.net` },
    { number: bloco[0], exists: true, jid: `${semNono(bloco[0])}@s.whatsapp.net` },
  ],
});
mapa = await canonicalizarTelefones(["5585911112222", "5585933334444", "5585955556666"]);
ok(
  "o primeiro pegou o veredito DELE, não o da primeira linha da resposta",
  mapa.get("5585911112222")?.existe === true &&
    mapa.get("5585911112222")?.canonico === "558511112222",
  JSON.stringify(mapa.get("5585911112222")),
);
ok("o segundo veio false", mapa.get("5585933334444")?.existe === false);
ok(
  "o que faltou na resposta fica INDETERMINADO, não false",
  mapa.get("5585955556666")?.existe === null &&
    mapa.get("5585955556666")?.canonico === null,
  JSON.stringify(mapa.get("5585955556666")),
);

secao("falha de rede/HTTP — tudo indeterminado, nunca 'não existe'");
limpar();
wa.numeros.responder = () => ({ ok: false, itens: [] });
mapa = await canonicalizarTelefones(["5585911112222", "5585933334444"]);
ok(
  "os dois ficam null/null",
  [...mapa.values()].every((v) => v.existe === null && v.canonico === null),
  JSON.stringify([...mapa.entries()]),
);
ok("todo número enviado está no mapa (nenhum some em silêncio)", mapa.size === 2);

secao("exists: true com jid ilegível não vira veredito");
limpar();
wa.numeros.responder = () => ({
  ok: true,
  itens: [{ number: "5585911112222", exists: true, jid: "120363042@g.us" }],
});
mapa = await canonicalizarTelefones(["5585911112222"]);
ok(
  "sem forma canônica utilizável → indeterminado",
  mapa.get("5585911112222")?.existe === null,
  JSON.stringify(mapa.get("5585911112222")),
);

secao(`lote grande é fatiado em blocos de ${MAXIMO_POR_BLOCO}`);
limpar();
wa.numeros.responder = respostaCanonica;
const muitos = Array.from({ length: 120 }, (_, i) => `55859${String(i).padStart(8, "0")}`);
mapa = await canonicalizarTelefones(muitos);
ok(
  "3 blocos: 50 + 50 + 20",
  JSON.stringify(wa.numeros.blocos.map((b: string[]) => b.length)) === "[50,50,20]",
  JSON.stringify(wa.numeros.blocos.map((b: string[]) => b.length)),
);
ok("todos os 120 têm veredito", mapa.size === 120);
limpar();
wa.numeros.responder = respostaCanonica;
await canonicalizarTelefones(["5585911112222", "5585911112222", "5585911112222"]);
ok(
  "número repetido é consultado UMA vez só",
  wa.numeros.blocos.length === 1 && wa.numeros.blocos[0].length === 1,
  JSON.stringify(wa.numeros.blocos),
);

secao("planejarCanonicalizacao — a colisão é achado, não conserto automático");
{
  const leads = [
    { id: 1, phone: "5585992008899" }, // 13 dígitos, canonicaliza para o do lead 2
    { id: 2, phone: "558592008899" }, // já canônico
  ];
  const plano = planejarCanonicalizacao(
    leads,
    new Map([
      ["5585992008899", { canonico: "558592008899", existe: true as boolean | null }],
      ["558592008899", { canonico: "558592008899", existe: true as boolean | null }],
    ]),
  );
  ok("nada a atualizar", plano.aAtualizar.length === 0, JSON.stringify(plano.aAtualizar));
  ok("1 colisão registrada", plano.colisoes.length === 1, JSON.stringify(plano.colisoes));
  ok(
    "a colisão aponta o lead conflitante",
    plano.colisoes[0].leadId === 1 && plano.colisoes[0].leadIdConflitante === 2,
    JSON.stringify(plano.colisoes[0]),
  );
  ok("o que já era canônico conta como jaCanonico", plano.jaCanonico === 1);
}
{
  // Dois leads que canonicalizam para o MESMO alvo, sem que nenhum o ocupe.
  const plano = planejarCanonicalizacao(
    [
      { id: 10, phone: "5585999998888" },
      { id: 11, phone: "5585999998887" },
    ],
    new Map([
      ["5585999998888", { canonico: "558599998888", existe: true as boolean | null }],
      ["5585999998887", { canonico: "558599998888", existe: true as boolean | null }],
    ]),
  );
  ok("só o primeiro é atualizado", plano.aAtualizar.length === 1 && plano.aAtualizar[0].leadId === 10);
  ok("o segundo vira colisão", plano.colisoes.length === 1 && plano.colisoes[0].leadId === 11);
}

secao("rota — dry-run é o padrão e NÃO escreve nada");
limpar();
wa.numeros.responder = respostaCanonica;
jaNoBanco(1, "5585999998888");
jaNoBanco(2, "558577776666"); // já canônico
let r = await chamarRota(handlerCanonicalizar, {});
ok("status 200", r.status === 200, JSON.stringify(r.body));
ok("modo dry-run por padrão", corpo(r).modo === "dry-run");
ok("total = 2", corpo(r).total === 2, JSON.stringify(r.body));
ok("1 a atualizar", corpo(r).aAtualizar.length === 1, JSON.stringify(corpo(r).aAtualizar));
ok(
  "diz de onde para onde",
  corpo(r).aAtualizar[0].de === "5585999998888" &&
    corpo(r).aAtualizar[0].para === "558599998888",
  JSON.stringify(corpo(r).aAtualizar[0]),
);
ok("1 já canônico", corpo(r).jaCanonico === 1);
ok("aplicadas = 0", corpo(r).aplicadas === 0);
ok(
  "NENHUM telefone foi alterado no banco",
  state.leads.find((l: any) => l.id === 1).phone === "5585999998888",
  JSON.stringify(state.leads),
);

secao("rota — modo aplicar troca só o que estava em aAtualizar");
r = await chamarRota(handlerCanonicalizar, { body: { modo: "aplicar" } });
ok("status 200", r.status === 200, JSON.stringify(r.body));
ok("1 aplicada", corpo(r).aplicadas === 1, JSON.stringify(r.body));
ok(
  "o lead 1 agora está na forma canônica",
  state.leads.find((l: any) => l.id === 1).phone === "558599998888",
  JSON.stringify(state.leads),
);
ok(
  "o lead que já era canônico não foi tocado",
  state.leads.find((l: any) => l.id === 2).phone === "558577776666",
);
ok("nenhuma falha", (corpo(r).falhas ?? []).length === 0, JSON.stringify(corpo(r).falhas));

secao("rota — colisão não funde os dois leads, nem no modo aplicar");
limpar();
wa.numeros.responder = respostaCanonica;
jaNoBanco(1, "5585992008899", "warm"); // vira 558592008899
jaNoBanco(2, "558592008899", "lost"); // já ocupa o alvo, e pediu para parar
r = await chamarRota(handlerCanonicalizar, { body: { modo: "aplicar" } });
ok("status 200 — colisão não lança exceção", r.status === 200, JSON.stringify(r.body));
ok("nada aplicado", corpo(r).aplicadas === 0, JSON.stringify(r.body));
ok("1 colisão relatada", corpo(r).colisoes.length === 1, JSON.stringify(corpo(r).colisoes));
ok("os DOIS leads continuam existindo (nada foi fundido)", state.leads.length === 2);
ok(
  "o telefone do lead 1 não mudou",
  state.leads.find((l: any) => l.id === 1).phone === "5585992008899",
);
ok(
  "o opt-out do lead 2 continua de pé",
  state.leads.find((l: any) => l.id === 2).status === "lost",
);

secao("rota — sem WhatsApp e indeterminado não viram escrita");
limpar();
wa.numeros.responder = (bloco: string[]) => ({
  ok: true,
  itens: [{ number: bloco[0], exists: false, jid: `${semNono(bloco[0])}@s.whatsapp.net` }],
});
jaNoBanco(1, "5585999998888"); // responde exists:false
jaNoBanco(2, "5585977776666"); // some da resposta → indeterminado
r = await chamarRota(handlerCanonicalizar, { body: { modo: "aplicar" } });
ok("1 sem WhatsApp", corpo(r).semWhatsapp.length === 1, JSON.stringify(r.body));
ok("1 indeterminado", corpo(r).indeterminado.length === 1, JSON.stringify(r.body));
ok("nada aplicado", corpo(r).aplicadas === 0);
ok(
  "os dois telefones seguem intactos",
  state.leads.find((l: any) => l.id === 1).phone === "5585999998888" &&
    state.leads.find((l: any) => l.id === 2).phone === "5585977776666",
);

secao("rota — modo inválido é recusado antes de qualquer consulta");
limpar();
wa.numeros.responder = respostaCanonica;
r = await chamarRota(handlerCanonicalizar, { body: { modo: "apagar-tudo" } });
ok("status 400", r.status === 400, JSON.stringify(r.body));
ok("não consultou a Evolution", wa.numeros.blocos.length === 0);

secao("importação — grava a forma canônica, não a da planilha");
limpar();
wa.numeros.responder = respostaCanonica;
r = await chamarRota(handlerImport, { body: { leads: [{ phone: "85999998888", name: "Carlos" }] } });
ok("1 importado", corpo(r).importados === 1, JSON.stringify(r.body));
ok(
  "gravou os 12 dígitos do jid",
  state.leads[0].phone === "558599998888",
  JSON.stringify(state.leads[0]),
);

secao("importação — O BUG QUE ISTO FECHA: duplicado que passava batido");
limpar();
wa.numeros.responder = respostaCanonica;
// O lead já existe na forma que o webhook grava (12 dígitos).
jaNoBanco(1, "558599998888", "warm");
// A planilha traz o MESMO dentista na forma de 13 dígitos.
r = await chamarRota(handlerImport, { body: { leads: [{ phone: "85999998888", name: "Carlos" }] } });
ok("reconhecido como duplicado", corpo(r).duplicados === 1, JSON.stringify(r.body));
ok("NÃO foi importado de novo", corpo(r).importados === 0, JSON.stringify(r.body));
ok("continua um único lead no banco", state.leads.length === 1);

secao("importação — as duas formas na MESMA planilha viram um lead só");
limpar();
wa.numeros.responder = respostaCanonica;
r = await chamarRota(handlerImport, {
  body: { leads: [{ phone: "5585999998888" }, { phone: "558599998888" }] },
});
ok("1 importado", corpo(r).importados === 1, JSON.stringify(r.body));
ok("1 duplicado", corpo(r).duplicados === 1, JSON.stringify(r.body));
ok("um lead só no banco", state.leads.length === 1 && state.leads[0].phone === "558599998888");

secao("importação — opt-out continua valendo na forma canônica");
limpar();
wa.numeros.responder = respostaCanonica;
jaNoBanco(1, "558599998888", "lost");
r = await chamarRota(handlerImport, { body: { leads: [{ phone: "85999998888" }] } });
ok(
  "conta como opt-out, não como importado",
  corpo(r).ignoradosPorOptOut === 1 && corpo(r).importados === 0,
  JSON.stringify(r.body),
);
ok("nenhum lead novo", state.leads.length === 1);

secao("importação — sem WhatsApp não vira lead");
limpar();
wa.numeros.responder = (bloco: string[]) => ({
  ok: true,
  itens: bloco.map((n) => ({ number: n, exists: false, jid: `${semNono(n)}@s.whatsapp.net` })),
});
r = await chamarRota(handlerImport, { body: { leads: [{ phone: "85999998888" }] } });
ok("contado em semWhatsapp", corpo(r).semWhatsapp === 1, JSON.stringify(r.body));
ok("não importado", corpo(r).importados === 0);
ok("banco vazio", state.leads.length === 0);

secao("importação — Evolution fora do ar NÃO descarta o lead");
limpar();
wa.numeros.responder = () => ({ ok: false, itens: [] });
r = await chamarRota(handlerImport, { body: { leads: [{ phone: "85999998888" }] } });
ok("contado para reprocessar", corpo(r).reprocessarDepois === 1, JSON.stringify(r.body));
ok(
  "NÃO foi contado como sem WhatsApp (falha de rede não é veredito)",
  corpo(r).semWhatsapp === 0,
  JSON.stringify(r.body),
);
ok("não importado agora", corpo(r).importados === 0);
ok(
  "devolve o número para a segunda tentativa",
  JSON.stringify(corpo(r).paraReprocessar) === JSON.stringify(["5585999998888"]),
  JSON.stringify(corpo(r).paraReprocessar),
);
ok("banco vazio", state.leads.length === 0);

secao("importação — telefone inválido nem chega a ser consultado");
limpar();
wa.numeros.responder = respostaCanonica;
r = await chamarRota(handlerImport, { body: { leads: [{ phone: "4004" }, { phone: "0800" }] } });
ok("2 inválidos", corpo(r).invalidos === 2, JSON.stringify(r.body));
ok("nenhuma consulta à Evolution", wa.numeros.blocos.length === 0);

secao("importação — uma chamada em lote para a planilha inteira");
limpar();
wa.numeros.responder = respostaCanonica;
r = await chamarRota(handlerImport, {
  body: { leads: [{ phone: "85911112222" }, { phone: "85933334444" }, { phone: "85955556666" }] },
});
ok("3 importados", corpo(r).importados === 3, JSON.stringify(r.body));
ok(
  "UMA chamada, com os três números",
  wa.numeros.blocos.length === 1 && wa.numeros.blocos[0].length === 3,
  JSON.stringify(wa.numeros.blocos),
);

fim();
