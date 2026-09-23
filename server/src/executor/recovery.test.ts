import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_AUTONOMOUS_RECOVERIES,
  failureFeedback,
  recoveryHintCode,
  recoveryHintFor,
} from "./recovery.js";

describe("recovery hints (failure shape, never goal text)", () => {
  it("maps size errors to paging", () => {
    assert.equal(recoveryHintCode("read", "file too large (21701342 bytes, cap 2097152)"), "too_large");
    assert.ok((recoveryHintFor("read", "file too large (1 bytes, cap 2)") ?? "").includes("offsetChars"));
  });

  it("maps directory/file confusion to the sibling tool", () => {
    assert.equal(
      recoveryHintCode("observe", "not a file: C:\\x — it is a directory; use files.list on it instead"),
      "is_directory",
    );
    assert.equal(
      recoveryHintCode("search", "not a directory: C:\\x.pdf — it is a file; use files.read or files.verify on it instead"),
      "is_file",
    );
  });

  it("maps missing targets, bad args, timeouts, devices, denials", () => {
    assert.equal(recoveryHintCode("read", "no such file: C:\\nope"), "not_found");
    assert.equal(recoveryHintCode("read", "invalid args for test.step: bad-args here"), "bad_args");
    assert.equal(recoveryHintCode("read", "agent call timed out after 60000ms"), "timeout");
    assert.equal(recoveryHintCode("read", "no capable device online"), "device_offline");
    assert.equal(recoveryHintCode("read", 'no registered capability named "x"'), "no_capability");
    assert.equal(recoveryHintCode("delete", "denied: outside user-owned space"), "denied");
  });

  it("maps page rejections for interact-class and browser errors", () => {
    assert.equal(
      recoveryHintCode("interact", "browser.click error: ref e12 not found"),
      "page_rejected",
    );
    assert.ok((recoveryHintFor("interact", "browser.click error: ref e12 not found") ?? "").includes("Re-observe"));
  });

  it("returns undefined when nothing matches", () => {
    assert.equal(recoveryHintFor("read", "some totally novel failure mode"), undefined);
    assert.equal(recoveryHintCode("read", "some totally novel failure mode"), undefined);
  });
});

describe("failure feedback (recover, then ask)", () => {
  it("first failure invites one changed approach with the hint", () => {
    const fb = failureFeedback({ error: "boom", hint: "try Y", consecutiveFailures: 1 });
    assert.match(fb, /FAILED: boom/);
    assert.match(fb, /try Y/);
    assert.match(fb, /changed approach/);
    assert.doesNotMatch(fb, /ask_user/);
  });

  it("at the recovery budget it orders ask_user over blind retry", () => {
    const fb = failureFeedback({ error: "boom again", consecutiveFailures: MAX_AUTONOMOUS_RECOVERIES });
    assert.match(fb, /reach\.ask_user/);
    assert.match(fb, /concrete options/);
    assert.doesNotMatch(fb, /changed approach/);
  });
});
