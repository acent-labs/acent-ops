# Docs Map

Paperclip documentation is now consolidated under a single `docs/` tree.

Use this page to find the right depth quickly:

- **Product/User docs**: practical guides for operators and developers
- **Reference docs**: implementation contracts, deep specs, plans, and historical design material

## Start here (most readers)

- `handover.md` — ACENT-specific operating context for this fork
- `start/quickstart.md`
- `start/core-concepts.md`
- `start/architecture.md`

Note: `docs/` is ACENT-owned. If a `doc/` folder exists in this checkout, treat
it as upstream/imported reference material unless the user explicitly asks to
edit it.

## Product and operator documentation

- `guides/` — board operator and agent developer guides
- `deploy/` — deployment and environment setup
- `api/` — REST API docs
- `cli/` — CLI docs
- `adapters/` — built-in and external adapter docs

## Deep reference (maintainers / advanced contributors)

- `reference/README.md`
- `reference/SPEC-implementation.md`
- `reference/SPEC.md`
- `reference/PRODUCT.md`
- `reference/GOAL.md`
- `reference/DEVELOPING.md`
- `reference/DATABASE.md`

Note: `docs/reference/plans/` contains historical planning artifacts and is kept as archival reference (not front-and-center in docs navigation).

## About overlapping topics

Some topics intentionally exist in two forms:

- `docs/deploy/*`: concise operational guides
- `docs/reference/*`: deeper implementation or maintainer references

If you're unsure, start in `deploy/` and jump to `reference/` when you need full internals.
