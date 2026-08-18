/**
 * OS TETOS DE SAÍDA — 18/08/2026.
 *
 * `max_completion_tokens` não é o tamanho da resposta: é o teto do que o modelo
 * pode GASTAR para produzi-la, e num modelo de raciocínio isso inclui os tokens
 * de raciocínio, que nunca aparecem na saída.
 *
 * O que este arquivo existe para impedir é um jeito específico de quebrar: o
 * teto fica curto SEM NINGUÉM ENCOSTAR NELE, porque foi a tarefa que encareceu.
 * Aconteceu com a abordagem (quatro exemplos prontos viraram seis partes
 * descritas, e o 200 de sempre virou 400 da OpenAI no mesmo deploy), e estava
 * armado para acontecer com a extração: o JSON do extrator ganhou
 * `interlocutor` na Rodada 52 e `descoberta` na 54, e o teto continuou em 200.
 *
 * Por isso a asserção principal aqui é uma MEDIÇÃO, e ela é derivada do próprio
 * prompt do extrator: acrescentar um sinal ou um tópico de descoberta sem
 * revisar o teto deixa este arquivo vermelho.
 */
import { ok, secao, fim } from "./assert";
import { readFileSync } from "node:fs";
import {
  TETO_RESPOSTA,
  TETO_EXTRACAO,
  TETO_ABORDAGEM,
} from "../src/lib/modelos";
import { JULIA_EXTRACTION_PROMPT } from "../src/julia-persona";

/**
 * Tokens a partir de caracteres, DE PROPÓSITO mais pessimista que o
 * `tamanhoEmTokens` do prompt (que usa 3,85 e é calibrado para prosa em
 * português). JSON tokeniza pior que prosa: chave com underscore, aspas e
 * pontuação viram tokens curtos. Aqui a conta serve de MARGEM DE SEGURANÇA, e
 * uma margem que subestima o custo não protege nada.
 */
const tokensDeJson = (texto: string): number => Math.ceil(texto.length / 3);

/** Lê do prompt do extrator a lista fechada que ele mesmo declara. */
function listaDoPrompt(marcador: string, ate: string): string[] {
  const i = JULIA_EXTRACTION_PROMPT.indexOf(marcador);
  if (i < 0) return [];
  const trecho = JULIA_EXTRACTION_PROMPT.slice(i + marcador.length);
  const fimDoTrecho = trecho.indexOf(ate);
  return (fimDoTrecho > 0 ? trecho.slice(0, fimDoTrecho) : trecho)
    .split(/[,\n]/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter((s) => /^[a-z_]+$/.test(s) && s.length > 3);
}

secao("as listas do extrator são lidas do próprio prompt (senão a medição mente)");
const sinais = listaDoPrompt("Sinais possíveis (use exatamente estes nomes, e só os que REALMENTE apareceram):", "- Liste apenas");
const topicos = listaDoPrompt("- Tópicos possíveis (use exatamente estes nomes):", "- Inclua um tópico");
ok(`achou os sinais no prompt (${sinais.length})`, sinais.length >= 8, sinais.join(","));
ok(`achou os tópicos de descoberta no prompt (${topicos.length})`, topicos.length >= 5, topicos.join(","));

secao("EXTRAÇÃO — a ficha CHEIA cabe no teto, com folga para o raciocínio");
{
  // O pior caso realista: todos os campos preenchidos, todos os sinais, todos
  // os tópicos. É a conversa RICA — o lead engajado, que respondeu muita
  // coisa. Não é hipótese acadêmica: é o melhor lead da lista, e era
  // exatamente ele que o teto de 200 ia cortar primeiro.
  const pior = {
    painPoints: "ninguem responde o WhatsApp quando esta com paciente na cadeira",
    mainObjection: "ja tentei uma ferramenta parecida e o paciente percebeu que era robo",
    name: "Marina",
    planInterest: "essencial",
    funnelStage: "objection",
    isCustomer: false,
    wantsToStop: false,
    irritado: false,
    duvidaDoSite: "profissional adicional",
    sinais,
    interlocutor: "dentista_dono",
    descoberta: Object.fromEntries(topicos.map((t) => [t, "instagram e google"])),
  };
  const json = JSON.stringify(pior);
  const visivel = tokensDeJson(json);

  ok(
    `o JSON cheio já passa de 200 tokens (${visivel}) — o teto antigo não cabia`,
    visivel > 200,
    json,
  );
  // Dobro: o que sobra é para o raciocínio, que não aparece na saída e que a
  // API pode gastar antes de escrever o primeiro caractere.
  ok(
    `TETO_EXTRACAO (${TETO_EXTRACAO}) tem pelo menos o dobro do JSON cheio (${visivel})`,
    TETO_EXTRACAO >= visivel * 2,
    `Se um campo novo entrou no extrator, suba TETO_EXTRACAO em lib/modelos.ts: ` +
      `preciso de ${visivel * 2}, tenho ${TETO_EXTRACAO}.`,
  );
}

secao("os três tetos existem, e nenhum voltou ao valor que já quebrou");
ok(`resposta = ${TETO_RESPOSTA}`, TETO_RESPOSTA >= 512);
ok(`extração = ${TETO_EXTRACAO}`, TETO_EXTRACAO > 200, "200 é o valor que não cabia");
ok(`abordagem = ${TETO_ABORDAGEM}`, TETO_ABORDAGEM > 200, "200 é o valor que quebrou em produção");

secao("nenhum teto solto: toda chamada ao modelo lê a constante");
{
  // A armadilha não era o número — era ele estar escondido dentro da chamada,
  // longe de qualquer lugar onde alguém fosse procurar ao mexer num prompt.
  // Um literal novo aqui reabre exatamente isso.
  const arquivos = [
    "src/routes/webhook.ts",
    "src/lib/outreach-message.ts",
  ];
  const soltos: string[] = [];
  for (const arq of arquivos) {
    const fonte = readFileSync(new URL(`../../${arq}`, import.meta.url), "utf8");
    for (const linha of fonte.split("\n")) {
      if (/max_completion_tokens:\s*\d/.test(linha)) soltos.push(`${arq}: ${linha.trim()}`);
    }
  }
  ok(
    "nenhum max_completion_tokens com número cravado",
    soltos.length === 0,
    soltos.join(" | "),
  );
}

// A sonda de boot é a única chamada que PODE ter número solto: ela pede uma
// resposta de um token para saber se o modelo responde, e esse 16 não tem
// nada a ver com o custo de nenhuma tarefa real.
secao("a exceção é a sonda de boot, e ela é declarada");
{
  const sonda = readFileSync(new URL("../../src/lib/sonda-modelo.ts", import.meta.url), "utf8");
  ok(
    "a sonda continua com o teto mínimo dela",
    /max_completion_tokens:\s*16/.test(sonda),
    "Se a sonda mudou, confira se ela ainda é um ping e não uma tarefa.",
  );
}

fim();
