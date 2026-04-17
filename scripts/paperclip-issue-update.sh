#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/paperclip-issue-update.sh [--issue-id ID] [--status STATUS] [--comment TEXT] [--dry-run]

Reads a multiline markdown comment from stdin when stdin is piped. This preserves
newlines when building the JSON payload for PATCH /api/issues/{issueId}.

Examples:
  scripts/paperclip-issue-update.sh --issue-id "$PAPERCLIP_TASK_ID" --status in_progress <<'MD'
  Investigating formatting

  - Pulled the raw comment body
  - Comparing it with the run transcript
  MD

  scripts/paperclip-issue-update.sh --issue-id "$PAPERCLIP_TASK_ID" --status done --dry-run <<'MD'
  Done

  - Fixed the issue update helper
  MD
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

issue_id="${PAPERCLIP_TASK_ID:-}"
status=""
comment_arg=""
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue-id)
      issue_id="${2:-}"
      shift 2
      ;;
    --status)
      status="${2:-}"
      shift 2
      ;;
    --comment)
      comment_arg="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

comment=""
if [[ -n "$comment_arg" ]]; then
  comment="$comment_arg"
elif [[ ! -t 0 ]]; then
  comment="$(cat)"
fi

require_command jq

runtime_context_file="${PAPERCLIP_RUNTIME_CONTEXT_FILE:-$PWD/.paperclip-runtime.json}"
paperclip_api_url="${PAPERCLIP_API_URL:-}"
paperclip_api_key="${PAPERCLIP_API_KEY:-}"
paperclip_run_id="${PAPERCLIP_RUN_ID:-}"

if [[ -f "$runtime_context_file" ]]; then
  if [[ -z "$issue_id" ]]; then
    issue_id="$(jq -r '.taskId // empty' "$runtime_context_file")"
  fi
  if [[ -z "$paperclip_api_url" ]]; then
    paperclip_api_url="$(jq -r '.apiBase // empty' "$runtime_context_file")"
  fi
  if [[ -z "$paperclip_api_key" ]]; then
    paperclip_api_key="$(jq -r '.apiKey // empty' "$runtime_context_file")"
  fi
  if [[ -z "$paperclip_run_id" ]]; then
    paperclip_run_id="$(jq -r '.runId // empty' "$runtime_context_file")"
  fi
fi

if [[ -z "$issue_id" ]]; then
  printf 'Missing issue id. Pass --issue-id, set PAPERCLIP_TASK_ID, or provide a runtime context file.\n' >&2
  exit 1
fi

payload="$(
  jq -nc \
    --arg status "$status" \
    --arg comment "$comment" \
    '
      (if $status == "" then {} else {status: $status} end) +
      (if $comment == "" then {} else {comment: $comment} end)
    '
)"

if [[ "$dry_run" == "1" ]]; then
  printf '%s\n' "$payload"
  exit 0
fi

if [[ -z "$paperclip_api_url" || -z "$paperclip_api_key" || -z "$paperclip_run_id" ]]; then
  printf 'Missing PAPERCLIP_API_URL, PAPERCLIP_API_KEY, or PAPERCLIP_RUN_ID.\n' >&2
  exit 1
fi

curl -sS -X PATCH \
  "$paperclip_api_url/api/issues/$issue_id" \
  -H "Authorization: Bearer $paperclip_api_key" \
  -H "X-Paperclip-Run-Id: $paperclip_run_id" \
  -H 'Content-Type: application/json' \
  --data-binary "$payload"
