import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IosButtonSchema,
  IosCopySchema,
  IosLaunchSchema,
  IosListFilesSchema,
  IosPushFileSchema,
  chooseDevice,
  cleanToolError,
  clipText,
  mergeDevices,
  parseApps,
  parseBattery,
  parseDevices,
  parseStorage,
  type IosDevice,
} from "./phone.js";

const DEVICE: IosDevice = { udid: "00008110-001A2B3C4D5E", name: "Fab's iPhone", model: "iPhone16,1", ios: "26.0" };

describe("iPhone discovery parsing", () => {
  it("reads remote-browse peer info (UniqueDeviceID / OSVersion)", () => {
    const devices = parseDevices([
      { UniqueDeviceID: "abc-123", DeviceName: "Fab's iPhone", ProductType: "iPhone16,1", OSVersion: "26.0" },
    ]);
    assert.deepEqual(devices, [{ udid: "abc-123", name: "Fab's iPhone", model: "iPhone16,1", ios: "26.0" }]);
  });

  it("reads usbmux short info (Identifier / ProductVersion)", () => {
    const devices = parseDevices([
      { Identifier: "abc-123", UniqueDeviceID: "abc-123", DeviceName: "iPhone", ProductType: "iPhone15,2", ProductVersion: "18.5" },
    ]);
    assert.equal(devices[0]?.udid, "abc-123");
    assert.equal(devices[0]?.ios, "18.5");
  });

  it("skips entries without a UDID and tolerates junk", () => {
    assert.deepEqual(parseDevices([{ DeviceName: "no udid" }, null, "x"]), []);
    assert.deepEqual(parseDevices(undefined), []);
  });

  it("merges the two discovery sources by UDID, filling missing fields", () => {
    const merged = mergeDevices(
      parseDevices([{ UniqueDeviceID: "abc-123", ProductType: "iPhone16,1", OSVersion: "26.0" }]),
      parseDevices([{ Identifier: "ABC-123", DeviceName: "Fab's iPhone", ProductVersion: "26.0" }]),
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.name, "Fab's iPhone");
    assert.equal(merged[0]?.model, "iPhone16,1");
  });

  it("chooses the only device, the exact UDID, and refuses ambiguity", () => {
    assert.equal(chooseDevice([DEVICE]).udid, DEVICE.udid);
    assert.equal(chooseDevice([DEVICE], "00008110-001a2b3c4d5e").name, DEVICE.name);
    assert.throws(() => chooseDevice([DEVICE], "nope"), /not paired with this Mac/);
    assert.throws(() => chooseDevice([]), /No iPhone found/);
    assert.throws(
      () => chooseDevice([DEVICE, { ...DEVICE, udid: "other", name: "Second" }]),
      /Several iPhones are paired[\s\S]*other[\s\S]*udid/,
    );
  });
});

describe("iPhone info parsing", () => {
  it("parses battery snapshots and degrades to null", () => {
    assert.deepEqual(parseBattery({ CurrentCapacity: 73, IsCharging: true }), { level: 73, charging: true });
    assert.deepEqual(parseBattery({ CurrentCapacity: 0 }), { level: 0, charging: false });
    assert.equal(parseBattery({}), null);
    assert.equal(parseBattery(undefined), null);
  });

  it("parses storage only when both numbers are present", () => {
    assert.deepEqual(
      parseStorage({ TotalDataCapacity: 256_000_000_000, TotalDataAvailable: 100_000_000_000 }),
      { freeBytes: 100_000_000_000, totalBytes: 256_000_000_000 },
    );
    assert.equal(parseStorage({ TotalDataCapacity: 256_000_000_000 }), null);
  });

  it("parses app lists from either key style and skips bundle-less entries", () => {
    const apps = parseApps([
      { bundleIdentifier: "com.apple.mobilesafari", displayName: "Safari" },
      { BundleIdentifier: "com.apple.Maps", DisplayName: "Maps" },
      { displayName: "no bundle" },
    ]);
    assert.deepEqual(apps.map((a) => a.bundleId), ["com.apple.Maps", "com.apple.mobilesafari"]);
    assert.equal(apps[0]?.name, "Maps");
  });

  it("caps clipboard text with a visible truncated flag", () => {
    assert.deepEqual(clipText("short", 10), { text: "short", truncated: false });
    assert.deepEqual(clipText("0123456789", 4), { text: "0123", truncated: true });
  });
});

describe("iPhone tool errors", () => {
  it("replaces the misleading 'Failed to start service' block with a truthful error", () => {
    const stderr =
      'Failed to start service. Possible reasons are:\n- Make sure you first enabled "Developer Mode" via: ' +
      "python3 -m pymobiledevice3 amfi enable-developer-mode";
    const msg = cleanToolError(["developer", "core-device", "hid", "button", "mute"], stderr);
    assert.match(msg, /does not expose this developer service/);
    assert.match(msg, /not a Developer Mode issue/);
    assert.doesNotMatch(msg, /amfi enable-developer-mode/);
  });

  it("keeps bounded stderr detail for ordinary failures", () => {
    const msg = cleanToolError(["lockdown", "info"], "x".repeat(400));
    assert.match(msg, /lockdown info failed: x{300}$/);
  });
});

describe("iPhone tool schemas", () => {
  it("pages file listings with a bounded limit", () => {
    const parsed = IosListFilesSchema.parse({});
    assert.equal(parsed.path, "/DCIM/");
    assert.equal(parsed.limit, 200);
    assert.throws(() => IosListFilesSchema.parse({ limit: 0 }));
  });

  it("rejects empty or oversized clipboard text", () => {
    assert.ok(IosCopySchema.safeParse({ text: "hello" }).success);
    assert.equal(IosCopySchema.safeParse({ text: "" }).success, false);
    assert.equal(IosCopySchema.safeParse({ text: "x".repeat(10001) }).success, false);
  });

  it("only accepts bundle-ID-shaped launch targets", () => {
    assert.ok(IosLaunchSchema.safeParse({ bundleId: "com.apple.mobilesafari" }).success);
    assert.equal(IosLaunchSchema.safeParse({ bundleId: "com apple" }).success, false);
    assert.equal(IosLaunchSchema.safeParse({ bundleId: "'; rm -rf /" }).success, false);
  });

  it("keeps the button enum closed", () => {
    assert.ok(IosButtonSchema.safeParse({ button: "lock" }).success);
    assert.equal(IosButtonSchema.safeParse({ button: "reboot" }).success, false);
  });

  it("requires a local file for push and keeps remote paths in the schema", () => {
    assert.equal(IosPushFileSchema.safeParse({}).success, false);
    assert.ok(IosPushFileSchema.safeParse({ path: "report.pdf", bundleId: "com.apple.iBooks", remotePath: "/report.pdf" }).success);
  });
});
