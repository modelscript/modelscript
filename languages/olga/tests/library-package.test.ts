// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  OLGA_MODEL_SPECS,
  createFmuOlgaInstance,
  fmuToOlgaKey,
  getOlgaSchemasFromLibraries,
  instantiateOlgaWasmModel,
  lookupOlgaModelSchema,
  registerBuiltInOlgaLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/olga-std-lib");

describe("@modelscript/olga — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/olga-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected olga-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/olga-std-lib");
    assert.equal(pkg.manifest.language, "olga");
    assert.equal(pkg.symbols.length, OLGA_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, OLGA_MODEL_SPECS.length);
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
    registerBuiltInOlgaLibrarySync();
    const schemas = getOlgaSchemasFromLibraries();
    assert.ok(schemas.length >= OLGA_MODEL_SPECS.length);

    assert.equal(lookupOlgaModelSchema("flow_drift_flux")?.name, "FLOW_DRIFT_FLUX");
    assert.equal(lookupOlgaModelSchema("zuber_findlay")?.name, "FLOW_DRIFT_FLUX");
    assert.equal(lookupOlgaModelSchema("perkins_choke")?.name, "CHOKE");
    assert.equal(lookupOlgaModelSchema("standing_pvt")?.name, "PVT_BLACK_OIL");
    assert.equal(lookupOlgaModelSchema("heat_exchanger")?.name, "HEATEXCHANGER");
    assert.equal(lookupOlgaModelSchema("beggs_brill")?.name, "FLOW_BEGGS_BRILL");
    assert.equal(lookupOlgaModelSchema("taitel_dukler")?.name, "FLOW_TAITEL_DUKLER");
  });

  it("evaluates FLOW_DRIFT_FLUX, CHOKE, PVT_BLACK_OIL, and HEATEXCHANGER kernels in runtime.wasm", () => {
    // 1. FLOW_DRIFT_FLUX: Zuber-Findlay void fraction alpha = j_g / (C0 * j_m + v_gj)
    const driftFlux = instantiateOlgaWasmModel({
      id: "DF_1",
      modelType: "FLOW_DRIFT_FLUX",
      params: { c0: 1.2, v_gj: 0.35, diameter: 0.25 },
    });
    assert.ok(driftFlux, "Expected FLOW_DRIFT_FLUX WASM instance");
    driftFlux.init();
    const dfOut = driftFlux.eval(0, 0.1, { jGas: 3.0, jLiq: 1.0 });
    const expectedAlpha = 3.0 / (1.2 * (3.0 + 1.0) + 0.35);
    assert.ok(
      Math.abs(dfOut.voidFraction - expectedAlpha) < 1e-9,
      `Expected Zuber-Findlay alpha=${expectedAlpha}, got ${dfOut.voidFraction}`,
    );
    assert.ok(dfOut.pressureDrop > 0, `Expected positive frictional pressure gradient, got ${dfOut.pressureDrop}`);

    // 2. CHOKE: Perkins hydrodynamic mass flow & critical choking invariance
    const choke = instantiateOlgaWasmModel({
      id: "CHK_1",
      modelType: "CHOKE",
      params: { diameter: 0.05, cd: 0.826, rho_mix: 500.0, k_poly: 1.25 },
    });
    assert.ok(choke, "Expected CHOKE WASM instance");
    choke.init();
    const subcrit = choke.eval(0, 0.1, { pressureIn: 1.0e7, pressureOut: 8.5e6, opening: 0.8 });
    const crit1 = choke.eval(0, 0.1, { pressureIn: 1.0e7, pressureOut: 3.0e6, opening: 0.8 });
    const crit2 = choke.eval(0, 0.1, { pressureIn: 1.0e7, pressureOut: 1.0e6, opening: 0.8 });
    assert.ok(subcrit.massFlowOut > 0, `Expected positive subcritical choke flow, got ${subcrit.massFlowOut}`);
    assert.ok(crit1.massFlowOut > subcrit.massFlowOut, "Expected critical flow > subcritical flow");
    assert.ok(
      Math.abs(crit1.massFlowOut - crit2.massFlowOut) < 1e-6,
      `Expected choked mass flow invariant below critical pressure ratio (${crit1.massFlowOut} vs ${crit2.massFlowOut})`,
    );

    // 3. PVT_BLACK_OIL: Standing (1947) solution GOR Rs and oil FVF Bo
    const blackOil = instantiateOlgaWasmModel({
      id: "PVT_1",
      modelType: "PVT_BLACK_OIL",
      params: { api_gravity: 35.0, gas_gravity: 0.72 },
    });
    assert.ok(blackOil, "Expected PVT_BLACK_OIL WASM instance");
    blackOil.init();
    const pvtLow = blackOil.eval(0, 0.1, { pressureIn: 6.894757e6, temperatureIn: 333.15 }); // 1000 psia, 140 F
    const pvtHigh = blackOil.eval(0, 0.1, { pressureIn: 13.789514e6, temperatureIn: 333.15 }); // 2000 psia, 140 F
    assert.ok(
      pvtLow.solutionGor > 100 && pvtLow.solutionGor < 500,
      `Expected realistic Rs at 1000 psia, got ${pvtLow.solutionGor}`,
    );
    assert.ok(pvtHigh.solutionGor > pvtLow.solutionGor, "Expected Rs to increase with pressure");
    assert.ok(pvtLow.oilFvf > 1.0 && pvtLow.oilFvf < 1.6, `Expected realistic Bo > 1.0, got ${pvtLow.oilFvf}`);
    assert.ok(pvtHigh.oilFvf > pvtLow.oilFvf, "Expected Bo to increase with dissolved gas");

    // 4. HEATEXCHANGER: Q = U * A * (T - T_amb) and fluid cooling
    const hx = instantiateOlgaWasmModel({
      id: "HX_1",
      modelType: "HEATEXCHANGER",
      params: { u_coeff: 400.0, area: 50.0, cp_mix: 2000.0 },
    });
    assert.ok(hx, "Expected HEATEXCHANGER WASM instance");
    hx.init();
    const hxOut = hx.eval(0, 0.1, { temperatureIn: 350.0, temperatureAmb: 300.0, massFlowIn: 40.0 });
    const expectedQ = 400.0 * 50.0 * (350.0 - 300.0); // 1.0e6 W
    const expectedTout = 350.0 - expectedQ / (40.0 * 2000.0); // 337.5 K
    assert.ok(Math.abs(hxOut.heatFlux - expectedQ) < 1e-6, `Expected Q=${expectedQ} W, got ${hxOut.heatFlux}`);
    assert.ok(
      Math.abs(hxOut.temperatureOut - expectedTout) < 1e-6,
      `Expected T_out=${expectedTout} K, got ${hxOut.temperatureOut}`,
    );
  });

  it("projects and links an FMI 2.0/3.0 external FMU into OLGA", () => {
    const proj = fmuToOlgaKey(
      {
        modelName: "SubseaAntiSlugFmu",
        variables: [
          { name: "kp", causality: "parameter", type: "Real", valueReference: 1, start: 2.0 },
          { name: "p_in", causality: "input", type: "Real", valueReference: 2 },
          { name: "opening", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "RISER_1",
      "CTRL_FMU_1",
    );
    assert.ok(proj.keyKeywordBlock.includes("EXTERNAL_FMU"));
    assert.ok(proj.keyKeywordBlock.includes("SubseaAntiSlugFmu"));
    assert.deepEqual(proj.parameterNames, ["kp"]);

    const fmuInst = createFmuOlgaInstance("CTRL_FMU_1", "RISER_1", proj.modelName, (_t, _dt, io) => ({
      controlOut: Math.max(0.1, Math.min(1.0, (io.opening ?? 0.5) - 0.1)),
    }));
    const out = fmuInst.eval(0.1, 0.1, { pressureIn: 6.0e6, opening: 0.6 });
    assert.ok(Math.abs(out.controlOut - 0.5) < 1e-9);
  });
});
