// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/verilog-a — Pre-Flight Diagnostic Linter Rules (M7601-M7620).
 *
 * Implements rigorous analog device modeling, discipline consistency, and numerical
 * convergence checks conforming strictly to OpenModelica diagnostic formatting:
 * - Single-quoted identifiers (e.g. '${name}')
 * - Period-terminated diagnostic messages
 * - Structured source line and column ranges
 */

import type {
  VerilogADiagnostic,
  VerilogADocument,
  VerilogAExpr,
  VerilogAModule,
  VerilogAStatement,
} from "../types.js";

export const VerilogAErrorCode = {
  UNASSIGNED_ANALOG_BRANCH: {
    code: "M7601",
    rule: "unassigned-analog-branch",
    severity: "error" as const,
    message: (p: string, n: string) =>
      `Electrical port pair '${p}' and '${n}' has no constitutive branch equation in analog block.`,
  },
  DISCONTINUOUS_DERIVATIVE_EXPRESSION: {
    code: "M7602",
    rule: "discontinuous-derivative-expression",
    severity: "warning" as const,
    message: (func: string) =>
      `Discontinuous time-derivative operator '${func}()' used inside conditional branch statement.`,
  },
  INVALID_PARAMETER_RANGE: {
    code: "M7603",
    rule: "invalid-parameter-range",
    severity: "error" as const,
    message: (name: string, val: string, range: string) =>
      `Parameter '${name}' default value ${val} violates declared range '${range}'.`,
  },
  UNBOUNDED_EXPONENTIAL_GROWTH: {
    code: "M7604",
    rule: "unbounded-exponential-growth",
    severity: "warning" as const,
    message: (ctx: string) => `Unbounded exponential function 'exp()' used instead of safe 'limexp()' in '${ctx}'.`,
  },
  PORT_DISCIPLINE_MISMATCH: {
    code: "M7605",
    rule: "port-discipline-mismatch",
    severity: "error" as const,
    message: (port: string) => `Port '${port}' has no declared discipline or mismatch with module domain.`,
  },
  UNDEFINED_NODE_REFERENCE: {
    code: "M7606",
    rule: "undefined-node-reference",
    severity: "error" as const,
    message: (node: string, branch: string) => `Branch access '${branch}' references undeclared node '${node}'.`,
  },
  DUPLICATE_MODULE_DECLARATION: {
    code: "M7607",
    rule: "duplicate-module-declaration",
    severity: "error" as const,
    message: (name: string) => `Duplicate module declaration for '${name}'.`,
  },
  ZERO_RESISTANCE_BRANCH: {
    code: "M7608",
    rule: "zero-resistance-branch",
    severity: "error" as const,
    message: (branch: string) => `Potential contribution '${branch}' forms an unconstrained ideal short-circuit.`,
  },
  FLOATING_INTERNAL_NODE: {
    code: "M7609",
    rule: "floating-internal-node",
    severity: "warning" as const,
    message: (node: string) =>
      `Internal node '${node}' is declared but never referenced in any analog branch equation.`,
  },
  UNSUPPORTED_ANALOG_PRIMITIVE: {
    code: "M7610",
    rule: "unsupported-analog-primitive",
    severity: "warning" as const,
    message: (primitive: string) => `Unsupported or deprecated analog primitive '${primitive}'.`,
  },
};

/**
 * Runs all pre-flight diagnostic rules against a parsed Verilog-A document.
 */
export function lintVerilogA(doc: VerilogADocument): VerilogADiagnostic[] {
  const diagnostics: VerilogADiagnostic[] = [];
  const seenModules = new Set<string>();

  for (const mod of doc.modules) {
    if (seenModules.has(mod.name)) {
      diagnostics.push({
        code: VerilogAErrorCode.DUPLICATE_MODULE_DECLARATION.code,
        rule: VerilogAErrorCode.DUPLICATE_MODULE_DECLARATION.rule,
        severity: VerilogAErrorCode.DUPLICATE_MODULE_DECLARATION.severity,
        message: VerilogAErrorCode.DUPLICATE_MODULE_DECLARATION.message(mod.name),
        range: mod.sourceRange,
      });
    } else {
      seenModules.add(mod.name);
    }

    lintModule(mod, diagnostics);
  }

  return diagnostics;
}

function lintModule(mod: VerilogAModule, diagnostics: VerilogADiagnostic[]): void {
  const knownNodes = new Set<string>();
  for (const p of mod.ports) {
    knownNodes.add(p.name);
  }
  for (const n of mod.internalNodes) {
    knownNodes.add(n);
  }
  for (const d of mod.disciplines) {
    for (const n of d.nodes) {
      knownNodes.add(n);
    }
  }

  // M7605: Port discipline mismatch
  for (const p of mod.ports) {
    if (!p.discipline) {
      diagnostics.push({
        code: VerilogAErrorCode.PORT_DISCIPLINE_MISMATCH.code,
        rule: VerilogAErrorCode.PORT_DISCIPLINE_MISMATCH.rule,
        severity: VerilogAErrorCode.PORT_DISCIPLINE_MISMATCH.severity,
        message: VerilogAErrorCode.PORT_DISCIPLINE_MISMATCH.message(p.name),
        range: p.sourceRange,
        quickFix: {
          title: `Add electrical discipline for port '${p.name}'`,
          newText: `electrical ${p.name};\n`,
          range: p.sourceRange,
        },
      });
    }
  }

  // M7603: Invalid parameter range
  for (const param of mod.parameters) {
    if (param.rangeSpec && typeof param.defaultValue === "number") {
      const { min, max, minInclusive, maxInclusive } = param.rangeSpec;
      let violated = false;
      if (min !== undefined) {
        if (minInclusive && param.defaultValue < min) violated = true;
        if (!minInclusive && param.defaultValue <= min) violated = true;
      }
      if (max !== undefined) {
        if (maxInclusive && param.defaultValue > max) violated = true;
        if (!maxInclusive && param.defaultValue >= max) violated = true;
      }
      if (violated) {
        const minStr = min !== undefined ? String(min) : "-inf";
        const maxStr = max !== undefined ? String(max) : "inf";
        const rangeStr = `${minInclusive ? "[" : "("}${minStr}:${maxStr}${maxInclusive ? "]" : ")"}`;
        diagnostics.push({
          code: VerilogAErrorCode.INVALID_PARAMETER_RANGE.code,
          rule: VerilogAErrorCode.INVALID_PARAMETER_RANGE.rule,
          severity: VerilogAErrorCode.INVALID_PARAMETER_RANGE.severity,
          message: VerilogAErrorCode.INVALID_PARAMETER_RANGE.message(param.name, String(param.defaultValue), rangeStr),
          range: param.sourceRange,
        });
      }
    }
  }

  // Analog block inspection
  if (!mod.analogBlock) {
    if (mod.ports.length >= 2) {
      const p0 = mod.ports[0];
      const p1 = mod.ports[1];
      if (p0 && p1) {
        diagnostics.push({
          code: VerilogAErrorCode.UNASSIGNED_ANALOG_BRANCH.code,
          rule: VerilogAErrorCode.UNASSIGNED_ANALOG_BRANCH.rule,
          severity: VerilogAErrorCode.UNASSIGNED_ANALOG_BRANCH.severity,
          message: VerilogAErrorCode.UNASSIGNED_ANALOG_BRANCH.message(p0.name, p1.name),
          range: mod.sourceRange,
        });
      }
    }
    return;
  }

  const referencedNodes = new Set<string>();
  const activeBranchPairs = new Set<string>();

  checkAnalogStatements(mod.analogBlock.statements, knownNodes, referencedNodes, activeBranchPairs, false, diagnostics);

  // M7609: Floating internal nodes
  for (const inode of mod.internalNodes) {
    if (!referencedNodes.has(inode)) {
      diagnostics.push({
        code: VerilogAErrorCode.FLOATING_INTERNAL_NODE.code,
        rule: VerilogAErrorCode.FLOATING_INTERNAL_NODE.rule,
        severity: VerilogAErrorCode.FLOATING_INTERNAL_NODE.severity,
        message: VerilogAErrorCode.FLOATING_INTERNAL_NODE.message(inode),
        range: mod.sourceRange,
      });
    }
  }

  // M7601: Check if port pairs have contributions
  if (mod.ports.length >= 2) {
    let hasPortContribution = false;
    for (let i = 0; i < mod.ports.length; i++) {
      for (let j = i + 1; j < mod.ports.length; j++) {
        const portI = mod.ports[i];
        const portJ = mod.ports[j];
        if (!portI || !portJ) continue;
        const p1 = portI.name;
        const p2 = portJ.name;
        if (
          activeBranchPairs.has(`${p1}:${p2}`) ||
          activeBranchPairs.has(`${p2}:${p1}`) ||
          activeBranchPairs.has(`${p1}:undefined`) ||
          activeBranchPairs.has(`${p2}:undefined`)
        ) {
          hasPortContribution = true;
          break;
        }
      }
      if (hasPortContribution) break;
    }

    if (!hasPortContribution && activeBranchPairs.size === 0) {
      const p0 = mod.ports[0];
      const p1 = mod.ports[1];
      if (p0 && p1) {
        diagnostics.push({
          code: VerilogAErrorCode.UNASSIGNED_ANALOG_BRANCH.code,
          rule: VerilogAErrorCode.UNASSIGNED_ANALOG_BRANCH.rule,
          severity: VerilogAErrorCode.UNASSIGNED_ANALOG_BRANCH.severity,
          message: VerilogAErrorCode.UNASSIGNED_ANALOG_BRANCH.message(p0.name, p1.name),
          range: mod.analogBlock.sourceRange,
        });
      }
    }
  }
}

function checkAnalogStatements(
  stmts: VerilogAStatement[],
  knownNodes: Set<string>,
  referencedNodes: Set<string>,
  activeBranchPairs: Set<string>,
  inConditional: boolean,
  diagnostics: VerilogADiagnostic[],
): void {
  for (const stmt of stmts) {
    if (stmt.kind === "block") {
      checkAnalogStatements(
        stmt.statements,
        knownNodes,
        referencedNodes,
        activeBranchPairs,
        inConditional,
        diagnostics,
      );
      continue;
    }

    if (stmt.kind === "if") {
      checkExpression(stmt.condition, knownNodes, referencedNodes, inConditional, diagnostics);
      checkAnalogStatements(stmt.thenBranch, knownNodes, referencedNodes, activeBranchPairs, true, diagnostics);
      if (stmt.elseBranch) {
        checkAnalogStatements(stmt.elseBranch, knownNodes, referencedNodes, activeBranchPairs, true, diagnostics);
      }
      continue;
    }

    if (stmt.kind === "assignment") {
      checkExpression(stmt.rhs, knownNodes, referencedNodes, inConditional, diagnostics);
      continue;
    }

    if (stmt.kind === "contribution") {
      const lhs = stmt.lhs;
      referencedNodes.add(lhs.node1);
      if (lhs.node2) referencedNodes.add(lhs.node2);

      const pairKey = `${lhs.node1}:${lhs.node2}`;
      activeBranchPairs.add(pairKey);

      // Check node validity
      if (!knownNodes.has(lhs.node1)) {
        diagnostics.push({
          code: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.code,
          rule: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.rule,
          severity: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.severity,
          message: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.message(
            lhs.node1,
            `${lhs.nature}(${lhs.node1}${lhs.node2 ? `, ${lhs.node2}` : ""})`,
          ),
          range: lhs.sourceRange,
        });
      }
      if (lhs.node2 && !knownNodes.has(lhs.node2)) {
        diagnostics.push({
          code: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.code,
          rule: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.rule,
          severity: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.severity,
          message: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.message(
            lhs.node2,
            `${lhs.nature}(${lhs.node1}, ${lhs.node2})`,
          ),
          range: lhs.sourceRange,
        });
      }

      // M7608: Zero-resistance potential short-circuit
      if (lhs.nature === "V" && stmt.rhs.kind === "number" && stmt.rhs.value === 0 && lhs.node2 !== undefined) {
        diagnostics.push({
          code: VerilogAErrorCode.ZERO_RESISTANCE_BRANCH.code,
          rule: VerilogAErrorCode.ZERO_RESISTANCE_BRANCH.rule,
          severity: VerilogAErrorCode.ZERO_RESISTANCE_BRANCH.severity,
          message: VerilogAErrorCode.ZERO_RESISTANCE_BRANCH.message(`V(${lhs.node1}, ${lhs.node2}) <+ 0.0`),
          range: stmt.sourceRange,
        });
      }

      checkExpression(stmt.rhs, knownNodes, referencedNodes, inConditional, diagnostics);
    }
  }
}

function checkExpression(
  expr: VerilogAExpr,
  knownNodes: Set<string>,
  referencedNodes: Set<string>,
  inConditional: boolean,
  diagnostics: VerilogADiagnostic[],
): void {
  if (expr.kind === "branch_access") {
    referencedNodes.add(expr.node1);
    if (expr.node2) referencedNodes.add(expr.node2);

    if (!knownNodes.has(expr.node1)) {
      diagnostics.push({
        code: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.code,
        rule: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.rule,
        severity: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.severity,
        message: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.message(
          expr.node1,
          `${expr.nature}(${expr.node1}${expr.node2 ? `, ${expr.node2}` : ""})`,
        ),
        range: expr.sourceRange,
      });
    }
    if (expr.node2 && !knownNodes.has(expr.node2)) {
      diagnostics.push({
        code: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.code,
        rule: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.rule,
        severity: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.severity,
        message: VerilogAErrorCode.UNDEFINED_NODE_REFERENCE.message(
          expr.node2,
          `${expr.nature}(${expr.node1}, ${expr.node2})`,
        ),
        range: expr.sourceRange,
      });
    }
    return;
  }

  if (expr.kind === "binary") {
    checkExpression(expr.left, knownNodes, referencedNodes, inConditional, diagnostics);
    checkExpression(expr.right, knownNodes, referencedNodes, inConditional, diagnostics);
    return;
  }

  if (expr.kind === "unary") {
    checkExpression(expr.argument, knownNodes, referencedNodes, inConditional, diagnostics);
    return;
  }

  if (expr.kind === "call") {
    // M7604: exp() instead of limexp()
    if (expr.func === "exp") {
      diagnostics.push({
        code: VerilogAErrorCode.UNBOUNDED_EXPONENTIAL_GROWTH.code,
        rule: VerilogAErrorCode.UNBOUNDED_EXPONENTIAL_GROWTH.rule,
        severity: VerilogAErrorCode.UNBOUNDED_EXPONENTIAL_GROWTH.severity,
        message: VerilogAErrorCode.UNBOUNDED_EXPONENTIAL_GROWTH.message(expr.func),
        range: expr.sourceRange,
        quickFix: {
          title: "Replace 'exp()' with numerically stable 'limexp()'",
          newText: "limexp",
          range: expr.sourceRange,
        },
      });
    }

    // M7602: ddt() in conditional
    if (expr.func === "ddt" && inConditional) {
      diagnostics.push({
        code: VerilogAErrorCode.DISCONTINUOUS_DERIVATIVE_EXPRESSION.code,
        rule: VerilogAErrorCode.DISCONTINUOUS_DERIVATIVE_EXPRESSION.rule,
        severity: VerilogAErrorCode.DISCONTINUOUS_DERIVATIVE_EXPRESSION.severity,
        message: VerilogAErrorCode.DISCONTINUOUS_DERIVATIVE_EXPRESSION.message(expr.func),
        range: expr.sourceRange,
      });
    }

    for (const arg of expr.args) {
      checkExpression(arg, knownNodes, referencedNodes, inConditional, diagnostics);
    }
  }
}
