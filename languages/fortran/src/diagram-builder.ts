// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CstDiagramNodeLike {
  type: string;
  text: string;
  isNamed?: boolean | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
  startPosition?: { row: number; column: number } | undefined;
  children?: readonly CstDiagramNodeLike[] | undefined;
  namedChildren?: readonly CstDiagramNodeLike[] | undefined;
  parent?: CstDiagramNodeLike | null | undefined;
}

type CstNodeLike = CstDiagramNodeLike;

export type StyledNodeFn = (opts: {
  id: string;
  name: string;
  kind: string;
  stereotype: string;
  subtitle?: string | undefined;
  entries?: string[] | undefined;
  stroke: string;
  fill: string;
  headerFill?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
}) => unknown;

export type StyledEdgeFn = (
  id: string,
  source: string,
  target: string,
  dashed?: boolean,
  labelText?: string,
) => unknown;

function getCstChildren(node: CstNodeLike | null | undefined): readonly CstNodeLike[] {
  return Array.isArray(node?.children) ? node.children : [];
}

function findCstChild(node: CstNodeLike | null | undefined, type: string): CstNodeLike | undefined {
  return getCstChildren(node).find((c) => c.type === type);
}

function findFirstDescendant(node: CstNodeLike | null | undefined, type: string): CstNodeLike | null {
  for (const child of getCstChildren(node)) {
    if (child.type === type) return child;
    const found = findFirstDescendant(child, type);
    if (found) return found;
  }
  return null;
}

function stripWhitespace(s: string): string {
  return s.replace(/\s+/g, "");
}

function isWordCharCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function maskFortranFixedCommentsAndPreprocessor(source: string): string {
  const chars = source.split("");
  let lineStart = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === "\n") {
      const lineEnd = i > lineStart && source[i - 1] === "\r" ? i - 1 : i;
      const lineLen = lineEnd - lineStart;
      if (lineLen > 0) {
        const ch0 = source[lineStart]!;
        const ch1 = lineLen > 1 ? source[lineStart + 1]! : " ";
        const isFixedComment =
          (ch0 === "C" || ch0 === "c" || ch0 === "*") && (ch1 === " " || ch1 === "\t" || ch1 === "*" || lineLen === 1);
        let firstNonWs = lineStart;
        while (firstNonWs < lineEnd && (source[firstNonWs] === " " || source[firstNonWs] === "\t")) {
          firstNonWs++;
        }
        const isPreprocessor = firstNonWs < lineEnd && source[firstNonWs] === "#";
        if (isFixedComment || isPreprocessor) {
          for (let j = lineStart; j < lineEnd; j++) chars[j] = " ";
        }
      }
      lineStart = i + 1;
    }
  }
  return chars.join("");
}

export function buildFortranDiagramFromCst(
  rootNode: CstNodeLike,
  makeStyledNode: StyledNodeFn,
  makeStyledEdge: StyledEdgeFn,
  nodes: unknown[],
  edges: unknown[],
): void {
  interface FortranUnitSummary {
    node: CstNodeLike;
    name: string;
    kind: string;
    params: string[];
    intents: Map<string, string>;
  }

  const unitKindByNodeType: Record<string, string> = {
    SubroutineDeclaration: "subroutine",
    FunctionDeclaration: "function",
    ProgramDeclaration: "program",
    ModuleDeclaration: "module",
  };

  const unitSummaries = new Map<string, FortranUnitSummary>();
  let primaryUnitUpper: string | null = null;
  let primaryRoutineUpper: string | null = null;

  const normalizeWhitespace = (s: string): string => collapseWhitespace(s);

  const extractSubscriptDims = (listNode: CstNodeLike | null | undefined): string => {
    if (!listNode) return "";
    const parts: string[] = [];
    for (const c of getCstChildren(listNode)) {
      if (c.type === "SubscriptItem" || c.type === "Expression" || c.isNamed) {
        const t = c.text?.trim();
        if (t && c.type !== "," && c.type !== "(" && c.type !== ")") parts.push(t);
      }
    }
    return parts.length > 0 ? `[${parts.join("×")}]` : "";
  };

  const unwrapFortranStmt = (node: CstNodeLike | null | undefined): CstNodeLike | null => {
    if (!node) return null;
    if (node.type === "Statement" || node.type === "ProgramUnit") {
      return getCstChildren(node).find((c) => c.isNamed) ?? null;
    }
    return node;
  };

  const collectUnitIntents = (unitNode: CstNodeLike): Map<string, string> => {
    const intents = new Map<string, string>();
    for (const child of getCstChildren(unitNode)) {
      const stmt = unwrapFortranStmt(child);
      if (stmt?.type !== "DeclarationStatement") continue;
      let intent: string | null = null;
      for (const sub of getCstChildren(stmt)) {
        if (sub.type === "AttributeSpec") {
          const specNode = findCstChild(sub, "INTENT_SPEC");
          if (specNode) {
            intent = stripWhitespace(specNode.text.toLowerCase());
          }
        }
      }
      if (!intent) continue;
      const declList = findCstChild(stmt, "DeclaratorList");
      for (const decl of getCstChildren(declList)) {
        if (decl.type !== "Declarator") continue;
        const idNode = findCstChild(decl, "IDENTIFIER");
        if (idNode) intents.set(idNode.text.trim().toLowerCase(), intent);
      }
    }
    return intents;
  };

  const collectUnits = (node: CstNodeLike): void => {
    for (const child of getCstChildren(node)) {
      const inner = unwrapFortranStmt(child);
      if (!inner) continue;
      const kind = unitKindByNodeType[inner.type];
      if (kind) {
        const name = findCstChild(inner, "IDENTIFIER")?.text?.trim();
        if (name) {
          const paramList = findCstChild(inner, "ParameterList");
          const params = getCstChildren(paramList)
            .filter((c) => c.type === "IDENTIFIER")
            .map((c) => c.text.trim());
          const summary: FortranUnitSummary = {
            node: inner,
            name,
            kind,
            params,
            intents: collectUnitIntents(inner),
          };
          const upper = name.toUpperCase();
          unitSummaries.set(upper, summary);
          if (kind === "program" || !primaryUnitUpper) {
            primaryUnitUpper = upper;
          }
          if (kind !== "module" && (!primaryRoutineUpper || kind === "program")) {
            primaryRoutineUpper = upper;
          }
        }
        if (inner.type === "ModuleDeclaration") {
          collectUnits(inner);
        }
      } else if (inner.type === "ProgramUnit") {
        collectUnits(inner);
      }
    }
  };

  collectUnits(rootNode);

  const selectedUpper = primaryRoutineUpper ?? primaryUnitUpper;
  const primaryUnit = selectedUpper ? unitSummaries.get(selectedUpper) : undefined;

  const routineName = primaryUnit?.name ?? "fortran_kernel";
  const routineKind = primaryUnit?.kind ?? "subroutine";
  const dummyArgs = primaryUnit?.params ? [...primaryUnit.params] : [];

  const inputVars = new Map<string, string>();
  const outputVars = new Map<string, string>();
  const varTypes = new Map<string, string>();
  const constants = new Map<string, { name: string; value: string }>();
  const equations: {
    id: string;
    lhs: string;
    lhsBase: string;
    rhs: string;
    rhsRefs: string[];
    isState: boolean;
    lineIdx: number;
    condGuard?: string | undefined;
  }[] = [];
  const callBlocks: {
    id: string;
    subroutine: string;
    args: string[];
    argIdentNames: (string | null)[];
    lineIdx: number;
  }[] = [];

  const guardStack: string[] = [];

  const sanitizeId = (s: string): string => {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      out += isWordCharCode(code) ? s[i]! : "_";
    }
    return out;
  };

  const collectRefs = (node: CstNodeLike | null | undefined, outRefs: string[], discoveredPorts: string[]): void => {
    if (!node) return;
    if (node.type === "PORT_IDENTIFIER") {
      const pName = node.text.trim().slice(1);
      if (pName) {
        discoveredPorts.push(pName);
        outRefs.push(pName);
      }
      return;
    }
    if (node.type === "IDENTIFIER") {
      const idText = node.text.trim();
      if (idText) outRefs.push(idText);
      return;
    }
    for (const c of getCstChildren(node)) {
      collectRefs(c, outRefs, discoveredPorts);
    }
  };

  const unwrapSingleArgIdent = (subItem: CstNodeLike | null | undefined): string | null => {
    let cur = subItem;
    while (cur) {
      if (cur.type === "IDENTIFIER") return cur.text.trim();
      if (cur.type === "PORT_IDENTIFIER") return cur.text.trim().slice(1);
      if (cur.type === "StateRef") return findCstChild(cur, "STATE_ARRAY")?.text?.trim() ?? null;
      const named = getCstChildren(cur).filter((c) => c.isNamed);
      if (named.length !== 1) return null;
      cur = named[0]!;
    }
    return null;
  };

  const extractTargetInfo = (targetNode: CstNodeLike): { baseName: string; isState: boolean; portName?: string } => {
    const stateRef = findCstChild(targetNode, "StateRef");
    if (stateRef) {
      const arr = findCstChild(stateRef, "STATE_ARRAY")?.text?.trim() ?? "STORF";
      return { baseName: arr, isState: true };
    }
    const portRef = findCstChild(targetNode, "PortRef");
    if (portRef) {
      const pIdent = findCstChild(portRef, "PORT_IDENTIFIER")?.text?.trim() ?? "";
      const pName = pIdent.startsWith("$") ? pIdent.slice(1) : pIdent;
      return { baseName: pName, isState: false, portName: pName };
    }
    const portIdent = findCstChild(targetNode, "PORT_IDENTIFIER");
    if (portIdent) {
      const pText = portIdent.text.trim();
      const pName = pText.startsWith("$") ? pText.slice(1) : pText;
      return { baseName: pName, isState: false, portName: pName };
    }
    const arrOrCall = findCstChild(targetNode, "ArrayOrCallRef");
    if (arrOrCall) {
      const id = findCstChild(arrOrCall, "IDENTIFIER")?.text?.trim() ?? "";
      const upper = id.toUpperCase();
      return {
        baseName: id,
        isState: upper === "STORF" || upper === "STORI" || upper === "SD" || upper === "S" || upper.startsWith("DER_"),
      };
    }
    const idNode = findFirstDescendant(targetNode, "IDENTIFIER");
    const idText = idNode?.text?.trim() ?? targetNode.text.trim();
    const lower = idText.toLowerCase();
    return {
      baseName: idText,
      isState: lower.startsWith("der_") || lower === "storf" || lower === "stori",
    };
  };

  const visitStmt = (rawNode: CstNodeLike): void => {
    const stmt = unwrapFortranStmt(rawNode);
    if (!stmt || stmt.type === "ERROR") return;
    if (unitKindByNodeType[stmt.type]) return;

    if (stmt.type === "DeclarationStatement") {
      const children = getCstChildren(stmt);
      const typeSpec = findCstChild(stmt, "TYPE_SPECIFIER");
      let baseType = typeSpec ? normalizeWhitespace(typeSpec.text.toUpperCase()) : "REAL";
      // Check optional kind specification e.g. real(8) right before AttributeSpec/"::"/"DeclaratorList"
      const typeIdx = typeSpec ? children.indexOf(typeSpec) : -1;
      if (typeIdx !== -1 && children[typeIdx + 1]?.text === "(" && children[typeIdx + 2]?.type === "Expression") {
        baseType = `${baseType}(${children[typeIdx + 2]!.text.trim()})`;
      }

      let intent: string | null = null;
      let attrDimStr = "";
      let isParamAttr = false;
      for (const c of children) {
        if (c.type !== "AttributeSpec") continue;
        const spec = findCstChild(c, "INTENT_SPEC");
        if (spec) intent = stripWhitespace(spec.text.toLowerCase());
        const dimList = findCstChild(c, "DimensionList");
        if (dimList) attrDimStr = extractSubscriptDims(dimList);
        if (findCstChild(c, "PARAMETER_KEYWORD")) isParamAttr = true;
      }

      const declList = findCstChild(stmt, "DeclaratorList");
      for (const decl of getCstChildren(declList)) {
        if (decl.type !== "Declarator") continue;
        const vName = findCstChild(decl, "IDENTIFIER")?.text?.trim();
        if (!vName) continue;
        const lower = vName.toLowerCase();
        const dimNode = findCstChild(decl, "DimensionList") ?? findCstChild(decl, "ArgumentList");
        const inlineDim = dimNode ? extractSubscriptDims(dimNode) : attrDimStr;
        const eqTok = getCstChildren(decl).find((c) => c.text === "=");
        const initExpr = eqTok ? findCstChild(decl, "Expression") : null;
        const initVal = initExpr ? initExpr.text.trim() : undefined;
        varTypes.set(lower, inlineDim ? `${baseType} ${inlineDim}` : baseType);
        if (intent === "in") {
          inputVars.set(lower, vName);
        } else if (intent === "out") {
          outputVars.set(lower, vName);
        } else if (intent === "inout") {
          inputVars.set(lower, vName);
          outputVars.set(lower, vName);
        } else if ((initVal !== undefined || isParamAttr) && initVal !== undefined) {
          constants.set(lower, { name: vName, value: initVal });
        }
      }
      return;
    }

    if (stmt.type === "ParameterStatement") {
      const assignList = findCstChild(stmt, "ParameterAssignmentList");
      for (const pa of getCstChildren(assignList)) {
        if (pa.type !== "ParameterAssignment") continue;
        const pName = findCstChild(pa, "IDENTIFIER")?.text?.trim();
        const pExpr = findCstChild(pa, "Expression");
        if (pName && pExpr) {
          constants.set(pName.toLowerCase(), { name: pName, value: pExpr.text.trim() });
        }
      }
      return;
    }

    if (stmt.type === "BlockIfStatement") {
      const condExpr = findCstChild(stmt, "Expression");
      const condLabel = `IF (${condExpr?.text?.trim() ?? "..."})`;
      guardStack.push(condLabel);
      for (const c of getCstChildren(stmt)) {
        if (c.type === "Statement") {
          visitStmt(c);
        }
      }
      guardStack.pop();

      for (const c of getCstChildren(stmt)) {
        if (c.type === "ElseIfClause") {
          const eCond = findCstChild(c, "Expression");
          guardStack.push(`ELSE IF (${eCond?.text?.trim() ?? "..."})`);
          for (const sub of getCstChildren(c)) {
            if (sub.type === "Statement") visitStmt(sub);
          }
          guardStack.pop();
        } else if (c.type === "ElseClause") {
          guardStack.push(`ELSE [${condLabel}]`);
          for (const sub of getCstChildren(c)) {
            if (sub.type === "Statement") visitStmt(sub);
          }
          guardStack.pop();
        }
      }
      return;
    }

    if (stmt.type === "InlineIfStatement") {
      const condExpr = findCstChild(stmt, "Expression");
      guardStack.push(`IF (${condExpr?.text?.trim() ?? "..."})`);
      for (const c of getCstChildren(stmt)) {
        if (c.type === "Statement") visitStmt(c);
      }
      guardStack.pop();
      return;
    }

    if (stmt.type === "DoStatement") {
      const loopVar = findCstChild(stmt, "IDENTIFIER")?.text?.trim();
      const exprs = getCstChildren(stmt)
        .filter((c) => c.type === "Expression")
        .map((c) => c.text.trim());
      const doGuard = loopVar ? `DO ${loopVar} = ${exprs.join(", ")}` : `DO ${exprs.join(", ") || "LOOP"}`;
      guardStack.push(doGuard);
      for (const c of getCstChildren(stmt)) {
        if (c.type === "Statement") visitStmt(c);
      }
      guardStack.pop();
      return;
    }

    if (stmt.type === "CallStatement") {
      const subName = findCstChild(stmt, "IDENTIFIER")?.text?.trim();
      if (!subName) return;
      const argList = findCstChild(stmt, "ArgumentList");
      const args: string[] = [];
      const argIdentNames: (string | null)[] = [];
      for (const arg of getCstChildren(argList)) {
        if (!arg.isNamed || arg.type === "," || arg.type === "(" || arg.type === ")") continue;
        args.push(arg.text.trim());
        argIdentNames.push(unwrapSingleArgIdent(arg));
      }
      const lineIdx = stmt.startPosition?.row ?? 0;
      callBlocks.push({
        id: `call_${lineIdx}_${subName}`,
        subroutine: subName,
        args,
        argIdentNames,
        lineIdx,
      });
      return;
    }

    if (stmt.type === "AssignmentStatement") {
      const targetNode = findCstChild(stmt, "Target");
      const valueNode = findCstChild(stmt, "Expression");
      if (!targetNode || !valueNode) return;
      const lhs = targetNode.text.trim();
      const rhs = valueNode.text.trim();
      const lineIdx = stmt.startPosition?.row ?? 0;
      const tInfo = extractTargetInfo(targetNode);
      if (tInfo.portName) {
        outputVars.set(tInfo.portName.toLowerCase(), tInfo.portName);
      }
      const rhsRefs: string[] = [];
      const discoveredPorts: string[] = [];
      collectRefs(valueNode, rhsRefs, discoveredPorts);
      for (const pName of discoveredPorts) {
        const lower = pName.toLowerCase();
        if (!outputVars.has(lower)) {
          inputVars.set(lower, pName);
        }
      }
      equations.push({
        id: `eq_${lineIdx}_${sanitizeId(lhs)}`,
        lhs,
        lhsBase: tInfo.baseName,
        rhs,
        rhsRefs,
        isState: tInfo.isState,
        lineIdx,
        condGuard: guardStack.length > 0 ? guardStack[guardStack.length - 1] : undefined,
      });
    }
  };

  const stmtRoot = primaryUnit ? primaryUnit.node : rootNode;
  for (const child of getCstChildren(stmtRoot)) {
    visitStmt(child);
  }

  const assignedLowers = new Set(equations.map((e) => e.lhsBase.toLowerCase()));
  for (const arg of dummyArgs) {
    const lower = arg.toLowerCase();
    if (!inputVars.has(lower) && !outputVars.has(lower)) {
      if (assignedLowers.has(lower)) outputVars.set(lower, arg);
      else inputVars.set(lower, arg);
    }
  }

  const producerByVar = new Map<string, string>();
  let leftRow = 0;
  for (const [lower, dispName] of inputVars.entries()) {
    const nodeId = `in_${lower}`;
    const tStr = varTypes.get(lower) ?? "REAL(8)";
    nodes.push(
      makeStyledNode({
        id: nodeId,
        name: dispName,
        kind: "InputPort",
        stereotype: "intent(in)",
        subtitle: `${tStr} Input`,
        stroke: "#0d9488",
        fill: "#f0fdfa",
        headerFill: "#ccfbf1",
        x: 60,
        y: 70 + leftRow * 110,
      }),
    );
    producerByVar.set(lower, nodeId);
    leftRow++;
  }

  for (const [lower, cInfo] of constants.entries()) {
    const nodeId = `const_${lower}`;
    const tStr = varTypes.get(lower) ?? "REAL(8)";
    nodes.push(
      makeStyledNode({
        id: nodeId,
        name: cInfo.name,
        kind: "Constant",
        stereotype: "constant",
        subtitle: `${tStr} = ${cInfo.value}`,
        stroke: "#4f46e5",
        fill: "#eef2ff",
        headerFill: "#e0e7ff",
        x: 60,
        y: 70 + leftRow * 110,
      }),
    );
    producerByVar.set(lower, nodeId);
    leftRow++;
  }

  let centerRow = 0;
  const intrinsicSet = new Set([
    "sqrt",
    "abs",
    "sin",
    "cos",
    "tan",
    "asin",
    "acos",
    "atan",
    "atan2",
    "exp",
    "log",
    "log10",
    "min",
    "max",
    "mod",
    "sign",
    "sum",
    "maxval",
    "minval",
    "size",
    "dot_product",
    "matmul",
    "storf",
    "stori",
    "sd",
    "s",
  ]);

  const flowSteps = [
    ...equations.map((eq) => ({ kind: "eq" as const, lineIdx: eq.lineIdx, eq })),
    ...callBlocks.map((callBlk) => ({ kind: "call" as const, lineIdx: callBlk.lineIdx, callBlk })),
  ].sort((a, b) => a.lineIdx - b.lineIdx);

  for (const step of flowSteps) {
    if (step.kind === "eq") {
      const { eq } = step;
      const lowerLhs = eq.lhsBase.toLowerCase();
      const isOutputTarget = outputVars.has(lowerLhs);
      const entries = [`${eq.lhs} = ${eq.rhs}`];
      if (eq.condGuard) {
        entries.unshift(`[Guard] ${eq.condGuard}`);
      }
      nodes.push(
        makeStyledNode({
          id: eq.id,
          name: eq.lhs,
          kind: eq.isState ? "StateEquation" : "Equation",
          stereotype: eq.isState ? "state derivative" : isOutputTarget ? "output equation" : "algebraic block",
          subtitle: `${routineName} · line ${eq.lineIdx + 1}`,
          entries,
          stroke: eq.isState ? "#e11d48" : "#0284c7",
          fill: eq.isState ? "#fff1f2" : "#f0f9ff",
          headerFill: eq.isState ? "#ffe4e6" : "#e0f2fe",
          x: 390,
          y: 70 + centerRow * 135,
        }),
      );
      centerRow++;

      const connectedSources = new Set<string>();
      for (const refIdent of eq.rhsRefs) {
        const refLower = refIdent.toLowerCase();
        if (intrinsicSet.has(refLower)) continue;
        const srcNodeId = producerByVar.get(refLower);
        if (srcNodeId && srcNodeId !== eq.id && !connectedSources.has(srcNodeId)) {
          connectedSources.add(srcNodeId);
          edges.push(
            makeStyledEdge(`edge_${srcNodeId}_${eq.id}`, srcNodeId, eq.id, srcNodeId.startsWith("const_"), refIdent),
          );
        }
      }
      producerByVar.set(lowerLhs, eq.id);
    } else {
      const { callBlk } = step;
      const subUpper = callBlk.subroutine.toUpperCase();
      const calleeSummary = unitSummaries.get(subUpper);
      const callEntries: string[] = [];
      if (calleeSummary) {
        const inParams = calleeSummary.params.filter(
          (p) => (calleeSummary.intents.get(p.toLowerCase()) ?? "in") !== "out",
        );
        const outParams = calleeSummary.params.filter((p) => {
          const intent = calleeSummary.intents.get(p.toLowerCase());
          return intent === "out" || intent === "inout";
        });
        callEntries.push(`${inParams.join(", ") || "()"} → ${outParams.join(", ") || "void"}`);
      }

      nodes.push(
        makeStyledNode({
          id: callBlk.id,
          name: `CALL ${callBlk.subroutine}`,
          kind: "SubroutineCall",
          stereotype: calleeSummary ? "module subroutine" : "subroutine call",
          subtitle: `(${callBlk.args.join(", ")})`,
          entries: callEntries.length > 0 ? callEntries : undefined,
          stroke: "#7c3aed",
          fill: "#f5f3ff",
          headerFill: "#ede9fe",
          x: 390,
          y: 70 + centerRow * 135,
        }),
      );
      centerRow++;

      const defaultOutIdx =
        ["REALPOLE", "DELAY1", "INTGRL", "LEADLAG", "DIFF", "LIMITER", "LIMIT", "HARDLIMIT"].includes(subUpper) &&
        callBlk.args.length >= 2
          ? callBlk.args.length - 1
          : -1;

      callBlk.argIdentNames.forEach((vName, idx) => {
        if (!vName) return;
        const vLower = vName.toLowerCase();

        let isOutArg = idx === defaultOutIdx;
        let isInArg = idx !== defaultOutIdx;
        if (calleeSummary && calleeSummary.params[idx]) {
          const formalIntent = calleeSummary.intents.get(calleeSummary.params[idx]!.toLowerCase());
          if (formalIntent === "out") {
            isOutArg = true;
            isInArg = false;
          } else if (formalIntent === "inout") {
            isOutArg = true;
            isInArg = true;
          } else if (formalIntent === "in") {
            isOutArg = false;
            isInArg = true;
          }
        }

        if (isInArg) {
          const srcId = producerByVar.get(vLower);
          if (srcId) {
            edges.push(makeStyledEdge(`edge_${srcId}_${callBlk.id}`, srcId, callBlk.id, false, vName));
          }
        }
        if (isOutArg) {
          producerByVar.set(vLower, callBlk.id);
        }
      });
    }
  }

  let rightRow = 0;
  for (const [lower, dispName] of outputVars.entries()) {
    const outNodeId = `out_${lower}`;
    const tStr = varTypes.get(lower) ?? "REAL(8)";
    nodes.push(
      makeStyledNode({
        id: outNodeId,
        name: dispName,
        kind: "OutputPort",
        stereotype: "intent(out)",
        subtitle: `${tStr} Output`,
        stroke: "#d97706",
        fill: "#fffbeb",
        headerFill: "#fef3c7",
        x: 780,
        y: 70 + rightRow * 120,
      }),
    );
    rightRow++;

    const srcId = producerByVar.get(lower);
    if (srcId && srcId !== outNodeId) {
      edges.push(makeStyledEdge(`edge_${srcId}_${outNodeId}`, srcId, outNodeId, false, dispName));
    }
  }

  if (nodes.length === 0 && primaryUnit) {
    nodes.push(
      makeStyledNode({
        id: `sub_${routineName}`,
        name: routineName,
        kind: "Subroutine",
        stereotype: routineKind,
        subtitle: dummyArgs.length > 0 ? `(${dummyArgs.join(", ")})` : "()",
        stroke: "#0284c7",
        fill: "#f0f9ff",
        headerFill: "#e0f2fe",
        x: 120,
        y: 80,
      }),
    );
  }
}
