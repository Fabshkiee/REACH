# Submission Checklist (Devpost)

Track: **Alexa+**. Mini: **AWS Builder**. Skip: Open Source.

## Project
* [ ] Built with required tools; Stage-1 viable (fits theme + applies required APIs).
* [ ] New or significantly updated during submission window (Aug 31–Oct 23 2026) — describe updates.

## Repo (GitHub URL on form)
* [ ] Public + MIT `LICENSE` detectable in About (done) OR private shared with `testing@devpost.com` + `@AmazonAppDev`.
* [ ] All source + assets + setup/run instructions (`README.md` — done, verify on clean clone).
* [ ] Runtime hook: `McpServer` created per request (`server/src/mcp/server.ts`), live Bedrock planner (`server/src/planner/bedrock.ts`, default `amazon.nova-lite-v1:0`) — plus planner/trace evidence (`plan/trace/usage/evidence` in `get_task_status`).
* [ ] Alexa+: MCP `2025-11-25` over Streamable HTTP transport verified (Inspector/SDK per `docs/mcp-inspector.md`); **no live Alexa+ integration — sim locked, partner-gated.** Sim + laptop is the video platform; do not claim real route.

## Video
* [ ] `<3min`, public YouTube/Vimeo, shows functioning on intended platform (simulator + laptop).
* [ ] Video shows one local DOCX hero + read-only browser + CANNOT/approval beats on one engine (sim locked, simulated — not live Alexa+). Script: `docs/demo-script.md` (to be rewritten to hero; current script still old 3-proof cut).
* [ ] No third-party trademarks/copyrighted music without permission. Script: `docs/demo-script.md`.

## Text
* [ ] Description: features + functionality + “significantly updated” note.
* [ ] Product Feedback answers (`docs/product-feedback.md`).
* [ ] Friction log entries (`docs/friction-log.md`, bonus up to 10%). Feature requests deferred.
* [ ] Track + mini identified; AWS Builder: services + how (see `docs/aws-builder.md`).

## Prizes
* [ ] One track + one mini max. Targets: Alexa+ place + AWS Builder.
