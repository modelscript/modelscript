// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalAlmConnectorRegistry } from "../connector_spi.js";
import { AirflowAlmConnector } from "./airflow.js";
import { ArasAlmConnector } from "./aras.js";
import { ArtifactoryAlmConnector } from "./artifactory.js";
import { AzureDevOpsAlmConnector } from "./azure-devops.js";
import { BitbucketAlmConnector } from "./bitbucket.js";
import { CodebeamerAlmConnector } from "./codebeamer.js";
import { ConfluenceAlmConnector } from "./confluence.js";
import { ExcelAlmConnector } from "./excel.js";
import { GenesysAlmConnector } from "./genesys.js";
import { GitHubAlmConnector } from "./github.js";
import { GitLabAlmConnector } from "./gitlab.js";
import { JamaAlmConnector } from "./jama.js";
import { JiraAlmConnector } from "./jira.js";
import { OnshapeAlmConnector } from "./onshape.js";
import { OslcAlmConnector } from "./oslc.js";
import { PolarionAlmConnector } from "./polarion.js";
import { GenericRestAlmConnector } from "./rest.js";
import { RhapsodyAlmConnector } from "./rhapsody.js";
import { SqlAlmConnector } from "./sql.js";
import { TeamcenterAlmConnector } from "./teamcenter.js";
import { TestRailAlmConnector } from "./testrail.js";
import { TeamworkCloudAlmConnector } from "./twc.js";
import { WindchillAlmConnector } from "./windchill.js";
import { XrayAlmConnector } from "./xray.js";
import { ZukenAlmConnector } from "./zuken.js";

export { AirflowAlmConnector } from "./airflow.js";
export { ArasAlmConnector } from "./aras.js";
export { ArtifactoryAlmConnector } from "./artifactory.js";
export { AzureDevOpsAlmConnector } from "./azure-devops.js";
export { BitbucketAlmConnector } from "./bitbucket.js";
export { CodebeamerAlmConnector } from "./codebeamer.js";
export { ConfluenceAlmConnector } from "./confluence.js";
export { ExcelAlmConnector } from "./excel.js";
export { GenesysAlmConnector } from "./genesys.js";
export { GitHubAlmConnector } from "./github.js";
export { GitLabAlmConnector } from "./gitlab.js";
export { JamaAlmConnector } from "./jama.js";
export { JiraAlmConnector } from "./jira.js";
export { OnshapeAlmConnector } from "./onshape.js";
export { OslcAlmConnector } from "./oslc.js";
export { PolarionAlmConnector } from "./polarion.js";
export { GenericRestAlmConnector } from "./rest.js";
export { RhapsodyAlmConnector } from "./rhapsody.js";
export { SqlAlmConnector } from "./sql.js";
export { TeamcenterAlmConnector } from "./teamcenter.js";
export { TestRailAlmConnector } from "./testrail.js";
export { TeamworkCloudAlmConnector } from "./twc.js";
export { WindchillAlmConnector } from "./windchill.js";
export { XrayAlmConnector } from "./xray.js";
export { ZukenAlmConnector } from "./zuken.js";

let registered = false;

/**
 * Registers all built-in ALM/PLM/RM/MBSE/ECAD/DevOps/CAD connectors on `globalAlmConnectorRegistry`.
 * Safe to call multiple times (idempotent).
 */
export function registerBuiltinAlmConnectors(): void {
  if (registered) return;
  registered = true;
  globalAlmConnectorRegistry.register(new OslcAlmConnector());
  globalAlmConnectorRegistry.register(new JiraAlmConnector());
  globalAlmConnectorRegistry.register(new CodebeamerAlmConnector());
  globalAlmConnectorRegistry.register(new JamaAlmConnector());
  globalAlmConnectorRegistry.register(new PolarionAlmConnector());
  globalAlmConnectorRegistry.register(new AzureDevOpsAlmConnector());
  globalAlmConnectorRegistry.register(new TestRailAlmConnector());
  globalAlmConnectorRegistry.register(new WindchillAlmConnector());
  globalAlmConnectorRegistry.register(new TeamcenterAlmConnector());
  globalAlmConnectorRegistry.register(new ArasAlmConnector());
  globalAlmConnectorRegistry.register(new GenericRestAlmConnector());
  globalAlmConnectorRegistry.register(new GitHubAlmConnector());
  globalAlmConnectorRegistry.register(new GitLabAlmConnector());
  globalAlmConnectorRegistry.register(new ConfluenceAlmConnector());
  globalAlmConnectorRegistry.register(new XrayAlmConnector());
  globalAlmConnectorRegistry.register(new OnshapeAlmConnector());
  globalAlmConnectorRegistry.register(new ArtifactoryAlmConnector());
  globalAlmConnectorRegistry.register(new BitbucketAlmConnector());
  globalAlmConnectorRegistry.register(new AirflowAlmConnector());
  globalAlmConnectorRegistry.register(new GenesysAlmConnector());
  globalAlmConnectorRegistry.register(new TeamworkCloudAlmConnector());
  globalAlmConnectorRegistry.register(new ZukenAlmConnector());
  globalAlmConnectorRegistry.register(new SqlAlmConnector());
  globalAlmConnectorRegistry.register(new ExcelAlmConnector());
  globalAlmConnectorRegistry.register(new RhapsodyAlmConnector());
}

registerBuiltinAlmConnectors();
