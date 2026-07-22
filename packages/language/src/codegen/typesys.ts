import { LanguageOptions as GrammarOptions } from "../dsl.js";
import { getDJB2Hash } from "./utils.js";

export function generateTypeSystem(grammar: GrammarOptions, customCode: string): string {
  let subtypingLogic = "";
  if (grammar.typeSystem?.subtypingPredicates) {
    for (const pred of grammar.typeSystem.subtypingPredicates) {
      subtypingLogic += `  if (factExists(${getDJB2Hash(pred)}, sourceId, targetId)) return true;\n`;
    }
  }

  if (!customCode) {
    customCode = `
// Default C-like Type Kinds
export const TYPE_PRIMITIVE: u16 = 0;
export const TYPE_POINTER: u16 = 1;
export const TYPE_ARRAY: u16 = 2;
export const TYPE_STRUCT: u16 = 3;
export const TYPE_FUNCTION: u16 = 4;
export const TYPE_ERROR: u16 = 5;

// Basic assignability logic
export function isAssignableTo(targetId: u32, sourceId: u32): boolean {
  if (targetId == sourceId) return true;
${subtypingLogic}
  let tKind = getTypeKind(targetId);
  let sKind = getTypeKind(sourceId);
  if (tKind == TYPE_ERROR || sKind == TYPE_ERROR) return true;
  if (tKind == TYPE_POINTER && sKind == TYPE_POINTER) {
     return isAssignableTo(getTypeBase(targetId), getTypeBase(sourceId));
  }
  return false;
}
`;
  } else {
    let extraTypes = "";
    if (!customCode.includes("TYPE_POINTER")) extraTypes += "export const TYPE_POINTER: u16 = 901;\n";
    if (!customCode.includes("TYPE_ARRAY")) extraTypes += "export const TYPE_ARRAY: u16 = 902;\n";
    if (!customCode.includes("TYPE_FUNCTION")) extraTypes += "export const TYPE_FUNCTION: u16 = 903;\n";
    if (!customCode.includes("TYPE_ERROR")) extraTypes += "export const TYPE_ERROR: u16 = 904;\n";
    customCode = extraTypes + customCode;
  }

  return `import { ChunkedUint32Array, UnmanagedUint32Array } from "./array";
import { getNodeType, getNodeFirstChild, getNodeNextSibling, getNodePadding, getNodeByteLength, allocNode, arenaOffset } from "./arena";
import { allocDiagnostic } from "./lsp";
import { factExists } from "./reasoner";
import { resolveFqnSymbol } from "./graph";

// Semantic Analysis & Type System Engine
// Generated for language: ${grammar.name}
// High-performance Type Arena in Linear Memory

// Type Node represented in a ChunkedUint32Array (Stride: 6 u32s)
// [idx+0]: kind (u16) | flags (u16 << 16)
// [idx+1]: size (u32)
// [idx+2]: baseTypeId / parent (u32)  — UF parent for TYPE_VARIABLE
// [idx+3]: extraData (u32)
// [idx+4]: ctorTag (u32)   — HM constructor: 0=none, 1=Function, 2=Array, etc.
// [idx+5]: ctorArg2 (u32)  — second constructor param

export const TYPE_STRIDE: u32 = 6;
export let typeTable = new ChunkedUint32Array(600000); // Up to 100k types
export let typeCount: u32 = 1; // 0 is reserved for null type

export const TYPE_VARIABLE: u16 = 6;
export const TYPE_TENSOR: u16 = 7;
export const TYPE_SPARSE_TENSOR: u16 = 8;
export const TYPE_UNION: u16 = 9;
export const TYPE_INTERSECTION: u16 = 10;
export const TYPE_LITERAL: u16 = 11;
export const TYPE_CONDITIONAL: u16 = 12;
export const TYPE_MAPPED: u16 = 13;
export const TYPE_RECORD: u16 = 14;
export const TYPE_RECORD_FIELD: u16 = 15;

// --- Unified Constraint-Based Type Engine ---
// Merges arena storage, HM union-find, constructor matching, occurs check,
// subtyping, and diagnostic emission into a single engine.

// Constructor tags (HM polymorphic types)
export const CTOR_NONE: u32     = 0;
export const CTOR_FUNCTION: u32 = 1; // Function(argType, returnType)
export const CTOR_ARRAY: u32    = 2; // Array(elemType)
export const CTOR_POINTER: u32  = 3; // Pointer(innerType)
export const CTOR_CUSTOM: u32   = 4; // Custom polymorphic type (e.g. List<T>)
export const CTOR_TENSOR: u32   = 5; // Tensor(elemType, shapeList)
export const CTOR_SPARSE_TENSOR: u32 = 6;
export const CTOR_SHAPE_CONS: u32 = 7;
export const CTOR_SHAPE_NIL: u32 = 8;

// Error tracking for diagnostics
export let unifyErrorCount: u32 = 0;
let unifyErrorNodes = new ChunkedUint32Array(10000);
export function getUnifyErrorCount(): u32 { return unifyErrorCount; }

export function allocTypeVar(): u32 {
   return allocType(TYPE_VARIABLE, 0, 0, 0);
}

export function typeFind(typeId: u32): u32 {
   if (typeId == 0) return 0;
   // Iterative root-finding
   let root = typeId;
   while (true) {
       if (getTypeKind(root) != TYPE_VARIABLE) break;
       let parent = getTypeBase(root);
       if (parent == 0) break;
       root = parent;
   }
   // Iterative path compression
   let curr = typeId;
   while (curr != root) {
       if (getTypeKind(curr) != TYPE_VARIABLE) break;
       let parent = getTypeBase(curr);
       if (parent == 0) break;
       typeTable[curr * TYPE_STRIDE + 2] = root; // set parent
       curr = parent;
   }
   return root;
}

// --- Unified Unification Engine ---
// Merges arena-based structural unification with HM constructor matching.
// Handles: type variables, concrete kind matching, constructor recursion,
// occurs check, union/intersection subtyping, and error tracking.

function occursIn(varId: u32, typeId: u32): boolean {
    let root = typeFind(typeId);
    if (root == varId) return true;
    if (root == 0) return false;
    let kind = getTypeKind(root);
    if (kind != TYPE_VARIABLE) return false;
    // Recurse into constructor args
    let tag = getTypeCtorTag(root);
    if (tag != CTOR_NONE) {
        let arg1 = getTypeBase(root);
        let arg2 = getTypeCtorArg2(root);
        if (arg1 != 0 && occursIn(varId, arg1)) return true;
        if (arg2 != 0 && occursIn(varId, arg2)) return true;
    }
    return false;
}

export function unify(t1: u32, t2: u32): boolean {
   let root1 = typeFind(t1);
   let root2 = typeFind(t2);
   
   if (root1 == root2) return true;
   if (root1 == 0 || root2 == 0) return root1 == 0 && root2 == 0;
   
   let kind1 = getTypeKind(root1);
   let kind2 = getTypeKind(root2);
   let ctor1 = getTypeCtorTag(root1);
   let ctor2 = getTypeCtorTag(root2);
   
   // Case 1: One or both are type variables → bind
   if (kind1 == TYPE_VARIABLE && ctor1 == CTOR_NONE) {
       // Occurs check
       if (ctor2 != CTOR_NONE && occursIn(root1, root2)) {
           unifyErrorCount++;
           return false;
       }
       typeTable[root1 * TYPE_STRIDE + 2] = root2; // Set parent
       return true;
   }
   if (kind2 == TYPE_VARIABLE && ctor2 == CTOR_NONE) {
       if (ctor1 != CTOR_NONE && occursIn(root2, root1)) {
           unifyErrorCount++;
           return false;
       }
       typeTable[root2 * TYPE_STRIDE + 2] = root1;
       return true;
   }
   
   // Case 2: Both have constructors → must match and recurse
   if (ctor1 != CTOR_NONE && ctor2 != CTOR_NONE) {
       if (ctor1 != ctor2) {
           unifyErrorCount++;
           return false; // Constructor mismatch: Function vs Array
       }
       // Recursively unify constructor parameters
       let arg1_1 = getTypeBase(root1);
       let arg1_2 = getTypeBase(root2);
       if (!unify(arg1_1, arg1_2)) return false;
       let arg2_1 = getTypeCtorArg2(root1);
       let arg2_2 = getTypeCtorArg2(root2);
       if (arg2_1 != 0 || arg2_2 != 0) {
           if (!unify(arg2_1, arg2_2)) return false;
       }
       // Merge: make root2 point to root1
       typeTable[root2 * TYPE_STRIDE + 2] = root1;
       return true;
   }
   
   // Case 3: One has constructor, other is variable with kind → bind
   if (ctor1 != CTOR_NONE && kind2 == TYPE_VARIABLE) {
       typeTable[root2 * TYPE_STRIDE + 2] = root1;
       return true;
   }
   if (ctor2 != CTOR_NONE && kind1 == TYPE_VARIABLE) {
       typeTable[root1 * TYPE_STRIDE + 2] = root2;
       return true;
   }
   
   // Case 4: Both are concrete non-variable types → structural check
   if (kind1 != kind2) {
       unifyErrorCount++;
       return false;
   }
   
   // Same kind: recursively unify base types
   let base1 = getTypeBase(root1);
   let base2 = getTypeBase(root2);
   if (base1 != 0 || base2 != 0) {
       if (!unify(base1, base2)) return false;
   }
   
   return true;
}

// Convenience: unify and return numeric result for compatibility
export function unifyTypes(i: u32, j: u32): u32 {
    return unify(i, j) ? 1 : 0;
}

export function findType(i: u32): u32 { return typeFind(i); }

export function getConcreteType(i: u32): u32 {
    let root = typeFind(i);
    return root != 0 ? <u32>getTypeKind(root) : 0;
}

export function getConstructorTag(i: u32): u32 {
    let root = typeFind(i);
    return root != 0 ? getTypeCtorTag(root) : 0;
}

export function getConstructorArg1(i: u32): u32 {
    let root = typeFind(i);
    return root != 0 ? getTypeBase(root) : 0;
}

export function getConstructorArg2(i: u32): u32 {
    let root = typeFind(i);
    return root != 0 ? getTypeCtorArg2(root) : 0;
}

export function newTypeVar(): u32 {
    return allocTypeVar();
}

export function assignConcreteType(i: u32, kind: u32): u32 {
    let root = typeFind(i);
    if (root == 0) return 0;
    let existing = <u32>getTypeKind(root);
    if (existing != <u32>TYPE_VARIABLE && existing != kind) {
        unifyErrorCount++;
        return 0;
    }
    let word0 = typeTable[root * TYPE_STRIDE];
    typeTable[root * TYPE_STRIDE] = (word0 & 0xffff0000) | (kind & 0xffff);
    return 1;
}

export function constrainEqual(nodeA: u32, nodeB: u32): u32 {
    if (nodeA == 0 || nodeB == 0) return 1;
    let tA = getTypeOfNode(nodeA);
    let tB = getTypeOfNode(nodeB);
    let result = unifyTypes(tA, tB);
    if (result == 0) {
        unifyErrorNodes[unifyErrorCount] = nodeA;
    }
    return result;
}

export function initTypeArena(start: u32, sizeBytes: u32): void {
  // Arena unused in chunked mode
}

export function allocType(kind: u16, size: u32, baseType: u32, extra: u32): u32 {
  let id = typeCount++;
  let idx = id * TYPE_STRIDE;
  typeTable[idx] = kind; // flags = 0
  typeTable[idx + 1] = size;
  typeTable[idx + 2] = baseType;
  typeTable[idx + 3] = extra;
  typeTable[idx + 4] = CTOR_NONE;
  typeTable[idx + 5] = 0; // ctorArg2
  return id;
}

export function getTypeKind(typeId: u32): u16 { return (typeTable[typeId * TYPE_STRIDE] & 0xffff) as u16; }
export function getTypeFlags(typeId: u32): u16 { return (typeTable[typeId * TYPE_STRIDE] >>> 16) as u16; }
export function getTypeSize(typeId: u32): u32 { return typeTable[typeId * TYPE_STRIDE + 1]; }
export function getTypeBase(typeId: u32): u32 { return typeTable[typeId * TYPE_STRIDE + 2]; }
export function getTypeExtra(typeId: u32): u32 { return typeTable[typeId * TYPE_STRIDE + 3]; }
export function getTypeCtorTag(typeId: u32): u32 { return typeTable[typeId * TYPE_STRIDE + 4]; }
export function getTypeCtorArg2(typeId: u32): u32 { return typeTable[typeId * TYPE_STRIDE + 5]; }

// --- Constructor Builders ---

export function makeFunctionType(argType: u32, retType: u32): u32 {
    let ptr = allocType(TYPE_VARIABLE, 0, argType, 0);
    typeTable[ptr * TYPE_STRIDE + 4] = CTOR_FUNCTION;
    typeTable[ptr * TYPE_STRIDE + 5] = retType;
    return ptr;
}

export function makeArrayType(elemType: u32): u32 {
    let ptr = allocType(TYPE_VARIABLE, 0, elemType, 0);
    typeTable[ptr * TYPE_STRIDE + 4] = CTOR_ARRAY;
    return ptr;
}

export function makePointerType(innerType: u32): u32 {
    let ptr = allocType(TYPE_VARIABLE, 0, innerType, 0);
    typeTable[ptr * TYPE_STRIDE + 4] = CTOR_POINTER;
    return ptr;
}

export function makeCustomType(typeId: u32, arg1: u32, arg2: u32): u32 {
    let ptr = allocType(TYPE_VARIABLE, typeId, arg1, 0);
    typeTable[ptr * TYPE_STRIDE + 4] = CTOR_CUSTOM;
    typeTable[ptr * TYPE_STRIDE + 5] = arg2;
    return ptr;
}

export function makeTensorType(elemType: u32, shapeList: u32): u32 {
    let ptr = allocType(TYPE_VARIABLE, 0, elemType, 0);
    typeTable[ptr * TYPE_STRIDE + 4] = CTOR_TENSOR;
    typeTable[ptr * TYPE_STRIDE + 5] = shapeList;
    return ptr;
}

export function makeShapeCons(dimVar: u32, tailShape: u32): u32 {
    let ptr = allocType(TYPE_VARIABLE, 0, dimVar, 0);
    typeTable[ptr * TYPE_STRIDE + 4] = CTOR_SHAPE_CONS;
    typeTable[ptr * TYPE_STRIDE + 5] = tailShape;
    return ptr;
}

export function makeShapeNil(): u32 {
    let ptr = allocType(TYPE_VARIABLE, 0, 0, 0);
    typeTable[ptr * TYPE_STRIDE + 4] = CTOR_SHAPE_NIL;
    return ptr;
}

// --- Phase 2: Directional Subtyping Engine ---
// Tracks lower bounds for HM variables
export function addLowerBound(varId: u32, boundId: u32): void {
    // Stub for directional constraint subtyping (HM lower bounds)
}

export function core_isAssignableTo(targetId: u32, sourceId: u32): boolean {
    if (targetId == sourceId) return true;
    if (targetId == 0 || sourceId == 0) return false;

    let tKind = getTypeKind(targetId);
    let sKind = getTypeKind(sourceId);

    // 1. Source is Union (A | B <: Target) -> Requires both A <: Target AND B <: Target
    if (sKind == TYPE_UNION) {
        let curr = sourceId;
        while (curr != 0 && getTypeKind(curr) == TYPE_UNION) {
            let variant = getTypeBase(curr);
            if (!core_isAssignableTo(targetId, variant)) return false;
            curr = getTypeExtra(curr);
        }
        return true;
    }

    // 2. Target is Union (Source <: A | B) -> Requires Source <: A OR Source <: B
    if (tKind == TYPE_UNION) {
        let curr = targetId;
        while (curr != 0 && getTypeKind(curr) == TYPE_UNION) {
            let variant = getTypeBase(curr);
            if (core_isAssignableTo(variant, sourceId)) return true;
            curr = getTypeExtra(curr);
        }
        return false;
    }

    // 3. HM Bridge: Bounded Unification
    if (tKind == TYPE_VARIABLE) {
        addLowerBound(targetId, sourceId);
        return true;
    }

    // 4. Modelica/TS Record Structural Compatibility
    if (tKind == TYPE_RECORD && sKind == TYPE_RECORD) {
        // iterate properties of target, ensure they exist in source
        let targetField = getTypeBase(targetId);
        while (targetField != 0) {
            let reqHash = getTypeExtra(targetField);
            let reqType = getTypeBase(targetField);
            
            let found = false;
            let sourceField = getTypeBase(sourceId);
            while (sourceField != 0) {
                if (getTypeExtra(sourceField) == reqHash) {
                    if (!core_isAssignableTo(reqType, getTypeBase(sourceField))) {
                        return false;
                    }
                    found = true;
                    break;
                }
                sourceField = getTypeCtorArg2(sourceField);
            }
            if (!found) return false;
            
            targetField = getTypeCtorArg2(targetField);
        }
        return true;
    }

    // Phase 6C: Directional Conjugation Support (S7)
    // If the grammar has directional vocabularies, we query the reasoner to see if 
    // the target and source are Conjugates. If so, we reverse the assignment check!
    // Prototype: assuming datalog_ask_string or similar is available.
    // if (datalog_ask_string("Conjugates(" + targetId.toString() + "," + sourceId.toString() + ")")) {
    //     return core_isAssignableTo(sourceId, targetId); // flipped
    // }

    // Fallback to user-defined rules
    return false;
}

// Symbol Node (32 bytes):
// +0: kind (u16)
// +2: flags (u16)
// +4: astNodePtr (u32)
// +8: parentSymbolPtr (u32)
// +12: firstChildPtr (u32)
// +16: nextSiblingPtr (u32)
// +20: nameStringPtr (u32)
// +24: typeId (u32)
// +28: argsPtr (u32) - For Virtual Specializations (Modelica Modifications/C++ Templates)

export const SYMBOL_KIND_LEXICAL: u16 = 0;
export const SYMBOL_KIND_VIRTUAL_SPECIALIZATION: u16 = 1;

export const SYMBOL_STRIDE: u32 = 8;
export let symbolTable = new ChunkedUint32Array(800000);
export let symbolCount: u32 = 1;

export let nodeScopeSymbols = new ChunkedUint32Array(100000);

export function getSymbolForNode(nodeId: u32): u32 {
    return nodeScopeSymbols.get(nodeId);
}

export function initScopeArena(start: u32, sizeBytes: u32): void {
  // Arena unused in chunked mode
}

export function allocSymbol(kind: u16, flags: u16, astNodePtr: u32, parentSymbolPtr: u32, nameStringPtr: u32, typeId: u32, argsPtr: u32): u32 {
  let id = symbolCount++;
  let idx = id * SYMBOL_STRIDE;
  
  symbolTable[idx] = kind | (flags << 16);
  symbolTable[idx + 1] = astNodePtr;
  symbolTable[idx + 2] = parentSymbolPtr;
  symbolTable[idx + 3] = 0; // firstChildPtr
  symbolTable[idx + 4] = 0; // nextSiblingPtr
  symbolTable[idx + 5] = nameStringPtr;
  symbolTable[idx + 6] = typeId;
  symbolTable[idx + 7] = argsPtr;
  
  // Link to parent
  if (parentSymbolPtr != 0) {
     let head = symbolTable[parentSymbolPtr * SYMBOL_STRIDE + 3];
     symbolTable[idx + 4] = head;
     symbolTable[parentSymbolPtr * SYMBOL_STRIDE + 3] = id;
  }
  
  if (astNodePtr != 0) {
      nodeScopeSymbols.set(astNodePtr, id);
  }
  
  return id;
}

// Helpers
export function getSymbolKind(id: u32): u16 { return (symbolTable[id * SYMBOL_STRIDE] & 0xffff) as u16; }
export function getSymbolFlags(id: u32): u16 { return (symbolTable[id * SYMBOL_STRIDE] >>> 16) as u16; }
export function getSymbolAstNode(id: u32): u32 { return symbolTable[id * SYMBOL_STRIDE + 1]; }
export function getSymbolParent(id: u32): u32 { return symbolTable[id * SYMBOL_STRIDE + 2]; }
export function getSymbolFirstChild(id: u32): u32 { return symbolTable[id * SYMBOL_STRIDE + 3]; }
export function getSymbolNextSibling(id: u32): u32 { return symbolTable[id * SYMBOL_STRIDE + 4]; }
export function getSymbolName(id: u32): u32 { return symbolTable[id * SYMBOL_STRIDE + 5]; }
export function getSymbolType(id: u32): u32 { return symbolTable[id * SYMBOL_STRIDE + 6]; }
export function getSymbolArgs(id: u32): u32 { return symbolTable[id * SYMBOL_STRIDE + 7]; }


// Environment / Scope Lookups
export function env_lookup(envSymbol: u32, targetNamePtr: u32): u32 {
  let curr = envSymbol;
  while (curr != 0) {
    // Check if it's a Virtual Specialization (overlay)
    if (getSymbolKind(curr) == SYMBOL_KIND_VIRTUAL_SPECIALIZATION) {
       // Traverse args overlay (linked list of modifications)
       let arg = getSymbolArgs(curr);
       while (arg != 0) {
          if (getSymbolName(arg) == targetNamePtr) {
             return arg;
          }
          arg = getSymbolNextSibling(arg);
       }
    }
    
    // Check local children in the lexical scope
    let child = getSymbolFirstChild(curr);
    while (child != 0) {
       if (getSymbolName(child) == targetNamePtr) {
          return child;
       }
       child = getSymbolNextSibling(child);
    }
    
    // Phase 3.1 & 6B: Check scoped imports attached to this lexical scope
    let impPtr = scopedImportHead;
    while (impPtr != 0) {
        if (load<u32>(impPtr, 0) == curr) {
            let visibility = load<u8>(impPtr + 12, 0);
            // Skip private imports if we are checking an outer scope from the perspective of an inner scope
            // For simplicity in prototype, if curr != envSymbol, we consider it "outside" the defining scope
            if (visibility == 0 || curr == envSymbol) {
                let moduleHash = load<u32>(impPtr + 4, 0);
                
                if (moduleHash == targetNamePtr) {
                    let resolved = resolveFqnSymbol(targetNamePtr);
                    if (resolved != 0) return resolved;
                } else {
                    // Recursive import support: Search inside the imported module's exported members
                    // Requires querying the AST node of the imported module to look inside it
                    let moduleNodeId = resolveFqnSymbol(moduleHash);
                    if (moduleNodeId != 0) {
                        let moduleSymbolId = getSymbolForNode(moduleNodeId);
                        if (moduleSymbolId != 0) {
                            let internalMatch = env_lookup(moduleSymbolId, targetNamePtr);
                            if (internalMatch != 0) return internalMatch;
                        }
                    }
                }
            }
        }
        impPtr = load<u32>(impPtr + 8, 0);
    }
    
    curr = getSymbolParent(curr);
  }
  // Phase 4B: Path Resolution via Fact Graph
  ${
    grammar.semantics && grammar.semantics.pathResolution
      ? `
  let factResolve = resolveDottedName(getSymbolAstNode(envSymbol), targetNamePtr);
  if (factResolve != 0) return factResolve;
  `
      : ""
  }

  // Phase 2.3: Fallback to Global FQN Registry if not found locally
  let globalResult = resolveFqnSymbol(targetNamePtr);
  if (globalResult != 0) return globalResult;
  // Phase 3.2: Fire resolve_module fallback to load external package
  ${
    grammar.moduleSystem && grammar.moduleSystem.resolve_module
      ? "moduleSystem_resolve_module(targetNamePtr);\n  return resolveFqnSymbol(targetNamePtr);"
      : "return 0;"
  }
}

export function env_specialize(baseClassSymbol: u32, argsPtr: u32): u32 {
    // Phase 3: Create a Virtual Specialization overlay environment.
    // The parent is the baseClassSymbol, allowing lookups to fall through to the base class lexical scope
    // after checking the arguments (argsPtr).
    return allocSymbol(SYMBOL_KIND_VIRTUAL_SPECIALIZATION, 0, getSymbolAstNode(baseClassSymbol), baseClassSymbol, getSymbolName(baseClassSymbol), getSymbolType(baseClassSymbol), argsPtr);
}

// Type Builder Runtime (Injected as '$' context)

// Phase 4: Hash Interning simulation
export function type_builder_pointer(baseTypeId: u32): u32 {
   // Scan existing types for a structural match
   for (let i = typeCount - 1; i >= 1; i--) {
       if (getTypeKind(i) == TYPE_POINTER && getTypeBase(i) == baseTypeId) {
           return i;
       }
   }
   return allocType(TYPE_POINTER, 8, baseTypeId, 0);
}

export function type_builder_array(baseTypeId: u32, lengthAstNode: u32): u32 {
   for (let i = typeCount - 1; i >= 1; i--) {
       if (getTypeKind(i) == TYPE_ARRAY && getTypeBase(i) == baseTypeId && getTypeExtra(i) == lengthAstNode) {
           return i;
       }
   }
   return allocType(TYPE_ARRAY, 0, baseTypeId, lengthAstNode);
}

export function type_builder_tensor(baseTypeId: u32, shapeId: u32): u32 {
   for (let i = typeCount - 1; i >= 1; i--) {
       if (getTypeKind(i) == TYPE_TENSOR && getTypeBase(i) == baseTypeId && getTypeExtra(i) == shapeId) {
           return i;
       }
   }
   return allocType(TYPE_TENSOR, 0, baseTypeId, shapeId);
}

export function type_builder_sparse_tensor(baseTypeId: u32, shapeId: u32, format: u32): u32 {
   for (let i = typeCount - 1; i >= 1; i--) {
       if (getTypeKind(i) == TYPE_SPARSE_TENSOR && getTypeBase(i) == baseTypeId && getTypeExtra(i) == shapeId && getTypeSize(i) == format) {
           return i;
       }
   }
   return allocType(TYPE_SPARSE_TENSOR, format, baseTypeId, shapeId);
}

// User-provided custom logic:
${customCode}

export function type_builder_record_field(nameHash: u32, fieldType: u32, nextField: u32): u32 {
   for (let i = typeCount - 1; i >= 1; i--) {
       if (getTypeKind(i) == TYPE_RECORD_FIELD && getTypeExtra(i) == nameHash && getTypeBase(i) == fieldType && getTypeCtorArg2(i) == nextField) {
           return i;
       }
   }
   let ptr = allocType(TYPE_RECORD_FIELD, 0, fieldType, nameHash);
   typeTable[ptr * TYPE_STRIDE + 5] = nextField; // ctorArg2 holds the next field
   return ptr;
}

export function type_builder_record(firstField: u32): u32 {
   for (let i = typeCount - 1; i >= 1; i--) {
       if (getTypeKind(i) == TYPE_RECORD && getTypeBase(i) == firstField) {
           return i;
       }
   }
   return allocType(TYPE_RECORD, 0, firstField, 0);
}

// --- Node ↔ TypeVariable Mapping ---

let nodeTypeVars = new ChunkedUint32Array(100000);

export function getTypeOfNode(nodeId: u32): u32 {
    if (nodeId == 0) return 0;
    let tv = nodeTypeVars[nodeId];
    if (tv == 0) {
        tv = allocTypeVar();
        nodeTypeVars[nodeId] = tv;
    }
    return tv;
}

// --- AST Traversal & Constraint Generation ---

let inferStack = new ChunkedUint32Array(1000000);

export function inferTypes(astRoot: u32): void {
    if (astRoot == 0) return;
    unifyErrorCount = 0;
    
    let top: u32 = 0;
    inferStack[top++] = astRoot;
    
    while (top > 0) {
        let node = inferStack[--top];
        if (node == 0) continue;
        
        let type = getNodeType(node);
        
        // Delegate to user-defined constraint rules (transpiled from typeSystem.constraints)
        ${grammar.typeSystem && grammar.typeSystem.constraints ? "generate_constraints(node, type);" : "// No constraints defined"}
        
        // Push children
        let child = getNodeFirstChild(node);
        while (child != 0) {
            inferStack[top++] = child;
            child = getNodeNextSibling(child);
        }
    }
}

// --- Diagnostic Emission ---

let diagStack = new ChunkedUint32Array(1000000);
let diagOffsetStack = new ChunkedUint32Array(1000000);

export function emitTypeDiagnostics(astRoot: u32): void {
    if (astRoot == 0) return;
    
    let top: u32 = 0;
    diagStack[top] = astRoot;
    diagOffsetStack[top] = 0;
    top++;
    
    while (top > 0) {
        top--;
        let node = diagStack[top];
        let startOffset = diagOffsetStack[top];
        if (node == 0) continue;
        
        let pad = getNodePadding(node);
        let len = getNodeByteLength(node);
        let nodeStart = startOffset + pad;
        let nodeEnd = nodeStart + len;
        
        // Report errors for nodes involved in failed unification
        for (let i: u32 = 0; i < unifyErrorCount; i++) {
            if (unifyErrorNodes[i] == node) {
                allocDiagnostic(nodeStart, nodeEnd, 0, 0);
                break;
            }
        }
        
        // Push children
        let child = getNodeFirstChild(node);
        if (child != 0) {
            let childOffset = nodeStart - getNodePadding(child);
            while (child != 0) {
                diagStack[top] = child;
                diagOffsetStack[top] = childOffset;
                top++;
                let cPad = getNodePadding(child);
                let cLen = getNodeByteLength(child);
                childOffset += cPad + cLen;
                child = getNodeNextSibling(child);
            }
        }
    }
}

// Integrated entry point
export function runTypeCheck(astRoot: u32): u32 {
    unifyErrorCount = 0;
    inferTypes(astRoot);
    emitTypeDiagnostics(astRoot);
    return unifyErrorCount;
}

// Resolve a type variable to display form
export function resolveUFForDisplay(typeVar: u32): u32 {
    if (typeVar == 0) return 0;
    let root = typeFind(typeVar);
    if (root == 0) return 0;
    let kind = getTypeKind(root);
    let ctor = getTypeCtorTag(root);
    if (kind != TYPE_VARIABLE) return root; // Already concrete
    if (ctor == CTOR_FUNCTION) {
        let argType = resolveUFForDisplay(getTypeBase(root));
        let retType = resolveUFForDisplay(getTypeCtorArg2(root));
        return allocType(TYPE_FUNCTION, 0, argType, retType);
    }
    if (ctor == CTOR_ARRAY) {
        let elemType = resolveUFForDisplay(getTypeBase(root));
        return allocType(TYPE_ARRAY, 0, elemType, 0);
    }
    if (ctor == CTOR_TENSOR) {
        let elemType = resolveUFForDisplay(getTypeBase(root));
        let shapeType = resolveUFForDisplay(getTypeCtorArg2(root));
        return allocType(TYPE_TENSOR, 0, elemType, shapeType);
    }
    return 0; // Unresolved variable
}

// --- Type Evaluator (Beta-Reduction for Conditional Types) ---
// Reduces conditional types like T extends U ? A : B to A or B.
export function evaluateType(typeId: u32, scopeId: u32 = 0): u32 {
    if (typeId == 0) return 0;
    
    if (getTypeKind(typeId) == 12 /* TYPE_CONDITIONAL */) {
        let condPtr = getTypeBase(typeId);
        let branchesPtr = getTypeExtra(typeId);
        
        let checkType = typeTable[condPtr * TYPE_STRIDE]; // Using kind slot for checkType 
        let extendsType = typeTable[condPtr * TYPE_STRIDE + 1]; // Using size slot for extendsType
        
        let evalCheck = evaluateType(checkType, scopeId);
        let evalExtends = evaluateType(extendsType, scopeId);
        
        if (core_isAssignableTo(evalExtends, evalCheck)) {
            return evaluateType(typeTable[branchesPtr * TYPE_STRIDE], scopeId);
        } else {
            return evaluateType(typeTable[branchesPtr * TYPE_STRIDE + 1], scopeId);
        }
    }
    
    return typeId;
}
`;
}
