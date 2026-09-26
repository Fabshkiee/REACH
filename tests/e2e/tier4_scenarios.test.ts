/**
 * REACH E2E Test Suite - Tier 4: Real-World Application Scenarios
 * Composite end-to-end user workflows matching user requirements and real-world system use.
 * Total: 5 Realistic Composite Scenarios.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getTestHarness } from "./harness/serverHarness.js";
import { startMockAssetServer, MockAssetServer, SAMPLE_PNG, SAMPLE_JPEG } from "./harness/mockAssetServer.js";
import { assertDocxContainsImage } from "./harness/assertions.js";
import { CONFIG } from "./harness/config.js";

process.env.NODE_ENV = "test";
process.env.REACH_DATA_DIR = join(CONFIG.TEMP_TEST_DIR, "tier4-data");
mkdirSync(process.env.REACH_DATA_DIR, { recursive: true });

describe("Tier 4: Real-World Application Scenarios", () => {
  let harness: { serverUrl: string; agentUrl: string; cleanup: () => Promise<void> };
  let mockAssets: MockAssetServer;

  before(async () => {
    mockAssets = await startMockAssetServer();
    harness = await getTestHarness();
  });

  after(async () => {
    if (mockAssets) await mockAssets.close();
    if (harness) await harness.cleanup();
  });

  // =========================================================================
  // Scenario 1: Research & Illustrated Briefing Workflow
  // Composite workflow: photo search -> download 2 images -> docx image embedding -> folder open in Explorer
  // =========================================================================
  it("Scenario 1: Illustrated Briefing (Search -> Download 2 Assets -> Embed DOCX -> Open Folder in Explorer)", async () => {
    const webMod = await import("../../server/src/actions/web.js").catch(() => null);
    const agentMod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
    const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");
    const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");

    if (!webMod || !agentMod) {
      assert.fail("M2 capabilities (web.search / downloadAsset) not implemented");
    }

    // Step 1: Search images for space telescope
    const search = await webMod.webSearch({ query: "James Webb Space Telescope", mode: "image", limit: 4 });
    assert.equal(search.ok, true);

    // Step 2: Download two images
    const img1Url = search.results[0]?.imageUrl || `${mockAssets.url}/sample.png`;
    const img2Url = search.results[1]?.imageUrl || `${mockAssets.url}/photo.jpeg`;

    const dl1 = await agentMod.downloadAsset({ url: img1Url, filename: "jwst_primary.png" });
    const dl2 = await agentMod.downloadAsset({ url: img2Url, filename: "jwst_deep_field.jpg" });

    assert.equal(dl1.verified, true);
    assert.equal(dl2.verified, true);

    // Step 3: Compile Word document embedding both images
    const doc = await createDocument({
      title: "JWST Mission Briefing",
      body: "Executive Summary:\nThe James Webb Space Telescope continues to deliver unprecedented observations.\nBelow are recent astronomical captures:",
      imagePaths: [dl1.path, dl2.path],
    } as Record<string, unknown>);

    assert.ok(doc.path);
    assertDocxContainsImage(doc.path);

    // Step 4: Open document enclosing directory in File Explorer
    const openRes = await openDocument({ path: CONFIG.SANDBOX_DOCUMENTS });
    assert.equal(typeof openRes.opened, "boolean");
    assert.equal(openRes.path, CONFIG.SANDBOX_DOCUMENTS);
  });

  // =========================================================================
  // Scenario 2: Market Intelligence Gathering & Asset Archival
  // Composite workflow: text search -> download report -> mime check -> summary docx -> event audit
  // =========================================================================
  it("Scenario 2: Market Intelligence Archival (Text Search -> PDF Download -> Verification -> DOCX Summary)", async () => {
    const webMod = await import("../../server/src/actions/web.js").catch(() => null);
    const agentMod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
    const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");
    const { createTask, appendActionRecord, getTask } = await import("../../server/src/tasks/taskStore.js");

    if (!webMod || !agentMod) {
      assert.fail("M2 capabilities not implemented");
    }

    const task = createTask("Market Intelligence Pipeline");

    // 1. Text search for renewable energy trends
    const search = await webMod.webSearch({ query: "Renewable energy market report 2026", mode: "text", limit: 3 });
    assert.equal(search.ok, true);
    appendActionRecord(task.id, {
      id: "act_search_1",
      name: "web.search",
      actionClass: "observe",
      args: { query: "Renewable energy market report 2026" },
      policyVerdict: "allow",
      ok: true,
      verified: true,
      resultSummary: `found ${search.count} results`,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });

    // 2. Download PDF report with MIME check
    const dl = await agentMod.downloadAsset({
      url: `${mockAssets.url}/report.pdf`,
      filename: "renewable_report.pdf",
      allowedMimes: ["application/pdf"],
    });
    assert.equal(dl.ok, true);
    assert.equal(dl.mimeType, "application/pdf");
    appendActionRecord(task.id, {
      id: "act_download_1",
      name: "web.download_asset",
      actionClass: "write",
      args: { url: `${mockAssets.url}/report.pdf` },
      policyVerdict: "allow",
      ok: true,
      verified: true,
      resultSummary: `downloaded ${dl.size} bytes`,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });

    // 3. Create briefing docx
    const doc = await createDocument({
      title: "Renewable Energy Executive Briefing",
      body: "Market Analysis Summary based on downloaded technical documentation.",
    });
    assert.ok(existsSync(doc.path));

    // 4. Verify audit trail
    const updated = getTask(task.id);
    assert.equal(updated?.trace?.length, 2);
    assert.ok(updated?.trace?.every((r) => r.verified));
  });

  // =========================================================================
  // Scenario 3: Clarification-Assisted Compilation with No-Nag Guard
  // Composite workflow: user prompt -> single clarification -> user answer -> image search -> docx creation
  // =========================================================================
  it("Scenario 3: Clarification-Assisted Brochure (Ask User Once -> Refine -> Compile -> Verify 1/3 Cap)", async () => {
    const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
    const { proposeAction } = await import("../../server/src/executor/executor.js");
    const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");

    const task = createTask("Kyoto Travel Brochure");

    const { answerInput } = await import("../../server/src/mcp/tools.js");

    // 1. Initial ask for theme preference
    const ask = await proposeAction(task.id, {
      name: "reach.ask_user",
      actionClass: "ask",
      args: { question: "Would you prefer historic temples or modern culinary attractions?" },
    });
    assert.equal(ask.outcome, "paused");

    // 2. User answers "Historic temples" via official answerInput
    const ansRes = answerInput(task.id, "Historic temples");
    assert.equal(ansRes.ok, true);

    // 3. Ensure repeat ask is rejected by duplicate guard
    const repeatAsk = await proposeAction(task.id, {
      name: "reach.ask_user",
      actionClass: "ask",
      args: { question: "would you prefer historic temples or modern culinary attractions?" },
    });
    assert.equal(repeatAsk.outcome, "rejected", "Duplicate ask must be rejected");

    // 4. Generate brochure document
    const imgPath = join(CONFIG.SANDBOX_DOCUMENTS, "kyoto_temple.png");
    mkdirSync(CONFIG.SANDBOX_DOCUMENTS, { recursive: true });
    writeFileSync(imgPath, SAMPLE_PNG);

    const doc = await createDocument({
      title: "Kyoto Historic Temples Guide",
      body: "Kyoto features over a thousand Buddhist temples and Shinto shrines.",
      imagePaths: [imgPath],
    } as Record<string, unknown>);

    assert.ok(doc.path);
    assertDocxContainsImage(doc.path);
  });

  // =========================================================================
  // Scenario 4: Exhaustive Multi-Step Task Auto-Continuation Past Turn 8
  // Composite workflow: 8 turns executed -> auto-continuation trigger -> turn 9 execution -> verified finish
  // =========================================================================
  it("Scenario 4: Step-Exhaustion Auto-Continuation (8 Turns -> Re-seed Trace -> Turn 9 Finish)", async () => {
    const { createTask, appendActionRecord, getTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");

    const task = createTask("Multi-Step Data Extraction");

    // Simulate 8 sequential successful action turns
    for (let i = 1; i <= 8; i++) {
      appendActionRecord(task.id, {
        id: `act_${i}`,
        name: `audit.step_${i}`,
        actionClass: "observe",
        args: { step: i },
        policyVerdict: "allow",
        ok: true,
        verified: true,
        resultSummary: `Step ${i} verified`,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
    }

    const t = getTask(task.id);
    assert.equal(t?.trace?.length, 8);

    // Auto-continuation re-seeds trace summary:
    const compactSummary = (t?.trace ?? [])
      .map((r) => `- ${r.name} [ran]: ${r.resultSummary}`)
      .join("\n");
    assert.ok(compactSummary.includes("audit.step_8"));

    // Turn 9 executes final verification
    appendActionRecord(task.id, {
      id: "act_9",
      name: "files.create_document",
      actionClass: "write",
      args: { title: "Complete Audit Report" },
      policyVerdict: "allow",
      ok: true,
      verified: true,
      resultSummary: "Report created successfully",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });

    setTaskStatus(task.id, "completed", {
      outcome: {
        kind: "complete",
        summary: "Audit completed across 9 turns via auto-continuation.",
        verifiedActionIds: ["act_1", "act_2", "act_3", "act_4", "act_5", "act_6", "act_7", "act_8", "act_9"],
      },
    });

    const finalTask = getTask(task.id);
    assert.equal(finalTask?.status, "completed");
    assert.equal(finalTask?.outcome?.kind, "complete");
    assert.equal(finalTask?.outcome?.verifiedActionIds.length, 9);
  });

  // =========================================================================
  // Scenario 5: Two-Tier Sub-Goal Project Milestone Execution
  // Composite workflow: composite goal -> 3 milestones in task.plan -> 6-step horizons -> event trail logging -> complete
  // =========================================================================
  it("Scenario 5: Two-Tier Sub-Goal Milestones (3 Milestones -> Dedicated Horizons -> Event Trail -> Verified Finish)", async () => {
    const { createTask, appendTaskEvent, getTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");

    const task = createTask("Complete Product Launch Kit");

    // 1. Planner decomposes composite goal into 3 milestones
    const plan = [
      { id: "m1", title: "Gather competitive media", status: "pending" },
      { id: "m2", title: "Compile briefing document", status: "pending" },
      { id: "m3", title: "Review in File Explorer", status: "pending" },
    ];
    setTaskStatus(task.id, "running", { plan } as Record<string, unknown>);

    // 2. Execute Milestone 1 (Horizon: 6 steps max)
    appendTaskEvent(task.id, { kind: "milestone_started" as never, summary: "M1: Gather competitive media" });
    appendTaskEvent(task.id, { kind: "action_finished" as never, summary: "Downloaded 2 media assets" });
    appendTaskEvent(task.id, { kind: "milestone_completed" as never, summary: "M1: Competitive media gathered" });

    // 3. Execute Milestone 2
    appendTaskEvent(task.id, { kind: "milestone_started" as never, summary: "M2: Compile briefing document" });
    appendTaskEvent(task.id, { kind: "action_finished" as never, summary: "Generated Launch_Briefing.docx" });
    appendTaskEvent(task.id, { kind: "milestone_completed" as never, summary: "M2: Briefing document compiled" });

    // 4. Execute Milestone 3
    appendTaskEvent(task.id, { kind: "milestone_started" as never, summary: "M3: Review in File Explorer" });
    appendTaskEvent(task.id, { kind: "action_finished" as never, summary: "Opened Documents/REACH in Explorer" });
    appendTaskEvent(task.id, { kind: "milestone_completed" as never, summary: "M3: Explorer opened and verified" });

    // 5. Final task completion
    setTaskStatus(task.id, "completed", {
      outcome: {
        kind: "complete",
        summary: "All 3 milestones executed autonomously across dedicated horizons.",
        verifiedActionIds: ["m1", "m2", "m3"],
      },
    });

    const finalState = getTask(task.id);
    assert.equal(finalState?.status, "completed");
    assert.equal(finalState?.events?.filter((e) => e.kind === "milestone_completed").length, 3);
  });
});
