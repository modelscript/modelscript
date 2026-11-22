// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ECLIPSE_MODEL_SPECS,
  createFmuEclipseInstance,
  fmuToEclipseUdq,
  getEclipseSchemasFromLibraries,
  instantiateEclipseWasmModel,
  lookupEclipseModelSchema,
  registerBuiltInEclipseLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/eclipse-std-lib");

describe("@modelscript/eclipse — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/eclipse-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected eclipse-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/eclipse-std-lib");
    assert.equal(pkg.manifest.language, "eclipse");
    assert.equal(pkg.symbols.length, ECLIPSE_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, ECLIPSE_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public provenance citations on every registered model
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
    registerBuiltInEclipseLibrarySync();
    const schemas = getEclipseSchemasFromLibraries();
    assert.ok(schemas.length >= ECLIPSE_MODEL_SPECS.length);

    assert.equal(lookupEclipseModelSchema("PVTO_LIVE_OIL")?.name, "pvto");
    assert.equal(lookupEclipseModelSchema("SWOF_COREY")?.name, "swof");
    assert.equal(lookupEclipseModelSchema("COMPDAT_PEACEMAN")?.name, "compdat");
    assert.equal(lookupEclipseModelSchema("AQUFETP_FETKOVICH")?.name, "aqufetp");
    assert.equal(lookupEclipseModelSchema("STONE2_3PHASE")?.name, "stone2");
  });

  it("evaluates COMPDAT_PEACEMAN, SWOF_COREY, STONE2_3PHASE, PVTO_LIVE_OIL, and AQUFETP_FETKOVICH in runtime.wasm", () => {
    // 1. Peaceman well productivity index: WI = 2*pi*k*h / (ln(ro/rw) + s)
    const compdat = instantiateEclipseWasmModel({
      modelType: "COMPDAT_PEACEMAN",
      params: { kx: 100.0, ky: 100.0, h: 50.0, dx: 100.0, dy: 100.0, rw: 0.25, skin: 0.5, unitFactor: 1.0 },
    });
    assert.ok(compdat, "Expected COMPDAT_PEACEMAN WASM instance");
    compdat.init();
    const compOut = compdat.eval({ pressure: 3000.0, bhp: 2000.0, mobility: 0.5 });
    const expectedRo = 0.14 * Math.sqrt(100.0 * 100.0 + 100.0 * 100.0);
    const expectedWi = (2.0 * Math.PI * 100.0 * 50.0) / (Math.log(expectedRo / 0.25) + 0.5);
    assert.ok(Math.abs(compOut.out1 - expectedRo) < 1e-6, `Expected ro=${expectedRo}, got ${compOut.out1}`);
    assert.ok(Math.abs(compOut.out0 - expectedWi) < 1e-6, `Expected WI=${expectedWi}, got ${compOut.out0}`);
    assert.ok(Math.abs(compOut.out2 - expectedWi * 0.5 * 1000.0) < 1e-4, `Expected qRate match, got ${compOut.out2}`);

    // 2. Corey oil-water relative permeability: krw = krwMax * Se^nw, krow = kroMax * (1 - Se)^no
    const swof = instantiateEclipseWasmModel({
      modelType: "SWOF_COREY",
      params: { swc: 0.2, sor: 0.2, krwMax: 0.8, kroMax: 1.0, nw: 2.0, no: 2.0, pcMax: 10.0 },
    });
    assert.ok(swof, "Expected SWOF_COREY WASM instance");
    swof.init();
    const swofOut = swof.eval({ sw: 0.5 }); // Se = (0.5 - 0.2) / 0.6 = 0.5
    assert.ok(Math.abs(swofOut.out0 - 0.8 * 0.25) < 1e-9, `Expected krw=0.2, got ${swofOut.out0}`);
    assert.ok(Math.abs(swofOut.out1 - 1.0 * 0.25) < 1e-9, `Expected krow=0.25, got ${swofOut.out1}`);
    assert.ok(Math.abs(swofOut.out2 - 2.5) < 1e-9, `Expected pcow=2.5, got ${swofOut.out2}`);

    // 3. Stone II 3-phase oil relative permeability
    const stone2 = instantiateEclipseWasmModel({ modelType: "STONE2_3PHASE" });
    assert.ok(stone2, "Expected STONE2_3PHASE WASM instance");
    stone2.init();
    const s2TwoPhase = stone2.eval({ sw: 0.5, sg: 0.0 });
    const s2ThreePhase = stone2.eval({ sw: 0.5, sg: 0.2 });
    assert.ok(
      Math.abs(s2TwoPhase.out0 - 0.25) < 1e-6,
      `Expected Stone II 2-phase limit kro=0.25, got ${s2TwoPhase.out0}`,
    );
    assert.ok(s2ThreePhase.out0 < s2TwoPhase.out0, `Expected 3-phase kro < 2-phase kro, got ${s2ThreePhase.out0}`);

    // 4. Standing live-oil Rs(P) and Bo(P)
    const pvto = instantiateEclipseWasmModel({
      modelType: "PVTO_LIVE_OIL",
      params: { api: 35.0, gammaG: 0.75, pb: 2500.0, co: 1.5e-5, muDead: 2.0 },
    });
    assert.ok(pvto, "Expected PVTO_LIVE_OIL WASM instance");
    pvto.init();
    const pLow = pvto.eval({ pressure: 1500.0, temperature: 180.0 });
    const pSat = pvto.eval({ pressure: 2500.0, temperature: 180.0 });
    const pOver = pvto.eval({ pressure: 3500.0, temperature: 180.0 });
    assert.ok(
      pSat.out0 > pLow.out0 && pLow.out0 > 100.0,
      `Expected Rs to increase with P below Pb: ${pLow.out0} -> ${pSat.out0}`,
    );
    assert.ok(Math.abs(pOver.out0 - pSat.out0) < 1e-9, `Expected constant Rs above Pb: ${pOver.out0} vs ${pSat.out0}`);
    assert.ok(
      pSat.out1 > 1.1 && pOver.out1 < pSat.out1,
      `Expected Bo > 1.1 at Pb and compressed above Pb: ${pSat.out1} -> ${pOver.out1}`,
    );

    // 5. Fetkovich analytical aquifer influx
    const aqu = instantiateEclipseWasmModel({
      modelType: "AQUFETP_FETKOVICH",
      params: { pInit: 4000.0, wei: 1.0e8, jProd: 200.0 },
    });
    assert.ok(aqu, "Expected AQUFETP_FETKOVICH WASM instance");
    assert.equal(aqu.init(), 2);
    const step1 = aqu.eval({ pressure: 3500.0, dt: 30.0 });
    assert.ok(step1.out0 > 0.0, `Expected positive aquifer influx rate qAq, got ${step1.out0}`);
    assert.ok(step1.out1 > 0.0, `Expected positive cumulative influx We, got ${step1.out1}`);
    assert.ok(step1.out2 < 4000.0, `Expected depleted aquifer pressure pAq < 4000, got ${step1.out2}`);
    const step2 = aqu.eval({ pressure: 3500.0, dt: 30.0 });
    assert.ok(step2.out1 > step1.out1, `Expected cumulative We to grow on step 2: ${step1.out1} -> ${step2.out1}`);
    assert.ok(
      step2.out0 < step1.out0,
      `Expected influx rate qAq to decline as aquifer depletes: ${step1.out0} -> ${step2.out0}`,
    );
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU via ECLIPSE UDQ block", () => {
    const proj = fmuToEclipseUdq(
      {
        modelName: "SurfaceChokeFmu",
        variables: [
          { name: "chokeCd", causality: "parameter", type: "Real", valueReference: 1, start: 0.85 },
          { name: "bhp", causality: "input", type: "Real", valueReference: 2 },
          { name: "rate", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "PROD1",
    );
    assert.ok(proj.udqDeckBlock.includes("UDQ"));
    assert.ok(proj.udqDeckBlock.includes("SurfaceChokeFmu"));
    assert.deepEqual(proj.parameterNames, ["chokeCd"]);

    const fmuInst = createFmuEclipseInstance("PROD1", proj.modelName, (io) => ({
      out0: Math.max(0, ((io.pressure ?? 3000) - (io.bhp ?? 2000)) * 2.5),
    }));
    const out = fmuInst.eval({ pressure: 3200, bhp: 2200 });
    assert.ok(Math.abs(out.out0 - 2500) < 1e-9);
  });

  it("evaluates tabulated PVTO (undersaturated slopes), tabulated SWOF/SGOF, and 2D VFPPROD bilinear lookup", () => {
    // 1. Tabulated PVTO with 4 saturated rows [P, Rs, Bo, muO] and undersaturated (co, cmu) above Pb=2500
    const pvtoTab = instantiateEclipseWasmModel({
      modelType: "PVTO_LIVE_OIL",
      params: [
        35.0,
        0.75,
        2500.0,
        2.0e-5,
        2.0, // CON[0..4]: api, gammaG, pb, co, muDead
        4,
        3.0e-5, // CON[5]=nRows, CON[6]=cmu (1/psi)
        // Saturated table rows: [P_psia, Rs_scf_stb, Bo_rb_stb, muO_cP]
        500.0,
        120.0,
        1.08,
        1.4,
        1000.0,
        260.0,
        1.14,
        1.1,
        2000.0,
        560.0,
        1.26,
        0.7,
        2500.0,
        710.0,
        1.32,
        0.55,
      ],
    });
    assert.ok(pvtoTab, "Expected tabulated PVTO_LIVE_OIL instance");
    pvtoTab.init();

    // Saturated midpoint P=1500 between 1000 and 2000
    const satMid = pvtoTab.eval({ pressure: 1500.0 });
    assert.ok(Math.abs(satMid.out0 - 410.0) < 1e-9, `Expected Rs=410, got ${satMid.out0}`);
    assert.ok(Math.abs(satMid.out1 - 1.2) < 1e-9, `Expected Bo=1.20, got ${satMid.out1}`);
    assert.ok(Math.abs(satMid.out2 - 0.9) < 1e-9, `Expected muO=0.90, got ${satMid.out2}`);

    // Undersaturated P=3500 (dp = 1000 psi above Pb=2500)
    const under = pvtoTab.eval({ pressure: 3500.0 });
    const expectedBoUnder = 1.32 * Math.exp(-2.0e-5 * 1000.0);
    const expectedMuUnder = 0.55 * (1.0 + 3.0e-5 * 1000.0);
    assert.ok(Math.abs(under.out0 - 710.0) < 1e-9, `Expected constant Rs=710 above Pb, got ${under.out0}`);
    assert.ok(Math.abs(under.out1 - expectedBoUnder) < 1e-9, `Expected Bo=${expectedBoUnder}, got ${under.out1}`);
    assert.ok(Math.abs(under.out2 - expectedMuUnder) < 1e-9, `Expected muO=${expectedMuUnder}, got ${under.out2}`);

    // 2. Tabulated SWOF piecewise-linear interpolation
    const swofTab = instantiateEclipseWasmModel({
      modelType: "SWOF_COREY",
      params: [
        0.2,
        0.2,
        0.8,
        1.0,
        2.0,
        2.0,
        10.0, // CON[0..6]
        3, // CON[7] = nRows
        0.2,
        0.0,
        1.0,
        8.0,
        0.5,
        0.3,
        0.4,
        2.0,
        0.8,
        0.8,
        0.0,
        0.0,
      ],
    });
    assert.ok(swofTab);
    swofTab.init();
    const swofMid = swofTab.eval({ sw: 0.35 });
    assert.ok(Math.abs(swofMid.out0 - 0.15) < 1e-9, `Expected krw=0.15, got ${swofMid.out0}`);
    assert.ok(Math.abs(swofMid.out1 - 0.7) < 1e-9, `Expected krow=0.70, got ${swofMid.out1}`);
    assert.ok(Math.abs(swofMid.out2 - 5.0) < 1e-9, `Expected Pcow=5.0, got ${swofMid.out2}`);

    // 3. Tabulated SGOF piecewise-linear interpolation
    const sgofTab = instantiateEclipseWasmModel({
      modelType: "SGOF_COREY",
      params: [
        0.05,
        0.15,
        0.2,
        0.9,
        1.0,
        2.0,
        2.5,
        5.0, // CON[0..7]
        3, // CON[8] = nRows
        0.0,
        0.0,
        1.0,
        0.0,
        0.4,
        0.4,
        0.2,
        2.0,
        0.8,
        0.9,
        0.0,
        6.0,
      ],
    });
    assert.ok(sgofTab);
    sgofTab.init();
    const sgofMid = sgofTab.eval({ sg: 0.6 });
    assert.ok(Math.abs(sgofMid.out0 - 0.65) < 1e-9, `Expected krg=0.65, got ${sgofMid.out0}`);
    assert.ok(Math.abs(sgofMid.out1 - 0.1) < 1e-9, `Expected krog=0.10, got ${sgofMid.out1}`);
    assert.ok(Math.abs(sgofMid.out2 - 4.0) < 1e-9, `Expected Pcog=4.0, got ${sgofMid.out2}`);

    // 4. 2D VFPPROD bilinear BHP(rate, THP) lookup
    const vfp = instantiateEclipseWasmModel({
      modelType: "VFPPROD_LIFT",
      params: [
        8000.0,
        0.35,
        1.5e-5,
        150.0, // CON[0..3]
        3,
        2, // nRate=3, nThp=2
        500.0,
        1500.0,
        3000.0, // rate axis Q
        150.0,
        350.0, // THP axis
        // BHP[iThp=0 (THP=150)]: Q=500, 1500, 3000
        1800.0,
        2100.0,
        2700.0,
        // BHP[iThp=1 (THP=350)]: Q=500, 1500, 3000
        2050.0,
        2400.0,
        3050.0,
      ],
    });
    assert.ok(vfp, "Expected tabulated VFPPROD_LIFT instance");
    vfp.init();
    // Midpoint Q=1000 (wq=0.5 between 500 and 1500), THP=250 (wt=0.5 between 150 and 350)
    // row0 = 1950, row1 = 2225 => bilinear = 2087.5
    const vfpOut = vfp.eval({ rateIn: 1000.0, pressure: 250.0 });
    assert.ok(Math.abs(vfpOut.out0 - 250.0) < 1e-9);
    assert.ok(Math.abs(vfpOut.out1 - 2087.5) < 1e-9, `Expected BHP=2087.5, got ${vfpOut.out1}`);
    assert.ok(vfpOut.out3 > 0.3, `Expected positive dBHP/dQ slope, got ${vfpOut.out3}`);
  });
});
