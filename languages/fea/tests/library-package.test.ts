// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  FEA_CARD_SPECS,
  createFmuFeaInstance,
  fmuToFeaInpCard,
  getFeaSchemasFromLibraries,
  instantiateFeaWasmCard,
  lookupFeaCardSchema,
  registerBuiltInFeaLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/fea-std-lib");

describe("@modelscript/fea — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/fea-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected fea-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/fea-std-lib");
    assert.equal(pkg.manifest.language, "fea");
    assert.equal(pkg.symbols.length, FEA_CARD_SPECS.length);
    assert.equal(pkg.diagrams.length, FEA_CARD_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public provenance citations on every registered card
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
    registerBuiltInFeaLibrarySync();
    const schemas = getFeaSchemasFromLibraries();
    assert.ok(schemas.length >= FEA_CARD_SPECS.length);

    assert.equal(lookupFeaCardSchema("MAT1")?.name, "MAT1_ISOTROPIC");
    assert.equal(lookupFeaCardSchema("c3d8r")?.name, "C3D8R_HEX8");
    assert.equal(lookupFeaCardSchema("*PLASTIC")?.name, "ABQ_PLASTIC_J2");
    assert.equal(lookupFeaCardSchema("PCOMP")?.name, "PCOMP_LAMINATE");
    assert.equal(lookupFeaCardSchema("CQUAD4")?.name, "CQUAD4_NASTRAN");
    assert.equal(lookupFeaCardSchema("RBE2")?.name, "RBE2_RIGID");
  });

  it("evaluates MAT1_ISOTROPIC (3D Hooke's law & Lamé constants) in runtime.wasm", () => {
    const E = 210e9;
    const nu = 0.3;
    const mat1 = instantiateFeaWasmCard("MAT1_ISOTROPIC", { E, nu });
    assert.ok(mat1, "Expected MAT1_ISOTROPIC WASM instance");
    assert.equal(mat1.init(), 2);

    // Uniaxial stress state: eps11 = 1e-3, eps22 = eps33 = -nu * eps11
    const eps11 = 1e-3;
    const out = mat1.evaluate({ eps11, eps22: -nu * eps11, eps33: -nu * eps11 });

    const expectedMu = E / (2 * (1 + nu));
    const expectedLam = (E * nu) / ((1 + nu) * (1 - 2 * nu));
    const expectedSig11 = E * eps11;

    assert.ok(
      Math.abs(out.sig11 - expectedSig11) / expectedSig11 < 1e-9,
      `Expected sig11=${expectedSig11}, got ${out.sig11}`,
    );
    assert.ok(Math.abs(out.sig22) < 1e-3, `Expected sig22 ~ 0, got ${out.sig22}`);
    assert.ok(Math.abs(out.vonMises - expectedSig11) / expectedSig11 < 1e-9);
    assert.ok(Math.abs(out.aux1 - expectedLam) / expectedLam < 1e-9, `Expected lambda=${expectedLam}, got ${out.aux1}`);
    assert.ok(Math.abs(out.aux2 - expectedMu) / expectedMu < 1e-9, `Expected mu=${expectedMu}, got ${out.aux2}`);
  });

  it("evaluates ABQ_PLASTIC_J2 (von Mises J2 radial-return plasticity with isotropic hardening) in runtime.wasm", () => {
    const E = 210e9;
    const nu = 0.3;
    const sigmaY0 = 250e6;
    const H = 2e9;
    const plastic = instantiateFeaWasmCard("ABQ_PLASTIC_J2", { E, nu, sigmaY0, H });
    assert.ok(plastic, "Expected ABQ_PLASTIC_J2 WASM instance");
    assert.equal(plastic.init(), 7);

    // 1. Elastic step below yield (eps11 = 0.5e-3 => sig11 = 105 MPa < 250 MPa)
    const elOut = plastic.evaluate({ eps11: 0.5e-3, eps22: -nu * 0.5e-3, eps33: -nu * 0.5e-3 });
    assert.equal(elOut.aux1, 0, "Expected zero plastic strain in elastic regime");
    assert.ok(Math.abs(elOut.vonMises - 105e6) < 1e3);

    // 2. Plastic step beyond yield (eps11 = 5e-3 => trial von Mises ~ 1050 MPa > 250 MPa)
    const plOut = plastic.evaluate({ eps11: 5e-3, eps22: -nu * 5e-3, eps33: -nu * 5e-3 });
    assert.ok(plOut.aux1 > 0, `Expected positive accumulated plastic strain, got ${plOut.aux1}`);
    const expectedYieldSurface = sigmaY0 + H * plOut.aux1;
    assert.ok(
      Math.abs(plOut.vonMises - expectedYieldSurface) / expectedYieldSurface < 1e-9,
      `Expected stress returned to yield surface ${expectedYieldSurface}, got ${plOut.vonMises}`,
    );
    assert.ok(plOut.vonMises < 1050e6, "Expected radial-return stress below elastic trial stress");
  });

  it("evaluates ABQ_HYPERELASTIC_NEO_HOOKE and ABQ_HYPERELASTIC_MOONEY_RIVLIN in runtime.wasm", () => {
    const C10 = 0.5e6;
    const nh = instantiateFeaWasmCard("ABQ_HYPERELASTIC_NEO_HOOKE", { C10, D1: 1e-8 });
    assert.ok(nh, "Expected Neo-Hooke WASM instance");
    nh.init();

    // Uniaxial stretch lambda = 1.5 (eps11 = 0.5)
    const lam = 1.5;
    const out = nh.evaluate({ eps11: lam - 1.0 });
    const expectedSig11 = 2 * C10 * (lam * lam - 1 / lam);
    const expectedW = C10 * (lam * lam + 2 / lam - 3);
    assert.ok(
      Math.abs(out.sig11 - expectedSig11) / expectedSig11 < 1e-9,
      `Expected sig11=${expectedSig11}, got ${out.sig11}`,
    );
    assert.ok(Math.abs(out.strainEnergy - expectedW) / expectedW < 1e-9);

    // Mooney-Rivlin uniaxial stress
    const C01 = 0.1e6;
    const mr = instantiateFeaWasmCard("ABQ_HYPERELASTIC_MOONEY_RIVLIN", { C10: 0.4e6, C01, D1: 1e-8 });
    assert.ok(mr, "Expected Mooney-Rivlin WASM instance");
    mr.init();
    const mrOut = mr.evaluate({ eps11: lam - 1.0 });
    const expectedMrSig = 2 * (0.4e6 + C01 / lam) * (lam * lam - 1 / lam);
    assert.ok(Math.abs(mrOut.sig11 - expectedMrSig) / expectedMrSig < 1e-9);
  });

  it("evaluates ABQ_CREEP_NORTON (power-law creep rate d(eps)/dt = A * sigma^n) in runtime.wasm", () => {
    const A = 1e-36;
    const n = 4.0;
    const E = 200e9;
    const nu = 0.3;
    const creep = instantiateFeaWasmCard("ABQ_CREEP_NORTON", { A, n, m: 0.0, E, nu });
    assert.ok(creep, "Expected ABQ_CREEP_NORTON WASM instance");
    creep.init();

    // Uniaxial stress 200 MPa (eps11 = 1e-3) over dt = 3600 s
    const eps11 = 1e-3;
    const dtSec = 3600.0;
    const out = creep.evaluate({ eps11, eps22: -nu * eps11, eps33: -nu * eps11, dtSec });
    const expectedRate = A * Math.pow(200e6, n);
    assert.ok(
      Math.abs(out.aux1 - expectedRate) / expectedRate < 1e-9,
      `Expected creepRate=${expectedRate}, got ${out.aux1}`,
    );
    assert.ok(Math.abs(out.aux2 - expectedRate * dtSec) / (expectedRate * dtSec) < 1e-9);
  });

  it("evaluates MAT8_ORTHOTROPIC (Classical Laminate Theory reduced stiffness) in runtime.wasm", () => {
    const E1 = 140e9;
    const E2 = 10e9;
    const nu12 = 0.3;
    const G12 = 5e9;
    const mat8 = instantiateFeaWasmCard("MAT8_ORTHOTROPIC", { E1, E2, nu12, G12 });
    assert.ok(mat8, "Expected MAT8_ORTHOTROPIC WASM instance");
    assert.equal(mat8.init(), 3);

    const out = mat8.evaluate({ eps11: 1e-3, eps22: 0.0, gamma12: 2e-3 });
    const nu21 = nu12 * (E2 / E1);
    const denom = 1 - nu12 * nu21;
    const expectedQ11 = E1 / denom;
    const expectedQ22 = E2 / denom;
    const expectedQ12 = (nu12 * E2) / denom;

    assert.ok(Math.abs(out.aux1 - expectedQ11) / expectedQ11 < 1e-9);
    assert.ok(Math.abs(out.aux2 - expectedQ22) / expectedQ22 < 1e-9);
    assert.ok(Math.abs(out.sig11 - expectedQ11 * 1e-3) / (expectedQ11 * 1e-3) < 1e-9);
    assert.ok(Math.abs(out.sig22 - expectedQ12 * 1e-3) / (expectedQ12 * 1e-3) < 1e-9);
    assert.ok(Math.abs(out.tau12 - G12 * 2e-3) / (G12 * 2e-3) < 1e-9);
  });

  it("projects and links an FMI 2.0/3.0 user-defined UMAT FMU via *USER MATERIAL / MATUSR", () => {
    const proj = fmuToFeaInpCard(
      {
        modelName: "VendorUmatAlloyFmu",
        variables: [
          { name: "E", causality: "parameter", type: "Real", valueReference: 1, start: 195e9 },
          { name: "nu", causality: "parameter", type: "Real", valueReference: 2, start: 0.29 },
          { name: "eps11", causality: "input", type: "Real", valueReference: 3 },
          { name: "sig11", causality: "output", type: "Real", valueReference: 4 },
        ],
      },
      "INCONEL_718_UMAT",
    );
    assert.ok(proj.inpCard.includes("*USER MATERIAL"));
    assert.ok(proj.inpCard.includes("INCONEL_718_UMAT"));
    assert.ok(proj.bdfCard.includes("MATUSR"));
    assert.deepEqual(proj.parameterNames, ["E", "nu"]);

    const fmuInst = createFmuFeaInstance("umat-1", proj.modelName, (inp) => ({
      sig11: 195e9 * inp.eps11,
    }));
    const out = fmuInst.evaluate({ eps11: 1e-3 });
    assert.ok(Math.abs(out.sig11 - 195e6) < 1e-3);
    assert.ok(Math.abs(out.vonMises - 195e6) < 1e-3);
  });

  it("verifies 3D 6-component Voigt J2 plasticity (pure-shear + biaxial yield surface) and MITC4 S4R/CQUAD4 Mindlin-Reissner bending & shear stiffness", () => {
    const E = 210e9;
    const nu = 0.3;
    const sigmaY0 = 250e6;
    const H = 2e9;
    const mu = E / (2 * (1 + nu));

    // 1. 3D Pure Shear across all 3 shear components [g12, g23, g13]
    const j2Shear = instantiateFeaWasmCard("ABQ_PLASTIC_J2", { E, nu, sigmaY0, H });
    assert.ok(j2Shear);
    j2Shear.init();
    const g12 = 4e-3;
    const g23 = 3e-3;
    const g13 = 2e-3;
    const shearOut = j2Shear.evaluate({ eps11: 0, eps22: 0, eps33: 0, gamma12: g12, gamma23: g23, gamma13: g13 });
    const qTrialShear = Math.sqrt(3 * ((mu * g12) ** 2 + (mu * g23) ** 2 + (mu * g13) ** 2));
    const expectedDGamma = (qTrialShear - sigmaY0) / (3 * mu + H);
    const expectedVmShear = sigmaY0 + H * expectedDGamma;
    assert.ok(Math.abs((shearOut.dGamma ?? 0) - expectedDGamma) / expectedDGamma < 1e-9);
    assert.ok(Math.abs(shearOut.vonMises - expectedVmShear) / expectedVmShear < 1e-9);
    // Verify 3D von Mises reconstructed from all 3 returned shear stresses matches yield surface
    const vmFromStress = Math.sqrt(3 * (shearOut.tau12 ** 2 + (shearOut.tau23 ?? 0) ** 2 + (shearOut.tau13 ?? 0) ** 2));
    assert.ok(Math.abs(vmFromStress - expectedVmShear) / expectedVmShear < 1e-9);
    assert.ok(Math.abs(shearOut.aux2 - (E * H) / (E + H)) / ((E * H) / (E + H)) < 1e-9);

    // 2. 3D Biaxial + out-of-plane shear J2 yield surface consistency
    const j2Biax = instantiateFeaWasmCard("ABQ_PLASTIC_J2", { E, nu, sigmaY0, H });
    assert.ok(j2Biax);
    j2Biax.init();
    const biaxOut = j2Biax.evaluate({
      eps11: 3e-3,
      eps22: -2e-3,
      eps33: 0.5e-3,
      gamma12: 2e-3,
      gamma23: 1.5e-3,
      gamma13: -1e-3,
    });
    const expectedBiaxYield = sigmaY0 + H * biaxOut.aux1;
    assert.ok(biaxOut.aux1 > 0 && (biaxOut.dGamma ?? 0) > 0);
    assert.ok(
      Math.abs(biaxOut.vonMises - expectedBiaxYield) / expectedBiaxYield < 1e-9,
      `3D biaxial+shear J2 yield surface mismatch: got ${biaxOut.vonMises}, expected ${expectedBiaxYield}`,
    );

    // 3. MITC4 Shell Bending (S4R_SHELL & CQUAD4_NASTRAN): D = E*t^3/(12*(1-nu^2)) and shear stiffness G*ks*t
    const t = 0.02;
    const ks = 5.0 / 6.0;
    const expectedD = (E * t ** 3) / (12 * (1 - nu * nu));
    const expectedShearStiff = (E / (2 * (1 + nu))) * ks * t;
    for (const shellCard of ["S4R_SHELL", "CQUAD4_NASTRAN"] as const) {
      const sh = instantiateFeaWasmCard(shellCard, { thickness: t, E, nu, shearFactor: ks });
      assert.ok(sh, `Expected ${shellCard} WASM instance`);
      sh.init();
      const shOut = sh.evaluate({ eps11: 1e-3, eps22: 0.0, gamma12: 5e-4, gamma23: 1e-3, gamma13: 2e-3 });
      assert.ok(Math.abs(shOut.aux2 - expectedD) / expectedD < 1e-9, `${shellCard} D mismatch`);
      assert.ok(
        Math.abs((shOut.shearStiffness ?? 0) - expectedShearStiff) / expectedShearStiff < 1e-9,
        `${shellCard} shear stiffness G*ks*t mismatch`,
      );
      assert.ok((shOut.tau23 ?? 0) > 0 && (shOut.tau13 ?? 0) > 0, `${shellCard} expected transverse shear stresses`);
    }
  });
});
