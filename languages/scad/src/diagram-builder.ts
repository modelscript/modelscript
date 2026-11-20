// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CstDiagramNodeLike {
  type: string;
  text: string;
  isNamed?: boolean | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
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

function unquoteCstString(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    let out = "";
    for (let i = 1; i < s.length - 1; i++) {
      if (s[i] === "\\" && i + 1 < s.length - 1) {
        const next = s[i + 1]!;
        if (next === '"' || next === "'" || next === "\\") {
          out += next;
          i++;
          continue;
        }
      }
      out += s[i]!;
    }
    return out;
  }
  return s;
}

export function buildScadDiagramFromCst(
  rootNode: CstNodeLike,
  makeStyledNode: StyledNodeFn,
  makeStyledEdge: StyledEdgeFn,
  nodes: unknown[],
  edges: unknown[],
): void {
  const paramEntries: string[] = [];
  const moduleNodeIds = new Map<string, string>();
  const topModuleCalls = new Map<string, string[]>();
  let nodeCounter = 0;

  const unwrapStmt = (node: CstNodeLike | null | undefined): CstNodeLike | null => {
    if (!node) return null;
    if (node.type === "Statement") {
      return getCstChildren(node).find((c) => c.isNamed) ?? null;
    }
    return node;
  };

  for (const rawChild of getCstChildren(rootNode)) {
    const inner = unwrapStmt(rawChild);
    if (inner?.type === "ModuleDeclaration") {
      const modName = findCstChild(inner, "IDENTIFIER")?.text?.trim();
      if (modName) {
        moduleNodeIds.set(modName, `module_${modName}`);
      }
    }
  }

  const visitScadNode = (rawNode: CstNodeLike | null | undefined, parentId: string | null): void => {
    const node = unwrapStmt(rawNode);
    if (!node) return;

    if (
      node.type === "BlockStatement" ||
      node.type === "IfStatement" ||
      node.type === "ForStatement" ||
      node.type === "IntersectionForStatement"
    ) {
      for (const child of getCstChildren(node)) {
        if (child.type === "Statement" || child.type === "BlockStatement") {
          visitScadNode(child, parentId);
        }
      }
      return;
    }

    if (node.type === "ModuleDeclaration") {
      const modName = findCstChild(node, "IDENTIFIER")?.text?.trim();
      if (!modName) return;
      const paramList = findCstChild(node, "ParameterList");
      const modParams = paramList ? paramList.text.trim() : "";
      const nodeId = moduleNodeIds.get(modName) ?? `module_${modName}`;
      moduleNodeIds.set(modName, nodeId);
      nodes.push(
        makeStyledNode({
          id: nodeId,
          name: modName,
          kind: "Module",
          stereotype: "csg module",
          subtitle: modParams ? `(${modParams})` : "()",
          stroke: "#0d9488",
          fill: "#f0fdfa",
        }),
      );
      for (const child of getCstChildren(node)) {
        if (child.type === "Statement" || child.type === "BlockStatement") {
          visitScadNode(child, nodeId);
        }
      }
      return;
    }

    if (node.type === "PrefixSolid") {
      const children = getCstChildren(node);
      const opNode = children.find(
        (c) =>
          c.type === "TagPortOp" || c.type === "BooleanOp" || c.type === "TransformOp" || c.type === "LinearExtrudeOp",
      );
      const bodyNodes = children.filter((c) => c !== opNode && c.isNamed);
      let nextParentId = parentId;

      if (opNode?.type === "TagPortOp") {
        const argList = findCstChild(opNode, "ArgumentList");
        const positionalStrings: string[] = [];
        let namedPortName: string | undefined;
        let namedPortType: string | undefined;
        for (const arg of getCstChildren(argList)) {
          if (arg.type !== "Argument") continue;
          const hasEq = getCstChildren(arg).some((c) => c.text === "=");
          const keyName = hasEq ? findCstChild(arg, "IDENTIFIER")?.text?.trim().toLowerCase() : undefined;
          const strNode = findFirstDescendant(arg, "STRING");
          if (!strNode) continue;
          const val = unquoteCstString(strNode.text);
          if (keyName === "name" || keyName === "port") namedPortName = val;
          else if (keyName === "type" || keyName === "kind") namedPortType = val;
          else if (!keyName) positionalStrings.push(val);
        }
        const portName = namedPortName ?? positionalStrings[0];
        if (portName) {
          const portType = namedPortType ?? positionalStrings[1] ?? "port";
          const nodeId = `port_${++nodeCounter}_${portName}`;
          nodes.push(
            makeStyledNode({
              id: nodeId,
              name: portName,
              kind: "Port",
              stereotype: `port: ${portType}`,
              subtitle: `tag_port("${portName}", "${portType}")`,
              stroke: "#d97706",
              fill: "#fffbeb",
            }),
          );
          if (parentId) {
            edges.push(makeStyledEdge(`edge_${parentId}_${nodeId}`, parentId, nodeId));
          }
          nextParentId = nodeId;
        }
      } else if (opNode?.type === "BooleanOp") {
        const opName = getCstChildren(opNode)[0]?.text?.trim() || "boolean";
        const nodeId = `bool_${++nodeCounter}_${opName}`;
        nodes.push(
          makeStyledNode({
            id: nodeId,
            name: `${opName}()`,
            kind: "BooleanOp",
            stereotype: "csg boolean",
            stroke: "#7c3aed",
            fill: "#f5f3ff",
          }),
        );
        if (parentId) {
          edges.push(makeStyledEdge(`edge_${parentId}_${nodeId}`, parentId, nodeId));
        }
        nextParentId = nodeId;
      } else if (opNode?.type === "TransformOp" || opNode?.type === "LinearExtrudeOp") {
        const tfName = getCstChildren(opNode)[0]?.text?.trim() || "transform";
        const tfArgs = findCstChild(opNode, "ArgumentList")?.text?.trim() ?? "";
        const nodeId = `tf_${++nodeCounter}_${tfName}`;
        nodes.push(
          makeStyledNode({
            id: nodeId,
            name: tfName,
            kind: "Transform",
            stereotype: "transform",
            subtitle: tfArgs,
            stroke: "#0284c7",
            fill: "#f0f9ff",
          }),
        );
        if (parentId) {
          edges.push(makeStyledEdge(`edge_${parentId}_${nodeId}`, parentId, nodeId));
        }
        nextParentId = nodeId;
      }

      for (const body of bodyNodes) {
        visitScadNode(body, nextParentId);
      }
      return;
    }

    if (node.type === "ChainedSolidStatement") {
      const chained = findCstChild(node, "ChainedSolid");
      if (chained) visitScadNode(chained, parentId);
      return;
    }

    if (node.type === "ChainedSolid") {
      const primary = findCstChild(node, "PrimarySolid");
      if (primary) visitScadNode(primary, parentId);
      return;
    }

    if (node.type === "PrimarySolid") {
      const target = getCstChildren(node).find((c) => c.isNamed);
      if (target) visitScadNode(target, parentId);
      return;
    }

    if (
      node.type === "CubePrimitive" ||
      node.type === "CylinderPrimitive" ||
      node.type === "SpherePrimitive" ||
      node.type === "PolyhedronPrimitive" ||
      node.type === "PolygonPrimitive" ||
      node.type === "CirclePrimitive" ||
      node.type === "SquarePrimitive"
    ) {
      const primName = getCstChildren(node)[0]?.text?.trim() ?? "primitive";
      const argList = findCstChild(node, "ArgumentList");
      const keptArgs: string[] = [];
      for (const arg of getCstChildren(argList)) {
        if (arg.type !== "Argument") continue;
        const hasEq = getCstChildren(arg).some((c) => c.text === "=");
        const keyName = hasEq ? findCstChild(arg, "IDENTIFIER")?.text?.trim() : undefined;
        if (keyName === "center") continue;
        keptArgs.push(arg.text.trim());
      }
      const nodeId = `prim_${++nodeCounter}_${primName}`;
      nodes.push(
        makeStyledNode({
          id: nodeId,
          name: primName,
          kind: "Primitive",
          stereotype: "3d solid",
          subtitle: keptArgs.join(", "),
          stroke: "#059669",
          fill: "#ecfdf5",
        }),
      );
      if (parentId) {
        edges.push(makeStyledEdge(`edge_${parentId}_${nodeId}`, parentId, nodeId));
      }
      return;
    }

    if (node.type === "ModuleInstantiation") {
      const callee = findCstChild(node, "IDENTIFIER")?.text?.trim();
      if (!callee) return;
      const callArgs = findCstChild(node, "ArgumentList")?.text?.trim() ?? "";
      if (!parentId) {
        const list = topModuleCalls.get(callee) ?? [];
        list.push(callArgs || "default");
        topModuleCalls.set(callee, list);
      } else {
        const targetModId = moduleNodeIds.get(callee);
        if (targetModId) {
          edges.push(
            makeStyledEdge(
              `edge_call_${++nodeCounter}_${parentId}_${targetModId}`,
              parentId,
              targetModId,
              true,
              "instantiate",
            ),
          );
        } else {
          const callId = `call_${++nodeCounter}_${callee}`;
          nodes.push(
            makeStyledNode({
              id: callId,
              name: `${callee}(${callArgs})`,
              kind: "ModuleCall",
              stereotype: "instance",
              stroke: "#0d9488",
              fill: "#f0fdfa",
            }),
          );
          edges.push(makeStyledEdge(`edge_${parentId}_${callId}`, parentId, callId));
        }
      }
    }
  };

  for (const rawChild of getCstChildren(rootNode)) {
    const inner = unwrapStmt(rawChild);
    if (!inner) continue;
    if (inner.type === "VariableDeclaration") {
      const varName = findCstChild(inner, "IDENTIFIER")?.text?.trim();
      const exprNode = findCstChild(inner, "Expression");
      if (varName && exprNode) {
        paramEntries.push(`${varName} = ${exprNode.text.trim()}`);
      }
      continue;
    }
    visitScadNode(inner, null);
  }

  for (const [callee, argList] of topModuleCalls) {
    const instId = `inst_${callee}`;
    const summary =
      argList.length > 1 ? `${argList.length}× instances (${argList.join(", ")})` : `(${argList[0] ?? ""})`;
    nodes.push(
      makeStyledNode({
        id: instId,
        name: `${callee} Assembly`,
        kind: "AssemblyInstance",
        stereotype: argList.length > 1 ? `csg pattern (${argList.length}×)` : "csg instance",
        subtitle: summary,
        stroke: "#0d9488",
        fill: "#ccfbf1",
      }),
    );
    const targetModId = moduleNodeIds.get(callee);
    if (targetModId) {
      edges.push(makeStyledEdge(`edge_${instId}_${targetModId}`, instId, targetModId, true, "instantiates"));
    }
  }

  if (paramEntries.length > 0) {
    nodes.unshift(
      makeStyledNode({
        id: "scad_parameters",
        name: "Design Parameters",
        kind: "Parameters",
        stereotype: "parameters",
        entries: paramEntries,
        stroke: "#4f46e5",
        fill: "#eef2ff",
        headerFill: "#e0e7ff",
      }),
    );
  }
}
