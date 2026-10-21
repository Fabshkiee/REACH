#!/usr/bin/env tsx
/**
 * REACH E2E Test Suite Master Runner
 * Executes 4-tier independent opaque-box test suites and generates structured verification scorecards.
 *
 * Usage:
 *   npx tsx tests/e2e/run_all.ts [options]
 *
 * Options:
 *   --tier=<1|2|3|4|all>  Run a specific tier (default: all)
 *   --bail                Stop on first failing tier
 *   --json                Output results in JSON format
 *   --verbose             Show raw test runner stream
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

interface TierResult {
  tierNumber: number;
  name: string;
  file: string;
  total: number;
  passed: number;
  failed: number;
  cancelled: number;
  durationMs: number;
  success: boolean;
  rawOutput: string;
}

const TIERS = [
  {
    tierNumber: 1,
    name: "Tier 1: Feature Coverage (>=5 tests per feature)",
    file: "tests/e2e/tier1_features.test.ts",
  },
  {
    tierNumber: 2,
    name: "Tier 2: Boundary & Corner Cases (>=5 tests per feature)",
    file: "tests/e2e/tier2_boundaries.test.ts",
  },
  {
    tierNumber: 3,
    name: "Tier 3: Cross-Feature Combinations (Pairwise Testing)",
    file: "tests/e2e/tier3_pairwise.test.ts",
  },
  {
    tierNumber: 4,
    name: "Tier 4: Real-World Composite Application Scenarios",
    file: "tests/e2e/tier4_scenarios.test.ts",
  },
];

async function runTier(
  tier: { tierNumber: number; name: string; file: string },
  verbose: boolean,
): Promise<TierResult> {
  const start = Date.now();
  const args = ["--test", "--test-timeout=60000", tier.file];

  return new Promise((resolve) => {
    let output = "";
    const child = spawn("npx", ["tsx", ...args], {
      cwd: process.cwd(),
      shell: true,
      env: { ...process.env, NODE_ENV: "test" },
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      output += s;
      if (verbose) process.stdout.write(s);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      output += s;
      if (verbose) process.stderr.write(s);
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - start;

      // Extract the test runner's statistics.
      // Node's default reporter prints "ℹ tests 85"; the TAP reporter prints
      // "# tests 85". Both must parse — matching only one made the scorecard
      // report 0% on a suite that was passing.
      const stat = (label: string): number => {
        const m = output.match(new RegExp(`(?:#|\\u2139|ℹ)\\s*${label}\\s+(\\d+)`));
        return m ? parseInt(m[1], 10) : 0;
      };
      const total = stat("tests");
      const passed = stat("pass");
      const failed = stat("fail");
      const cancelled = stat("cancelled");

      resolve({
        tierNumber: tier.tierNumber,
        name: tier.name,
        file: tier.file,
        total,
        passed,
        failed,
        cancelled,
        durationMs,
        success: code === 0 && failed === 0,
        rawOutput: output,
      });
    });
  });
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  let tierFilter: number | "all" = "all";
  let bail = false;
  let json = false;
  let verbose = false;

  for (const arg of args) {
    if (arg.startsWith("--tier=")) {
      const val = arg.split("=")[1];
      if (val === "all") tierFilter = "all";
      else {
        const n = parseInt(val, 10);
        if (n >= 1 && n <= 4) tierFilter = n;
      }
    } else if (arg === "--bail") {
      bail = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    }
  }

  return { tierFilter, bail, json, verbose };
}

async function main() {
  const { tierFilter, bail, json, verbose } = parseCliArgs();

  const selectedTiers =
    tierFilter === "all"
      ? TIERS
      : TIERS.filter((t) => t.tierNumber === tierFilter);

  if (!json) {
    console.log("================================================================================");
    console.log("REACH General Task Execution Architecture - Independent E2E Test Suite");
    console.log("================================================================================");
    console.log(`Starting execution of ${selectedTiers.length} tier(s)...\n`);
  }

  const results: TierResult[] = [];

  for (const tier of selectedTiers) {
    if (!json) {
      console.log(`>>> Executing [Tier ${tier.tierNumber}]: ${tier.name}...`);
    }

    const res = await runTier(tier, verbose);
    results.push(res);

    if (!json) {
      const statusSymbol = res.success ? "[PASS]" : "[FAIL]";
      console.log(
        `    ${statusSymbol} Total: ${res.total} | Passed: ${res.passed} | Failed: ${res.failed} | Duration: ${(res.durationMs / 1000).toFixed(2)}s\n`,
      );
    }

    if (bail && !res.success) {
      if (!json) console.log("Bailing out on first tier failure (--bail enabled).");
      break;
    }
  }

  const totalTests = results.reduce((acc, r) => acc + r.total, 0);
  const totalPassed = results.reduce((acc, r) => acc + r.passed, 0);
  const totalFailed = results.reduce((acc, r) => acc + r.failed, 0);
  const totalDuration = results.reduce((acc, r) => acc + r.durationMs, 0);
  const allPassed = results.every((r) => r.success);

  if (json) {
    console.log(
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          allPassed,
          totalTests,
          totalPassed,
          totalFailed,
          totalDurationMs: totalDuration,
          tiers: results.map((r) => ({
            tier: r.tierNumber,
            name: r.name,
            total: r.total,
            passed: r.passed,
            failed: r.failed,
            durationMs: r.durationMs,
            success: r.success,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log("================================================================================");
    console.log("E2E TEST SCORECARD SUMMARY");
    console.log("================================================================================");
    console.log(
      "| Tier | Description                                    | Total | Passed | Failed | Status |",
    );
    console.log(
      "|------|------------------------------------------------|-------|--------|--------|--------|",
    );
    for (const r of results) {
      const tierId = `Tier ${r.tierNumber}`.padEnd(4);
      const desc = r.name.slice(0, 46).padEnd(46);
      const tot = String(r.total).padStart(5);
      const pass = String(r.passed).padStart(6);
      const fail = String(r.failed).padStart(6);
      const stat = (r.success ? "PASS" : "FAIL").padStart(6);
      console.log(`| ${tierId} | ${desc} | ${tot} | ${pass} | ${fail} | ${stat} |`);
    }
    console.log(
      "|------|------------------------------------------------|-------|--------|--------|--------|",
    );
    const totAll = String(totalTests).padStart(5);
    const passAll = String(totalPassed).padStart(6);
    const failAll = String(totalFailed).padStart(6);
    const statAll = (allPassed ? "PASS" : "FAIL").padStart(6);
    console.log(
      `| TOTAL| Comprehensive 4-Tier Test Suite               | ${totAll} | ${passAll} | ${failAll} | ${statAll} |`,
    );
    console.log("================================================================================");
    console.log(
      `Total Duration: ${(totalDuration / 1000).toFixed(2)}s | Pass Rate: ${totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0}%\n`,
    );

    if (!allPassed) {
      console.log("Note: Failing tests represent pending features from Milestones 1, 2, and 3.");
      console.log("As milestone implementations complete, run `npx tsx tests/e2e/run_all.ts` to verify 100% pass rate.\n");
    }
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal runner error:", err);
  process.exit(1);
});
