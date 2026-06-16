---
name: Lib build order for typechecking
description: Must run typecheck:libs before leaf artifact typechecks when any lib/* package changes, or stale declarations cause false TS2305 errors.
---

When any package under `lib/` changes (schema, integrations, api-zod, api-hooks, etc.), TypeScript declarations are not automatically rebuilt for consumers.

**Why:** Lib packages are composite (emit declarations); leaf artifacts reference their `.d.ts` output. If stale, tsc reports false "has no exported member" TS2305 errors that disappear after rebuilding.

**How to apply:** Always run `pnpm run typecheck:libs` before `pnpm --filter @workspace/<artifact> run typecheck` when lib/* files were edited. The root `pnpm run typecheck` already does this in the correct order.
