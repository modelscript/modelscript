// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Context } from "@modelscript/core";

import type { UnifiedWorkspace } from "@modelscript/compiler";
import type { OntologyBuilder } from "@modelscript/reasoner";

/**
 * Shared server context — holds the current compiler Context,
 * lazily populated by the modelica_load tool.
 */
export interface ServerContext {
  current: Context | null;
  workspace?: UnifiedWorkspace | null;
  paths?: string[];
  ontologyBuilder?: OntologyBuilder | null;
}
