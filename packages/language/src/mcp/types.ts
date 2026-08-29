// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Context } from "@modelscript/modelica/context";

import type { UnifiedWorkspace } from "../compiler/index.js";
import type { OntologyBuilder } from "../reasoner/index.js";

/**
 * Shared server context — holds the current compiler Context,
 * lazily populated by the modelica_load tool.
 */
export interface ServerContext {
  current: Context | null;
  workspace?: UnifiedWorkspace | null;
  paths?: string[];
  ontologyBuilder?: OntologyBuilder | null;
  polyglotHost?: unknown | null;
}
