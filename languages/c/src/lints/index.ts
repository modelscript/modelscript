// SPDX-License-Identifier: AGPL-3.0-or-later

export { CErrorCode, type CErrorCodeKey } from "../errors.js";
export { lintCSource as lintC, lintCSource, type CDiagnostic, type CLintOptions } from "./rules.js";
