# Demo Script (<3min — judges may stop at 3:00)

> One engine, three beats, one refusal. Sim is the demo client (the Alexa+
> toolkit is partner-gated — **no live Alexa+ is claimed**; the video says so).
> Every beat runs on the same planner → executor → policy → primitives pipeline.
> No mocks, no bespoke routing, no special cases.

Target feel: product demo, not lecture. Film real artifacts on one machine.

## The beats

| # | Goal (type this in `/sim`) | What it proves |
|---|---|---|
| 1 | `Find the standup transcript in my Downloads and turn it into meeting minutes saved on my laptop.` | The hero: **search → read → reason → draft → real `.docx` → verified**. The model writes the minutes; the executor verifies the file exists. |
| 2 | `Go to my GitHub profile and tell me my display name and how many public repositories I have` | A **different domain** (web) on the same engine, and the identity grounding: REACH uses the handle from the local environment (`git config user.name`) instead of inventing `yourusername`. Measured: 8.7s, 3 planner calls, correct answer. |
| 3 | `Delete the old standup notes file in my Downloads.` | **Policy on camera**: a consequential action pauses, quotes the exact target, and asks. Ordinary actions never ask. |
| 4 | `Read the contents of /etc/passwd.` | **Honest refusal** (15s): a clean `CANNOT` with a reason. Safe failure beats a silent hang. |

## 0:00–0:20 Hook (Impact + Idea)

Voiceover: "Alexa+ understands requests, but it can't reach the scattered capabilities on your machines."
Closing tease: "Alexa+ understands what you want. REACH gives that intent somewhere to go."

## 0:20–1:25 Beat 1 — the hero (minutes from a transcript)

* Type beat 1 in `/sim`.
* Show, in this order, on camera:
  * the **plan** filling in (`files.search` → `files.read` → `files.create_document` → `files.verify`);
  * the **activity trail** ticking over — each step with its policy verdict;
  * the **result**: a real `.docx` on the laptop, opened on screen, with real minutes in it;
  * the **evidence** panel: the cited action IDs, the outcome kind (`complete`), and the token usage.
* Narrate one line: "It found the file, read it, wrote the minutes, and checked the file was really there. Nobody wrote a route for this sentence."

## 1:25–1:55 Beat 2 — a different domain, same engine

* Type beat 2.
* Show the browser steps in the trace, then the answer in the summary.
* Narrate: "Same planner, same policy, same trace. Not a second product."

> Measured: 8.7s, 3 planner calls, and the answer comes straight out of the
> first page snapshot. Do **not** use "list my repositories" as the goal — the
> repository list sits deep in GitHub's accessibility tree, and the model has
> to hunt for it (measured: 24 planner calls, 60s, failed). The prompt now
> tells it to read the snapshot instead of hunting, but the goal above is the
> one that is boringly reliable.

## 1:55–2:20 Beat 3 — the approval beat (policy on camera)

* Type beat 3 in `/sim`.
* The task runs, then **pauses**: an approval card appears in the conversation
  thread (not in the sidebar) reading *"Needs your approval"*, the consequence,
  the exact action and target, a live expiry countdown, and an
  **Exact action payload** disclosure.
* Press **Approve**.
* Show the file actually gone and the task completing. In the trace the same
  action appears three times — *paused for approval*, *user-approved:
  proceeding*, *delete_file ok* — which is the approve-executes semantics on
  camera.
* Narrate: "Delete asks. Finding a file doesn't. That's the whole security model in twenty seconds."

> Verified on 2026-10-21: the card renders, Approve deletes the file, and the
> trace shows all three states. The only part that needs Bedrock is the
> planner resuming afterwards.

## 2:20–2:35 Refusal beat (15s)

* Type beat 4.
* Show the clean refusal with its reason.
* Narrate: "It says no, and says why."

## 2:35–2:55 Technical reveal + close

Diagram: goal → planner (Bedrock) → executor + policy → laptop primitives → verified evidence.
"Goals, not devices. Anything authorized, nothing else." + repo link.

## Film prep (do immediately before every take)

* `npm run doctor` → all green (`.env`, AWS keys, ports free, data dir writable).
* Boot: `npm run dev:server` and `npm run dev:agent`. Wait for the agent heartbeat —
  confirm the sim's device panel shows **Online** before typing anything.
* Confirm the fixtures exist and read well (see below). One clean transcript, one throwaway file.
* **The throwaway file must still exist before the take** — beat 3 deletes it, so restore it after every take.
* Clear task history so the panel reads clean on camera: delete `server/data/tasks/*.json`
  (keep `server/data/devices/` — registration re-beats on its own).
* Close any open document from a previous take (it locks the file on Windows; on macOS
  it steals focus).
* **Browser profile logged in once beforehand** if any beat needs a logged-in session.
  Beats 1–4 do not.
* Film the beats in order 1→2→3→4, one unbroken take each.

## Demo fixtures

Seed these before filming (they live in the user's real Downloads, so the search
finds them the way it would for a real user):

| File | Purpose |
|---|---|
| `~/Downloads/standup-transcript.txt` | A ~30-line meeting transcript with names, decisions, action items and one ambiguous item. Beat 1 reads it. |
| `~/Downloads/standup-notes-old.txt` | A throwaway file. Beat 3 deletes it. |

Beat 1's transcript should contain a line that is *not* in the user's control —
a decision with no owner — so the planner has something real to summarize rather
than a list to copy.

## Shot list

- [ ] `/sim` plan + trace + evidence chain (beat 1).
- [ ] The `.docx` open on the laptop with real minutes inside (beat 1).
- [ ] Browser steps in the trace + the answer in the summary (beat 2).
- [ ] Approval card quoting the exact target → Approve → deletion → completion (beat 3).
- [ ] Clean refusal with a reason (beat 4).
- [ ] Architecture overlay (reveal).

## If you are running late

**Cut beat 2 (browser).** A two-beat video (hero + approval) is a complete
argument; a three-beat video with a broken browser step is not. Never cut beat 3 —
the approval beat is what separates REACH from a script runner.
