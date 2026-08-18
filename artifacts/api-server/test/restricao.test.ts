/**
 * RESTRIÇÃO DO NÚMERO — as duas defesas contra condenar lead por erro nosso.
 *
 * O incidente que isto trava (18/08/2026): o WhatsApp restringiu o número da
 * Júlia por 23h. Todo envio de abordagem voltou 400 com "Error: Connection
 * Closed", o código leu 400 como "este número não existe no WhatsApp", e em
 * doze minutos três dentistas com número BOM foram marcados `nao_entregavel`
 * e saíram da fila para sempre.
 *
 * As duas defesas são testadas separadas porque são independentes de
 * propósito: a primeira depende de reconhecer a frase de erro, a segunda não
 * depende de reconhecer nada.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// `?real` porque o runner troca o módulo de integrações por um stub, e aqui
// o alvo do teste é justamente a regra que mora dentro dele.
import { classificarFalhaDeEnvio } from "../src/lib/integrations?real";
import {
  LEADS_SEGUIDOS_ATE_PAUSAR,
  esquecerFalhasSeguidas,
  motivoDaPausa,
  registrarEnvioEntregue,
  registrarFalhaDeEnvio,
} from "../src/lib/restricao";

/** O corpo exato que a Evolution devolveu durante a restrição, em 18/08/2026. */
const CORPO_DA_RESTRICAO =
  '{"status":400,"error":"Bad Request","response":{"message":["Error: Connection Closed"]}}';

describe("defesa 1 — ler o corpo do 400", () => {
  test("o 400 do incidente NÃO condena o lead, e acusa bloqueio nosso", () => {
    const v = classificarFalhaDeEnvio(400, CORPO_DA_RESTRICAO);
    assert.equal(v.falhaPermanente, false, "isto condenou três dentistas de número bom");
    assert.equal(v.bloqueioNosso, true);
  });

  test("400 que fala do destinatário continua condenando — a Rodada 51 segue de pé", () => {
    // Sem isto, um número morto na frente da fila volta a ser escolhido a cada
    // ciclo para sempre, que é o defeito que a contagem existe para fechar.
    const v = classificarFalhaDeEnvio(
      400,
      '{"status":400,"error":"Bad Request","response":{"message":["number is not a valid WhatsApp"]}}',
    );
    assert.equal(v.falhaPermanente, true);
    assert.equal(v.bloqueioNosso, false);
  });

  test("as assinaturas de bloqueio nosso pegam as formas conhecidas de a sessão cair", () => {
    for (const corpo of [
      "Error: Connection Closed",
      "connection lost",
      "Instance not connected",
      "The socket is closed",
      "account temporarily blocked for spam",
      "your number was restricted",
    ]) {
      const v = classificarFalhaDeEnvio(400, corpo);
      assert.equal(v.bloqueioNosso, true, `deveria ser bloqueio nosso: ${corpo}`);
      assert.equal(v.falhaPermanente, false, `não pode condenar lead: ${corpo}`);
    }
  });

  test("a leitura não depende de caixa", () => {
    assert.equal(classificarFalhaDeEnvio(400, "ERROR: CONNECTION CLOSED").bloqueioNosso, true);
  });

  test("nada além do 400 condena lead: 5xx e timeout são infra", () => {
    for (const status of [500, 502, 503, 504, 429]) {
      assert.equal(classificarFalhaDeEnvio(status, "").falhaPermanente, false);
    }
  });

  test("401 e 403 são configuração nossa: não condenam e ainda acusam bloqueio", () => {
    for (const status of [401, 403]) {
      const v = classificarFalhaDeEnvio(status, "");
      assert.equal(v.falhaPermanente, false);
      assert.equal(v.bloqueioNosso, true, "chave errada tem que parar tudo, não queimar fila");
    }
  });
});

describe("defesa 2 — a rajada de leads diferentes", () => {
  beforeEach(() => esquecerFalhasSeguidas());

  test("três leads DIFERENTES seguidos param a abordagem", () => {
    assert.equal(registrarFalhaDeEnvio(101).deveParar, false);
    assert.equal(registrarFalhaDeEnvio(102).deveParar, false);
    const terceiro = registrarFalhaDeEnvio(103);
    assert.equal(terceiro.deveParar, true);
    assert.equal(terceiro.leadsSeguidos, LEADS_SEGUIDOS_ATE_PAUSAR);
  });

  test("o MESMO lead falhando três vezes NÃO para nada", () => {
    // É a diferença entre as duas contagens, e confundi-las inverteria as
    // duas travas: três tentativas no mesmo número é sobre o NÚMERO (e aí
    // quem age é o nao-entregavel), três números diferentes é sobre NÓS.
    for (let i = 0; i < 5; i++) {
      assert.equal(registrarFalhaDeEnvio(77).deveParar, false, `tentativa ${i + 1}`);
    }
  });

  test("uma entrega no meio zera a rajada", () => {
    registrarFalhaDeEnvio(101);
    registrarFalhaDeEnvio(102);
    registrarEnvioEntregue();
    assert.equal(registrarFalhaDeEnvio(103).deveParar, false);
    assert.equal(registrarFalhaDeEnvio(104).deveParar, false);
    assert.equal(registrarFalhaDeEnvio(105).deveParar, true);
  });

  test("a rajada não depende de reconhecer a frase de erro", () => {
    // É a razão de ela existir: quando a Evolution inventar uma mensagem que
    // a lista de assinaturas não conhece, esta trava continua de pé sozinha.
    const desconhecido = classificarFalhaDeEnvio(400, "algo que ninguem previu");
    assert.equal(desconhecido.bloqueioNosso, false, "premissa: a frase NÃO foi reconhecida");
    registrarFalhaDeEnvio(201);
    registrarFalhaDeEnvio(202);
    assert.equal(registrarFalhaDeEnvio(203).deveParar, true);
  });

  test("o motivo diz o que fazer, e não só o que houve", () => {
    const texto = motivoDaPausa(3, "a Evolution recusou o envio pelo NOSSO lado");
    assert.match(texto, /não é problema dos números/);
    assert.match(texto, /restringiu o número/);
    assert.match(texto, /insistir agrava/);
    // Quem lê isso precisa saber que a conversa viva não parou junto.
    assert.match(texto, /Responder quem já conversa continua funcionando/);
  });
});
