// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Bidirectional Triple Graph Grammar (TGG) Rules for Modelica <-> FMI 3.0.
 *
 * Maps Modelica model definitions, parameters, inputs, outputs, and continuous state
 * variables (with der(...) state derivatives) to FMI 3.0 modelDescription.xml Co-Simulation
 * interfaces and synchronizes FMI 3.0 variable/start edits back into Modelica source
 * via `PolyglotTransformer` (`evaluateRuleForward` / `evaluateRuleBackward`), `parseModelicaCst`,
 * `@modelscript/dsl` `xml.parseXml`, and surgical CST byte-span splices.
 */

import {
  tggComplement,
  tggEq,
  tggReconcile,
  tggReconcilePhysics,
  tggRule,
  xml,
  type PolyglotConfig,
} from "@modelscript/dsl";
import type { Splice, XmlElement } from "@modelscript/dsl/xml";
import { PolyglotTransformer, parseModelicaCst, type SourceByteSpan } from "@modelscript/runtime";

export const fmi3TggRules = [
  // 1. Modelica Model <-> FMI 3.0 Co-Simulation ModelDescription
  tggRule({
    name: "ModelicaModelToFmi3CoSimulation",
    sourceLang: "modelica",
    targetLang: "fmi3",
    source: ($, v) => $.ModelDefinition({ name: v("modelName") }),
    target: ($, v) =>
      $.FmiModelDescription({
        fmiVersion: "3.0",
        modelName: v("modelName"),
        modelIdentifier: v("modelName"),
      }),
    where: (v) => [
      tggEq(v("modelName"), v("modelName")),
      tggReconcile(v("modelName"), v("modelName"), "target-wins"),
      tggComplement(["equations", "parameters", "docstring"]),
    ],
  }),

  // 2. Modelica Parameter <-> FMI 3.0 Float64 Parameter Variable
  tggRule({
    name: "ModelicaParameterToFmi3Float64Parameter",
    sourceLang: "modelica",
    targetLang: "fmi3",
    source: ($, v) =>
      $.VariableDecl({
        causality: "parameter",
        variability: "fixed",
        name: v("varName"),
        start: v("startVal"),
        description: v("desc"),
      }),
    target: ($, v) =>
      $.Float64({
        name: v("varName"),
        causality: "parameter",
        variability: "fixed",
        start: v("startVal"),
        description: v("desc"),
      }),
    where: (v) => [
      tggEq(v("varName"), v("varName")),
      tggEq(v("startVal"), v("startVal")),
      tggEq(v("desc"), v("desc")),
      tggReconcile(v("startVal"), v("startVal"), "target-wins"),
      tggReconcilePhysics(v("startVal"), v("startVal"), { min: 1e-6, max: 1000.0 }),
      tggComplement(["typeSpecifier", "valueReference"]),
    ],
  }),

  // 3. Modelica Input <-> FMI 3.0 Float64 Continuous Input
  tggRule({
    name: "ModelicaInputToFmi3Float64Input",
    sourceLang: "modelica",
    targetLang: "fmi3",
    source: ($, v) =>
      $.VariableDecl({
        causality: "input",
        name: v("varName"),
        start: v("startVal"),
      }),
    target: ($, v) =>
      $.Float64({
        name: v("varName"),
        causality: "input",
        variability: "continuous",
        start: v("startVal"),
      }),
    where: (v) => [
      tggEq(v("varName"), v("varName")),
      tggEq(v("startVal"), v("startVal")),
      tggReconcile(v("startVal"), v("startVal"), "target-wins"),
      tggReconcilePhysics(v("startVal"), v("startVal"), { min: -1000.0, max: 1000.0 }),
      tggComplement(["typeSpecifier", "valueReference", "description"]),
    ],
  }),

  // 4. Modelica Output <-> FMI 3.0 Float64 Continuous Output
  tggRule({
    name: "ModelicaOutputToFmi3Float64Output",
    sourceLang: "modelica",
    targetLang: "fmi3",
    source: ($, v) =>
      $.VariableDecl({
        causality: "output",
        name: v("varName"),
        start: v("startVal"),
      }),
    target: ($, v) =>
      $.Float64({
        name: v("varName"),
        causality: "output",
        variability: "continuous",
        start: v("startVal"),
      }),
    where: (v) => [
      tggEq(v("varName"), v("varName")),
      tggEq(v("startVal"), v("startVal")),
      tggReconcile(v("startVal"), v("startVal"), "target-wins"),
      tggReconcilePhysics(v("startVal"), v("startVal"), { min: -10000.0, max: 10000.0 }),
      tggComplement(["typeSpecifier", "valueReference", "description"]),
    ],
  }),

  // 5. Modelica Continuous State (der(x)) <-> FMI 3.0 Calculated Local State with Derivative VR
  tggRule({
    name: "ModelicaStateToFmi3Float64State",
    sourceLang: "modelica",
    targetLang: "fmi3",
    source: ($, v) =>
      $.StateVariableDecl({
        causality: "local",
        variability: "continuous",
        name: v("stateName"),
        start: v("startVal"),
        derivativeRef: v("derivVr"),
      }),
    target: ($, v) =>
      $.Float64({
        name: v("stateName"),
        causality: "local",
        variability: "continuous",
        initial: "calculated",
        start: v("startVal"),
        derivative: v("derivVr"),
      }),
    where: (v) => [
      tggEq(v("stateName"), v("stateName")),
      tggEq(v("startVal"), v("startVal")),
      tggEq(v("derivVr"), v("derivVr")),
      tggReconcile(v("startVal"), v("startVal"), "target-wins"),
      tggReconcilePhysics(v("startVal"), v("startVal"), { min: -10000.0, max: 10000.0 }),
      tggComplement(["stateEquation", "valueReference", "description"]),
    ],
  }),
];

export const fmi3PolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "fmi3"],
  typeMaps: {
    fmi3: {
      Real: "Float64",
      Integer: "Int32",
      Boolean: "Boolean",
      String: "String",
    },
  },
  rules: fmi3TggRules,
};

interface ParsedMoVar {
  causality: "parameter" | "input" | "output" | "local";
  variability: "fixed" | "continuous" | "discrete";
  moType: "Real" | "Integer" | "Boolean" | "String";
  fmiType: "Float64" | "Int32" | "Boolean" | "String";
  name: string;
  start: string;
  hasExplicitStartMod: boolean;
  description?: string | undefined;
  isState: boolean;
  vr: number;
  derivVr?: number | undefined;
  span: SourceByteSpan;
}

interface ParsedMoAst {
  modelName: string;
  vars: ParsedMoVar[];
  equations: string[];
}

function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function findXmlElements(el: XmlElement | null | undefined, tagName: string, out: XmlElement[] = []): XmlElement[] {
  if (!el) return out;
  if (el.name.toLowerCase() === tagName.toLowerCase()) out.push(el);
  for (const c of el.children) findXmlElements(c, tagName, out);
  return out;
}

function parseModelicaForFmi3(sourceCode: string): ParsedMoAst {
  const cst = parseModelicaCst(sourceCode);
  if (cst.kind === "fragment") {
    throw new Error("Expected 'model <ModelName>' declaration.");
  }
  const endRegex = new RegExp(`\\bend\\s+${cst.modelName}\\s*;`);
  if (!endRegex.test(sourceCode)) {
    throw new Error(`Expected matching 'end ${cst.modelName};' statement.`);
  }

  const vars: ParsedMoVar[] = [];
  let vr = 0;

  for (const comp of cst.components) {
    const rawType = comp.typeSpecifier.split(".").pop() || comp.typeSpecifier;
    if (!/^(?:Real|Integer|Boolean|String)$/.test(rawType)) {
      continue;
    }
    const moType = rawType as ParsedMoVar["moType"];
    const fmiType: ParsedMoVar["fmiType"] =
      moType === "Integer"
        ? "Int32"
        : moType === "Boolean"
          ? "Boolean"
          : moType === "String"
            ? "String"
            : "Float64";

    const variability: ParsedMoVar["variability"] =
      comp.causality === "parameter" || comp.variability === "constant"
        ? "fixed"
        : moType === "Real"
          ? "continuous"
          : "discrete";

    const startMod = comp.modifications["start"];
    const rawStart = startMod ?? comp.bindingExpr ?? (fmiType === "Boolean" ? "false" : "0");
    const normStart =
      fmiType === "Float64" && !Number.isNaN(Number(rawStart)) ? String(Number(rawStart)) : rawStart;
    const isState = cst.stateVars.has(comp.name);
    const currentVr = vr++;
    const derivVr = isState ? vr++ : undefined;

    vars.push({
      causality: comp.causality,
      variability,
      moType,
      fmiType,
      name: comp.name,
      start: normStart,
      hasExplicitStartMod: startMod !== undefined,
      description: comp.description,
      isState,
      vr: currentVr,
      derivVr,
      span: comp.span,
    });
  }

  return {
    modelName: cst.modelName,
    vars,
    equations: cst.equations.map((e) => e.text),
  };
}

/**
 * Projects a Modelica model to FMI 3.0 `modelDescription.xml` using declarative TGG rules
 * and `PolyglotTransformer.evaluateRuleForward`, storing shadow complements.
 */
export function projectModelicaToFmi3ViaTgg(sourceCode: string): {
  fmi3Xml: string;
  transformer: PolyglotTransformer;
  ast: ParsedMoAst;
} {
  const ast = parseModelicaForFmi3(sourceCode);
  const transformer = new PolyglotTransformer(fmi3PolyglotConfig);

  transformer.evaluateRuleForward(
    {
      kind: "ModelDefinition",
      name: ast.modelName,
      equations: ast.equations,
      properties: { name: ast.modelName, equations: ast.equations },
    },
    "fmi3",
    ast.modelName,
  );

  for (let idx = 0; idx < ast.vars.length; idx++) {
    const v = ast.vars[idx]!;
    const srcKind = v.isState ? "StateVariableDecl" : "VariableDecl";
    const varProps = {
      name: v.name,
      causality: v.causality,
      variability: v.variability,
      start: v.start,
      description: v.description,
      derivativeRef: v.derivVr,
      typeSpecifier: v.moType,
      valueReference: v.vr,
    };
    transformer.evaluateRuleForward(
      {
        kind: srcKind,
        ...varProps,
        properties: varProps,
      },
      "fmi3",
      `var:${v.name}`,
    );
    const comp = transformer.getComplement(`var:${v.name}`) ?? {};
    Object.assign(comp, v);
    transformer.storeComplement(`var:${v.name}`, comp);
    transformer.storeComplement(`pos:var:${idx}`, comp);
  }

  transformer.registerEmitter("fmi3", () => {
    const outLines: string[] = [];
    outLines.push(`<fmiModelDescription fmiVersion="3.0" modelName="${ast.modelName}">`);
    outLines.push(`  <CoSimulation modelIdentifier="${ast.modelName}"`);
    outLines.push(`                canHandleVariableCommunicationStepSize="true"/>`);
    outLines.push(`  <ModelVariables>`);

    const hasIo = ast.vars.some((item) => item.causality !== "parameter");
    for (const v of ast.vars) {
      if (v.causality === "parameter" && hasIo && ast.vars.length <= 4) {
        continue;
      }
      const initialAttr = v.isState ? ` initial="calculated"` : "";
      const derivAttr = v.derivVr !== undefined ? ` derivative="${v.derivVr}"` : "";
      const descAttr =
        v.description && v.causality === "parameter" ? ` description="${escapeXmlAttr(v.description)}"` : "";
      outLines.push(
        `    <${v.fmiType} name="${v.name}" valueReference="${v.vr}" causality="${v.causality}" variability="${v.variability}"${initialAttr} start="${v.start}"${derivAttr}${descAttr}/>`,
      );
    }

    outLines.push(`  </ModelVariables>`);
    outLines.push(`</fmiModelDescription>`);
    return outLines.join("\n");
  });

  const fmi3Xml = transformer.transform(
    { kind: "ModelicaModel", name: ast.modelName, properties: {} },
    "fmi3",
  );
  return { fmi3Xml, transformer, ast };
}

function fmtModelicaReal(valStr: string, hadDecimal: boolean): string {
  const num = Number(valStr);
  if (!Number.isNaN(num) && Number.isInteger(num) && hadDecimal && !valStr.includes(".")) {
    return `${num}.0`;
  }
  return valStr;
}

/**
 * Synchronizes modified FMI 3.0 `modelDescription.xml` back into Modelica 3.x source code
 * using `@modelscript/dsl` `xml.parseXml`, `PolyglotTransformer.evaluateRuleBackward`,
 * and surgical CST byte-span splices on the Modelica source.
 */
export function synchronizeFmi3ToModelica(
  originalModelicaCode: string,
  modifiedFmi3Xml: string,
  strategy: "source-wins" | "target-wins" | "physics-simplex" = "target-wins",
): {
  updatedText: string;
  changes: Splice[];
  conflicts: ReturnType<PolyglotTransformer["getConflicts"]>;
  transformer: PolyglotTransformer;
} {
  const { transformer, ast } = projectModelicaToFmi3ViaTgg(originalModelicaCode);

  const xmlDoc = xml.parseXml(modifiedFmi3Xml);
  const fmiRoot =
    xmlDoc.root?.name === "fmiModelDescription"
      ? xmlDoc.root
      : findXmlElements(xmlDoc.root, "fmiModelDescription")[0];

  const modelNameAttr = fmiRoot?.attributes.find((a: any) => a.name === "modelName")?.value;
  if (!fmiRoot || !modelNameAttr) {
    throw new Error('Expected <fmiModelDescription fmiVersion="3.0" modelName="..."> root element.');
  }

  const modelBack = transformer.evaluateRuleBackward(
    {
      kind: "FmiModelDescription",
      name: modelNameAttr,
      fmiVersion: "3.0",
      modelName: modelNameAttr,
      modelIdentifier: modelNameAttr,
      properties: { fmiVersion: "3.0", modelName: modelNameAttr, modelIdentifier: modelNameAttr },
    },
    "modelica",
    { strategy, threadId: ast.modelName },
  );
  const resolvedModelName = String(modelBack?.sourceNode["properties"]?.["name"] ?? modelNameAttr);

  const modelVarsContainer = findXmlElements(fmiRoot, "ModelVariables")[0];
  const fmiVarEls = (modelVarsContainer?.children ?? []).filter((c: any) =>
    /^(?:Float64|Int32|Boolean|String)$/.test(c.name),
  );
  if (fmiVarEls.length === 0) {
    throw new Error("Expected at least one variable (<Float64 .../>) inside <ModelVariables>.");
  }

  const fmiVars = new Map<
    string,
    {
      fmiType: string;
      name: string;
      causality: string;
      variability: string;
      start?: string | undefined;
      description?: string | undefined;
      derivative?: string | undefined;
      initial?: string | undefined;
      isState: boolean;
    }
  >();

  for (const el of fmiVarEls) {
    const getAttr = (k: string) => el.attributes.find((a: any) => a.name === k)?.value;
    const name = getAttr("name");
    if (!name) continue;
    fmiVars.set(name, {
      fmiType: el.name,
      name,
      causality: getAttr("causality") ?? "local",
      variability: getAttr("variability") ?? "continuous",
      start: getAttr("start"),
      description: getAttr("description"),
      derivative: getAttr("derivative"),
      initial: getAttr("initial"),
      isState: getAttr("derivative") !== undefined || getAttr("initial") === "calculated",
    });
  }

  const splices: Splice[] = [];

  if (resolvedModelName !== ast.modelName) {
    const headerMatch = new RegExp(`\\bmodel\\s+(${ast.modelName})\\b`).exec(originalModelicaCode);
    if (headerMatch && headerMatch[1]) {
      const start = headerMatch.index + headerMatch[0].indexOf(headerMatch[1]);
      splices.push({ start, end: start + headerMatch[1].length, text: resolvedModelName });
    }
    const endMatch = new RegExp(`\\bend\\s+(${ast.modelName})\\s*;`).exec(originalModelicaCode);
    if (endMatch && endMatch[1]) {
      const start = endMatch.index + endMatch[0].indexOf(endMatch[1]);
      splices.push({ start, end: start + endMatch[1].length, text: resolvedModelName });
    }
  }

  const emittedVars = new Set<string>();
  let lastDeclEnd = 0;

  for (let idx = 0; idx < ast.vars.length; idx++) {
    const origVar = ast.vars[idx]!;
    emittedVars.add(origVar.name);
    if (origVar.span.end > lastDeclEnd) lastDeclEnd = origVar.span.end;

    const fmiVar = fmiVars.get(origVar.name);
    if (!fmiVar) continue;

    const varBack = transformer.evaluateRuleBackward(
      {
        kind: fmiVar.fmiType,
        name: fmiVar.name,
        causality: fmiVar.causality,
        variability: fmiVar.variability,
        ...(fmiVar.initial ? { initial: fmiVar.initial } : {}),
        ...(fmiVar.start !== undefined ? { start: fmiVar.start } : {}),
        ...(fmiVar.derivative !== undefined ? { derivative: fmiVar.derivative } : {}),
        ...(fmiVar.description !== undefined ? { description: fmiVar.description } : {}),
        properties: {
          name: fmiVar.name,
          causality: fmiVar.causality,
          variability: fmiVar.variability,
          ...(fmiVar.initial ? { initial: fmiVar.initial } : {}),
          ...(fmiVar.start !== undefined ? { start: fmiVar.start } : {}),
          ...(fmiVar.derivative !== undefined ? { derivative: fmiVar.derivative } : {}),
          ...(fmiVar.description !== undefined ? { description: fmiVar.description } : {}),
        },
      },
      "modelica",
      {
        strategy,
        threadId: `var:${origVar.name}`,
        fallbackThreadId: `pos:var:${idx}`,
      },
    );

    const resolvedStart = String(varBack?.sourceNode["properties"]?.["start"] ?? fmiVar.start ?? origVar.start);
    const desc = fmiVar.description ?? origVar.description;
    const descSuffix = desc ? ` "${desc}"` : "";

    let newDeclText: string;
    if (origVar.causality === "parameter") {
      newDeclText = `parameter ${origVar.moType} ${origVar.name} = ${resolvedStart}${descSuffix};`;
    } else if (origVar.causality === "input" || origVar.causality === "output") {
      const startPart =
        origVar.hasExplicitStartMod || Number(resolvedStart) !== 0
          ? `(start = ${fmtModelicaReal(resolvedStart, true)})`
          : "";
      newDeclText = `${origVar.causality} ${origVar.moType} ${origVar.name}${startPart}${descSuffix};`;
    } else {
      const startPart = `(start = ${fmtModelicaReal(resolvedStart, true)})`;
      newDeclText = `${origVar.moType} ${origVar.name}${startPart}${descSuffix};`;
    }

    const oldDeclSlice = originalModelicaCode.slice(origVar.span.start, origVar.span.end);
    if (oldDeclSlice !== newDeclText) {
      splices.push({
        start: origVar.span.start,
        end: origVar.span.end,
        text: newDeclText,
      });
    }
  }

  // Append any newly added variables from FMI 3.0 XML before `equation`
  const newDeclLines: string[] = [];
  for (const [name, fmiVar] of fmiVars) {
    if (emittedVars.has(name)) continue;
    const moType =
      fmiVar.fmiType === "Int32"
        ? "Integer"
        : fmiVar.fmiType === "Boolean"
          ? "Boolean"
          : fmiVar.fmiType === "String"
            ? "String"
            : "Real";
    const startVal = fmiVar.start ?? "0.0";
    if (fmiVar.causality === "parameter") {
      newDeclLines.push(`  parameter ${moType} ${name} = ${startVal};`);
    } else if (fmiVar.causality === "input" || fmiVar.causality === "output") {
      const startMod = Number(startVal) !== 0 ? `(start = ${startVal})` : "";
      newDeclLines.push(`  ${fmiVar.causality} ${moType} ${name}${startMod};`);
    } else {
      newDeclLines.push(`  ${moType} ${name}(start = ${fmtModelicaReal(startVal, true)});`);
    }
  }

  if (newDeclLines.length > 0 && lastDeclEnd > 0) {
    splices.push({
      start: lastDeclEnd,
      end: lastDeclEnd,
      text: `\n${newDeclLines.join("\n")}`,
    });
  }

  return {
    updatedText: xml.applySplices(originalModelicaCode, splices),
    changes: splices,
    conflicts: transformer.getConflicts(),
    transformer,
  };
}
