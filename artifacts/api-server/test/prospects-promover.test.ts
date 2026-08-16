/**
 * Etapa 3C — promoção de clínica captada a dentista abordável.
 *
 * É a fronteira do sistema: do outro lado dela tem dentista de verdade
 * recebendo a primeira mensagem da Júlia. O que este arquivo protege, em ordem
 * de gravidade se quebrar:
 *
 *   1. O `instagram` NUNCA copiado. Com ele preenchido, a Júlia diz "vi no
 *      Instagram da clínica" mesmo com origin "maps" — passa a MENTIR sobre a
 *      origem do contato, sem sintoma nenhum, porque a frase continua bem
 *      escrita. O teste enche a coluna no fixture de propósito.
 *   2. O opt-out. Quem pediu para parar não pode voltar à fila porque a
 *      varredura recapturou a clínica dele.
 *   3. O `outreachStatus: "pending"`. É o campo que faz o lead ser abordado; o
 *      default da coluna é 'none' e o agendador só olha 'pending'.
 *   4. O indeterminado. "Não sei" da Evolution não pode virar "não tem".
 */
import { ok, secao, fim } from "./assert";
import { handlerDe, chamarRota, type RespostaFake } from "./rota";
import promoverRouter from "../src/routes/prospects-promover";
import prospectsRouter from "../src/routes/prospects";
import importRouter from "../src/routes/leads-import";
import roteadorPrincipal from "../src/routes/index";
import { requireAuth } from "../src/lib/auth";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { abordagemNoPainel } from "./painel";

const promover = handlerDe(promoverRouter);
const resumoHandler = handlerDe(prospectsRouter, 0);
const importarHandler = handlerDe(importRouter);

interface Resposta {
  solicitados: number;
  modo: string;
  promovidos: { prospectId: number; nome: string; leadId: number | null }[];
  jaExistentes: {
    prospectId: number;
    nome: string;
    leadId: number | null;
    motivo: string;
  }[];
  semWhatsapp: { prospectId: number; nome: string }[];
  adiados: { prospectId: number; nome: string }[];
  recusados: { prospectId: number; motivo: string }[];
}

/**
 * Uma clínica como a Etapa 3A a deixa: `apto` COM `telefone_whatsapp`
 * preenchido (a forma do jid). Os dois andam juntos — `apto` sem telefone
 * canônico é registro que se contradiz, e o teste do fim cobre esse caso.
 */
function clinica(campos: Record<string, unknown> = {}) {
  const id = state.nextId++;
  const linha = {
    id,
    placeId: `place-${id}`,
    nome: `Clínica ${id}`,
    telefoneRaw: "(85) 99999-8888",
    telefoneWhatsapp: "5585999998888",
    temWhatsapp: true,
    instagram: null,
    cidade: "Fortaleza",
    uf: "CE",
    leadId: null,
    statusProspeccao: "apto",
    atualizadoEm: new Date("2026-01-01T00:00:00Z"),
    ...campos,
  };
  state.clinicas.push(linha);
  return linha;
}

/** Um lead já na base, como se tivesse vindo do WhatsApp. */
function lead(phone: string, status: string) {
  const linha = { id: state.nextId++, phone, status, origin: "whatsapp" };
  state.leads.push(linha);
  return linha;
}

const prospectDe = (id: number) =>
  state.clinicas.find((c: { id: number }) => c.id === id);

async function chamar(prospectIds: unknown, modo = "aplicar"): Promise<RespostaFake> {
  return chamarRota(promover, { body: { prospectIds, modo } });
}

const corpo = (r: RespostaFake) => r.body as Resposta;

function limpar() {
  state.reset();
  wa.reset();
  wa.numeros.responder = null;
}

// ---------------------------------------------------------------------------
secao("caminho feliz — a clínica vira dentista pendente de abordagem");
limpar();
const a = clinica({ nome: "Odonto Vida", telefoneWhatsapp: "5585911112222" });
let r = await chamar([a.id]);
ok("status 200", r.status === 200, JSON.stringify(r.body));
ok("1 promovido", corpo(r).promovidos.length === 1, JSON.stringify(r.body));
ok("com o nome da clínica no retorno", corpo(r).promovidos[0].nome === "Odonto Vida");
ok("1 lead criado", state.leads.length === 1, JSON.stringify(state.leads));

let novo = state.leads[0];
ok("o retorno aponta para o lead criado", corpo(r).promovidos[0].leadId === novo.id, JSON.stringify(r.body));
ok("origin = maps", novo.origin === "maps", JSON.stringify(novo));
ok("outreachStatus = pending", novo.outreachStatus === "pending", JSON.stringify(novo));
ok("status = cold", novo.status === "cold");
ok("funnelStage = new", novo.funnelStage === "new");
ok("clinicName veio do nome da clínica", novo.clinicName === "Odonto Vida");
ok("city veio da cidade", novo.city === "Fortaleza");
ok("o telefone é a forma canônica", novo.phone === "5585911112222", String(novo.phone));
ok(
  "name é NULO — não sabemos o nome do dentista, e inventar seria a pior abertura",
  novo.name === null,
  JSON.stringify(novo),
);
ok("nenhuma mensagem saiu", wa.enviadas.length === 0, JSON.stringify(wa.enviadas));

ok("o prospect virou promovido", prospectDe(a.id).statusProspeccao === "promovido");
ok("com o lead_id gravado", prospectDe(a.id).leadId === novo.id, JSON.stringify(prospectDe(a.id)));

// ---------------------------------------------------------------------------
secao("o campo instagram NUNCA é copiado — nem com a coluna cheia");
// Hoje `clinicas_prospect.instagram` é sempre nulo, então isto não acontece na
// prática. O teste existe para o dia em que alguém captar Instagram na
// varredura: sem esta regra, a Júlia passaria a dizer "vi no Instagram da
// clínica" com origin "maps" — mentira nova, sem ninguém pedir.
limpar();
const comInsta = clinica({ nome: "Sorriso Real", instagram: "@sorrisoreal" });
await chamar([comInsta.id]);
novo = state.leads[0];
ok("a coluna do prospect ESTAVA preenchida", prospectDe(comInsta.id).instagram === "@sorrisoreal");
ok("e mesmo assim o lead nasceu sem instagram", novo.instagram === null, JSON.stringify(novo));
ok("o origin continua maps", novo.origin === "maps");

// ---------------------------------------------------------------------------
secao("duplicado — o dentista já é lead");
limpar();
const jaLead = lead("5585933334444", "warm");
const b = clinica({ nome: "Dental Norte", telefoneWhatsapp: "5585933334444" });
r = await chamar([b.id]);
ok("nada promovido", corpo(r).promovidos.length === 0, JSON.stringify(r.body));
ok("1 jaExistente", corpo(r).jaExistentes.length === 1, JSON.stringify(r.body));
ok("com motivo duplicado", corpo(r).jaExistentes[0].motivo === "duplicado");
ok("apontando para o lead que já existia", corpo(r).jaExistentes[0].leadId === jaLead.id);
ok("nenhum lead novo", state.leads.length === 1, JSON.stringify(state.leads));
ok("o prospect virou ja_existente", prospectDe(b.id).statusProspeccao === "ja_existente");
ok("com o lead_id do existente", prospectDe(b.id).leadId === jaLead.id);
ok("o lead antigo NÃO foi reaberto para abordagem", jaLead.outreachStatus === undefined, JSON.stringify(jaLead));

// ---------------------------------------------------------------------------
secao("opt-out é DEFINITIVO — nunca promovido, nunca reabordado");
limpar();
const perdido = lead("5585955556666", "lost");
const c = clinica({ nome: "Clínica do Perdido", telefoneWhatsapp: "5585955556666" });
r = await chamar([c.id]);
ok("nada promovido", corpo(r).promovidos.length === 0, JSON.stringify(r.body));
ok("1 jaExistente", corpo(r).jaExistentes.length === 1, JSON.stringify(r.body));
ok("com motivo opt-out, e não 'duplicado'", corpo(r).jaExistentes[0].motivo === "opt-out", JSON.stringify(r.body));
ok("nenhum lead novo", state.leads.length === 1);
ok("o lead continua lost", perdido.status === "lost");
ok("e NÃO ganhou outreachStatus pending", perdido.outreachStatus === undefined, JSON.stringify(perdido));
ok("o prospect virou ja_existente", prospectDe(c.id).statusProspeccao === "ja_existente");
ok("insistir não muda nada", true);
r = await chamar([c.id]);
ok("...na segunda tentativa é recusado (já não é mais apto)", r.status === 409, JSON.stringify(r.body));
ok("e continua sem lead novo", state.leads.length === 1);

// ---------------------------------------------------------------------------
secao("o número morreu entre a 3A e a promoção");
limpar();
const d = clinica({ nome: "Fantasma Odonto" });
wa.numeros.responder = (numeros: string[]) => ({
  ok: true,
  itens: numeros.map((n) => ({ number: n, exists: false, jid: `${n}@s.whatsapp.net` })),
});
r = await chamar([d.id]);
ok("nada promovido", corpo(r).promovidos.length === 0, JSON.stringify(r.body));
ok("1 semWhatsapp", corpo(r).semWhatsapp.length === 1, JSON.stringify(r.body));
ok("nenhum lead criado", state.leads.length === 0);
ok("o prospect virou sem_whatsapp", prospectDe(d.id).statusProspeccao === "sem_whatsapp");
ok("sem lead_id", prospectDe(d.id).leadId === null);

// ---------------------------------------------------------------------------
secao("Evolution muda — ADIA, não descarta");
limpar();
const e = clinica({ nome: "Odonto Silêncio" });
wa.numeros.responder = () => ({ ok: false, itens: [] });
r = await chamar([e.id]);
ok("nada promovido", corpo(r).promovidos.length === 0, JSON.stringify(r.body));
ok("1 adiado", corpo(r).adiados.length === 1, JSON.stringify(r.body));
ok("nada em semWhatsapp — 'não sei' não é 'não tem'", corpo(r).semWhatsapp.length === 0, JSON.stringify(r.body));
ok("nenhum lead criado", state.leads.length === 0);
ok("o prospect CONTINUA apto", prospectDe(e.id).statusProspeccao === "apto", JSON.stringify(prospectDe(e.id)));
ok("e nada foi gravado nele", prospectDe(e.id).leadId === null);
ok(
  "nem o atualizadoEm foi tocado",
  prospectDe(e.id).atualizadoEm.getTime() === new Date("2026-01-01T00:00:00Z").getTime(),
  String(prospectDe(e.id).atualizadoEm),
);

// ---------------------------------------------------------------------------
secao("uma leva mista — cada clínica no seu destino, numa chamada só");
limpar();
lead("5585900000002", "hot");
lead("5585900000003", "lost");
const m1 = clinica({ nome: "Nova", telefoneWhatsapp: "5585900000001" });
const m2 = clinica({ nome: "Já é lead", telefoneWhatsapp: "5585900000002" });
const m3 = clinica({ nome: "Pediu para parar", telefoneWhatsapp: "5585900000003" });
const m4 = clinica({ nome: "Número morto", telefoneWhatsapp: "5585900000004" });
wa.numeros.responder = (numeros: string[]) => ({
  ok: true,
  itens: numeros.map((n) => ({
    number: n,
    exists: n !== "5585900000004",
    jid: `${n}@s.whatsapp.net`,
  })),
});
r = await chamar([m1.id, m2.id, m3.id, m4.id]);
ok("4 solicitados", corpo(r).solicitados === 4);
ok("1 promovido", corpo(r).promovidos.length === 1, JSON.stringify(r.body));
ok("é a Nova", corpo(r).promovidos[0].nome === "Nova");
ok("2 jaExistentes", corpo(r).jaExistentes.length === 2, JSON.stringify(r.body));
ok(
  "com os dois motivos distintos",
  corpo(r).jaExistentes.map((j) => j.motivo).sort().join() === "duplicado,opt-out",
  JSON.stringify(corpo(r).jaExistentes),
);
ok("1 semWhatsapp", corpo(r).semWhatsapp.length === 1, JSON.stringify(r.body));
ok("nenhum adiado", corpo(r).adiados.length === 0);
ok("só 1 lead novo (3 na base)", state.leads.length === 3, JSON.stringify(state.leads));
ok("os quatro prospects foram marcados", [m1, m2, m3, m4].every((p) => prospectDe(p.id).statusProspeccao !== "apto"));
ok(
  "uma consulta em lote à Evolution, não uma por clínica",
  wa.numeros.blocos.length === 1,
  JSON.stringify(wa.numeros.blocos),
);

// ---------------------------------------------------------------------------
secao("duas clínicas com o MESMO telefone na mesma leva");
// Acontece: matriz e filial cadastradas separadamente no Maps com o mesmo
// número. A segunda não pode virar um "já é lead" sem dizer QUAL lead.
limpar();
const g1 = clinica({ nome: "Matriz", telefoneWhatsapp: "5585922221111" });
const g2 = clinica({ nome: "Filial", telefoneWhatsapp: "5585922221111" });
r = await chamar([g1.id, g2.id]);
ok("1 promovido só", corpo(r).promovidos.length === 1, JSON.stringify(r.body));
ok("1 jaExistente", corpo(r).jaExistentes.length === 1, JSON.stringify(r.body));
ok("um lead só foi criado", state.leads.length === 1);
ok(
  "e o duplicado aponta para ele, em vez de ficar sem dono",
  corpo(r).jaExistentes[0].leadId === state.leads[0].id,
  JSON.stringify(corpo(r).jaExistentes),
);
ok("o segundo prospect também guardou o lead_id", prospectDe(g2.id).leadId === state.leads[0].id);

// ---------------------------------------------------------------------------
secao("modo simular — decide tudo e não escreve NADA");
limpar();
lead("5585944442222", "warm");
const s1 = clinica({ nome: "Simulada", telefoneWhatsapp: "5585944441111" });
const s2 = clinica({ nome: "Simulada dupla", telefoneWhatsapp: "5585944442222" });
r = await chamar([s1.id, s2.id], "simular");
ok("status 200", r.status === 200, JSON.stringify(r.body));
ok("o modo volta na resposta", corpo(r).modo === "simular");
ok("diz que 1 seria promovida", corpo(r).promovidos.length === 1, JSON.stringify(r.body));
ok("e que 1 já é lead", corpo(r).jaExistentes.length === 1, JSON.stringify(r.body));
ok("leadId do promovido é nulo — nenhuma linha foi criada", corpo(r).promovidos[0].leadId === null);
ok("nenhum lead novo na base", state.leads.length === 1, JSON.stringify(state.leads));
ok("os dois prospects continuam apto", [s1, s2].every((p) => prospectDe(p.id).statusProspeccao === "apto"));
ok("e nenhum ganhou lead_id", [s1, s2].every((p) => prospectDe(p.id).leadId === null));

secao("simular e aplicar contam a mesma história");
r = await chamar([s1.id, s2.id], "aplicar");
ok("agora 1 promovido de verdade", corpo(r).promovidos.length === 1, JSON.stringify(r.body));
ok("com leadId preenchido", typeof corpo(r).promovidos[0].leadId === "number");
ok("1 jaExistente, como na simulação", corpo(r).jaExistentes.length === 1);
ok("agora sim o lead foi criado", state.leads.length === 2);

// ---------------------------------------------------------------------------
secao("status diferente de apto — recusa a lista INTEIRA, sem processar nada");
limpar();
const bom = clinica({ nome: "Boa", telefoneWhatsapp: "5585966661111" });
const cru = clinica({ nome: "Ainda não verificada", statusProspeccao: "novo", telefoneWhatsapp: null });
r = await chamar([bom.id, cru.id]);
ok("409", r.status === 409, JSON.stringify(r.body));
ok("1 recusado", corpo(r).recusados.length === 1, JSON.stringify(r.body));
ok("com o status no motivo", corpo(r).recusados[0].motivo === "status_prospeccao=novo", JSON.stringify(r.body));
ok("nenhum lead criado", state.leads.length === 0);
ok("nem a clínica BOA foi promovida", prospectDe(bom.id).statusProspeccao === "apto", JSON.stringify(prospectDe(bom.id)));
ok("nada foi perguntado à Evolution", wa.numeros.blocos.length === 0, JSON.stringify(wa.numeros.blocos));

secao("id que não existe também recusa a lista");
limpar();
const unico = clinica();
r = await chamar([unico.id, 99999]);
ok("409", r.status === 409, JSON.stringify(r.body));
ok("motivo 'não encontrado'", corpo(r).recusados[0].motivo === "não encontrado", JSON.stringify(r.body));
ok("nenhum lead criado", state.leads.length === 0);

secao("apto sem telefone canônico é bug nosso, e tem que ser barulhento");
// Quem marca `apto` é a Etapa 3A, que grava `status` e `telefone_whatsapp` na
// MESMA linha. Um apto sem telefone utilizável não pode virar "adiado" e ficar
// preso para sempre numa lista que ninguém revisa.
limpar();
const quebrada = clinica({ nome: "Contraditória", telefoneWhatsapp: null });
r = await chamar([quebrada.id]);
ok("409", r.status === 409, JSON.stringify(r.body));
ok(
  "com o motivo apontando o telefone",
  corpo(r).recusados[0].motivo.includes("telefone_whatsapp"),
  JSON.stringify(r.body),
);
limpar();
const lixo = clinica({ nome: "Telefone lixo", telefoneWhatsapp: "0800" });
r = await chamar([lixo.id]);
ok("telefone que a normalização recusa também é 409", r.status === 409, JSON.stringify(r.body));

// ---------------------------------------------------------------------------
secao("o corpo da requisição");
limpar();
clinica();
ok("sem prospectIds → 400", (await chamarRota(promover, { body: { modo: "aplicar" } })).status === 400);
ok("lista vazia → 400", (await chamar([])).status === 400);
ok("não é lista → 400", (await chamar("1,2")).status === 400);
ok("id não inteiro → 400", (await chamar([1.5])).status === 400);
ok("id como string → 400", (await chamar(["1"])).status === 400);
ok("sem modo → 400", (await chamarRota(promover, { body: { prospectIds: [1] } })).status === 400);
ok("modo inventado → 400", (await chamar([1], "aplicar_de_verdade")).status === 400);
ok("corpo vazio → 400", (await chamarRota(promover, { body: {} })).status === 400);
ok("nada foi criado por nenhuma delas", state.leads.length === 0, JSON.stringify(state.leads));

secao("mais de 50 → recusa a requisição inteira");
limpar();
const muitos = Array.from({ length: 51 }, () => clinica().id);
r = await chamar(muitos);
ok("413", r.status === 413, JSON.stringify(r.body));
ok("nenhum lead criado", state.leads.length === 0);
ok("nenhum prospect tocado", state.clinicas.every((c: { statusProspeccao: string }) => c.statusProspeccao === "apto"));
r = await chamar(muitos.slice(0, 50));
ok("exatamente 50 passa", r.status === 200, JSON.stringify(r.body));

secao("id repetido no corpo conta uma vez só");
limpar();
const rep = clinica();
r = await chamar([rep.id, rep.id, rep.id]);
ok("1 solicitado", corpo(r).solicitados === 1, JSON.stringify(r.body));
ok("1 promovido", corpo(r).promovidos.length === 1);
ok("1 lead", state.leads.length === 1);

// ---------------------------------------------------------------------------
secao("/api/prospects/resumo expõe o estado da Júlia — as DUAS camadas (Etapa 4)");
limpar();
clinica();
abordagemNoPainel(true);
delete process.env.OUTREACH_ENABLED;
let resumo = (await chamarRota(resumoHandler, {})).body as { juliaLigada: boolean };
ok("desligada quando a variável não existe", resumo.juliaLigada === false, JSON.stringify(resumo));
process.env.OUTREACH_ENABLED = "false";
resumo = (await chamarRota(resumoHandler, {})).body as { juliaLigada: boolean };
ok('desligada com "false"', resumo.juliaLigada === false);
process.env.OUTREACH_ENABLED = "1";
resumo = (await chamarRota(resumoHandler, {})).body as { juliaLigada: boolean };
ok('"1" NÃO liga — a trava mestra erra para o lado seguro', resumo.juliaLigada === false);
process.env.OUTREACH_ENABLED = "true";
resumo = (await chamarRota(resumoHandler, {})).body as { juliaLigada: boolean };
ok('ligada com a env "true" E o botão ligado', resumo.juliaLigada === true);

// O aviso ao lado do "Promover" é o que diz se o clique dispara mensagem. Ler
// só a env faria ele prometer abordagem com a abordagem pausada no painel.
abordagemNoPainel(false);
resumo = (await chamarRota(resumoHandler, {})).body as { juliaLigada: boolean };
ok("env ligada + botão do painel DESLIGADO → desligada", resumo.juliaLigada === false, JSON.stringify(resumo));

state.configuracoes.length = 0;
resumo = (await chamarRota(resumoHandler, {})).body as { juliaLigada: boolean };
ok("env ligada + chave AUSENTE → desligada (ausente é desligada)", resumo.juliaLigada === false);
delete process.env.OUTREACH_ENABLED;

secao("promover NÃO liga nem desliga a Júlia");
// A promoção cria o dentista pendente. Quem decide se sai mensagem é a env — e
// esta rota não pode ter opinião sobre isso.
limpar();
const p = clinica();
await chamar([p.id]);
ok("a variável continua ausente", process.env.OUTREACH_ENABLED === undefined);
ok("e nenhuma mensagem saiu", wa.enviadas.length === 0, JSON.stringify(wa.enviadas));

// ---------------------------------------------------------------------------
secao("/api/leads/import continua respondendo o agregado de hoje");
// A 3C mexeu por dentro do leads-import (desfecho por item). A rota antiga não
// pode ter mudado de forma: a tela de importação lê estas chaves.
limpar();
r = await chamarRota(importarHandler, {
  body: { leads: [{ phone: "85999998888", name: "Carlos" }, { phone: "4004" }] },
});
ok("status 200", r.status === 200, JSON.stringify(r.body));
const chaves = Object.keys(r.body as object).sort();
ok(
  "as sete chaves de sempre, e só elas",
  JSON.stringify(chaves) ===
    JSON.stringify([
      "duplicados",
      "ignoradosPorOptOut",
      "importados",
      "invalidos",
      "paraReprocessar",
      "reprocessarDepois",
      "semWhatsapp",
    ]),
  JSON.stringify(chaves),
);
ok(
  "nenhum desfecho por item vazou para a resposta HTTP",
  !("desfechos" in (r.body as object)),
  JSON.stringify(r.body),
);
ok("e o lead importado por ali continua com origin 'import'", state.leads[0].origin === "import", JSON.stringify(state.leads[0]));

// ---------------------------------------------------------------------------
secao("sem sessão — a rota de promoção responde 401");
{
  let statusRecebido = 0;
  let passou = false;
  const res: any = {
    status(c: number) {
      statusRecebido = c;
      return res;
    },
    json() {
      return res;
    },
  };
  requireAuth({ cookies: {} } as never, res, () => {
    passou = true;
  });
  ok("não deixou passar", passou === false);
  ok("respondeu 401", statusRecebido === 401, String(statusRecebido));

  // E a rota está MONTADA atrás dele. Sem esta segunda parte, o teste acima
  // provaria só que o middleware funciona — não que alguém o usa.
  const camadas = (roteadorPrincipal as unknown as { stack: unknown[] }).stack ?? [];
  const primeiroAuth = camadas.findIndex((l: any) => l.handle === requireAuth);
  ok("o roteador principal monta requireAuth", primeiroAuth >= 0, `camadas=${camadas.length}`);
  const publicas = camadas.slice(0, primeiroAuth);
  const alcancaSemAuth = publicas.some((l: any) =>
    ((l.handle as any)?.stack ?? []).some((s: any) =>
      String(s.route?.path ?? "").startsWith("/prospects"),
    ),
  );
  ok("nenhuma rota /prospects fica antes do requireAuth", !alcancaSemAuth);
}

fim();
