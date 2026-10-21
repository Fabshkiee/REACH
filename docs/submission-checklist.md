# Submission Checklist (Devpost)

Track: **Alexa+**. Mini: **AWS Builder**. Skip: Open Source.

## Project
* [x] Built with required tools; Stage-1 viable (fits theme + applies required APIs) — self-hosted MCP server, Alexa+-compatible MCP surface, sim demo client.
* [x] New or significantly updated during submission window (Aug 31–Oct 23 2026) — planner loop, approvals, honest outcomes, event trail, cross-platform agent, browser adapter. Describe in the form: the engine is a general observe→plan→act→verify loop over a pluggable capability set, not a per-sentence router.

## Repo (GitHub URL on form)
* [ ] Public + MIT `LICENSE` detectable in About — **ACTION: the repo is currently private. Make it public before submitting.**
* [x] All source + assets + setup/run instructions (`README.md` — rewritten 2026-10-21 for macOS/Linux/Windows; verify on a clean clone).
* [x] Runtime hook: `McpServer` created per request (`server/src/mcp/server.ts`), live Bedrock planner (`server/src/planner/bedrock.ts`, default `amazon.nova-pro-v1:0`) — plus planner/trace evidence (`plan/trace/usage/evidence` in `get_task_status`).
* [x] Alexa+: MCP `2025-11-25` over Streamable HTTP transport verified (Inspector/SDK per `docs/mcp-inspector.md`); **no live Alexa+ integration — sim locked, partner-gated.** Sim + laptop is the video platform; the video states this on camera. Do not claim a real route.

## Video
* [ ] `<3min`, public YouTube/Vimeo, shows functioning on the intended platform (simulator + laptop).
* [ ] Video shows the hero (transcript → verified minutes on the laptop), a read-only browser task, and an approval/CANNOT beat on one engine (sim locked, simulated — not live Alexa+). Script: `docs/demo-script.md`.
* [ ] No third-party trademarks/copyrighted music without permission.

## Text
* [ ] Description: features + functionality + "significantly updated" note.
* [x] Product Feedback answers (`docs/product-feedback.md` — drafted 2026-10-21, review before pasting).
* [x] Friction log entries (`docs/friction-log.md`, bonus up to 10%) — including the Windows→macOS migration.
* [x] Track + mini identified; AWS Builder: services + how (see `docs/aws-builder.md`).

## Prizes
* [x] One track + one mini max. Targets: Alexa+ place + AWS Builder.

## Optional
* [ ] `npm run doctor` output screenshotted (proves the setup path is real).
* [ ] `npm run test:e2e` scorecard screenshot (187-test black-box suite).
