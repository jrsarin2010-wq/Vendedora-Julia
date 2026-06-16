/**
 * Cliente de autenticação do painel.
 *
 * Escrito à mão de propósito: estas três chamadas (login/logout/me) são
 * infraestrutura de acesso e não fazem parte do contrato OpenAPI dos dados
 * (leads, stats). Por isso ficam separadas dos hooks gerados.
 *
 * Todas usam `credentials: "include"` para enviar/receber o cookie de sessão.
 */

/** Pergunta ao servidor se a sessão atual está válida. */
export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (!res.ok) return false;
    const data = (await res.json()) as { authenticated?: boolean };
    return Boolean(data?.authenticated);
  } catch {
    return false;
  }
}

/** Tenta logar com a senha. Retorna true se entrou. */
export async function login(password: string): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Encerra a sessão. */
export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // ignora — o objetivo é sair de qualquer jeito
  }
}
