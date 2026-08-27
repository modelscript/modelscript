// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CodeGraph, i32, u16, u32 } from "@modelscript/language";

/**
 * Recursively lowers an AST expression into the WASM DAE expression arena.
 */
function lowerExpression(graph: CodeGraph, node: u32, prefixId: u32, $: Record<string, u16>): u32 {
  if (node == 0) return 0;
  const nodeType = graph.ast.getType(node);

  // 1. Binary Expression (left op right)
  const leftNode = graph.ast.getChildByFieldId(node, "left");
  const rightNode = graph.ast.getChildByFieldId(node, "right");
  if (leftNode != 0 && rightNode != 0) {
    const leftId = lowerExpression(graph, leftNode, prefixId, $);
    const rightId = lowerExpression(graph, rightNode, prefixId, $);

    const op = graph.ast.getBinaryOp(leftNode, rightNode);
    return graph.dae.addBinaryExpr(op, leftId, rightId);
  }

  // 2. Unary Expression (op operand)
  const operandNode = graph.ast.getChildByFieldId(node, "operand");
  if (operandNode != 0) {
    const opId = lowerExpression(graph, operandNode, prefixId, $);
    if (graph.ast.startsWith(node, "-") || graph.ast.textEquals(node, "-")) {
      return graph.dae.addExpression(14 /* Negate */, 0, opId);
    }
    if (graph.ast.startsWith(node, "not") || graph.ast.textEquals(node, "not")) {
      return graph.dae.addExpression(6 /* Unary */, 1 /* Not */, opId);
    }
    return opId;
  }

  // 3. der( expr )
  if (nodeType == $.primary || nodeType == $.expression) {
    if (graph.ast.startsWith(node, "der")) {
      for (const exprList of graph.ast.getDescendants(node, $.expression_list)) {
        for (const expr of graph.ast.getDescendants(exprList, $.expression)) {
          const innerId = lowerExpression(graph, expr, prefixId, $);
          return graph.dae.addExpression(12 /* Der */, 0, innerId);
        }
      }
    }
  }

  // 4. Literals: Integer
  if (nodeType == $.unsigned_integer) {
    const val = graph.ast.parseInteger(node);
    return graph.dae.addExpression(1 /* IntLiteral */, val as u32);
  }

  // 5. Literals: Real
  if (nodeType == $.unsigned_real) {
    const val = graph.ast.parseReal(node);
    return graph.dae.addRealLiteral(val);
  }

  // 6. Boolean literals
  if (graph.ast.textEquals(node, "true")) {
    return graph.dae.addExpression(3 /* BoolLiteral */, 1);
  }
  if (graph.ast.textEquals(node, "false")) {
    return graph.dae.addExpression(3 /* BoolLiteral */, 0);
  }

  // 7. Check if node is an expression / primary / unsigned_number wrapper
  if (nodeType == $.expression || nodeType == $.primary || nodeType == $.unsigned_number) {
    const firstChild = graph.ast.getFirstChild(node);
    if (firstChild != 0 && graph.ast.getNextSibling(firstChild) == 0) {
      return lowerExpression(graph, firstChild, prefixId, $);
    }
    if (graph.ast.startsWith(node, "(")) {
      let cur = graph.ast.getFirstChild(node);
      while (cur != 0) {
        if (graph.ast.getType(cur) == $.expression) {
          return lowerExpression(graph, cur, prefixId, $);
        }
        cur = graph.ast.getNextSibling(cur);
      }
    }
    for (const num of graph.ast.getDescendants(node, $.unsigned_integer)) {
      const val = graph.ast.parseInteger(num);
      return graph.dae.addExpression(1 /* IntLiteral */, val as u32);
    }
    for (const num of graph.ast.getDescendants(node, $.unsigned_real)) {
      const val = graph.ast.parseReal(num);
      return graph.dae.addRealLiteral(val);
    }
  }

  // 8. Identifiers / Component References (Variables)
  let nameStrId: u32 = 0;
  for (const id of graph.ast.getDescendants(node, $.identifier)) {
    let leafId = id;
    while (leafId != 0 && graph.ast.getFirstChild(leafId) != 0) leafId = graph.ast.getFirstChild(leafId);
    const segStrId = graph.scope.internNode(leafId);
    if (nameStrId == 0) {
      nameStrId = segStrId;
    } else {
      nameStrId = graph.scope.concatPrefix(nameStrId, segStrId);
    }
  }
  if (nameStrId == 0) {
    let leaf = node;
    while (leaf != 0 && graph.ast.getFirstChild(leaf) != 0) leaf = graph.ast.getFirstChild(leaf);
    nameStrId = graph.scope.internNode(leaf);
  }

  const fullNameId = prefixId != 0 ? graph.scope.concatPrefix(prefixId, nameStrId) : nameStrId;
  return graph.dae.addExpression(0 /* Name / Var */, fullNameId);
}

/**
 * 4-Pass Physical Modelica 3.7 Flattening Pipeline.
 * Lowers AST components, recursive sub-models, extends chains, equations,
 * and acausal connections into graph.dae (WASM Struct-of-Arrays).
 */
export const modelicaFlatteningPasses = [
  // Pass 1: Symbol & Scope Indexing
  (graph: CodeGraph) => {
    graph.scope.reset();
    graph.dae.reset();
  },

  // Pass 2: Component Instantiation & Hierarchical Lowering
  (graph: CodeGraph, rootNode: u32, $: Record<string, u16>) => {
    const docRoot = rootNode != 0 ? rootNode : graph.ast.getRootNode();
    if (docRoot == 0) return;

    let targetClass: u32 = 0;
    for (const spec of graph.ast.getDescendants(docRoot, $.long_class_specifier)) {
      for (const anc of graph.ast.getAncestors(spec, 0)) {
        if (graph.ast.getType(anc) == $.class_definition) {
          targetClass = anc;
          break;
        }
      }
    }
    if (targetClass == 0) return;

    const classStack: u32[] = [targetClass];
    const prefixStack: u32[] = [0];

    while (classStack.length > 0) {
      const classNode = classStack.pop();
      const prefixId = prefixStack.pop();

      // 1. Walk Extends Clauses
      if ($.extends_clause != 0) {
        for (const ext of graph.ast.getDescendants(classNode, $.extends_clause)) {
          let isInner = false;
          for (const anc of graph.ast.getAncestors(ext, 0)) {
            if (anc == classNode) break;
            if (graph.ast.getType(anc) == $.class_definition) {
              isInner = true;
              break;
            }
          }
          if (isInner) continue;

          for (const ts of graph.ast.getDescendants(ext, $.type_specifier)) {
            for (const def of graph.ast.getDescendants(docRoot, $.class_definition)) {
              if (def == classNode) continue;
              for (const spec of graph.ast.getDescendants(def, $.long_class_specifier)) {
                for (const id of graph.ast.getDescendants(spec, $.identifier)) {
                  let c1 = id;
                  while (c1 != 0 && graph.ast.getFirstChild(c1) != 0) c1 = graph.ast.getFirstChild(c1);
                  let c2 = ts;
                  while (c2 != 0 && graph.ast.getFirstChild(c2) != 0) c2 = graph.ast.getFirstChild(c2);
                  if (c1 != 0 && c2 != 0) {
                    const s1 = graph.scope.internNode(c1);
                    const s2 = graph.scope.internNode(c2);
                    if (graph.scope.equals(s1, s2)) {
                      classStack.push(def);
                      prefixStack.push(prefixId);
                    }
                  }
                  break;
                }
                break;
              }
            }
            break;
          }
        }
      }

      // 2. Walk Local Component Clauses
      for (const comp of graph.ast.getDescendants(classNode, $.component_clause)) {
        let isInner = false;
        for (const anc of graph.ast.getAncestors(comp, 0)) {
          if (anc == classNode) break;
          if (graph.ast.getType(anc) == $.class_definition) {
            isInner = true;
            break;
          }
        }
        if (isInner) continue;

        // 2a. Determine Primitive Type
        let varType: i32 = -1;
        let typeNode: u32 = 0;
        for (const ts of graph.ast.getDescendants(comp, $.type_specifier)) {
          typeNode = ts;
          let leafTs = ts;
          while (leafTs != 0 && graph.ast.getFirstChild(leafTs) != 0) leafTs = graph.ast.getFirstChild(leafTs);
          if (graph.ast.startsWith(leafTs, "Real") || graph.ast.textEquals(leafTs, "Real")) varType = 0;
          else if (graph.ast.startsWith(leafTs, "Integer") || graph.ast.textEquals(leafTs, "Integer")) varType = 1;
          else if (graph.ast.startsWith(leafTs, "Boolean") || graph.ast.textEquals(leafTs, "Boolean")) varType = 2;
          else if (graph.ast.startsWith(leafTs, "String") || graph.ast.textEquals(leafTs, "String")) varType = 3;
          else if (graph.ast.startsWith(leafTs, "Clock") || graph.ast.textEquals(leafTs, "Clock")) varType = 5;
          break;
        }

        // 2b. Determine Variability
        let variability: i32 = 0;
        for (const tp of graph.ast.getDescendants(comp, $.type_prefix)) {
          let leafTp = tp;
          while (leafTp != 0 && graph.ast.getFirstChild(leafTp) != 0) leafTp = graph.ast.getFirstChild(leafTp);
          if (graph.ast.startsWith(leafTp, "parameter") || graph.ast.textEquals(leafTp, "parameter")) variability = 2;
          else if (graph.ast.startsWith(leafTp, "constant") || graph.ast.textEquals(leafTp, "constant"))
            variability = 3;
          else if (graph.ast.startsWith(leafTp, "discrete") || graph.ast.textEquals(leafTp, "discrete"))
            variability = 1;
        }

        // 2c. Determine Causality
        let causality: i32 = 0;
        for (const tp of graph.ast.getDescendants(comp, $.type_prefix)) {
          let leafTp = tp;
          while (leafTp != 0 && graph.ast.getFirstChild(leafTp) != 0) leafTp = graph.ast.getFirstChild(leafTp);
          if (graph.ast.startsWith(leafTp, "input") || graph.ast.textEquals(leafTp, "input")) causality = 1;
          else if (graph.ast.startsWith(leafTp, "output") || graph.ast.textEquals(leafTp, "output")) causality = 2;
        }

        // 2d. Determine Flow Flag
        let flags: i32 = 0;
        for (const tp of graph.ast.getDescendants(comp, $.type_prefix)) {
          let leafTp = tp;
          while (leafTp != 0 && graph.ast.getFirstChild(leafTp) != 0) leafTp = graph.ast.getFirstChild(leafTp);
          if (graph.ast.startsWith(leafTp, "flow") || graph.ast.textEquals(leafTp, "flow")) flags |= 1 << 1;
        }

        // 2e. Process Component Declarations
        for (const decl of graph.ast.getDescendants(comp, $.declaration)) {
          let declId: u32 = 0;
          for (const id of graph.ast.getDescendants(decl, $.identifier)) {
            declId = id;
            break;
          }
          if (declId != 0) {
            const nameStrId = graph.scope.internNode(declId);
            const fullNameId = prefixId != 0 ? graph.scope.concatPrefix(prefixId, nameStrId) : nameStrId;

            // Extract array subscripts from declaration (e.g. x[9]) or component_clause (e.g. Real[9] x)
            const dims: i32[] = [];
            let subNode: u32 = 0;
            for (const s of graph.ast.getDescendants(decl, $.array_subscripts)) {
              subNode = s;
              break;
            }
            if (subNode == 0) {
              for (const s of graph.ast.getDescendants(comp, $.array_subscripts)) {
                subNode = s;
                break;
              }
            }
            if (subNode != 0) {
              const sz = graph.ast.parseInteger(subNode);
              if (sz > 0) dims.push(sz);
            }

            let varFlags = flags;
            if (dims.length > 0) {
              varFlags |= 1 << 4; // Array flag
            }

            if (varType >= 0) {
              const varIdx = graph.dae.addVariable(fullNameId, varType, variability, causality, 0.0, varFlags);
              for (let d = 0; d < dims.length; d++) {
                graph.dae.setVarShapeDim(varIdx, d as u32, dims[d]);
              }
            } else if (typeNode != 0) {
              for (const def of graph.ast.getDescendants(docRoot, $.class_definition)) {
                if (def == classNode) continue;
                for (const spec of graph.ast.getDescendants(def, $.long_class_specifier)) {
                  for (const id of graph.ast.getDescendants(spec, $.identifier)) {
                    let c1 = id;
                    while (c1 != 0 && graph.ast.getFirstChild(c1) != 0) c1 = graph.ast.getFirstChild(c1);
                    let c2 = typeNode;
                    while (c2 != 0 && graph.ast.getFirstChild(c2) != 0) c2 = graph.ast.getFirstChild(c2);
                    if (c1 != 0 && c2 != 0) {
                      const s1 = graph.scope.internNode(c1);
                      const s2 = graph.scope.internNode(c2);
                      if (graph.scope.equals(s1, s2)) {
                        classStack.push(def);
                        prefixStack.push(fullNameId);
                      }
                    }
                    break;
                  }
                  break;
                }
              }
            }
          }
        }
      }
    }
  },

  // Pass 3: Equation Lowering & Connector Port Balancing
  (graph: CodeGraph, rootNode: u32, $: Record<string, u16>) => {
    const docRoot = rootNode != 0 ? rootNode : graph.ast.getRootNode();
    if (docRoot == 0) return;

    let targetClass: u32 = 0;
    for (const spec of graph.ast.getDescendants(docRoot, $.long_class_specifier)) {
      for (const anc of graph.ast.getAncestors(spec, 0)) {
        if (graph.ast.getType(anc) == $.class_definition) {
          targetClass = anc;
          break;
        }
      }
    }
    if (targetClass == 0) return;

    const classStack: u32[] = [targetClass];
    const prefixStack: u32[] = [0];

    while (classStack.length > 0) {
      const classNode = classStack.pop();
      const prefixId = prefixStack.pop();

      // 1. Lower inherited equations from Extends Clauses
      if ($.extends_clause != 0) {
        for (const ext of graph.ast.getDescendants(classNode, $.extends_clause)) {
          let isInner = false;
          for (const anc of graph.ast.getAncestors(ext, 0)) {
            if (anc == classNode) break;
            if (graph.ast.getType(anc) == $.class_definition) {
              isInner = true;
              break;
            }
          }
          if (isInner) continue;

          for (const ts of graph.ast.getDescendants(ext, $.type_specifier)) {
            for (const def of graph.ast.getDescendants(docRoot, $.class_definition)) {
              if (def == classNode) continue;
              for (const spec of graph.ast.getDescendants(def, $.long_class_specifier)) {
                for (const id of graph.ast.getDescendants(spec, $.identifier)) {
                  let c1 = id;
                  while (c1 != 0 && graph.ast.getFirstChild(c1) != 0) c1 = graph.ast.getFirstChild(c1);
                  let c2 = ts;
                  while (c2 != 0 && graph.ast.getFirstChild(c2) != 0) c2 = graph.ast.getFirstChild(c2);
                  if (c1 != 0 && c2 != 0) {
                    const s1 = graph.scope.internNode(c1);
                    const s2 = graph.scope.internNode(c2);
                    if (graph.scope.equals(s1, s2)) {
                      classStack.push(def);
                      prefixStack.push(prefixId);
                    }
                  }
                  break;
                }
                break;
              }
            }
            break;
          }
        }
      }

      // 2. Simple Equations (lhs = rhs)
      if ($.simple_equation != 0) {
        for (const eq of graph.ast.getDescendants(classNode, $.simple_equation)) {
          let isInner = false;
          for (const anc of graph.ast.getAncestors(eq, 0)) {
            if (anc == classNode) break;
            if (graph.ast.getType(anc) == $.class_definition) {
              isInner = true;
              break;
            }
          }
          if (isInner) continue;

          let lhsNode = graph.ast.getChildByFieldId(eq, "lhs");
          let rhsNode = graph.ast.getChildByFieldId(eq, "rhs");
          if (lhsNode == 0 || rhsNode == 0) {
            const ch1 = graph.ast.getFirstChild(eq);
            if (ch1 != 0) {
              lhsNode = ch1;
              const ch2 = graph.ast.getNextSibling(ch1);
              if (ch2 != 0) {
                const ch3 = graph.ast.getNextSibling(ch2);
                rhsNode = ch3 != 0 ? ch3 : ch2;
              }
            }
          }
          if (lhsNode != 0 && rhsNode != 0) {
            const lhsExprId = lowerExpression(graph, lhsNode, prefixId, $);
            const rhsExprId = lowerExpression(graph, rhsNode, prefixId, $);
            graph.dae.addEquation(0, lhsExprId, rhsExprId); // EqKind.Simple
          }
        }
      }

      // 3. Connect Equations (connect(lhs, rhs))
      if ($.connect_equation != 0) {
        for (const conn of graph.ast.getDescendants(classNode, $.connect_equation)) {
          let isInner = false;
          for (const anc of graph.ast.getAncestors(conn, 0)) {
            if (anc == classNode) break;
            if (graph.ast.getType(anc) == $.class_definition) {
              isInner = true;
              break;
            }
          }
          if (isInner) continue;

          const lhsNode = graph.ast.getChildByFieldId(conn, "lhs");
          const rhsNode = graph.ast.getChildByFieldId(conn, "rhs");
          if (lhsNode != 0 && rhsNode != 0) {
            let lhsStrId: u32 = 0;
            for (const id of graph.ast.getDescendants(lhsNode, $.identifier)) {
              let leafId = id;
              while (leafId != 0 && graph.ast.getFirstChild(leafId) != 0) leafId = graph.ast.getFirstChild(leafId);
              const segStrId = graph.scope.internNode(leafId);
              if (lhsStrId == 0) {
                lhsStrId = segStrId;
              } else {
                lhsStrId = graph.scope.concatPrefix(lhsStrId, segStrId);
              }
            }
            if (lhsStrId == 0) {
              let targetLhs = lhsNode;
              while (targetLhs != 0 && graph.ast.getFirstChild(targetLhs) != 0)
                targetLhs = graph.ast.getFirstChild(targetLhs);
              lhsStrId = graph.scope.internNode(targetLhs);
            }

            let rhsStrId: u32 = 0;
            for (const id of graph.ast.getDescendants(rhsNode, $.identifier)) {
              let leafId = id;
              while (leafId != 0 && graph.ast.getFirstChild(leafId) != 0) leafId = graph.ast.getFirstChild(leafId);
              const segStrId = graph.scope.internNode(leafId);
              if (rhsStrId == 0) {
                rhsStrId = segStrId;
              } else {
                rhsStrId = graph.scope.concatPrefix(rhsStrId, segStrId);
              }
            }
            if (rhsStrId == 0) {
              let targetRhs = rhsNode;
              while (targetRhs != 0 && graph.ast.getFirstChild(targetRhs) != 0)
                targetRhs = graph.ast.getFirstChild(targetRhs);
              rhsStrId = graph.scope.internNode(targetRhs);
            }

            const fullLhsId = prefixId != 0 ? graph.scope.concatPrefix(prefixId, lhsStrId) : lhsStrId;
            const fullRhsId = prefixId != 0 ? graph.scope.concatPrefix(prefixId, rhsStrId) : rhsStrId;

            const lhsExprId = graph.dae.addExpression(0, fullLhsId);
            const rhsExprId = graph.dae.addExpression(0, fullRhsId);
            graph.dae.addEquation(6, lhsExprId, rhsExprId); // EqKind.Connect
          }
        }
      }
    }
    graph.connectors.finalize();
  },

  // Pass 4: BLT Partitioning & Balance Analysis
  (graph: CodeGraph) => {
    graph.blt.computeBLT();
  },
];
