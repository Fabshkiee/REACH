/**
 * REACH E2E Test Server Harness
 * Coordinates live or ephemeral instances of server and windows-agent for opaque-box testing.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CONFIG } from "./config.js";

export interface RunningInstance {
  url: string;
  close: () => Promise<void>;
}

/** Check if an HTTP endpoint is currently responding */
export async function isEndpointAlive(url: string, timeoutMs = 1000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.status === 200;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

/**
 * Start an ephemeral instance of an Express application on a dynamic port.
 */
export async function startEphemeralApp(appModulePath: string): Promise<RunningInstance> {
  // Ensure test environment
  process.env.NODE_ENV = "test";
  const mod = await import(appModulePath);
  const app = mod.default || mod.app;
  if (!app) {
    throw new Error(`Module at ${appModulePath} does not export an Express app as default or app.`);
  }

  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * Ensures both server and agent are reachable.
 * Prefers already-running instances (e.g. dev servers on 3000/3001);
 * otherwise starts ephemeral instances on dynamic ports.
 */
export async function getTestHarness() {
  let serverInstance: RunningInstance | undefined;
  let agentInstance: RunningInstance | undefined;

  let serverUrl = CONFIG.SERVER_URL;
  let agentUrl = CONFIG.AGENT_URL;

  const serverAlive = await isEndpointAlive(serverUrl);
  if (!serverAlive) {
    serverInstance = await startEphemeralApp("../../../server/src/index.ts");
    serverUrl = serverInstance.url;
  }

  const agentAlive = await isEndpointAlive(agentUrl);
  if (!agentAlive) {
    agentInstance = await startEphemeralApp("../../../windows-agent/src/index.ts");
    agentUrl = agentInstance.url;
  }

  return {
    serverUrl,
    agentUrl,
    async cleanup() {
      if (serverInstance) await serverInstance.close();
      if (agentInstance) await agentInstance.close();
    },
  };
}
