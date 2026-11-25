// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExprKind } from "@modelscript/dsl";
import { DAEBuilder } from "@modelscript/runtime";
import { getFlatteningState } from "../../support/state.js";
import { ModelicaModificationEnv } from "../../support/wasm-bridge.js";
import { type ComponentFlattener, type ParentModData } from "./types.js";

/**
 * Materializes or retrieves a cached WebAssembly {@link ModelicaModificationEnv} in linear memory
 * from a TypeScript modification descriptor (`mods`).
 *
 * Synchronizes `final`, `each`, and `redeclare` bitflags as well as literal/nested modification trees
 * with the AssemblyScript WASM flattening kernel when `syncWasmEnv` is active.
 *
 * @param flattener - Active component flattener context.
 * @param dae - Target `DAEBuilder` holding the WASM exports and string interner.
 * @param mods - Optional modification object containing `args` and/or a cached `wasmEnv`.
 * @returns Linear-memory `ModelicaModificationEnv` handle, or `null` if WASM env exports are unavailable.
 */
export function getOrCreateWasmEnv(
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  mods?: ParentModData | null,
): ModelicaModificationEnv | null {
  if (!dae.exports || !dae.exports.flattener_envCreate) return null;
  if (mods?.wasmEnv instanceof ModelicaModificationEnv) {
    return mods.wasmEnv;
  }
  const state = getFlatteningState(dae, flattener);
  const wasmFlattener =
    state.wasmFlattener ?? (dae.exports?.flattener_create ? dae.exports.flattener_create(dae.ptr) : 0);
  state.wasmFlattener = wasmFlattener;

  if (!mods?.args || mods.args.length === 0) {
    if (state.emptyWasmEnv) {
      if (mods) mods.wasmEnv = state.emptyWasmEnv;
      return state.emptyWasmEnv;
    }
    const emptyEnv = new ModelicaModificationEnv(dae.exports);
    state.emptyWasmEnv = emptyEnv;
    if (mods) mods.wasmEnv = emptyEnv;
    return emptyEnv;
  }

  const env = new ModelicaModificationEnv(dae.exports);
  if (mods?.args && Array.isArray(mods.args)) {
    for (const arg of mods.args) {
      if (!arg?.name) continue;
      let flag = 0;
      if (arg.final) flag |= 1;
      if (arg.each) flag |= 2;
      if (arg.isRedeclaration) flag |= 4;

      const nameId = dae.interner.intern(arg.name);
      if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
        const typeId = dae.interner.intern(arg.redeclaredTypeSpecifier);
        env.bindRedeclarePath(wasmFlattener, nameId, typeId, 0, flag);
      } else if (arg.value) {
        let exprId = 0xffffffff;
        if (arg.value.kind === "literal" && typeof arg.value.value === "number") {
          exprId = Number.isInteger(arg.value.value)
            ? dae.addIntLiteral(arg.value.value)
            : dae.addRealLiteral(arg.value.value);
        } else if (arg.value.kind === "literal" && typeof arg.value.value === "boolean") {
          exprId = dae.addExpression(ExprKind.BoolLiteral, arg.value.value ? 1 : 0);
        } else if (arg.value.kind === "literal" && typeof arg.value.value === "string") {
          exprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(arg.value.value));
        }
        if (exprId !== 0xffffffff) {
          env.setPath(wasmFlattener, nameId, exprId, flag);
        }
      }
      if (arg.nestedArgs && arg.nestedArgs.length > 0) {
        const childEnv = getOrCreateWasmEnv(flattener, dae, { args: arg.nestedArgs });
        if (childEnv) {
          env.bindNested(nameId, childEnv, flag);
        }
      }
    }
  }
  if (mods) {
    mods.wasmEnv = env;
  }
  return env;
}
