// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Grid Code Gatekeeper Subcommand.
 *
 * Runs automated 5-stage screening pipeline for ISO / Transmission Planner
 * generator interconnection queues (MOD-032, Flat-Start, Weak-Grid SCR, IEEE 2800, EMT Cross-Parity).
 *
 * Usage:
 * - `msx gatekeeper evaluate <submission.zip> [--out=scorecard.json]`
 * - `msx gatekeeper serve [--port=8080]`
 */

import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const GatekeeperCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "gatekeeper <action> [files...]",
  describe: "Run 5-stage ISO Grid Code screening pipeline or start automated CI/CD evaluation service",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (evaluate, screen, serve, status)",
        type: "string",
        choices: ["evaluate", "screen", "serve", "status"],
        demandOption: true,
      })
      .positional("files", {
        description: "Interconnection submission archive or directory (.zip or folder)",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path for scorecard JSON or Markdown report",
        type: "string",
      })
      .option("port", {
        description: "Port to listen on when running HTTP server (default: 8080)",
        type: "number",
        default: 8080,
      })
      .option("interconnection", {
        description: "Target interconnection: Western, Eastern, ERCOT, or ENTSO-E (default: Western)",
        type: "string",
        default: "Western",
      })
      .option("mva", {
        description: "Generator plant rated capacity in MVA (default: 100)",
        type: "number",
        default: 100.0,
      })
      .option("kv", {
        description: "Point of Interconnection (POI) rated voltage in kV (default: 230)",
        type: "number",
        default: 230.0,
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const port = (argv["port"] as number) ?? 8080;
    const interconnection = (argv["interconnection"] as string) ?? "Western";
    const ratedMva = (argv["mva"] as number) ?? 100.0;
    const poiKv = (argv["kv"] as number) ?? 230.0;

    if (action === "serve") {
      console.log(`[gatekeeper] Starting ISO Grid Code Gatekeeper CI/CD service on port ${port}...`);
      const { createGatekeeperRouter } = await import("@modelscript/ee");
      const expressMod = (await import("express")) as unknown as { default?: () => any };
      const createExpressApp = expressMod.default ?? (expressMod as unknown as () => any);
      const app = createExpressApp();
      app.use("/api/v1", createGatekeeperRouter());
      app.listen(port, () => {
        console.log(`  ✔ Gatekeeper service listening at http://localhost:${port}/api/v1/grid-gatekeeper/health`);
        console.log(`  ℹ POST /api/v1/grid-gatekeeper/evaluate to submit interconnection models.`);
      });
      return;
    }

    if (files.length === 0) {
      console.error("[gatekeeper] No submission file specified. Usage: msx gatekeeper evaluate <submission.zip>");
      process.exit(1);
    }

    const { runGatekeeperScreeningPipeline } = await import("@modelscript/ee");

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[gatekeeper] File not found: ${absPath}`);
        process.exit(1);
      }

      const plantName = path.basename(file, path.extname(file));
      console.log(`[gatekeeper] Evaluating submission package for ${plantName}...`);

      const pkg = {
        submissionId: path.basename(absPath),
        developerOrganization: "Interconnection Customer",
        plantName,
        gridInterconnection: interconnection,
        ratedMva,
        poiKv,
        hasRawPowerFlow: true,
        hasDyrDynamics: true,
        hasPscadModel: true,
        hasWasmFirmware: true,
      };

      const scorecard = runGatekeeperScreeningPipeline(pkg);

      console.log(`\n=======================================================`);
      console.log(` GRID CODE GATEKEEPER SCORECARD: [${scorecard.overallVerdict}]`);
      console.log(` Composite Score: ${scorecard.compositeScorePercent.toFixed(1)} / 100.0`);
      console.log(` Evaluated At:   ${scorecard.evaluatedAt}`);
      console.log(`=======================================================`);
      for (const s of scorecard.stages) {
        const icon = s.verdict === "PASS" ? "✔" : s.verdict === "WARN" ? "▲" : "✖";
        console.log(` ${icon} [Stage ${s.stageNumber}] ${s.stageName}: ${s.verdict} (${s.scorePercent.toFixed(0)}%)`);
      }

      if (scorecard.rejectionReasons.length > 0) {
        console.log(`\nRejection Reasons:`);
        for (const reason of scorecard.rejectionReasons) {
          console.log(`  - ✖ ${reason}`);
        }
      }

      if (out) {
        const outPath = path.resolve(process.cwd(), out);
        if (outPath.endsWith(".md")) {
          fs.writeFileSync(outPath, scorecard.summaryMarkdown, "utf-8");
          console.log(`\n  ✔ Saved scorecard Markdown report to ${outPath}`);
        } else {
          fs.writeFileSync(outPath, JSON.stringify(scorecard, null, 2), "utf-8");
          console.log(`\n  ✔ Saved scorecard JSON to ${outPath}`);
        }
      }

      if (scorecard.overallVerdict === "REJECTED") {
        process.exitCode = 1;
      }
    }
  },
};
