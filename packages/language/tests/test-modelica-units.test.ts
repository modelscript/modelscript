import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { modelicaLanguage } from "../../../languages/modelica/src/language.js";
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
} from "../../../languages/modelica/src/units.js";
import { buildParser } from "../src/api.js";

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
    let memory: WebAssembly.Memory;

    beforeAll(async () => {
      const result = buildParser(modelicaLanguage);
      const tmpDir = path.resolve(__dirname, "../build/tmp-units-lint-test");
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      for (const f of result.assemblyScriptFiles) {
        fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
      }
      fs.writeFileSync(path.join(tmpDir, "bindings.js"), result.javascriptWrapper.js);

      const ascPath =
        [
          path.resolve(__dirname, "../../node_modules/.bin/asc"),
          path.resolve(__dirname, "../../../node_modules/.bin/asc"),
          "npx asc",
        ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";

      childProcess.execSync(
        `${ascPath} parser.ts -O0 --enable threads --sharedMemory --runtime stub --exportRuntime --importMemory --maximumMemory 16384 --outFile parser.wasm`,
        { cwd: tmpDir, stdio: "pipe" },
      );

      const wasmBytes = fs.readFileSync(path.join(tmpDir, "parser.wasm"));
      memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
      const imports = {
        env: {
          memory: memory,
          abort: (msg: number, file: number, line: number, col: number) => {
            console.error(`WASM abort: ${msg} at ${file}:${line}:${col}`);
          },
          logNode: () => {},
          debugLog: () => {},
        },
        JavaScript: {
          debugLog: () => {},
          logNode: () => {},
        },
        engine: {
          debugLog: () => {},
        },
        parser: { logInt: () => {} },
        recovery: {},
        host: { runHostQuery: () => {} },
      };

      const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
      const { LspFacade } = await import(path.join(tmpDir, "bindings.js"));
      facade = new LspFacade(memory, instance.exports);
    }, 240000);

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
