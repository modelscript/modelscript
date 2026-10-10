// SPDX-License-Identifier: AGPL-3.0-or-later

import * as path from "path";
import { fileURLToPath } from "url";
import { createWasmParser } from "../src-gen/bindings.js";
import {
  checkEquationUnits,
  DIMENSIONLESS,
  formatSIUnit,
  isDimensionless,
  parseUnit,
  SIUnit,
  unitDivide,
  unitMultiply,
  unitPower,
  unitsCompatible,
} from "../src/units.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica SI Units System & Diagnostics", () => {
  describe("Unit Parsing & Arithmetic", () => {
    it("should parse base and derived SI units", () => {
      const m = parseUnit("m");
      expect(m).toEqual(new SIUnit(1, 0, 0, 0, 0, 0, 0));

      const kg = parseUnit("kg");
      expect(kg).toEqual(new SIUnit(0, 1, 0, 0, 0, 0, 0));

      const s = parseUnit("s");
      expect(s).toEqual(new SIUnit(0, 0, 1, 0, 0, 0, 0));

      const v = parseUnit("V");
      expect(v).toEqual(new SIUnit(2, 1, -3, -1, 0, 0, 0));

      const ohm = parseUnit("Ohm");
      expect(ohm).toEqual(new SIUnit(2, 1, -3, -2, 0, 0, 0));
    });

    it("should parse compound and nested units with division and products", () => {
      const vel = parseUnit("m/s");
      expect(vel).toEqual(new SIUnit(1, 0, -1, 0, 0, 0, 0));

      const acc = parseUnit("m/s2");
      expect(acc).toEqual(new SIUnit(1, 0, -2, 0, 0, 0, 0));

      const specHeat = parseUnit("J/(kg.K)");
      expect(specHeat).toEqual(new SIUnit(2, 0, -2, 0, -1, 0, 0));

      const dimensionless = parseUnit("1");
      expect(dimensionless).toEqual(DIMENSIONLESS);
      if (dimensionless) {
        expect(isDimensionless(dimensionless)).toBe(true);
      }
    });

    it("should perform unit multiplication, division, and exponentiation", () => {
      const m = parseUnit("m");
      const s = parseUnit("s");
      expect(m).not.toBeNull();
      expect(s).not.toBeNull();
      if (!m || !s) return;

      // m / s = m/s
      const vel = unitDivide(m, s);
      expect(vel).toEqual(new SIUnit(1, 0, -1, 0, 0, 0, 0));

      // (m/s) / s = m/s2
      const acc = unitDivide(vel, s);
      expect(acc).toEqual(new SIUnit(1, 0, -2, 0, 0, 0, 0));

      // m^2
      const area = unitPower(m, 2);
      expect(area).toEqual(new SIUnit(2, 0, 0, 0, 0, 0, 0));

      // V = I * R (Ohm * A = V)
      const ohm = parseUnit("Ohm");
      const a = parseUnit("A");
      const v = parseUnit("V");
      expect(ohm).not.toBeNull();
      expect(a).not.toBeNull();
      expect(v).not.toBeNull();
      if (!ohm || !a || !v) return;
      const volt = unitMultiply(ohm, a);
      expect(unitsCompatible(volt, v)).toBe(true);
    });

    it("should format SI units back to strings and check equation compatibility", () => {
      const vel = parseUnit("m/s");
      expect(vel).not.toBeNull();
      if (vel) {
        expect(formatSIUnit(vel)).toBe("m·s-1");
      }

      const check1 = checkEquationUnits(parseUnit("m/s"), parseUnit("m/s"));
      expect(check1.consistent).toBe(true);

      const check2 = checkEquationUnits(parseUnit("m/s"), parseUnit("m"));
      expect(check2.consistent).toBe(false);
      expect(check2.message).toContain("Unit mismatch");
    });
  });

  describe("WASM Linter Unit Mismatch Diagnostics (M3010)", () => {
    let facade: any;

    beforeAll(async () => {
      const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
      const res = await createWasmParser(modelicaWasm);
      facade = res.facade;
    });

    it("should accept dimensionally consistent equations (v = der(x))", () => {
      const code = `model Kinematics
  Real x(unit="m");
  Real v(unit="m/s");
equation
  v = der(x);
end Kinematics;
`;
      const astNode = facade.parse(code);
      const diags = facade.getDiagnostics(astNode);
      const unitDiags = diags.filter((d: any) => d.code === 3010);
      expect(unitDiags.length).toBe(0);
    });

    it("should report warning 3010 for dimensionally inconsistent equations (v = x)", () => {
      const code = `model Inconsistent
  Real x(unit="m");
  Real v(unit="m/s");
equation
  v = x;
end Inconsistent;
`;
      const astNode = facade.parse(code);
      const diags = facade.getDiagnostics(astNode);
      const unitDiags = diags.filter((d: any) => d.code === 3010);
      expect(unitDiags.length).toBeGreaterThan(0);
      expect(unitDiags[0].code).toBe(3010);
    });

    it("should report warning 3010 for dimensionally inconsistent component binding", () => {
      const code = `model BindingMismatch
  Real x(unit="m");
  Real v(unit="m/s") = x * x;
equation
  x = 1.0;
end BindingMismatch;
`;
      const astNode = facade.parse(code);
      const diags = facade.getDiagnostics(astNode);
      const unitDiags = diags.filter((d: any) => d.code === 3010);
      expect(unitDiags.length).toBeGreaterThan(0);
      expect(unitDiags[0].code).toBe(3010);
    });
  });
});
