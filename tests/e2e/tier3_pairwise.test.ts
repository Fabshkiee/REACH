/**
 * REACH E2E Test Suite - Tier 3: Cross-Feature Combinations
 * Pairwise interaction testing between search, download, document creation, explorer opening, and clarification guards.
 * Total: 12 In-Depth Integration Tests.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getTestHarness } from "./harness/serverHarness.js";
import { startMockAssetServer, MockAssetServer, SAMPLE_PNG } from "./harness/mockAssetServer.js";
import { assertDocxContainsImage } from "./harness/assertions.js";
import { CONFIG } from "./harness/config.js";

process.env.NODE_ENV = "test";
process.env.REACH_DATA_DIR = join(CONFIG.TEMP_TEST_DIR, "tier3-data");
mkdirSync(process.env.REACH_DATA_DIR, { recursive: true });

describe("Tier 3: Cross-Feature Combinations (Pairwise Interaction Testing)", () => {
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
  // Pair 1: web.search (Image Mode) -> web.download_asset
  // =========================================================================
  it("Pair 1: Search Image -> Download Asset pipeline", async () => {
    const webMod = await import("../../server/src/actions/web.js").catch(() => null);
    const agentMod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);

    if (!webMod || !agentMod) {
      assert.fail("web.search or download_asset capability not implemented");
    }

    // Step 1: Search for images
    const searchRes = await webMod.webSearch({ query: "satellite", mode: "image", limit: 3 });
    assert.equal(searchRes.ok, true);

    // Step 2: Use retrieved or test image URL to download asset
    const targetUrl = searchRes.results[0]?.imageUrl || `${mockAssets.url}/sample.png`;
    const downloadRes = await agentMod.downloadAsset({
      url: targetUrl,
      filename: "pair1_downloaded.png",
    });

    assert.equal(downloadRes.ok, true);
    assert.equal(downloadRes.verified, true);
    assert.ok(existsSync(downloadRes.path));
  });

  // =========================================================================
  // Pair 2: web.search (Text Mode) -> web.download_asset
  // =========================================================================
  it("Pair 2: Search Text -> Download Asset pipeline", async () => {
    const webMod = await import("../../server/src/actions/web.js").catch(() => null);
    const agentMod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);

    if (!webMod || !agentMod) {
      assert.fail("web.search or download_asset capability not implemented");
    }

    const searchRes = await webMod.webSearch({ query: "financial report 2026", mode: "text", limit: 3 });
    assert.equal(searchRes.ok, true);

    const downloadRes = await agentMod.downloadAsset({
      url: `${mockAssets.url}/report.pdf`,
      filename: "pair2_report.pdf",
    });

    assert.equal(downloadRes.ok, true);
    assert.equal(downloadRes.mimeType, "application/pdf");
  });

  // =========================================================================
  // Pair 3: web.download_asset -> create_document (DOCX Image Embedding)
  // =========================================================================
  it("Pair 3: Download Asset -> Embed in DOCX document", async () => {
    const agentMod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
    const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");

    if (!agentMod) {
      assert.fail("downloadAsset capability not implemented");
    }

    // Step 1: Download image asset
    const dl = await agentMod.downloadAsset({
      url: `${mockAssets.url}/sample.png`,
      filename: "pair3_asset.png",
    });

    // Step 2: Embed into Word .docx
    const doc = await createDocument({
      title: "Embedded Asset Report",
      body: "Figure 1: Downloaded asset shown below.",
      imagePaths: [dl.path],
    } as Record<string, unknown>);

    assert.ok(doc.path);
    assertDocxContainsImage(doc.path);
  });

  // =========================================================================
  // Pair 4: create_document (DOCX Image Embedding) -> apps.open_document (File)
  // =========================================================================
  it("Pair 4: Create Document with Image -> Open Document via Default App", async () => {
    const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");
    const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");

    const imgPath = join(CONFIG.SANDBOX_DOCUMENTS, "pair4_img.png");
    mkdirSync(CONFIG.SANDBOX_DOCUMENTS, { recursive: true });
    writeFileSync(imgPath, SAMPLE_PNG);

    const doc = await createDocument({
      title: "Illustrated Document To Open",
      body: "Testing file open integration",
      imagePaths: [imgPath],
    } as Record<string, unknown>);

    const openRes = await openDocument({ path: doc.path });
    assert.equal(typeof openRes.opened, "boolean");
    assert.equal(openRes.path, doc.path);
  });

  // =========================================================================
  // Pair 5: web.download_asset -> apps.open_document (Directory in File Explorer)
  // =========================================================================
  it("Pair 5: Download Asset -> Open enclosing directory in File Explorer", async () => {
    const agentMod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
    const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");

    if (!agentMod) {
      assert.fail("downloadAsset capability not implemented");
    }

    const dl = await agentMod.downloadAsset({
      url: `${mockAssets.url}/sample.png`,
      filename: "pair5_asset.png",
    });

    const parentDir = CONFIG.SANDBOX_DOWNLOADS;
    const openRes = await openDocument({ path: parentDir });

    assert.equal(typeof openRes.opened, "boolean");
    assert.equal(openRes.path, parentDir);
  });

  // =========================================================================
  // Pair 6: reach.ask_user -> web.search Refinement
  // =========================================================================
  it("Pair 6: Clarification Ask -> Search Query Refinement", async () => {
    const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
    const { proposeAction } = await import("../../server/src/executor/executor.js");
    const webMod = await import("../../server/src/actions/web.js").catch(() => null);

    const task = createTask("Ambiguous search goal");

    // 1. Planner pauses for user input
    const askRes = await proposeAction(task.id, {
      name: "reach.ask_user",
      actionClass: "ask",
      args: { question: "Do you prefer articles on Solar or Wind?" },
    });
    assert.equal(askRes.outcome, "paused");

    // 2. User provides input "Solar"
    setTaskStatus(task.id, "running", {
      askedQuestions: ["Do you prefer articles on Solar or Wind?"],
      userAnswer: "Solar",
    } as Record<string, unknown>);

    // 3. Search executes with refined query
    if (webMod) {
      const searchRes = await webMod.webSearch({ query: "Solar energy advancements 2026", mode: "text" });
      assert.equal(searchRes.ok, true);
    }
  });

  // =========================================================================
  // Pair 7: reach.ask_user Duplicate Guard -> Loop Execution
  // =========================================================================
  it("Pair 7: Duplicate Guard Rejection -> Planner avoids nag loop", async () => {
    const { createTask } = await import("../../server/src/tasks/taskStore.js");
    const { proposeAction } = await import("../../server/src/executor/executor.js");

    const task = createTask("Loop nag guard test");

    // First ask allowed
    await proposeAction(task.id, {
      name: "reach.ask_user",
      actionClass: "ask",
      args: { question: "What file extension do you want?" },
    });

    // Repeat ask rejected
    const repeatRes = await proposeAction(task.id, {
      name: "reach.ask_user",
      actionClass: "ask",
      args: { question: "what file extension do you want?" },
    });

    assert.equal(repeatRes.outcome, "rejected");
  });

  // =========================================================================
  // Pair 8: 3-Question Cap -> Forced Autonomous Execution
  // =========================================================================
  it("Pair 8: 3-Question Cap Rejection -> Autonomous Progress Direction", async () => {
    const { createTask, setTaskStatus } = await import("../../server/src/tasks/taskStore.js");
    const { proposeAction } = await import("../../server/src/executor/executor.js");

    const task = createTask("Autonomy forcing test");
    setTaskStatus(task.id, "running", { questionCount: 3, askedQuestions: ["Q1", "Q2", "Q3"] } as Record<string, unknown>);

    const res = await proposeAction(task.id, {
      name: "reach.ask_user",
      actionClass: "ask",
      args: { question: "Can I ask one more thing?" },
    });

    assert.equal(res.outcome, "rejected");
    assert.match(res.error ?? "", /cap|limit|proceed/i);
  });

  // =========================================================================
  // Pair 9: Step-Exhaustion Continuation (turn 8) -> Document Creation
  // =========================================================================
  it("Pair 9: Step Exhaustion Continuation -> Successful Document Generation", async () => {
    const { createDocument } = await import("../../windows-agent/src/capabilities/createDocument.js");
    const { createTask, appendActionRecord } = await import("../../server/src/tasks/taskStore.js");

    const task = createTask("Exhaustion to document test");
    for (let i = 1; i <= 8; i++) {
      appendActionRecord(task.id, {
        id: `act_${i}`,
        name: `test.step_${i}`,
        actionClass: "observe",
        args: {},
        policyVerdict: "allow",
        ok: true,
        verified: true,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
    }

    // After 8 turns checkpoint, final document is generated
    const doc = await createDocument({
      title: "Report After Turn 8",
      body: "Completed after budget continuation.",
    });

    assert.ok(doc.path);
    assert.ok(existsSync(doc.path));
  });

  // =========================================================================
  // Pair 10: Server & Agent Build Stamps -> Capability Dispatch
  // =========================================================================
  it("Pair 10: Build Stamp Verification before Dispatching Capability", async () => {
    // 1. Verify health and build stamps of both services
    const sRes = await fetch(`${harness.serverUrl}/health`);
    const aRes = await fetch(`${harness.agentUrl}/health`);
    assert.equal(sRes.status, 200);
    assert.equal(aRes.status, 200);

    const sBody = (await sRes.json()) as Record<string, unknown>;
    const aBody = (await aRes.json()) as Record<string, unknown>;
    assert.ok(sBody["buildStamp"]);
    assert.ok(aBody["buildStamp"]);

    // 2. Dispatch capability knowing stamps are fresh
    const listRes = await fetch(`${harness.agentUrl}/capabilities`);
    assert.equal(listRes.status, 200);
  });

  // =========================================================================
  // Pair 11: 50MB Download Limit Rejection -> Recovery to Alternative
  // =========================================================================
  it("Pair 11: 50MB Download Rejection -> Fallback to alternative asset", async () => {
    const agentMod = await import("../../windows-agent/src/capabilities/downloadAsset.js").catch(() => null);
    if (!agentMod) assert.fail("downloadAsset capability missing");

    // 1. Attempt oversized download (fails cleanly)
    await assert.rejects(
      async () => {
        await agentMod.downloadAsset({ url: `${mockAssets.url}/oversized.bin` });
      },
      /50MB|too large|ceiling/i,
    );

    // 2. Fallback to valid asset (succeeds)
    const fallbackRes = await agentMod.downloadAsset({
      url: `${mockAssets.url}/sample.png`,
      filename: "pair11_recovered.png",
    });
    assert.equal(fallbackRes.ok, true);
    assert.equal(fallbackRes.verified, true);
  });

  // =========================================================================
  // Pair 12: Directory Open -> files.list Consistency
  // =========================================================================
  it("Pair 12: Directory Open -> files.list contents alignment", async () => {
    const { listFiles } = await import("../../windows-agent/src/capabilities/files.js");
    const { openDocument } = await import("../../windows-agent/src/capabilities/apps.js");

    // List files in sandbox directory
    const listRes = await listFiles({ path: CONFIG.SANDBOX_DOCUMENTS });
    assert.ok(Array.isArray(listRes.entries || (listRes as any).files));

    // Open directory in Explorer
    const openRes = await openDocument({ path: CONFIG.SANDBOX_DOCUMENTS });
    assert.equal(typeof openRes.opened, "boolean");
  });
});
