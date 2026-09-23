import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.REACH_DATA_DIR = mkdtempSync(join(tmpdir(), "reach-d-devices-"));

import {
  heartbeat,
  isDeviceAvailable,
  listDevices,
  pauseDevice,
  registerDevice,
  resumeDevice,
  revokeDevice,
} from "./deviceStore.js";
import { findProviders, listCapabilities } from "./capabilityGraph.js";

const LAPTOP = { id: "windows-laptop", name: "Windows Laptop", capabilities: ["create_document", "search_files"] };

function freshRegister() {
  // Revoke leftovers from prior tests sharing this data dir.
  for (const d of listDevices()) revokeDevice(d.id);
  return registerDevice({ ...LAPTOP });
}

beforeEach(() => {
  freshRegister();
});

describe("device pause / resume / revoke", () => {
  it("fresh registrations are available", () => {
    const d = listDevices().find((x) => x.id === LAPTOP.id)!;
    assert.ok(d);
    assert.equal(d.disabled ?? false, false);
    assert.equal(isDeviceAvailable(d), true);
  });

  it("pause stops availability and survives heartbeats and re-registration", () => {
    pauseDevice(LAPTOP.id);
    assert.equal(isDeviceAvailable(listDevices().find((x) => x.id === LAPTOP.id)!), false);
    const beat = heartbeat(LAPTOP.id, { capabilities: [...LAPTOP.capabilities] });
    assert.equal(beat?.disabled, true);
    assert.equal(isDeviceAvailable(beat!), false);
    const re = registerDevice({ ...LAPTOP });
    assert.equal(re.disabled, true);
    assert.equal(isDeviceAvailable(re), false);
  });

  it("resume re-enables", () => {
    pauseDevice(LAPTOP.id);
    const resumed = resumeDevice(LAPTOP.id)!;
    assert.equal(resumed.disabled, false);
    assert.equal(isDeviceAvailable(resumed), true);
  });

  it("revoke deletes; unknown ids are safe no-ops", () => {
    assert.equal(revokeDevice(LAPTOP.id), true);
    assert.equal(listDevices().find((x) => x.id === LAPTOP.id), undefined);
    assert.equal(heartbeat(LAPTOP.id), undefined);
    assert.equal(revokeDevice(LAPTOP.id), false);
    assert.equal(revokeDevice("nope-missing"), false);
    assert.equal(revokeDevice("../evil"), false);
    assert.equal(pauseDevice("nope-missing"), undefined);
    assert.equal(resumeDevice("nope-missing"), undefined);
  });

  it("stale heartbeats read unavailable", () => {
    const d = listDevices().find((x) => x.id === LAPTOP.id)!;
    assert.equal(isDeviceAvailable(d, Date.now() + 10 * 60_000), false);
  });

  it("registration rejects unsafe ids", () => {
    assert.throws(() => registerDevice({ id: "../evil", name: "evil", capabilities: [] }), /invalid device id/);
  });
});

describe("capability graph honesty", () => {
  it("is empty when no devices are registered — no phantom laptop", () => {
    revokeDevice(LAPTOP.id);
    assert.deepEqual(listCapabilities(), []);
    assert.deepEqual(findProviders("create_document", { onlyAvailable: true }), []);
    assert.deepEqual(findProviders("create_document"), []);
  });

  it("lists live advertisements with metadata, and only live providers", () => {
    const caps = listCapabilities();
    assert.equal(caps.length, 2);
    const doc = caps.find((c) => c.id === "create_document")!;
    assert.equal(doc.deviceId, LAPTOP.id);
    assert.deepEqual(doc.scopes, ["documents:write"]);
    assert.equal(findProviders("create_document", { onlyAvailable: true }).length, 1);
    pauseDevice(LAPTOP.id);
    assert.deepEqual(findProviders("create_document", { onlyAvailable: true }), []);
    // Unfiltered providers still explain what exists (for useful CANNOTs).
    assert.equal(findProviders("create_document").length, 1);
  });
});
