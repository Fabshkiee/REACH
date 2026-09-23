# Alexa+ Auth Checklist (OAuth 2.1 + PKCE S256) — NO-GO, sim locked

> Decision 2026-09-24: Alexa+ MCP Toolkit is partner-gated with no consumer SDK
> access for this account. No live Alexa+ integration in v1/video. REACH stays
> Alexa+-compatible MCP (simulated in video): `execute_on_my_devices →
> get_task_status → decide_approval`. Well-known routes stub 404,
> `addon.json` is example.com scaffolding. Revisit only if program access lands.

Source: Alexa+ MCP QuickStart. Full server lands Phase 3/4. Skeleton reserves routes.

* [ ] Streamable HTTP endpoint live at remote HTTPS URL (tunnel for dev).
* [ ] Unauthenticated requests → `401` WITHOUT `WWW-Authenticate` header.
* [ ] PRM at `/.well-known/oauth-protected-resource` (RFC 9728). Skeleton: `server/src/index.ts` stubs 404.
* [ ] Auth metadata at `/.well-known/oauth-authorization-server`, `code_challenge_methods_supported` includes `S256`.
* [ ] Authorization code flow: `resource` = canonical MCP URI, scopes from PRM, PKCE S256.
* [ ] Token request includes `resource` + `code_verifier`. Usage: Bearer header only, never query string.
* [ ] NOT supported: DCR, CIMD, OIDC, step-up, `WWW-Authenticate` on 401 — do not build these.
* [ ] Latency: round-trip <500ms (async taskId pattern already in `mcp/tools.ts`).
* [ ] `addon.json`: name ≤30, short ≤123, full ≤4000, 3–4 phrases ≤200 each, privacy/terms HTTPS, 6 light icons + carousel.
* [ ] Flow: `alexa-ai configure` → `alexa-ai new mcp` or Agent Skill → `alexa-ai deploy` → web simulator → `submit`.
