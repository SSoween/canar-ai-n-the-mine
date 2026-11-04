# TASKS — canar-ai-n-the-mine (local AI side)

Read `AGENTS.md` first. Two kinds of tasks:
- **H tasks — HOST, done by the OWNER** in a terminal on the AI server (GPUs, docker, `~/ai-server`).
  The agent never runs them: it cannot reach the host (it lives in an isolated container, confirmed 2026-11-04).
- **A tasks — AGENT**, done by the AI agent in its container (git, repository, sources, reviews).

The agent works only on the **first A task with status `ready`**.
Statuses: `todo` (not yet allowed) · `ready` (do it now) · `done` · `blocked` · `recurring` (only when the owner asks).
Only the owner changes a status from `todo` to `ready`. The agent may propose `ready` → `done`/`blocked` as a diff.

| ID | Who | Task | Status |
|---|---|---|---|
| A1 | agent | Repository hygiene (was T2) | done (2026-11-04, commit `ad0995c`) |
| H1 | owner | Host setup with `janus/setup_host.sh` | ready |
| H2 | owner | First local report on the host, NOT published | todo |
| H3 | owner | Daily schedule (cron) on the host | todo |
| A2 | agent | Review a local report produced by H2 | todo |
| A3 | agent | Diagnose a failed or odd run (from `run.log` pasted by the owner) | recurring |
| A4 | agent | Monthly review | recurring |
| B1–B5 | — | Backlog (improvements) | todo |

History: the former T1 ("initial setup") was run by the agent inside its container, so nothing was installed on the host.
It is replaced by H1. The agent's container keeps its own clone and its own deploy key (git only).

---

## H1 — Host setup · owner · ready
In a terminal on the AI server (not in the agent's chat):
```bash
curl -fsSLO https://raw.githubusercontent.com/SSoween/canar-ai-n-the-mine/main/janus/setup_host.sh
bash setup_host.sh
```
The script checks prerequisites, then asks before each change:
1. host deploy key `~/.ssh/canar_deploy_host` (add it in GitHub → Deploy keys, title "Janus host", write access);
2. clone `~/canar-ai-n-the-mine`; 3. `.venv` with jsonschema; 4. `~/.config/canar/env`;
5. "canari" mode: updated `~/ai-server/switch_mode.sh` (backup kept) and `~/ai-server/compose/canari.yml`
   (copy of `llama-server.yml`, then edit 4 lines: both GPUs, `-c 32768`, `-np 1`, `--tensor-split 1,1`);
6. test: switch to canari, read the model id, structured-output test, restore the previous mode.
**Done when:** the script ends with "Sortie JSON structurée : OK" and the previous mode restored.

## H2 — First local report, NOT published · owner · todo
On the host, when dev-long is not needed (the GPUs switch to canari for the whole run):
```bash
source ~/.config/canar/env && cd ~/canar-ai-n-the-mine/janus
NO_PUBLISH=1 PATH=$HOME/canar-ai-n-the-mine/.venv/bin:$PATH ./run_canari.sh 2>&1 | tee h2.log
```
`run_canari.sh` restores the previous mode at the end, even after a failure. With `NO_PUBLISH=1`, the report is
validated but not written to `data/` nor pushed. Note the duration printed at the end.
**Done when:** `h2.log` ends with "Rapport valide" and the duration is known. Then give `h2.log` and
`janus/out/<date>.json` to the agent (A2) or to Claude for review.

## H3 — Daily schedule · owner · todo
After A2 says the local report is good enough. `crontab -e`, then add (daily at 05:40):
```
40 5 * * * . $HOME/.config/canar/env && cd $HOME/canar-ai-n-the-mine && git pull -q && cd janus && PATH=$HOME/canar-ai-n-the-mine/.venv/bin:$PATH ./run_canari.sh >> run.log 2>&1
```
If H2 took more than 3 hours, decide first whether 05:40 still leaves the report ready by morning.
`touch ~/.canari-pause` skips a day; `rm ~/.canari-pause` resumes.
**Done when:** the next morning, a new `data/<date>.json` appears on GitHub and in the PWA.

---

## A2 — Review a local report · agent · todo
Input: `h2.log` and `out/<date>.json` pasted (or committed to a `review/` folder) by the owner.
Check and report with numbers: validity (publish.py), `generator` (must be the Qwen model, not the chat model),
facts per domain and share of "bruit", whether each scenario justification cites `[n]`, every `[n]` maps to a real
source, notes or probabilities changed versus the latest `data/` report without a new fact (stability),
durations per step. Recommend: ready for H3, or what to fix first. Change nothing.

## A3 — Diagnose a failed or odd run · agent · recurring
Input: the last 200 lines of `janus/run.log`, pasted by the owner. Report: failing step (fetch / extract /
synthesize / validate / git push), cause, smallest fix. Never bypass validation, never hand-edit a report.
If a source keeps failing, propose a replacement from the same institution, test it with `fetch_sources.py`
(this works in the container), and show the `sources.json` change (append at the end only).

## A4 — Monthly review · agent · recurring
Using the reports in `data/` (and `run.log` excerpts pasted by the owner): facts per domain over 30 days,
days where a note or a probability changed without a new top change (drift), share of juste / faux / indetermine
for hypotheses whose `eval_date` has passed, sources that keep failing. Suggest at most 3 changes. Apply nothing.

---

## Backlog · todo (the owner decides what becomes `ready`)
- **B1** Log real token counts (`usage`) and duration per step in `run.log`; add `JANUS_MAX_TOKENS` to avoid truncated output.
- **B2** Use a faster model for extraction and keep Qwen 27B for synthesis (two modes or two endpoints).
- **B3** Send only what changed in each source since the previous snapshot (estimated ~175k → 30–60k input tokens/day).
- **B4** Find the INSPQ "Nouvelles publications" RSS feed URL and replace `inspq-presse` (agent can test it in the container).
- **B5** Host, read-only: `dev-long` and `dev-split` both start `bonsai-split.yml`; find where the 128K context is set.
