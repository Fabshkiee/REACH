# Demo Script (<3min — judges may stop at 3:00)

Target feel: product demo, not lecture. Film real artifacts; no mocks.

## 0:00–0:20 Hook (Impact + Idea)
Voiceover: “Alexa+ understands requests, but can’t reach your scattered personal capabilities.”
Show Alexa hearing a request it natively can’t fulfill. Closing line tease:
“Alexa+ understands what you want. REACH gives that intent somewhere to go.”

## 0:20–1:10 Instant proof (Tech)
* Say: “Alexa, create a document on my laptop for my biology homework.”
* Show: Alexa+ → task queued → laptop screen: `Biology Homework.docx` appears + opens.
* Overlay tiny: `execute_on_my_devices → capability create_document → windows-laptop`.

## 1:10–2:00 Hero workflow (Tech + Design, async)
* Say: “Open my next meeting, capture ten minutes, make minutes, save on my laptop.”
* Show: `taskId` returns fast → progress via `get_task_status` → Bedrock minutes → saved docx.
* Narrate: queued → running → completed; safe-fail line if offline.

## 2:00–2:20 Cross-device (Idea — if built)
* Second device capability (iPhone photos → big screen, or TBD) completing one intent.

## 2:20–2:40 Technical reveal (Tech)
Diagram: Alexa+ → REACH MCP (Streamable HTTP 2025-11-25) → capability registry → device agents.
Allowlist + heartbeat + evidence note (5s).

## 2:40–2:55 Close (Impact)
“Goals, not devices. Any authorized computer/phone/software.” + repo + AWS Bedrock credit.

## Shot list (capture during build)
* [ ] Simulator voice + taskId response.
* [ ] Laptop filesystem + open docx (unedited take).
* [ ] `get_task_status` polling / task timeline.
* [ ] Architecture overlay.
