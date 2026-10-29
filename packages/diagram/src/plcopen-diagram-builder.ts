// SPDX-License-Identifier: AGPL-3.0-or-later

export interface PlcopenDiagramPort {
  id: string;
  name: string;
  x: number;
  y: number;
  direction: "in" | "out";
  domain: string;
}

export interface PlcopenDiagramNode {
  id: string;
  type: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  ports: PlcopenDiagramPort[];
  iconSvg: string | null;
  iconShapes: unknown[];
  iconCoordSystem: null;
  parameters?: Record<string, string> | undefined;
}

export interface PlcopenDiagramEdge {
  id: string;
  sourcePort: string;
  targetPort: string;
  points: { x: number; y: number }[];
  color: [number, number, number];
  thickness: number;
  pattern: string;
  signalName?: string | undefined;
}

export interface PlcopenDiagramData {
  nodes: PlcopenDiagramNode[];
  edges: PlcopenDiagramEdge[];
  coordinateSystem: null;
  diagramBackground: null;
}

/**
 * Structural interfaces matching `@modelscript/plcopen` `PlcProject` AST
 * so `@modelscript/diagram` remains zero-dependency and browser-safe.
 */
export interface PlcVariableLike {
  name: string;
  scope: "input" | "output" | "inOut" | "local" | "temp" | "global" | "external" | string;
  dataType: string;
  initialValue?: string | number | boolean | undefined;
  address?: string | undefined;
  isConstant?: boolean | undefined;
  isRetain?: boolean | undefined;
}

export interface PlcCallArgLike {
  name?: string | undefined;
  direction: "in" | "out" | string;
  expr: PlcExprLike;
}

export interface PlcExprLike {
  kind: "literal" | "identifier" | "binary" | "unary" | "member" | "index" | "call" | string;
  raw?: string | undefined;
  value?: number | boolean | string | undefined;
  name?: string | undefined;
  op?: string | undefined;
  left?: PlcExprLike | undefined;
  right?: PlcExprLike | undefined;
  argument?: PlcExprLike | undefined;
  object?: PlcExprLike | undefined;
  property?: string | undefined;
  callee?: string | undefined;
  args?: PlcCallArgLike[] | undefined;
}

export interface PlcIfBranchLike {
  condition: PlcExprLike;
  statements: PlcStatementLike[];
}

export interface PlcCaseBranchLike {
  values: (number | string)[];
  statements: PlcStatementLike[];
}

export interface PlcStatementLike {
  kind: "assignment" | "if" | "case" | "for" | "while" | "repeat" | "call" | "return" | "exit" | "empty" | string;
  target?: PlcExprLike | undefined;
  value?: PlcExprLike | undefined;
  condition?: PlcExprLike | undefined;
  thenStatements?: PlcStatementLike[] | undefined;
  elsifs?: PlcIfBranchLike[] | undefined;
  elseStatements?: PlcStatementLike[] | undefined;
  selector?: PlcExprLike | undefined;
  cases?: PlcCaseBranchLike[] | undefined;
  variable?: string | undefined;
  start?: PlcExprLike | undefined;
  end?: PlcExprLike | undefined;
  statements?: PlcStatementLike[] | undefined;
  callee?: string | undefined;
  args?: PlcCallArgLike[] | undefined;
}

export interface PlcPouLike {
  name: string;
  pouType: "program" | "functionBlock" | "function" | string;
  returnType?: string | undefined;
  variables: PlcVariableLike[];
  body: {
    kind: "ST" | "FBD" | "SFC" | "LD" | "IL" | string;
    st?:
      | {
          statements: PlcStatementLike[];
          rawSource?: string | undefined;
        }
      | undefined;
    raw?: string | undefined;
  };
}

export interface PlcTaskLike {
  name: string;
  priority: number;
  interval?: string | undefined;
  intervalMs?: number | undefined;
}

export interface PlcPouInstanceLike {
  name: string;
  typeName: string;
  taskName?: string | undefined;
}

export interface PlcResourceLike {
  name: string;
  tasks: PlcTaskLike[];
  instances: PlcPouInstanceLike[];
}

export interface PlcConfigurationLike {
  name: string;
  resources: PlcResourceLike[];
}

export interface PlcProjectLike {
  fileHeader?:
    | {
        companyName?: string | undefined;
        productName?: string | undefined;
      }
    | undefined;
  contentHeader?:
    | {
        name?: string | undefined;
      }
    | undefined;
  pous: PlcPouLike[];
  configurations?: PlcConfigurationLike[] | undefined;
}

export interface PlcopenFbdNetworkBlock {
  id: string;
  title: string;
  blockType: "logic" | "selector" | "functionBlock" | "loop";
  stereotype: string;
  inputs: string[];
  outputs: string[];
  expressions: string[];
}

export interface PlcopenDiagramResult {
  title: string;
  pouName: string;
  pouType: string;
  diagram: PlcopenDiagramData;
  fbdBlocks: PlcopenFbdNetworkBlock[];
  metadata: {
    pouCount: number;
    inputCount: number;
    outputCount: number;
    localCount: number;
    networkCount: number;
    taskCount: number;
  };
}

const IEC_TYPE_COLORS: Record<string, { stroke: string; fill: string; badge: string; rgb: [number, number, number] }> =
  {
    BOOL: { stroke: "#10b981", fill: "#062c22", badge: "#34d399", rgb: [16, 185, 129] },
    REAL: { stroke: "#38bdf8", fill: "#08283c", badge: "#7dd3fc", rgb: [56, 189, 248] },
    LREAL: { stroke: "#38bdf8", fill: "#08283c", badge: "#7dd3fc", rgb: [56, 189, 248] },
    INT: { stroke: "#f59e0b", fill: "#2e1f08", badge: "#fbbf24", rgb: [245, 158, 11] },
    DINT: { stroke: "#f59e0b", fill: "#2e1f08", badge: "#fbbf24", rgb: [245, 158, 11] },
    UINT: { stroke: "#f59e0b", fill: "#2e1f08", badge: "#fbbf24", rgb: [245, 158, 11] },
    TIME: { stroke: "#a855f7", fill: "#231238", badge: "#c084fc", rgb: [168, 85, 247] },
  };

function getIecTypeStyle(dataType: string) {
  const upper = dataType.toUpperCase();
  return (
    IEC_TYPE_COLORS[upper] ?? {
      stroke: "#60a5fa",
      fill: "#111e36",
      badge: "#93c5fd",
      rgb: [96, 165, 250] as [number, number, number],
    }
  );
}

/**
 * Formats a Structured Text AST expression into compact IEC 61131-3 notation.
 */
export function formatPlcExpr(expr: PlcExprLike | undefined): string {
  if (!expr) return "";
  switch (expr.kind) {
    case "literal":
      return expr.raw ?? String(expr.value ?? "");
    case "identifier":
      return expr.name ?? "";
    case "unary":
      return expr.op === "NOT"
        ? `NOT ${formatPlcExpr(expr.argument)}`
        : `${expr.op ?? ""}${formatPlcExpr(expr.argument)}`;
    case "binary":
      return `(${formatPlcExpr(expr.left)} ${expr.op ?? ""} ${formatPlcExpr(expr.right)})`;
    case "member":
      return `${formatPlcExpr(expr.object)}.${expr.property ?? ""}`;
    case "call": {
      const args = (expr.args ?? [])
        .map((a) => {
          const op = a.direction === "out" ? "=>" : ":=";
          return a.name ? `${a.name} ${op} ${formatPlcExpr(a.expr)}` : formatPlcExpr(a.expr);
        })
        .join(", ");
      return `${expr.callee ?? "FB"}(${args})`;
    }
    default:
      return "";
  }
}

/**
 * Collects all variable identifiers referenced inside an ST expression.
 */
export function extractPlcExprIdentifiers(expr: PlcExprLike | undefined, out: Set<string> = new Set()): Set<string> {
  if (!expr) return out;
  switch (expr.kind) {
    case "identifier":
      if (expr.name) out.add(expr.name);
      break;
    case "unary":
      extractPlcExprIdentifiers(expr.argument, out);
      break;
    case "binary":
      extractPlcExprIdentifiers(expr.left, out);
      extractPlcExprIdentifiers(expr.right, out);
      break;
    case "member":
      extractPlcExprIdentifiers(expr.object, out);
      break;
    case "call":
      for (const arg of expr.args ?? []) {
        if (arg.direction !== "out") {
          extractPlcExprIdentifiers(arg.expr, out);
        }
      }
      break;
  }
  return out;
}

function collectTopOperators(expr: PlcExprLike | undefined, ops: Set<string> = new Set()): Set<string> {
  if (!expr) return ops;
  if (expr.kind === "binary" && expr.op) {
    ops.add(expr.op.toUpperCase());
    collectTopOperators(expr.left, ops);
    collectTopOperators(expr.right, ops);
  } else if (expr.kind === "unary" && expr.op) {
    ops.add(expr.op.toUpperCase());
    collectTopOperators(expr.argument, ops);
  }
  return ops;
}

/**
 * Synthesizes IEC 61131-3 Function Block Diagram (FBD) network blocks from a POU's
 * Structured Text statements and local function-block instances.
 */
export function synthesizeFbdBlocksFromPou(pou: PlcPouLike): PlcopenFbdNetworkBlock[] {
  const blocks: PlcopenFbdNetworkBlock[] = [];
  const localFbTypes = new Map<string, string>();
  for (const v of pou.variables) {
    const dt = v.dataType.toUpperCase();
    if (
      ![
        "BOOL",
        "INT",
        "DINT",
        "UINT",
        "SINT",
        "USINT",
        "REAL",
        "LREAL",
        "TIME",
        "STRING",
        "WORD",
        "DWORD",
        "BYTE",
      ].includes(dt)
    ) {
      localFbTypes.set(v.name, v.dataType);
    }
  }

  const stmts = pou.body.st?.statements ?? [];
  let netIdx = 1;

  for (const stmt of stmts) {
    if (stmt.kind === "assignment" && stmt.target && stmt.value) {
      const targetName = formatPlcExpr(stmt.target);
      const inputs = Array.from(extractPlcExprIdentifiers(stmt.value));
      const ops = Array.from(collectTopOperators(stmt.value));
      const exprText = `${targetName} := ${formatPlcExpr(stmt.value)}`;
      const opBadge = ops.length > 0 ? ops.slice(0, 3).join(" · ") : "MOVE";
      blocks.push({
        id: `fbd_net_${netIdx}`,
        title: `NET ${netIdx}: ${targetName}`,
        blockType: "logic",
        stereotype: `«FBD ${opBadge}»`,
        inputs,
        outputs: targetName ? [targetName] : [],
        expressions: [exprText],
      });
      netIdx++;
    } else if (stmt.kind === "call" && stmt.callee) {
      const inputs: string[] = [];
      const outputs: string[] = [];
      const exprLines: string[] = [];
      const fbType = localFbTypes.get(stmt.callee) ?? stmt.callee;

      for (const arg of stmt.args ?? []) {
        if (arg.direction === "out") {
          for (const id of extractPlcExprIdentifiers(arg.expr)) {
            outputs.push(id);
          }
          exprLines.push(`${arg.name ?? "Q"} => ${formatPlcExpr(arg.expr)}`);
        } else {
          for (const id of extractPlcExprIdentifiers(arg.expr)) {
            inputs.push(id);
          }
          exprLines.push(`${arg.name ?? "IN"} := ${formatPlcExpr(arg.expr)}`);
        }
      }

      blocks.push({
        id: `fbd_net_${netIdx}`,
        title: `${stmt.callee} : ${fbType}`,
        blockType: "functionBlock",
        stereotype: `«FB ${fbType}»`,
        inputs: Array.from(new Set(inputs)),
        outputs: Array.from(new Set(outputs)),
        expressions: exprLines.length > 0 ? exprLines : [`${stmt.callee}()`],
      });
      netIdx++;
    } else if (stmt.kind === "if" && stmt.condition) {
      const inputs = new Set<string>();
      const outputs = new Set<string>();
      const exprLines: string[] = [];

      extractPlcExprIdentifiers(stmt.condition, inputs);
      exprLines.push(`IF ${formatPlcExpr(stmt.condition)}`);

      const scanBranchStmts = (branchStmts: PlcStatementLike[] | undefined, prefix?: string) => {
        for (const bs of branchStmts ?? []) {
          if (bs.kind === "assignment" && bs.target && bs.value) {
            const tName = formatPlcExpr(bs.target);
            if (tName) outputs.add(tName);
            extractPlcExprIdentifiers(bs.value, inputs);
            if (exprLines.length < 4) {
              exprLines.push(`${prefix ? `${prefix}: ` : ""}${tName} := ${formatPlcExpr(bs.value)}`);
            }
          } else if (bs.kind === "call" && bs.callee) {
            for (const a of bs.args ?? []) {
              if (a.direction === "out") {
                extractPlcExprIdentifiers(a.expr, outputs);
              } else {
                extractPlcExprIdentifiers(a.expr, inputs);
              }
            }
          }
        }
      };

      scanBranchStmts(stmt.thenStatements, "THEN");
      for (const elsif of stmt.elsifs ?? []) {
        extractPlcExprIdentifiers(elsif.condition, inputs);
        exprLines.push(`ELSIF ${formatPlcExpr(elsif.condition)}`);
        scanBranchStmts(elsif.statements);
      }
      if ((stmt.elseStatements?.length ?? 0) > 0) {
        scanBranchStmts(stmt.elseStatements, "ELSE");
      }

      // Avoid listing an output variable as its own upstream input unless used in condition
      const condInputs = extractPlcExprIdentifiers(stmt.condition);
      for (const elsif of stmt.elsifs ?? []) {
        extractPlcExprIdentifiers(elsif.condition, condInputs);
      }

      const finalInputs = Array.from(inputs).filter((i) => !outputs.has(i) || condInputs.has(i));
      blocks.push({
        id: `fbd_net_${netIdx}`,
        title: `NET ${netIdx}: SEL / INTERLOCK`,
        blockType: "selector",
        stereotype: (stmt.elsifs?.length ?? 0) > 0 ? "«FBD MUX / ELSIF»" : "«FBD SEL / IF»",
        inputs: finalInputs,
        outputs: Array.from(outputs),
        expressions: exprLines.slice(0, 4),
      });
      netIdx++;
    } else if (stmt.kind === "case" && stmt.selector) {
      const inputs = extractPlcExprIdentifiers(stmt.selector);
      const outputs = new Set<string>();
      const exprLines: string[] = [`CASE ${formatPlcExpr(stmt.selector)} OF`];
      for (const c of stmt.cases ?? []) {
        for (const bs of c.statements) {
          if (bs.kind === "assignment" && bs.target && bs.value) {
            const tName = formatPlcExpr(bs.target);
            if (tName) outputs.add(tName);
            extractPlcExprIdentifiers(bs.value, inputs);
          }
        }
      }
      blocks.push({
        id: `fbd_net_${netIdx}`,
        title: `NET ${netIdx}: CASE MUX`,
        blockType: "selector",
        stereotype: "«FBD CASE MUX»",
        inputs: Array.from(inputs),
        outputs: Array.from(outputs),
        expressions: exprLines,
      });
      netIdx++;
    } else if ((stmt.kind === "for" || stmt.kind === "while" || stmt.kind === "repeat") && stmt.statements) {
      const inputs = new Set<string>();
      const outputs = new Set<string>();
      if (stmt.condition) extractPlcExprIdentifiers(stmt.condition, inputs);
      if (stmt.start) extractPlcExprIdentifiers(stmt.start, inputs);
      if (stmt.end) extractPlcExprIdentifiers(stmt.end, inputs);
      for (const bs of stmt.statements) {
        if (bs.kind === "assignment" && bs.target && bs.value) {
          const tName = formatPlcExpr(bs.target);
          if (tName) outputs.add(tName);
          extractPlcExprIdentifiers(bs.value, inputs);
        }
      }
      blocks.push({
        id: `fbd_net_${netIdx}`,
        title: `NET ${netIdx}: ${stmt.kind.toUpperCase()} LOOP`,
        blockType: "loop",
        stereotype: `«ST ${stmt.kind.toUpperCase()}»`,
        inputs: Array.from(inputs),
        outputs: Array.from(outputs),
        expressions: [stmt.variable ? `FOR ${stmt.variable}` : stmt.kind.toUpperCase()],
      });
      netIdx++;
    }
  }

  if (blocks.length === 0) {
    const inVars = pou.variables.filter((v) => v.scope === "input" || v.scope === "inOut").map((v) => v.name);
    const outVars = pou.variables.filter((v) => v.scope === "output" || v.scope === "inOut").map((v) => v.name);
    blocks.push({
      id: "fbd_net_1",
      title: `${pou.name} Core`,
      blockType: "functionBlock",
      stereotype: `«${pou.pouType.toUpperCase()}»`,
      inputs: inVars,
      outputs: outVars,
      expressions: [pou.body.kind || "ST"],
    });
  }

  return blocks;
}

/**
 * Builds a structured `DiagramData` graph for an IEC 61131-3 PLCopen project.
 */
export function buildPlcopenDiagram(project: PlcProjectLike): PlcopenDiagramResult {
  const mainPou: PlcPouLike = project.pous[0] ?? {
    name: project.contentHeader?.name || "PLC_Program",
    pouType: "program",
    variables: [],
    body: { kind: "ST", st: { statements: [] } },
  };

  const title = project.contentHeader?.name || mainPou.name || "IEC 61131-3 PLCopen Program";
  const inputVars = mainPou.variables.filter((v) => v.scope === "input" || v.scope === "inOut");
  const outputVars = mainPou.variables.filter((v) => v.scope === "output");
  const localVars = mainPou.variables.filter((v) => v.scope !== "input" && v.scope !== "inOut" && v.scope !== "output");

  const fbdBlocks = synthesizeFbdBlocksFromPou(mainPou);

  let taskCount = 0;
  for (const cfg of project.configurations ?? []) {
    for (const res of cfg.resources ?? []) {
      taskCount += res.tasks?.length ?? 0;
    }
  }

  const nodes: PlcopenDiagramNode[] = [];
  const edges: PlcopenDiagramEdge[] = [];

  const inX = 44;
  const fbdX = 330;
  const outX = 690;

  const inputSpacing = 54;
  const inStartY = 86;
  const varProducerPort = new Map<string, { portId: string; x: number; y: number; dataType: string }>();

  inputVars.forEach((v, idx) => {
    const y = inStartY + idx * inputSpacing;
    const w = 176;
    const h = 38;
    const portId = `in_${v.name}.out`;
    const portX = inX + w;
    const portY = y + h / 2;

    nodes.push({
      id: `in_${v.name}`,
      type: `VAR_INPUT : ${v.dataType}`,
      kind: "external_connector",
      x: inX,
      y,
      width: w,
      height: h,
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      ports: [
        {
          id: portId,
          name: v.name,
          x: portX,
          y: portY,
          direction: "out",
          domain: v.dataType.toLowerCase(),
        },
      ],
      iconSvg: null,
      iconShapes: [],
      iconCoordSystem: null,
      parameters: v.address ? { address: v.address } : undefined,
    });

    varProducerPort.set(v.name, { portId, x: portX, y: portY, dataType: v.dataType });
  });

  // Also register local variables so internal references resolve cleanly
  const varTypeMap = new Map<string, string>();
  for (const v of mainPou.variables) {
    varTypeMap.set(v.name, v.dataType);
  }

  let curFbdY = 84;
  const fbdW = 248;

  fbdBlocks.forEach((blk, bIdx) => {
    const pinCount = Math.max(blk.inputs.length, blk.outputs.length, 1);
    const exprCount = Math.min(3, blk.expressions.length);
    const fbdH = Math.max(92, 48 + Math.max(pinCount * 22, exprCount * 18));
    const y = curFbdY;
    curFbdY += fbdH + 26;

    const ports: PlcopenDiagramPort[] = [];

    blk.inputs.forEach((inName, iIdx) => {
      const py = y + 38 + iIdx * 22;
      const pid = `${blk.id}.in.${inName}`;
      ports.push({
        id: pid,
        name: inName,
        x: fbdX,
        y: py,
        direction: "in",
        domain: (varTypeMap.get(inName) || "BOOL").toLowerCase(),
      });

      const src = varProducerPort.get(inName);
      if (src) {
        const style = getIecTypeStyle(src.dataType);
        const midX = Math.round((src.x + fbdX) / 2 + (bIdx % 2 === 0 ? -12 : 12));
        edges.push({
          id: `wire_${blk.id}_in_${inName}_${iIdx}`,
          sourcePort: src.portId,
          targetPort: pid,
          points: [
            { x: src.x, y: src.y },
            { x: midX, y: src.y },
            { x: midX, y: py },
            { x: fbdX, y: py },
          ],
          color: style.rgb,
          thickness: 1.8,
          pattern: "Solid",
          signalName: inName,
        });
      }
    });

    blk.outputs.forEach((outName, oIdx) => {
      const py = y + 38 + oIdx * 22;
      const pid = `${blk.id}.out.${outName}`;
      const dt = varTypeMap.get(outName) || "BOOL";
      ports.push({
        id: pid,
        name: outName,
        x: fbdX + fbdW,
        y: py,
        direction: "out",
        domain: dt.toLowerCase(),
      });
      // Register this block output as the latest producer for downstream FBD blocks and VAR_OUTPUTs
      varProducerPort.set(outName, { portId: pid, x: fbdX + fbdW, y: py, dataType: dt });
    });

    nodes.push({
      id: blk.id,
      type: blk.stereotype,
      kind: "component",
      x: fbdX,
      y,
      width: fbdW,
      height: fbdH,
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      ports,
      iconSvg: null,
      iconShapes: [],
      iconCoordSystem: null,
      parameters: {
        title: blk.title,
        expression: blk.expressions[0] ?? "",
      },
    });
  });

  const outSpacing = 66;
  const outStartY = 92;

  outputVars.forEach((v, idx) => {
    const y = outStartY + idx * outSpacing;
    const w = 182;
    const h = 42;
    const portId = `out_${v.name}.in`;
    const portX = outX;
    const portY = y + h / 2;

    nodes.push({
      id: `out_${v.name}`,
      type: `VAR_OUTPUT : ${v.dataType}`,
      kind: "external_connector",
      x: outX,
      y,
      width: w,
      height: h,
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      ports: [
        {
          id: portId,
          name: v.name,
          x: portX,
          y: portY,
          direction: "in",
          domain: v.dataType.toLowerCase(),
        },
      ],
      iconSvg: null,
      iconShapes: [],
      iconCoordSystem: null,
      parameters: v.address ? { address: v.address } : undefined,
    });

    const src = varProducerPort.get(v.name);
    if (src) {
      const style = getIecTypeStyle(v.dataType);
      const midX = Math.round((src.x + portX) / 2 + (idx % 2 === 0 ? -10 : 10));
      edges.push({
        id: `wire_out_${v.name}`,
        sourcePort: src.portId,
        targetPort: portId,
        points: [
          { x: src.x, y: src.y },
          { x: midX, y: src.y },
          { x: midX, y: portY },
          { x: portX, y: portY },
        ],
        color: style.rgb,
        thickness: 2,
        pattern: "Solid",
        signalName: v.name,
      });
    }
  });

  return {
    title,
    pouName: mainPou.name,
    pouType: mainPou.pouType,
    diagram: {
      nodes,
      edges,
      coordinateSystem: null,
      diagramBackground: null,
    },
    fbdBlocks,
    metadata: {
      pouCount: project.pous.length,
      inputCount: inputVars.length,
      outputCount: outputVars.length,
      localCount: localVars.length,
      networkCount: fbdBlocks.length,
      taskCount,
    },
  };
}

function escapeXml(str: string): string {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Renders an IEC 61131-3 Function Block Diagram (FBD) & POU I/O SVG schematic
 * from a parsed `PlcProject`.
 */
export function renderPlcopenSvg(project: PlcProjectLike): string {
  const built = buildPlcopenDiagram(project);
  const mainPou: PlcPouLike = project.pous[0] ?? {
    name: built.pouName,
    pouType: "program",
    variables: [],
    body: { kind: "ST" },
  };

  const inputVars = mainPou.variables.filter((v) => v.scope === "input" || v.scope === "inOut");
  const outputVars = mainPou.variables.filter((v) => v.scope === "output");
  const localVars = mainPou.variables.filter((v) => v.scope !== "input" && v.scope !== "inOut" && v.scope !== "output");

  const width = 940;
  const maxNodeY = built.diagram.nodes.reduce((acc, n) => Math.max(acc, n.y + n.height), 340);
  const height = Math.max(410, maxNodeY + 64);

  const nodesSvg: string[] = [];
  const wiresSvg: string[] = [];

  // Render orthogonal signal wires first (underneath terminal pins)
  for (const edge of built.diagram.edges) {
    if (edge.points.length < 2) continue;
    const d = edge.points.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x} ${pt.y}`).join(" ");
    const stroke = `rgb(${edge.color[0]}, ${edge.color[1]}, ${edge.color[2]})`;
    wiresSvg.push(
      `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${edge.thickness}" stroke-linejoin="round" opacity="0.88" marker-end="url(#plc-arrow)"/>`,
    );
  }

  // Render input variable terminals (left rail)
  inputVars.forEach((v) => {
    const node = built.diagram.nodes.find((n) => n.id === `in_${v.name}`);
    if (!node) return;
    const style = getIecTypeStyle(v.dataType);
    const { x, y, width: w, height: h } = node;
    const addrText = v.address ? ` [${v.address}]` : "";
    const label = v.name.length > 19 ? `${v.name.slice(0, 18)}…` : v.name;

    nodesSvg.push(`<g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.5"/>
      <rect x="${x + 6}" y="${y + 6}" width="38" height="14" rx="3" fill="#0b111e" stroke="${style.stroke}" stroke-width="0.9"/>
      <text x="${x + 25}" y="${y + 16}" text-anchor="middle" fill="${style.badge}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5" font-weight="700">${escapeXml(v.dataType.toUpperCase())}</text>
      ${addrText ? `<text x="${x + w - 8}" y="${y + 15}" text-anchor="end" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8">${escapeXml(addrText)}</text>` : ""}
      <text x="${x + 8}" y="${y + 31}" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10" font-weight="700">${escapeXml(label)}</text>
      <circle cx="${x + w}" cy="${y + h / 2}" r="4" fill="#0b111e" stroke="${style.stroke}" stroke-width="1.8"/>
    </g>`);
  });

  // Render synthesized FBD network blocks (center column)
  built.fbdBlocks.forEach((blk) => {
    const node = built.diagram.nodes.find((n) => n.id === blk.id);
    if (!node) return;
    const { x, y, width: w, height: h } = node;
    const accent = blk.blockType === "functionBlock" ? "#a855f7" : blk.blockType === "selector" ? "#f59e0b" : "#0284c7";
    const headerFill =
      blk.blockType === "functionBlock"
        ? "rgba(168, 85, 247, 0.18)"
        : blk.blockType === "selector"
          ? "rgba(245, 158, 11, 0.16)"
          : "rgba(2, 132, 199, 0.18)";

    const inPinsSvg = blk.inputs.map((inName, idx) => {
      const py = y + 38 + idx * 22;
      const shortName = inName.length > 14 ? `${inName.slice(0, 13)}…` : inName;
      return `<g>
        <circle cx="${x}" cy="${py}" r="3.5" fill="#0b111e" stroke="${accent}" stroke-width="1.6"/>
        <text x="${x + 8}" y="${py + 3}" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5">${escapeXml(shortName)}</text>
      </g>`;
    });

    const outPinsSvg = blk.outputs.map((outName, idx) => {
      const py = y + 38 + idx * 22;
      const shortName = outName.length > 14 ? `${outName.slice(0, 13)}…` : outName;
      return `<g>
        <circle cx="${x + w}" cy="${py}" r="3.5" fill="#0b111e" stroke="#10b981" stroke-width="1.6"/>
        <text x="${x + w - 8}" y="${py + 3}" text-anchor="end" fill="#6ee7b7" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5" font-weight="600">${escapeXml(shortName)}</text>
      </g>`;
    });

    const exprStartY = y + h - Math.min(2, blk.expressions.length) * 14 - 6;
    const exprLinesSvg = blk.expressions.slice(0, 2).map((line, lIdx) => {
      const clean = line.length > 36 ? `${line.slice(0, 35)}…` : line;
      return `<text x="${x + 10}" y="${exprStartY + lIdx * 13}" fill="#93c5fd" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8">${escapeXml(clean)}</text>`;
    });

    nodesSvg.push(`<g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#131c2e" stroke="${accent}" stroke-width="1.6"/>
      <rect x="${x}" y="${y}" width="${w}" height="24" rx="6" fill="${headerFill}"/>
      <line x1="${x}" y1="${y + 24}" x2="${x + w}" y2="${y + 24}" stroke="${accent}" stroke-width="1"/>
      <text x="${x + 10}" y="${y + 15}" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="700">${escapeXml(blk.title)}</text>
      <text x="${x + w - 8}" y="${y + 15}" text-anchor="end" fill="#bae6fd" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8" font-weight="600">${escapeXml(blk.stereotype)}</text>
      ${inPinsSvg.join("\n      ")}
      ${outPinsSvg.join("\n      ")}
      <line x1="${x + 8}" y1="${exprStartY - 10}" x2="${x + w - 8}" y2="${exprStartY - 10}" stroke="#1e293b" stroke-width="0.9"/>
      ${exprLinesSvg.join("\n      ")}
    </g>`);
  });

  // Render output variable terminals (right rail)
  outputVars.forEach((v) => {
    const node = built.diagram.nodes.find((n) => n.id === `out_${v.name}`);
    if (!node) return;
    const style = getIecTypeStyle(v.dataType);
    const { x, y, width: w, height: h } = node;
    const addrText = v.address ? ` [${v.address}]` : "";
    const label = v.name.length > 20 ? `${v.name.slice(0, 19)}…` : v.name;

    nodesSvg.push(`<g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.6"/>
      <circle cx="${x}" cy="${y + h / 2}" r="4" fill="#0b111e" stroke="${style.stroke}" stroke-width="1.8"/>
      <rect x="${x + 10}" y="${y + 6}" width="38" height="14" rx="3" fill="#0b111e" stroke="${style.stroke}" stroke-width="0.9"/>
      <text x="${x + 29}" y="${y + 16}" text-anchor="middle" fill="${style.badge}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5" font-weight="700">${escapeXml(v.dataType.toUpperCase())}</text>
      ${addrText ? `<text x="${x + w - 8}" y="${y + 16}" text-anchor="end" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8">${escapeXml(addrText)}</text>` : ""}
      <text x="${x + 10}" y="${y + 33}" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10" font-weight="700">${escapeXml(label)}</text>
    </g>`);
  });

  // Extract first task schedule if present
  const firstTask = project.configurations?.[0]?.resources?.[0]?.tasks?.[0];
  const taskBadge = firstTask
    ? `Task: ${firstTask.name} (${firstTask.interval || `${firstTask.intervalMs ?? 10}ms`}, Prio ${firstTask.priority})`
    : `Body: ${mainPou.body.kind || "ST"} → FBD Synthesis`;

  const localSummary =
    localVars.length > 0
      ? `Local FB/Vars: ${localVars
          .map((v) => `${v.name}:${v.dataType}`)
          .slice(0, 4)
          .join(", ")}`
      : `Inputs: ${inputVars.length} | Outputs: ${outputVars.length} | Networks: ${built.fbdBlocks.length}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0b111e;">
  <defs>
    <marker id="plc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#38bdf8"/>
    </marker>
  </defs>
  <rect width="${width}" height="${height}" rx="8" fill="#0b111e"/>
  <rect x="14" y="14" width="${width - 28}" height="${height - 28}" rx="6" fill="none" stroke="#1e293b" stroke-width="1.4"/>

  <!-- Header Banner -->
  <rect x="14" y="14" width="${width - 28}" height="42" rx="6" fill="#111a2e" stroke="#1e293b" stroke-width="1"/>
  <text x="28" y="33" fill="#38bdf8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11.5" font-weight="700">IEC 61131-3 PLCopen FBD // «${escapeXml(built.pouType.toUpperCase())}» ${escapeXml(built.pouName)}</text>
  <text x="28" y="48" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5">${escapeXml(built.title)} · ${escapeXml(localSummary)}</text>
  <rect x="${width - 258}" y="22" width="230" height="24" rx="5" fill="#08283c" stroke="#0284c7" stroke-width="1"/>
  <text x="${width - 143}" y="38" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="600">${escapeXml(taskBadge)}</text>

  <!-- Rail Column Headers -->
  <text x="132" y="74" text-anchor="middle" fill="#64748b" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9" font-weight="700" letter-spacing="0.06em">VAR_INPUT RAIL</text>
  <text x="454" y="74" text-anchor="middle" fill="#64748b" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9" font-weight="700" letter-spacing="0.06em">FBD LOGIC &amp; FUNCTION BLOCKS</text>
  <text x="781" y="74" text-anchor="middle" fill="#64748b" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9" font-weight="700" letter-spacing="0.06em">VAR_OUTPUT RAIL</text>

  <g class="plcopen-wires">
    ${wiresSvg.join("\n    ")}
  </g>
  <g class="plcopen-nodes">
    ${nodesSvg.join("\n    ")}
  </g>
</svg>`;
}
