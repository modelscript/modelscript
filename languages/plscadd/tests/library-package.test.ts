// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PLSCADD_MODEL_SPECS,
  createFmuPlsCaddInstance,
  fmuToPlsCaddRecord,
  getPlsCaddSchemasFromLibraries,
  instantiatePlsCaddWasmModel,
  lookupPlsCaddModelSchema,
  registerBuiltInPlsCaddLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/plscadd-std-lib");

describe("@modelscript/plscadd — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/plscadd-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected plscadd-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/plscadd-std-lib");
    assert.equal(pkg.manifest.language, "plscadd");
    assert.equal(pkg.symbols.length, PLSCADD_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, PLSCADD_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public provenance citations on every registered schema
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
    registerBuiltInPlsCaddLibrarySync();
    const schemas = getPlsCaddSchemasFromLibraries();
    assert.ok(schemas.length >= PLSCADD_MODEL_SPECS.length);

    assert.equal(lookupPlsCaddModelSchema("WIR_ACSR_DRAKE_795")?.name, "WIR_ACSR_DRAKE_795");
    assert.equal(lookupPlsCaddModelSchema("drake")?.name, "WIR_ACSR_DRAKE_795");
    assert.equal(lookupPlsCaddModelSchema("acss_drake")?.name, "WIR_ACSS_DRAKE_795");
    assert.equal(lookupPlsCaddModelSchema("NESC_HEAVY")?.name, "LOAD_NESC_HEAVY");
    assert.equal(lookupPlsCaddModelSchema("iec_60826_ice")?.name, "LOAD_IEC_60826_ICE");
    assert.equal(lookupPlsCaddModelSchema("lattice_230")?.name, "STR_LATTICE_TANGENT_230kV");
    assert.equal(lookupPlsCaddModelSchema("v_string")?.name, "INS_VSTRING_500kV");
  });

  it("evaluates exact catenary sag/tension, ruling-span state-change, and IEEE 738 ampacity for WIR_ACSR_DRAKE_795", () => {
    const drake = instantiatePlsCaddWasmModel({ id: "SPAN_1", modelType: "WIR_ACSR_DRAKE_795" });
    assert.ok(drake, "Expected WIR_ACSR_DRAKE_795 WASM instance");

    // Bare Drake: w = 15.965 N/m, S = 300 m, H = 28020 N (20% RTS), T = 15 degC
    const spanM = 300.0;
    const h0 = 28020.0;
    const wBare = 15.965;
    const nStates = drake.init({ spanM, horizontalTensionN: h0, unitWeightNPerM: wBare, ambientTempC: 15.0 });
    assert.equal(nStates, 4);

    const baseOut = drake.eval({
      spanM,
      horizontalTensionN: h0,
      unitWeightNPerM: wBare,
      ambientTempC: 15.0,
      operatingCurrentA: 600.0,
      windSpeedMs: 0.61,
    });

    // Exact hyperbolic catenary verification: D = (H/w)*(cosh(w*S/(2*H)) - 1)
    const u = (wBare * spanM) / (2.0 * h0);
    const expectedSag = (h0 / wBare) * (Math.cosh(u) - 1.0);
    const expectedArc = ((2.0 * h0) / wBare) * Math.sinh(u);
    const expectedTmax = h0 * Math.cosh(u);

    assert.ok(Math.abs(baseOut.sagM - expectedSag) < 1e-6, `Expected sag ${expectedSag}, got ${baseOut.sagM}`);
    assert.ok(
      Math.abs(baseOut.arcLengthM - expectedArc) < 1e-6,
      `Expected arc ${expectedArc}, got ${baseOut.arcLengthM}`,
    );
    assert.ok(
      Math.abs(baseOut.maxTensionN - expectedTmax) < 1e-3,
      `Expected Tmax ${expectedTmax}, got ${baseOut.maxTensionN}`,
    );
    assert.ok(
      baseOut.ampacityA > 850.0 && baseOut.ampacityA < 1100.0,
      `Expected IEEE 738 Drake ampacity ~900–1050 A at 15 degC ambient, got ${baseOut.ampacityA}`,
    );
    assert.ok(
      baseOut.conductorTempC > 15.0 && baseOut.conductorTempC < 75.0,
      `Expected conductor temp between 15 and 75 degC at 600 A, got ${baseOut.conductorTempC}`,
    );

    // Ruling-span thermal-elastic state change: heating from 15 degC to 75 degC lowers tension and increases sag
    const hotOut = drake.eval({ spanM, unitWeightNPerM: wBare, ambientTempC: 75.0 });
    assert.ok(
      hotOut.stateChangeTensionN < h0,
      `Expected thermal sag state-change to reduce H from ${h0}, got ${hotOut.stateChangeTensionN}`,
    );
    assert.ok(hotOut.sagM > baseOut.sagM, `Expected hot sag (${hotOut.sagM}) > base sag (${baseOut.sagM})`);
  });

  it("evaluates NESC C2 Rule 250B Heavy resultant unit weight and couples it to Drake catenary tension", () => {
    const nescHeavy = instantiatePlsCaddWasmModel({ id: "LC_HEAVY", modelType: "LOAD_NESC_HEAVY" });
    assert.ok(nescHeavy, "Expected LOAD_NESC_HEAVY WASM instance");
    nescHeavy.init();

    const wBare = 15.965;
    const diamM = 0.02814;
    const loadOut = nescHeavy.eval({ unitWeightNPerM: wBare, conductorDiamM: diamM });

    // Analytical NESC Heavy check: t_ice = 0.0127 m, p_w = 191.52 Pa, K = 4.378 N/m, rho_ice = 913 kg/m^3
    const expectedIce = 913.0 * 9.80665 * Math.PI * 0.0127 * (diamM + 0.0127);
    const expectedWind = 191.52 * (diamM + 2.0 * 0.0127);
    const expectedResultant = Math.hypot(wBare + expectedIce, expectedWind) + 4.378;

    assert.ok(
      Math.abs(loadOut.resultantUnitWeightNPerM - expectedResultant) < 1e-4,
      `Expected NESC Heavy resultant ${expectedResultant.toFixed(4)} N/m, got ${loadOut.resultantUnitWeightNPerM.toFixed(4)} N/m`,
    );
    assert.ok(loadOut.resultantUnitWeightNPerM > 35.0 && loadOut.resultantUnitWeightNPerM < 38.0);
    assert.ok(loadOut.conductorTempC === -17.8);

    // Apply NESC Heavy load to Drake via ruling-span state-change: ice+wind+cold raises tension significantly
    const drake = instantiatePlsCaddWasmModel({ id: "SPAN_HEAVY", modelType: "WIR_ACSR_DRAKE_795" });
    assert.ok(drake);
    drake.init({ spanM: 300.0, horizontalTensionN: 28020.0, unitWeightNPerM: wBare, ambientTempC: 15.0 });
    const heavyOut = drake.eval({
      spanM: 300.0,
      unitWeightNPerM: loadOut.resultantUnitWeightNPerM,
      ambientTempC: loadOut.conductorTempC,
    });
    assert.ok(
      heavyOut.stateChangeTensionN > 45000.0,
      `Expected heavy-loaded tension > 45 kN, got ${heavyOut.stateChangeTensionN}`,
    );
    assert.ok(heavyOut.utilizationRatio > 0.3 && heavyOut.utilizationRatio < 1.0);
  });

  it("projects and links an FMI 2.0/3.0 user-defined aeroelastic FMU alongside cleanroom models", () => {
    const proj = fmuToPlsCaddRecord(
      {
        modelName: "AeolianVibrationFmu",
        variables: [
          { name: "dampingRatio", causality: "parameter", type: "Real", valueReference: 1, start: 0.025 },
          { name: "spanM", causality: "input", type: "Real", valueReference: 2 },
          { name: "sagM", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "SPAN_FMU_1",
      230.0,
    );
    assert.ok(proj.plsRecord.includes("FMU_ELEMENT"));
    assert.ok(proj.plsRecord.includes("AeolianVibrationFmu"));
    assert.deepEqual(proj.parameterNames, ["dampingRatio"]);

    const fmuInst = createFmuPlsCaddInstance("SPAN_FMU_1", proj.modelName, (input) => {
      const s = input.spanM ?? 300.0;
      const w = input.unitWeightNPerM ?? 15.965;
      const h = input.horizontalTensionN ?? 28020.0;
      return { sagM: (w * s * s) / (8.0 * h) };
    });
    const out = fmuInst.eval({ spanM: 300.0, unitWeightNPerM: 16.0, horizontalTensionN: 30000.0 });
    assert.ok(Math.abs(out.sagM - 6.0) < 1e-9);
  });
});
