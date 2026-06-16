import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Falha rápido se o banco não responder, em vez de pendurar a requisição.
  connectionTimeoutMillis: 10_000,
});

// "Vigia" da piscina de conexões: sem este ouvinte, um erro num cliente
// ocioso (ex.: o banco piscou) seria tratado como erro não capturado e
// DERRUBARIA o processo inteiro. Com ele, o erro é só registrado e o
// servidor continua de pé.
pool.on("error", (err) => {
  console.error(
    "[db] erro inesperado num cliente ocioso da pool (servidor segue de pé):",
    err.message,
  );
});

export const db = drizzle(pool, { schema });

export * from "./schema";
