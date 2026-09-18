# Demo Script (<3min — judges may stop at 3:00)

> Current truth (v2). v1 history: `docs/v1-retired.md`.

Target feel: product demo, not lecture. Film real artifacts on one engine; no mocks,
no special cases. Prep first: "Film prep" section below.

## 0:00–0:20 Hook (Impact + Idea)
Voiceover: “Alexa+ understands requests, but can't reach your scattered personal capabilities.”
Closing line tease: “Alexa+ understands what you want. REACH gives that intent somewhere to go.”

## 0:20–1:00 Proof 1 — browser + file (agentic, cross-domain)
* Type in `/sim`: “In Canva, find my homework design and save it on my laptop.”
* Show: plan forming → browser steps → download → evidence chain (plan + per-step trace + file path).
* Narrate one line: same engine as everything after this.

## 1:00–1:40 Proof 2 — local organize + approval beat (policy on camera)
* Type: “Find the PDF invoice in my downloads, rename it with vendor and date, put it in my tax folder, delete the old copies.”
* Show: find/rename/move running automatically → task pausing on the delete step →
  approval card quoting the exact target → Approve → done.
* This is the security story in 20 seconds: consequential actions ask, ordinary ones don't.

## 1:40–2:10 Proof 3 — application inspect + report (different domain, same engine)
* Type: “Open the spreadsheet, check which rows are missing emails, and make a report.”
* Show: app opened + data inspected + report `.docx` saved. Third unrelated goal, zero new routes.

## 2:10–2:30 Refusal beat (30 seconds, high value)
* Type something unplannable or forbidden (e.g. a system-directory read).
* Show: clean failure/denial with reason. Safe failure beats silent hang — judges notice.

## 2:30–2:55 Technical reveal + close (Tech + Impact)
Diagram: goal → planner → executor → policy → primitives → verified evidence.
“Goals, not devices. Anything authorized, nothing else.” + repo + AWS Bedrock credit.

## Film prep (do immediately before every take)

* Close Word (it locks auto-opened files) and clear `~/Documents/REACH` test files.
* Clear task history so the panel reads clean on camera: delete `server/data/tasks/*.json`
  (keep `server/data/devices/` — registration re-beats on its own, or restart the agent).
* Boot core + agent, wait ~10s for first heartbeat, confirm `/sim` devices panel shows Online.
* Canva: agent browser profile logged in once beforehand; one homework design findable.
* Film proofs in order 1→2→3, then refusal; one unbroken browser take each.

## Shot list
* [ ] `/sim` plan + trace + evidence chain (proof 1).
* [ ] Approval card → Approve → completion (proof 2).
* [ ] Report `.docx` opened on laptop (proof 3).
* [ ] Refusal with reason (refusal beat).
* [ ] Architecture overlay (reveal).
