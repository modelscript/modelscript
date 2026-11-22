// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/atopile — Static & Worst-Case Tolerance Constraint Linter (A1xxx–A4xxx).
 */

import type { AtoDiagnostic, AtoFile, AtoPhysicalValue } from "../types.js";

const BUILTIN_TYPES = new Set([
  "Resistor",
  "Capacitor",
  "Inductor",
  "Diode",
  "LED",
  "VoltageSource",
  "CurrentSource",
  "Power",
  "ElectricPower",
  "ElectricLogic",
  "I2C",
  "SPI",
  "UART",
  "CAN",
  "USB2_0",
]);

function checkPhysicalAssertion(
  actual: AtoPhysicalValue,
  op: "within" | "<" | "<=" | ">" | ">=" | "==",
  bound: AtoPhysicalValue,
): boolean {
  switch (op) {
    case "within":
      return actual.min >= bound.min - 1e-12 && actual.max <= bound.max + 1e-12;
    case "<":
      return actual.max < bound.min;
    case "<=":
      return actual.max <= bound.min + 1e-12;
    case ">":
      return actual.min > bound.max;
    case ">=":
      return actual.min >= bound.max - 1e-12;
    case "==":
      return Math.abs(actual.nominal - bound.nominal) <= 1e-12;
  }
}

export function lintAtopile(file: AtoFile): AtoDiagnostic[] {
  const diags: AtoDiagnostic[] = [...file.diagnostics];

  const knownTypes = new Set<string>(BUILTIN_TYPES);
  for (const imp of file.imports) {
    for (const name of imp.names) knownTypes.add(name);
  }

  const seenBlocks = new Set<string>();
  for (const b of file.blocks) {
    if (seenBlocks.has(b.name)) {
      diags.push({
        code: "A2001",
        severity: "error",
        message: `Duplicate atopile declaration '${b.name}'.`,
        span: b.span,
      });
    }
    seenBlocks.add(b.name);
    knownTypes.add(b.name);
  }

  for (const b of file.blocks) {
    const seenInst = new Set<string>();
    for (const inst of b.instances) {
      if (seenInst.has(inst.name)) {
        diags.push({
          code: "A2001",
          severity: "error",
          message: `Duplicate instance '${inst.name}' in '${b.name}'.`,
          span: inst.span,
        });
      }
      seenInst.add(inst.name);

      if (!knownTypes.has(inst.typeName)) {
        diags.push({
          code: "A2002",
          severity: "error",
          message: `Unresolved type '${inst.typeName}' for instance '${inst.name}' in '${b.name}'.`,
          span: inst.span,
        });
      }
    }

    // Index physical assignments for worst-case tolerance assertion verification
    const assignedValues = new Map<string, AtoPhysicalValue>();
    for (const a of b.assignments) {
      if (a.physicalValue) assignedValues.set(a.target, a.physicalValue);
    }

    for (const asrt of b.assertions) {
      const actual = assignedValues.get(asrt.target);
      if (!actual) continue;
      if (!checkPhysicalAssertion(actual, asrt.operator, asrt.bound)) {
        diags.push({
          code: "A3001",
          severity: "error",
          message: `Physical constraint violated: '${asrt.target}' (${actual.raw}, range [${actual.min}, ${actual.max}]) fails 'assert ${asrt.target} ${asrt.operator} ${asrt.bound.raw}'.`,
          span: asrt.span,
        });
      }
    }
  }

  return diags;
}
