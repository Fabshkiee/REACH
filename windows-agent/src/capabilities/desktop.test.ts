import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InspectWindowsSchema,
  FocusWindowSchema,
  TypeTextSchema,
  SendHotkeySchema,
  SetClipboardSchema,
  inspectWindows,
  setClipboard,
  getClipboard,
  sendHotkey,
} from "./desktop.js";

describe("agent desktop capabilities", () => {
  it("validates schemas properly", () => {
    assert.ok(InspectWindowsSchema.safeParse({}).success);
    assert.ok(InspectWindowsSchema.safeParse({ query: "discord" }).success);

    assert.ok(FocusWindowSchema.safeParse({ title: "Discord" }).success);
    assert.equal(FocusWindowSchema.safeParse({ title: "" }).success, false);

    assert.ok(TypeTextSchema.safeParse({ text: "Hello", submit: true }).success);
    assert.ok(TypeTextSchema.safeParse({ text: "Hello", useClipboard: true }).success);

    assert.ok(SendHotkeySchema.safeParse({ keys: ["ctrl", "k"] }).success);
    assert.equal(SendHotkeySchema.safeParse({ keys: [] }).success, false);

    assert.ok(SetClipboardSchema.safeParse({ text: "clipboard test" }).success);
  });

  // The desktop adapter drives the live Windows desktop through Win32 APIs.
  // On other platforms the agent does not advertise these capabilities, so
  // there is nothing to exercise — skip rather than fake a pass.
  const windowsOnly = process.platform === "win32" ? it : it.skip;

  windowsOnly("inspects open windows without error", async () => {
    const res = await inspectWindows();
    assert.equal(res.ok, true);
    assert.ok(Array.isArray(res.windows));
  });

  windowsOnly("sets and gets clipboard text round-trip", async () => {
    const testPayload = `REACH_TEST_${Date.now()}_CLIPBOARD`;
    const setRes = await setClipboard({ text: testPayload });
    assert.equal(setRes.ok, true);
    assert.equal(setRes.length, testPayload.length);

    const getRes = await getClipboard();
    assert.equal(getRes.ok, true);
    assert.equal(getRes.text.trim(), testPayload);
  });
});
