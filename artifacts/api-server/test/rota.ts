/**
 * Driver genérico de rota do Express: pega o handler direto do Router e
 * chama com um req/res falsos, sem subir servidor. Serve para qualquer rota
 * que responda com `res.json` / `res.status(...).json(...)`.
 */

export interface RespostaFake {
  status: number;
  body: unknown;
}

/** Pega o handler da n-ésima rota registrada no router. */
export function handlerDe(router: unknown, indice = 0): (req: unknown, res: unknown) => Promise<void> {
  const camadas = (router as any).stack.filter((l: any) => l.route);
  return camadas[indice].route.stack[0].handle;
}

export interface LinhaDeLog {
  nivel: "info" | "warn" | "error";
  msg: string;
}

export async function chamarRota(
  handler: (req: unknown, res: unknown) => Promise<void>,
  opcoes: { body?: unknown; params?: Record<string, string>; logs?: LinhaDeLog[] } = {},
): Promise<RespostaFake> {
  // status 200 é o padrão do Express quando ninguém chama res.status().
  const resposta: RespostaFake = { status: 200, body: undefined };

  const registrar = (nivel: LinhaDeLog["nivel"]) => (a: unknown, b?: unknown) => {
    opcoes.logs?.push({ nivel, msg: String(typeof a === "string" ? a : (b ?? "")) });
  };

  const res: any = {
    status(codigo: number) {
      resposta.status = codigo;
      return res;
    },
    json(corpo: unknown) {
      resposta.body = corpo;
      return res;
    },
  };

  const req: any = {
    body: opcoes.body,
    query: {},
    params: opcoes.params ?? {},
    header: () => undefined,
    log: { info: registrar("info"), warn: registrar("warn"), error: registrar("error") },
  };

  await handler(req, res);
  return resposta;
}
