import type { CodeGraph, CompilerLint, u16, u32, u64 } from "@modelscript/language";
import {
  findClassByName,
  findComponentTypeInClass,
  getEnclosingClass,
  getExpressionVariability,
  getMemberKindInClass,
  hasMatchingConnectEquation,
  isClassKind,
  isDescendantOfInnerClass,
  isDottedVariableDeclared,
  isPrimitiveAttribute,
  isTopLevelClassName,
  isVariableDeclaredInClass,
  MEMBER_CLASS,
  MEMBER_NONE,
  MEMBER_RECORD_COMPONENT,
  resolveBasePrimitiveType,
  resolveComponentClassDefinition,
  TYPE_UNKNOWN,
  VARIABILITY_CONTINUOUS,
} from "./helpers.js";

export const modelicaHierarchyLints: Record<string, CompilerLint> = {
  /**
   * M2002: Variable not found in scope.
   */
  variableNotFound: {
    nodes: ["component_reference"],
    severity: "error",
    code: 2002,
    message: (target) => `Variable '${target.text}' not found in scope.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let rootId: u32 = 0;
      for (const id of db.ast.getDescendants(node, $.identifier)) {
        rootId = id;
        break;
      }
      if (rootId == 0) rootId = node;

      const enclosingClass = getEnclosingClass(db, node, $);
      if (enclosingClass == 0) return;

      // FAST PATH 1: Is it declared in enclosingClass?
      if (isDottedVariableDeclared(db, enclosingClass, node, $)) {
        return;
      }

      if (
        db.ast.textEquals(rootId, "time") ||
        db.ast.textEquals(rootId, "der") ||
        db.ast.textEquals(rootId, "Real") ||
        db.ast.textEquals(rootId, "Integer") ||
        db.ast.textEquals(rootId, "Boolean") ||
        db.ast.textEquals(rootId, "String") ||
        db.ast.textEquals(rootId, "initial") ||
        db.ast.textEquals(rootId, "terminal") ||
        db.ast.textEquals(rootId, "sample") ||
        db.ast.textEquals(rootId, "reinit") ||
        db.ast.textEquals(rootId, "assert") ||
        db.ast.textEquals(rootId, "terminate") ||
        db.ast.textEquals(rootId, "inStream") ||
        db.ast.textEquals(rootId, "actualStream") ||
        db.ast.textEquals(rootId, "spatialDistribution") ||
        db.ast.textEquals(rootId, "homotopy") ||
        db.ast.textEquals(rootId, "semiLinear") ||
        db.ast.textEquals(rootId, "delay") ||
        db.ast.textEquals(rootId, "cardinality") ||
        db.ast.textEquals(rootId, "smooth") ||
        db.ast.textEquals(rootId, "sin") ||
        db.ast.textEquals(rootId, "cos") ||
        db.ast.textEquals(rootId, "tan") ||
        db.ast.textEquals(rootId, "asin") ||
        db.ast.textEquals(rootId, "acos") ||
        db.ast.textEquals(rootId, "atan") ||
        db.ast.textEquals(rootId, "atan2") ||
        db.ast.textEquals(rootId, "sinh") ||
        db.ast.textEquals(rootId, "cosh") ||
        db.ast.textEquals(rootId, "tanh") ||
        db.ast.textEquals(rootId, "exp") ||
        db.ast.textEquals(rootId, "log") ||
        db.ast.textEquals(rootId, "log10") ||
        db.ast.textEquals(rootId, "sqrt") ||
        db.ast.textEquals(rootId, "abs") ||
        db.ast.textEquals(rootId, "sign") ||
        db.ast.textEquals(rootId, "floor") ||
        db.ast.textEquals(rootId, "ceil") ||
        db.ast.textEquals(rootId, "integer") ||
        db.ast.textEquals(rootId, "div") ||
        db.ast.textEquals(rootId, "mod") ||
        db.ast.textEquals(rootId, "rem") ||
        db.ast.textEquals(rootId, "sum") ||
        db.ast.textEquals(rootId, "product") ||
        db.ast.textEquals(rootId, "min") ||
        db.ast.textEquals(rootId, "max") ||
        db.ast.textEquals(rootId, "size") ||
        db.ast.textEquals(rootId, "ndims") ||
        db.ast.textEquals(rootId, "cat") ||
        db.ast.textEquals(rootId, "linspace") ||
        db.ast.textEquals(rootId, "cross") ||
        db.ast.textEquals(rootId, "skew") ||
        db.ast.textEquals(rootId, "outerProduct") ||
        db.ast.textEquals(rootId, "symmetric") ||
        db.ast.textEquals(rootId, "subMatrix") ||
        db.ast.textEquals(rootId, "vector") ||
        db.ast.textEquals(rootId, "matrix") ||
        db.ast.textEquals(rootId, "scalar") ||
        db.ast.textEquals(rootId, "pre") ||
        db.ast.textEquals(rootId, "change") ||
        db.ast.textEquals(rootId, "edge") ||
        db.ast.textEquals(rootId, "fill") ||
        db.ast.textEquals(rootId, "zeros") ||
        db.ast.textEquals(rootId, "ones") ||
        db.ast.textEquals(rootId, "identity") ||
        db.ast.textEquals(rootId, "diagonal") ||
        db.ast.textEquals(rootId, "StateSelect") ||
        db.ast.startsWith(rootId, "StateSelect.") ||
        db.ast.startsWith(node, "StateSelect.")
      ) {
        return;
      }

      // Check if inside inheritance_modification (break clauses) or annotation
      // or for_equation / for_index iterator variable in ancestors
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == enclosingClass) break;
        const ancType = db.ast.getType(anc);
        if (
          ($.inheritance_modification != 0 && ancType == $.inheritance_modification) ||
          ($.annotation != 0 && ancType == $.annotation) ||
          ($.annotation_clause != 0 && ancType == $.annotation_clause)
        ) {
          return;
        }
        if (
          ($.for_equation != 0 && ancType == $.for_equation) ||
          ($.for_statement != 0 && ancType == $.for_statement) ||
          ($.function_arguments != 0 && ancType == $.function_arguments) ||
          ($.array_arguments != 0 && ancType == $.array_arguments)
        ) {
          if ($.for_index != 0) {
            for (const fi of db.ast.getDescendants(anc, $.for_index)) {
              for (const id of db.ast.getDescendants(fi, $.identifier)) {
                if (db.ast.textEqualsNode(id, rootId)) return;
                break;
              }
            }
          }
        }
      }

      // Check outer classes if nested
      let currClass = enclosingClass;
      while (currClass != 0) {
        let parentClass: u32 = 0;
        for (const anc of db.ast.getAncestors(currClass, 0)) {
          if (anc != currClass && db.ast.getType(anc) == $.class_definition) {
            parentClass = anc;
            break;
          }
        }
        if (parentClass != 0) {
          if (isDottedVariableDeclared(db, parentClass, node, $)) {
            return;
          }
        }
        currClass = parentClass;
      }

      if (isTopLevelClassName(db, rootId, $)) return;

      db.diagnostic(node);
    },
  },

  /**
   * M2001: Unresolved reference alias for backwards compatibility.
   */
  unresolvedReference: {
    nodes: ["component_reference"],
    severity: "error",
    code: 2001,
    message: (target) => `Variable '${target.text}' not found in scope.`,
    query: () => {
      // Handled by variableNotFound
    },
  },

  /**
   * M2003: Type / class not found in scope.
   */
  typeNotFound: {
    nodes: ["type_specifier"],
    severity: "error",
    code: 2003,
    message: (target) => `Class or type '${target.text}' not found in scope.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let firstIdent: u32 = 0;
      for (const id of db.ast.getDescendants(node, $.identifier)) {
        firstIdent = id;
        break;
      }

      if (
        db.ast.startsWith(node, "Real") ||
        db.ast.textEquals(node, "Real") ||
        db.ast.startsWith(node, "Integer") ||
        db.ast.textEquals(node, "Integer") ||
        db.ast.startsWith(node, "Boolean") ||
        db.ast.textEquals(node, "Boolean") ||
        db.ast.startsWith(node, "String") ||
        db.ast.textEquals(node, "String") ||
        db.ast.startsWith(node, "Clock") ||
        db.ast.textEquals(node, "Clock") ||
        db.ast.startsWith(node, "ExternalObject") ||
        db.ast.textEquals(node, "ExternalObject") ||
        db.ast.textEquals(node, "Modelica.SIunits.Voltage") ||
        db.ast.textEquals(node, "Modelica.SIunits.Current") ||
        db.ast.textEquals(node, "Modelica.SIunits.Resistance") ||
        db.ast.textEquals(node, "Modelica.SIunits.Capacitance") ||
        db.ast.textEquals(node, "Modelica.SIunits.Inductance") ||
        db.ast.textEquals(node, "Modelica.SIunits.Time") ||
        (firstIdent != 0 &&
          (db.ast.textEquals(firstIdent, "Real") ||
            db.ast.startsWith(firstIdent, "Real") ||
            db.ast.textEquals(firstIdent, "Integer") ||
            db.ast.startsWith(firstIdent, "Integer") ||
            db.ast.textEquals(firstIdent, "Boolean") ||
            db.ast.startsWith(firstIdent, "Boolean") ||
            db.ast.textEquals(firstIdent, "String") ||
            db.ast.startsWith(firstIdent, "String") ||
            db.ast.textEquals(firstIdent, "Clock") ||
            db.ast.startsWith(firstIdent, "Clock") ||
            db.ast.textEquals(firstIdent, "ExternalObject") ||
            db.ast.startsWith(firstIdent, "ExternalObject") ||
            db.ast.textEquals(firstIdent, "Modelica") ||
            db.ast.textEquals(firstIdent, "SIunits") ||
            db.ast.textEquals(firstIdent, "Icons") ||
            db.ast.textEquals(firstIdent, "Blocks") ||
            db.ast.textEquals(firstIdent, "Electrical")))
      ) {
        return;
      }

      if (isTopLevelClassName(db, node, $)) {
        return;
      }

      db.diagnostic(node);
    },
  },

  /**
   * M4001: Extends cycle detected.
   */
  extendsCycle: {
    nodes: ["extends_clause"],
    severity: "error",
    code: 4001,
    message: (target) => `Extends cycle detected for '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const typeSpec = db.ast.getChildByFieldId(node, "type_specifier");
      if (typeSpec != 0) {
        const baseClass = db.scope.resolve(typeSpec);
        for (const cls of db.ast.getAncestors(node, 0)) {
          if (db.ast.getType(cls) == $.class_definition) {
            if (cls == baseClass) {
              db.diagnostic(node);
            }
            break;
          }
        }
      }
    },
  },

  /**
   * M4002-notification: Notification for duplicate modification.
   */
  duplicateModificationNotification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "info",
    code: 2093,
    message: () => `From here:`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let isNestedMod = false;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == node) continue;
        const t = db.ast.getType(anc);
        if (($.annotation_clause != 0 && t == $.annotation_clause) || ($.annotation != 0 && t == $.annotation)) {
          return;
        }
        if (t == $.class_modification || t == $.class_or_inheritance_modification) {
          isNestedMod = true;
          break;
        }
      }
      if (isNestedMod) return;

      const redeclMap = db.map.create();
      // First collect element_redeclaration
      for (const redecl of db.ast.getDescendants(node, $.element_redeclaration)) {
        let isNested = false;
        for (const anc of db.ast.getAncestors(redecl, 0)) {
          if (anc == node) break;
          if (
            anc != redecl &&
            (db.ast.getType(anc) == $.class_modification || db.ast.getType(anc) == $.class_or_inheritance_modification)
          ) {
            isNested = true;
            break;
          }
        }
        if (isNested) continue;

        let redeclName: u32 = 0;
        for (const cd of db.ast.getDescendants(redecl, $.component_declaration1)) {
          for (const id of db.ast.getDescendants(cd, $.identifier)) {
            redeclName = id;
            break;
          }
          break;
        }
        if (redeclName == 0) {
          for (const spec of db.ast.getDescendants(redecl, $.short_class_specifier)) {
            const nameId = db.ast.getChildByFieldId(spec, "name");
            if (nameId != 0) redeclName = nameId;
            break;
          }
        }
        if (redeclName == 0) {
          for (const spec of db.ast.getDescendants(redecl, $.long_class_specifier)) {
            const nameId = db.ast.getChildByFieldId(spec, "name");
            if (nameId != 0) redeclName = nameId;
            break;
          }
        }
        if (redeclName == 0) continue;

        const s = db.ast.getTextSpan(redeclName);
        if (s) {
          const hash = db.hash.span64(s);
          db.map.set(redeclMap, hash, redecl);
        }
      }

      const seenMap = db.map.create();
      // Iterate element_modification
      for (const mod of db.ast.getDescendants(node, $.element_modification)) {
        let isNestedInSub = false;
        let outerMod: u32 = 0;
        for (const anc of db.ast.getAncestors(mod, 0)) {
          if (anc == node) break;
          if (anc != mod && db.ast.getType(anc) == $.element_modification) {
            if (outerMod == 0) outerMod = anc;
            else {
              isNestedInSub = true;
              break;
            }
          }
        }
        if (isNestedInSub) continue;

        let outerName: u32 = 0;
        let innerName: u32 = 0;
        if (outerMod != 0) {
          for (const n of db.ast.getDescendants(outerMod, $.name)) {
            outerName = n;
            break;
          }
          for (const n of db.ast.getDescendants(mod, $.name)) {
            innerName = n;
            break;
          }
        } else {
          for (const n of db.ast.getDescendants(mod, $.name)) {
            outerName = n;
            break;
          }
          let idCount = 0;
          let firstId: u32 = 0;
          let lastId: u32 = 0;
          for (const id of db.ast.getDescendants(outerName, $.identifier)) {
            if (firstId == 0) firstId = id;
            lastId = id;
            idCount++;
          }
          if (idCount > 1) {
            outerName = firstId;
            innerName = lastId;
          }
        }
        if (outerName == 0) continue;

        // Skip container element_modification that only has class_modification and no value binding
        if (outerMod == 0 && innerName == 0) {
          let oHash: u64 = 0n;
          const os = db.ast.getTextSpan(outerName);
          if (os) oHash = db.hash.span64(os);
          const hasRedecl = oHash != 0n && db.map.get(redeclMap, oHash) != 0;

          if (!hasRedecl) {
            const modClause = db.ast.getChildByFieldId(mod, "modification");
            if (modClause != 0) {
              const classMod = db.ast.getChildByFieldId(modClause, "class_modification");
              const modExpr = db.ast.getChildByFieldId(modClause, "modification_expression");
              if (classMod != 0 && modExpr == 0) {
                continue;
              }
            }
          }
        }

        let hash: u64 = 0n;
        if (db.ast.getType(outerName) == $.identifier) {
          const s = db.ast.getTextSpan(outerName);
          if (s) hash = db.hash.span64(s);
        } else {
          for (const id of db.ast.getDescendants(outerName, $.identifier)) {
            const s = db.ast.getTextSpan(id);
            if (s) {
              const h = db.hash.span64(s);
              hash = hash == 0n ? h : hash * 31n + h;
            }
          }
        }
        if (innerName != 0) {
          if (db.ast.getType(innerName) == $.identifier) {
            const s = db.ast.getTextSpan(innerName);
            if (s) {
              const h = db.hash.span64(s);
              hash = hash == 0n ? h : hash * 31n + h;
            }
          } else {
            for (const id of db.ast.getDescendants(innerName, $.identifier)) {
              const s = db.ast.getTextSpan(id);
              if (s) {
                const h = db.hash.span64(s);
                hash = hash == 0n ? h : hash * 31n + h;
              }
            }
          }
        }

        let prevNode: u32 = 0;
        if (db.map.get(seenMap, hash) != 0) {
          prevNode = db.map.get(seenMap, hash);
        } else if (innerName == 0 && db.map.get(redeclMap, hash) != 0) {
          prevNode = db.map.get(redeclMap, hash);
        }

        if (prevNode != 0) {
          const notifTarget = innerName != 0 ? prevNode : mod;
          db.diagnostic(notifTarget);
          db.map.release(seenMap);
          db.map.release(redeclMap);
          return;
        } else {
          db.map.set(seenMap, hash, mod);
        }
      }

      // Check element_redeclaration
      for (const redecl of db.ast.getDescendants(node, $.element_redeclaration)) {
        let isNested = false;
        for (const anc of db.ast.getAncestors(redecl, 0)) {
          if (anc == node) break;
          if (
            anc != redecl &&
            (db.ast.getType(anc) == $.class_modification || db.ast.getType(anc) == $.class_or_inheritance_modification)
          ) {
            isNested = true;
            break;
          }
        }
        if (isNested) continue;

        let redeclName: u32 = 0;
        for (const cd of db.ast.getDescendants(redecl, $.component_declaration1)) {
          for (const id of db.ast.getDescendants(cd, $.identifier)) {
            redeclName = id;
            break;
          }
          break;
        }
        if (redeclName == 0) {
          for (const spec of db.ast.getDescendants(redecl, $.short_class_specifier)) {
            const nameId = db.ast.getChildByFieldId(spec, "name");
            if (nameId != 0) redeclName = nameId;
            break;
          }
        }
        if (redeclName == 0) {
          for (const spec of db.ast.getDescendants(redecl, $.long_class_specifier)) {
            const nameId = db.ast.getChildByFieldId(spec, "name");
            if (nameId != 0) redeclName = nameId;
            break;
          }
        }
        if (redeclName == 0) continue;

        let hash: u64 = 0n;
        const s = db.ast.getTextSpan(redeclName);
        if (s) {
          hash = db.hash.span64(s);
        }

        if (db.map.get(seenMap, hash) != 0) {
          db.diagnostic(redecl);
          db.map.release(seenMap);
          db.map.release(redeclMap);
          return;
        }
      }
      db.map.release(seenMap);
      db.map.release(redeclMap);
    },
  },

  /**
   * M4002: Duplicate modification of element.
   */
  duplicateModification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "error",
    code: 4002,
    message: (target, outerName, innerOrKind, targetName) => {
      const isInner = innerOrKind && innerOrKind.asNumber ? innerOrKind.asNumber() > 3 : false;
      const elemStr = isInner
        ? `${outerName.text}.${innerOrKind.text}`
        : outerName && outerName.text !== "0" && outerName.text !== ""
          ? outerName.text
          : target.text;
      const kindNum = isInner ? 1 : innerOrKind && innerOrKind.asNumber ? innerOrKind.asNumber() : 1;
      const kindStr = kindNum === 2 ? "extends" : kindNum === 3 ? "inherited class" : "component";
      const tName = targetName && targetName.text !== "0" && targetName.text !== "" ? targetName.text : "";
      return `Duplicate modification of element ${elemStr} on ${kindStr} ${tName}.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let isNestedMod = false;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == node) continue;
        const t = db.ast.getType(anc);
        if (($.annotation_clause != 0 && t == $.annotation_clause) || ($.annotation != 0 && t == $.annotation)) {
          return;
        }
        if (t == $.class_modification || t == $.class_or_inheritance_modification) {
          isNestedMod = true;
          break;
        }
      }
      if (isNestedMod) return;

      let parentTargetNode: u32 = 0;
      let kindCode = 1; // 1 = component, 2 = extends, 3 = inherited class

      for (const anc of db.ast.getAncestors(node, 0)) {
        const type = db.ast.getType(anc);
        if (type == $.extends_clause) {
          kindCode = 2; // extends
          for (const ts of db.ast.getDescendants(anc, $.type_specifier)) {
            parentTargetNode = ts;
            break;
          }
          break;
        }
        if (type == $.short_class_specifier) {
          kindCode = 3; // inherited class
          for (const ts of db.ast.getDescendants(anc, $.type_specifier)) {
            parentTargetNode = ts;
            break;
          }
          break;
        }
        if (type == $.declaration) {
          kindCode = 1; // component
          const nameId = db.ast.getChildByFieldId(anc, "name");
          if (nameId != 0) parentTargetNode = nameId;
          break;
        }
        if (type == $.component_declaration1) {
          kindCode = 1; // component
          for (const id of db.ast.getDescendants(anc, $.identifier)) {
            parentTargetNode = id;
            break;
          }
          break;
        }
      }

      const redeclMap = db.map.create();
      const redeclNameMap = db.map.create();
      for (const redecl of db.ast.getDescendants(node, $.element_redeclaration)) {
        let isNested = false;
        for (const anc of db.ast.getAncestors(redecl, 0)) {
          if (anc == node) break;
          if (
            anc != redecl &&
            (db.ast.getType(anc) == $.class_modification || db.ast.getType(anc) == $.class_or_inheritance_modification)
          ) {
            isNested = true;
            break;
          }
        }
        if (isNested) continue;

        let redeclName: u32 = 0;
        for (const cd of db.ast.getDescendants(redecl, $.component_declaration1)) {
          for (const id of db.ast.getDescendants(cd, $.identifier)) {
            redeclName = id;
            break;
          }
          break;
        }
        if (redeclName == 0) {
          for (const spec of db.ast.getDescendants(redecl, $.short_class_specifier)) {
            const nameId = db.ast.getChildByFieldId(spec, "name");
            if (nameId != 0) redeclName = nameId;
            break;
          }
        }
        if (redeclName == 0) {
          for (const spec of db.ast.getDescendants(redecl, $.long_class_specifier)) {
            const nameId = db.ast.getChildByFieldId(spec, "name");
            if (nameId != 0) redeclName = nameId;
            break;
          }
        }
        if (redeclName == 0) continue;

        const s = db.ast.getTextSpan(redeclName);
        if (s) {
          const hash = db.hash.span64(s);
          db.map.set(redeclMap, hash, redecl);
          db.map.set(redeclNameMap, hash, redeclName);
        }
      }

      const seenMap = db.map.create();
      const nameMap = db.map.create();
      const innerMap = db.map.create();

      // Iterate element_modification
      for (const mod of db.ast.getDescendants(node, $.element_modification)) {
        let isNestedInSub = false;
        let outerMod: u32 = 0;
        for (const anc of db.ast.getAncestors(mod, 0)) {
          if (anc == node) break;
          if (anc != mod && db.ast.getType(anc) == $.element_modification) {
            if (outerMod == 0) outerMod = anc;
            else {
              isNestedInSub = true;
              break;
            }
          }
        }
        if (isNestedInSub) continue;

        let outerName: u32 = 0;
        let innerName: u32 = 0;
        if (outerMod != 0) {
          for (const n of db.ast.getDescendants(outerMod, $.name)) {
            outerName = n;
            break;
          }
          for (const n of db.ast.getDescendants(mod, $.name)) {
            innerName = n;
            break;
          }
        } else {
          for (const n of db.ast.getDescendants(mod, $.name)) {
            outerName = n;
            break;
          }
          let idCount = 0;
          let firstId: u32 = 0;
          let lastId: u32 = 0;
          for (const id of db.ast.getDescendants(outerName, $.identifier)) {
            if (firstId == 0) firstId = id;
            lastId = id;
            idCount++;
          }
          if (idCount > 1) {
            outerName = firstId;
            innerName = lastId;
          }
        }
        if (outerName == 0) continue;

        // Skip container element_modification that only has class_modification and no value binding
        if (outerMod == 0 && innerName == 0) {
          let oHash: u64 = 0n;
          const os = db.ast.getTextSpan(outerName);
          if (os) oHash = db.hash.span64(os);
          const hasRedecl = oHash != 0n && db.map.get(redeclMap, oHash) != 0;

          if (!hasRedecl) {
            const modClause = db.ast.getChildByFieldId(mod, "modification");
            if (modClause != 0) {
              const classMod = db.ast.getChildByFieldId(modClause, "class_modification");
              const modExpr = db.ast.getChildByFieldId(modClause, "modification_expression");
              if (classMod != 0 && modExpr == 0) {
                continue;
              }
            }
          }
        }

        let hash: u64 = 0n;
        if (db.ast.getType(outerName) == $.identifier) {
          const s = db.ast.getTextSpan(outerName);
          if (s) hash = db.hash.span64(s);
        } else {
          for (const id of db.ast.getDescendants(outerName, $.identifier)) {
            const s = db.ast.getTextSpan(id);
            if (s) {
              const h = db.hash.span64(s);
              hash = hash == 0n ? h : hash * 31n + h;
            }
          }
        }
        if (innerName != 0) {
          if (db.ast.getType(innerName) == $.identifier) {
            const s = db.ast.getTextSpan(innerName);
            if (s) {
              const h = db.hash.span64(s);
              hash = hash == 0n ? h : hash * 31n + h;
            }
          } else {
            for (const id of db.ast.getDescendants(innerName, $.identifier)) {
              const s = db.ast.getTextSpan(id);
              if (s) {
                const h = db.hash.span64(s);
                hash = hash == 0n ? h : hash * 31n + h;
              }
            }
          }
        }

        let prevNode: u32 = 0;
        let isFromRedecl = false;
        if (db.map.get(seenMap, hash) != 0) {
          prevNode = db.map.get(seenMap, hash);
        } else if (innerName == 0 && db.map.get(redeclMap, hash) != 0) {
          prevNode = db.map.get(redeclMap, hash);
          isFromRedecl = true;
        }

        if (prevNode != 0) {
          const isDottedOrNested = innerName != 0;
          const errorTarget = isDottedOrNested ? mod : prevNode;
          const outerNode = isFromRedecl ? db.map.get(redeclNameMap, hash) : db.map.get(nameMap, hash);
          const innerNode = db.map.get(innerMap, hash);
          const outArg = outerNode != 0 ? outerNode : outerName;
          const inArg = innerNode != 0 ? innerNode : innerName != 0 ? innerName : kindCode;
          db.diagnostic(errorTarget, outArg, inArg, parentTargetNode);
          db.map.release(seenMap);
          db.map.release(nameMap);
          db.map.release(innerMap);
          db.map.release(redeclMap);
          db.map.release(redeclNameMap);
          return;
        } else {
          db.map.set(seenMap, hash, mod);
          db.map.set(nameMap, hash, outerName);
          db.map.set(innerMap, hash, innerName);
        }
      }

      // Check element_redeclaration
      for (const redecl of db.ast.getDescendants(node, $.element_redeclaration)) {
        let isNested = false;
        for (const anc of db.ast.getAncestors(redecl, 0)) {
          if (anc == node) break;
          if (
            anc != redecl &&
            (db.ast.getType(anc) == $.class_modification || db.ast.getType(anc) == $.class_or_inheritance_modification)
          ) {
            isNested = true;
            break;
          }
        }
        if (isNested) continue;

        let redeclName: u32 = 0;
        for (const cd of db.ast.getDescendants(redecl, $.component_declaration1)) {
          for (const id of db.ast.getDescendants(cd, $.identifier)) {
            redeclName = id;
            break;
          }
          break;
        }
        if (redeclName == 0) {
          for (const spec of db.ast.getDescendants(redecl, $.short_class_specifier)) {
            const nameId = db.ast.getChildByFieldId(spec, "name");
            if (nameId != 0) redeclName = nameId;
            break;
          }
        }
        if (redeclName == 0) {
          for (const spec of db.ast.getDescendants(redecl, $.long_class_specifier)) {
            const nameId = db.ast.getChildByFieldId(spec, "name");
            if (nameId != 0) redeclName = nameId;
            break;
          }
        }
        if (redeclName == 0) continue;

        let hash: u64 = 0n;
        const s = db.ast.getTextSpan(redeclName);
        if (s) {
          hash = db.hash.span64(s);
        }

        if (db.map.get(seenMap, hash) != 0) {
          const firstMod = db.map.get(seenMap, hash);
          const outerNode = db.map.get(nameMap, hash);
          const innerNode = db.map.get(innerMap, hash);
          const arg2Val = innerNode != 0 ? innerNode : kindCode;
          db.diagnostic(firstMod, outerNode != 0 ? outerNode : redeclName, arg2Val, parentTargetNode);
          db.map.release(seenMap);
          db.map.release(nameMap);
          db.map.release(innerMap);
          db.map.release(redeclMap);
          db.map.release(redeclNameMap);
          return;
        }
      }

      db.map.release(seenMap);
      db.map.release(nameMap);
      db.map.release(innerMap);
      db.map.release(redeclMap);
      db.map.release(redeclNameMap);
    },
  },

  /**
   * M4004: Unbalanced model (variable / equation count mismatch).
   */
  unbalancedModel: {
    nodes: ["class_definition"],
    severity: "warning",
    code: 4004,
    message: (target, eqCount, varCount) =>
      `Model '${target.name || target.text}' is not balanced: ${eqCount.asNumber()} equations for ${varCount.asNumber()} variables.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (
        isClassKind(db, node, "function") ||
        isClassKind(db, node, "record") ||
        isClassKind(db, node, "type") ||
        isClassKind(db, node, "connector") ||
        isClassKind(db, node, "package")
      ) {
        return;
      }
      let varCount = 0;
      let eqCount = 0;
      for (const clause of db.ast.getDescendants(node, $.component_clause)) {
        if (clause == 0 || isDescendantOfInnerClass(db, clause, node, $)) continue;
        if (hasTypePrefix(db, clause, "parameter", $) || hasTypePrefix(db, clause, "constant", $)) {
          continue;
        }
        for (const elem of db.ast.getDescendants(clause, $.component_declaration)) {
          if (elem == 0) continue;
          let dim = 1;
          for (const subs of db.ast.getDescendants(elem, $.array_subscripts)) {
            for (const sub of db.ast.getDescendants(subs, $.subscript)) {
              let parsedDim = 0;
              for (const num of db.ast.getDescendants(sub, $.unsigned_integer)) {
                parsedDim = db.ast.parseInteger(num);
                break;
              }
              if (parsedDim == 0 && $.number != 0) {
                for (const num of db.ast.getDescendants(sub, $.number)) {
                  parsedDim = db.ast.parseInteger(num);
                  break;
                }
              }
              if (parsedDim == 0) {
                for (const id of db.ast.getDescendants(sub, $.identifier)) {
                  for (const pClause of db.ast.getDescendants(node, $.component_clause)) {
                    if (pClause == 0 || isDescendantOfInnerClass(db, pClause, node, $)) continue;
                    if (!hasTypePrefix(db, pClause, "parameter", $)) continue;
                    for (const decl of db.ast.getDescendants(pClause, $.declaration)) {
                      let match = false;
                      for (const pId of db.ast.getDescendants(decl, $.identifier)) {
                        if (db.ast.textEqualsNode(id, pId)) {
                          match = true;
                          break;
                        }
                        break;
                      }
                      if (match) {
                        for (const num of db.ast.getDescendants(decl, $.unsigned_integer)) {
                          parsedDim = db.ast.parseInteger(num);
                          break;
                        }
                        if (parsedDim == 0 && $.number != 0) {
                          for (const num of db.ast.getDescendants(decl, $.number)) {
                            parsedDim = db.ast.parseInteger(num);
                            break;
                          }
                        }
                      }
                      if (parsedDim > 0) break;
                    }
                    if (parsedDim > 0) break;
                  }
                  break;
                }
              }
              if (parsedDim > 0) {
                dim *= parsedDim;
              }
            }
          }
          varCount += dim;
        }
      }
      if ($.component_clause1 != 0) {
        for (const clause of db.ast.getDescendants(node, $.component_clause1)) {
          if (clause == 0 || isDescendantOfInnerClass(db, clause, node, $)) continue;
          if (hasTypePrefix(db, clause, "parameter", $) || hasTypePrefix(db, clause, "constant", $)) continue;
          varCount++;
        }
      }

      for (const eq of db.ast.getDescendants(node, $.simple_equation)) {
        if (eq != 0 && !isDescendantOfInnerClass(db, eq, node, $)) eqCount++;
      }
      if (varCount > 0 && eqCount > 0 && varCount != eqCount) {
        let targetNode = node;
        for (const spec of db.ast.getDescendants(node, $.long_class_specifier)) {
          const nameId = db.ast.getChildByFieldId(spec, "name");
          if (nameId != 0) targetNode = nameId;
          else targetNode = spec;
          break;
        }
        for (const spec of db.ast.getDescendants(node, $.short_class_specifier)) {
          const nameId = db.ast.getChildByFieldId(spec, "name");
          if (nameId != 0) targetNode = nameId;
          else targetNode = spec;
          break;
        }
        db.diagnostic(targetNode, eqCount, varCount);
      }
    },
  },

  /**
   * M4027: Parameter with continuous binding.
   */
  variabilityBindingMismatch: {
    nodes: ["declaration"],
    severity: "error",
    code: 4027,
    message: (target) =>
      `Component '${target.text}' of variability parameter has binding of higher continuous variability.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const comp of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(comp) == $.component_clause) {
          for (const pfx of db.ast.getDescendants(comp, $.type_prefix)) {
            if (db.ast.textEquals(pfx, "parameter")) {
              let binding: u32 = 0;
              for (const mod of db.ast.getDescendants(node, $.modification_expression)) {
                binding = mod;
                break;
              }
              if (binding != 0) {
                const varb = getExpressionVariability(db, binding, $);
                if (varb == VARIABILITY_CONTINUOUS) {
                  db.diagnostic(binding);
                }
              }
            }
          }
          break;
        }
      }
    },
  },

  /**
   * M4030: Modifier applied directly to outer element.
   */
  outerModifier: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4030,
    message: (target) => `Modifier found on outer element '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const pfx of db.ast.getDescendants(node, $.type_prefix)) {
        if (db.ast.textEquals(pfx, "outer")) {
          for (const mod of db.ast.getDescendants(node, $.modification)) {
            db.diagnostic(mod);
            break;
          }
        }
      }
    },
  },

  /**
   * M4034: Base class of extends cannot be replaceable.
   */
  replaceableBaseClass: {
    nodes: ["extends_clause"],
    severity: "error",
    code: 4034,
    message: (target) => `Base class '${target.text}' in extends is replaceable.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const typeSpec of db.ast.getDescendants(node, $.type_specifier)) {
        const sym = db.scope.resolve(typeSpec);
        if (sym != 0 && db.model.hasFlag(sym, "isReplaceable")) {
          db.diagnostic(node);
        }
        break;
      }
    },
  },

  /**
   * M4043: Constant variable has binding with higher variability.
   */
  constantVariabilityViolation: {
    nodes: ["declaration"],
    severity: "error",
    code: 4043,
    message: (target) => `Component '${target.text}' of variability constant has binding of higher variability.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const comp of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(comp) == $.component_clause) {
          for (const pfx of db.ast.getDescendants(comp, $.type_prefix)) {
            if (db.ast.textEquals(pfx, "constant")) {
              let binding: u32 = 0;
              for (const mod of db.ast.getDescendants(node, $.modification_expression)) {
                binding = mod;
                break;
              }
              if (binding != 0) {
                const varb = getExpressionVariability(db, binding, $);
                if (varb == VARIABILITY_CONTINUOUS) {
                  db.diagnostic(binding);
                }
              }
            }
          }
          break;
        }
      }
    },
  },

  /**
   * M4044: Non-array modification on array component.
   */
  nonArrayModification: {
    nodes: ["element_modification"],
    severity: "error",
    code: 4044,
    message: (target) => `Non-array modification '${target.text}' for array component, possibly due to missing 'each'.`,
    query: (db: CodeGraph, node: u32) => {
      const name = db.ast.getChildByFieldId(node, "name");
      if (name != 0) {
        const sym = db.scope.resolve(name);
        if (sym != 0 && db.model.hasFlag(sym, "isArray")) {
          const hasEach = db.ast.getChildByFieldId(node, "each") != 0;
          if (!hasEach) {
            db.diagnostic(node);
          }
        }
      }
    },
  },

  /**
   * M5010: Variables in elsewhen clause must match when clause.
   */
  elsewhenVariableMismatch: {
    nodes: ["when_equation", "when_statement"],
    severity: "error",
    code: 5010,
    message: () => `The same variables must be solved in elsewhen clause as in the when clause.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const elsewhen = db.ast.getChildByFieldId(node, "elsewhen");
      if (elsewhen != 0) {
        const whenVars = db.set.create();
        const elseVars = db.set.create();
        for (const eq of db.ast.getDescendants(node, $.simple_equation)) {
          const lhs = db.ast.getChildByFieldId(eq, "lhs");
          if (lhs != 0) {
            const span = db.ast.getTextSpan(lhs);
            db.set.add(whenVars, db.hash.span64(span));
          }
        }
        for (const eq of db.ast.getDescendants(elsewhen, $.simple_equation)) {
          const lhs = db.ast.getChildByFieldId(eq, "lhs");
          if (lhs != 0) {
            const span = db.ast.getTextSpan(lhs);
            db.set.add(elseVars, db.hash.span64(span));
          }
        }
        db.set.release(whenVars);
        db.set.release(elseVars);
      }
    },
  },

  /**
   * M4039: Discrete variable not on LHS of when-statement.
   */
  discreteNotOnLhs: {
    nodes: ["simple_equation"],
    severity: "error",
    code: 4039,
    message: (target) =>
      `Following variable is discrete, but does not appear on the LHS of a when-statement: '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const lhs = db.ast.getChildByFieldId(node, "lhs");
      if (lhs != 0) {
        const sym = db.scope.resolve(lhs);
        if (sym != 0 && db.model.hasFlag(sym, "isDiscrete")) {
          let inWhen = false;
          for (const anc of db.ast.getAncestors(node, 0)) {
            const type = db.ast.getType(anc);
            if (type == $.when_equation || type == $.when_statement) {
              inWhen = true;
              break;
            }
          }
          if (!inWhen) {
            db.diagnostic(lhs);
          }
        }
      }
    },
  },

  /**
   * M4045: Modified element / attribute not found in class or built-in type.
   */
  modifiedElementNotFound: {
    nodes: ["element_modification", "inheritance_modification"],
    severity: "error",
    code: 4045,
    message: (target, typeName, elemName) =>
      `Modified element ${elemName && elemName.text !== "0" && elemName.text !== "" ? elemName.text : target.text} not found in class ${typeName.text}.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const isInheritanceMod = $.inheritance_modification != 0 && db.ast.getType(node) == $.inheritance_modification;
      let nameNode: u32 = 0;
      if (isInheritanceMod) {
        if ($.connect_equation != 0) {
          for (const c of db.ast.getDescendants(node, $.connect_equation)) {
            return;
          }
        }
        for (const id of db.ast.getDescendants(node, $.identifier)) {
          nameNode = id;
          break;
        }
      } else {
        for (const n of db.ast.getDescendants(node, $.name)) {
          nameNode = n;
          break;
        }
      }
      if (nameNode == 0) return;

      // Find enclosing component_clause1, element_redeclaration, component_clause or extends_clause
      let parentDecl: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const type = db.ast.getType(anc);
        if (($.annotation != 0 && type == $.annotation) || ($.annotation_clause != 0 && type == $.annotation_clause)) {
          return;
        }
        if (
          type == $.component_clause1 ||
          type == $.element_redeclaration ||
          type == $.component_clause ||
          type == $.extends_clause
        ) {
          parentDecl = anc;
          break;
        }
      }
      if (parentDecl == 0) return;

      let typeNode: u32 = 0;
      for (const t of db.ast.getDescendants(parentDecl, $.type_specifier)) {
        typeNode = t;
        break;
      }
      if (typeNode == 0) return;

      let baseTypeId: u32 = typeNode;
      for (const id of db.ast.getDescendants(typeNode, $.identifier)) {
        baseTypeId = id;
      }

      // Check primitive or derived primitive types
      const primType = resolveBasePrimitiveType(db, typeNode, $);

      if (isInheritanceMod) {
        if (primType != TYPE_UNKNOWN) return; // Handled by breakOnNonComponent
        const docRoot = db.ast.getRootNode();
        if (docRoot == 0) return;
        for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
          const cName = db.ast.getChildByFieldId(spec, "name");
          if (cName != 0 && db.ast.textEqualsNode(baseTypeId, cName)) {
            let classDef: u32 = spec;
            for (const anc of db.ast.getAncestors(spec, 0)) {
              if (db.ast.getType(anc) == $.class_definition) {
                classDef = anc;
                break;
              }
            }
            const memberKind = getMemberKindInClass(db, classDef, nameNode, $);
            if (memberKind == MEMBER_NONE) {
              db.diagnostic(node, baseTypeId, nameNode);
            }
            return;
          }
        }
        for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
          const cName = db.ast.getChildByFieldId(spec, "name");
          if (cName != 0 && db.ast.textEqualsNode(baseTypeId, cName)) {
            let classDef: u32 = spec;
            for (const anc of db.ast.getAncestors(spec, 0)) {
              if (db.ast.getType(anc) == $.class_definition) {
                classDef = anc;
                break;
              }
            }
            const memberKind = getMemberKindInClass(db, classDef, nameNode, $);
            if (memberKind == MEMBER_NONE) {
              db.diagnostic(node, baseTypeId, nameNode);
            }
            return;
          }
        }
        return;
      }

      // Check if this element_modification is nested inside an outer element_modification
      let outerMod: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == parentDecl) break;
        if (anc != node && db.ast.getType(anc) == $.element_modification) {
          outerMod = anc;
          break;
        }
      }

      if (outerMod != 0) {
        let outerName: u32 = 0;
        for (const n of db.ast.getDescendants(outerMod, $.name)) {
          outerName = n;
          break;
        }
        if (outerName != 0) {
          const targetClass = findClassByName(db, typeNode, $);
          if (targetClass != 0) {
            // a) Is outerName a component in targetClass?
            const compType = findComponentTypeInClass(db, targetClass, outerName, $);
            if (compType != 0) {
              const compPrim = resolveBasePrimitiveType(db, compType, $);
              if (compPrim != TYPE_UNKNOWN) {
                if (isPrimitiveAttribute(db, compPrim, nameNode)) {
                  return;
                }
                db.diagnostic(node, outerName, nameNode);
                return;
              }
              const compClass = findClassByName(db, compType, $);
              if (compClass != 0) {
                if (!isVariableDeclaredInClass(db, compClass, nameNode, $)) {
                  db.diagnostic(node, outerName, nameNode);
                }
                return;
              }
            }

            // b) Is outerName an inner class or type alias in targetClass?
            const innerCls = resolveComponentClassDefinition(db, targetClass, outerName, $);
            if (innerCls != 0) {
              let aliasPrim: u16 = TYPE_UNKNOWN;
              for (const spec of db.ast.getDescendants(innerCls, $.short_class_specifier)) {
                for (const ts of db.ast.getDescendants(spec, $.type_specifier)) {
                  aliasPrim = resolveBasePrimitiveType(db, ts, $);
                  break;
                }
              }
              if (aliasPrim != TYPE_UNKNOWN) {
                if (isPrimitiveAttribute(db, aliasPrim, nameNode)) {
                  return;
                }
                db.diagnostic(node, outerName, nameNode);
                return;
              }
              if (!isVariableDeclaredInClass(db, innerCls, nameNode, $)) {
                db.diagnostic(node, outerName, nameNode);
              }
              return;
            }
          }
        }
        return;
      }

      // Direct modifier on primitive type (outerMod == 0)
      if (primType != TYPE_UNKNOWN) {
        if (!isPrimitiveAttribute(db, primType, nameNode)) {
          db.diagnostic(nameNode, baseTypeId);
        }
        return;
      }

      // Check user-defined classes
      const targetClass = findClassByName(db, typeNode, $);
      if (targetClass != 0) {
        let idCount: u32 = 0;
        for (const id of db.ast.getDescendants(nameNode, $.identifier)) {
          idCount++;
        }

        if (idCount > 1) {
          let currClass = targetClass;
          let idx: u32 = 0;
          for (const id of db.ast.getDescendants(nameNode, $.identifier)) {
            if (idx == idCount - 1) {
              if (!isVariableDeclaredInClass(db, currClass, id, $)) {
                db.diagnostic(node, baseTypeId, nameNode);
              }
              return;
            }
            const compType = findComponentTypeInClass(db, currClass, id, $);
            if (compType != 0) {
              const compPrim = resolveBasePrimitiveType(db, compType, $);
              if (compPrim != TYPE_UNKNOWN) {
                if (idx == idCount - 2) {
                  let leafId: u32 = 0;
                  for (const lid of db.ast.getDescendants(nameNode, $.identifier)) {
                    leafId = lid;
                  }
                  if (isPrimitiveAttribute(db, compPrim, leafId)) {
                    return;
                  }
                }
                db.diagnostic(node, baseTypeId, nameNode);
                return;
              }
              const nextClass = findClassByName(db, compType, $);
              if (nextClass == 0) {
                db.diagnostic(node, baseTypeId, nameNode);
                return;
              }
              currClass = nextClass;
            } else {
              const innerCls = resolveComponentClassDefinition(db, currClass, id, $);
              if (innerCls != 0) {
                currClass = innerCls;
              } else {
                db.diagnostic(node, baseTypeId, nameNode);
                return;
              }
            }
            idx++;
          }
          return;
        }

        if (!isVariableDeclaredInClass(db, targetClass, nameNode, $)) {
          db.diagnostic(node, baseTypeId, nameNode);
        }
        return;
      }
    },
  },

  /**
   * M4049: Invalid use of break on non-component.
   */
  breakOnNonComponent: {
    nodes: ["inheritance_modification"],
    severity: "error",
    code: 4049,
    message: (target, ident) => `Invalid use of break on non-component '${ident ? ident.text : target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if ($.connect_equation != 0) {
        for (const c of db.ast.getDescendants(node, $.connect_equation)) {
          return;
        }
      }

      let identNode: u32 = 0;
      for (const id of db.ast.getDescendants(node, $.identifier)) {
        identNode = id;
        break;
      }
      if (identNode == 0) return;

      let extClause: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.extends_clause) {
          extClause = anc;
          break;
        }
      }
      if (extClause == 0) return;

      let typeNode: u32 = 0;
      for (const t of db.ast.getDescendants(extClause, $.type_specifier)) {
        typeNode = t;
        break;
      }
      if (typeNode == 0) return;

      let baseTypeId: u32 = typeNode;
      for (const id of db.ast.getDescendants(typeNode, $.identifier)) {
        baseTypeId = id;
        break;
      }

      // Check primitive base class (e.g. extends Real(break start))
      const primType = resolveBasePrimitiveType(db, baseTypeId, $);
      if (primType != TYPE_UNKNOWN) {
        db.diagnostic(node, identNode);
        return;
      }

      const docRoot = db.ast.getRootNode();
      if (docRoot == 0) return;
      for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
        const cName = db.ast.getChildByFieldId(spec, "name");
        if (cName != 0 && db.ast.textEqualsNode(baseTypeId, cName)) {
          let classDef: u32 = spec;
          for (const anc of db.ast.getAncestors(spec, 0)) {
            if (db.ast.getType(anc) == $.class_definition) {
              classDef = anc;
              break;
            }
          }
          const memberKind = getMemberKindInClass(db, classDef, identNode, $);
          if (memberKind == MEMBER_CLASS) {
            db.diagnostic(node, identNode);
          }
          return;
        }
      }
    },
  },

  /**
   * M4050: Invalid use of break on component of invalid type (must be model, block, or connector).
   */
  breakComponentInvalidType: {
    nodes: ["inheritance_modification"],
    severity: "error",
    code: 4050,
    message: (target, ident) =>
      `Invalid use of break on component '${ident ? ident.text : target.text}', component must be a model, block, or connector.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if ($.connect_equation != 0) {
        for (const c of db.ast.getDescendants(node, $.connect_equation)) {
          return;
        }
      }
      let identNode: u32 = 0;
      for (const id of db.ast.getDescendants(node, $.identifier)) {
        identNode = id;
        break;
      }
      if (identNode == 0) return;

      let extClause: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.extends_clause) {
          extClause = anc;
          break;
        }
      }
      if (extClause == 0) return;

      let typeNode: u32 = 0;
      for (const t of db.ast.getDescendants(extClause, $.type_specifier)) {
        typeNode = t;
        break;
      }
      if (typeNode == 0) return;

      let baseTypeId: u32 = typeNode;
      for (const id of db.ast.getDescendants(typeNode, $.identifier)) {
        baseTypeId = id;
        break;
      }

      const docRoot = db.ast.getRootNode();
      if (docRoot == 0) return;
      for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
        const cName = db.ast.getChildByFieldId(spec, "name");
        if (cName != 0 && db.ast.textEqualsNode(baseTypeId, cName)) {
          let classDef: u32 = spec;
          for (const anc of db.ast.getAncestors(spec, 0)) {
            if (db.ast.getType(anc) == $.class_definition) {
              classDef = anc;
              break;
            }
          }
          const memberKind = getMemberKindInClass(db, classDef, identNode, $);
          if (memberKind == MEMBER_RECORD_COMPONENT) {
            db.diagnostic(node, identNode);
          }
          return;
        }
      }
    },
  },

  /**
   * M4051: No matching element found for break connect.
   */
  breakConnectNotFound: {
    nodes: ["inheritance_modification"],
    severity: "error",
    code: 4051,
    message: (target) => `No matching element found for '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let connNode: u32 = 0;
      for (const c of db.ast.getDescendants(node, $.connect_equation)) {
        connNode = c;
        break;
      }
      if (connNode == 0) return;

      let extClause: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.extends_clause) {
          extClause = anc;
          break;
        }
      }
      if (extClause == 0) return;

      const ep1 = db.ast.getChildByFieldId(connNode, "lhs");
      const ep2 = db.ast.getChildByFieldId(connNode, "rhs");
      if (ep1 == 0 || ep2 == 0) return;

      // Check if ep1 or ep2 was broken by an earlier break in extClause
      for (const brk of db.ast.getDescendants(extClause, $.inheritance_modification)) {
        if (brk == node) break;
        for (const id of db.ast.getDescendants(brk, $.identifier)) {
          let ep1Root: u32 = ep1;
          for (const i of db.ast.getDescendants(ep1, $.identifier)) {
            ep1Root = i;
            break;
          }
          let ep2Root: u32 = ep2;
          for (const i of db.ast.getDescendants(ep2, $.identifier)) {
            ep2Root = i;
            break;
          }
          if (db.ast.textEqualsNode(id, ep1Root) || db.ast.textEqualsNode(id, ep2Root)) {
            db.diagnostic(node);
            return;
          }
        }
      }

      let typeNode: u32 = 0;
      for (const t of db.ast.getDescendants(extClause, $.type_specifier)) {
        typeNode = t;
        break;
      }
      if (typeNode == 0) return;

      let baseTypeId: u32 = typeNode;
      for (const id of db.ast.getDescendants(typeNode, $.identifier)) {
        baseTypeId = id;
        break;
      }

      const docRoot = db.ast.getRootNode();
      if (docRoot == 0) return;
      for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
        const cName = db.ast.getChildByFieldId(spec, "name");
        if (cName != 0 && db.ast.textEqualsNode(baseTypeId, cName)) {
          let classDef: u32 = spec;
          for (const anc of db.ast.getAncestors(spec, 0)) {
            if (db.ast.getType(anc) == $.class_definition) {
              classDef = anc;
              break;
            }
          }
          if (!hasMatchingConnectEquation(db, classDef, ep1, ep2, $)) {
            db.diagnostic(node);
          }
          return;
        }
      }
    },
  },
};
