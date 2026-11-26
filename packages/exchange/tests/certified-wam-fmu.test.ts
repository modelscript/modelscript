// SPDX-License-Identifier: AGPL-3.0-or-later

import { SmallLlmZonotopeRuntime, type FormalCertificateSummary } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateCertifiedWamPolicy,
  exportCertifiedWamFmu,
  verifyZonotopeCertificateIntegrity,
} from "../src/fmu/certified-wam-fmu.js";
import { parseModelDescription } from "../src/fmu/model-description.js";

const VERIFIED_CERT: FormalCertificateSummary = {
  gate1GlrSyntax: true,
  gate2QudvUnits: true,
  gate3SmtFeasibility: true,
  gate4DaeBalance: true,
  simulationVerified: true,
  diagnostics: [],
  verifiedAtIso: "2026-11-26T12:00:00.000Z",
};

describe("Certified WAM / Neural Control Policy FMU Exporter (FMI 2.0 & 3.0)", () => {
  it("exports a trained SmallLlmZonotopeRuntime as a complete FMI 3.0 FMU bundle with valid XML, C99, and SHA-256 certificate", () => {
    const runtime = new SmallLlmZonotopeRuntime({
      vocabSize: 64,
      hiddenDim: 8,
      loraRank: 2,
      numLayers: 2,
      retrieverDim: 16,
      dynamicM: { mCap: 16, retrievalTau: 0.25 },
      seed: 2026,
    });

    const exported = exportCertifiedWamFmu({
      modelIdentifier: "ThermalReactorWamController",
      fmiVersion: "3.0",
      description: "Certified Dynamic-m thermal reactor controller",
      author: "ModelScript Safety Team",
      runtime,
      inputs: [
        { name: "temp_core", unit: "K", start: 0.2, uncertaintyRadius: 0.02, description: "Normalized core temp" },
        { name: "coolant_flow", unit: "kg/s", start: -0.1, uncertaintyRadius: 0.02, description: "Coolant flow rate" },
      ],
      outputs: [
        {
          name: "valve_cmd",
          unit: "1",
          safeMin: -5.0,
          safeMax: 5.0,
          fallbackValue: 0.0,
          description: "Bypass valve command",
        },
        {
          name: "pump_duty",
          unit: "1",
          safeMin: -5.0,
          safeMax: 5.0,
          fallbackValue: 0.5,
          description: "Primary pump duty cycle",
        },
      ],
      formalCert: VERIFIED_CERT,
      provenance: {
        modelPackage: "@ansatz/reactor-wam-policy",
        version: "1.2.0",
        gitSha: "abcdef1234567890",
        signerPubkey: "z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH",
        trainingRecipeId: "recipe-thermal-rlvr-v1",
        embedderId: "ansatz-embed-v1",
        exportedAtIso: "2026-11-26T12:00:00.000Z",
      },
    });

    // Archive & bundle layout checks
    assert.equal(exported.modelIdentifier, "ThermalReactorWamController");
    assert.deepEqual(exported.files, [
      "modelDescription.xml",
      "sources/wam_controller.c",
      "resources/zonotope-certificate.json",
    ]);
    assert.ok(exported.archive.byteLength > 200, "FMU ZIP archive must be non-empty");
    // ZIP local file header magic "PK\x03\x04"
    assert.equal(exported.archive[0], 0x50);
    assert.equal(exported.archive[1], 0x4b);
    assert.equal(exported.archive[2], 0x03);
    assert.equal(exported.archive[3], 0x04);

    // FMI 3.0 XML structure checks
    const xml3 = exported.modelDescriptionXml;
    assert.ok(xml3.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml3.includes('fmiVersion="3.0"'));
    assert.ok(xml3.includes('modelName="ThermalReactorWamController"'));
    assert.ok(xml3.includes("<CoSimulation "));
    assert.ok(xml3.includes('<Float64 name="temp_core"'));
    assert.ok(xml3.includes('<Float64 name="valve_cmd"'));
    assert.ok(xml3.includes('<Float64 name="valve_cmd_zonotope_radius"'));
    assert.ok(xml3.includes('<Boolean name="wam_safety_ok"'));
    assert.ok(xml3.includes('<Boolean name="wam_fallback_active"'));
    assert.ok(xml3.includes('<Int32 name="wam_active_m_cap"'));
    assert.ok(xml3.includes('start="16"'));
    assert.ok(xml3.includes('<Tool name="ModelScript.CertifiedWAM">'));
    assert.ok(xml3.includes(`certificateSha256="${exported.certificate.certificateSha256}"`));

    // Verify FMI 2.0 XML variant also contains ScalarVariable & VendorAnnotations
    const xml2 = exported.modelDescription2Xml;
    assert.ok(xml2.includes('fmiVersion="2.0"'));
    assert.ok(xml2.includes('<ScalarVariable name="temp_core"'));
    assert.ok(xml2.includes('<ScalarVariable name="valve_cmd"'));
    assert.ok(xml2.includes("<VendorAnnotations>"));
    assert.ok(xml2.includes('<Tool name="ModelScript.CertifiedWAM">'));

    // Cross-check with @modelscript/exchange's own FMI modelDescription XML parser
    const parsed2 = parseModelDescription(xml2);
    assert.equal(parsed2.fmiVersion, "2.0");
    assert.equal(parsed2.modelName, "ThermalReactorWamController");
    assert.ok(parsed2.variables.some((v) => v.name === "temp_core" && v.causality === "input"));
    assert.ok(parsed2.variables.some((v) => v.name === "valve_cmd" && v.causality === "output"));
    assert.ok(parsed2.variables.some((v) => v.name === "wam_safety_ok" && v.causality === "output"));

    // C99 codegen syntax markers
    const cSrc = exported.controllerCSource;
    assert.ok(cSrc.includes("#include <math.h>"));
    assert.ok(cSrc.includes("#define WAM_M_CAP 16"));
    assert.ok(cSrc.includes("static const double WAM_SAFETY_LO[WAM_NUM_OUTPUTS]"));
    assert.ok(cSrc.includes("static const double WAM_SAFETY_HI[WAM_NUM_OUTPUTS]"));
    assert.ok(cSrc.includes("static const double WAM_L0_W["));
    assert.ok(cSrc.includes("static double wam_gelu(double x)"));
    assert.ok(cSrc.includes("int wam_infer_and_verify("));
    assert.ok(cSrc.includes("fmi2DoStep("));
    assert.ok(cSrc.includes("fmi3DoStep("));
    assert.ok(cSrc.includes("fmi3GetFloat64("));
    assert.ok(cSrc.includes("fmi3SetFloat64("));

    // Certificate SHA-256 integrity checks
    const integrity = verifyZonotopeCertificateIntegrity(exported.zonotopeCertificateJson, exported.controllerCSource);
    assert.equal(integrity.valid, true);
    assert.equal(integrity.cSourceHashValid, true);
    assert.equal(integrity.computedHash, exported.certificate.certificateSha256);
    assert.equal(exported.certificate.mCap, 16);
    assert.equal(exported.certificate.provenance.modelPackage, "@ansatz/reactor-wam-policy");
    assert.equal(exported.certificate.formalCert.gate4DaeBalance, true);
    assert.equal(exported.certificate.outputBounds.length, 2);
  });

  it("detects cryptographic tampering of zonotope-certificate.json or sources/wam_controller.c", () => {
    const exported = exportCertifiedWamFmu({
      modelIdentifier: "TamperCheckController",
      fmiVersion: "both",
      policyLayers: [
        {
          inDim: 1,
          outDim: 1,
          baseWeight: [0.5],
          bias: [0.1],
          activation: "linear",
        },
      ],
      inputs: [{ name: "err", start: 0.0, uncertaintyRadius: 0.1 }],
      outputs: [{ name: "u", safeMin: -1.0, safeMax: 1.0, fallbackValue: 0.0 }],
    });

    assert.ok(exported.files.includes("modelDescription_fmi2.xml"));

    // Untampered passes
    const okCheck = verifyZonotopeCertificateIntegrity(exported.zonotopeCertificateJson, exported.controllerCSource);
    assert.equal(okCheck.valid, true);

    // Tamper with mCap in JSON -> SHA-256 check fails
    const tamperedJson = exported.zonotopeCertificateJson.replace('"mCap": 32', '"mCap": 64');
    const tamperedCertCheck = verifyZonotopeCertificateIntegrity(tamperedJson, exported.controllerCSource);
    assert.equal(tamperedCertCheck.valid, false);
    assert.ok(tamperedCertCheck.reasons.some((r) => r.includes("Certificate SHA-256 mismatch")));

    // Tamper with C99 source -> cSourceHashValid fails
    const tamperedC = exported.controllerCSource.replace("safety_ok = 0;", "safety_ok = 1;");
    const tamperedCCheck = verifyZonotopeCertificateIntegrity(exported.zonotopeCertificateJson, tamperedC);
    assert.equal(tamperedCCheck.valid, false);
    assert.equal(tamperedCCheck.cSourceHashValid, false);
    assert.ok(tamperedCCheck.reasons.some((r) => r.includes("C source SHA-256 mismatch")));
  });

  it("verifies LoRA weight folding parity, zonotope reachability soundness, and runtime safety-envelope fallback", () => {
    // Layer 0 (2 -> 2, relu): W_0 = [[1, 0], [0, 1]], LoRA rank 1: A = [1, 1], B = [0.5, -0.5], scale = 0.5
    // => W_eff_0 = [[1.25, 0.25], [-0.25, 0.75]], b = [0.1, 0.2]
    // Layer 1 (2 -> 1, linear): W = [[0.8, 0.4]], b = [0.0]
    const exported = exportCertifiedWamFmu({
      modelIdentifier: "LoraSafetyShieldPolicy",
      fmiVersion: "2.0",
      mCap: 12,
      policyLayers: [
        {
          inDim: 2,
          outDim: 2,
          baseWeight: [1.0, 0.0, 0.0, 1.0],
          bias: [0.1, 0.2],
          loraA: [1.0, 1.0],
          loraB: [0.5, -0.5],
          rank: 1,
          loraScale: 0.5,
          activation: "relu",
        },
        {
          inDim: 2,
          outDim: 1,
          baseWeight: [0.8, 0.4],
          bias: [0.0],
          activation: "linear",
        },
      ],
      inputs: [
        { name: "x1", start: 0.4, uncertaintyRadius: 0.05 },
        { name: "x2", start: 0.4, uncertaintyRadius: 0.05 },
      ],
      outputs: [{ name: "torque", safeMin: -1.0, safeMax: 1.5, fallbackValue: 0.25 }],
    });

    // Analytical expected output at x = [0.4, 0.4]:
    // h0 = relu(1.25*0.4 + 0.25*0.4 + 0.1) = relu(0.7) = 0.7
    // h1 = relu(-0.25*0.4 + 0.75*0.4 + 0.2) = relu(0.4) = 0.4
    // y  = 0.8*0.7 + 0.4*0.4 = 0.56 + 0.16 = 0.72
    const safeEval = evaluateCertifiedWamPolicy(exported, { x1: 0.4, x2: 0.4 });
    assert.ok(Math.abs(safeEval.rawOutputs["torque"]! - 0.72) < 1e-12);
    assert.ok(Math.abs(safeEval.safeOutputs["torque"]! - 0.72) < 1e-12);
    assert.equal(safeEval.safetyOk, true);
    assert.equal(safeEval.fallbackActive, false);
    assert.equal(safeEval.violatedOutputs.length, 0);
    assert.equal(exported.certificate.allOutputsCertifiedSafe, true);

    // Soundness verification: every perturbed point in [x - r, x + r] must stay enclosed by zonotope interval
    const nominalBound = exported.certificate.outputBounds[0]!;
    for (let sx = -1; sx <= 1; sx += 0.25) {
      for (let sy = -1; sy <= 1; sy += 0.25) {
        const pt = evaluateCertifiedWamPolicy(exported, { x1: 0.4 + sx * 0.05, x2: 0.4 + sy * 0.05 }, [0, 0]);
        const y = pt.rawOutputs["torque"]!;
        assert.ok(
          y >= nominalBound.reachableMin - 1e-7 && y <= nominalBound.reachableMax + 1e-7,
          `Sampled output ${y} escaped zonotope [${nominalBound.reachableMin}, ${nominalBound.reachableMax}]`,
        );
      }
    }

    // Unsafe operating point (x1 = 2.0, x2 = 2.0) -> raw output > 1.5 -> safety shield activates fallback!
    const unsafeEval = evaluateCertifiedWamPolicy(exported, { x1: 2.0, x2: 2.0 });
    assert.ok(unsafeEval.rawOutputs["torque"]! > 1.5);
    assert.equal(unsafeEval.safetyOk, false);
    assert.equal(unsafeEval.fallbackActive, true);
    assert.deepEqual(unsafeEval.violatedOutputs, ["torque"]);
    assert.equal(unsafeEval.safeOutputs["torque"], 0.25);
  });
});
