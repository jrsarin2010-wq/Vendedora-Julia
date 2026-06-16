---
name: Orval TS2308 collision
description: Orval generates duplicate <Op>Params types when an operation has both path params and query params, causing TS2308 build errors.
---

When an OpenAPI operation has BOTH path parameters (e.g. `{id}`) AND query parameters, Orval generates `<Op>Params` in two places: `api.ts` and `types/`. This causes `error TS2308: Module ... has an export and a local declaration`.

**Why:** Orval uses the same naming convention for both path-param wrappers and query-param types, so they collide.

**How to apply:** When defining OpenAPI operations that have a path parameter, do not also add query parameters. If you need filtering/pagination on a sub-resource, either use only path params or only query params, or rename one of the ops. Example fix: rename `getLeadMessages` → `listLeadMessages` and remove its `limit` query param.
