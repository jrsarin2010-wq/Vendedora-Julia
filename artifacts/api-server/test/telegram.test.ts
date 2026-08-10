/**
 * Rodada 29 — o alerta do Telegram.
 *
 * Este arquivo usa o módulo REAL de integrações ("?real"), porque o que está
 * sob teste é justamente a montagem do alerta e a decisão de enviar ou não.
 * O `fetch` é trocado para nada sair para a rede.
 */
import { ok, secao, fim } from "./assert";
import {
  linkDoWhatsApp,
  sendTelegramAlert,
  sendTelegramPausa,
} from "../src/lib/integrations?real";
import { linhas } from "./stubs/logger.mjs";

const LEAD: any = {
  id: 1,
  name: "Marina",
  phone: "5585999998888",
  funnelStage: "closing",
  status: "hot",
  planInterest: "essencial",
  painPoints: "perde paciente que chama fora do horário",
  mainObjection: "achou caro",
};

secao("o telefone vira link clicável (wa.me)");
ok(
  "número limpo vira wa.me",
  linkDoWhatsApp("5585999998888") === "https://wa.me/5585999998888",
  linkDoWhatsApp("5585999998888"),
);
ok(
  "máscara da importação não estraga o link",
  linkDoWhatsApp("+55 (85) 99999-8888") === "https://wa.me/5585999998888",
  linkDoWhatsApp("+55 (85) 99999-8888"),
);

/** Troca o fetch e devolve o corpo enviado ao Telegram (ou null). */
async function espiarTelegram(f: () => Promise<void>): Promise<any> {
  const antes = globalThis.fetch;
  let corpo: any = null;
  let url = "";
  globalThis.fetch = (async (u: any, init: any) => {
    url = String(u);
    corpo = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) } as any;
  }) as typeof fetch;
  try {
    await f();
    return corpo ? { ...corpo, url } : null;
  } finally {
    globalThis.fetch = antes;
  }
}

secao("sem TELEGRAM_BOT_TOKEN / CHAT_ID, nada sai — mas o log denuncia");
{
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  linhas.length = 0;
  const corpo = await espiarTelegram(() =>
    sendTelegramAlert({ type: "handoff", lead: LEAD, lastMessage: "quero falar com alguém" }),
  );
  ok("nenhuma requisição saiu", corpo === null);
  // É este warn que hoje esconde o lead mais quente possível. Ele precisa dizer
  // exatamente o que falta configurar.
  ok(
    "o log diz o que falta e que o alerta se perdeu",
    linhas.some(
      (l: any) =>
        l.msg.includes("TELEGRAM_BOT_TOKEN") && l.msg.includes("NÃO enviado"),
    ),
    JSON.stringify(linhas),
  );
}

secao("configurado, o alerta de handoff sai completo");
{
  process.env.TELEGRAM_BOT_TOKEN = "123:ABC";
  process.env.TELEGRAM_CHAT_ID = "999";
  const corpo = await espiarTelegram(() =>
    sendTelegramAlert({ type: "handoff", lead: LEAD, lastMessage: "quero falar com alguém" }),
  );

  ok("agora o alerta SAI (config lida a cada chamada)", corpo !== null);
  ok("bateu na API do Telegram", String(corpo.url).includes("api.telegram.org"), corpo.url);
  ok("usa o token configurado", String(corpo.url).includes("bot123:ABC"), corpo.url);
  ok("vai para o chat configurado", corpo.chat_id === "999", String(corpo.chat_id));
  ok("usa Markdown", corpo.parse_mode === "Markdown");
  // O ponto pedido na rodada: abrir a conversa num toque, sem copiar número.
  ok(
    "o telefone é um link clicável, não texto solto",
    corpo.text.includes("[5585999998888](https://wa.me/5585999998888)"),
    corpo.text,
  );
  ok("sem preview de link poluindo o alerta", corpo.disable_web_page_preview === true);
  ok("traz o nome", corpo.text.includes("Marina"));
  ok("traz a dor", corpo.text.includes("fora do horário"));
  ok("traz a objeção", corpo.text.includes("achou caro"));
  ok("traz a última mensagem", corpo.text.includes("quero falar com alguém"));
}

secao("o aviso de pausa diz até quando e como desfazer");
{
  const ate = new Date(Date.now() + 5 * 60 * 1000);
  const corpo = await espiarTelegram(() =>
    sendTelegramPausa({ type: "pausa", lead: LEAD, ate }),
  );
  ok("o aviso sai", corpo !== null);
  ok("diz que a Júlia se calou", corpo.text.includes("a Júlia se calou"), corpo.text);
  ok(
    "o telefone também é clicável aqui",
    corpo.text.includes("https://wa.me/5585999998888"),
    corpo.text,
  );
  ok("explica que cada mensagem adia mais", corpo.text.includes("adia mais 5 minutos"));
  ok("ensina a devolver antes", corpo.text.includes("Devolver para a Júlia"));
}

fim();
