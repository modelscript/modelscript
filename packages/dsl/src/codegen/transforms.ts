import { LanguageOptions } from "../dsl/language.js";

export function generateTransforms(grammarDef: LanguageOptions<any>): string {
  const transformsDef = (grammarDef as any).transforms;
  const hasInterval = !!(transformsDef && transformsDef.interval);
  const hasTangent = !!(transformsDef && transformsDef.tangent);
  const hasAdjoint = !!(transformsDef && transformsDef.adjoint);

  let out = "";
  if (!hasTangent) {
    out += `export function transform_tangent(astRoot: u32, ctxVar: u32 = 0): u32 { return 0; }\n`;
  }
  if (!hasAdjoint) {
    out += `export function transform_adjoint(astRoot: u32, dY: u32): void {}\n`;
  }

  out +=
    `
// --- Auto-Generated AST Structural Transformations ---
export function allocConstantNode(val: f64): u32 {
    let ptr = allocNode(0 /* SyntaxType.CONSTANT */, 0, 0, 0);
    store<f64>(ptr + 8, val);
    return ptr;
}

export function getProperty(nodeId: u32, propName: string): u32 {
    let propHash: u32 = 5381;
    for (let i = 0; i < propName.length; i++) {
        propHash = ((propHash << 5) + propHash) + propName.charCodeAt(i);
    }
    return 0;
}
` +
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

  const createPlaceholder = (name: string | symbol) => {
    return {
      __isPlaceholder: true,
      name: name,
      toString: () => `$$${String(name)}$$`,
    };
  };

  const handler = {
    get(target: any, prop: string | symbol) {
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
      out += `export function transform_${pipelineName}(astRoot: u32, dY: u32): void {\n`;
      out += `    if (astRoot == 0) return;\n`;
      out += `    let type = getNodeType(astRoot);\n`;
      out += `    switch(type) {\n`;

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

      for (const [patternStr, templateMap] of Object.entries(rules)) {
        const match = patternStr.match(/^(\w+)\((.*)\)$/);
        if (match) {
          const opName = match[1];
          const args = match[2].split(",").map((s: string) => s.trim().replace(/\$\$/g, ""));
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
      out += `export function transform_${pipelineName}(astRoot: u32, ctxVar: u32 = 0): u32 {\n`;
      out += `    if (astRoot == 0) return 0;\n`;
      out += `    let type = getNodeType(astRoot);\n`;
      out += `    let child = getNodeFirstChild(astRoot);\n`;
      out += `    while(child != 0) {\n`;
      out += `        transform_${pipelineName}(child, ctxVar);\n`;
      out += `        child = getNodeNextSibling(child);\n`;
      out += `    }\n`;
      out += `    switch(type) {\n`;

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

      for (const [patternStr, template] of Object.entries(rules)) {
        const match = patternStr.match(/^(\w+)\((.*)\)$/);
        if (match) {
          const opName = match[1];
          const args = match[2].split(",").map((s: string) => s.trim().replace(/\$\$/g, ""));
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
