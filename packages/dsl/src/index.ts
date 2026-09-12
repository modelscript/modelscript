// SPDX-License-Identifier: AGPL-3.0-or-later

// Core DSL APIs & Combinators
export * from "./dsl/index.js";

// Code Generation, Compilers & Rewriters
export * from "./codegen/index.js";

// Language Bindings (WASM / JS wrapper generator)
export * from "./bindings/javascript/index.js";

// Core Utilities & FileSystem Abstractions
export * as utils from "./utils/index.js";

// Language Tools (I18n, Semantic Diff)
export * from "./tools/index.js";

export type CSTNode = any;
