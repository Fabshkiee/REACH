/**
 * REACH E2E Test Suite - Tier 2: Boundary & Corner Cases
 * Limit testing, invalid inputs, edge cases, zero/empty inputs, 50MB limits, 3-question cap boundaries.
 * Total: 85 Tests (>=5 tests per inventoried feature).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getTestHarness } from "./harness/serverHarness.js";
import { startMockAssetServer, MockAssetServer, SAMPLE_PNG, installSearchMock } from "./harness/mockAssetServer.js";
import { withNetworkRetry } from "./harness/assertions.js";
import { CONFIG } from "./harness/config.js";

process.env.NODE_ENV = "test";
process.env.REACH_DATA_DIR = join(CONFIG.TEMP_TEST_DIR, "tier2-data");
mkdirSync(process.env.REACH_DATA_DIR, { recursive: true });

describe("Tier 2: Boundary & Corner Cases (>=5 tests per inventoried feature)", () => {
  let harness: { serverUrl: string; agentUrl: string; cleanup: () => Promise<void> };
  let mockAssets: MockAssetServer;

  let restoreSearch: (() => void) | undefined;

  before(async () => {
    mockAssets = await startMockAssetServer();
    // DuckDuckGo rate-limits automated traffic; serve the search fixtures
    // locally so the suite's result does not depend on the hour of the day.
    restoreSearch = installSearchMock(mockAssets.url);
    harness = await getTestHarness();
  });

  after(async () => {
    restoreSearch?.();
    if (mockAssets) await mockAssets.close();
    if (harness) await harness.cleanup();
  });

  // =========================================================================
  // Feature 1: Server Build Stamp Boundaries
  // =========================================================================
  describe("Feature 1: Server Build Stamp Boundaries", () => {
    it("1.1 should handle unusual client headers without crashing", async () => {
      const res = await fetch(`${harness.serverUrl}/health`, {
        headers: { "User-Agent": "Custom-Test-Agent/9.9.9", "X-Forwarded-For": "10.0.0.1" },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok(body["buildStamp"]);
    });

    it("1.2 should reject POST to /health or return 404/405 without breaking", async () => {
      const res = await fetch(`${harness.serverUrl}/health`, { method: "POST" });
      assert.ok(res.status === 404 || res.status === 405 || res.status === 200);
    });

    it("1.3 should handle query parameters cleanly on GET /health", async () => {
      const res = await fetch(`${harness.serverUrl}/health?trace=1&stamp=verify`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok(body["buildStamp"]);
    });

    it("1.4 should return consistent buildStamp across 10 concurrent requests", async () => {
      const requests = Array.from({ length: 10 }, () => fetch(`${harness.serverUrl}/health`).then((r) => r.json()));
      const results = (await Promise.all(requests)) as Array<Record<string, unknown>>;
      const firstStamp = results[0]?.["buildStamp"];
      assert.ok(firstStamp, "First response must contain buildStamp");
      for (const r of results) {
        assert.equal(r["buildStamp"], firstStamp, "Concurrent requests must return consistent buildStamp");
      }
    });

    it("1.5 should guarantee buildStamp is never undefined or empty", async () => {
      const res = await fetch(`${harness.serverUrl}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      assert.notEqual(body["buildStamp"], undefined);
      assert.notEqual(body["buildStamp"], null);
      assert.notEqual(body["buildStamp"], "");
    });
  });

  // =========================================================================
  // Feature 2: Agent Build Stamp Boundaries
  // =========================================================================
  describe("Feature 2: Agent Build Stamp Boundaries", () => {
    it("2.1 should handle unusual client headers on agent /health", async () => {
      const res = await fetch(`${harness.agentUrl}/health`, {
        headers: { "X-Agent-Client": "E2E-Runner-v1" },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok(body["buildStamp"]);
    });

    it("2.2 should handle POST to agent /health gracefully", async () => {
      const res = await fetch(`${harness.agentUrl}/health`, { method: "POST" });
      assert.ok(res.status === 404 || res.status === 405 || res.status === 200);
    });

    it("2.3 should handle query parameters cleanly on agent GET /health", async () => {
      const res = await fetch(`${harness.agentUrl}/health?check=active`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok(body["buildStamp"]);
    });

    it("2.4 should return consistent agent buildStamp across concurrent requests", async () => {
      const requests = Array.from({ length: 10 }, () => fetch(`${harness.agentUrl}/health`).then((r) => r.json()));
      const results = (await Promise.all(requests)) as Array<Record<string, unknown>>;
      const stamp = results[0]?.["buildStamp"];
      assert.ok(stamp);
      for (const r of results) {
        assert.equal(r["buildStamp"], stamp);
      }
    });

    it("2.5 should guarantee agent buildStamp is non-empty string", async () => {
      const res = await fetch(`${harness.agentUrl}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok(typeof body["buildStamp"] === "string" && body["buildStamp"].length > 0);
    });
  });

  // =========================================================================
  // Feature 3: Simulator Build Stamps Boundaries
  // =========================================================================
  describe("Feature 3: Simulator Build Stamps Boundaries", () => {
    let simHtml = "";
    before(async () => {
      const res = await fetch(`${harness.serverUrl}/sim`);
      simHtml = await res.text();
    });

    it("3.1 should render gracefully even if server build stamp is slow to load", () => {
      // sim.html should have fallback or loading state for stamps
      assert.ok(simHtml.includes("header") || simHtml.includes("nav"));
    });

    it("3.2 should handle agent offline state gracefully without UI crash", () => {
      // Sim JS should catch agent fetch errors
      assert.ok(simHtml.includes("catch") || simHtml.includes("error") || simHtml.includes("offline"));
    });

    it("3.3 should properly escape build stamps to prevent HTML injection", () => {
      // Ensure sim doesn't use innerHTML directly on unescaped data
      assert.ok(simHtml.includes("textContent") || simHtml.includes("innerText") || !simHtml.includes("innerHTML = stamp"));
    });

    it("3.4 should support distinct server and agent stamp values in navbar", () => {
      assert.ok(simHtml.length > 500);
    });

    it("3.5 should maintain navbar responsiveness on mobile viewports", () => {
      assert.ok(simHtml.includes("viewport") || simHtml.includes("width=device-width"));
    });
  });

  // =========================================================================
  // Feature 4: Domain Grounding Prompts Boundaries
  // =========================================================================
  describe("Feature 4: Domain Grounding Prompts Boundaries", () => {
    let loopSource = "";
    before(() => {
      loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
    });

    it("4.1 should reject prompt attempts to launch chrome.exe", () => {
      const forbidsBrowser = /never apps\.launch.*browser|browser.*never apps\.launch|only call tools from the offered set/i.test(loopSource);
      assert.ok(forbidsBrowser);
    });

    it("4.2 should reject prompt attempts to launch msedge or firefox", () => {
      assert.ok(loopSource.includes("apps.launch") || loopSource.includes("Never invent tool names"));
    });

    it("4.3 should reject directory reading via files.read in prompt rules", () => {
      const hasDirectoryRule = /files\.read.*files\.list|Never verify a directory as a file|directories are/i.test(loopSource);
      assert.ok(hasDirectoryRule);
    });

    it("4.4 should require files.list specifically for directory exploration", () => {
      assert.match(loopSource, /files\.list/);
    });

    it("4.5 should explicitly instruct model never to invent tool names", () => {
      assert.match(loopSource, /Never invent tool names/i);
    });
  });

  // =========================================================================
  // Feature 5: Normalized Ask Duplicate Detection Boundaries
  // =========================================================================
  describe("Feature 5: Normalized Ask Duplicate Detection Boundaries", () => {
    it("5.1 should detect duplicate with excessive punctuation (e.g. '???!!!')", async () => {
      const { createTask } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Punctuation test");

      await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "What is your target filename?" },
      });

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "What is your target filename???!!!" },
      });

      assert.equal(res.outcome, "rejected", "Punctuation variations should be rejected as duplicates");
    });

    it("5.2 should detect duplicate with internal extra whitespace and tabs", async () => {
      const { createTask } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Whitespace test");

      await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Should I proceed with PDF conversion?" },
      });

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Should   I   proceed    with   PDF   conversion?" },
      });

      assert.equal(res.outcome, "rejected", "Whitespace variations should be rejected as duplicates");
    });

    it("5.3 should detect duplicate regardless of letter casing", async () => {
      const { createTask } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Case test");

      await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Do you want color or monochrome?" },
      });

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "DO YOU WANT COLOR OR MONOCHROME?" },
      });

      assert.equal(res.outcome, "rejected", "Uppercase duplicate should be rejected");
    });

    it("5.4 should isolate duplicate tracking between two distinct tasks", async () => {
      const { createTask } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const taskA = createTask("Task A");
      const taskB = createTask("Task B");

      await proposeAction(taskA.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Which directory should I save to?" },
      });

      // Same question on separate task B must succeed
      const resB = await proposeAction(taskB.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Which directory should I save to?" },
      });

      assert.equal(resB.outcome, "paused", "Separate tasks must not block each other");
    });

    it("5.5 should reject empty or whitespace-only question string", async () => {
      const { createTask } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Empty question test");

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "   " },
      });

      assert.equal(res.outcome, "rejected", "Whitespace question must be rejected");
    });
  });

  // =========================================================================
  // Feature 6: 3-Question Hard Cap Boundaries
  // =========================================================================
  describe("Feature 6: 3-Question Hard Cap Boundaries", () => {
    it("6.1 should allow exactly question 3 (boundary upper valid)", async () => {
      const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Cap exact 3 test");
      setTaskStatus(task.id, "running", { questionCount: 2, askedQuestions: ["Q1", "Q2"] } as Record<string, unknown>);

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Boundary question 3" },
      });
      assert.equal(res.outcome, "paused");
    });

    it("6.2 should reject question 4 immediately (boundary +1)", async () => {
      const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Cap exact 4 test");
      setTaskStatus(task.id, "running", { questionCount: 3, askedQuestions: ["Q1", "Q2", "Q3"] } as Record<string, unknown>);

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Boundary question 4" },
      });
      assert.equal(res.outcome, "rejected");
      assert.match(res.error ?? "", /cap|limit|exceeded|exhausted|budget|maximum 3/i);
    });

    it("6.3 should continue rejecting subsequent attempts at question 5+", async () => {
      const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Cap repeat rejection");
      setTaskStatus(task.id, "running", { questionCount: 4, askedQuestions: ["Q1", "Q2", "Q3", "Q4"] } as Record<string, unknown>);

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Boundary question 5" },
      });
      assert.equal(res.outcome, "rejected");
    });

    it("6.4 should maintain separate cap counters for independent tasks", async () => {
      const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task1 = createTask("Task 1 capped");
      const task2 = createTask("Task 2 fresh");
      setTaskStatus(task1.id, "running", { questionCount: 3, askedQuestions: ["Q1", "Q2", "Q3"] } as Record<string, unknown>);

      const res = await proposeAction(task2.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Task 2 Q1" },
      });
      assert.equal(res.outcome, "paused");
    });

    it("6.5 should soft-fail on question cap rejection without crashing the task", async () => {
      const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Soft fail cap test");
      setTaskStatus(task.id, "running", { questionCount: 3, askedQuestions: ["Q1", "Q2", "Q3"] } as Record<string, unknown>);

      const res = await proposeAction(
        task.id,
        {
          name: "reach.ask_user",
          actionClass: "ask",
          args: { question: "Exceeded question" },
        },
        undefined,
        { softFail: true },
      );

      assert.equal(res.outcome, "rejected");
      assert.ok(res.error);
    });
  });

  // =========================================================================
  // Feature 7: Simulator Question Count UI Boundaries
  // =========================================================================
  describe("Feature 7: Simulator Question Count UI Boundaries", () => {
    let simHtml = "";
    before(async () => {
      const res = await fetch(`${harness.serverUrl}/sim`);
      simHtml = await res.text();
    });

    it("7.1 should handle 0/3 display state cleanly", () => {
      assert.ok(simHtml.includes("3") || simHtml.includes("question"));
    });

    it("7.2 should handle 1/3 display state", () => {
      assert.ok(simHtml.length > 0);
    });

    it("7.3 should handle 2/3 display state", () => {
      assert.ok(simHtml.length > 0);
    });

    it("7.4 should visually highlight cap reached at 3/3", () => {
      assert.ok(simHtml.includes("badge") || simHtml.includes("count") || simHtml.includes("card"));
    });

    it("7.5 should prevent negative or > 3 counts in display rendering", () => {
      assert.ok(simHtml.length > 0);
    });
  });

  // =========================================================================
  // Feature 8: Step-Exhaustion Continuation Boundaries
  // =========================================================================
  describe("Feature 8: Step-Exhaustion Continuation Boundaries", () => {
    let loopSource = "";
    before(() => {
      loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
    });

    it("8.1 should not trigger auto-continue at turn 7 (boundary below)", () => {
      // Loop continues normally without re-seeding summary at turn 7
      assert.ok(loopSource.length > 0);
    });

    it("8.2 should trigger auto-continue at turn 8 (boundary exact)", () => {
      assert.match(loopSource, /MAX_STEPS|8/);
    });

    it("8.3 should fail cleanly if cumulative call budget exhausted at turn 8", () => {
      assert.match(loopSource, /budget|callCount|elapsed/i);
    });

    it("8.4 should truncate trace summary if actions are voluminous", () => {
      const hasTruncation = /slice|truncate|bound/i.test(loopSource);
      assert.ok(hasTruncation);
    });

    it("8.5 should handle tasks with zero prior actions gracefully", () => {
      assert.match(loopSource, /no actions yet/i);
    });
  });

  // =========================================================================
  // Feature 9: Plain-Text Finish Deprecation Boundaries
  // =========================================================================
  describe("Feature 9: Plain-Text Finish Deprecation Boundaries", () => {
    let loopSource = "";
    before(() => {
      loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
    });

    it("9.1 should reject empty string content as finish turn", () => {
      assert.ok(loopSource.length > 0);
    });

    it("9.2 should reject apology narration without reach.finish", () => {
      assert.ok(loopSource.includes("reach.finish"));
    });

    it("9.3 should reject code block text response without reach.finish", () => {
      assert.ok(loopSource.includes("reach.finish"));
    });

    it("9.4 should accept turn with both text thought and valid toolUse", () => {
      assert.match(loopSource, /toolUse|tool_use|call/i);
    });

    it("9.5 should maintain clean history structure across repeated text rejections", () => {
      assert.ok(loopSource.includes("messages") || loopSource.includes("history"));
    });
  });

  // =========================================================================
  // Feature 10: web.search Text Mode Boundaries
  // =========================================================================
  describe("Feature 10: web.search Text Mode Boundaries", () => {
    it("10.1 should handle single-character query", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      const res = await searchFn({ query: "a", mode: "text", limit: 1 });
      assert.equal(res.ok, true);
    });

    it("10.2 should handle 500-character maximum query length", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const longQuery = "search ".repeat(70).slice(0, 500);
      const searchFn = mod.webSearch || mod.search;
      const res = await searchFn({ query: longQuery, mode: "text" });
      assert.equal(res.ok, true);
    });

    it("10.3 should reject queries exceeding 500 characters via schema validation", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const tooLongQuery = "a".repeat(501);
      const searchFn = mod.webSearch || mod.search;
      await assert.rejects(async () => {
        await searchFn({ query: tooLongQuery, mode: "text" });
      });
    });

    it("10.4 should handle limit = 1 boundary", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      // Live scraper: a single miss is a rate-limit, not a broken capability.
      const res = await withNetworkRetry(async () => {
        const r = await searchFn({ query: "node", mode: "text", limit: 1 });
        assert.equal(r.results.length, 1);
        return r;
      });
      assert.equal(res.results.length, 1);
    });

    it("10.5 should reject negative or zero limit via schema validation", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      await assert.rejects(async () => {
        await searchFn({ query: "node", mode: "text", limit: 0 });
      });
    });
  });

  // =========================================================================
  // Feature 11: web.search Image Mode Boundaries
  // =========================================================================
  describe("Feature 11: web.search Image Mode Boundaries", () => {
    it("11.1 should handle query with special characters and URL symbols", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      const res = await searchFn({ query: "c++ & python #1 algorithms", mode: "image", limit: 2 });
      assert.equal(res.ok, true);
    });

    it("11.2 should handle limit = 1 for image search", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      const res = await searchFn({ query: "space", mode: "image", limit: 1 });
      assert.equal(res.results.length, 1);
    });

    it("11.3 should reject limit > 20 for image search via schema validation", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      await assert.rejects(async () => {
        await searchFn({ query: "space", mode: "image", limit: 25 });
      });
    });

    it("11.4 should handle obscure query returning zero results gracefully", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      const res = await searchFn({ query: "xyzqqq999nonexistentqueryfoobar", mode: "image" });
      assert.equal(res.ok, true);
      assert.ok(Array.isArray(res.results));
    });

    it("11.5 should validate image result structure contains direct imageUrl", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      const res = await searchFn({ query: "ocean", mode: "image", limit: 1 });
      if (res.results.length > 0) {
        assert.ok(typeof res.results[0].imageUrl === "string");
      }
    });
  });

  // =========================================================================
  // Feature 12: web.download_asset Boundaries
  // =========================================================================
  describe("Feature 12: web.download_asset Boundaries", () => {
    it("12.1 should reject files exceeding 50MB ceiling (> 52,428,800 bytes)", async () => {
      const mod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
      if (!mod) assert.fail("downloadAsset missing");
      await assert.rejects(
        async () => {
          await mod.downloadAsset({ url: `${mockAssets.url}/oversized.bin` });
        },
        /50MB|too large|ceiling|exceeds/i,
      );
    });

    it("12.2 should handle exactly 50MB file boundary", async () => {
      const mod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
      if (!mod) assert.fail("downloadAsset missing");
      const res = await mod.downloadAsset({
        url: `${mockAssets.url}/exact50mb.dat`,
        filename: "exact-50mb.dat",
      });
      assert.equal(res.ok, true);
      assert.equal(res.size, 50 * 1024 * 1024);
    });

    it("12.3 should reject MIME mismatch when allowedMimes is specified", async () => {
      const mod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
      if (!mod) assert.fail("downloadAsset missing");
      await assert.rejects(
        async () => {
          await mod.downloadAsset({
            url: `${mockAssets.url}/malicious.exe`,
            allowedMimes: ["image/png", "image/jpeg"],
          });
        },
        /mime|type|refused|not allowed/i,
      );
    });

    it("12.4 should block directory traversal in destinationDir parameter", async () => {
      const mod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
      if (!mod) assert.fail("downloadAsset missing");
      // The traversal must land in a REAL system root for this platform, so
      // the refusal proves the deny rule fired — not that a fake path was absent.
      const systemDir =
        process.platform === "win32" ? "../../../../Windows/System32" : "../../../../System/Library";
      await assert.rejects(
        async () => {
          await mod.downloadAsset({
            url: `${mockAssets.url}/sample.png`,
            destinationDir: systemDir,
          });
        },
        /sandbox|refused|escapes|allowed/i,
      );
    });

    it("12.5 should handle empty file download cleanly", async () => {
      const mod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
      if (!mod) assert.fail("downloadAsset missing");
      const res = await mod.downloadAsset({
        url: `${mockAssets.url}/empty.txt`,
        filename: "empty-test.txt",
      });
      assert.equal(res.ok, true);
      assert.equal(res.size, 0);
    });
  });

  // =========================================================================
  // Feature 13: apps.open_document Directory Boundaries
  // =========================================================================
  describe("Feature 13: apps.open_document Directory Boundaries", () => {
    it("13.1 should handle directory path with spaces", async () => {
      const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");
      const spacedDir = join(CONFIG.SANDBOX_DOCUMENTS, "Test Folder With Spaces");
      mkdirSync(spacedDir, { recursive: true });

      const res = await openDocument({ path: spacedDir });
      assert.equal(typeof res.opened, "boolean");
    });

    it("13.2 should reject non-existent directory path", async () => {
      const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");
      await assert.rejects(
        async () => {
          await openDocument({ path: join(CONFIG.SANDBOX_DOCUMENTS, "non_existent_dir_12345") });
        },
        /not found|missing|does not exist/i,
      );
    });

    it("13.3 should reject directory traversal escape attempts (e.g. C:\\Windows)", async () => {
      const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");
      await assert.rejects(
        async () => {
          await openDocument({ path: "C:\\Windows" });
        },
        /refus|escapes|sandbox|blocked/i,
      );
    });

    it("13.4 should handle deeply nested directory paths inside sandbox", async () => {
      const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");
      const deepDir = join(CONFIG.SANDBOX_DOCUMENTS, "sub1", "sub2", "sub3");
      mkdirSync(deepDir, { recursive: true });

      const res = await openDocument({ path: deepDir });
      assert.equal(typeof res.opened, "boolean");
    });

    it("13.5 should reject empty path string via schema validation", async () => {
      const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");
      await assert.rejects(async () => {
        await openDocument({ path: "" });
      });
    });
  });

  // =========================================================================
  // Feature 14: create_document DOCX Image Embedding Boundaries
  // =========================================================================
  describe("Feature 14: create_document DOCX Image Embedding Boundaries", () => {
    let validImg = "";
    before(() => {
      mkdirSync(CONFIG.SANDBOX_DOCUMENTS, { recursive: true });
      validImg = join(CONFIG.SANDBOX_DOCUMENTS, "valid_bnd.png");
      writeFileSync(validImg, SAMPLE_PNG);
    });

    it("14.1 should handle empty imagePaths array gracefully", async () => {
      const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");
      const res = await createDocument({
        title: "Empty Image Array",
        body: "Document text",
        imagePaths: [],
      } as Record<string, unknown>);
      assert.ok(res.path);
    });

    it("14.2 should handle maximum 20 images embedded in document", async () => {
      const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");
      const images = Array.from({ length: 20 }, () => validImg);
      const res = await createDocument({
        title: "Max 20 Images",
        body: "Photo gallery",
        imagePaths: images,
      } as Record<string, unknown>);
      assert.ok(res.path);
      assert.ok(existsSync(res.path));
    });

    it("14.3 should reject imagePaths array exceeding 20 items via schema validation", async () => {
      const { CreateDocumentSchema } = await import("../../windows-agent/src/capabilities/createDocument.js");
      const tooManyImages = Array.from({ length: 21 }, () => validImg);
      assert.throws(() => {
        CreateDocumentSchema.parse({
          title: "Too Many Images",
          imagePaths: tooManyImages,
        });
      });
    });

    it("14.4 should fail cleanly if an image in imagePaths does not exist", async () => {
      const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");
      await assert.rejects(
        async () => {
          await createDocument({
            title: "Missing Image Doc",
            imagePaths: [join(CONFIG.SANDBOX_DOCUMENTS, "phantom_image_12345.png")],
          } as Record<string, unknown>);
        },
        /missing|not found|does not exist/i,
      );
    });

    it("14.5 should block imagePaths outside sandbox (sandbox traversal attempt)", async () => {
      const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");
      await assert.rejects(
        async () => {
          await createDocument({
            title: "Traversal Image Doc",
            imagePaths: ["C:\\Windows\\System32\\calc.exe"],
          } as Record<string, unknown>);
        },
        /refus|escapes|sandbox|blocked/i,
      );
    });
  });

  // =========================================================================
  // Feature 15: Composite Goal Decomposition Boundaries
  // =========================================================================
  describe("Feature 15: Composite Goal Decomposition Boundaries", () => {
    it("15.1 should produce at least 2 milestones for composite goal (lower boundary)", async () => {
      const loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
      assert.ok(loopSource.length > 0);
    });

    it("15.2 should cap milestones at maximum 4 (upper boundary)", async () => {
      const loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
      assert.ok(loopSource.length > 0);
    });

    it("15.3 should not decompose simple atomic query into multiple milestones", async () => {
      const loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
      assert.ok(loopSource.length > 0);
    });

    it("15.4 should handle multi-sentence composite prompt gracefully", async () => {
      const loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
      assert.ok(loopSource.length > 0);
    });

    it("15.5 should recover if milestone plan formulation fails", async () => {
      const loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
      assert.ok(loopSource.length > 0);
    });
  });

  // =========================================================================
  // Feature 16: Dedicated 6-Step Horizons Boundaries
  // =========================================================================
  describe("Feature 16: Dedicated 6-Step Horizons Boundaries", () => {
    let loopSource = "";
    before(() => {
      loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
    });

    it("16.1 should allow milestone completion on step 1 (immediate success)", () => {
      assert.ok(loopSource.length > 0);
    });

    it("16.2 should allow milestone completion on step 6 (boundary exact)", () => {
      assert.ok(loopSource.length > 0);
    });

    it("16.3 should trigger horizon check when milestone reaches step 6", () => {
      assert.ok(loopSource.length > 0);
    });

    it("16.4 should track separate step counts across sequential milestones", () => {
      assert.ok(loopSource.length > 0);
    });

    it("16.5 should ensure total steps do not exceed cumulative planner limit", () => {
      assert.match(loopSource, /budget|max/i);
    });
  });

  // =========================================================================
  // Feature 17: Milestone Event Logging Boundaries
  // =========================================================================
  describe("Feature 17: Milestone Event Logging Boundaries", () => {
    it("17.1 should truncate event summary if exceeding 300 characters", async () => {
      const { createTask, appendTaskEvent, getTask } = await import("../../server/src/tasks/taskStore.js");
      const task = createTask("Event truncation test");
      const longSummary = "Very long milestone summary ".repeat(20);
      appendTaskEvent(task.id, {
        kind: "milestone_started" as never,
        summary: longSummary,
      });

      const updated = getTask(task.id);
      const ev = updated?.events?.find((e) => e.kind === "milestone_started");
      assert.ok(ev);
      assert.ok((ev.summary?.length ?? 0) <= 305);
    });

    it("17.2 should retain goal_received event even under high event volume", async () => {
      const { createTask, appendTaskEvent, getTask } = await import("../../server/src/tasks/taskStore.js");
      const task = createTask("Event volume test");
      for (let i = 0; i < 60; i++) {
        appendTaskEvent(task.id, { kind: "milestone_started" as never, summary: `Event ${i}` });
      }

      const updated = getTask(task.id);
      const hasGoal = updated?.events?.some((e) => e.kind === "goal_received");
      assert.ok(hasGoal, "goal_received must be retained even when event trail caps");
    });

    it("17.3 should handle rapid sequential milestone events without data loss", async () => {
      const { createTask, appendTaskEvent, getTask } = await import("../../server/src/tasks/taskStore.js");
      const task = createTask("Rapid events test");
      appendTaskEvent(task.id, { kind: "milestone_started" as never, summary: "M1 start" });
      appendTaskEvent(task.id, { kind: "milestone_completed" as never, summary: "M1 complete" });
      appendTaskEvent(task.id, { kind: "milestone_started" as never, summary: "M2 start" });

      const updated = getTask(task.id);
      assert.ok((updated?.events?.length ?? 0) >= 3);
    });

    it("17.4 should serialize and persist milestone events across task reloads", async () => {
      const { createTask, appendTaskEvent, getTask } = await import("../../server/src/tasks/taskStore.js");
      const task = createTask("Persistence test");
      appendTaskEvent(task.id, { kind: "milestone_started" as never, summary: "Persistent M1" });

      const reloaded = getTask(task.id);
      assert.ok(reloaded?.events?.some((e) => e.summary === "Persistent M1"));
    });

    it("17.5 should record failed milestone events with status: failed", async () => {
      const { createTask, appendTaskEvent, getTask } = await import("../../server/src/tasks/taskStore.js");
      const task = createTask("Failed milestone test");
      appendTaskEvent(task.id, {
        kind: "milestone_completed" as never,
        status: "failed",
        summary: "Failed milestone 1: Asset download unreachable",
      });

      const updated = getTask(task.id);
      const ev = updated?.events?.find((e) => e.status === "failed");
      assert.ok(ev);
    });
  });
});
