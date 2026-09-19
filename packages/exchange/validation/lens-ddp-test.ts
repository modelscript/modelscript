// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  DdpManifestParser,
  DdpPackager,
  ManifestLensEngine,
  OpcAasxPackager,
  type CanonicalWorkspaceManifest,
  type DdpManifest,
} from "../src/index.js";

console.log("=== Running Digital Data Package (DDP) Exchange & Lens Tests ===");

// 1. Test DdpManifestParser
console.log("\n[Test 1] Testing DdpManifestParser serialization & validation...");

const sampleManifest: DdpManifest = {
  "@context": "https://w3id.org/cascara/v1/context.jsonld",
  ddpVersion: "1.0",
  packageId: "urn:acme:sys:subsystem:actuator-assy",
  title: "Flight Control Primary Actuator Assembly",
  version: "2.1.0",
  description: "Electro-Mechanical Actuator (EMA) with dual-redundant BLDC motor and ball screw",
  creator: {
    name: "ACME Research",
    organization: "ACME",
    email: "supplier.engagement@acme.com",
    role: "OEM Architect",
  },
  recipient: {
    name: "Actuator Systems Tier 1",
    organization: "Aerospace Systems",
  },
  createdAt: "2026-09-18T12:00:00Z",
  securityClassification: "None",
  license: "AGPL-3.0-or-later",
  artifacts: {
    requirements: [
      {
        id: "REQ_SYSML_01",
        path: "requirements/actuator.sysml",
        contentType: "text/x-sysml2",
        domain: "requirements",
        format: "SysML v2",
        description: "Primary actuator behavioral requirements and torque constraints",
      },
      {
        id: "REQ_REQIF_01",
        path: "requirements/airworthiness.reqif",
        contentType: "application/x-reqif+xml",
        domain: "requirements",
        format: "ReqIF 1.2",
        description: "FAA 14 CFR Part 25 airworthiness compliance items",
      },
    ],
    geometry: [
      {
        id: "CAD_STEP_01",
        path: "geometry/actuator_housing.stp",
        contentType: "application/step",
        domain: "geometry",
        format: "STEP AP242",
        description: "Detailed 3D B-Rep CAD model with semantic PMI",
      },
    ],
    behavior: [
      {
        id: "SIM_SSP_01",
        path: "behavior/actuator_dynamics.ssp",
        contentType: "application/x-ssp",
        domain: "behavior",
        format: "SSP 1.0",
        description: "Coupled multi-physics system simulation with parameter bindings",
      },
      {
        id: "SIM_FMU_01",
        path: "behavior/bldc_motor.fmu",
        contentType: "application/x-fmu",
        domain: "behavior",
        format: "FMI 3.0",
        description: "High-fidelity BLDC motor Co-Simulation FMU",
      },
    ],
    parameters: [
      {
        id: "PARAM_SSV_01",
        path: "parameters/design_limits.ssv",
        contentType: "text/csv",
        domain: "parameters",
        format: "SSV",
        description: "Operational nominal and extreme limits",
      },
    ],
    documentation: [
      {
        id: "DOC_PDF_01",
        path: "docs/actuator_tdp.pdf",
        contentType: "application/pdf",
        domain: "documentation",
        format: "3D PDF",
        description: "Human-readable 3D PDF technical data package",
      },
    ],
  },
  relations: [
    {
      id: "rel_01",
      relationType: "satisfies",
      source: "geometry/actuator_housing.stp",
      target: "requirements/actuator.sysml#MaxEnvelopeConstraint",
      description: "Outer physical dimensions comply with volume envelope",
      status: "passed",
    },
    {
      id: "rel_02",
      relationType: "verifies",
      source: "behavior/actuator_dynamics.ssp",
      target: "requirements/actuator.sysml#StepResponseTime",
      description: "Simulation verifies settling time is under 120ms",
      status: "passed",
    },
    {
      id: "rel_03",
      relationType: "describes",
      source: "docs/actuator_tdp.pdf",
      target: "geometry/actuator_housing.stp",
      description: "3D PDF visual representation for manual inspection",
    },
  ],
};

// Validate manifest
const validation = DdpManifestParser.validate(sampleManifest);
assert.strictEqual(validation.valid, true, `Manifest should be valid: ${validation.errors.join(", ")}`);

// Serialize and parse back
const serialized = DdpManifestParser.serialize(sampleManifest);
const parsed = DdpManifestParser.parse(serialized);
assert.strictEqual(parsed.packageId, sampleManifest.packageId);
assert.strictEqual(parsed.title, sampleManifest.title);
assert.strictEqual(parsed.artifacts.requirements?.length, 2);
assert.strictEqual(parsed.artifacts.geometry?.length, 1);
assert.strictEqual(parsed.artifacts.behavior?.length, 2);
assert.strictEqual(parsed.relations?.length, 3);
console.log("  ✓ DdpManifestParser validation and round-trip parsing passed.");

// 2. Test DdpPackager build and extract
console.log("\n[Test 2] Testing DdpPackager build & extract container...");

const dummySysml = `package ActuatorRequirements { requirement MaxEnvelopeConstraint; }`;
const dummyStep = `ISO-10303-21; HEADER; FILE_DESCRIPTION(('Actuator Housing'),'2;1'); ENDSEC; DATA; #1=CARTESIAN_POINT('',(0.,0.,0.)); ENDSEC; END-ISO-10303-21;`;
const dummyModelica = `model ActuatorDynamics parameter Real J = 0.05; end ActuatorDynamics;`;

const ddpBuffer = DdpPackager.buildDdp({
  manifest: sampleManifest,
  files: [
    { path: "requirements/actuator.sysml", data: dummySysml },
    { path: "geometry/actuator_housing.stp", data: dummyStep },
    { path: "behavior/actuator.mo", data: dummyModelica },
  ],
});

assert(ddpBuffer.length > 0, "DDP buffer should not be empty");
console.log(`  Built .ddp archive: ${ddpBuffer.length} bytes`);

// Extract DDP
const extracted = DdpPackager.extractDdp(ddpBuffer);
assert.strictEqual(extracted.manifest.packageId, sampleManifest.packageId);
assert.strictEqual(extracted.manifest.title, sampleManifest.title);

assert(extracted.files.has("requirements/actuator.sysml"), "Should contain actuator.sysml");
assert(extracted.files.has("geometry/actuator_housing.stp"), "Should contain actuator_housing.stp");
assert(extracted.files.has("behavior/actuator.mo"), "Should contain actuator.mo");

const extractedSysml = new TextDecoder().decode(extracted.files.get("requirements/actuator.sysml")!);
assert.strictEqual(extractedSysml, dummySysml, "Unpacked content must match original");

console.log("  ✓ DdpPackager build and extract container verified.");

// 3. Test Lens Engine Projection: Canonical <-> DDP
console.log("\n[Test 3] Testing Lens Engine Canonical <-> DDP projections...");

const canonical: CanonicalWorkspaceManifest = {
  globalAssetId: "urn:modelscript:aero:flap-actuator",
  idShort: "flap-actuator",
  title: "Trailing Edge Flap Actuator",
  version: "1.0.0",
  description: "High-lift system flap actuator",
  author: {
    name: "Aerospace Systems",
    organization: "ModelScript Aero",
    email: "aero@modelscript.org",
  },
  license: "Apache-2.0",
  requirements: [{ id: "REQ-01", path: "reqs/spec.sysml", format: "SysML v2", description: "Flap deployment rate" }],
  geometry: [{ id: "CAD-01", path: "cad/flap.stp", format: "STEP AP242", description: "Flap hinge geometry" }],
  behavior: [
    { id: "SIM-01", path: "sim/flap_model.mo", format: "Modelica 3.6", description: "Aerodynamic load simulation" },
  ],
  relations: [{ relationType: "verifies", source: "sim/flap_model.mo", target: "reqs/spec.sysml#REQ-01" }],
};

const ddpProjected = ManifestLensEngine.projectToDdp(canonical);
assert.strictEqual(ddpProjected.packageId, canonical.globalAssetId);
assert.strictEqual(ddpProjected.title, canonical.title);
assert.strictEqual(ddpProjected.artifacts.requirements?.length, 1);
assert.strictEqual(ddpProjected.artifacts.geometry?.length, 1);
assert.strictEqual(ddpProjected.artifacts.behavior?.length, 1);
assert.strictEqual(ddpProjected.relations?.length, 1);

const reconstructed = ManifestLensEngine.parseFromDdp(ddpProjected);
assert.strictEqual(reconstructed.globalAssetId, canonical.globalAssetId);
assert.strictEqual(reconstructed.title, canonical.title);
assert.strictEqual(reconstructed.requirements?.[0].path, "reqs/spec.sysml");
assert.strictEqual(reconstructed.geometry?.[0].path, "cad/flap.stp");
assert.strictEqual(reconstructed.behavior?.[0].path, "sim/flap_model.mo");
assert.strictEqual(reconstructed.relations?.[0].relationType, "verifies");

console.log("  ✓ Bidirectional Canonical <-> DDP lens projection verified.");

// 4. Test Cross-Compilation Bridge: DDP -> AASX
console.log("\n[Test 4] Testing Design-to-Operations compilation bridge (DDP -> AASX)...");

const aasxBuffer = ManifestLensEngine.bridgeDdpToAasx(extracted);
assert(aasxBuffer.length > 0, "AASX buffer should not be empty");
console.log(`  Cross-compiled .ddp to .aasx: ${aasxBuffer.length} bytes`);

// Unpack AASX to inspect submodels
const aasxExtracted = OpcAasxPackager.extractAasx(aasxBuffer);
assert(aasxExtracted.aasJson, "AAS JSON projection should be parsed");

const shells = aasxExtracted.aasJson.assetAdministrationShells;
assert.strictEqual(shells.length, 1);
assert.strictEqual(shells[0].idShort, sampleManifest.packageId.split(/[:/]/).pop());

const submodels = aasxExtracted.aasJson.submodels;
console.log(`  Generated AAS submodels: ${submodels.map((s) => s.idShort).join(", ")}`);

// Verify standard IDTA submodels are generated
const nameplate = submodels.find((s) => s.idShort === "Nameplate");
assert(nameplate, "Should have Nameplate submodel");

const cadSubmodel = submodels.find((s) => s.idShort.startsWith("CAD_"));
assert(cadSubmodel, "Should have CAD submodel");

const simSubmodel = submodels.find((s) => s.idShort.startsWith("Sim_"));
assert(simSubmodel, "Should have Simulation submodel");

// Verify supplementary files were transferred to AASX
assert(aasxExtracted.files.has("aasx/files/geometry/actuator_housing.stp"), "AASX must contain geometry file");
assert(aasxExtracted.files.has("aasx/files/behavior/actuator.mo"), "AASX must contain behavior file");

console.log("  ✓ DDP to AASX compilation bridge verified.");
console.log("\n=== All DDP Exchange Tests Passed Successfully! ===");
