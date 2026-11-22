// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalAlmConnectorRegistry } from "../connector_spi.js";
import { CodebeamerAlmConnector } from "./codebeamer.js";
import { JamaAlmConnector } from "./jama.js";
import { JiraAlmConnector } from "./jira.js";
import { OslcAlmConnector } from "./oslc.js";
import { PolarionAlmConnector } from "./polarion.js";

export { CodebeamerAlmConnector } from "./codebeamer.js";
export { JamaAlmConnector } from "./jama.js";
export { JiraAlmConnector } from "./jira.js";
export { OslcAlmConnector } from "./oslc.js";
export { PolarionAlmConnector } from "./polarion.js";

let registered = false;

/**
 * Registers all built-in ALM/RM connectors (OSLC/DOORS Next, Jira, Codebeamer, Jama, Polarion)
 * on `globalAlmConnectorRegistry`. Safe to call multiple times (idempotent).
 */
export function registerBuiltinAlmConnectors(): void {
  if (registered) return;
  registered = true;
  globalAlmConnectorRegistry.register(new OslcAlmConnector());
  globalAlmConnectorRegistry.register(new JiraAlmConnector());
  globalAlmConnectorRegistry.register(new CodebeamerAlmConnector());
  globalAlmConnectorRegistry.register(new JamaAlmConnector());
  globalAlmConnectorRegistry.register(new PolarionAlmConnector());
}

registerBuiltinAlmConnectors();
