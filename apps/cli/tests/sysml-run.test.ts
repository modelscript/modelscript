// SPDX-License-Identifier: AGPL-3.0-or-later

import { DdpPackager } from "@modelscript/exchange";
import assert from "node:assert/strict";
import { createHash, verify as cryptoVerify, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createSysmlHostHandlers, resolveConfinedPath, type RecordedHostArtifact } from "../src/commands/sysml-host.js";
import { SysmlRunCommand } from "../src/commands/sysml-run.js";

function sha256Hex(data: Uint8Array | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return createHash("sha256").update(buf).digest("hex");
}

describe("SysML v2 Multi-Engine Host & Chained `sysml-run` CLI", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  const emtExampleDir = path.join(repoRoot, "packages/examples/emt-screening-pack");
  const scratchDir = path.resolve(import.meta.dirname, "scratch_sysml_run_e2e");

  before(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    fs.mkdirSync(scratchDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it("enforces workspace confinement in resolveConfinedPath and host handlers", async () => {
    assert.throws(() => resolveConfinedPath(emtExampleDir, "../escape.txt"), /Path traversal rejected/);
    assert.throws(() => resolveConfinedPath(emtExampleDir, "/etc/passwd"), /Path traversal rejected/);
    assert.throws(() => resolveConfinedPath(emtExampleDir, "data/../../outside.raw"), /Path traversal rejected/);

    const resolved = resolveConfinedPath(emtExampleDir, "data/poi_case.raw");
    assert.equal(resolved, path.resolve(emtExampleDir, "data/poi_case.raw"));

    const recorded: RecordedHostArtifact[] = [];
    const host = createSysmlHostHandlers(scratchDir, { recordedArtifacts: recorded });
    assert.ok(host.writeArtifact);
    await assert.rejects(async () => await host.writeArtifact!("../outside.json", "{}"), /Path traversal rejected/);

    const writtenRel = await host.writeArtifact("reports/unit-test.json", '{"status":"ok"}');
    assert.equal(writtenRel, "reports/unit-test.json");
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.relPath, "reports/unit-test.json");
    assert.ok(fs.existsSync(recorded[0]!.absPath));
  });

  it("supports multi-format inspect, simulate, readBinary, and runBatch on host handlers", async () => {
    const workCopy = path.join(scratchDir, "host-check");
    fs.cpSync(emtExampleDir, workCopy, { recursive: true });

    const recorded: RecordedHostArtifact[] = [];
    const host = createSysmlHostHandlers(workCopy, { recordedArtifacts: recorded });
    assert.ok(host.readBinary && host.inspect && host.simulate && host.runBatch);

    const rawBytes = await host.readBinary("data/poi_case.raw");
    assert.ok(rawBytes instanceof Uint8Array);
    assert.ok(rawBytes.byteLength > 100);

    // Clean PSS/E RAW + DYR audit
    const cleanInspect = await host.inspect("data/poi_case.raw", {
      companions: ["data/poi_case.dyr"],
      checks: ["nerc-mod032", "short-circuit"],
      options: { poiBus: 300 },
    });
    assert.equal(cleanInspect.format, "psse-raw");
    assert.equal(cleanInspect.metrics["missingDyrCount"], 0);
    assert.equal(cleanInspect.metrics["orphanDyrCount"], 0);
    assert.equal(cleanInspect.metrics["mod032Score"], 1);
    assert.ok(Number(cleanInspect.metrics["poiFaultMva"]) > 0);

    // Modified DYR with missing active gen 300 and orphan bus 999
    fs.writeFileSync(
      path.join(workCopy, "data/bad_case.dyr"),
      "100 'GENROU' 1 6.50 0.04 0.06 0.05 4.00 0.00 1.80 1.70 0.30 0.55 0.25 0.20 0.10 0.30 /\n" +
        "999 'GENROU' 1 6.50 0.04 0.06 0.05 4.00 0.00 1.80 1.70 0.30 0.55 0.25 0.20 0.10 0.30 /\n",
      "utf8",
    );
    const mismatchInspect = await host.inspect("data/poi_case.raw", {
      companions: ["data/bad_case.dyr"],
      options: { poiBus: 300 },
    });
    assert.equal(mismatchInspect.metrics["missingDyrCount"], 1);
    assert.equal(mismatchInspect.metrics["orphanDyrCount"], 1);

    // PSCAD inspect + multi-mode simulate
    const pscxInspect = await host.inspect("data/ibr_interconnection.pscx", { checks: ["emt-coverage"] });
    assert.equal(pscxInspect.format, "pscad-pscx");
    assert.ok(Number(pscxInspect.metrics["coverageRatio"]) > 0);

    const freqWaves = await host.simulate("data/ibr_interconnection.pscx", {
      mode: "frequency-scan",
      startFreqHz: 10,
      endFreqHz: 60,
      freqStepHz: 10,
    });
    assert.ok(Object.keys(freqWaves).some((k) => k.toLowerCase().includes("r")));

    const batchRes = await host.runBatch(
      [
        {
          id: "freq-case",
          modelPath: "data/ibr_interconnection.pscx",
          options: { mode: "frequency-scan", startFreqHz: 10, endFreqHz: 30, freqStepHz: 10 },
        },
        {
          id: "emt-case",
          modelPath: "data/ibr_interconnection.pscx",
          options: { mode: "transient", stopTime: 0.02, stepSize: 0.001 },
        },
        {
          id: "missing-case",
          modelPath: "data/does_not_exist.pscx",
        },
      ],
      2,
    );
    assert.equal(batchRes.length, 3);
    assert.equal(batchRes[0]!.id, "freq-case");
    assert.equal(batchRes[0]!.ok, true);
    assert.ok(batchRes[0]!.waveforms && Object.keys(batchRes[0]!.waveforms).length > 0);
    assert.equal(batchRes[1]!.id, "emt-case");
    assert.equal(batchRes[1]!.ok, true);
    assert.equal(batchRes[2]!.id, "missing-case");
    assert.equal(batchRes[2]!.ok, false);
    assert.ok(batchRes[2]!.error);
  });

  it("executes chained DAG, skips guarded EMT stage on strong grid, escalates on weak grid, and signs DDP bundle", async () => {
    const packCopy = path.join(scratchDir, "emt-pack-e2e");
    fs.cpSync(emtExampleDir, packCopy, { recursive: true });
    const sysmlPath = path.join(packCopy, "src/system.sysml");

    const runWithCapturedJson = async (args: Record<string, unknown>) => {
      const lines: string[] = [];
      const origLog = console.log;
      console.log = (...parts: unknown[]) => {
        lines.push(parts.map(String).join(" "));
      };
      try {
        await SysmlRunCommand.handler({
          file: sysmlPath,
          json: true,
          _: ["sysml-run"],
          $0: "msx",
          ...args,
        } as never);
      } finally {
        console.log = origLog;
        process.exitCode = undefined;
      }
      return JSON.parse(lines.join("\n")) as {
        packageName: string;
        ok: boolean;
        bundle?: string;
        results: Array<{
          definition: string;
          skipped?: boolean;
          skipReason?: string;
          result: {
            ok: boolean;
            parameters?: Record<string, number | string | boolean>;
            artifacts?: Array<{
              kind: string;
              rows?: Array<string[]>;
            }>;
          };
        }>;
      };
    };

    // 1. Default strong grid (ibrRatedMw = 250.0) -> SCR >= 2.0 -> EmtSsciAndLvrtCheck skipped vacuously
    const strongJson = await runWithCapturedJson({});
    assert.equal(strongJson.ok, true);
    assert.deepEqual(
      strongJson.results.map((r) => r.definition),
      [
        "BaselineModelAudit",
        "GridStrengthGate",
        "EmtSsciAndLvrtCheck",
        "PmviewLvrtCheck",
        "TransformerCalibrationCheck",
      ],
    );
    const strongGate = strongJson.results.find((r) => r.definition === "GridStrengthGate")!;
    assert.equal(strongGate.result.parameters?.["emtMandatory"], false);
    assert.ok(Number(strongGate.result.parameters?.["scr"]) >= 2.0);

    const strongEmt = strongJson.results.find((r) => r.definition === "EmtSsciAndLvrtCheck")!;
    assert.equal(strongEmt.skipped, true);
    assert.equal(strongEmt.result.ok, true);
    assert.match(strongEmt.skipReason ?? "", /Precondition/);
    assert.ok(fs.existsSync(path.join(packCopy, "reports/baseline-audit.json")));

    // 2. Weak grid (--param GridStrengthGate.ibrRatedMw=350) + signed PSI 21 DDP bundle
    const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const privKeyPath = path.join(scratchDir, "ed25519-private.pem");
    const bundlePath = path.join(scratchDir, "emt-evidence.ddp.zip");
    fs.writeFileSync(privKeyPath, privateKey, "utf8");

    const weakJson = await runWithCapturedJson({
      param: ["GridStrengthGate.ibrRatedMw=350"],
      bundle: bundlePath,
      signKey: privKeyPath,
    });
    assert.equal(weakJson.ok, true);
    const weakGate = weakJson.results.find((r) => r.definition === "GridStrengthGate")!;
    assert.equal(weakGate.result.parameters?.["emtMandatory"], true);
    assert.ok(Number(weakGate.result.parameters?.["scr"]) < 2.0);

    const weakEmt = weakJson.results.find((r) => r.definition === "EmtSsciAndLvrtCheck")!;
    assert.equal(weakEmt.skipped, false);
    assert.equal(weakEmt.result.ok, true);
    assert.ok(Number(weakEmt.result.parameters?.["coverageRatio"]) > 0);
    assert.equal(weakEmt.result.parameters?.["envelopeOk"], true);
    assert.equal(weakEmt.result.parameters?.["hasSsciRisk"], false);
    assert.ok(fs.existsSync(path.join(packCopy, "reports/emt-ssci-lvrt.json")));

    // Verify extracted DDP container structure, SHA-256 digests, and Ed25519 signature
    assert.ok(fs.existsSync(bundlePath));
    const extracted = DdpPackager.extractDdp(new Uint8Array(fs.readFileSync(bundlePath)));
    assert.equal(extracted.manifest.properties?.["allOk"], true);
    assert.equal(extracted.manifest.properties?.["signed"], true);

    const reqPaths = (extracted.manifest.artifacts.requirements ?? []).map((a) => a.path);
    const behPaths = (extracted.manifest.artifacts.behavior ?? []).map((a) => a.path);
    const docPaths = (extracted.manifest.artifacts.documentation ?? []).map((a) => a.path);
    assert.ok(reqPaths.includes("requirements/system.sysml"));
    assert.ok(behPaths.includes("behavior/data/poi_case.raw"));
    assert.ok(behPaths.includes("behavior/data/poi_case.dyr"));
    assert.ok(behPaths.includes("behavior/data/ibr_interconnection.pscx"));
    assert.ok(docPaths.includes("artifacts/reports/baseline-audit.json"));
    assert.ok(docPaths.includes("artifacts/reports/emt-ssci-lvrt.json"));
    assert.ok(docPaths.includes("reports/verification-report.json"));
    assert.ok(docPaths.includes("reports/attestation.json"));

    const reportBytes = extracted.files.get("reports/verification-report.json");
    const attBytes = extracted.files.get("reports/attestation.json");
    assert.ok(reportBytes && attBytes);

    const att = JSON.parse(Buffer.from(attBytes).toString("utf8")) as {
      algorithm: string;
      target: string;
      reportSha256: string;
      signatureBase64: string;
    };
    assert.equal(att.algorithm, "Ed25519");
    assert.equal(att.target, "reports/verification-report.json");
    assert.equal(att.reportSha256, sha256Hex(reportBytes));
    assert.equal(extracted.manifest.properties?.["reportSha256"], att.reportSha256);

    const reportDesc = extracted.manifest.artifacts.documentation?.find(
      (a) => a.path === "reports/verification-report.json",
    );
    assert.equal(reportDesc?.checksum, `sha256:${att.reportSha256}`);

    const verified = cryptoVerify(
      null,
      Buffer.from(att.reportSha256, "utf8"),
      publicKey,
      Buffer.from(att.signatureBase64, "base64"),
    );
    assert.equal(verified, true);

    // 3. Targeted `--def EmtSsciAndLvrtCheck` includes upstream closure only
    const targetedJson = await runWithCapturedJson({
      def: "EmtSsciAndLvrtCheck",
      param: ["GridStrengthGate.ibrRatedMw=350"],
    });
    assert.equal(targetedJson.ok, true);
    assert.deepEqual(
      targetedJson.results.map((r) => r.definition),
      ["BaselineModelAudit", "GridStrengthGate", "EmtSsciAndLvrtCheck"],
    );
  });
});
