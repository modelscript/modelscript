// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TOUGH_MODEL_SPECS,
  createFmuToughInstance,
  fmuToToughRockBlock,
  getToughSchemasFromLibraries,
  instantiateToughWasmModel,
  lookupToughModelSchema,
  registerBuiltInToughLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/tough-std-lib");

describe("@modelscript/tough — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/tough-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected tough-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/tough-std-lib");
    assert.equal(pkg.manifest.language, "tough");
    assert.equal(pkg.symbols.length, TOUGH_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, TOUGH_MODEL_SPECS.length);
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
    registerBuiltInToughLibrarySync();
    const schemas = getToughSchemasFromLibraries();
    assert.ok(schemas.length >= TOUGH_MODEL_SPECS.length);

    assert.equal(lookupToughModelSchema("EOS1_WATER")?.name, "eos1");
    assert.equal(lookupToughModelSchema("ECO2N_CO2_BRINE")?.name, "eco2n");
    assert.equal(lookupToughModelSchema("EOS9_RICHARDS")?.name, "eos9");
    assert.equal(lookupToughModelSchema("IRP7_VANGENUCHTEN")?.name, "irp7");
    assert.equal(lookupToughModelSchema("ICP7_VANGENUCHTEN")?.name, "icp7");
    assert.equal(lookupToughModelSchema("IRP3_COREY")?.name, "irp3");
  });

  it("evaluates IRP7_VANGENUCHTEN, ICP7_VANGENUCHTEN, IRP3_COREY, EOS1_WATER, EOS9_RICHARDS, and ECO2N_CO2_BRINE in runtime.wasm", () => {
    // 1. IRP7_VANGENUCHTEN (Van Genuchten-Mualem relative permeability)
    const irp7 = instantiateToughWasmModel({ modelType: "IRP7_VANGENUCHTEN" });
    assert.ok(irp7, "Expected IRP7_VANGENUCHTEN WASM instance");
    irp7.init({ liquidSat: 0.5 });

    const vgDry = irp7.eval({ liquidSat: 0.1 });
    assert.equal(vgDry.krLiquid, 0.0, "Expected k_rl = 0 below residual saturation Slr=0.15");

    const vgMid = irp7.eval({ liquidSat: 0.6 });
    const vgHigh = irp7.eval({ liquidSat: 0.85 });
    const vgSat = irp7.eval({ liquidSat: 1.0 });
    assert.ok(vgMid.krLiquid > 0 && vgMid.krLiquid < vgHigh.krLiquid, "Expected monotonic Van Genuchten k_rl");
    assert.equal(vgSat.krLiquid, 1.0, "Expected k_rl = 1 at full liquid saturation");
    assert.ok(vgMid.krGas > 0 && vgMid.krGas < 1.0, "Expected positive gas relative permeability at Sl=0.6");

    // 2. ICP7_VANGENUCHTEN (Van Genuchten capillary pressure)
    const icp7 = instantiateToughWasmModel({ modelType: "ICP7_VANGENUCHTEN" });
    assert.ok(icp7, "Expected ICP7_VANGENUCHTEN WASM instance");
    icp7.init({ liquidSat: 0.5 });

    const cpSat = icp7.eval({ liquidSat: 1.0 });
    assert.equal(cpSat.capillaryPressurePa, 0.0, "Expected P_cap = 0 at full saturation");

    const cpHigh = icp7.eval({ liquidSat: 0.8 });
    const cpLow = icp7.eval({ liquidSat: 0.3 });
    assert.ok(cpHigh.capillaryPressurePa < 0, `Expected negative P_cap at Sl=0.8, got ${cpHigh.capillaryPressurePa}`);
    assert.ok(
      cpLow.capillaryPressurePa < cpHigh.capillaryPressurePa,
      `Expected more negative P_cap at lower saturation: ${cpLow.capillaryPressurePa} vs ${cpHigh.capillaryPressurePa}`,
    );

    // 3. IRP3_COREY (Corey 1954 relative permeability: Slr=0.3, Sgr=0.05)
    const irp3 = instantiateToughWasmModel({ modelType: "IRP3_COREY" });
    assert.ok(irp3, "Expected IRP3_COREY WASM instance");
    irp3.init({ liquidSat: 0.625 });
    // S_hat = (0.625 - 0.3) / (1 - 0.3 - 0.05) = 0.325 / 0.65 = 0.5
    // k_rl = 0.5^4 = 0.0625, k_rg = (0.5)^2 * (1 - 0.25) = 0.1875
    const coreyOut = irp3.eval({ liquidSat: 0.625 });
    assert.ok(Math.abs(coreyOut.krLiquid - 0.0625) < 1e-9, `Expected Corey k_rl=0.0625, got ${coreyOut.krLiquid}`);
    assert.ok(Math.abs(coreyOut.krGas - 0.1875) < 1e-9, `Expected Corey k_rg=0.1875, got ${coreyOut.krGas}`);

    // 4. EOS1_WATER (IAPWS-IF97 water density & saturation pressure)
    const eos1 = instantiateToughWasmModel({ modelType: "EOS1_WATER" });
    assert.ok(eos1, "Expected EOS1_WATER WASM instance");
    eos1.init({ pressurePa: 101325.0, temperatureC: 25.0 });

    const water25 = eos1.eval({ pressurePa: 101325.0, temperatureC: 25.0 });
    assert.ok(
      water25.liquidDensity > 995 && water25.liquidDensity < 1000,
      `Expected water density ~997 kg/m^3 at 25 C, got ${water25.liquidDensity}`,
    );
    assert.ok(
      water25.saturationPressurePa > 3100 && water25.saturationPressurePa < 3250,
      `Expected P_sat(25 C) ~3169 Pa, got ${water25.saturationPressurePa}`,
    );

    const water100 = eos1.eval({ pressurePa: 5.0e5, temperatureC: 100.0 });
    assert.ok(
      Math.abs(water100.saturationPressurePa - 101418.0) < 500.0,
      `Expected IAPWS-IF97 P_sat(100 C) ~101418 Pa, got ${water100.saturationPressurePa}`,
    );
    assert.ok(
      water100.liquidDensity < water25.liquidDensity && water100.liquidDensity > 950,
      `Expected water density ~958 kg/m^3 at 100 C, got ${water100.liquidDensity}`,
    );
    assert.ok(
      Math.abs(water25.liquidEnthalpy - 104800.0) < 2500.0,
      `Expected IAPWS-IF97 liquid enthalpy ~104.8 kJ/kg at 25 C, got ${water25.liquidEnthalpy}`,
    );
    assert.ok(
      Math.abs(water100.liquidEnthalpy - 419500.0) < 6000.0,
      `Expected IAPWS-IF97 liquid enthalpy ~419.5 kJ/kg at 100 C / 0.5 MPa, got ${water100.liquidEnthalpy}`,
    );

    // 5. EOS9_RICHARDS (unsaturated hydraulic conductivity)
    const eos9 = instantiateToughWasmModel({ modelType: "EOS9_RICHARDS" });
    assert.ok(eos9, "Expected EOS9_RICHARDS WASM instance");
    const richSat = eos9.eval({ pressurePa: 101325.0, temperatureC: 20.0, liquidSat: 1.0 });
    const richUnsat = eos9.eval({ pressurePa: 101325.0, temperatureC: 20.0, liquidSat: 0.5 });
    assert.ok(richSat.effectiveConductivity > 0, "Expected positive saturated hydraulic conductivity");
    assert.ok(
      richUnsat.effectiveConductivity > 0 && richUnsat.effectiveConductivity < richSat.effectiveConductivity,
      "Expected unsaturated K_eff < K_sat in Richards equation",
    );

    // 6. ECO2N_CO2_BRINE (supercritical CO2 density, brine density, CO2 solubility salting-out)
    const eco2n = instantiateToughWasmModel({ modelType: "ECO2N_CO2_BRINE" });
    assert.ok(eco2n, "Expected ECO2N_CO2_BRINE WASM instance");
    const freshCo2 = eco2n.eval({ pressurePa: 12.0e6, temperatureC: 45.0, salinity: 0.01 });
    const saltyCo2 = eco2n.eval({ pressurePa: 12.0e6, temperatureC: 45.0, salinity: 0.2 });
    assert.ok(
      freshCo2.gasDensity > 400 && freshCo2.gasDensity < 950,
      `Expected supercritical CO2 density in 400..950 kg/m^3 at 12 MPa, 45 C, got ${freshCo2.gasDensity}`,
    );
    assert.ok(
      saltyCo2.liquidDensity > freshCo2.liquidDensity,
      `Expected brine density to increase with salinity: ${saltyCo2.liquidDensity} vs ${freshCo2.liquidDensity}`,
    );
    assert.ok(
      freshCo2.co2Solubility > saltyCo2.co2Solubility && saltyCo2.co2Solubility > 0,
      `Expected Setschenow salting-out to reduce CO2 solubility: ${freshCo2.co2Solubility} vs ${saltyCo2.co2Solubility}`,
    );
  });

  it("projects and links an FMI 2.0/3.0 user-defined constitutive FMU via ROCKS block", () => {
    const proj = fmuToToughRockBlock(
      {
        modelName: "VendorEosFmu",
        variables: [
          { name: "alpha", causality: "parameter", type: "Real", valueReference: 1, start: 1.2e-4 },
          { name: "sl", causality: "input", type: "Real", valueReference: 2 },
          { name: "krl", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "SHALE",
    );
    assert.ok(proj.rockRecord.includes("ROCKS"));
    assert.ok(proj.rockRecord.includes("SHALE"));
    assert.ok(proj.rockRecord.includes("VendorEosFmu"));
    assert.deepEqual(proj.parameterNames, ["alpha"]);

    const fmuInst = createFmuToughInstance("SHALE", proj.modelName, (io) => {
      const sl = io.liquidSat ?? 0.5;
      return {
        krLiquid: sl * sl,
        krGas: (1 - sl) * (1 - sl),
      };
    });
    const out = fmuInst.eval({ liquidSat: 0.5 });
    assert.ok(Math.abs(out.krLiquid - 0.25) < 1e-9);
    assert.ok(Math.abs(out.krGas - 0.25) < 1e-9);
  });
});
