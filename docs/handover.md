# ACENT Paperclip Operating Handoff

This is the ACENT-owned handoff for new AI sessions working in this checkout.
Read it before treating Paperclip work as ordinary product documentation or
before turning strategy discussion into implementation.

## 1. Folder Boundary

- `docs/` is the ACENT-owned documentation and continuity layer for this fork.
- If a `doc/` folder exists, treat it as upstream/imported reference material unless
  the user explicitly says to edit it.
- Keep durable local operating context in `docs/`, not scattered through chat.

## 2. What Paperclip Means Here

Paperclip is ACENT's internal company operating system and control plane. It is
not automatically customer-facing ACENT messaging.

The useful mental model is:

```text
Founder / board operator
  -> Paperclip CEO
  -> CMO / CTO / CSO / CRO
  -> Directors / analysts / writers / workers
  -> final artifacts
```

When the user discusses "telling the CEO" or "giving a directive," they usually
mean a top-level instruction for the Paperclip CEO agent, so the CEO can delegate
work down the org chart.

## 3. Default Delegation Pattern

Default to CEO-mediated delegation.

- Route broad business, narrative, launch, or operating-system work through the
  Paperclip CEO first.
- Let the CEO split work to CMO, CTO, CSO/CRO, directors, writers, and workers.
- Do not jump straight from founder intent to a specialist agent unless the user
  explicitly asks for that.
- Do not expose internal tools such as Paperclip, Hermes, MCP, or adapter names
  in customer-facing ACENT copy unless the user explicitly requests it.
- Treat org roles and adapters as separate concepts: the Paperclip org owns
  responsibility, reporting, and approval; adapters are the runtime tools used
  by those agents to execute.

## 4. Adapter And Runtime Role Map

Use this map when the user asks where a worker should live or which adapter
should own a task.

- Paperclip is the company operating/control plane. It owns agents, hierarchy,
  projects, issues, routines, approvals, budgets, and audit trail.
- Codex/Claude/Gemini-style agents are Paperclip employees when registered in
  the org. Writers, analysts, directors, and code workers should usually live in
  Paperclip, even if their runtime adapter is Codex, Claude, Gemini, or another
  tool.
- Codex now has Monday MCP access in this operating environment. Use it for
  technical investigation, implementation context, CRM integration checks, and
  cross-system validation when a Codex worker is the right executor.
- Hermes RevOps is the default Monday CRM operating owner. Hermes owns CRM write
  hygiene, pipeline records, RevOps reporting, and Paperclip-to-Monday alignment
  unless the founder explicitly reassigns that ownership.
- OpenClaw is an action/runtime operator, not the owner of narrative, code, or
  CRM strategy. Use OpenClaw for browser control, external SaaS/UI actions,
  publishing assistance, screenshots, visual QA, and other "act on the outside
  world" tasks.
- When OpenClaw Gateway and Paperclip run on the same machine, configure the
  OpenClaw agent's `paperclipApiUrl` as the local Paperclip base URL
  (`http://127.0.0.1:3100` in default dev), not a tailnet/public hostname that
  the OpenClaw runtime may fail to resolve.

Practical examples:

- Homepage copy, sales deck copy, X/LinkedIn drafts: Paperclip Content Director
  and writers own the work; OpenClaw may publish or visually verify outputs.
- Product code, AX delivery code, integration fixes: CTO/engineering directors
  and Codex/Claude workers own the work; OpenClaw may run browser checks.
- Monday CRM updates, lead/deal hygiene, revenue reports: CRO/Hermes RevOps owns
  the work. Codex can inspect Monday MCP context when engineering or integration
  work needs it, but should not silently become the CRM operating owner.

## 5. Work Modes

Use these modes to avoid accidental overreach:

- `review`: inspect, diagnose, and report. Do not edit files, create issues, wake
  agents, or change live state unless explicitly approved.
- `planning`: produce plans, directives, acceptance criteria, work breakdowns,
  or handoff docs. Do not start implementation.
- `implementation`: edit code/docs, create issues, update live Paperclip state,
  wake workers, commit, push, or deploy only when the user clearly authorizes it.

If the mode is unclear, stay in review/planning and ask one concise clarifying
question before taking irreversible or live actions.

## 6. CEO Directive Format

When the user asks for a Paperclip CEO instruction, produce a copyable directive,
not a vague memo. Include:

- Purpose
- Background and context
- Locked assumptions
- Target audience or target workflow
- Required deliverables
- Role split for CMO, CTO, CSO/CRO, Brand, Growth, Content, Writer, or worker
  agents as relevant
- Acceptance criteria
- Founder decision points
- Explicit non-goals and forbidden moves

The CEO directive should be strong enough that the CEO can create downstream
issues or assignments without reinterpreting the user's intent from scratch.

## 7. Narrative And Content Work Pattern

For ACENT narrative, AX, sales, or homepage work, default to this sequence unless
the user asks for a different order:

```text
briefing document
  -> social content tests
  -> sales deck
  -> homepage / AX page content
```

The first deliverable is often a CEO-ready directive or briefing source document,
not final public copy. The purpose is to align the internal agent team before
turning language into market-facing assets.

Core narrative guardrail:

- ACENT should not lead with fear-based "AI replaces people" messaging.
- ACENT should frame AI adoption as role redesign, workflow redesign, and
  human-plus-agent operating structure.
- "Why" comes before "what tool": explain why the organization is changing
  before describing specific tools or artifacts.

## 8. Live State Rule

Repo docs are not the source of truth for the current live Paperclip company.
Before acting on agents, org structure, projects, issues, routines, permissions,
or adapter settings, re-check the active Paperclip instance under the user's
current configuration, often under `~/.paperclip`.

Do not assume older notes are current. Live org membership, issue state,
OAuth/auth state, schedules, and worker runs can drift.

## 9. Practical Guardrails

- Do not treat a strategy conversation as permission to create implementation
  issues or start workers.
- If work is discussion-only, say clearly that no files or live state changed.
- If files or live Paperclip state changed, summarize exactly what changed and
  how it was verified.
- Prefer one durable handoff doc over many overlapping notes. Add new docs only
  when they reduce future confusion.
