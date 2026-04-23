# ACENT Fork — upstream divergence notes

This repository is a fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip).
Upstream stays the source of truth for core platform functionality. This document
tracks **what ACENT adds, changes, or withholds**, and **why** — so future upstream
syncs can reconcile intent, not just text.

Keep this file updated every time a new customization lands on `master`.

---

## Sync protocol

1. `git fetch upstream`
2. `git diff acent-sync/upstream-<last>..upstream/master` — see what's new upstream since our last sync.
3. Create `sync/upstream-YYYY-MM-DD` branch from `master`.
4. `git merge upstream/master` on that branch. Resolve conflicts.
5. Run `pnpm install && pnpm -r build && pnpm -r test`.
6. Also run plugin builds explicitly:
   - `pnpm --filter paperclip-social-reader build`
   - `pnpm --filter paperclip-linkedin-reader build`
7. Push sync branch, open PR into `master`, review, merge.
8. Tag new baseline: `git tag acent-sync/upstream-YYYY-MM-DD upstream/master && git push origin acent-sync/upstream-YYYY-MM-DD`.

### Baseline tags
- `acent-sync/upstream-2026-04-19` — previous sync baseline (merge commit `23c8eb06`).
- `acent-sync/upstream-2026-04-23` — current target baseline.

Cadence goal: **bi-weekly**. 30+ commits behind upstream is the warning zone; 100+ is the danger zone.

---

## What ACENT adds (new files — low merge risk)

| Area | Path | Purpose |
|---|---|---|
| Plugin | `packages/plugins/examples/plugin-social-reader/` | X (Twitter) connector with OAuth 2.0 PKCE + OAuth 1.0a. **Read and write** — posts, profile, search, followers, mentions. 8 tools registered. |
| Plugin | `packages/plugins/examples/plugin-linkedin-reader/` | LinkedIn connector with OAuth 2.0. Read and write — create/delete posts, profile, reactions. 6 tools registered. |
| Docs | `companies/acent/` | ACENT company metadata and briefs. Paperclip-managed company root. |
| Docs | `docs/handover.md` | Operator handover doc for ACENT-specific runtime setup. |

**Rule:** new customizations should default to this category — new files, isolated directories. They survive upstream syncs unchanged.

---

## What ACENT modifies (upstream files — merge risk)

| File | Change | Reason | Path to remove |
|---|---|---|---|
| `server/src/routes/issues.ts` | Deliverables X publish-on-approve, work-product markdown extraction, pagination offset | Command Center deliverables workflow for ACENT content pipeline | Move logic into a plugin via `plugin.orchestration` host APIs (#4114) |
| `server/src/services/work-products.ts` | Minor extension for deliverable publish flow | Same as above | Same as above |
| `ui/src/pages/CommandCenter.tsx` | Deliverables tab pagination (page size 6) | ACENT deliverables volume | Keep as UI customization — upstream is unlikely to add this exact feature |
| `ui/src/components/DeliverablesPanel.tsx` | "Approve & Publish" button variant for X deliverables | Paired with server route change | Same as above |
| `ui/src/components/ui/button.tsx`, `tabs.tsx` | `cursor-pointer` added to class lists | UI polish | **Send back upstream as PR** — generic UX improvement |
| `skills/paperclip/SKILL.md` | Deliverable registration guidance | ACENT operator workflow | Keep — this is agent-facing documentation |
| `docs/api/issues.md` | Publish-on-approve API note | Doc for our route extension | Move with the route if plugin-ified |
| `ui/src/api/issues.ts` | Adds `offset` param to deliverables list call | Paired with pagination | Keep |
| `server/src/__tests__/issue-deliverables-routes.test.ts` | Test coverage for above | Pair with server change | Paired |

### Merge-risk priority

**High** — review these every sync:
- `server/src/routes/issues.ts` (upstream touches this regularly)
- `ui/src/pages/CommandCenter.tsx`

**Medium** — review when upstream touches deliverables/work-products:
- `server/src/services/work-products.ts`
- `ui/src/components/DeliverablesPanel.tsx`

**Low** — usually clean:
- `ui/src/components/ui/button.tsx`, `tabs.tsx` (only if upstream rewrites these primitives)
- docs and SKILL.md

---

## What ACENT decides to withhold

- **Authenticated deployment mode as default.** Local dev stays in `local_trusted`; `authenticated` mode is a future flip.
- **No upstream-first OpenClaw changes yet.** `fix(openclaw-gateway): remove paperclip property regression` is ACENT-local until we reproduce the bug upstream.

---

## Upstream-first candidates (PR back when possible)

These ACENT-local changes are **generic improvements** that belong upstream. Sending them back **permanently removes them from our fork diff**:

| Commit | Why it's upstream-worthy |
|---|---|
| `b99c7d20` fix: preserve full issue descriptions in exports | Bug, not ACENT-specific |
| `72cb04f6` fix(ui): set ignoreDeprecations to 5.0 (TS 5.x compatible) | Generic compatibility fix |
| `0cd64d22` fix(openclaw-gateway): remove paperclip property from agent params | Regression fix, not ACENT-specific (probably) |
| `ui/src/components/ui/button.tsx, tabs.tsx` | `cursor-pointer` UX polish |

**Action:** after each sync, pick one of these and open an upstream PR. Target: one PR/month sent upstream, reducing fork diff permanently.

---

## Customization design rules

When adding new functionality, follow this hierarchy (most preferred → least):

1. **New plugin under `packages/plugins/examples/`** — survives syncs unchanged.
2. **New skill under `skills/`** — agent-facing, low-friction.
3. **New file in existing upstream directory** — moderate risk; survives if filename doesn't collide.
4. **Modification of existing upstream file** — last resort. Document here. Add comment `// ACENT: <reason>` at the modification site for grep-ability.

**Never**: add `if (process.env.ACENT_MODE)` style branching in core files. It compounds merge pain indefinitely.

---

## Plugin SDK alignment (post #4114)

Upstream PR #4114 introduced plugin orchestration host APIs, plugin-scoped
database namespaces, and a stricter capability validator. Our two plugins
(`social-reader`, `linkedin-reader`) should migrate incrementally:

- [ ] OAuth token storage → `PluginDatabaseClient` namespaced tables (currently stored in plugin state blob).
- [ ] Audit that declared `capabilities` in manifests match upstream's validator allow-list.
- [ ] Adopt new `PluginIssueRelationsClient` / approval-summary types where relevant.

---

## Contact

Fork maintainer: alan@acent.com
Upstream tracker: [paperclipai/paperclip](https://github.com/paperclipai/paperclip)
