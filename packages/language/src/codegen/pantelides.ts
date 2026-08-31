// --- Zero-GC WASM Pantelides Index Reduction Generator ---
// Emits AssemblyScript wrapper routines for DAE structural singularity index reduction.

import { LanguageOptions } from "../dsl/language.js";

export function generatePantelidesDomain(grammarDef?: LanguageOptions<any>): string {
  return `
import { allocGen0 } from "./arena";
import { DaeBuilder } from "./dae";
import { BltEngine } from "./blt";
import { PantelidesEngine, differentiateExpr, containsDerivative, isZeroExpr, isOneExpr } from "./pantelides";
import { createChunkedInt32Array } from "./array";

// --- Pantelides WASM Bridge Routines ---

let lastPantelidesEnginePtr: u32 = 0;

export function runPantelidesIndexReduction(daePtr: u32, bltPtr: u32): u32 {
    if (daePtr == 0) return 0;
    
    let enginePtr = allocGen0(sizeof<PantelidesEngine>());
    let engine = changetype<PantelidesEngine>(enginePtr);
    let dae = changetype<DaeBuilder>(daePtr);
    let blt = bltPtr != 0 ? changetype<BltEngine>(bltPtr) : changetype<BltEngine>(allocGen0(sizeof<BltEngine>()));
    if (bltPtr == 0) blt.init(dae);
    
    engine.init(dae, blt);
    lastPantelidesEnginePtr = enginePtr as u32;
    
    let stateVars = createChunkedInt32Array(dae.varCount > 0 ? dae.varCount : 64);
    return engine.reduceIndex(stateVars);
}

export function getPantelidesStructuralIndex(): u32 {
    if (lastPantelidesEnginePtr == 0) return 1;
    let engine = changetype<PantelidesEngine>(lastPantelidesEnginePtr);
    return engine.structuralIndex;
}

export function getPantelidesDiffRounds(): u32 {
    if (lastPantelidesEnginePtr == 0) return 0;
    let engine = changetype<PantelidesEngine>(lastPantelidesEnginePtr);
    return engine.diffRounds;
}

export function getPantelidesDummyDerivativeCount(): u32 {
    if (lastPantelidesEnginePtr == 0) return 0;
    let engine = changetype<PantelidesEngine>(lastPantelidesEnginePtr);
    return engine.dummyDerivatives.length;
}

export function getPantelidesDummyDerivative(idx: u32): i32 {
    if (lastPantelidesEnginePtr == 0) return -1;
    let engine = changetype<PantelidesEngine>(lastPantelidesEnginePtr);
    if (idx >= engine.dummyDerivatives.length) return -1;
    return engine.dummyDerivatives.get(idx);
}

export function testDifferentiateExpr(daePtr: u32, exprId: u32): u32 {
    if (daePtr == 0) return 0xffffffff;
    let dae = changetype<DaeBuilder>(daePtr);
    let stateVars = createChunkedInt32Array(dae.varCount > 0 ? dae.varCount : 64);
    return differentiateExpr(exprId, dae, stateVars);
}

export function testContainsDerivative(daePtr: u32, exprId: u32): boolean {
    if (daePtr == 0) return false;
    let dae = changetype<DaeBuilder>(daePtr);
    return containsDerivative(exprId, dae);
}
`;
}
