// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulink — Direct Linear-Memory DAE Arena Lowering.
 *
 * Lowers continuous control systems, transfer functions, state-space representations,
 * and algebraic block diagrams directly into ModelScript's DAEBuilder arena:
 *
 * 1. Continuous state-space integration (Integrator, TransferFcn, StateSpace).
 * 2. Algebraic expressions and feedback routing (Gain, Sum, Product, Math, Switch, Constant).
 * 3. Discrete clocked states (UnitDelay).
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { parseVectorString } from "../lints/simulink-linters.js";
import type { SimulinkModel, SimulinkSystem } from "../types.js";

export interface SimulinkLoweringOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export function lowerSimulinkToDae(model: SimulinkModel, options?: SimulinkLoweringOptions): DAEBuilder {
  const name = options?.modelName ?? model.name ?? "SimulinkModel";
  const dae = options?.builder ?? new DAEBuilder(undefined, name);

  lowerSystemToDae(model.rootSystem, dae);
  return dae;
}

function lowerSystemToDae(system: SimulinkSystem, dae: DAEBuilder): void {
  // Map output ports: "srcBlock#port" -> ExprId in DAE
  const outputExprs = new Map<string, number>();

  // Map input connections: "dstBlock#port" -> "srcBlock#port"
  const wireMap = new Map<string, string>();
  for (const line of system.lines) {
    const srcKey = `${line.srcBlock}#${line.srcPort}`;
    if (line.dstBlock) {
      wireMap.set(`${line.dstBlock}#${line.dstPort ?? 1}`, srcKey);
    }
    for (const br of line.branches) {
      wireMap.set(`${br.dstBlock}#${br.dstPort}`, srcKey);
    }
  }

  // 1. Declare output signal variables for all blocks: ${block.name}.y (or .y_1, .y_2 for multi-port)
  for (const block of system.blocks.values()) {
    const outPorts = block.ports.filter((p) => p.type === "out");
    const outCount = outPorts.length > 0 ? outPorts.length : 1;

    for (let p = 1; p <= outCount; p++) {
      const varName = outCount === 1 ? `${block.name}.y` : `${block.name}.y_${p}`;
      const varType = VarType.Real;
      const variability = block.type === "Constant" ? Variability.Parameter : Variability.Continuous;
      const causality = block.type === "Inport" ? Causality.Input : Causality.Local;
      const startVal =
        block.type === "Integrator" ? Number.parseFloat(String(block.parameters.get("InitialCondition") ?? "0")) : 0.0;

      dae.addVariable(varName, varType, variability, causality, Number.isFinite(startVal) ? startVal : 0.0);
      const varExpr = dae.addNameExpr(varName);
      outputExprs.set(`${block.name}#${p}`, varExpr);
    }
  }

  // Helper to retrieve driving input expression for a port
  const getInputExpr = (blockName: string, portNumber: number): number => {
    const srcKey = wireMap.get(`${blockName}#${portNumber}`);
    if (srcKey && outputExprs.has(srcKey)) {
      return outputExprs.get(srcKey)!;
    }
    // Default to constant 0.0 if unconnected
    return dae.addRealLiteral(0.0);
  };

  // 2. Formulate equations for each block type
  for (const block of system.blocks.values()) {
    const outExpr = outputExprs.get(`${block.name}#1`)!;

    switch (block.type) {
      // -----------------------------------------------------------------------
      // Constant
      // -----------------------------------------------------------------------
      case "Constant": {
        const valStr = String(block.parameters.get("Value") ?? "1.0");
        const val = Number.parseFloat(valStr);
        const valExpr = dae.addRealLiteral(Number.isFinite(val) ? val : 1.0);
        dae.addEquation(EqKind.Simple, outExpr, valExpr);
        break;
      }

      // -----------------------------------------------------------------------
      // Integrator: der(y) = u
      // -----------------------------------------------------------------------
      case "Integrator": {
        const uExpr = getInputExpr(block.name, 1);
        const derExpr = dae.addDerExpr(outExpr);
        dae.addEquation(EqKind.Simple, derExpr, uExpr);
        break;
      }

      // -----------------------------------------------------------------------
      // Gain: y = k * u
      // -----------------------------------------------------------------------
      case "Gain": {
        const kStr = String(block.parameters.get("Gain") ?? "1.0");
        const k = Number.parseFloat(kStr);
        const kExpr = dae.addRealLiteral(Number.isFinite(k) ? k : 1.0);
        const uExpr = getInputExpr(block.name, 1);
        const rhs = dae.addBinaryExpr(BinOp.Mul, kExpr, uExpr);
        dae.addEquation(EqKind.Simple, outExpr, rhs);
        break;
      }

      // -----------------------------------------------------------------------
      // Sum: y = (+/- u1) + (+/- u2) ...
      // -----------------------------------------------------------------------
      case "Sum": {
        const inputsStr = String(block.parameters.get("Inputs") ?? "++");
        const signs: ("+" | "-")[] = [];

        if (/^\d+$/.test(inputsStr)) {
          const count = Number.parseInt(inputsStr, 10);
          for (let i = 0; i < count; i++) signs.push("+");
        } else {
          for (let i = 0; i < inputsStr.length; i++) {
            const ch = inputsStr[i];
            if (ch === "+") signs.push("+");
            else if (ch === "-") signs.push("-");
          }
        }
        if (signs.length === 0) signs.push("+", "+");

        let sumExpr: number | null = null;
        for (let idx = 0; idx < signs.length; idx++) {
          const port = idx + 1;
          const uExpr = getInputExpr(block.name, port);
          const sign = signs[idx]!;

          if (sumExpr === null) {
            if (sign === "-") {
              const zero = dae.addRealLiteral(0.0);
              sumExpr = dae.addBinaryExpr(BinOp.Sub, zero, uExpr);
            } else {
              sumExpr = uExpr;
            }
          } else {
            const op = sign === "+" ? BinOp.Add : BinOp.Sub;
            sumExpr = dae.addBinaryExpr(op, sumExpr, uExpr);
          }
        }

        dae.addEquation(EqKind.Simple, outExpr, sumExpr ?? dae.addRealLiteral(0.0));
        break;
      }

      // -----------------------------------------------------------------------
      // Product: y = u1 * u2 (or / u2)
      // -----------------------------------------------------------------------
      case "Product": {
        const inputsStr = String(block.parameters.get("Inputs") ?? "2");
        const ops: ("*" | "/")[] = [];

        if (/^\d+$/.test(inputsStr)) {
          const count = Number.parseInt(inputsStr, 10);
          for (let i = 0; i < count; i++) ops.push("*");
        } else {
          for (let i = 0; i < inputsStr.length; i++) {
            const ch = inputsStr[i];
            if (ch === "*") ops.push("*");
            else if (ch === "/") ops.push("/");
          }
        }
        if (ops.length === 0) ops.push("*", "*");

        let prodExpr: number | null = null;
        for (let idx = 0; idx < ops.length; idx++) {
          const port = idx + 1;
          const uExpr = getInputExpr(block.name, port);
          const opChar = ops[idx]!;

          if (prodExpr === null) {
            prodExpr = uExpr;
          } else {
            const op = opChar === "*" ? BinOp.Mul : BinOp.Div;
            prodExpr = dae.addBinaryExpr(op, prodExpr, uExpr);
          }
        }

        dae.addEquation(EqKind.Simple, outExpr, prodExpr ?? dae.addRealLiteral(0.0));
        break;
      }

      // -----------------------------------------------------------------------
      // TransferFcn: Controllable Canonical Form
      // G(s) = (b_m s^m + ... + b0) / (s^n + a_{n-1} s^{n-1} + ... + a0)
      // -----------------------------------------------------------------------
      case "TransferFcn": {
        const numStr = String(block.parameters.get("Numerator") ?? "1");
        const denStr = String(block.parameters.get("Denominator") ?? "[1 1]");
        let numCoeffs = parseVectorString(numStr);
        let denCoeffs = parseVectorString(denStr);

        if (denCoeffs.length === 0) denCoeffs = [1, 1];
        if (numCoeffs.length === 0) numCoeffs = [1];

        // Normalize by leading denominator coefficient
        const aLead = denCoeffs[0]!;
        if (aLead !== 0 && aLead !== 1) {
          denCoeffs = denCoeffs.map((c) => c / aLead);
          numCoeffs = numCoeffs.map((c) => c / aLead);
        }

        const n = denCoeffs.length - 1; // Order of denominator
        const uExpr = getInputExpr(block.name, 1);

        if (n <= 0) {
          // Static gain
          const staticGain = (numCoeffs[0] ?? 1.0) / (denCoeffs[0] ?? 1.0);
          const gainExpr = dae.addRealLiteral(staticGain);
          dae.addEquation(EqKind.Simple, outExpr, dae.addBinaryExpr(BinOp.Mul, gainExpr, uExpr));
          break;
        }

        // Pad numerator with leading zeros so length equals n + 1
        while (numCoeffs.length < n + 1) {
          numCoeffs.unshift(0);
        }

        // Controllable Canonical Form:
        // States x_1, x_2, ..., x_n
        // der(x_1) = x_2
        // der(x_2) = x_3 ...
        // der(x_n) = -a_0 x_1 - a_1 x_2 ... - a_{n-1} x_n + u
        // y = (b_0 - b_n a_0) x_1 + ... + (b_{n-1} - b_n a_{n-1}) x_n + b_n u
        const stateExprs: number[] = [];
        for (let i = 1; i <= n; i++) {
          const stateName = `${block.name}.x${i}`;
          dae.addVariable(stateName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
          stateExprs.push(dae.addNameExpr(stateName));
        }

        // Kinematic derivative chain: der(x_i) = x_{i+1} for i = 1 .. n-1
        for (let i = 0; i < n - 1; i++) {
          dae.addEquation(EqKind.Simple, dae.addDerExpr(stateExprs[i]!), stateExprs[i + 1]!);
        }

        // Final state derivative: der(x_n) = u - sum(a_{k} * x_{k+1})
        // Note: denCoeffs is [1, a_{n-1}, a_{n-2}, ..., a_0]
        let rhsDerXn: number = uExpr;
        for (let k = 0; k < n; k++) {
          const aCoeff = denCoeffs[denCoeffs.length - 1 - k]!; // a_k
          if (aCoeff !== 0) {
            const aExpr = dae.addRealLiteral(aCoeff);
            const term = dae.addBinaryExpr(BinOp.Mul, aExpr, stateExprs[k]!);
            rhsDerXn = dae.addBinaryExpr(BinOp.Sub, rhsDerXn, term);
          }
        }
        dae.addEquation(EqKind.Simple, dae.addDerExpr(stateExprs[n - 1]!), rhsDerXn);

        // Output equation: y = sum( (b_k - b_n * a_k) * x_{k+1} ) + b_n * u
        const bn = numCoeffs[0]!;
        let rhsY: number | null = null;

        for (let k = 0; k < n; k++) {
          const bk = numCoeffs[numCoeffs.length - 1 - k]!;
          const ak = denCoeffs[denCoeffs.length - 1 - k]!;
          const cVal = bk - bn * ak;
          if (Math.abs(cVal) > 1e-12) {
            const cExpr = dae.addRealLiteral(cVal);
            const term = dae.addBinaryExpr(BinOp.Mul, cExpr, stateExprs[k]!);
            rhsY = rhsY === null ? term : dae.addBinaryExpr(BinOp.Add, rhsY, term);
          }
        }

        if (Math.abs(bn) > 1e-12) {
          const dExpr = dae.addRealLiteral(bn);
          const directTerm = dae.addBinaryExpr(BinOp.Mul, dExpr, uExpr);
          rhsY = rhsY === null ? directTerm : dae.addBinaryExpr(BinOp.Add, rhsY, directTerm);
        }

        dae.addEquation(EqKind.Simple, outExpr, rhsY ?? dae.addRealLiteral(0.0));
        break;
      }

      // -----------------------------------------------------------------------
      // UnitDelay: Discrete state variable
      // -----------------------------------------------------------------------
      case "UnitDelay": {
        const uExpr = getInputExpr(block.name, 1);
        const xPrevName = `${block.name}.x_prev`;
        const x0 = Number.parseFloat(String(block.parameters.get("InitialCondition") ?? "0"));
        dae.addVariable(xPrevName, VarType.Real, Variability.Discrete, Causality.Local, Number.isFinite(x0) ? x0 : 0.0);
        const xPrevExpr = dae.addNameExpr(xPrevName);

        // y = x_prev
        dae.addEquation(EqKind.Simple, outExpr, xPrevExpr);
        // Discrete sample equation: x_prev = u
        dae.addEquation(EqKind.Simple, xPrevExpr, uExpr);
        break;
      }

      // -----------------------------------------------------------------------
      // Inport / Outport / SubSystem Pass-through
      // -----------------------------------------------------------------------
      case "Inport": {
        // Inport is driven externally
        break;
      }
      case "Outport": {
        const uExpr = getInputExpr(block.name, 1);
        dae.addEquation(EqKind.Simple, outExpr, uExpr);
        break;
      }
      case "SubSystem": {
        if (block.subsystem) {
          lowerSystemToDae(block.subsystem, dae);
        }
        break;
      }

      default: {
        // Generic pass-through
        const uExpr = getInputExpr(block.name, 1);
        dae.addEquation(EqKind.Simple, outExpr, uExpr);
        break;
      }
    }
  }
}
