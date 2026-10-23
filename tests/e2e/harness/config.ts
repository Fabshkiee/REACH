/**
 * E2E Test Suite Configuration
 * REACH General Task Execution Architecture
 */
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

// Keep automated runs from opening Finder/Word windows on the developer machine.
process.env.REACH_E2E_NO_OPEN = "1";

export const CONFIG = {
  // URLs for live testing if running, otherwise ephemeral
  SERVER_URL: process.env.REACH_SERVER_URL || "http://localhost:3000",
  AGENT_URL: process.env.REACH_AGENT_URL || "http://127.0.0.1:3001",

  // Timeout settings
  DEFAULT_TIMEOUT_MS: 15_000,
  DOWNLOAD_TIMEOUT_MS: 30_000,
  PLANNER_TIMEOUT_MS: 45_000,

  // Size limit contracts
  MAX_DOWNLOAD_SIZE_BYTES: 50 * 1024 * 1024, // 50MB ceiling
  MAX_QUESTION_CAP: 3,
  MAX_STEPS_THRESHOLD: 8,
  SUBGOAL_HORIZON_STEPS: 6,

  // Sandbox directories
  SANDBOX_DOWNLOADS: join(homedir(), "Downloads", "REACH"),
  SANDBOX_DOCUMENTS: join(homedir(), "Documents", "REACH"),

  // Ephemeral test directories
  TEMP_TEST_DIR: join(tmpdir(), "reach-e2e-tests"),
};
