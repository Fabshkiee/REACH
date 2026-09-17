# Architecture

> REACH expands the set of capabilities Alexa+ can reach — explicitly authorized user
> devices/software otherwise outside Alexa's native surface.

```text
                Alexa+
                  │
             MCP / HTTPS (Streamable HTTP, MCP 2025-11-25)
                  │
        ┌─────────▼─────────┐
        │    REACH Core     │  server/
        │ Intent / Tasks    │    tasks/: queued → running → completed/failed + evidence
        │ Capability Graph  │    registry/capabilityGraph.ts: goal → capabilities → devices
        │ Device Registry   │    registry/deviceStore.ts: register + heartbeat (90s window)
        └──────┬──────┬─────┘
               │      │  HTTPS REST + polling (MVP)
        ┌──────▼─┐  ┌─▼───────┐
        │ Laptop │  │  iPhone │ (later)
        │ Agent  │  │  Agent  │
        └────┬───┘  └────┬────┘
```

## Design principles (judging: Design + Idea)

* Users describe **goals**, not devices/APIs. REACH reasons about **capabilities**.
* Alexa surface stays at 2 semantic tools; agents expose allowlisted capabilities only.
* Long tasks are async + stateful; MCP returns `taskId` in <500ms, never blocks.
* Fail safely when device/capability unavailable (403 + `failed` task, no silent hang).
* No generic `run_command`. No per-capability Alexa tools.

## Persistence (Phase 2 — why files, not a database)

* `TaskStore` / `DeviceStore` are **interfaces**; `FileTaskStore` / `FileDeviceStore`
  are the adapters (`server/src/tasks/taskStore.ts`, `server/src/registry/deviceStore.ts`).
  Swapping backends (SQLite/Postgres) is one factory line — callers never move.
* File-backed is deliberate for a single-user local-first bridge: zero native builds
  (`better-sqlite3` needs C++ compilation on Windows — real judge-setup friction),
  zero new dependencies, and human-inspectable state (`server/data/tasks/*.json`
  shows the state machine working). Writes are atomic (sibling tmp + rename) with a
  versioned schema, so crashes can't tear state.
* Runtime state lives in `server/data/` (gitignored, overridable via `REACH_DATA_DIR`).

## Positioning vs. landscape (Sep 17 review)

Crowded with specialized domain agents (Aura+ concierge, KinSwitch people-handoff,
Dwell planner, SHIFT/RELAY continuity, HomeKeeper/Custodian/PetPulse context).
REACH is **infrastructure**: the impressive part is a real non-native device capability
executing (`.docx` on laptop), not that Alexa orchestrated steps.
