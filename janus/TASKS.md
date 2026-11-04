# TASKS — canar-ai-n-the-mine (local AI side)

Read `AGENTS.md` first. Work only on the **first task with status `ready`**.
Statuses: `todo` (not yet allowed) · `ready` (do it now) · `done` · `blocked` · `recurring` (only when the owner asks).
Only the owner changes a status from `todo` to `ready`. The agent may propose `ready` → `done`/`blocked` as a diff.

| ID | Task | Status |
|---|---|---|
| T1 | Initial setup on the server | done (steps 1–8; report not reviewed yet) |
| T2 | Repository hygiene | done |
| T3 | First local report, NOT published | ready |
| T4 | Publish and schedule the daily run | todo |
| T5 | Diagnose a failed or odd run | recurring |
| T6 | Monthly review | recurring |
| B1–B5 | Backlog (improvements) | todo |

Repository state checked on 2026-11-02 (commit `6dfcdc1`): code, prompts, sources (39), PWA (sw.js v9),
`data/2026-10-30.json` and `data/2026-11-02.json` are up to date. Issues found are listed in T2.

---

## T1 — Initial setup on the server · done
Clone, venv with jsonschema, `.gitignore`, `~/.config/canar/env`, "canari" mode (`switch_mode.sh` + `canari.yml`),
structured-output test, first `fetch_sources.py` run, deploy key.
**Open point:** the owner has not reviewed the T1 report yet. T3 step 1 re-checks the critical items.

---

## T2 — Repository hygiene · ready
Goal: remove duplicates and obsolete files, and make scripts executable in git.
1. `git pull`, then show `git status` and `git ls-files` for the paths below.
2. Propose (show the exact commands, wait for OK) to remove from git:
   - root duplicates: `PROMPTS-JANUS.md`, `run_canari.sh`, `switch_mode.sh`, `canari.yml`
     (the real copies are `janus/run_canari.sh`, `serveur/switch_mode.sh`, `serveur/canari.yml`);
   - obsolete: `janus/PROMPTS-JANUS.md` (replaced by this file) and `prompt-json.md` (old cloud-AI prompt);
   - committed bytecode: `janus/__pycache__/` (use `git rm -r --cached`, it is already in `.gitignore`).
3. Set the execute bit in git: `git update-index --chmod=+x janus/*.sh janus/*.py serveur/switch_mode.sh`.
4. Show `git diff --cached --stat`, wait for OK, then commit "Repo hygiene" and push.
**Done when:** `git ls-files` shows none of the removed files, the scripts are mode 100755, push succeeded.

---

## T3 — First local report, NOT published · ready
Goal: prove the local model produces a valid, sourced, stable report, and measure how long it takes.
1. Pre-checks (stop and report if one fails):
   - `~/.config/canar/env` exists with `JANUS_ENDPOINT=http://127.0.0.1:8080/v1`, `JANUS_CTX_CHARS=60000`,
     `FREQ="quotidien"`, `JANUS_MODEL` filled;
   - `.venv` has jsonschema; `~/ai-server/compose/canari.yml` exists.
2. Note the current mode (`switch_mode.sh current`), then `switch_mode.sh canari`; report VRAM per GPU.
3. Re-test structured output once (small `json_schema` request returning `{"ok": true}`). If it fails, restore the mode and stop.
4. Today's snapshot: run `fetch_sources.py` if `snapshots/<today>/` does not exist. Report OK/FAIL per source.
5. `time` the generation with `--prev ../data/2026-11-02.json` (latest published report), then
   `publish.py --check-only`.
6. ALWAYS restore the previous mode at the end, even after a failure.
**Report:** duration of fetch / extraction / synthesis / total; facts per domain and how many were "bruit";
alert level and top changes; whether each scenario justification cites `[n]`; every validation error or warning;
domains whose note changed versus 2026-11-02 without a new fact (stability problem).
**Do not publish, do not edit the report.**
**Done when:** the report validates (or the blocking cause is identified) and durations are known.

---

## T4 — Publish and schedule the daily run · todo
(The owner sets it to `ready` after reviewing T3.)
1. If the T3 report validated: `publish.py out/<date>.json --repo .. --git`.
2. Propose (show it, wait for OK) a user crontab line, daily at 05:40:
   `40 5 * * * . $HOME/.config/canar/env && cd $HOME/canar-ai-n-the-mine && git pull -q && cd janus && PATH=$HOME/canar-ai-n-the-mine/.venv/bin:$PATH ./run_canari.sh >> run.log 2>&1`
3. If one T3 run took more than 3 hours, say so before installing it.
4. Rotate `janus/run.log` (keep 30 days) without sudo. Remind the owner: `touch ~/.canari-pause` skips a day.
5. Propose (do not install) a way to notice a failed run.
**Done when:** the cron line is installed and the next morning's run has published a report.

---

## T5 — Diagnose a failed or odd run · recurring
Read the last 200 lines of `janus/run.log`. Report: failing step (fetch / extract / synthesize / validate / git push),
the cause, and the smallest fix. Never bypass validation, never hand-edit a report, never force-push.
If a source keeps failing, propose a replacement from the same institution, test it, and show the
`sources.json` change (append at the end only).

## T6 — Monthly review · recurring
Over the last 30 days: sources failing in more than 20% of snapshots; facts per domain (flag domains under 10);
days where a domain note or a probability changed without a new top change (drift); share of
juste / faux / indetermine for hypotheses whose `eval_date` has passed. Suggest at most 3 changes. Apply nothing.

---

## Backlog · todo (the owner decides what becomes `ready`)
- **B1** Log real token counts (`usage`) and duration per step in `run.log`; add `JANUS_MAX_TOKENS` to avoid truncated output.
- **B2** Use a faster model for extraction and keep Qwen 27B for synthesis (two modes or two endpoints).
- **B3** Send only what changed in each source since the previous snapshot (estimated ~175k → 30–60k input tokens/day).
- **B4** Find the INSPQ "Nouvelles publications" RSS feed URL and replace `inspq-presse` (append, do not reorder).
- **B5** Read-only check: `dev-long` and `dev-split` both start `bonsai-split.yml`; find where the 128K context is set.
