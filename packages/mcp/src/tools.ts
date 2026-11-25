// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEcadTools } from "./tools/ecad-tools.js";
import { registerFluidsWaterTools } from "./tools/fluids-water-tools.js";
import { registerModelicaTools } from "./tools/modelica-tools.js";
import { registerMultibodyBioComplianceTools } from "./tools/multibody-bio-compliance-tools.js";
import { registerOntologyTggRtmTools } from "./tools/ontology-tgg-rtm-tools.js";
import { registerPowerGridTools } from "./tools/power-grid-tools.js";
import { registerTelecomOpticalTools } from "./tools/telecom-optical-tools.js";
import { registerWorkspaceSynthesisTools } from "./tools/workspace-synthesis-tools.js";
import type { ServerContext } from "./types.js";

/**
 * Registers all ModelScript, Modelica, SysML v2, Ontology/OWL2, Digital Thread (TGG/RTM),
 * Closed-Loop Synthesis, Power Grid, Fluids/Water, Multibody/Bio/Compliance, ECAD, and
 * Telecom/Optical MCP tools on the provided MCP server instance.
 *
 * @param server - The MCP server instance to register tools onto.
 * @param ctx - Shared mutable server context holding loaded libraries, workspace indices, and ontology state.
 */
export function registerTools(server: McpServer, ctx: ServerContext): void {
  registerModelicaTools(server, ctx);
  registerOntologyTggRtmTools(server, ctx);
  registerWorkspaceSynthesisTools(server, ctx);
  registerPowerGridTools(server, ctx);
  registerFluidsWaterTools(server, ctx);
  registerMultibodyBioComplianceTools(server, ctx);
  registerEcadTools(server, ctx);
  registerTelecomOpticalTools(server, ctx);
}
