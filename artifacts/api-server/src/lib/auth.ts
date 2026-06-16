/**
 * AUTENTICAÇÃO DO PAINEL — senha única
 *
 * Protege o painel da Júlia com uma senha única (ADMIN_PASSWORD).
 * Ao acertar a senha, o servidor entrega um "crachá" assinado (cookie de
 * sessão) que vale 7 dias. As rotas de dados (leads, stats) exigem esse crachá.
 *
 * Segredos necessários (configurar como variáveis de ambiente / secrets):
 *   - ADMIN_PASSWORD  → a senha que você digita pra entrar no painel
 *   - SESSION_SECRET  → texto longo e aleatório usado pra assinar o crachá
 */
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "";

export const SESSION_COOKIE = "julia_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const isProduction = process.env.NODE_ENV === "production";

function sha256(value: string): Buffer {
  return crypto.createHash("sha256").update(value).digest();
}

/**
 * Compara a senha enviada com a ADMIN_PASSWORD de forma "timing-safe"
 * (sem vazar, pelo tempo de resposta, o quão perto a senha estava).
 */
export function verifyPassword(input: string): boolean {
  if (!ADMIN_PASSWORD) {
    logger.error("ADMIN_PASSWORD não configurada — login está bloqueado");
    return false;
  }
  return crypto.timingSafeEqual(sha256(input), sha256(ADMIN_PASSWORD));
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
}

/** Cria um crachá (token de sessão) assinado, válido por 7 dias. */
export function createSessionToken(): string {
  const payload = String(Date.now() + SESSION_TTL_MS); // validade
  return `${payload}.${sign(payload)}`;
}

/** Confere se o crachá é autêntico (assinatura bate) e não expirou. */
export function verifySessionToken(token: string | undefined): boolean {
  if (!token || !SESSION_SECRET) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;

  const expected = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  const exp = Number(payload);
  return Number.isFinite(exp) && Date.now() <= exp;
}

/** Entrega o crachá ao navegador como cookie seguro (HttpOnly). */
export function setSessionCookie(res: Response): void {
  res.cookie(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

/** Remove o crachá (logout). */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Middleware: barra a rota se não houver crachá válido. */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (verifySessionToken(req.cookies?.[SESSION_COOKIE])) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}

// ---------------------------------------------------------------------------
// Trava contra tentativa-e-erro de senha (força bruta)
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 8;
const LOCK_MS = 15 * 60 * 1000; // 15 minutos travado após muitas falhas
const attempts = new Map<string, { count: number; lockedUntil: number }>();

export function isLocked(ip: string): boolean {
  const rec = attempts.get(ip);
  return !!rec && rec.lockedUntil > Date.now();
}

export function recordFailure(ip: string): void {
  const rec = attempts.get(ip) ?? { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCK_MS;
    rec.count = 0;
  }
  attempts.set(ip, rec);
}

export function recordSuccess(ip: string): void {
  attempts.delete(ip);
}
