// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CodeGraph, i32, u16, u32 } from "@modelscript/language";

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

            if (varType >= 0) {
              graph.dae.addVariable(fullNameId, varType, variability, causality, 0.0, flags);
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
            let targetLhs: u32 = lhsNode;
            while (targetLhs != 0) {
              const ch = graph.ast.getFirstChild(targetLhs);
              if (ch == 0) break;
              targetLhs = ch;
            }

            let targetRhs: u32 = rhsNode;
            while (targetRhs != 0) {
              const ch = graph.ast.getFirstChild(targetRhs);
              if (ch == 0) break;
              targetRhs = ch;
            }

            const lhsStrId = graph.scope.internNode(targetLhs);
            const rhsStrId = graph.scope.internNode(targetRhs);
            const fullLhsId = prefixId != 0 ? graph.scope.concatPrefix(prefixId, lhsStrId) : lhsStrId;
            const fullRhsId = prefixId != 0 ? graph.scope.concatPrefix(prefixId, rhsStrId) : rhsStrId;

            const lhsExprId = graph.dae.addExpression(0, fullLhsId);
            const rhsExprId = graph.dae.addExpression(0, fullRhsId);
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
            let targetLhs: u32 = lhsNode;
            while (targetLhs != 0) {
              const ch = graph.ast.getFirstChild(targetLhs);
              if (ch == 0) break;
              targetLhs = ch;
            }

            let targetRhs: u32 = rhsNode;
            while (targetRhs != 0) {
              const ch = graph.ast.getFirstChild(targetRhs);
              if (ch == 0) break;
              targetRhs = ch;
            }

            const lhsStrId = graph.scope.internNode(targetLhs);
            const rhsStrId = graph.scope.internNode(targetRhs);
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
