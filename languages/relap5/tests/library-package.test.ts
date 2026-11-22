// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  RELAP5_MODEL_SPECS,
  createFmuRelap5Instance,
  fmuToRelap5Deck,
  getRelap5SchemasFromLibraries,
  instantiateRelap5WasmModel,
  lookupRelap5ModelSchema,
  registerBuiltInRelap5LibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/relap5-std-lib");

describe("@modelscript/relap5 — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/relap5-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected relap5-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/relap5-std-lib");
    assert.equal(pkg.manifest.language, "relap5");
    assert.equal(pkg.symbols.length, RELAP5_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, RELAP5_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public provenance citations on every registered component
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
    registerBuiltInRelap5LibrarySync();
    const schemas = getRelap5SchemasFromLibraries();
    assert.ok(schemas.length >= RELAP5_MODEL_SPECS.length);

    assert.equal(lookupRelap5ModelSchema("snglvol")?.name, "SNGLVOL");
    assert.equal(lookupRelap5ModelSchema("dittus_boelter")?.name, "CORR_DITTUS_BOELTER");
    assert.equal(lookupRelap5ModelSchema("pke6g")?.name, "POINT_KINETICS_6G");
    assert.equal(lookupRelap5ModelSchema("ans79")?.name, "DECAY_HEAT_ANS79");
    assert.equal(lookupRelap5ModelSchema("iapws_if97")?.name, "STEAM_IAPWS_IF97");
  });

  it("evaluates POINT_KINETICS_6G, CORR_DITTUS_BOELTER, DECAY_HEAT_ANS79, STEAM_IAPWS_IF97, Zuber CHF, and choked valve flow in runtime.wasm", () => {
    // 1. 6-Group Point Reactor Kinetics (Heun RK2): flat-start equilibrium, then positive reactivity excursion
    const pke = instantiateRelap5WasmModel({ componentId: 100, modelType: "POINT_KINETICS_6G" });
    assert.ok(pke, "Expected POINT_KINETICS_6G WASM instance");
    const nStates = pke.init({ power: 3.0e9, reactivity: 0.0 });
    assert.equal(nStates, 7);
    const flatRes = pke.checkFlatStart();
    assert.ok(flatRes < 1e-3, `Expected POINT_KINETICS_6G flat-start residual ~ 0, got ${flatRes}`);

    // Insert +0.002 (+200 pcm) reactivity -> power must increase smoothly
    let pkeOut = pke.doStep(0.0, 0.05, { reactivity: 0.002 });
    for (let k = 1; k < 10; k++) {
      pkeOut = pke.doStep(0.05 * k, 0.05, { reactivity: 0.002 });
    }
    assert.ok(pkeOut.power > 3.5e9, `Expected reactor power rise on +200 pcm insertion, got ${pkeOut.power}`);

    // 2. Dittus-Boelter single-phase convection: Nu = 0.023 * Re^0.8 * Pr^0.4
    const db = instantiateRelap5WasmModel({ componentId: 200, modelType: "CORR_DITTUS_BOELTER" });
    assert.ok(db, "Expected CORR_DITTUS_BOELTER WASM instance");
    db.init();
    const re = 1.0e5;
    const pr = 0.85;
    const kFluid = 0.56;
    const dHyd = 0.012;
    const dbOut = db.doStep(0.0, 0.01, { reynolds: re, prandtl: pr, kFluid, dHyd });
    const expectedNu = 0.023 * Math.pow(re, 0.8) * Math.pow(pr, 0.4);
    const expectedHtc = (expectedNu * kFluid) / dHyd;
    assert.ok(
      Math.abs(dbOut.htc - expectedHtc) / expectedHtc < 1e-9,
      `Expected Dittus-Boelter h=${expectedHtc}, got ${dbOut.htc}`,
    );

    // 3. ANS-5.1-1979 Decay Heat Fraction: ~6% at 1s, ~3% at 100s, ~1.3% at 3600s, monotonically decreasing
    const ans = instantiateRelap5WasmModel({ componentId: 300, modelType: "DECAY_HEAT_ANS79" });
    assert.ok(ans, "Expected DECAY_HEAT_ANS79 WASM instance");
    ans.init({ power: 3.0e9 });
    const out1s = ans.doStep(0.0, 1.0, { power: 3.0e9 });
    const out100s = ans.doStep(0.0, 100.0, { power: 3.0e9 });
    const out3600s = ans.doStep(0.0, 3600.0, { power: 3.0e9 });
    assert.ok(
      out1s.decayFraction > 0.05 && out1s.decayFraction < 0.08,
      `Expected ~6% decay fraction at 1s, got ${out1s.decayFraction}`,
    );
    assert.ok(
      out100s.decayFraction > 0.02 && out100s.decayFraction < 0.045,
      `Expected ~3% decay fraction at 100s, got ${out100s.decayFraction}`,
    );
    assert.ok(
      out3600s.decayFraction > 0.008 && out3600s.decayFraction < 0.02,
      `Expected ~1.3% decay fraction at 3600s, got ${out3600s.decayFraction}`,
    );
    assert.ok(out1s.decayFraction > out100s.decayFraction && out100s.decayFraction > out3600s.decayFraction);

    // 4. IAPWS-IF97 Region 4 Water Saturation Temperature T_sat(P)
    const steam = instantiateRelap5WasmModel({ componentId: 400, modelType: "STEAM_IAPWS_IF97" });
    assert.ok(steam, "Expected STEAM_IAPWS_IF97 WASM instance");
    steam.init();
    // 1 atm = 101325 Pa -> T_sat = 373.124 K
    const sat1Atm = steam.doStep(0.0, 0.01, { pressure: 101325.0 });
    assert.ok(Math.abs(sat1Atm.tSat - 373.124) < 0.05, `Expected T_sat(1 atm) ~ 373.124 K, got ${sat1Atm.tSat}`);
    // PWR primary pressure 15.5 MPa -> T_sat = 617.94 K
    const satPwr = steam.doStep(0.0, 0.01, { pressure: 15.5e6 });
    assert.ok(Math.abs(satPwr.tSat - 617.94) < 0.1, `Expected T_sat(15.5 MPa) ~ 617.94 K, got ${satPwr.tSat}`);

    // 5. Zuber Pool-Boiling CHF at 1 atm saturated water (~1.11 MW/m^2)
    const zuber = instantiateRelap5WasmModel({ componentId: 500, modelType: "CORR_ZUBER_CHF" });
    assert.ok(zuber, "Expected CORR_ZUBER_CHF WASM instance");
    zuber.init();
    const zuberOut = zuber.doStep(0.0, 0.01);
    assert.ok(
      zuberOut.qFlux > 1.0e6 && zuberOut.qFlux < 1.3e6,
      `Expected Zuber CHF ~1.11 MW/m^2, got ${zuberOut.qFlux}`,
    );

    // 6. Homogeneous choked relief valve discharge above setpoint
    const relief = instantiateRelap5WasmModel({ componentId: 600, modelType: "VALVE_RELIEF" });
    assert.ok(relief, "Expected VALVE_RELIEF WASM instance");
    relief.init();
    const closedOut = relief.doStep(0.0, 0.01, { pressure: 15.5e6, pressure2: 0.1e6 });
    assert.equal(closedOut.massFlow, 0.0, "Expected relief valve closed below 16.2 MPa setpoint");
    const openOut = relief.doStep(0.0, 0.01, { pressure: 16.8e6, pressure2: 0.1e6 });
    assert.ok(
      openOut.massFlow > 100.0,
      `Expected positive choked relief discharge above 16.7 MPa, got ${openOut.massFlow}`,
    );
  });

  it("projects and links an FMI 2.0/3.0 external FMU into a RELAP5 deck", () => {
    const proj = fmuToRelap5Deck(
      {
        modelName: "ContainmentSprayFmu",
        variables: [
          { name: "sprayGain", causality: "parameter", type: "Real", valueReference: 1, start: 1.25 },
          { name: "pressure", causality: "input", type: "Real", valueReference: 2 },
          { name: "massFlow", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      710,
    );
    assert.ok(proj.controlCardDeck.includes("extfmu"));
    assert.ok(proj.controlCardDeck.includes("ContainmentSprayFmu"));
    assert.deepEqual(proj.parameterNames, ["sprayGain"]);

    const fmuInst = createFmuRelap5Instance(710, proj.modelName, (_t, _dt, io) => ({
      massFlow: (io.pressure ?? 0) > 0.3e6 ? 45.0 : 0.0,
    }));
    const out = fmuInst.doStep(1.0, 0.1, { pressure: 0.4e6 });
    assert.equal(out.massFlow, 45.0);
  });
});
