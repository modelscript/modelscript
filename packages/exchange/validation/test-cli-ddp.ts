// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

console.log("=== Testing msc ddp CLI Commands End-to-End ===");

const testDir = path.resolve(process.cwd(), "packages/exchange/validation/.tmp_ddp_cli");
fs.mkdirSync(testDir, { recursive: true });
fs.mkdirSync(path.join(testDir, "requirements"), { recursive: true });
fs.mkdirSync(path.join(testDir, "geometry"), { recursive: true });
fs.mkdirSync(path.join(testDir, "behavior"), { recursive: true });

// Create test artifacts
const sysmlPath = path.join(testDir, "requirements/flight_control.sysml");
const stepPath = path.join(testDir, "geometry/spoiler_bracket.stp");
const moPath = path.join(testDir, "behavior/spoiler_aero.mo");
const manifestPath = path.join(testDir, "ddp-manifest.json");

fs.writeFileSync(sysmlPath, "package FlightControl { requirement MaxLoad; }");
fs.writeFileSync(
  stepPath,
  "ISO-10303-21; HEADER; ENDSEC; DATA; #1=CARTESIAN_POINT('',(0.,0.,0.)); ENDSEC; END-ISO-10303-21;",
);
fs.writeFileSync(moPath, "model SpoilerAero parameter Real Cd = 0.35; end SpoilerAero;");

const manifest = {
  "@context": "https://w3id.org/cascara/v1/context.jsonld",
  ddpVersion: "1.0",
  packageId: "urn:aerospace:ddp:spoiler-system",
  title: "Flight Control Spoiler Assembly",
  version: "1.0.0",
  description: "Aero surfaces and actuation linkage",
  creator: {
    name: "Aerospace Systems Lead",
    organization: "ACME-Partnered Consortium",
  },
  createdAt: new Date().toISOString(),
  securityClassification: "None",
  artifacts: {
    requirements: [
      {
        id: "REQ_01",
        path: "requirements/flight_control.sysml",
        contentType: "text/x-sysml2",
        domain: "requirements",
        format: "SysML v2",
        description: "Max structural load limits",
      },
    ],
    geometry: [
      {
        id: "CAD_01",
        path: "geometry/spoiler_bracket.stp",
        contentType: "application/step",
        domain: "geometry",
        format: "STEP AP242",
        description: "Bracket B-Rep geometry",
      },
    ],
    behavior: [
      {
        id: "SIM_01",
        path: "behavior/spoiler_aero.mo",
        contentType: "text/x-modelica",
        domain: "behavior",
        format: "Modelica 3.6",
        description: "Aerodynamic pressure response",
      },
    ],
  },
  relations: [
    {
      relationType: "verifies",
      source: "behavior/spoiler_aero.mo",
      target: "requirements/flight_control.sysml#MaxLoad",
      description: "Simulation verifies stress threshold",
      status: "passed",
    },
    {
      relationType: "implements",
      source: "geometry/spoiler_bracket.stp",
      target: "requirements/flight_control.sysml#BracketEnvelope",
      description: "Bracket implements physical mount interface",
    },
  ],
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const ddpOutput = path.join(testDir, "spoiler.ddp");
const aasxOutput = path.join(testDir, "spoiler.aasx");

try {
  // 1. Pack
  console.log("\n[1] Testing: msc ddp pack");
  const packCmd = `npx tsx apps/cli/src/main.ts ddp pack "${manifestPath}" -o "${ddpOutput}"`;
  const packOut = execSync(packCmd, { encoding: "utf-8" });
  console.log(packOut.trim());
  assert(fs.existsSync(ddpOutput), "Output .ddp must exist");
  assert(fs.statSync(ddpOutput).size > 0, "Output .ddp must have non-zero size");

  // 2. Inspect
  console.log("\n[2] Testing: msc ddp inspect");
  const inspectCmd = `npx tsx apps/cli/src/main.ts ddp inspect "${ddpOutput}"`;
  const inspectOut = execSync(inspectCmd, { encoding: "utf-8" });
  console.log(inspectOut.trim());
  assert(inspectOut.includes("Flight Control Spoiler Assembly"), "Inspection must display title");
  assert(inspectOut.includes("requirements/flight_control.sysml"), "Inspection must display artifacts");
  assert(inspectOut.includes("verifies"), "Inspection must display relations");

  // 3. To-AASX
  console.log("\n[3] Testing: msc ddp to-aasx");
  const toAasxCmd = `npx tsx apps/cli/src/main.ts ddp to-aasx "${ddpOutput}" -o "${aasxOutput}"`;
  const toAasxOut = execSync(toAasxCmd, { encoding: "utf-8" });
  console.log(toAasxOut.trim());
  assert(fs.existsSync(aasxOutput), "Output .aasx must exist");
  assert(fs.statSync(aasxOutput).size > 0, "Output .aasx must have non-zero size");

  console.log("\n✅ All CLI tests passed successfully!");
} finally {
  // Cleanup test files
  fs.rmSync(testDir, { recursive: true, force: true });
}
