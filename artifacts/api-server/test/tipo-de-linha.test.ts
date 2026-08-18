/**
 * FIXO OU CELULAR — a leitura que a tela mostra e que o resumo conta.
 *
 * O que este arquivo protege é a fronteira dos 8 dígitos. O critério de cabeça
 * ("fixo tem 8, celular tem 9") está certo na esmagadora maioria dos números e
 * ERRADO justamente no caso que envenena a conta: o celular antigo, que também
 * tem 8 dígitos locais. Se ele for contado como fixo, a taxa que existe para
 * decidir se vale barrar fixo nasce inflada por quem não é fixo — e a decisão
 * sai pelo lado errado sem nada na tela avisar.
 */
import { ok, secao, fim } from "./assert";
import { tipoDeLinha } from "../src/lib/tipo-de-linha";

secao("celular — 9 dígitos depois do DDD, começando em 9");
ok("como vem do Maps", tipoDeLinha("(85) 99200-8899") === "celular");
ok("só dígitos, com o 55", tipoDeLinha("5585992008899") === "celular");
ok("com o +55 e espaços", tipoDeLinha("+55 11 99999-8888") === "celular");
ok("sem o país (11 dígitos)", tipoDeLinha("11999998888") === "celular");

secao("fixo — 8 dígitos depois do DDD, começando em 2–5");
// O número medido em produção: a 123 Odonto entrou com este fixo e voltou APTA.
ok("o fixo da 123 Odonto", tipoDeLinha("558531215444") === "fixo");
ok("como vem do Maps", tipoDeLinha("(85) 3121-5444") === "fixo");
ok("sem o país (10 dígitos)", tipoDeLinha("8531215444") === "fixo");
ok("começando em 2", tipoDeLinha("552122223333") === "fixo");
ok("começando em 5", tipoDeLinha("551155556666") === "fixo");

secao("celular ANTIGO tem 8 dígitos e NÃO é fixo");
// É a forma que o próprio WhatsApp devolve no jid de conta antiga (ver o
// cabeçalho de canonicalizar-telefone.ts). Contá-lo como fixo poria um número
// que quase sempre tem WhatsApp dentro da taxa do fixo.
ok("8 dígitos começando em 9", tipoDeLinha("558592008899") === "celular");
ok("8 dígitos começando em 8", tipoDeLinha("558582008899") === "celular");
ok("8 dígitos começando em 6", tipoDeLinha("558562008899") === "celular");

secao("o que não dá para afirmar sai indefinido, nunca chutado");
ok("nulo", tipoDeLinha(null) === "indefinido");
ok("indefinido de verdade", tipoDeLinha(undefined) === "indefinido");
ok("vazio", tipoDeLinha("") === "indefinido");
ok("0800 (curto demais)", tipoDeLinha("08001112222") === "indefinido");
ok("letra no meio", tipoDeLinha("BANCO") === "indefinido");
// `normalizarTelefone` deixa passar internacional de propósito; aqui não há
// DDD para descontar, então não há tipo de linha a afirmar.
ok("internacional", tipoDeLinha("351912345678") === "indefinido");
ok("9 dígitos que não começam em 9", tipoDeLinha("5585812345678") === "indefinido");

secao("o DDD 55 continua sendo DDD, não país");
// Santa Maria/RS. A regra é de TAMANHO dentro de normalizarTelefone, e este
// caso é o que prova que ela não virou "já começa com 55".
ok("celular de Santa Maria", tipoDeLinha("55999998888") === "celular");
ok("fixo de Santa Maria", tipoDeLinha("5532213344") === "fixo");

fim();
