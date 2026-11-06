#!/usr/bin/env bash
# Shared helpers for the Deploy Brickvault workflow's remote D1 steps.
# Source it from a step running in worker/:  source scripts/d1-remote.sh
#
# Why this exists: the deploy used to fire ~400 sequential `wrangler d1
# execute` calls per run (one ALTER per migration line, then one PRAGMA per
# migration line to validate). While the live app and its crons were also
# using the DB, D1 answered some of them with "D1 DB is overloaded ... [code:
# 7429]", which no step retried, so single merges failed and only went live
# with the next merge. Now the deploy reads every column in ONE query, only
# ALTERs columns that are actually missing (normally none), and every remote
# call retries D1's transient errors with backoff.

D1_DB_NAME="${D1_DB_NAME:-brickvault}"
# Transient answers worth retrying: D1 overload/rate limits, internal errors,
# dropped connections and gateway errors.
D1_TRANSIENT_RE='overloaded|code: 7429|code: 429|too many requests|rate limit|internal error|timed out|timeout|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network connection lost|bad gateway|service unavailable|gateway time-?out|code: 50[234]'

_d1_tmp="${RUNNER_TEMP:-/tmp}"

# d1_exec <wrangler d1 execute args...>
# Runs `wrangler d1 execute <db> --remote <args>` with up to 6 attempts on
# transient errors (5s, 10s, 15s... backoff). Prints stdout on success; on
# failure prints stdout+stderr (wrangler's D1 error text, no credentials) and
# returns 1.
d1_exec() {
  local attempt out="$_d1_tmp/d1-out.$$" err="$_d1_tmp/d1-err.$$"
  for attempt in 1 2 3 4 5 6; do
    if npx wrangler d1 execute "$D1_DB_NAME" --remote "$@" >"$out" 2>"$err"; then
      cat "$out"; rm -f "$out" "$err"; return 0
    fi
    if ! cat "$out" "$err" | grep -qiE "$D1_TRANSIENT_RE"; then
      break
    fi
    if [ "$attempt" -lt 6 ]; then
      echo "Transient D1 error (attempt ${attempt}/6), retrying in $((attempt * 5))s: $(cat "$out" "$err" | grep -m1 -oiE "$D1_TRANSIENT_RE" | head -n1)" >&2
      sleep $((attempt * 5))
    fi
  done
  cat "$out" "$err"; rm -f "$out" "$err"; return 1
}

# d1_columns: prints every "table.column" in the remote DB, one per line,
# from a single query (~3 ms of D1 time, ~1k rows read).
d1_columns() {
  local json
  json=$(d1_exec --json --command "SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND substr(m.name, 1, 7) <> 'sqlite_' AND substr(m.name, 1, 4) <> '_cf_'") || {
    printf '%s\n' "$json" >&2; return 1
  }
  jq -r '(if type == "array" then .[0] else . end).results[] | "\(.t).\(.c)"' <<< "$json" | sort -u
}

# migration_lines: every single-line additive migration in schema_migrate.sql.
migration_lines() {
  grep -E '^[[:space:]]*ALTER TABLE .+ ADD COLUMN' schema_migrate.sql
}

# parse_migration <sql>: sets MIG_TABLE / MIG_COLUMN, fails on odd syntax.
parse_migration() {
  local re='^[[:space:]]*ALTER[[:space:]]+TABLE[[:space:]]+([a-zA-Z_][a-zA-Z_0-9]*)[[:space:]]+ADD[[:space:]]+COLUMN[[:space:]]+([a-zA-Z_][a-zA-Z_0-9]*)[[:space:];]'
  if [[ ! "$1" =~ $re ]]; then
    echo "::error::Unexpected migration syntax: $1" >&2; return 1
  fi
  MIG_TABLE="${BASH_REMATCH[1]}" MIG_COLUMN="${BASH_REMATCH[2]}"
}
