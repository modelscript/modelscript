// SPDX-License-Identifier: AGPL-3.0-or-later

import { LanguageOptions } from "../../dsl/language.js";
import { transformsBaseCode } from "../../src-gen/runtime-templates.js";

/**
 * Generates AssemblyScript source code for AST transformation pipelines defined on a language
 * grammar (such as forward-mode `tangent` symbolic differentiation, reverse-mode `adjoint`
 * automatic differentiation, and `interval` arithmetic bound propagation).
 *
 * Uses a two-level JavaScript `Proxy` (`placeholders`) to execute declarative user transform
 * callbacks at compile time, capturing pattern-matching rules and property projections
 * (e.g. `a.val`, `a.lo`, `a.hi`) as symbolic AST templates that are lowered into linear-memory
 * `allocNode` arena constructors.
 *
 * @param grammarDef Language grammar definition containing optional `transforms` pipelines.
 * @returns Generated AssemblyScript source code implementing `transform_<pipeline>` functions.
 */
export function generateTransforms(grammarDef: LanguageOptions<any>): string {
  // Inspect which built-in numerical/symbolic transform pipelines are declared on the grammar.
  const transformsDef = (grammarDef as any).transforms;
  const hasInterval = !!(transformsDef && transformsDef.interval);
  const hasTangent = !!(transformsDef && transformsDef.tangent);
  const hasAdjoint = !!(transformsDef && transformsDef.adjoint);

  // Emit no-op fallback stubs when tangent or adjoint differentiation pipelines are omitted.
  let out = "";
  if (!hasTangent) {
    out += `export function transform_tangent(astRoot: u32, ctxVar: u32 = 0): u32 { return 0; }\n`;
  }
  if (!hasAdjoint) {
    out += `export function transform_adjoint(astRoot: u32, dY: u32): void {}\n`;
  }

  // Emit base helper functions and the interval bounds entry point (`evaluateIntervalBounds`),
  // which unpacks the lower (`loChild`) and upper (`hiChild`) literal bounds from an INTERVAL node.
  out +=
    transformsBaseCode +
    "\n" +
    (hasInterval
      ? `
export let evalResultLo: f64 = 0.0;
export let evalResultHi: f64 = 0.0;

export function evaluateIntervalBounds(nodeId: u32): void {
    let intervalNode = transform_interval(nodeId, 0);
    if (intervalNode == 0 || intervalNode == nodeId) {
        evalResultLo = 0.0;
        evalResultHi = 0.0;
        return;
    }
    let loChild = getNodeFirstChild(intervalNode);
    let hiChild = getNodeNextSibling(loChild);
    evalResultLo = loChild != 0 ? getLiteralValue(loChild) : 0.0;
    evalResultHi = hiChild != 0 ? getLiteralValue(hiChild) : 0.0;
}
`
      : `
export let evalResultLo: f64 = 0.0;
export let evalResultHi: f64 = 0.0;

export function evaluateIntervalBounds(nodeId: u32): void {
    evalResultLo = 0.0;
    evalResultHi = 0.0;
}
`);

  // Construct symbolic placeholder descriptors that serialize to `$$<name>$$` when interpolated
  // into pattern strings (e.g. `add(${a}, ${b})` -> `"add($$a$$, $$b$$)"`).
  const createPlaceholder = (name: string | symbol) => {
    return {
      __isPlaceholder: true,
      name: name,
      toString: () => `$$${String(name)}$$`,
    };
  };

  // Two-level Proxy handler:
  // - Level 1 (`placeholders.a`) creates a root operand placeholder `a`.
  // - Level 2 (`placeholders.a.lo`, `placeholders.a.hi`, `placeholders.a.val`) captures sub-property
  //   projections (`"a.lo"`, `"a.hi"`, `"a.val"`) used by interval arithmetic and tangent rules.
  const handler = {
    get(_target: any, prop: string | symbol) {
      if (prop === "__isPlaceholder") return false;
      if (typeof prop === "symbol") return undefined;
      const base = createPlaceholder(prop);
      return new Proxy(base, {
        get(t: any, subProp: string | symbol) {
          if (subProp === "__isPlaceholder") return true;
          if (subProp === "name") return t.name;
          if (subProp === "toString") return t.toString;
          if (typeof subProp === "symbol") return undefined;
          return createPlaceholder(`${String(t.name)}.${String(subProp)}`);
        },
      });
    },
  };

  const placeholders = new Proxy({}, handler);

  // Iterate over each declared transformation pipeline and invoke its factory with `placeholders`
  // to capture the declarative pattern -> replacement template dictionary.
  for (const [pipelineName, pipelineFunc] of Object.entries(transformsDef || {})) {
    out += `\n// Pipeline: ${pipelineName}\n`;
    let rules: any;
    try {
      rules = (pipelineFunc as any)(placeholders);
    } catch (e) {
      out += `// Error evaluating pipeline ${pipelineName}: ${e}\n`;
      continue;
    }

    if (pipelineName === "adjoint") {
      // Reverse-mode automatic differentiation (`adjoint`): propagates upstream sensitivity seed `dY`
      // top-down from parent node to each child operand's sensitivity accumulator (`dY_<child>`).
      out += `export function transform_${pipelineName}(astRoot: u32, dY: u32): void {\n`;
      out += `    if (astRoot == 0) return;\n`;
      out += `    let type = getNodeType(astRoot);\n`;
      out += `    switch(type) {\n`;

      // Recursively lowers a captured adjoint contribution template into AssemblyScript arena allocations.
      const emitTemplateAdjoint = (tmpl: any): string => {
        if (tmpl == null) return "0";
        if (typeof tmpl === "number") return `allocConstantNode(${tmpl})`;
        if (tmpl === "dY") return `dY`;
        if (tmpl.__isPlaceholder) {
          const varName = String(tmpl.name).replace(/\$\$/g, "").split(".")[0];
          return `${varName}_ptr`;
        }
        if (tmpl.op && tmpl.args) {
          let argsEmit = tmpl.args.map((a: any) => emitTemplateAdjoint(a));
          while (argsEmit.length < 3) argsEmit.push("0");
          return `allocNode(<u16>SyntaxType.${tmpl.op.toUpperCase()}, ${argsEmit[0]}, ${argsEmit[1]}, ${argsEmit[2]})`;
        }
        return "0";
      };

      // Parse each pattern key (e.g. `"mul($$a$$, $$b$$)"`) to bind positional child pointers (`a_ptr`, `b_ptr`)
      // and emit partial derivative sensitivity expressions for each child operand.
      for (const [patternStr, templateMap] of Object.entries(rules)) {
        const match = patternStr.match(/^(\w+)\((.*)\)$/);
        if (match) {
          const opName = match[1]!;
          const args = match[2]!.split(",").map((s: string) => s.trim().replace(/\$\$/g, ""));
          out += `        case <u16>SyntaxType.${opName.toUpperCase()}: {\n`;
          let currChild = `getNodeFirstChild(astRoot)`;
          for (const arg of args) {
            if (arg) {
              out += `            let ${arg}_ptr = ${currChild};\n`;
              currChild = `getNodeNextSibling(${arg}_ptr)`;
            }
          }
          for (const [childName, contrib] of Object.entries(templateMap as any)) {
            const childAdjointVar = `dY_${childName.replace(/\\$\\$/g, "")}`;
            out += `            let ${childAdjointVar} = ${emitTemplateAdjoint(contrib)};\n`;
          }
          out += `            break;\n`;
          out += `        }\n`;
        }
      }
      out += `        default: break;\n`;
      out += `    }\n`;
      out += `}\n`;
    } else {
      // Forward-mode (`tangent`, `interval`, or custom bottom-up rewrite): recursively transforms
      // child subtrees and synthesizes a new arena node (or `SyntaxType.INTERVAL` pair) for `astRoot`.
      out += `export function transform_${pipelineName}(astRoot: u32, ctxVar: u32 = 0): u32 {\n`;
      out += `    if (astRoot == 0) return 0;\n`;
      out += `    let type = getNodeType(astRoot);\n`;
      out += `    let child = getNodeFirstChild(astRoot);\n`;
      out += `    while(child != 0) {\n`;
      out += `        transform_${pipelineName}(child, ctxVar);\n`;
      out += `        child = getNodeNextSibling(child);\n`;
      out += `    }\n`;
      out += `    switch(type) {\n`;

      // Lowers a captured forward/interval template object into AssemblyScript expressions:
      // - `.val` -> recursive `transform_<pipeline>(<var>_ptr, ctxVar)`
      // - `.lo` / `.hi` -> first/second child of the transformed interval node
      // - `{ lo, hi }` -> `allocNode(SyntaxType.INTERVAL, loEmit, hiEmit, 0)`
      const emitTemplate = (tmpl: any): string => {
        if (tmpl == null) return "0";
        if (typeof tmpl === "number") {
          return `allocConstantNode(${tmpl})`;
        }
        if (tmpl.__isPlaceholder) {
          const parts = String(tmpl.name).replace(/\$\$/g, "").split(".");
          const varName = parts[0];
          const prop = parts[1];
          if (prop) {
            if (prop === "val") {
              return `transform_${pipelineName}(${varName}_ptr, ctxVar)`;
            } else if (prop === "lo") {
              return `getNodeFirstChild(transform_${pipelineName}(${varName}_ptr, ctxVar))`;
            } else if (prop === "hi") {
              return `getNodeNextSibling(getNodeFirstChild(transform_${pipelineName}(${varName}_ptr, ctxVar)))`;
            } else {
              return `getProperty(transform_${pipelineName}(${varName}_ptr, ctxVar), "${prop}")`;
            }
          } else {
            if (varName === "target") return `ctxVar`;
            return `${varName}_ptr`;
          }
        }
        if (tmpl.op && tmpl.args) {
          let argsEmit = tmpl.args.map((a: any) => emitTemplate(a));
          while (argsEmit.length < 3) argsEmit.push("0");
          return `allocNode(<u16>SyntaxType.${tmpl.op.toUpperCase()}, ${argsEmit[0]}, ${argsEmit[1]}, ${argsEmit[2]})`;
        }
        if (typeof tmpl === "object" && !Array.isArray(tmpl)) {
          if ("lo" in tmpl && "hi" in tmpl) {
            let loEmit = emitTemplate(tmpl.lo);
            let hiEmit = emitTemplate(tmpl.hi);
            return `allocNode(<u16>SyntaxType.INTERVAL, ${loEmit}, ${hiEmit}, 0)`;
          }
        }
        return "0";
      };

      // Emit a `SyntaxType` switch case for each pattern rule, unpacking sibling pointers (`<arg>_ptr`).
      for (const [patternStr, template] of Object.entries(rules)) {
        const match = patternStr.match(/^(\w+)\((.*)\)$/);
        if (match) {
          const opName = match[1]!;
          const args = match[2]!.split(",").map((s: string) => s.trim().replace(/\$\$/g, ""));
          out += `        case <u16>SyntaxType.${opName.toUpperCase()}: {\n`;
          let currChild = `getNodeFirstChild(astRoot)`;
          for (const arg of args) {
            if (arg) {
              out += `            let ${arg}_ptr = ${currChild};\n`;
              currChild = `getNodeNextSibling(${arg}_ptr)`;
            }
          }
          const resultExpr = emitTemplate(template);
          out += `            return ${resultExpr};\n`;
          out += `        }\n`;
        }
      }

      out += `        default: return astRoot;\n`;
      out += `    }\n`;
      out += `}\n`;
    }
  }

  return out;
}
