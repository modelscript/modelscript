// SPDX-License-Identifier: AGPL-3.0-or-later
import { DaeBuilder } from "./dae/builder";

export let inputEncoding: i32 = 1;

export function simplifyAst(exprId: u32, _dae: DaeBuilder): u32 {
  return exprId;
}
