// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { type CanonicalWorkspaceManifest, ManifestLensEngine, OpcAasxPackager, VariantResolver } from "../src/index.js";

const sampleManifest: CanonicalWorkspaceManifest = {
  globalAssetId: "urn:bsh:dishwasher:model:SN23EI14CE",
  idShort: "smart-dishwasher",
  title: "Smart Dishwasher Series 6",
  version: "1.2.0",
  scope: "@appliances",
  description: "60cm Built-in Dishwasher with Heat Pump & BLDC Inverter",
  author: {
    name: "BSH Hausgeräte GmbH",
    email: "engineering@bshg.com",
    organization: "BSH Home Appliances Group",
  },
  license: "CERN-OHL-P-2.0",
  homepage: "https://modelscript.org/@appliances/smart-dishwasher",
  bom: [
    {
      name: "BLDC Drain Pump",
      partNumber: "Askoll-M312 [variant:eu-230v]",
      quantity: 1,
      packageDependency: "@suppliers/askoll-drain-pump@^1.0.4",
      category: "actuator",
      sourcingUrl: "https://example.com/parts/askoll-m312",
      estimatedCost: 18.5,
    },
    {
      name: "BLDC Drain Pump 120V",
      partNumber: "Askoll-M120 [variant:us-120v]",
      quantity: 1,
      packageDependency: "@suppliers/askoll-drain-pump-us@^1.0.0",
      category: "actuator",
      estimatedCost: 19.0,
    },
    {
      name: "Water Inlet Valve",
      partNumber: "Bitron-2Way",
      quantity: 1,
      packageDependency: "@suppliers/bitron-valve@^3.2.0",
      category: "actuator",
    },
  ],
  variants: {
    "eu-230v": {
      description: "European 230V 50Hz configuration",
      overrides: { voltage: 230, frequency: 50 },
    },
    "us-120v": {
      description: "US 120V 60Hz configuration",
      overrides: { voltage: 120, frequency: 60 },
    },
  },
  makingInstructions: [
    {
      step: 1,
      instruction: "Mount the sump housing to the stainless steel tub using the silicone gasket.",
      tools: ["Torx T20 screwdriver"],
    },
    {
      step: 2,
      instruction: "Connect the BLDC drain pump with a 90-degree bayonet twist.",
      tools: ["Hands only"],
    },
  ],
};

async function runTests() {
  console.log("Starting Lens & AASX test suite...");

  // 1. Test NPM Projection
  console.log("Testing NPM projection...");
  const pkgJson = ManifestLensEngine.projectToPackageJson(sampleManifest);
  assert.strictEqual(pkgJson.name, "@appliances/smart-dishwasher");
  assert.strictEqual(pkgJson.version, "1.2.0");
  assert.strictEqual(pkgJson.license, "CERN-OHL-P-2.0");
  assert.strictEqual(pkgJson.author, "BSH Hausgeräte GmbH <engineering@bshg.com>");
  assert(pkgJson.dependencies);
  assert.strictEqual(pkgJson.dependencies["@suppliers/askoll-drain-pump"], "^1.0.4");
  assert.strictEqual(pkgJson.dependencies["@suppliers/bitron-valve"], "^3.2.0");
  assert(pkgJson.scripts?.simulate);

  // 2. Test AAS JSON Projection
  console.log("Testing AAS JSON projection...");
  const aasJson = ManifestLensEngine.projectToAasJson(sampleManifest);
  assert.strictEqual(aasJson.assetAdministrationShells.length, 1);
  const shell = aasJson.assetAdministrationShells[0];
  assert.strictEqual(shell.idShort, "smart-dishwasher");
  assert.strictEqual(shell.assetInformation.globalAssetId, "urn:bsh:dishwasher:model:SN23EI14CE");
  assert(aasJson.submodels.length >= 2);
  const nameplate = aasJson.submodels.find((s) => s.idShort === "Nameplate");
  assert(nameplate);
  const bomSubmodel = aasJson.submodels.find((s) => s.idShort === "BillOfMaterials");
  assert(bomSubmodel);

  // 3. Test OKH JSON Projection
  console.log("Testing OKH projection...");
  const okhJson = ManifestLensEngine.projectToOkhJson(sampleManifest, {
    cadFiles: [{ path: "cad/tub.step", description: "Stainless tub assembly" }],
    schematicsFile: "electronics/schematic.pdf",
    firmwareEntry: "firmware/src/main.cpp",
  });
  assert.strictEqual(okhJson.title, "Smart Dishwasher Series 6");
  assert.strictEqual(okhJson.name, "smart-dishwasher");
  assert.strictEqual(okhJson["standard-version"], "OKH-LOSH-v1.0");
  assert.strictEqual(okhJson.schematics, "electronics/schematic.pdf");
  assert(okhJson["manufacturing-files"] && okhJson["manufacturing-files"].length === 1);
  assert(okhJson["making-instructions"] && okhJson["making-instructions"].length === 2);
  assert(okhJson["tool-list"] && okhJson["tool-list"].includes("Torx T20 screwdriver"));
  assert(okhJson.software && okhJson.software[0]["entry-point"] === "firmware/src/main.cpp");

  // 4. Test Variant Resolution (150% Super-model -> 100% variant slice)
  console.log("Testing Variant resolution...");
  const euVariant = VariantResolver.resolveVariant(sampleManifest, "eu-230v");
  assert.strictEqual(euVariant.variantId, "eu-230v");
  assert.strictEqual(euVariant.parameterOverrides.voltage, 230);
  assert.strictEqual(euVariant.resolvedBom.length, 2); // eu-230v pump + 2-way valve (excluding us-120v pump)
  assert.strictEqual(euVariant.resolvedBom[0].name, "BLDC Drain Pump");

  const usVariant = VariantResolver.resolveVariant(sampleManifest, "us-120v");
  assert.strictEqual(usVariant.variantId, "us-120v");
  assert.strictEqual(usVariant.resolvedBom.length, 2);
  assert.strictEqual(usVariant.resolvedBom[0].name, "BLDC Drain Pump 120V");

  // 5. Test OPC AASX Packager (Build & Extract Round-trip)
  console.log("Testing AASX build and extract round-trip...");
  const dummyCad = new TextEncoder().encode("ISO-10303-21; HEADER; ... ENDSEC; DATA; ... ENDSEC; END-ISO-10303-21;");
  const aasxBuffer = OpcAasxPackager.buildAasx({
    aasJson,
    files: [{ path: "cad/tub.step", data: dummyCad, contentType: "application/step" }],
  });

  assert(aasxBuffer.byteLength > 0);
  console.log(`Generated .aasx package size: ${aasxBuffer.byteLength} bytes`);

  const extracted = OpcAasxPackager.extractAasx(aasxBuffer);
  assert(extracted.aasJson);
  assert.strictEqual(extracted.aasJson.assetAdministrationShells[0].idShort, "smart-dishwasher");
  assert(extracted.files.has("aasx/files/cad/tub.step"));
  const extractedCad = extracted.files.get("aasx/files/cad/tub.step");
  assert(extractedCad);
  assert.strictEqual(extractedCad.byteLength, dummyCad.byteLength);

  console.log("✅ All Lens, AASX, and Variant tests passed successfully!");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
