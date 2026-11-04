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
  label?: string | undefined;
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
  properties?: { name: string; className: string } | undefined;
}

export interface PlcopenDiagramEdge {
  id: string;
  source: string;
  target: string;
  sourcePort: string;
  targetPort: string;
  points: { x: number; y: number }[];
  vertices?: { x: number; y: number }[] | undefined;
  color: [number, number, number];
  thickness: number;
  pattern: string;
  signalName?: string | undefined;
  attrs?: Record<string, unknown> | undefined;
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
 * Helper to determine the marker ID for a given RGB wire color.
 */
function getArrowMarkerId(rgb: [number, number, number]): string {
  if (rgb[0] === 16 && rgb[1] === 185 && rgb[2] === 129) return "plc-arrow-bool";
  if (rgb[0] === 245 && rgb[1] === 158 && rgb[2] === 11) return "plc-arrow-int";
  if (rgb[0] === 168 && rgb[1] === 85 && rgb[2] === 247) return "plc-arrow-time";
  return "plc-arrow-real";
}

function resolvePouRails(
  mainPou: PlcPouLike,
  fbdBlocks: PlcopenFbdNetworkBlock[],
): {
  inputVars: PlcVariableLike[];
  outputVars: PlcVariableLike[];
  localVars: PlcVariableLike[];
} {
  const rawInputVars = mainPou.variables.filter((v) => v.scope === "input" || v.scope === "inOut");
  const rawOutputVars = mainPou.variables.filter((v) => v.scope === "output");
  const rawLocalVars = mainPou.variables.filter(
    (v) => v.scope !== "input" && v.scope !== "inOut" && v.scope !== "output",
  );

  if (rawInputVars.length > 0 || rawOutputVars.length > 0) {
    return {
      inputVars: rawInputVars,
      outputVars: rawOutputVars,
      localVars: rawLocalVars,
    };
  }

  // Fallback for compact ST programs that declare all variables inside a single `VAR ... END_VAR` block:
  // variables read as inputs appear on the left rail, and variables assigned by networks appear on the right rail.
  const allBlockInputs = new Set<string>();
  const allBlockOutputs = new Set<string>();
  for (const blk of fbdBlocks) {
    for (const i of blk.inputs) allBlockInputs.add(i);
    for (const o of blk.outputs) allBlockOutputs.add(o);
  }

  const inferredInputs = rawLocalVars.filter((v) => allBlockInputs.has(v.name) || !allBlockOutputs.has(v.name));
  const inferredOutputs = rawLocalVars.filter((v) => allBlockOutputs.has(v.name));
  return {
    inputVars: inferredInputs,
    outputVars: inferredOutputs,
    localVars: [],
  };
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
  const fbdBlocks = synthesizeFbdBlocksFromPou(mainPou);
  const { inputVars, outputVars, localVars } = resolvePouRails(mainPou, fbdBlocks);

  let taskCount = 0;
  for (const cfg of project.configurations ?? []) {
    for (const res of cfg.resources ?? []) {
      taskCount += res.tasks?.length ?? 0;
    }
  }

  const nodes: PlcopenDiagramNode[] = [];
  const edges: PlcopenDiagramEdge[] = [];

  const inX = 36;
  const inW = 196;
  const fbdX = 326;
  const fbdW = 328;
  const outX = 744;
  const outW = 200;

  const inputSpacing = 54;
  const inStartY = 86;
  const varProducerPort = new Map<string, { nodeId: string; portId: string; x: number; y: number; dataType: string }>();

  inputVars.forEach((v, idx) => {
    const y = inStartY + idx * inputSpacing;
    const w = inW;
    const h = 38;
    const nodeId = `in_${v.name}`;
    const portId = `${nodeId}.out`;
    const portX = inX + w;
    const portY = y + h / 2;

    nodes.push({
      id: nodeId,
      label: `${v.name}\n${v.dataType.toUpperCase()}`,
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
      properties: { name: v.name, className: `VAR_INPUT : ${v.dataType}` },
    });

    varProducerPort.set(v.name, { nodeId, portId, x: portX, y: portY, dataType: v.dataType });
  });

  // Also register local variables so internal references resolve cleanly
  const varTypeMap = new Map<string, string>();
  for (const v of mainPou.variables) {
    varTypeMap.set(v.name, v.dataType);
  }

  let curFbdY = 84;
  let inWireCounter = 0;

  fbdBlocks.forEach((blk) => {
    const pinCount = Math.max(blk.inputs.length, blk.outputs.length, 1);
    const exprCount = Math.min(2, Math.max(1, blk.expressions.length));
    const pinStep = 20;
    const dividerOffset = 38 + pinCount * pinStep;
    const exprStartOffset = dividerOffset + 14;
    const fbdH = Math.max(96, exprStartOffset + (exprCount - 1) * 14 + 12);
    const y = curFbdY;
    curFbdY += fbdH + 28;

    const ports: PlcopenDiagramPort[] = [];

    blk.inputs.forEach((inName, iIdx) => {
      const py = y + 40 + iIdx * pinStep;
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
        const strokeHex = style.stroke;
        let points: { x: number; y: number }[];

        if (src.x > fbdX) {
          // Inter-network cascade wire (upstream FBD block right output -> downstream FBD block left input):
          // route cleanly around the outside via the horizontal inter-block channel above `blk`.
          const rightTapX = fbdX + fbdW + 18;
          const leftTapX = fbdX - 18;
          const channelY = Math.round(y - 14);
          points = [
            { x: src.x, y: src.y },
            { x: rightTapX, y: src.y },
            { x: rightTapX, y: channelY },
            { x: leftTapX, y: channelY },
            { x: leftTapX, y: py },
            { x: fbdX, y: py },
          ];
        } else {
          // Left-rail input wire: stagger each wire into its own vertical lane so parallel wires never overlap
          const laneX = 252 + ((inWireCounter * 11) % 55);
          inWireCounter++;
          points = [
            { x: src.x, y: src.y },
            { x: laneX, y: src.y },
            { x: laneX, y: py },
            { x: fbdX, y: py },
          ];
        }

        edges.push({
          id: `wire_${blk.id}_in_${inName}_${iIdx}`,
          source: src.nodeId,
          target: blk.id,
          sourcePort: src.portId,
          targetPort: pid,
          points,
          vertices: points.slice(1, -1),
          color: style.rgb,
          thickness: 1.8,
          pattern: "Solid",
          signalName: inName,
          attrs: {
            line: {
              stroke: strokeHex,
              strokeWidth: 1.8,
              targetMarker: { name: "block", width: 7, height: 5, fill: strokeHex, stroke: strokeHex },
            },
          },
        });
      }
    });

    blk.outputs.forEach((outName, oIdx) => {
      const py = y + 40 + oIdx * pinStep;
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
      varProducerPort.set(outName, { nodeId: blk.id, portId: pid, x: fbdX + fbdW, y: py, dataType: dt });
    });

    nodes.push({
      id: blk.id,
      label: `${blk.title}\n${blk.expressions[0] ?? blk.stereotype}`,
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
      properties: {
        name: blk.title,
        className: blk.stereotype,
      },
    });
  });

  const outSpacing = 66;
  const outStartY = 92;

  outputVars.forEach((v, idx) => {
    const y = outStartY + idx * outSpacing;
    const w = outW;
    const h = 42;
    const nodeId = `out_${v.name}`;
    const portId = `${nodeId}.in`;
    const portX = outX;
    const portY = y + h / 2;

    nodes.push({
      id: nodeId,
      label: `${v.name}\n${v.dataType.toUpperCase()}`,
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
      properties: { name: v.name, className: `VAR_OUTPUT : ${v.dataType}` },
    });

    const src = varProducerPort.get(v.name);
    if (src) {
      const style = getIecTypeStyle(v.dataType);
      const strokeHex = style.stroke;
      const midX = 690 + (idx % 5) * 10;
      const points = [
        { x: src.x, y: src.y },
        { x: midX, y: src.y },
        { x: midX, y: portY },
        { x: portX, y: portY },
      ];
      edges.push({
        id: `wire_out_${v.name}`,
        source: src.nodeId,
        target: nodeId,
        sourcePort: src.portId,
        targetPort: portId,
        points,
        vertices: points.slice(1, -1),
        color: style.rgb,
        thickness: 2,
        pattern: "Solid",
        signalName: v.name,
        attrs: {
          line: {
            stroke: strokeHex,
            strokeWidth: 2,
            targetMarker: { name: "block", width: 7, height: 5, fill: strokeHex, stroke: strokeHex },
          },
        },
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

  const { inputVars, outputVars, localVars } = resolvePouRails(mainPou, built.fbdBlocks);

  const width = 980;
  const maxNodeY = built.diagram.nodes.reduce((acc, n) => Math.max(acc, n.y + n.height), 340);
  const height = Math.max(420, maxNodeY + 44);

  const nodesSvg: string[] = [];
  const wiresSvg: string[] = [];

  // Render orthogonal signal wires first (underneath terminal pins)
  for (const edge of built.diagram.edges) {
    if (edge.points.length < 2) continue;
    const d = edge.points.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x} ${pt.y}`).join(" ");
    const stroke = `rgb(${edge.color[0]}, ${edge.color[1]}, ${edge.color[2]})`;
    const markerId = getArrowMarkerId(edge.color);
    wiresSvg.push(
      `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${edge.thickness}" stroke-linejoin="round" opacity="0.9" marker-end="url(#${markerId})"/>`,
    );
  }

  // Render input variable terminals (left rail)
  inputVars.forEach((v) => {
    const node = built.diagram.nodes.find((n) => n.id === `in_${v.name}`);
    if (!node) return;
    const style = getIecTypeStyle(v.dataType);
    const { x, y, width: w, height: h } = node;
    const addrText = v.address ? ` [${v.address}]` : "";
    const label = v.name.length > 23 ? `${v.name.slice(0, 22)}…` : v.name;

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

    const pinCount = Math.max(blk.inputs.length, blk.outputs.length, 1);
    const pinStep = 20;
    const dividerY = y + 38 + pinCount * pinStep;
    const exprStartY = dividerY + 14;

    const inPinsSvg = blk.inputs.map((inName, idx) => {
      const py = y + 40 + idx * pinStep;
      const shortName = inName.length > 22 ? `${inName.slice(0, 21)}…` : inName;
      return `<g>
        <circle cx="${x}" cy="${py}" r="3.5" fill="#0b111e" stroke="${accent}" stroke-width="1.6"/>
        <text x="${x + 8}" y="${py + 3}" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5">${escapeXml(shortName)}</text>
      </g>`;
    });

    const outPinsSvg = blk.outputs.map((outName, idx) => {
      const py = y + 40 + idx * pinStep;
      const shortName = outName.length > 22 ? `${outName.slice(0, 21)}…` : outName;
      return `<g>
        <circle cx="${x + w}" cy="${py}" r="3.5" fill="#0b111e" stroke="#10b981" stroke-width="1.6"/>
        <text x="${x + w - 8}" y="${py + 3}" text-anchor="end" fill="#6ee7b7" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5" font-weight="600">${escapeXml(shortName)}</text>
      </g>`;
    });

    const exprLinesSvg = blk.expressions.slice(0, 2).map((line, lIdx) => {
      const clean = line.length > 52 ? `${line.slice(0, 51)}…` : line;
      return `<text x="${x + 10}" y="${exprStartY + lIdx * 14}" fill="#93c5fd" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8">${escapeXml(clean)}</text>`;
    });

    nodesSvg.push(`<g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#131c2e" stroke="${accent}" stroke-width="1.6"/>
      <rect x="${x}" y="${y}" width="${w}" height="24" rx="6" fill="${headerFill}"/>
      <line x1="${x}" y1="${y + 24}" x2="${x + w}" y2="${y + 24}" stroke="${accent}" stroke-width="1"/>
      <text x="${x + 10}" y="${y + 15}" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="700">${escapeXml(blk.title)}</text>
      <text x="${x + w - 8}" y="${y + 15}" text-anchor="end" fill="#bae6fd" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8" font-weight="600">${escapeXml(blk.stereotype)}</text>
      ${inPinsSvg.join("\n      ")}
      ${outPinsSvg.join("\n      ")}
      <line x1="${x + 8}" y1="${dividerY}" x2="${x + w - 8}" y2="${dividerY}" stroke="#1e293b" stroke-width="0.9"/>
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
    const label = v.name.length > 23 ? `${v.name.slice(0, 22)}…` : v.name;

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
    <marker id="plc-arrow-bool" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#10b981"/>
    </marker>
    <marker id="plc-arrow-real" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#38bdf8"/>
    </marker>
    <marker id="plc-arrow-int" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#f59e0b"/>
    </marker>
    <marker id="plc-arrow-time" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#a855f7"/>
    </marker>
  </defs>
  <rect width="${width}" height="${height}" rx="8" fill="#0b111e"/>
  <rect x="14" y="14" width="${width - 28}" height="${height - 28}" rx="6" fill="none" stroke="#1e293b" stroke-width="1.4"/>

  <!-- Header Banner -->
  <rect x="14" y="14" width="${width - 28}" height="42" rx="6" fill="#111a2e" stroke="#1e293b" stroke-width="1"/>
  <text x="28" y="33" fill="#38bdf8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11.5" font-weight="700">IEC 61131-3 PLCopen FBD // «${escapeXml(built.pouType.toUpperCase())}» ${escapeXml(built.pouName)}</text>
  <text x="28" y="48" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5">${escapeXml(built.title)} · ${escapeXml(localSummary)}</text>
  <rect x="${width - 266}" y="22" width="238" height="24" rx="5" fill="#08283c" stroke="#0284c7" stroke-width="1"/>
  <text x="${width - 147}" y="38" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="600">${escapeXml(taskBadge)}</text>

  <!-- Rail Column Headers -->
  <text x="134" y="74" text-anchor="middle" fill="#64748b" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9" font-weight="700" letter-spacing="0.06em">VAR_INPUT RAIL</text>
  <text x="490" y="74" text-anchor="middle" fill="#64748b" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9" font-weight="700" letter-spacing="0.06em">FBD LOGIC &amp; FUNCTION BLOCKS</text>
  <text x="844" y="74" text-anchor="middle" fill="#64748b" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9" font-weight="700" letter-spacing="0.06em">VAR_OUTPUT RAIL</text>

  <g class="plcopen-wires">
    ${wiresSvg.join("\n    ")}
  </g>
  <g class="plcopen-nodes">
    ${nodesSvg.join("\n    ")}
  </g>
</svg>`;
}

/**
 * Lightweight, zero-dependency parser that converts raw PLCopen TC6 XML (`.plcopen` / `.xml`)
 * or IEC 61131-3 Structured Text (`.st`) into a `PlcProjectLike` structure for client-side diagramming.
 */
export function parsePlcopenTextToProject(source: string, fallbackTitle = "PLC_Project"): PlcProjectLike {
  const unescapeXmlEntities = (s: string) =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");

  const stripStComments = (s: string) => {
    let result = "";
    let i = 0;
    while (i < s.length) {
      if (s[i] === "(" && s[i + 1] === "*") {
        const end = s.indexOf("*)", i + 2);
        i = end === -1 ? s.length : end + 2;
        result += " ";
      } else if (s[i] === "/" && s[i + 1] === "/") {
        const nl = s.indexOf("\n", i + 2);
        i = nl === -1 ? s.length : nl + 1;
        result += " ";
      } else {
        result += s[i];
        i++;
      }
    }
    return result;
  };

  const parseSimpleExpr = (raw: string): PlcExprLike => {
    const trimmed = raw.trim();
    if (!trimmed) return { kind: "literal", raw: "" };
    // Strip outer balanced parens
    if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
      let depth = 0;
      let wrapsAll = true;
      for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === "(") depth++;
        else if (trimmed[i] === ")") {
          depth--;
          if (depth === 0 && i < trimmed.length - 1) {
            wrapsAll = false;
            break;
          }
        }
      }
      if (wrapsAll) return parseSimpleExpr(trimmed.slice(1, -1));
    }

    // Binary operators at top level (lowest precedence first: OR, XOR, AND, comparisons, +, -, *, /)
    const opPatterns = [
      /\s+(OR|XOR)\s+/i,
      /\s+(AND)\s+/i,
      /\s*(<>|<=|>=|=|<|>)\s*/,
      /\s+(\+|-)\s+/,
      /\s*(\*|\/|\s+MOD\s+)\s*/i,
    ];
    for (const pat of opPatterns) {
      let depth = 0;
      for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth = Math.max(0, depth - 1);
        else if (depth === 0) {
          const rest = trimmed.slice(i);
          const m = pat.exec(rest);
          if (m && m.index === 0 && i > 0) {
            const leftStr = trimmed.slice(0, i).trim();
            const opStr = (m[1] ?? m[0]).trim().toUpperCase();
            const rightStr = rest.slice(m[0].length).trim();
            if (leftStr && rightStr) {
              return {
                kind: "binary",
                op: opStr,
                left: parseSimpleExpr(leftStr),
                right: parseSimpleExpr(rightStr),
              };
            }
          }
        }
      }
    }

    if (/^NOT\s+/i.test(trimmed)) {
      return {
        kind: "unary",
        op: "NOT",
        argument: parseSimpleExpr(trimmed.replace(/^NOT\s+/i, "")),
      };
    }

    if (/^(TRUE|FALSE)$/i.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed) || /^T#/i.test(trimmed)) {
      return { kind: "literal", raw: trimmed, value: trimmed };
    }

    return { kind: "identifier", name: trimmed };
  };

  const parseSimpleStatements = (stBody: string): PlcStatementLike[] => {
    const clean = stripStComments(unescapeXmlEntities(stBody)).trim();
    const stmts: PlcStatementLike[] = [];
    let pos = 0;

    const parseAssignOrCall = (chunk: string): PlcStatementLike | null => {
      const c = chunk.trim().replace(/;+\s*$/, "");
      if (!c) return null;
      const callMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/.exec(c);
      if (callMatch && !c.includes(" := ") && /(:=|=>)/.test(callMatch[2] ?? "")) {
        const callee = callMatch[1]!;
        const argsRaw = callMatch[2] ?? "";
        const args: PlcCallArgLike[] = [];
        for (const part of argsRaw.split(",")) {
          const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(:=|=>)\s*([\s\S]+)$/.exec(part);
          if (m) {
            args.push({
              name: m[1]!,
              direction: m[2] === "=>" ? "out" : "in",
              expr: parseSimpleExpr(m[3]!),
            });
          }
        }
        return { kind: "call", callee, args };
      }
      const assignIdx = c.indexOf(":=");
      if (assignIdx > 0) {
        const lhs = c.slice(0, assignIdx).trim();
        const rhs = c.slice(assignIdx + 2).trim();
        return {
          kind: "assignment",
          target: { kind: "identifier", name: lhs },
          value: parseSimpleExpr(rhs),
        };
      }
      return null;
    };

    while (pos < clean.length) {
      const rest = clean.slice(pos).trimStart();
      if (!rest) break;
      pos = clean.length - rest.length;

      if (/^IF\b/i.test(rest)) {
        const endIfMatch = /\bEND_IF\s*;?/i.exec(rest);
        if (!endIfMatch) break;
        const ifBlock = rest.slice(0, endIfMatch.index);
        pos += endIfMatch.index + endIfMatch[0].length;

        const thenMatch = /^IF\s+([\s\S]*?)\s+THEN\b/i.exec(ifBlock);
        if (thenMatch) {
          const cond = parseSimpleExpr(thenMatch[1]!);
          const afterThen = ifBlock.slice(thenMatch[0].length);
          const parts = afterThen.split(/\b(?=ELSIF\s|ELSE\b)/i);
          const thenStmts: PlcStatementLike[] = [];
          const elsifs: PlcIfBranchLike[] = [];
          const elseStmts: PlcStatementLike[] = [];

          for (let pIdx = 0; pIdx < parts.length; pIdx++) {
            const p = parts[pIdx]!.trim();
            if (pIdx === 0) {
              for (const s of p.split(";")) {
                const parsed = parseAssignOrCall(s);
                if (parsed) thenStmts.push(parsed);
              }
            } else if (/^ELSIF\b/i.test(p)) {
              const em = /^ELSIF\s+([\s\S]*?)\s+THEN\b([\s\S]*)$/i.exec(p);
              if (em) {
                const bStmts: PlcStatementLike[] = [];
                for (const s of em[2]!.split(";")) {
                  const parsed = parseAssignOrCall(s);
                  if (parsed) bStmts.push(parsed);
                }
                elsifs.push({ condition: parseSimpleExpr(em[1]!), statements: bStmts });
              }
            } else if (/^ELSE\b/i.test(p)) {
              const bodyStr = p.replace(/^ELSE\b/i, "");
              for (const s of bodyStr.split(";")) {
                const parsed = parseAssignOrCall(s);
                if (parsed) elseStmts.push(parsed);
              }
            }
          }

          stmts.push({
            kind: "if",
            condition: cond,
            thenStatements: thenStmts,
            elsifs,
            elseStatements: elseStmts,
          });
        }
        continue;
      }

      const semiIdx = rest.indexOf(";");
      if (semiIdx === -1) {
        const parsed = parseAssignOrCall(rest);
        if (parsed) stmts.push(parsed);
        break;
      }
      const stmtChunk = rest.slice(0, semiIdx);
      pos += semiIdx + 1;
      const parsed = parseAssignOrCall(stmtChunk);
      if (parsed) stmts.push(parsed);
    }

    return stmts;
  };

  // 1. Check if XML format (<project ...> or <pou ...>)
  if (/<(?:project|pou)\b/i.test(source)) {
    const contentName = /<contentHeader\b[^>]*\bname=["']([^"']+)["']/i.exec(source)?.[1] || fallbackTitle;
    const pouMatch = /<pou\b[^>]*\bname=["']([^"']+)["'][^>]*\bpouType=["']([^"']+)["']/i.exec(source);
    const pouName = pouMatch?.[1] || contentName;
    const pouType = pouMatch?.[2] || "program";

    const variables: PlcVariableLike[] = [];
    const extractVarSection = (tag: string, scope: PlcVariableLike["scope"]) => {
      const secRe = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
      let sm: RegExpExecArray | null;
      while ((sm = secRe.exec(source)) !== null) {
        const body = sm[1] || "";
        const varRe = /<variable\b([^>]*)>\s*<type>\s*<(?:derived\s+name=["']([^"']+)["']|([A-Za-z0-9_]+))\s*\/?>/gi;
        let vm: RegExpExecArray | null;
        while ((vm = varRe.exec(body)) !== null) {
          const attrs = vm[1] || "";
          const vName = /\bname=["']([^"']+)["']/i.exec(attrs)?.[1];
          const vAddr = /\baddress=["']([^"']+)["']/i.exec(attrs)?.[1];
          const vType = vm[2] || vm[3] || "BOOL";
          if (vName) {
            variables.push({ name: vName, scope, dataType: vType, address: vAddr });
          }
        }
      }
    };

    extractVarSection("inputVars", "input");
    extractVarSection("inOutVars", "inOut");
    extractVarSection("outputVars", "output");
    extractVarSection("localVars", "local");
    extractVarSection("tempVars", "temp");

    const stMatch = /<ST\b[^>]*>([\s\S]*?)<\/ST>/i.exec(source);
    const rawStXml = stMatch?.[1]?.replace(/<\/?(?:xhtml(?::p)?|p)\b[^>]*>/gi, "") ?? "";
    const statements = parseSimpleStatements(rawStXml);

    const tasks: PlcTaskLike[] = [];
    const taskRe = /<task\b([^>]*)\/?>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = taskRe.exec(source)) !== null) {
      const tAttrs = tm[1] || "";
      const tName = /\bname=["']([^"']+)["']/i.exec(tAttrs)?.[1] || "MainTask";
      const tPrio = Number(/\bpriority=["'](\d+)["']/i.exec(tAttrs)?.[1] ?? 1);
      const tInterval = /\binterval=["']([^"']+)["']/i.exec(tAttrs)?.[1];
      tasks.push({ name: tName, priority: tPrio, interval: tInterval });
    }

    return {
      contentHeader: { name: contentName },
      pous: [
        {
          name: pouName,
          pouType,
          variables,
          body: {
            kind: "ST",
            st: { statements, rawSource: rawStXml },
          },
        },
      ],
      configurations:
        tasks.length > 0 ? [{ name: "Config0", resources: [{ name: "Res0", tasks, instances: [] }] }] : undefined,
    };
  }

  // 2. IEC 61131-3 Structured Text (.st) format
  const pouHdr = /\b(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(source);
  const rawKind = (pouHdr?.[1] || "PROGRAM").toUpperCase();
  const pouType = rawKind === "FUNCTION_BLOCK" ? "functionBlock" : rawKind === "FUNCTION" ? "function" : "program";
  const pouName = pouHdr?.[2] || fallbackTitle.replace(/\.[a-z0-9]+$/i, "");

  const variables: PlcVariableLike[] = [];
  const varBlockRe = /\b(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP|VAR_GLOBAL|VAR)\b([\s\S]*?)\bEND_VAR\b/gi;
  let vbm: RegExpExecArray | null;
  let lastVarBlockEnd = pouHdr ? pouHdr.index + pouHdr[0].length : 0;

  while ((vbm = varBlockRe.exec(source)) !== null) {
    lastVarBlockEnd = Math.max(lastVarBlockEnd, vbm.index + vbm[0].length);
    const kindUpper = vbm[1]!.toUpperCase();
    const scope: PlcVariableLike["scope"] =
      kindUpper === "VAR_INPUT"
        ? "input"
        : kindUpper === "VAR_OUTPUT"
          ? "output"
          : kindUpper === "VAR_IN_OUT"
            ? "inOut"
            : kindUpper === "VAR_TEMP"
              ? "temp"
              : kindUpper === "VAR_GLOBAL"
                ? "global"
                : "local";
    const blockBody = stripStComments(vbm[2] || "");
    const declRe = /([A-Za-z_][A-Za-z0-9_,\s]*?)\s*(?:AT\s+(%[IQM][A-Za-z0-9.]*)\s*)?:\s*([A-Za-z_][A-Za-z0-9_]*)/g;
    let dm: RegExpExecArray | null;
    while ((dm = declRe.exec(blockBody)) !== null) {
      const names = dm[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const addr = dm[2];
      const dt = dm[3]!;
      for (const n of names) {
        if (/^(CONSTANT|RETAIN|NON_RETAIN)$/i.test(n)) continue;
        variables.push({ name: n, scope, dataType: dt, address: addr });
      }
    }
  }

  const bodyAfterVars = source
    .slice(lastVarBlockEnd)
    .replace(/\bEND_(?:PROGRAM|FUNCTION_BLOCK|FUNCTION)\b[\s\S]*$/i, "");
  const statements = parseSimpleStatements(bodyAfterVars);

  return {
    contentHeader: { name: pouName },
    pous: [
      {
        name: pouName,
        pouType,
        variables,
        body: {
          kind: "ST",
          st: { statements, rawSource: bodyAfterVars },
        },
      },
    ],
  };
}
