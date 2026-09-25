// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./dialects/index.js";
export { parseInpDeck } from "./dialects/inp.js";
export * from "./language.js";
export * from "./materializer.js";
export { materializeFeaDeck as materializeCalculixDeck } from "./materializer.js";
export * from "./types.js";
export type InpDeckData = import("./types.js").FeaModelData;
