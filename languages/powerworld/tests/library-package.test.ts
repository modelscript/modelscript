// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  POWERWORLD_MODEL_SPECS,
  createFmuPowerWorldInstance,
  fmuToPowerWorldAux,
  getPowerWorldSchemasFromLibraries,
  instantiatePowerWorldWasmModel,
  lookupPowerWorldModelSchema,
  registerBuiltInPowerWorldLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/powerworld-std-lib");

describe("@modelscript/powerworld — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/powerworld-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected powerworld-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/powerworld-std-lib");
    assert.equal(pkg.manifest.language, "powerworld");
    assert.equal(pkg.symbols.length, POWERWORLD_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, POWERWORLD_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & provenance metadata on every registered model
    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }
    for (const sym of pkg.symbols) {
      const prov = (sym.metadata as Record<string, unknown> | undefined)?.["provenance"];
      assert.ok(typeof prov === "string" && prov.length > 5, `Expected public provenance citation for ${sym.namePath}`);
    }
  });

  it("supports zero-I/O sync registration and case-insensitive alias lookup", () => {
    registerBuiltInPowerWorldLibrarySync();
    const schemas = getPowerWorldSchemasFromLibraries();
    assert.ok(schemas.length >= POWERWORLD_MODEL_SPECS.length);

    assert.equal(lookupPowerWorldModelSchema("genrou")?.name, "GENROU");
    assert.equal(lookupPowerWorldModelSchema("ESST1A")?.name, "ESST1A");
    assert.equal(lookupPowerWorldModelSchema("regc_a")?.name, "REGCA1");
    assert.equal(lookupPowerWorldModelSchema("cmpldw")?.name, "CMPLDW");
    assert.equal(lookupPowerWorldModelSchema("lshd1")?.name, "LDSHBL");
  });

  it("initializes flat-start equilibrium and steps core IEEE/WECC models in runtime.wasm", () => {
    const baseIo = {
      eterm: 1.0,
      speedDev: 0.0,
      efd: 1.5,
      pmech: 0.8,
      pelec: 0.8,
      qelec: 0.2,
      freqHz: 60.0,
      pref: 0.8,
    };

    // 1. Exciter (EXST1): flat-start residual ~ 0, then boosts efd when terminal voltage drops
    const exc = instantiatePowerWorldWasmModel({ modelType: "EXST1", busNum: 1, id: "1", params: [] });
    assert.ok(exc, "Expected EXST1 WASM instance");
    exc.init(baseIo);
    assert.ok(exc.checkFlatStart() < 1e-6, `Expected EXST1 flat-start residual < 1e-6, got ${exc.checkFlatStart()}`);
    const excDrop = exc.doStep(0.02, 0.02, { ...baseIo, eterm: 0.92 });
    assert.ok(excDrop.efd > baseIo.efd, `Expected EXST1 to boost efd on voltage dip, got ${excDrop.efd}`);

    // 2. Governor (HYGOV): flat-start residual ~ 0, then reduces pmech on overspeed
    const gov = instantiatePowerWorldWasmModel({ modelType: "HYGOV", busNum: 1, id: "1", params: [] });
    assert.ok(gov, "Expected HYGOV WASM instance");
    gov.init(baseIo);
    assert.ok(gov.checkFlatStart() < 1e-6, `Expected HYGOV flat-start residual < 1e-6, got ${gov.checkFlatStart()}`);
    let govOut = gov.doStep(0.05, 0.05, { ...baseIo, speedDev: 0.01 });
    for (let k = 1; k < 20; k++) {
      govOut = gov.doStep(0.05 * (k + 1), 0.05, { ...baseIo, speedDev: 0.01 });
    }
    assert.ok(govOut.pmech < baseIo.pmech, `Expected HYGOV to reduce pmech on overspeed, got ${govOut.pmech}`);

    // 3. Renewable converter (REGCA1): reduces active current via LVPL on voltage sag
    const ibr = instantiatePowerWorldWasmModel({ modelType: "REGCA1", busNum: 2, id: "1", params: [] });
    assert.ok(ibr, "Expected REGCA1 WASM instance");
    ibr.init(baseIo);
    assert.ok(ibr.checkFlatStart() < 1e-6, `Expected REGCA1 flat-start residual < 1e-6, got ${ibr.checkFlatStart()}`);
    let ibrOut = ibr.doStep(0.01, 0.01, { ...baseIo, eterm: 0.8 });
    for (let k = 1; k < 10; k++) {
      ibrOut = ibr.doStep(0.01 * (k + 1), 0.01, { ...baseIo, eterm: 0.8 });
    }
    assert.ok(ibrOut.irInj < 0.85, `Expected LVPL active current reduction on voltage sag, got ${ibrOut.irInj}`);

    // 4. UFLS Relay (LDSHBL): sheds load after sustained under-frequency below 59.3 Hz
    const relay = instantiatePowerWorldWasmModel({ modelType: "LDSHBL", busNum: 3, id: "1", params: [] });
    assert.ok(relay, "Expected LDSHBL WASM instance");
    relay.init(baseIo);
    assert.ok(
      relay.checkFlatStart() < 1e-6,
      `Expected LDSHBL flat-start residual < 1e-6, got ${relay.checkFlatStart()}`,
    );
    let relayOut = relay.doStep(0.05, 0.05, { ...baseIo, freqHz: 59.0 });
    for (let k = 1; k < 10; k++) {
      relayOut = relay.doStep(0.05 * (k + 1), 0.05, { ...baseIo, freqHz: 59.0 });
    }
    assert.ok(relayOut.tripMult < 1.0, `Expected LDSHBL to shed load below 59.3 Hz, got tripMult=${relayOut.tripMult}`);
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU via TSUserDefinedModel", () => {
    const proj = fmuToPowerWorldAux(
      {
        modelName: "VendorGovernorFmu",
        variables: [
          { name: "droop", causality: "parameter", type: "Real", valueReference: 1, start: 0.04 },
          { name: "dw", causality: "input", type: "Real", valueReference: 2 },
          { name: "pmech", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      10,
      "1",
    );
    assert.ok(proj.auxSection.includes("TSUserDefinedModel"));
    assert.ok(proj.auxSection.includes("VendorGovernorFmu"));

    const fmuInst = createFmuPowerWorldInstance(10, "1", proj.modelName, (_t, _dt, io) => ({
      pmech: io.pmech - 25.0 * io.speedDev,
    }));
    const out = fmuInst.doStep(0.02, 0.02, { eterm: 1.0, speedDev: 0.002, efd: 1.5, pmech: 0.8 });
    assert.ok(Math.abs(out.pmech - 0.75) < 1e-9);
  });
});
