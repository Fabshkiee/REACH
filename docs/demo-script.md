# Demo Script (<3min — judges may stop at 3:00)

> One engine, three beats, one refusal. Sim is the demo client (the Alexa+
> toolkit is partner-gated — **no live Alexa+ is claimed**; the video says so).
> Every beat runs on the same planner → executor → policy → primitives pipeline.
> No mocks, no bespoke routing, no special cases.

Target feel: product demo, not lecture. Film real artifacts on one machine.

## Film checklist (before the first take)

1. `npm run doctor` → **all green**, especially `bedrock reachable`.
2. Kill stale processes: `pkill -f "tsx src/index.ts"` — a stale server on
   :3000 silently serves the OLD code (this happened during the build).
3. `npm run dev:server` and `npm run dev:agent`; wait for the heartbeat. The
   sim's device panel must read **Laptop Agent · Online · 14 capabilities**.
4. Clear task history: `rm -f server/data/tasks/*.json` — the panel reads
   clean on camera.
5. Fixtures in place:
   * `~/Downloads/product-sync-recording.mp3` — **the 105-second meeting
     recording** (four voices). This is beat 1's input. It ships with the repo
     as `assets/sample-meeting.mp3`; copy it into `~/Downloads` before the take.
   * `~/Downloads/standup-transcript.txt` — the same meeting as text, for the
     fallback beat 1b.
   * `~/Downloads/standup-notes-old.txt` — the throwaway file beat 3 deletes.
     **Every take deletes it — restore it between takes.**
6. Close Pages and any open document from a previous take (it steals focus).
7. Open `/sim`; allow microphone access. The mic is tap-to-talk by default;
   hands-free is the small **Wake word** toggle. If the mic is blocked or the
   room is noisy, click the phrase chips or use **Type instead** — the same
   backend beats run either way.
8. Speak full goals by tapping the orb, or click a phrase chip for the short
   demo versions.

Measured timings, so you know what you are watching:

| Beat | Wall time | Planner calls | Actions |
|---|---|---|---|
| 1 hero (transcribe) | ~22–25s, incl. your approval | 4 | search → transcribe (paused) → create_document |
| 1b fallback (transcript) | 11–13s | 4 | search → read → create_document |
| 2 browser | ~9–12s | 3 | goto → observe → finish |
| 3 approval | ~15s to the card, then it waits for you | 6 | verify (miss) → search → delete (paused) |

## The beats

| # | Goal (say or type in `/sim`) | What it proves |
|---|---|---|
| 1 | `Transcribe the product sync recording in my Downloads and write the meeting minutes to my laptop` | **The hero — the thing REACH was built for.** A real recording on the laptop → read by the agent → uploaded to S3 → transcribed by **Amazon Transcribe** → reasoned over by **Bedrock** → written as a real `.docx` → opened. Three AWS services, one engine. It also asks before it uploads your recording to a cloud service. |
| 1b | *(fallback)* `Find the standup transcript in my Downloads and turn it into meeting minutes saved on my laptop` | The same engine with the audio already transcribed — if S3 or Transcribe is unhappy on the day, use this. |
| 2 | `Go to my GitHub profile and tell me my display name and how many public repositories I have` | A **different domain** (web) on the same engine, and the identity grounding: REACH uses the handle from the local environment (`git config user.name`) instead of inventing `yourusername`. Measured: 8.7s, 3 planner calls, correct answer. |
| 3 | `Delete the old standup notes file in my Downloads.` | **Policy on camera**: a consequential action pauses, quotes the exact target, and asks. Ordinary actions never ask. |
| 4 | `Read the contents of /etc/passwd.` | **Honest refusal** (15s): a clean `CANNOT` with a reason. Safe failure beats a silent hang. |

## 0:00–0:20 Hook (Impact + Idea)

Voiceover: "Alexa+ understands requests, but it can't reach the scattered capabilities on your machines."
Closing tease: "Alexa+ understands what you want. REACH gives that intent somewhere to go."

## 0:20–1:25 Beat 1 — the hero (a meeting recording becomes minutes)

* Tap the orb and say: **“Hey REACH, transcribe the product sync recording in
  my Downloads and write the meeting minutes to my laptop.”** (Or click the
  **Transcribe the sync recording** phrase chip.)
* REACH speaks the result as a completed action; the mission card carries the
  same outcome as its caption.
* Show, in this order, on camera:
  * the **plan** filling in (`files.search` → `audio.transcribe` → `files.create_document`);
  * the **approval sheet**: *"this sends /Users/…/product-sync-recording.mp3 to a third-party service"* — it asks before your recording leaves the machine. **Press Approve.**
  * the **activity trail** ticking over — each step with its policy verdict;
  * the **result**: a real `.docx` on the laptop, opened on screen, with real minutes in it — attendees, decisions, action items **with owners**, open questions, all from the recording;
  * the **evidence** panel: the cited action IDs, the outcome kind (`complete`), and the token usage.
* Narrate one line: "It transcribed the meeting with Amazon Transcribe, wrote the minutes with Bedrock, and checked the file was really there. Nobody wrote a route for this sentence."

> Measured: ~27s, 5 planner calls, 3 actions. Three live runs, all three produced
> minutes containing the real content (the conflict resolver, the 200-session
> target, the accessibility audit's 7 contrast and 4 focus-order findings) and
> none of them invented anything.

## 1:25–1:55 Beat 2 — a different domain, same engine

* Tap the orb and say: **“Hey REACH, go to my GitHub profile and tell me my
  display name and how many public repositories I have.”**
* Show the browser steps in the trace, then the answer in the summary and in
  REACH’s spoken reply.
* Narrate: "Same planner, same policy, same trace. Not a second product."

> Measured: 8.7s, 3 planner calls, and the answer comes straight out of the
> first page snapshot. Do **not** use "list my repositories" as the goal — the
> repository list sits deep in GitHub's accessibility tree, and the model has
> to hunt for it (measured: 24 planner calls, 60s, failed). The prompt now
> tells it to read the snapshot instead of hunting, but the goal above is the
> one that is boringly reliable.

## 1:55–2:20 Beat 3 — the approval beat (policy on camera)

* Tap the orb and say: **“Hey REACH, delete the old standup notes file in my
  Downloads.”**
* The task runs, then **pauses**: a focused approval sheet appears over the
  voice console (not in the right rail) reading *"Needs your approval"*, the
  consequence, the exact action and target, a live expiry countdown, and an
  **Exact action payload** disclosure. REACH speaks the approval request.
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

* Tap the orb and say: **“Hey REACH, read the contents of /etc/passwd.”**
* Show the clean refusal with its reason; REACH speaks the same honest line.
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
