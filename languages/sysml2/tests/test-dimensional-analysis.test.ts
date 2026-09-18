// SPDX-License-Identifier: AGPL-3.0-or-later
import { createWasmParser } from "@modelscript/dsl";
import assert from "node:assert";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ACCELERATION,
  addDimensions,
  AREA,
  areDimensionsEqual,
  DIMENSIONLESS,
  ENERGY,
  FORCE,
  formatDimension,
  FREQUENCY,
  getDimensionLabel,
  LENGTH,
  MASS,
  multiplyDimension,
  POWER,
  PRESSURE,
  resolveTypeDimension,
  subtractDimensions,
  TIME,
  VELOCITY,
  VOLUME,
} from "../src/dimensions.js";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex, loadEmbeddedKerMLStdlib } from "../src/factory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sysmlWasm = path.resolve(__dirname, "../dist/parser.wasm");

test("QUDV Physical Dimensions Calculus", async (t) => {
  await t.test("verifies SI derived quantity dimensional algebra", () => {
    // Area = Length * Length
    assert.ok(areDimensionsEqual(addDimensions(LENGTH, LENGTH), AREA));
    // Volume = Area * Length
    assert.ok(areDimensionsEqual(addDimensions(AREA, LENGTH), VOLUME));
    // Velocity = Length / Time
    assert.ok(areDimensionsEqual(subtractDimensions(LENGTH, TIME), VELOCITY));
    // Acceleration = Velocity / Time
    assert.ok(areDimensionsEqual(subtractDimensions(VELOCITY, TIME), ACCELERATION));
    // Force = Mass * Acceleration
    assert.ok(areDimensionsEqual(addDimensions(MASS, ACCELERATION), FORCE));
    // Pressure = Force / Area
    assert.ok(areDimensionsEqual(subtractDimensions(FORCE, AREA), PRESSURE));
    // Energy = Force * Length
    assert.ok(areDimensionsEqual(addDimensions(FORCE, LENGTH), ENERGY));
    // Power = Energy / Time
    assert.ok(areDimensionsEqual(subtractDimensions(ENERGY, TIME), POWER));
    // Frequency = 1 / Time
    assert.ok(areDimensionsEqual(subtractDimensions(DIMENSIONLESS, TIME), FREQUENCY));
    // Exponentiation: Length^3 = Volume
    assert.ok(areDimensionsEqual(multiplyDimension(LENGTH, 3), VOLUME));
  });

  await t.test("formats dimension representations cleanly", () => {
    assert.strictEqual(formatDimension(DIMENSIONLESS), "1 (dimensionless)");
    assert.strictEqual(formatDimension(LENGTH), "L");
    assert.strictEqual(formatDimension(AREA), "L^2");
    assert.strictEqual(formatDimension(VELOCITY), "L·T^-1");
    assert.strictEqual(formatDimension(FORCE), "L·M·T^-2");
    assert.ok(getDimensionLabel(FORCE).includes("Force"));
  });

  await t.test("resolves dimensions from KerML stdlib types", async () => {
    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws);
    const unified = ws.toUnified();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Length")!, LENGTH));
    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Metre")!, LENGTH));
    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Mass")!, MASS));
    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Kilogram")!, MASS));
    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Time")!, TIME));
    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Second")!, TIME));
    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Force")!, FORCE));
    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Newton")!, FORCE));
    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Energy")!, ENERGY));
    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Joule")!, ENERGY));
    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Power")!, POWER));
    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Watt")!, POWER));
    assert.ok(areDimensionsEqual(resolveTypeDimension(db, "Real")!, DIMENSIONLESS));
  });

  await t.test("statically detects dimensional mismatches in SysML v2 models", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws);

    const modelCode = `
      package DimensionalTest {
        import ScalarValues::*;
        import ISQ::*;
        import SIBaseUnits::*;
        import SIDerivedUnits::*;

        part def System {
          attribute len : Length;
          attribute duration : Time;
          attribute weight : Mass;

        /* Valid derived assignment: Force = Mass * Acceleration */
        attribute accel : Acceleration;
        attribute validForce : Force = weight * accel;

        /* Invalid assignment: assigning Mass to Length */
        attribute invalidAssign : Length = weight;

        /* Invalid constraint: adding incompatible dimensions (Length + Time) */
        assert constraint { (len + duration) > 0 }

        /* Incompatible connection between Length and Time ports */
        port lenPort : Length;
        port timePort : Time;
        connect lenPort to timePort;

        /* Compatible connection */
        port lenPort2 : Length;
        connect lenPort to lenPort2;
      }
    }
  `;

    const uri = "file:///workspace/DimensionalTest.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(modelCode);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = ws.toUnified();
    const qe = createSysML2QueryEngine(unified, parser.parse(modelCode));
    const db = qe.toQueryDB();

    // 1. Verify invalidAssign lint triggers dimensional mismatch error
    const invalidAssign = db.byName("invalidAssign")[0];
    assert.ok(invalidAssign, "invalidAssign feature should be indexed");
    const assignDiag = qe.fetch("lint__dimensionalAssignment", invalidAssign.id);
    assert.ok(assignDiag, "Dimensional mismatch error should be emitted for invalidAssign");
    assert.ok(
      (assignDiag as any).message.includes("Dimensional mismatch"),
      `Expected message to mention Dimensional mismatch, got: ${(assignDiag as any).message}`,
    );

    // 2. Verify validForce passes without dimensional error
    const validForce = db.byName("validForce")[0];
    assert.ok(validForce, "validForce feature should be indexed");
    const validDiag = qe.fetch("lint__dimensionalAssignment", validForce.id);
    assert.strictEqual(validDiag, null, "validForce should have zero dimensional diagnostics");

    // 3. Verify constraint dimensional mismatch
    const system = db.byName("System")[0];
    const constraints = db.childrenOf(system.id).filter((c) => c.ruleName === "AssertConstraintUsage");
    assert.ok(constraints.length > 0, "AssertConstraintUsage should be indexed");
    const constraintDiag = qe.fetch("lint__dimensionalConstraint", constraints[0].id);
    assert.ok(constraintDiag, "Dimensional mismatch error should be emitted for constraint len + duration > 0");
    assert.ok(
      (constraintDiag as any).message.includes("incompatible physical dimensions"),
      `Expected incompatible physical dimensions in constraint, got: ${(constraintDiag as any).message}`,
    );

    // 4. Verify connection dimensional mismatch
    const connections = db.childrenOf(system.id).filter((c) => c.ruleName === "ConnectionUsage");
    assert.strictEqual(connections.length, 2, "Should have 2 connections");

    // Connection 1: lenPort to timePort (incompatible)
    const conn1Diag = qe.fetch("lint__connectionDimensionalConsistency", connections[0].id);
    assert.ok(conn1Diag, "Connection between Length and Time ports should be flagged as incompatible");
    assert.ok(
      (conn1Diag as any).message.includes("Dimensional mismatch in connection"),
      `Expected connection dimensional mismatch, got: ${(conn1Diag as any).message}`,
    );

    // Connection 2: lenPort to lenPort2 (compatible)
    const conn2Diag = qe.fetch("lint__connectionDimensionalConsistency", connections[1].id);
    assert.strictEqual(conn2Diag, null, "Connection between compatible Length ports should pass with 0 errors");
  });
});
