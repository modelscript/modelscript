// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Distance-2 graph coloring for sparse Jacobian compression.
 *
 * The canonical implementation now lives in @modelscript/compiler
 * (arena-coloring.ts). This module re-exports for backward compatibility.
 */

export { colorJacobianColumns, type ColoringResult } from "@modelscript/compiler";
