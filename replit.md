# Júlia Vendedora

An AI WhatsApp sales agent that sells OdontoFlow SaaS to dentists, plus an admin panel to monitor and manage leads.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/julia-admin run dev` — run the admin panel (port 20709)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run typecheck:libs` — build lib declarations (run before leaf typechecks when libs change)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (Replit-managed)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`@workspace/api-server`, port 8080, path `/api`)
- Admin UI: React + Vite + TanStack Query (`@workspace/julia-admin`, port 20709, path `/`)
- DB: PostgreSQL + Drizzle ORM (`@workspace/db`)
- AI: OpenAI via Replit integration (`@workspace/integrations-openai-ai-server`)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec → `@workspace/api-zod`, `@workspace/api-hooks`)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle DB schemas: `leads.ts`, `lead-messages.ts`, `follow-ups.ts`
- `artifacts/api-server/src/routes/` — Express route handlers: `leads.ts`, `stats.ts`, `webhook.ts`
- `artifacts/api-server/src/lib/integrations.ts` — Evolution API (WhatsApp) + Telegram helpers
- `artifacts/api-server/src/julia-persona.ts` — Júlia's editable system prompt + follow-up templates
- `artifacts/api-server/src/lib/follow-up-scheduler.ts` — cron-style follow-up sending (every 5 min)
- `artifacts/julia-admin/src/pages/` — Dashboard, Leads list, Lead detail, Settings

## Architecture decisions

- **Contract-first API**: OpenAPI spec is the single source of truth; Orval generates React Query hooks (`@workspace/api-hooks`) and Zod schemas (`@workspace/api-zod`). Never hand-write fetch calls or schema types.
- **Orval TS2308 collision rule**: operations with BOTH path params AND query params generate `<Op>Params` in both `api.ts` and `types/` — avoid by removing query params from such ops (use path params only, or limit to one style).
- **AI brain in webhook**: `POST /api/webhook/whatsapp` receives Evolution API events, calls OpenAI with Júlia's persona, and replies via Evolution API. Cartesia voice TTS is a future add-on.
- **Follow-up scheduler**: starts on server boot, runs every 5 min, sends pending `follow_ups` rows via WhatsApp and marks them sent. Cancelled automatically if lead is closed/lost.
- **Telegram handoff alerts**: when Júlia detects a lead requesting a human, she sets `handoffRequested=true` on the lead and fires a Telegram bot message with lead details.

## Product

- **Júlia** — an AI WhatsApp persona that initiates contact with dental leads, qualifies them using a funnel (new → contacted → qualified → interested → objection → closing → closed/lost), handles objections, and schedules follow-ups.
- **Admin Panel** — real-time command center showing: dashboard KPIs (total leads, hot leads, conversion rate, handoffs pending), funnel breakdown chart, recent activity feed, searchable/filterable lead table, and per-lead conversation view with pipeline stage and notes.
- **Handoff flow** — when a lead asks for a human, Júlia flags the lead and sends a Telegram alert to the operator with all context.

## Secrets required (not yet configured)

The following secrets must be set for WhatsApp + Telegram to work:

| Secret | Purpose |
|---|---|
| `EVOLUTION_API_URL` | Evolution API base URL (e.g. `https://your-evolution.com`) |
| `EVOLUTION_API_KEY` | Evolution API global API key |
| `EVOLUTION_INSTANCE` | WhatsApp instance name in Evolution |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (from @BotFather) |
| `TELEGRAM_CHAT_ID` | Telegram chat/group ID to receive handoff alerts |
| `CARTESIA_API_KEY` | (Optional) Cartesia voice TTS |

OpenAI is already configured via Replit AI integration.

## Gotchas

- Always run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck` when any `lib/*` package changes — stale lib declarations cause false TS2305 errors.
- `stats.conversionRate` is returned as a whole integer percentage (e.g. `13` = 13%) — do NOT multiply by 100 in the frontend.
- Webhook route (`POST /api/webhook/whatsapp`) must be registered in Evolution API's webhook config pointing at `https://<your-domain>/api/webhook/whatsapp`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
