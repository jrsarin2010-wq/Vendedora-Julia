/**
 * Etapa 3A — verificação automática de WhatsApp.
 *
 * O que este arquivo protege, em ordem de prejuízo:
 *
 *   1. `existe: null` NUNCA vira descarte. Evolution fora do ar descartando
 *      clínica boa é um prejuízo que não deixa rastro: o status fica
 *      `sem_whatsapp`, ninguém revisa, e a cidade "não rendeu".
 *   2. A TRAVA HÍBRIDA. Duas chaves, e o worker exige as duas — falhar aberto
 *      aqui significa disputar a instância da Evolution com conversa real.
 *   3. A forma GRAVADA é a do `jid`, não a enviada. É o que faz a comparação
 *      com `leads.phone` na Etapa 3C ser igualdade simples.
 *
 * As asserções de "não fez" valem mais que as de "fez": o que roda todo mundo
 * percebe na hora.
 */
import { ok, secao, fim } from "./assert";
import { handlerDe, chamarRota } from "./rota";
import verificacaoRouter from "../src/routes/verificacao";
import prospectsRouter from "../src/routes/prospects";
import {
  rodarCicloDeVerificacao,
  retomarVerificacao,
  estadoDaPausaDaVerificacao,
} from "../src/lib/verificacao-scheduler";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";

const statusHandler = handlerDe(verificacaoRouter, 0);
const ativaHandler = handlerDe(verificacaoRouter, 1);
const resumoHandler = handlerDe(prospectsRouter, 0);

const AGORA = new Date("2026-08-15T12:00:00Z");
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60 * 1000);
const horasAtras = (n: number) => new Date(AGORA.getTime() - n * 60 * 60 * 1000);

interface Clinica {
  id: number;
  nome: string;
  telefoneRaw: string | null;
  telefoneWhatsapp: string | null;
  temWhatsapp: boolean | null;
  verificadoWhatsappEm: Date | null;
  statusProspeccao: string;
}

interface Status {
  ativa: boolean;
  interruptorGeral: boolean;
  pausadaPorErro: boolean;
  motivoPausa: string | null;
  aVerificar: number;
  verificadosNa24h: number;
  tetoDiario: number;
  tamanhoDoLote: number;
}

/**
 * O padrão imita o que a varredura REALMENTE grava (ver prepararItem em
 * lib/varredura.ts): `telefone_raw` como veio do Maps e todo o resto da
 * verificação em branco. É o estado exato em que a 3A encontra a fila.
 */
function clinica(campos: Partial<Clinica> & Record<string, unknown> = {}) {
  state.clinicas.push({
    id: state.nextId++,
    placeId: `place-${state.nextId}`,
    nome: "Clínica Teste",
    telefoneRaw: "(11) 99999-8888",
    telefoneWhatsapp: null,
    temWhatsapp: null,
    verificadoWhatsappEm: null,
    bairro: null,
    cidade: "São Paulo",
    uf: "SP",
    statusProspeccao: "novo",
    atualizadoEm: null,
    ...campos,
  });
}

const clinicas = () => state.clinicas as unknown as Clinica[];
const porNome = (nome: string) => clinicas().find((c) => c.nome === nome)!;

function ligarNoPainel(ativa: boolean) {
  state.configuracoes.push({ chave: "verificacao_ativa", valor: ativa ? "true" : "false" });
}

function limpar() {
  state.reset();
  wa.reset();
  retomarVerificacao();
  wa.numeros.responder = null;
  process.env.VERIFICACAO_ENABLED = "true";
}

/** Faz a Evolution responder uma coisa fixa para todo número do bloco. */
function evolutionResponde(fn: (numero: string) => Record<string, unknown>) {
  wa.numeros.responder = (numeros: string[]) => ({
    ok: true,
    itens: numeros.map(fn),
  });
}

// ---------------------------------------------------------------------------
secao("A TRAVA HÍBRIDA — o worker exige as DUAS chaves");

limpar();
process.env.VERIFICACAO_ENABLED = "false";
ligarNoPainel(true);
clinica();
let c = await rodarCicloDeVerificacao(AGORA);
ok(
  "env false + banco true → NÃO roda",
  c.acao === "nada" && c.motivo === "desligada",
  JSON.stringify(c),
);
ok("e a Evolution não foi consultada", wa.numeros.blocos.length === 0);

limpar();
ligarNoPainel(false);
clinica();
c = await rodarCicloDeVerificacao(AGORA);
ok(
  "env true + banco false → NÃO roda",
  c.acao === "nada" && c.motivo === "desligada_no_painel",
  JSON.stringify(c),
);
ok("e a Evolution não foi consultada", wa.numeros.blocos.length === 0);

limpar();
clinica();
c = await rodarCicloDeVerificacao(AGORA);
ok(
  "env true + chave AUSENTE → NÃO roda (ausente é desligada)",
  c.acao === "nada" && c.motivo === "desligada_no_painel",
  JSON.stringify(c),
);

limpar();
ligarNoPainel(true);
clinica();
c = await rodarCicloDeVerificacao(AGORA);
ok("as duas ligadas → roda", c.acao === "verificou" && c.lote === 1, JSON.stringify(c));
ok("e a Evolution foi consultada uma vez", wa.numeros.blocos.length === 1);

// ---------------------------------------------------------------------------
secao("existe: true — grava a forma do JID, nunca a enviada");
limpar();
ligarNoPainel(true);
// O caso REAL medido em produção: mandamos 13 dígitos, a conta antiga vive na
// forma de 12. Gravar o que enviamos traria de volta o bug que a Etapa 1.5
// existe para fechar.
clinica({ nome: "Antiga", telefoneRaw: "(85) 99200-8899" });
evolutionResponde(() => ({
  number: "5585992008899",
  exists: true,
  jid: "558592008899@s.whatsapp.net",
}));
c = await rodarCicloDeVerificacao(AGORA);
ok("rodou", c.acao === "verificou", JSON.stringify(c));
ok("enviou os 13 dígitos", wa.numeros.blocos[0][0] === "5585992008899", JSON.stringify(wa.numeros.blocos));
ok("virou apto", porNome("Antiga").statusProspeccao === "apto", porNome("Antiga").statusProspeccao);
ok(
  "gravou os 12 dígitos do jid, não os 13 enviados",
  porNome("Antiga").telefoneWhatsapp === "558592008899",
  String(porNome("Antiga").telefoneWhatsapp),
);
ok("tem_whatsapp = true", porNome("Antiga").temWhatsapp === true);
ok(
  "e carimbou a data da verificação",
  porNome("Antiga").verificadoWhatsappEm?.getTime() === AGORA.getTime(),
  String(porNome("Antiga").verificadoWhatsappEm),
);

// ---------------------------------------------------------------------------
secao("existe: false — sem_whatsapp, e telefone_whatsapp continua NULO");
limpar();
ligarNoPainel(true);
clinica({ nome: "Fixo" });
// A Evolution devolve `jid` também para número inexistente, montado a partir
// do que pedimos. Gravá-lo seria inventar identidade de conta que não existe.
evolutionResponde((n) => ({ number: n, exists: false, jid: `${n}@s.whatsapp.net` }));
await rodarCicloDeVerificacao(AGORA);
ok("virou sem_whatsapp", porNome("Fixo").statusProspeccao === "sem_whatsapp", porNome("Fixo").statusProspeccao);
ok("tem_whatsapp = false", porNome("Fixo").temWhatsapp === false);
ok(
  "telefone_whatsapp segue nulo — não existe conta, não existe forma canônica",
  porNome("Fixo").telefoneWhatsapp === null,
  String(porNome("Fixo").telefoneWhatsapp),
);
ok("mas foi verificada", porNome("Fixo").verificadoWhatsappEm !== null);

// ---------------------------------------------------------------------------
secao("existe: null — o prospect fica INTOCADO e volta no próximo lote");
limpar();
ligarNoPainel(true);
clinica({ nome: "Sem resposta" });
clinica({ nome: "Com resposta", telefoneRaw: "(85) 99200-8899" });
// Uma responde, a outra some da resposta: é assim que "não sei" acontece de
// verdade, e é o caso em que descartar seria prejuízo silencioso.
wa.numeros.responder = () => ({
  ok: true,
  itens: [{ number: "5585992008899", exists: true, jid: "5585992008899@s.whatsapp.net" }],
});
await rodarCicloDeVerificacao(AGORA);
ok(
  "quem não teve veredito continua novo",
  porNome("Sem resposta").statusProspeccao === "novo",
  porNome("Sem resposta").statusProspeccao,
);
ok("com tem_whatsapp ainda nulo", porNome("Sem resposta").temWhatsapp === null);
ok("e SEM data de verificação", porNome("Sem resposta").verificadoWhatsappEm === null);
ok("a que respondeu virou apto", porNome("Com resposta").statusProspeccao === "apto");

// ---------------------------------------------------------------------------
secao("telefone que a normalização recusa NÃO gasta chamada externa");
limpar();
ligarNoPainel(true);
clinica({ nome: "0800", telefoneRaw: "0800 111 2222" });
clinica({ nome: "Curto", telefoneRaw: "1234" });
c = await rodarCicloDeVerificacao(AGORA);
ok("o ciclo agiu", c.acao === "verificou" && c.motivo === "so_invalidos", JSON.stringify(c));
ok("a Evolution NÃO foi chamada", wa.numeros.blocos.length === 0, JSON.stringify(wa.numeros.blocos));
ok("0800 virou telefone_invalido", porNome("0800").statusProspeccao === "telefone_invalido");
ok("número curto também", porNome("Curto").statusProspeccao === "telefone_invalido");
ok(
  "e nenhum dos dois ganhou data de verificação — a Evolution não olhou",
  porNome("0800").verificadoWhatsappEm === null && porNome("Curto").verificadoWhatsappEm === null,
);

secao("lote misto — o inválido sai da fila e o bom vai para a Evolution");
limpar();
ligarNoPainel(true);
clinica({ nome: "Ruim", telefoneRaw: "0800 111 2222" });
clinica({ nome: "Bom" });
await rodarCicloDeVerificacao(AGORA);
ok("só UM número foi consultado", wa.numeros.blocos[0]?.length === 1, JSON.stringify(wa.numeros.blocos));
ok("o inválido saiu da fila", porNome("Ruim").statusProspeccao === "telefone_invalido");
ok("o bom foi verificado", porNome("Bom").statusProspeccao === "apto");

// ---------------------------------------------------------------------------
secao("seleção — sem_telefone nunca entra, e quem já tem veredito não volta");
limpar();
ligarNoPainel(true);
clinica({ nome: "Sem telefone", telefoneRaw: null, statusProspeccao: "sem_telefone" });
clinica({ nome: "Já apto", statusProspeccao: "apto", telefoneWhatsapp: "5511999998888", temWhatsapp: true, verificadoWhatsappEm: horasAtras(20) });
clinica({ nome: "Já sem", statusProspeccao: "sem_whatsapp", temWhatsapp: false, verificadoWhatsappEm: horasAtras(20) });
clinica({ nome: "Elegível" });
c = await rodarCicloDeVerificacao(AGORA);
ok("só UM entrou no lote", c.lote === 1, JSON.stringify(c));
ok("e é o elegível", porNome("Elegível").statusProspeccao === "apto");
ok("o sem_telefone não foi tocado", porNome("Sem telefone").statusProspeccao === "sem_telefone");
ok(
  "o já apto não foi reprocessado",
  porNome("Já apto").verificadoWhatsappEm?.getTime() === horasAtras(20).getTime(),
  String(porNome("Já apto").verificadoWhatsappEm),
);
ok(
  "nem o já sem_whatsapp",
  porNome("Já sem").verificadoWhatsappEm?.getTime() === horasAtras(20).getTime(),
);

secao("mais de 50 elegíveis — pega exatamente 50 e deixa o resto na fila");
limpar();
ligarNoPainel(true);
for (let i = 0; i < 60; i++) {
  clinica({ nome: `C${i}`, telefoneRaw: `11 9${10000000 + i}` });
}
c = await rodarCicloDeVerificacao(AGORA);
ok("o lote tem 50", c.lote === 50, JSON.stringify(c));
ok("e o bloco enviado tem 50", wa.numeros.blocos[0]?.length === 50, String(wa.numeros.blocos[0]?.length));
ok(
  "sobraram 10 em novo",
  clinicas().filter((x) => x.statusProspeccao === "novo").length === 10,
  String(clinicas().filter((x) => x.statusProspeccao === "novo").length),
);

// ---------------------------------------------------------------------------
secao("intervalo mínimo de 15 min entre lotes");
limpar();
ligarNoPainel(true);
clinica({ nome: "Primeira" });
clinica({ nome: "Segunda", telefoneRaw: "11 988887777" });
c = await rodarCicloDeVerificacao(AGORA);
ok("o primeiro lote rodou", c.acao === "verificou", JSON.stringify(c));

// A "Segunda" só entrou no mesmo lote se as duas estavam em `novo` — estavam,
// então o que sobra é confirmar que um lote NOVO não sai antes da hora.
clinica({ nome: "Terceira", telefoneRaw: "11 977776666" });
c = await rodarCicloDeVerificacao(minutos(5));
ok("5 min depois → NÃO roda", c.acao === "nada" && c.motivo === "intervalo_minimo", JSON.stringify(c));
c = await rodarCicloDeVerificacao(minutos(14));
ok("14 min depois → ainda não", c.motivo === "intervalo_minimo", JSON.stringify(c));
ok("e a Terceira segue intocada", porNome("Terceira").statusProspeccao === "novo");
c = await rodarCicloDeVerificacao(minutos(16));
ok("16 min depois → roda", c.acao === "verificou", JSON.stringify(c));
ok("e a Terceira foi verificada", porNome("Terceira").statusProspeccao === "apto");

// ---------------------------------------------------------------------------
secao("teto diário de 200 na janela deslizante de 24h");
limpar();
ligarNoPainel(true);
// 200 já verificados dentro da janela, mais um elegível esperando.
for (let i = 0; i < 200; i++) {
  clinica({ nome: `V${i}`, statusProspeccao: "apto", temWhatsapp: true, verificadoWhatsappEm: horasAtras(3) });
}
clinica({ nome: "Esperando" });
c = await rodarCicloDeVerificacao(AGORA);
ok("bateu o teto → NÃO roda", c.acao === "nada" && c.motivo === "cota_diaria", JSON.stringify(c));
ok("e ninguém foi consultado", wa.numeros.blocos.length === 0);
ok("o elegível segue novo", porNome("Esperando").statusProspeccao === "novo");

secao("o que saiu da janela de 24h devolve fôlego");
// Uma das 200 passa a ter 25h: a janela é DESLIZANTE, então ela não conta mais.
porNome("V0").verificadoWhatsappEm = horasAtras(25);
c = await rodarCicloDeVerificacao(AGORA);
ok("199 na janela → roda", c.acao === "verificou", JSON.stringify(c));
ok("e o elegível foi verificado", porNome("Esperando").statusProspeccao === "apto");

// ---------------------------------------------------------------------------
secao("lote inteiro mudo — UM não pausa, DOIS pausam com alerta único");
limpar();
ligarNoPainel(true);
clinica({ nome: "A" });
clinica({ nome: "B", telefoneRaw: "11 988887777" });
// A Evolution fora do ar: o bloco inteiro fica indeterminado.
wa.numeros.responder = () => ({ ok: false, itens: [] });

c = await rodarCicloDeVerificacao(AGORA);
ok("o primeiro lote mudo NÃO pausa", c.motivo === "lote_mudo", JSON.stringify(c));
ok("nada foi pausado ainda", estadoDaPausaDaVerificacao().pausada === false);
ok("nenhum alerta ainda", wa.verificacoes.length === 0, JSON.stringify(wa.verificacoes));
ok(
  "e NINGUÉM foi descartado",
  clinicas().every((x) => x.statusProspeccao === "novo" && x.temWhatsapp === null),
  JSON.stringify(clinicas().map((x) => x.statusProspeccao)),
);

c = await rodarCicloDeVerificacao(minutos(1));
ok("o segundo pausa", c.acao === "nada" && c.motivo === "pausada", JSON.stringify(c));
ok("a pausa está registrada", estadoDaPausaDaVerificacao().pausada === true);
ok(
  "com motivo legível",
  (estadoDaPausaDaVerificacao().motivo ?? "").includes("veredito"),
  String(estadoDaPausaDaVerificacao().motivo),
);
ok("e UM alerta saiu", wa.verificacoes.length === 1, JSON.stringify(wa.verificacoes));
ok("as clínicas continuam em novo", clinicas().every((x) => x.statusProspeccao === "novo"));

c = await rodarCicloDeVerificacao(minutos(2));
ok("os ciclos seguintes não fazem nada", c.acao === "nada" && c.motivo === "pausada");
ok(
  "e o alerta continua ÚNICO — não vira um por minuto",
  wa.verificacoes.length === 1,
  String(wa.verificacoes.length),
);

secao("um lote mudo no meio de lotes bons não acumula");
limpar();
ligarNoPainel(true);
clinica({ nome: "Um" });
wa.numeros.responder = () => ({ ok: false, itens: [] });
await rodarCicloDeVerificacao(AGORA);
ok("mudo: segue novo", porNome("Um").statusProspeccao === "novo");
wa.numeros.responder = null; // a Evolution voltou
await rodarCicloDeVerificacao(minutos(1));
ok("lote bom zerou o contador", porNome("Um").statusProspeccao === "apto");
clinica({ nome: "Dois", telefoneRaw: "11 988887777" });
wa.numeros.responder = () => ({ ok: false, itens: [] });
await rodarCicloDeVerificacao(minutos(20));
ok(
  "um mudo depois de um bom NÃO pausa — a contagem tem de ser SEGUIDA",
  estadoDaPausaDaVerificacao().pausada === false,
  String(estadoDaPausaDaVerificacao().motivo),
);

secao("a pausa vence as duas travas ligadas");
limpar();
ligarNoPainel(true);
clinica({ nome: "X" });
wa.numeros.responder = () => ({ ok: false, itens: [] });
await rodarCicloDeVerificacao(AGORA);
await rodarCicloDeVerificacao(minutos(1));
wa.numeros.responder = null;
c = await rodarCicloDeVerificacao(minutos(2));
ok("segue pausada mesmo com a Evolution de volta", c.motivo === "pausada", JSON.stringify(c));

// ---------------------------------------------------------------------------
secao("GET /verificacao/status — fila vazia, nada inventado");
limpar();
let r = await chamarRota(statusHandler, {});
ok("status 200", r.status === 200, JSON.stringify(r.body));
let s = r.body as Status;
ok("ativa = false quando a chave nem existe", s.ativa === false);
ok("interruptorGeral reflete a env", s.interruptorGeral === true);
ok("não pausada", s.pausadaPorErro === false && s.motivoPausa === null);
ok("nada a verificar", s.aVerificar === 0);
ok("nada verificado", s.verificadosNa24h === 0);
ok("teto diário 200", s.tetoDiario === 200);
ok("lote de 50", s.tamanhoDoLote === 50);

secao("status — a env desligada aparece na tela em vez de virar botão morto");
limpar();
process.env.VERIFICACAO_ENABLED = "false";
ligarNoPainel(true);
s = (await chamarRota(statusHandler, {})).body as Status;
ok("ativa = true (o painel diz sim)", s.ativa === true);
ok("interruptorGeral = false (o Railway diz não)", s.interruptorGeral === false);

secao("status — aVerificar conta quem o worker realmente pegaria");
limpar();
clinica({ nome: "Elegível 1" });
clinica({ nome: "Elegível 2" });
clinica({ nome: "Sem telefone", telefoneRaw: null, statusProspeccao: "sem_telefone" });
clinica({ nome: "Já apto", statusProspeccao: "apto", verificadoWhatsappEm: horasAtras(2) });
clinica({ nome: "Antiga", statusProspeccao: "sem_whatsapp", verificadoWhatsappEm: horasAtras(30) });
s = (await chamarRota(statusHandler, {})).body as Status;
ok("2 a verificar — o sem_telefone e os já verificados ficam de fora", s.aVerificar === 2, String(s.aVerificar));
ok(
  "1 verificado nas 24h — o de 30h atrás saiu da janela",
  s.verificadosNa24h === 1,
  String(s.verificadosNa24h),
);

secao("status — a pausa chega na tela COM o motivo");
limpar();
ligarNoPainel(true);
clinica({ nome: "Y" });
wa.numeros.responder = () => ({ ok: false, itens: [] });
await rodarCicloDeVerificacao(AGORA);
await rodarCicloDeVerificacao(minutos(1));
s = (await chamarRota(statusHandler, {})).body as Status;
ok("pausadaPorErro = true", s.pausadaPorErro === true);
ok(
  "e o motivo é uma frase, não um código",
  typeof s.motivoPausa === "string" && s.motivoPausa.includes("lotes"),
  String(s.motivoPausa),
);

// ---------------------------------------------------------------------------
secao("POST /verificacao/ativa — grava e devolve o status já atualizado");
limpar();
r = await chamarRota(ativaHandler, { body: { ativa: true } });
ok("status 200", r.status === 200, JSON.stringify(r.body));
ok("a resposta já diz ativa", (r.body as Status).ativa === true);
ok("gravou uma linha", state.configuracoes.length === 1, JSON.stringify(state.configuracoes));
ok(
  "com a chave certa",
  state.configuracoes[0].chave === "verificacao_ativa" && state.configuracoes[0].valor === "true",
  JSON.stringify(state.configuracoes[0]),
);
ok("e o GET concorda", ((await chamarRota(statusHandler, {})).body as Status).ativa === true);

secao("POST /verificacao/ativa — desligar ATUALIZA a linha, não cria outra");
r = await chamarRota(ativaHandler, { body: { ativa: false } });
ok("a resposta diz desligada", (r.body as Status).ativa === false);
ok("continua UMA linha só", state.configuracoes.length === 1, JSON.stringify(state.configuracoes));
ok("com o valor novo", state.configuracoes[0].valor === "false");

secao("POST /verificacao/ativa — corpo inválido é recusado, não interpretado");
for (const corpo of [{ ativa: "true" }, { ativa: "false" }, { ativa: 1 }, {}, { ativa: null }]) {
  const resp = await chamarRota(ativaHandler, { body: corpo });
  ok(`400 para ${JSON.stringify(corpo)}`, resp.status === 400, JSON.stringify(resp.body));
}
ok("e nada foi alterado", state.configuracoes[0].valor === "false");

// ---------------------------------------------------------------------------
secao("o resumo passa a contar a TAXA DE APROVEITAMENTO da varredura");
limpar();
ligarNoPainel(true);
clinica({ nome: "T1", telefoneRaw: "11 911112222" });
clinica({ nome: "T2", telefoneRaw: "11 933334444" });
clinica({ nome: "T3", telefoneRaw: "0800 111 2222" });
// T1 existe, T2 não.
wa.numeros.responder = (numeros: string[]) => ({
  ok: true,
  itens: numeros.map((n) => ({
    number: n,
    exists: n === "5511911112222",
    jid: `${n}@s.whatsapp.net`,
  })),
});
await rodarCicloDeVerificacao(AGORA);

const resumo = (await chamarRota(resumoHandler, {})).body as {
  comWhatsapp: number | null;
  semWhatsapp: number | null;
  telefoneInvalido: number;
  comTelefone: number;
  total: number;
};
ok("comWhatsapp = 1", resumo.comWhatsapp === 1, String(resumo.comWhatsapp));
ok("semWhatsapp = 1", resumo.semWhatsapp === 1, String(resumo.semWhatsapp));
ok("telefoneInvalido = 1", resumo.telefoneInvalido === 1, String(resumo.telefoneInvalido));
ok(
  "e comTelefone continua 3 — ele mede o Maps, não o nosso trabalho",
  resumo.comTelefone === 3,
  String(resumo.comTelefone),
);

secao("resumo — antes do primeiro veredito, comWhatsapp e semWhatsapp são NULOS");
limpar();
clinica({ nome: "N1" });
clinica({ nome: "N2", telefoneRaw: "0800 111 2222", statusProspeccao: "telefone_invalido" });
const cru = (await chamarRota(resumoHandler, {})).body as {
  comWhatsapp: number | null;
  semWhatsapp: number | null;
  telefoneInvalido: number;
};
ok("comWhatsapp nulo", cru.comWhatsapp === null, String(cru.comWhatsapp));
ok("semWhatsapp nulo — 0 leria como 'conferimos e todas têm'", cru.semWhatsapp === null);
ok(
  "mas telefoneInvalido é número desde já — a recusa é nossa, não da Evolution",
  cru.telefoneInvalido === 1,
  String(cru.telefoneInvalido),
);

fim();
