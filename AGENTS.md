# AGENTS.md

Guidance for human and AI contributors working in this repository.

## 1. Purpose

Paperclip is a control plane for autonomous AI companies.
This repository is the product itself: board UI, REST API/orchestration layer, database schema, built-in adapters, plugin infrastructure, CLI, and local-dev tooling.
The current implementation target is V1 and is defined in `docs/reference/SPEC-implementation.md`.

## 2. Product Model In 60 Seconds

Keep this mental model in mind before touching code:

- A **company** is the primary boundary. Core entities are company-scoped and cross-company access is a bug.
- The **board operator** manages company goals, projects, issues, approvals, budgets, routines, and interventions.
- **Agents are employees**, connected through adapters. Paperclip orchestrates them; it does not replace their runtime.
- **Goals -> projects -> issues -> comments** are the built-in work and communication substrate.
- **Heartbeats, routines, and activity logs** are how work gets triggered, monitored, and audited.
- **Costs, approvals, and governance controls** are first-class product features, not afterthoughts.

## 3. Read This First

Before making changes, read in this order:

1. `docs/reference/GOAL.md`
2. `docs/reference/PRODUCT.md`
3. `docs/reference/SPEC-implementation.md`
4. `docs/reference/DEVELOPING.md`
5. `docs/reference/DATABASE.md`

`docs/reference/SPEC.md` is long-horizon product context.
`docs/reference/SPEC-implementation.md` is the concrete V1 build contract.

## 4. What Exists In This Repo Today

Current top-level product surface in code:

- `server/src/routes/` exposes company, agent, goal, project, issue, approval, cost, routine, plugin, adapter, secrets, access, and dashboard APIs.
- `ui/src/pages/` contains board views for dashboard, companies, org chart, agents, issues, approvals, routines, costs, plugin manager, adapter manager, and settings.
- `packages/adapters/` ships built-in adapters for Claude Code, Codex, Cursor, Gemini CLI, Hermes, OpenCode, Pi, and OpenClaw gateway.
- `packages/plugins/` contains the plugin SDK, scaffolding, and example plugins for extending the control plane.
- `cli/` and `scripts/` contain onboarding, dev-runner, worktree, release, backup, and operational commands.

## 5. Repo Map

- `server/`: Express REST API and orchestration services
- `ui/`: React + Vite board UI
- `packages/db/`: Drizzle schema, migrations, DB clients
- `packages/shared/`: shared types, constants, validators, API path constants
- `packages/adapters/`: agent adapter implementations (Claude, Codex, Cursor, etc.)
- `packages/adapter-utils/`: shared adapter utilities
- `packages/plugins/`: plugin system packages
- `docs/reference/`: operational and product docs

## 6. Dev Setup (Auto DB)

Use embedded PostgreSQL in dev by leaving `DATABASE_URL` unset.

```sh
pnpm install
pnpm dev
```

This starts:

- API: `http://localhost:3100`
- UI: `http://localhost:3100` (served by API server in dev middleware mode)

Quick checks:

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

Reset local dev DB:

```sh
rm -rf ~/.paperclip/instances/default/db
pnpm dev
```

If this repo has a worktree-local `.paperclip/.env`, Paperclip commands target that repo-local instance instead of the default `~/.paperclip/instances/default` path.

## 7. Core Engineering Rules

1. Keep changes company-scoped.
Every domain entity should be scoped to a company and company boundaries must be enforced in routes/services.

2. Keep contracts synchronized.
If you change schema/API behavior, update all impacted layers:
- `packages/db` schema and exports
- `packages/shared` types/constants/validators
- `server` routes/services
- `ui` API clients and pages

3. Preserve control-plane invariants.
- Single-assignee task model
- Atomic issue checkout semantics
- Approval gates for governed actions
- Budget hard-stop auto-pause behavior
- Activity logging for mutating actions

4. Do not replace strategic docs wholesale unless asked.
Prefer additive updates. Keep `docs/reference/SPEC.md` and `docs/reference/SPEC-implementation.md` aligned.

5. Keep repo plan docs dated and centralized.
When you are creating a plan file in the repository itself, new plan documents belong in `docs/reference/plans/` and should use `YYYY-MM-DD-slug.md` filenames. This does not replace Paperclip issue planning: if a Paperclip issue asks for a plan, update the issue `plan` document per the `paperclip` skill instead of creating a repo markdown file.

## 8. Database Change Workflow

When changing data model:

1. Edit `packages/db/src/schema/*.ts`
2. Ensure new tables are exported from `packages/db/src/schema/index.ts`
3. Generate migration:

```sh
pnpm db:generate
```

4. Validate compile:

```sh
pnpm -r typecheck
```

Notes:
- `packages/db/drizzle.config.ts` reads compiled schema from `dist/schema/*.js`
- `pnpm db:generate` compiles `packages/db` first

## 9. Verification Before Hand-off

Run this full check before claiming done:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

If anything cannot be run, explicitly report what was not run and why.

## 10. API and Auth Expectations

- Base path: `/api`
- Board access is treated as full-control operator context
- Agent access uses bearer API keys (`agent_api_keys`), hashed at rest
- Agent keys must not access other companies

When adding endpoints:

- apply company access checks
- enforce actor permissions (board vs agent)
- write activity log entries for mutations
- return consistent HTTP errors (`400/401/403/404/409/422/500`)

## 11. UI Expectations

- Keep routes and nav aligned with available API surface
- Use company selection context for company-scoped pages
- Surface failures clearly; do not silently ignore API errors

## 12. Pull Request Requirements

When creating a pull request (via `gh pr create` or any other method), you **must** read and fill in every section of [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md). Do not craft ad-hoc PR bodies — use the template as the structure for your PR description. Required sections:

- **Thinking Path** — trace reasoning from project context to this change (see `CONTRIBUTING.md` for examples)
- **What Changed** — bullet list of concrete changes
- **Verification** — how a reviewer can confirm it works
- **Risks** — what could go wrong
- **Model Used** — the AI model that produced or assisted with the change (provider, exact model ID, context window, capabilities). Write "None — human-authored" if no AI was used.
- **Checklist** — all items checked

## 13. Definition of Done

A change is done when all are true:

1. Behavior matches `docs/reference/SPEC-implementation.md`
2. Typecheck, tests, and build pass
3. Contracts are synced across db/shared/server/ui
4. Docs updated when behavior or commands change
5. PR description follows the [PR template](.github/PULL_REQUEST_TEMPLATE.md) with all sections filled in (including Model Used)

## 14. Fork-Specific Notes

This checkout is `acent-labs/acent-ops`. The configured upstream remote is `paperclipai/paperclip`.
Assume fork-specific patches may exist even when older docs, screenshots, or branches say otherwise.

Important current facts from this repo:

- `hermes_local` is currently a built-in adapter in both server and UI code. Do not assume an external-only Hermes model.
- External adapter packages are still supported via `~/.paperclip/adapter-plugins.json`.
- Built-in adapter types currently include `claude_local`, `codex_local`, `cursor`, `gemini_local`, `hermes_local`, `opencode_local`, `pi_local`, `openclaw_gateway`, `process`, and `http`.
- When changing adapter plumbing, preserve optional adapter fields such as `detectModel`.

If you are reconciling upstream or another fork with this checkout, trust the current code and current remotes over stale branch-specific notes.
