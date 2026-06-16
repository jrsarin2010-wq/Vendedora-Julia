import { Router, type IRouter } from "express";
import {
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  verifySessionToken,
  SESSION_COOKIE,
  isLocked,
  recordFailure,
  recordSuccess,
} from "../lib/auth";

const router: IRouter = Router();

// POST /api/auth/login — recebe { password } e, se acertar, entrega o crachá
router.post("/auth/login", async (req, res) => {
  const ip = req.ip ?? "unknown";

  if (isLocked(ip)) {
    res.status(429).json({ error: "too_many_attempts" });
    return;
  }

  const password =
    typeof req.body?.password === "string" ? req.body.password : "";

  if (!password || !verifyPassword(password)) {
    recordFailure(ip);
    // pequeno atraso pra desencorajar tentativa-e-erro
    await new Promise((resolve) => setTimeout(resolve, 400));
    res.status(401).json({ error: "invalid_password" });
    return;
  }

  recordSuccess(ip);
  setSessionCookie(res);
  res.json({ ok: true });
});

// POST /api/auth/logout — remove o crachá
router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me — o painel pergunta "estou logado?"
router.get("/auth/me", (req, res) => {
  res.json({ authenticated: verifySessionToken(req.cookies?.[SESSION_COOKIE]) });
});

export default router;
