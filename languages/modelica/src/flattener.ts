// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Query Flattener (TypeScript Host Bridge).
 *
 * Coordinates host-side Salsa QueryDB / SymbolIndex data with the high-performance
 * native WebAssembly Semantic Flattening Kernel (`assembly/flattener.ts`).
 */

export { ModelicaFlattener as ArenaQueryFlattener } from "./flattener/class-flattener.js";
export * from "./flattener/index.js";
