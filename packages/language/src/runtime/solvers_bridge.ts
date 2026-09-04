// SPDX-License-Identifier: AGPL-3.0-or-later
import { registerSundialsDaeRunner } from "@modelscript/runtime/solvers_bridge.js";
import { simulateDaeWithSundials } from "../compiler/simulator/solvers/sundials-wasm.js";

registerSundialsDaeRunner(simulateDaeWithSundials);
export * from "@modelscript/runtime/solvers_bridge.js";
