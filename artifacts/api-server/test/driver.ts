/**
 * Driver do webhook: entrega um payload do Evolution ao handler REAL da rota,
 * com banco, OpenAI e Evolution stubados. Não sobe servidor — pega o handler
 * direto do Router do Express.
 */
import router from "../src/routes/webhook";
import { state } from "./stubs/db.mjs";
import { wa } from "./stubs/integrations.mjs";
import { ctrl } from "./stubs/openai.mjs";

const layer = (router as any).stack.find((l: any) => l.route);
const handler = layer.route.stack[0].handle;

export interface LinhaDeLog {
  nivel: "info" | "warn" | "error";
  msg: string;
}

/** Logs da última chamada. Zerado por `post`, preservado por `chamar`. */
export const logs: LinhaDeLog[] = [];

function logStub(nivel: LinhaDeLog["nivel"]) {
  return (a: unknown, b?: unknown) => {
    logs.push({ nivel, msg: String(typeof a === "string" ? a : (b ?? "")) });
  };
}

/**
 * Entrega o payload ao handler. O webhook responde ao Evolution na hora e
 * segue processando de forma assíncrona, então esperamos um tique depois.
 */
export async function chamar(body: unknown): Promise<void> {
  const req: any = {
    body,
    query: {},
    header: () => undefined,
    log: { info: logStub("info"), warn: logStub("warn"), error: logStub("error") },
  };
  const res: any = { json: () => res, status: () => res };
  await handler(req, res);
  await new Promise((r) => setTimeout(r, 20));
}

/**
 * Zera banco, envios e logs sem entregar payload nenhum.
 *
 * Existe para o teste de concorrência, que precisa disparar VÁRIAS chamadas
 * sem `await` entre elas — coisa que o `post` não permite, porque ele espera a
 * primeira terminar antes de devolver.
 */
export function zerar(): void {
  state.reset();
  wa.reset();
  ctrl.reset();
  logs.length = 0;
}

/** Como `chamar`, mas zerando banco, envios e logs antes — cenário do zero. */
export async function post(body: unknown): Promise<void> {
  zerar();
  await chamar(body);
}

let seq = 0;

/**
 * Monta um payload de mensagem de texto do Evolution. O `key.id` é único a
 * cada chamada, senão o filtro de idempotência descartaria a segunda.
 */
export function evento(
  texto: string,
  numero = "5585999998888",
  id?: string,
): unknown {
  return {
    event: "messages.upsert",
    data: {
      key: {
        id: id ?? `TESTE${seq++}`,
        remoteJid: `${numero}@s.whatsapp.net`,
        fromMe: false,
      },
      message: { conversation: texto },
    },
  };
}

/**
 * Mensagem que SAIU do número da clínica (`fromMe: true`). É o payload que a
 * Evolution manda tanto quando a Júlia responde pela API quanto quando um
 * humano digita no celular — distinguir os dois é justamente o ponto da
 * Rodada 29, e quem decide é o `key.id` estar ou não registrado como nosso.
 */
export function eventoFromMe(
  texto: string,
  numero = "5585999998888",
  id?: string,
): unknown {
  return {
    event: "messages.upsert",
    data: {
      key: {
        id: id ?? `SAIU${seq++}`,
        remoteJid: `${numero}@s.whatsapp.net`,
        fromMe: true,
      },
      message: { conversation: texto },
    },
  };
}

/** Como `evento`, mas com um tipo de mídia em vez de texto. */
export function eventoMidia(
  tipo: string,
  numero = "5585999998888",
  id?: string,
): unknown {
  return {
    event: "messages.upsert",
    data: {
      key: {
        id: id ?? `TESTE${seq++}`,
        remoteJid: `${numero}@s.whatsapp.net`,
        fromMe: false,
      },
      message: { [tipo]: {} },
    },
  };
}

export const temLog = (trecho: string): boolean =>
  logs.some((l) => l.msg.includes(trecho));
export const respondeu = (): boolean => wa.enviadas.length > 0;
export const criouLead = (): boolean => state.leads.length > 0;
export const saidas = (direcao: "inbound" | "outbound") =>
  state.messages.filter((m: any) => m.direction === direcao);
