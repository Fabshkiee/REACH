# Submission Checklist (Devpost)

Track: **Alexa+**. Mini: **AWS Builder**. Skip: Open Source.

## Project
* [ ] Built with required tools; Stage-1 viable (fits theme + applies required APIs).
* [ ] New or significantly updated during submission window (Aug 31–Oct 23 2026) — describe updates.

## Repo (GitHub URL on form)
* [ ] Public + MIT `LICENSE` detectable in About (done) OR private shared with `testing@devpost.com` + `@AmazonAppDev`.
* [ ] All source + assets + setup/run instructions (`README.md` — done, verify on clean clone).
* [ ] Runtime hook: `McpServer` created per request (`server/src/mcp/server.ts`), `BedrockRuntimeClient` imported (`server/src/aws/bedrock.stub.ts`, live calls in A-series) — plus planner/trace evidence once built.
* [ ] Alexa+: MCP `2025-11-25` over Streamable HTTP (done, verified); sim path exempt but we target real route.

## Video
* [ ] `<3min`, public YouTube/Vimeo, shows functioning on intended platform (simulator + laptop).
* [ ] Video shows three unrelated goals on one engine + approval beat + refusal beat (script: `docs/demo-script.md`).
* [ ] No third-party trademarks/copyrighted music without permission. Script: `docs/demo-script.md`.

## Text
* [ ] Description: features + functionality + “significantly updated” note.
* [ ] Product Feedback answers (`docs/product-feedback.md`).
* [ ] Friction log entries (`docs/friction-log.md`, bonus up to 10%). Feature requests deferred.
* [ ] Track + mini identified; AWS Builder: services + how (see `docs/aws-builder.md`).

## Prizes
* [ ] One track + one mini max. Targets: Alexa+ place + AWS Builder.
