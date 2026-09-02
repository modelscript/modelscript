// SPDX-License-Identifier: AGPL-3.0-or-later
import { DaeBuilder } from "./dae";

export const inputEncoding: i32 = 0;

export function simplifyAst(exprId: u32, _dae: DaeBuilder): u32 {
  return exprId;
}
