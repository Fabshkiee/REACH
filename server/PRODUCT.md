# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static single-file HTML/CSS/JS served by the existing Node server (`server/src/index.ts` serves `public/sim.html`). No framework. [Inferred: the incumbent answer; the user did not re-confirm it this session.]

## Users

- **Primary (judging scene):** hackathon judges and the dev-reviewer audience watching a <3-minute demo video. They consume the screen as a broadcast surface: what state is REACH in, what is it about to do, what did it verify. They read at a distance (projector / full-screen video), two minutes of attention, no training.
- **Operator (off-camera):** the developer running the sim as the demo client, typing goals, answering gates, replaying missions from history. [Inferred from repo docs: `docs/demo-script.md` film beats.]

## Product Purpose

REACH is a general agent loop: a goal in natural language is planned by Bedrock, checked by policy, executed through advertised device capabilities, and returned as verified evidence. The sim UI is the human seat for that loop: watch plan → route → gate → artifact.

## Positioning

The model proposes; the code decides. Every action is classified by risk, gated for explicit approval when consequential, and reported with cited evidence — a task cannot claim success without it. The neighboring products cannot copy the *evidence semantics*, so the surface exists to make that semantics legible at a glance.

## Operating Context

- Demo is filmed: judged on a projector and inside a recorded video; every state must be legible at 1440×900 and at video-compression quality.
- The Alexa+ surface is **simulated** on camera (stated on camera); the sim is that demo client. No Amazon marks/logos inside the UI.
- Judged beats in `docs/demo-script.md`: transcribe hero, GitHub query, delete approval, honest refusal — the UI must present each beat without narration help.

## Capabilities and Constraints

- Static front end only; all data from `/devices`, `/tools/tasks*`, `/approvals/:id/*`, `/tasks/:id/input`, `/health` (dual). No backend changes in this work.
- The e2e suite asserts DOM strings in the served HTML (build stamps, question counter `(N/3)`, timeline vocabulary, header). Those elements are load-bearing.
- Element IDs are load-bearing: the inline script matches them; changing an ID silently breaks a live demo.

## Brand Commitments

- Name: **REACH**. Apple-style: system type stack, iOS system colors, near-black dark ground, hairlines, restrained single accent.
- Voice: plain declarative English, no hype adjectives, no ALL-CAPS jargon costumes ("enclave", "REV 4.2", service acronyms at whisper size are banned).
- No Amazon logos/marks in the UI; plain-English names of services are fine.

## Evidence on Hand

- Real task store under `server/data/tasks/*.json` (history replays are real).
- Demo fixtures and measured beats in `docs/demo-script.md`; no synthetic user quotes in-app.

## Product Principles

1. **State before everything.** The screen answers "what is REACH doing right now" in one glance.
2. **One motion hero.** The core orb is the single animated protagonist; all other motion is subordinate or explanatory.
3. **Evidence visible on demand, not on blast.** Trace and history are one tap away, not a permanent second dashboard.
4. **Nothing smaller than 11px.** If information only reads at 6px, it is deleted, not shrunk.
5. **The demo beats are the spec.** Transcribe hero, GitHub query, approval card, honest refusal — each beat must be visibly supported by the UI alone.

## Accessibility & Inclusion

- WCAG 2.2 AA body contrast; 11px floor on all text; full keyboard operation (gate, question, composer, popovers, Esc/Enter); `prefers-reduced-motion` honored; live-region announcements kept.
