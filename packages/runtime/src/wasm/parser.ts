// SPDX-License-Identifier: AGPL-3.0-or-later
import { DaeBuilder } from "./dae/builder";
import { cas_simplify } from "./dae/cas";

export let inputEncoding: i32 = 1;

export function simplifyAst(exprId: u32, dae: DaeBuilder): u32 {
  if (changetype<usize>(dae) == 0) return exprId;
  return cas_simplify(dae, exprId);
}
