// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder } from "@modelscript/runtime";

export interface FlatteningState {
  innerOuterComponents: Set<string>;
  activeLoopVars: Set<string>;
  scopeDeclaredNames?: Map<string, Set<string>>;
  outerToInner?: Map<string, string>;
  constantAliases?: Map<string, string>;
  stateOutputVars?: Set<string>;
  isInsidePrevious?: boolean;
  currentCompClauseRange?: { startByte: number; endByte: number; startPosition?: any; endPosition?: any } | any;
  outerNonConstantAccess?: any[];
  currentPrefix?: string;
  tmpVarMap?: Map<string, string>;
  tmpVarCounter?: number;
  linspaceCounter?: number;
  exprArrayShapes?: Map<number, number[]>;
  namedArrayShapes?: Map<string, number[]>;
}

export function getFlatteningState(dae: DAEBuilder, flattener?: any): FlatteningState {
  const d = dae as any;
  if (d.flatteningState) return d.flatteningState;
  const f = flattener ?? d.flattener;
  const state: FlatteningState = {
    get innerOuterComponents(): Set<string> {
      if (!d.innerOuterComponents && f?.innerOuterComponents) {
        d.innerOuterComponents = f.innerOuterComponents;
      }
      return d.innerOuterComponents ?? f?.innerOuterComponents ?? (d.innerOuterComponents = new Set<string>());
    },
    set innerOuterComponents(val: Set<string>) {
      d.innerOuterComponents = val;
      if (f) f.innerOuterComponents = val;
    },
    get activeLoopVars(): Set<string> {
      if (!d.activeLoopVars && f?.activeLoopVars) {
        d.activeLoopVars = f.activeLoopVars;
      }
      return d.activeLoopVars ?? f?.activeLoopVars ?? (d.activeLoopVars = new Set<string>());
    },
    set activeLoopVars(val: Set<string>) {
      d.activeLoopVars = val;
      if (f) f.activeLoopVars = val;
    },
    get scopeDeclaredNames(): Map<string, Set<string>> | undefined {
      return d.scopeDeclaredNames;
    },
    set scopeDeclaredNames(val: Map<string, Set<string>> | undefined) {
      d.scopeDeclaredNames = val;
    },
    get outerToInner(): Map<string, string> | undefined {
      return d.outerToInner;
    },
    set outerToInner(val: Map<string, string> | undefined) {
      d.outerToInner = val;
    },
    get constantAliases(): Map<string, string> | undefined {
      return d.constantAliases;
    },
    set constantAliases(val: Map<string, string> | undefined) {
      d.constantAliases = val;
    },
    get stateOutputVars(): Set<string> | undefined {
      return d.stateOutputVars;
    },
    set stateOutputVars(val: Set<string> | undefined) {
      d.stateOutputVars = val;
    },
    get isInsidePrevious(): boolean | undefined {
      return d.isInsidePrevious;
    },
    set isInsidePrevious(val: boolean | undefined) {
      d.isInsidePrevious = val;
    },
    get currentCompClauseRange(): { startByte: number; endByte: number; startPosition?: any; endPosition?: any } | any {
      return d.currentCompClauseRange;
    },
    set currentCompClauseRange(
      val: { startByte: number; endByte: number; startPosition?: any; endPosition?: any } | any,
    ) {
      d.currentCompClauseRange = val;
    },
    get outerNonConstantAccess(): any[] | undefined {
      return d.outerNonConstantAccess;
    },
    set outerNonConstantAccess(val: any[] | undefined) {
      d.outerNonConstantAccess = val;
    },
    get currentPrefix(): string | undefined {
      return d.currentPrefix ?? f?.currentPrefix;
    },
    set currentPrefix(val: string | undefined) {
      d.currentPrefix = val;
    },
    get tmpVarMap(): Map<string, string> | undefined {
      return d._tmpVarMap;
    },
    set tmpVarMap(val: Map<string, string> | undefined) {
      d._tmpVarMap = val;
    },
    get tmpVarCounter(): number | undefined {
      return d._tmpVarCounter;
    },
    set tmpVarCounter(val: number | undefined) {
      d._tmpVarCounter = val;
    },
    get linspaceCounter(): number | undefined {
      return d._linspaceCounter;
    },
    set linspaceCounter(val: number | undefined) {
      d._linspaceCounter = val;
    },
    get exprArrayShapes(): Map<number, number[]> | undefined {
      return d.exprArrayShapes;
    },
    set exprArrayShapes(val: Map<number, number[]> | undefined) {
      d.exprArrayShapes = val;
    },
    get namedArrayShapes(): Map<string, number[]> | undefined {
      return d.namedArrayShapes;
    },
    set namedArrayShapes(val: Map<string, number[]> | undefined) {
      d.namedArrayShapes = val;
    },
  };
  d.flatteningState = state;
  return state;
}

export function getExprArrayShape(dae: DAEBuilder, exprId: number): number[] | undefined {
  return (dae as any).exprArrayShapes?.get(exprId);
}

export function setExprArrayShape(dae: DAEBuilder, exprId: number, shape: number[]): void {
  let shapes = (dae as any).exprArrayShapes as Map<number, number[]> | undefined;
  if (!shapes) {
    shapes = new Map<number, number[]>();
    (dae as any).exprArrayShapes = shapes;
  }
  shapes.set(exprId, shape);
}

export function getNamedArrayShape(dae: DAEBuilder, name: string): number[] | undefined {
  return (dae as any).getNamedArrayShape?.(name) ?? (dae as any).namedArrayShapes?.get(name);
}

export function pushLoopVar(flattener: any, name: string): void {
  if (!flattener) return;
  if (typeof flattener.pushLoopVar === "function") {
    flattener.pushLoopVar(name);
  } else if (flattener.activeLoopVars) {
    flattener.activeLoopVars.add(name);
  }
}

export function popLoopVar(flattener: any, name: string): void {
  if (!flattener) return;
  if (typeof flattener.popLoopVar === "function") {
    flattener.popLoopVar(name);
  } else if (flattener.activeLoopVars) {
    flattener.activeLoopVars.delete(name);
  }
}
