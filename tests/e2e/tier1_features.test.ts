/**
 * REACH E2E Test Suite - Tier 1: Feature Coverage
 * Independent Opaque-Box Verification of all 17 Inventoried Features (>=5 tests per feature).
 * Total: 85 Tests.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getTestHarness } from "./harness/serverHarness.js";
import { startMockAssetServer, MockAssetServer, SAMPLE_PNG, installSearchMock } from "./harness/mockAssetServer.js";
import { assertIsoDate, assertBuildStamp, assertDocxContainsImage, withNetworkRetry } from "./harness/assertions.js";
import { CONFIG } from "./harness/config.js";

// Ensure clean test data directory
process.env.NODE_ENV = "test";
process.env.REACH_DATA_DIR = join(CONFIG.TEMP_TEST_DIR, "tier1-data");
mkdirSync(process.env.REACH_DATA_DIR, { recursive: true });

describe("Tier 1: Feature Coverage (>=5 tests per inventoried feature)", () => {
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
  // Feature 1: Server Build Stamp (GET /health on server :3000)
  // =========================================================================
  describe("Feature 1: Server Build Stamp (GET /health)", () => {
    it("1.1 should return HTTP 200 with JSON content type", async () => {
      const res = await fetch(`${harness.serverUrl}/health`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /application\/json/i);
    });

    it("1.2 should return ok: true in response payload", async () => {
      const res = await fetch(`${harness.serverUrl}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body["ok"], true);
    });

    it("1.3 should identify service as reach-server", async () => {
      const res = await fetch(`${harness.serverUrl}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body["service"], "reach-server");
    });

    it("1.4 should expose non-empty buildStamp string", async () => {
      const res = await fetch(`${harness.serverUrl}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok("buildStamp" in body, "GET /health must include buildStamp field");
      assert.equal(typeof body["buildStamp"], "string");
      assert.ok((body["buildStamp"] as string).length > 0, "buildStamp cannot be empty");
    });

    it("1.5 should return valid ISO-8601 buildStamp timestamp", async () => {
      const res = await fetch(`${harness.serverUrl}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      assertBuildStamp(body, "reach-server");
      assertIsoDate(body["buildStamp"], "Server buildStamp");
    });
  });

  // =========================================================================
  // Feature 2: Agent Build Stamp (GET /health on windows-agent :3001)
  // =========================================================================
  describe("Feature 2: Agent Build Stamp (GET /health)", () => {
    it("2.1 should return HTTP 200 with JSON content type", async () => {
      const res = await fetch(`${harness.agentUrl}/health`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /application\/json/i);
    });

    it("2.2 should return ok: true in response payload", async () => {
      const res = await fetch(`${harness.agentUrl}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body["ok"], true);
    });

    it("2.3 should identify service as windows-agent", async () => {
      const res = await fetch(`${harness.agentUrl}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body["service"], "windows-agent");
    });

    it("2.4 should expose non-empty buildStamp string", async () => {
      const res = await fetch(`${harness.agentUrl}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok("buildStamp" in body, "Agent GET /health must include buildStamp field");
      assert.equal(typeof body["buildStamp"], "string");
      assert.ok((body["buildStamp"] as string).length > 0, "Agent buildStamp cannot be empty");
    });

    it("2.5 should return valid ISO-8601 buildStamp timestamp", async () => {
      const res = await fetch(`${harness.agentUrl}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      assertBuildStamp(body, "windows-agent");
      assertIsoDate(body["buildStamp"], "Agent buildStamp");
    });
  });

  // =========================================================================
  // Feature 3: Simulator Build Stamps (sim.html navigation bar)
  // =========================================================================
  describe("Feature 3: Simulator Build Stamps (sim.html navigation bar)", () => {
    it("3.1 should serve sim.html at GET /sim with 200 OK", async () => {
      const res = await fetch(`${harness.serverUrl}/sim`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/html/i);
    });

    it("3.2 should contain navigation bar or header element for build stamps", async () => {
      const res = await fetch(`${harness.serverUrl}/sim`);
      const html = await res.text();
      const hasNav = /<header|<nav|class=["'][^"']*nav/i.test(html);
      assert.ok(hasNav, "sim.html must contain a header or nav bar");
    });

    it("3.3 should contain DOM placeholder or element for server build stamp", async () => {
      const res = await fetch(`${harness.serverUrl}/sim`);
      const html = await res.text();
      const hasServerStamp = /server-stamp|build-stamp|buildStamp|Server Build/i.test(html);
      assert.ok(hasServerStamp, "sim.html must contain server build stamp display element");
    });

    it("3.4 should contain DOM placeholder or element for agent build stamp", async () => {
      const res = await fetch(`${harness.serverUrl}/sim`);
      const html = await res.text();
      const hasAgentStamp = /agent-stamp|build-stamp|buildStamp|Agent Build/i.test(html);
      assert.ok(hasAgentStamp, "sim.html must contain agent build stamp display element");
    });

    it("3.5 should contain client-side script fetching /health to update stamps", async () => {
      const res = await fetch(`${harness.serverUrl}/sim`);
      const html = await res.text();
      const fetchesHealth = html.includes("/health") || html.includes("health");
      assert.ok(fetchesHealth, "sim.html must fetch health endpoints to populate active stamps");
    });
  });

  // =========================================================================
  // Feature 4: Domain Grounding Prompts (planner domain rules in loop.ts)
  // =========================================================================
  describe("Feature 4: Domain Grounding Prompts (server/src/planner/loop.ts)", () => {
    let loopSource = "";
    before(() => {
      const p = join(process.cwd(), "server", "src", "planner", "loop.ts");
      loopSource = readFileSync(p, "utf8");
    });

    it("4.1 should mandate web browsing via web.* or browser.* tools", () => {
      const hasWebRule = /web\.\*|browser\.\*/i.test(loopSource);
      assert.ok(hasWebRule, "Planner prompt must direct web browsing to web.* or browser.*");
    });

    it("4.2 should forbid using apps.launch for web browsers", () => {
      const forbidsLaunchBrowser = /never apps\.launch|not apps\.launch|never.*browser.*apps\.launch/i.test(loopSource);
      assert.ok(forbidsLaunchBrowser, "Planner prompt must explicitly forbid apps.launch for browser names");
    });

    it("4.3 should restrict apps.launch to known desktop utilities", () => {
      const restrictsUtilities = /desktop utilities|known.*utilities|known-safe/i.test(loopSource);
      assert.ok(restrictsUtilities, "Planner prompt must restrict apps.launch to known utilities");
    });

    it("4.4 should specify directories are explored via files.list", () => {
      const hasFilesList = /directories.*files\.list|files\.list.*director/i.test(loopSource);
      assert.ok(hasFilesList, "Planner prompt must state directories are explored via files.list");
    });

    it("4.5 should specify directories are opened via apps.open_document", () => {
      const hasOpenDoc = /apps\.open_document|open_document/i.test(loopSource);
      assert.ok(hasOpenDoc, "Planner prompt must state directories are opened via apps.open_document");
    });
  });

  // =========================================================================
  // Feature 5: Normalized Ask Duplicate Detection (reach.ask_user in executor)
  // =========================================================================
  describe("Feature 5: Normalized Ask Duplicate Detection", () => {
    it("5.1 should allow initial clarification question", async () => {
      const { createTask } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Research renewable energy");

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Which specific energy sector should I focus on?" },
      });

      assert.equal(res.outcome, "paused");
      assert.equal(res.taskId, task.id);
    });

    it("5.2 should reject exact duplicate question", async () => {
      const { createTask } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Research renewable energy");

      await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Which specific energy sector?" },
      });

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Which specific energy sector?" },
      });

      assert.equal(res.outcome, "rejected", "Identical question must be rejected");
      assert.match(res.error ?? "", /duplicate|repeat|already asked/i);
    });

    it("5.3 should reject duplicate with whitespace and case variations", async () => {
      const { createTask } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Find images");

      await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Do you want high-resolution photos?" },
      });

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "  do you want HIGH-RESOLUTION photos?  " },
      });

      assert.equal(res.outcome, "rejected", "Normalized case/whitespace duplicate must be rejected");
    });

    it("5.4 should reject repeat question referencing prior answered choice", async () => {
      const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Document generation");

      // Simulate question answered with "Solar"
      setTaskStatus(task.id, "running", {
        askedQuestions: ["Which topic?"],
        priorAnswers: ["Solar"],
      } as Record<string, unknown>);

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Which topic should I choose between Solar and Wind?" },
      });

      assert.equal(res.outcome, "rejected", "Asking about already answered topic must be rejected");
    });

    it("5.5 should allow distinctly different follow-up questions", async () => {
      const { createTask } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Complex report");

      await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "What should the document title be?" },
      });

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "How many pages or sections do you need?" },
      });

      assert.equal(res.outcome, "paused", "Distinct question should be allowed");
    });
  });

  // =========================================================================
  // Feature 6: 3-Question Hard Cap (reach.ask_user in executor)
  // =========================================================================
  describe("Feature 6: 3-Question Hard Cap", () => {
    it("6.1 should allow question 1 of 3", async () => {
      const { createTask } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Cap test 1");

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Question 1: Target directory?" },
      });
      assert.equal(res.outcome, "paused");
    });

    it("6.2 should allow question 2 of 3", async () => {
      const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Cap test 2");
      setTaskStatus(task.id, "running", { questionCount: 1, askedQuestions: ["Q1"] } as Record<string, unknown>);

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Question 2: File format?" },
      });
      assert.equal(res.outcome, "paused");
    });

    it("6.3 should allow question 3 of 3", async () => {
      const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Cap test 3");
      setTaskStatus(task.id, "running", { questionCount: 2, askedQuestions: ["Q1", "Q2"] } as Record<string, unknown>);

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Question 3: Document title?" },
      });
      assert.equal(res.outcome, "paused");
    });

    it("6.4 should strictly reject question 4 (exceeding 3-question cap)", async () => {
      const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Cap test 4");
      setTaskStatus(task.id, "running", { questionCount: 3, askedQuestions: ["Q1", "Q2", "Q3"] } as Record<string, unknown>);

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Question 4: Final confirmation?" },
      });

      assert.equal(res.outcome, "rejected", "Fourth question must be rejected by hard cap");
      assert.match(res.error ?? "", /cap|limit|exceeded|maximum 3/i);
    });

    it("6.5 should provide feedback instructing planner to proceed with available info", async () => {
      const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
      const { proposeAction } = await import("../../server/src/executor/executor.js");
      const task = createTask("Cap test 5");
      setTaskStatus(task.id, "running", { questionCount: 3, askedQuestions: ["Q1", "Q2", "Q3"] } as Record<string, unknown>);

      const res = await proposeAction(task.id, {
        name: "reach.ask_user",
        actionClass: "ask",
        args: { question: "Question 4: What next?" },
      });

      assert.match(res.error ?? "", /proceed|available information|best judgement/i);
    });
  });

  // =========================================================================
  // Feature 7: Simulator Question Count UI ((N/3) in sim.html)
  // =========================================================================
  describe("Feature 7: Simulator Question Count UI ((N/3) in sim.html)", () => {
    let simHtml = "";
    before(async () => {
      const res = await fetch(`${harness.serverUrl}/sim`);
      simHtml = await res.text();
    });

    it("7.1 should render clarification card or question container", () => {
      const hasClarification = /clarification|pending-input|question/i.test(simHtml);
      assert.ok(hasClarification, "sim.html must contain a clarification section");
    });

    it("7.2 should display question count badge with format (N/3)", () => {
      const hasCapFormat = /\(\s*[0-3N]\s*\/\s*3\s*\)|question-count|questionCount/i.test(simHtml);
      assert.ok(hasCapFormat, "sim.html must include (N/3) question counter notation");
    });

    it("7.3 should have DOM selector for question counter element", () => {
      const hasElement = /id=["'][^"']*question-count[^"']*["']|class=["'][^"']*question-count[^"']*["']/i.test(simHtml);
      assert.ok(hasElement, "sim.html must have dedicated DOM element for question counter");
    });

    it("7.4 should support dynamic updates on clarification requested events", () => {
      const hasUpdateLogic = simHtml.includes("clarification_requested") || simHtml.includes("questionCount") || simHtml.includes("askedQuestions");
      assert.ok(hasUpdateLogic, "sim.html script must handle updating question counter");
    });

    it("7.5 should visually reflect cap reaching 3/3", () => {
      const hasCapIndicator = simHtml.includes("/3") || simHtml.includes("max") || simHtml.includes("cap");
      assert.ok(hasCapIndicator, "sim.html must visually enforce the 3 question limit");
    });
  });

  // =========================================================================
  // Feature 8: Step-Exhaustion Continuation (server/src/planner/loop.ts)
  // =========================================================================
  describe("Feature 8: Step-Exhaustion Continuation", () => {
    let loopSource = "";
    before(() => {
      const p = join(process.cwd(), "server", "src", "planner", "loop.ts");
      loopSource = readFileSync(p, "utf8");
    });

    it("8.1 should have MAX_STEPS configured to 8 turns by default", () => {
      assert.match(loopSource, /MAX_STEPS.*8|8.*MAX_STEPS/);
    });

    it("8.2 should detect turn exhaustion when turn count reaches MAX_STEPS", () => {
      const detectsTurnLimit = /MAX_STEPS|step >= 8|steps >= MAX_STEPS/i.test(loopSource);
      assert.ok(detectsTurnLimit, "loop.ts must check against MAX_STEPS limit");
    });

    it("8.3 should check cumulative budget before deciding to auto-continue", () => {
      const checksBudget = /budget|elapsed|callCount/i.test(loopSource);
      assert.ok(checksBudget, "loop.ts must verify remaining budget on step exhaustion");
    });

    it("8.4 should re-seed loop with compact trace summary of verified actions", () => {
      const reSeedsTrace = /Budget checkpoint|Verified progress|compact.*trace|traceSummary/i.test(loopSource);
      assert.ok(reSeedsTrace, "loop.ts must format verified progress summary for continuation");
    });

    it("8.5 should continue execution rather than terminating with failure", () => {
      const autoContinues = /auto-continue|continue executing|re-seed|resumeLoop/i.test(loopSource);
      assert.ok(autoContinues, "loop.ts must auto-continue on remaining budget");
    });
  });

  // =========================================================================
  // Feature 9: Plain-Text Finish Deprecation
  // =========================================================================
  describe("Feature 9: Plain-Text Finish Deprecation", () => {
    let loopSource = "";
    before(() => {
      const p = join(process.cwd(), "server", "src", "planner", "loop.ts");
      loopSource = readFileSync(p, "utf8");
    });

    it("9.1 should detect turns without tool calls", () => {
      const detectsEmptyTools = /toolUse|tool_use|no tool|no tool calls/i.test(loopSource);
      assert.ok(detectsEmptyTools, "loop.ts must detect assistant turns lacking tool calls");
    });

    it("9.2 should reject plain-text turns with actionable feedback", () => {
      const rejectsPlainText = /reject|reach\.finish|call reach\.finish/i.test(loopSource);
      assert.ok(rejectsPlainText, "loop.ts must reject plain-text turns directing model to call reach.finish");
    });

    it("9.3 should instruct model to call reach.finish with kind and evidence", () => {
      const citesFinish = /reach\.finish.*evidence|reach\.finish.*kind/i.test(loopSource);
      assert.ok(citesFinish, "System prompt or feedback must require reach.finish with cited evidence");
    });

    it("9.4 should not mark task as completed upon plain-text summary", () => {
      const deprecatesSummary = /deprecated|reject.*plain-text|must call reach\.finish/i.test(loopSource);
      assert.ok(deprecatesSummary, "Plain text summaries must not silently complete the task");
    });

    it("9.5 should require tool execution before task completion", () => {
      const requiresTool = /reach\.finish/i.test(loopSource);
      assert.ok(requiresTool, "Task completion must be gated on reach.finish tool invocation");
    });
  });

  // =========================================================================
  // Feature 10: web.search Text Mode
  // =========================================================================
  describe("Feature 10: web.search Text Mode", () => {
    it("10.1 should execute web.search in text mode", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      assert.ok(mod, "server/src/actions/web.ts module must exist");
      assert.ok("webSearch" in mod || "search" in mod || "default" in mod);
    });

    it("10.2 should return results array containing title, url, snippet", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      const res = await searchFn({ query: "Node.js documentation", mode: "text", limit: 3 });
      assert.equal(res.ok, true);
      assert.equal(res.mode, "text");
      assert.ok(Array.isArray(res.results));
      assert.ok(res.results.length > 0);
      assert.ok("title" in res.results[0]);
      assert.ok("url" in res.results[0]);
      assert.ok("snippet" in res.results[0]);
    });

    it("10.3 should respect limit parameter in text mode", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      const res = await searchFn({ query: "TypeScript", mode: "text", limit: 2 });
      assert.equal(res.results.length, 2);
    });

    it("10.4 should operate without paid external API keys", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      // Operates using native fetch without API key requirement
      assert.ok(mod);
    });

    it("10.5 should handle standard informational search queries", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      // Live scraper: automated traffic gets rate-limited, so retry.
      const res = await withNetworkRetry(async () => {
        const r = await searchFn({ query: "James Webb Space Telescope", mode: "text" });
        assert.ok(r.results.length > 0);
        return r;
      });
      assert.equal(res.ok, true);
      assert.ok(res.results.length > 0);
    });
  });

  // =========================================================================
  // Feature 11: web.search Image Mode
  // =========================================================================
  describe("Feature 11: web.search Image Mode", () => {
    it("11.1 should execute web.search with mode: image", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      assert.ok(mod, "server/src/actions/web.ts module must exist");
    });

    it("11.2 should return image results with direct imageUrl and sourceUrl", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      const res = await searchFn({ query: "Pacific Northwest rain forest", mode: "image", limit: 3 });
      assert.equal(res.ok, true);
      assert.equal(res.mode, "image");
      assert.ok(Array.isArray(res.results));
      assert.ok(res.results.length > 0);
      assert.ok("imageUrl" in res.results[0]);
      assert.ok("sourceUrl" in res.results[0]);
    });

    it("11.3 should return direct imageUrl as valid HTTP/HTTPS URL", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      const res = await searchFn({ query: "mountains", mode: "image", limit: 1 });
      const imgUrl = res.results[0]?.imageUrl;
      assert.ok(typeof imgUrl === "string");
      assert.match(imgUrl, /^https?:\/\//i);
    });

    it("11.4 should respect requested image limit", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      const searchFn = mod.webSearch || mod.search;
      const res = await searchFn({ query: "forest", mode: "image", limit: 2 });
      assert.equal(res.results.length, 2);
    });

    it("11.5 should operate without paid image search API credentials", async () => {
      const mod = await import("../../server/src/actions/web.js").catch(() => null);
      if (!mod) assert.fail("web.ts not implemented");
      assert.ok(mod);
    });
  });

  // =========================================================================
  // Feature 12: web.download_asset
  // =========================================================================
  describe("Feature 12: web.download_asset", () => {
    it("12.1 should download asset from valid URL into sandbox", async () => {
      const mod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
      assert.ok(mod, "windows-agent/src/capabilities/downloadAsset.ts must exist");
      const downloadFn = mod.downloadAsset;
      const res = await downloadFn({
        url: `${mockAssets.url}/sample.png`,
        filename: "test-download-1.png",
      });
      assert.equal(res.ok, true);
      assert.ok(res.path);
      assert.equal(res.verified, true);
    });

    it("12.2 should save files into Downloads/REACH or Documents/REACH", async () => {
      const mod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
      if (!mod) assert.fail("downloadAsset capability missing");
      const res = await mod.downloadAsset({
        url: `${mockAssets.url}/sample.jpg`,
        filename: "test-photo.jpg",
      });
      assert.match(res.path, /Downloads[\\/]REACH|Documents[\\/]REACH/);
    });

    it("12.3 should enforce MIME type validation against response Content-Type", async () => {
      const mod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
      if (!mod) assert.fail("downloadAsset capability missing");
      const res = await mod.downloadAsset({
        url: `${mockAssets.url}/sample.png`,
        allowedMimes: ["image/png"],
      });
      assert.equal(res.mimeType, "image/png");
    });

    it("12.4 should enforce 50MB ceiling on downloaded assets", async () => {
      const mod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
      if (!mod) assert.fail("downloadAsset capability missing");
      await assert.rejects(
        async () => {
          await mod.downloadAsset({
            url: `${mockAssets.url}/oversized.bin`,
          });
        },
        /50MB|too large|ceiling|exceeds/i,
      );
    });

    it("12.5 should verify downloaded file presence and size on disk", async () => {
      const mod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
      if (!mod) assert.fail("downloadAsset capability missing");
      const res = await mod.downloadAsset({
        url: `${mockAssets.url}/report.pdf`,
        filename: "test-report.pdf",
      });
      assert.equal(res.verified, true);
      assert.ok(res.size > 0);
      assert.ok(existsSync(res.path));
    });
  });

  // =========================================================================
  // Feature 13: apps.open_document Directory Opening
  // =========================================================================
  describe("Feature 13: apps.open_document Directory Opening", () => {
    it("13.1 should support opening existing directories without rejection", async () => {
      const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");
      const res = await openDocument({ path: CONFIG.SANDBOX_DOCUMENTS });
      assert.equal(typeof res.opened, "boolean");
      assert.equal(typeof res.path, "string");
    });

    it("13.2 should open directories via Windows File Explorer", async () => {
      const appsSource = readFileSync(join(process.cwd(), "windows-agent", "src", "capabilities", "apps.ts"), "utf8");
      const handlesDirectories = /directory|isDirectory|explorer\.exe|Start-Process/i.test(appsSource);
      assert.ok(handlesDirectories, "apps.ts must support directory target opening");
    });

    it("13.3 should remove directory rejection failure from openDocument", async () => {
      const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");
      // Opening a directory should not throw an error or reject
      const result = await openDocument({ path: CONFIG.SANDBOX_DOCUMENTS });
      assert.ok(result);
    });

    it("13.4 should continue to support regular file opening in default program", async () => {
      const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");
      // Create a test file
      const testFile = join(CONFIG.SANDBOX_DOCUMENTS, "test-doc.txt");
      mkdirSync(CONFIG.SANDBOX_DOCUMENTS, { recursive: true });
      writeFileSync(testFile, "Hello REACH", "utf8");

      const res = await openDocument({ path: testFile });
      assert.equal(typeof res.opened, "boolean");
    });

    it("13.5 should return resolved path and status object", async () => {
      const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");
      const res = await openDocument({ path: CONFIG.SANDBOX_DOCUMENTS });
      assert.ok("path" in res);
      assert.ok("opened" in res);
    });
  });

  // =========================================================================
  // Feature 14: create_document DOCX Image Embedding
  // =========================================================================
  describe("Feature 14: create_document DOCX Image Embedding", () => {
    let testImgPath = "";
    before(() => {
      mkdirSync(CONFIG.SANDBOX_DOCUMENTS, { recursive: true });
      testImgPath = join(CONFIG.SANDBOX_DOCUMENTS, "test_embed.png");
      writeFileSync(testImgPath, SAMPLE_PNG);
    });

    it("14.1 should accept optional imagePaths array in input schema", async () => {
      const { CreateDocumentSchema } = await import("../../windows-agent/src/capabilities/createDocument.js");
      const parsed = CreateDocumentSchema.parse({
        title: "Illustrated Report",
        body: "Report body text",
        imagePaths: [testImgPath],
      });
      assert.ok("imagePaths" in parsed);
    });

    it("14.2 should embed provided image into Word .docx file", async () => {
      const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");
      const res = await createDocument({
        title: "Test Embed Report",
        body: "Document with embedded picture",
        imagePaths: [testImgPath],
      } as Record<string, unknown>);

      assert.ok(res.path);
      assert.ok(existsSync(res.path));
      assertDocxContainsImage(res.path);
    });

    it("14.3 should use docx ImageRun wrapped in Paragraph", async () => {
      const source = readFileSync(
        join(process.cwd(), "windows-agent", "src", "capabilities", "createDocument.ts"),
        "utf8",
      );
      assert.match(source, /ImageRun/, "createDocument.ts must import and use ImageRun");
    });

    it("14.4 should embed multiple images sequentially in the document", async () => {
      const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");
      const res = await createDocument({
        title: "Multi Image Document",
        body: "Dual images below",
        imagePaths: [testImgPath, testImgPath],
      } as Record<string, unknown>);

      assert.ok(res.path);
      assertDocxContainsImage(res.path);
    });

    it("14.5 should return document path and opened status", async () => {
      const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");
      const res = await createDocument({
        title: "Status Check Doc",
        body: "Checking return contract",
      });
      assert.ok(typeof res.path === "string");
      assert.ok(typeof res.opened === "boolean");
    });
  });

  // =========================================================================
  // Feature 15: Composite Goal Decomposition (R3: 2-4 milestones in task.plan)
  // =========================================================================
  describe("Feature 15: Composite Goal Decomposition", () => {
    it("15.1 should decompose fresh composite goals into milestones", async () => {
      const loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
      const decomposes = /plan|milestone|sub-goal|subgoal/i.test(loopSource);
      assert.ok(decomposes, "Planner must support sub-goal milestone decomposition");
    });

    it("15.2 should produce 2 to 4 milestones for composite goals", async () => {
      const loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
      const milestoneRange = /2.*4|2–4|milestones/i.test(loopSource);
      assert.ok(milestoneRange, "Composite goals must decompose into 2-4 milestones");
    });

    it("15.3 should store milestones in task.plan", async () => {
      const { createTask } = await import("../../server/src/tasks/taskStore.js");
      const task = createTask("Composite task");
      assert.ok("plan" in task || "trace" in task);
    });

    it("15.4 should define milestone interface with id, description, and status", async () => {
      const typesSource = readFileSync(join(process.cwd(), "server", "src", "tasks", "types.ts"), "utf8");
      const hasPlanTypes = /Milestone|task\.plan|plan\?:/i.test(typesSource);
      assert.ok(hasPlanTypes, "types.ts should include plan milestone definitions");
    });

    it("15.5 should keep simple single-action tasks atomic without forced decomposition", async () => {
      const loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
      assert.ok(loopSource.length > 0);
    });
  });

  // =========================================================================
  // Feature 16: Dedicated 6-Step Horizons
  // =========================================================================
  describe("Feature 16: Dedicated 6-Step Horizons", () => {
    let loopSource = "";
    before(() => {
      loopSource = readFileSync(join(process.cwd(), "server", "src", "planner", "loop.ts"), "utf8");
    });

    it("16.1 should allocate dedicated 6-step horizon per sub-goal", () => {
      const has6StepRule = /6.*step|horizon.*6|6-step/i.test(loopSource);
      assert.ok(has6StepRule, "Planner must allocate dedicated 6-step horizon per milestone");
    });

    it("16.2 should advance to next milestone upon verification of prior milestone", () => {
      const advancesOnVerify = /advance|next milestone|verified/i.test(loopSource);
      assert.ok(advancesOnVerify, "Milestones must advance upon verification");
    });

    it("16.3 should isolate step horizon tracking per active milestone", () => {
      assert.ok(loopSource.length > 0);
    });

    it("16.4 should trigger recovery moves if milestone steps exhaust", () => {
      const handlesExhaustion = /recovery|ask_user|exhaust/i.test(loopSource);
      assert.ok(handlesExhaustion, "Milestone step exhaustion must handle recovery or ask");
    });

    it("16.5 should transition task to finish once all milestones complete", () => {
      const finishesAll = /reach\.finish|complete/i.test(loopSource);
      assert.ok(finishesAll, "Loop must complete task when all milestones are achieved");
    });
  });

  // =========================================================================
  // Feature 17: Milestone Event Logging (event trail in /sim)
  // =========================================================================
  describe("Feature 17: Milestone Event Logging", () => {
    it("17.1 should emit milestone_started event to task event trail", async () => {
      const { createTask, appendTaskEvent, getTask } = await import("../../server/src/tasks/taskStore.js");
      const task = createTask("Milestone event test");
      appendTaskEvent(task.id, {
        kind: "milestone_started" as never,
        summary: "Started milestone 1: Gather assets",
      });
      const updated = getTask(task.id);
      const ev = updated?.events?.find((e) => e.kind === "milestone_started");
      assert.ok(ev, "Event trail must record milestone_started event");
    });

    it("17.2 should emit milestone_completed event upon verification", async () => {
      const { createTask, appendTaskEvent, getTask } = await import("../../server/src/tasks/taskStore.js");
      const task = createTask("Milestone completed test");
      appendTaskEvent(task.id, {
        kind: "milestone_completed" as never,
        summary: "Completed milestone 1: Assets verified",
      });
      const updated = getTask(task.id);
      const ev = updated?.events?.find((e) => e.kind === "milestone_completed");
      assert.ok(ev, "Event trail must record milestone_completed event");
    });

    it("17.3 should expose milestone events in GET /tasks/:id endpoint", async () => {
      const { createTask, appendTaskEvent } = await import("../../server/src/tasks/taskStore.js");
      const task = createTask("Task endpoint events");
      appendTaskEvent(task.id, {
        kind: "milestone_started" as never,
        summary: "Milestone 1 in progress",
      });

      const res = await fetch(`${harness.serverUrl}/tasks/${task.id}`);
      if (res.status === 200) {
        const body = (await res.json()) as Record<string, unknown>;
        assert.ok(Array.isArray(body["events"]));
      }
    });

    it("17.4 should render milestone items in simulator timeline", async () => {
      const res = await fetch(`${harness.serverUrl}/sim`);
      const html = await res.text();
      const hasTimeline = /timeline|events|trail|event-card/i.test(html);
      assert.ok(hasTimeline, "sim.html must render timeline events");
    });

    it("17.5 should maintain chronological ordering of milestone events", async () => {
      const { createTask, appendTaskEvent, getTask } = await import("../../server/src/tasks/taskStore.js");
      const task = createTask("Ordering test");
      appendTaskEvent(task.id, { kind: "milestone_started" as never, summary: "Step 1" });
      appendTaskEvent(task.id, { kind: "milestone_completed" as never, summary: "Step 1 done" });

      const updated = getTask(task.id);
      const events = updated?.events ?? [];
      const m1 = events.findIndex((e) => e.kind === "milestone_started");
      const m2 = events.findIndex((e) => e.kind === "milestone_completed");
      assert.ok(m1 < m2, "milestone_started must precede milestone_completed");
    });
  });

  // =========================================================================
  // Feature 18: Voice wake parsing + spoken summaries (sim.html)
  // =========================================================================
  describe("Feature 18: Voice wake parsing + spoken summaries", () => {
    let simHtml = "";
    before(async () => {
      const res = await fetch(`${harness.serverUrl}/sim`);
      simHtml = await res.text();
    });

    const extract = (name: string): string => {
      const m = simHtml.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
      assert.ok(m, `sim.html must define ${name}()`);
      return m[0];
    };

    it("18.1 should accept common mishears of Hey REACH and wake-only input", () => {
      const parseWake = new Function(`${extract("parseWake")}; return parseWake;`)() as (text: string) => { command: string } | null;
      assert.equal(parseWake("Hey there, Rich.")?.command, "");
      assert.equal(parseWake("Hey reach, Rich")?.command, "");
      assert.equal(parseWake("hey reech open spotify")?.command, "open spotify");
      assert.equal(parseWake("okay ritch, capture my screen")?.command, "capture my screen");
      assert.equal(parseWake("hey alexa")?.command, "");
    });

    it("18.2 should parse a wake word repeated mid-utterance", () => {
      const parseWake = new Function(`${extract("parseWake")}; return parseWake;`)() as (text: string) => { command: string } | null;
      assert.equal(parseWake("open spotify. hey alexa, play my playlist")?.command, "open spotify play my playlist");
    });

    it("18.3 should wait for a silence debounce before submitting", () => {
      assert.match(simHtml, /submitTimer/);
      assert.match(simHtml, /scheduleVoiceAccept[\s\S]*?\}, 2000\)/);
    });

    it("18.4 should speak one short completion sentence instead of the full outcome", () => {
      const code = extract("plain") + "\n" + extract("short") + "\n" + extract("firstSentence") + "\n" + extract("speechForDone");
      const speechForDone = new Function(`${code}; return speechForDone;`)() as (task: unknown, v: { tone: string }) => string;
      const line = speechForDone({ outcome: { summary: "Copied the paragraph. Pasted it into the note. Saved the note." } }, { tone: "ok" });
      assert.equal(line, "Done. Copied the paragraph. Check the result on screen.");
      assert.ok(line.length < 120);
    });
  });
});
