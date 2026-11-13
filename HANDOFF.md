# HANDOFF: live state and who is working on what

Shared between Claude Code and the Hermes agent so either can pick up where
the other left off. Read it at the start of every session; update it whenever
you start, pause or finish work. Rules for agents: `.hermes.md` (Hermes),
`CLAUDE.md` (Claude), full reference: `AGENTS.md`.

This is a public repository: no secrets, emails, account details or personal
notes in this file.

## How to use this file

1. **Before changing anything:** `git pull` on `main`, read "In flight" and the
   open PRs. If a row claims the files or area you need, do not edit them. Pick
   other work, or leave a note under "Notes between agents" and ask the owner.
2. **Claim your work:** add a row to "In flight" (agent, branch, area/files,
   started, status). Commit that row as the first commit on your branch so it
   shows up in your PR. If a quick claim on `main` is needed to warn the other
   agent early, keep it to that one line.
3. **While working:** keep the status cell current (`working`, `waiting on
   owner`, `CI red: <why>`, `paused: <where to resume>`).
4. **When you stop before finishing:** set status to `paused` and write under
   "Notes between agents" what is done, what is left, and the exact next step,
   so the other agent can continue the same branch.
5. **When merged and verified** (deploy, Android build, e2e-smoke, live
   `sw.js` VERSION): delete your row, add one line to "Recently shipped", and
   update "Live state".
6. A row older than 3 days with no matching open PR or branch activity is
   stale; the other agent may take the work over after noting it here.
7. Keep this file short. History lives in git and in `AGENTS.md` §11.

## Live state (update after each merge)

- Live web version: **v659** (`https://bricksvault.app/sw.js`), Android
  versionName 1.0.659. Last merge: #207 (2026-11-13).
- Android: production access on Google Play was granted 2026-11-09; the first
  production release has not been rolled out yet and waits on the owner.
  CI uploads new builds to the internal testing track only.
- Early access: Pro is unlocked for everyone (`EARLY_ACCESS_PRO = "1"` in
  `worker/wrangler.toml`); gold cosmetics stay for real buyers only.
- AI: 14-day trial, then free models (Workers AI, Groq) for every feature; BYOK
  removes limits.
- Pricing: BrickEconomy data is not used in the value model and not shown.
- Cron jobs run isolated with deadlines plus an hourly catch-up; the Admin
  console shows missed jobs and live progress.

## In flight

| Agent | Branch | Area / files | Started | Status |
|-------|--------|--------------|---------|--------|
| — | — | — | — | — |

Old draft PRs #1, #2 (scanner OCR/CLIP experiments) and #31 (public
`/healthz`) are parked; nobody is working on them. Ask the owner before
reviving or closing them.

## Waiting on the owner

- Go-ahead for the first Play production release and rollout.
- Retest shelf scan on the latest build (if it still fails, hide the Shelf
  tab).
- Pro test purchase retry; a Lifetime Pro product in Play/RevenueCat if wanted.

## Recently shipped (newest first, keep about 10)

- #207 (2026-11-13) Fixes from the deep-testing report (23 findings).
- #206 (2026-11-13) Set page always opens at the top when opened from a list.
- #205 (2026-11-13) Admin: live job progress and a concrete fix per failing job.
- #204 (2026-11-13) Admin Run now clears a failing-job alert.
- #203 (2026-11-13) AI Gateway probe shows whether the gateway token works.
- #202 (2026-11-13) PriceCharting bulk import fits D1's 100-column result cap.
- #201 (2026-11-13) Cleaner eBay asks, opt-in community prices, smooth
  freshness decay.
- #200 (2026-11-13) Discover chips meet the 44 px tap target.
- #199 (2026-11-12) Scanner accepts clear Brickognize matches from 0.60.
- #197 (2026-11-13) Admin: three false alarms removed.

## Notes between agents

_(Leave dated notes here: "2026-11-13 Claude: ..." Remove them once the
other agent has acted on them.)_
