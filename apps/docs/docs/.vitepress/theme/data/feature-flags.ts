// SPDX-License-Identifier: AGPL-3.0-or-later

declare const __FEATURE_FLAG_HOME_WORKFLOW_PAIRS__: boolean;
declare const __FEATURE_FLAG_HOME_SEMANTIC_COORDINATOR__: boolean;
declare const __FEATURE_FLAG_HOME_AI_AGENT__: boolean;
declare const __FEATURE_FLAG_HOME_POLYGLOT_SANDBOX__: boolean;

function readEnvFlag(...keys: string[]): boolean | undefined {
  if (typeof process !== "undefined" && process.env) {
    for (const key of keys) {
      const val = process.env[key];
      if (val !== undefined) {
        const normalized = val.trim().toLowerCase();
        return normalized === "true" || normalized === "1";
      }
    }
  }
  return undefined;
}

function resolveDefinedFlag(
  definedValue: boolean | undefined,
  defaultValue: boolean,
  ...envKeys: string[]
): boolean {
  if (typeof definedValue === "boolean") {
    return definedValue;
  }
  return readEnvFlag(...envKeys) ?? defaultValue;
}

/**
 * Landing page section feature flags (hidden by default on flagship).
 * Enable individually via FEATURE_FLAG_HOME_<SECTION>=true or all together via
 * FEATURE_FLAG_HOME_SHOWCASE=true.
 */
export const isHomeWorkflowPairsEnabled: boolean = resolveDefinedFlag(
  typeof __FEATURE_FLAG_HOME_WORKFLOW_PAIRS__ !== "undefined" ? __FEATURE_FLAG_HOME_WORKFLOW_PAIRS__ : undefined,
  false,
  "FEATURE_FLAG_HOME_WORKFLOW_PAIRS",
  "VITE_FEATURE_FLAG_HOME_WORKFLOW_PAIRS",
  "FEATURE_FLAG_HOME_SHOWCASE",
  "VITE_FEATURE_FLAG_HOME_SHOWCASE",
);

export const isHomeSemanticCoordinatorEnabled: boolean = resolveDefinedFlag(
  typeof __FEATURE_FLAG_HOME_SEMANTIC_COORDINATOR__ !== "undefined"
    ? __FEATURE_FLAG_HOME_SEMANTIC_COORDINATOR__
    : undefined,
  false,
  "FEATURE_FLAG_HOME_SEMANTIC_COORDINATOR",
  "VITE_FEATURE_FLAG_HOME_SEMANTIC_COORDINATOR",
  "FEATURE_FLAG_HOME_SHOWCASE",
  "VITE_FEATURE_FLAG_HOME_SHOWCASE",
);

export const isHomeAiAgentEnabled: boolean = resolveDefinedFlag(
  typeof __FEATURE_FLAG_HOME_AI_AGENT__ !== "undefined" ? __FEATURE_FLAG_HOME_AI_AGENT__ : undefined,
  false,
  "FEATURE_FLAG_HOME_AI_AGENT",
  "VITE_FEATURE_FLAG_HOME_AI_AGENT",
  "FEATURE_FLAG_HOME_SHOWCASE",
  "VITE_FEATURE_FLAG_HOME_SHOWCASE",
);

export const isHomePolyglotSandboxEnabled: boolean = resolveDefinedFlag(
  typeof __FEATURE_FLAG_HOME_POLYGLOT_SANDBOX__ !== "undefined"
    ? __FEATURE_FLAG_HOME_POLYGLOT_SANDBOX__
    : undefined,
  true,
  "FEATURE_FLAG_HOME_POLYGLOT_SANDBOX",
  "VITE_FEATURE_FLAG_HOME_POLYGLOT_SANDBOX",
);
