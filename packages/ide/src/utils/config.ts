// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";

export type LanguageMaturityTier = "stable" | "beta" | "experimental";

export const LANGUAGE_MATURITY_MAP: Record<string, LanguageMaturityTier> = {
  // Stable (Tier 1)
  modelica: "stable",
  sysml2: "stable",
  sysml: "stable",
  step: "stable",
  scad: "stable",
  owl2: "stable",
  csv: "stable",
  pscad: "stable",
  ssp: "stable",

  // Beta (Tier 2)
  cfd: "beta",
  fea: "beta",
  simpack: "beta",
  gensys: "beta",
  spice: "beta",
  openfoam: "beta",
  olga: "beta",
  vhdlams: "beta",
  verilogams: "beta",
  bondgraph: "beta",
  smv: "beta",
  reqif: "beta",
  sima: "beta",
  lps: "beta",
  gtsuite: "beta",
  modelscript: "beta",
};

export function getLanguageMaturity(languageId: string): LanguageMaturityTier {
  return LANGUAGE_MATURITY_MAP[languageId.toLowerCase()] ?? "experimental";
}

export function getLanguageMaturityBadge(languageId: string): string {
  const tier = getLanguageMaturity(languageId);
  if (tier === "stable") return "🟢 Stable";
  if (tier === "beta") return "🟡 Beta";
  return "🧪 Experimental";
}

export function getLanguageMaturityTierSetting(): LanguageMaturityTier {
  try {
    const cfg = vscode.workspace?.getConfiguration?.("modelscript.languages");
    const tier = cfg?.get<string>("maturityTier");
    if (tier === "stable" || tier === "beta" || tier === "experimental") {
      return tier;
    }
  } catch {
    // Fallback
  }
  return "beta";
}

export function isLanguageEnabled(languageId: string): boolean {
  try {
    const id = languageId.toLowerCase();
    const langCfg = vscode.workspace?.getConfiguration?.(`modelscript.languages.${id}`);
    const inspect = langCfg?.inspect<boolean>("enabled");
    const explicit =
      inspect?.workspaceFolderValue ??
      inspect?.workspaceValue ??
      inspect?.globalValue ??
      langCfg?.get<boolean>("enabled");
    if (typeof explicit === "boolean") {
      return explicit;
    }
    const minTier = getLanguageMaturityTierSetting();
    const langTier = getLanguageMaturity(id);
    const rank: Record<LanguageMaturityTier, number> = { stable: 3, beta: 2, experimental: 1 };
    return rank[langTier] >= rank[minTier];
  } catch {
    return true;
  }
}

export function shouldShowMaturityBadges(): boolean {
  try {
    const cfg = vscode.workspace?.getConfiguration?.("modelscript.languages");
    return cfg?.get<boolean>("showMaturityBadges") ?? true;
  } catch {
    return true;
  }
}

export function getStatusBarConfig(): {
  visibility: "always" | "whenActive" | "never";
  showCloudStatus: boolean;
  showSocialFeed: boolean;
} {
  try {
    const cfg = vscode.workspace?.getConfiguration?.("modelscript.ui.statusBar");
    const visibility = cfg?.get<"always" | "whenActive" | "never">("visibility") ?? "whenActive";
    const showCloudStatus = cfg?.get<boolean>("showCloudStatus") ?? false;
    const showSocialFeed = cfg?.get<boolean>("showSocialFeed") ?? false;
    return { visibility, showCloudStatus, showSocialFeed };
  } catch {
    return { visibility: "whenActive", showCloudStatus: false, showSocialFeed: false };
  }
}

/**
 * Returns the configured or default ModelScript API base URL.
 */
export function getApiBaseUrl(): string {
  try {
    const config = vscode.workspace?.getConfiguration?.("modelscript");
    const custom = config?.get<string>("apiUrl");
    if (custom && typeof custom === "string" && custom.trim().length > 0) {
      return custom.trim().replace(/\/+$/, "");
    }
  } catch {
    // Fallback if running outside VS Code extension host (e.g. unit tests)
  }
  return "http://localhost:3000/api/v1";
}

/**
 * Returns the configured or default Cloud HPC API base URL.
 */
export function getCloudApiUrl(): string {
  try {
    const cfg = vscode.workspace?.getConfiguration?.("modelscript.cloud");
    const custom = cfg?.get<string>("apiUrl") || cfg?.get<string>("apiBaseUrl");
    if (custom && typeof custom === "string" && custom.trim().length > 0) {
      return custom.trim().replace(/\/+$/, "");
    }
  } catch {
    // Fallback
  }
  return getApiBaseUrl();
}

/**
 * Returns the configured Cloud status bar poll interval in milliseconds (0 disables polling).
 */
export function getCloudPollIntervalMs(): number {
  try {
    const cfg = vscode.workspace?.getConfiguration?.("modelscript.cloud");
    const sec = cfg?.get<number>("pollIntervalSeconds");
    if (typeof sec === "number" && sec >= 0) {
      return sec * 1000;
    }
  } catch {
    // Fallback
  }
  return 60000;
}

/**
 * Returns the configured or default Co-Simulation MQTT WebSocket URL.
 */
export function getMqttWsUrl(): string {
  try {
    const cosimCfg = vscode.workspace?.getConfiguration?.("modelscript.cosim");
    const customCosim = cosimCfg?.get<string>("mqttBrokerUrl") || cosimCfg?.get<string>("brokerUrl");
    if (customCosim && typeof customCosim === "string" && customCosim.trim().length > 0) {
      return customCosim.trim();
    }
    const mqttCfg = vscode.workspace?.getConfiguration?.("modelscript.mqtt");
    const customMqtt = mqttCfg?.get<string>("brokerUrl");
    if (customMqtt && typeof customMqtt === "string" && customMqtt.trim().length > 0) {
      return customMqtt.trim();
    }
  } catch {
    // Fallback
  }
  return "ws://localhost:9001";
}

/**
 * Returns the configured or default local LLM inference URL (Ollama/vLLM).
 */
export function getOllamaUrl(): string {
  try {
    const aiCfg = vscode.workspace?.getConfiguration?.("modelscript.ai");
    const customAi = aiCfg?.get<string>("ollamaUrl");
    if (customAi && typeof customAi === "string" && customAi.trim().length > 0) {
      return customAi.trim().replace(/\/+$/, "");
    }
    const llmCfg = vscode.workspace?.getConfiguration?.("modelscript.llm");
    const customLlm = llmCfg?.get<string>("ollamaUrl");
    if (customLlm && typeof customLlm === "string" && customLlm.trim().length > 0) {
      return customLlm.trim().replace(/\/+$/, "");
    }
  } catch {
    // Fallback
  }
  return "http://localhost:11434";
}

/**
 * Returns the configured or default ModelScript Package Registry API URL.
 */
export function getRegistryUrl(): string {
  try {
    const regCfg = vscode.workspace?.getConfiguration?.("modelscript.registry");
    const custom = regCfg?.get<string>("url");
    if (custom && typeof custom === "string" && custom.trim().length > 0) {
      return custom.trim().replace(/\/+$/, "");
    }
    const rootCfg = vscode.workspace?.getConfiguration?.("modelscript");
    const legacy = rootCfg?.get<string>("registryUrl");
    if (legacy && typeof legacy === "string" && legacy.trim().length > 0) {
      return legacy.trim().replace(/\/+$/, "");
    }
  } catch {
    // Fallback
  }
  return `${getApiBaseUrl()}/registry`;
}

/**
 * Returns user-configured simulation defaults from `modelscript.simulation.*`.
 */
export function getSimulationDefaults(): {
  solver: string;
  stopTime: number;
  intervals: number;
  tolerance: number;
  executionTarget: string;
} {
  try {
    const cfg = vscode.workspace?.getConfiguration?.("modelscript.simulation");
    return {
      solver: cfg?.get<string>("defaultSolver") ?? "dopri5",
      stopTime: cfg?.get<number>("defaultStopTime") ?? 10.0,
      intervals: cfg?.get<number>("defaultIntervals") ?? 500,
      tolerance: cfg?.get<number>("defaultTolerance") ?? 1e-6,
      executionTarget: cfg?.get<string>("executionTarget") ?? "auto",
    };
  } catch {
    return {
      solver: "dopri5",
      stopTime: 10.0,
      intervals: 500,
      tolerance: 1e-6,
      executionTarget: "auto",
    };
  }
}

/**
 * Returns user-configured diagram layout and rendering preferences from `modelscript.diagram.*`.
 */
export function getDiagramConfig(): {
  defaultLayoutDirection: string;
  routingStyle: string;
  showGrid: boolean;
  snapToGrid: boolean;
  colorTheme: string;
  lodThreshold: number;
} {
  try {
    const cfg = vscode.workspace?.getConfiguration?.("modelscript.diagram");
    return {
      defaultLayoutDirection: cfg?.get<string>("defaultLayoutDirection") ?? "LR",
      routingStyle: cfg?.get<string>("routingStyle") ?? "orthogonal",
      showGrid: cfg?.get<boolean>("showGrid") ?? true,
      snapToGrid: cfg?.get<boolean>("snapToGrid") ?? true,
      colorTheme: cfg?.get<string>("colorTheme") ?? "matchEditor",
      lodThreshold: cfg?.get<number>("lodThreshold") ?? 250,
    };
  } catch {
    return {
      defaultLayoutDirection: "LR",
      routingStyle: "orthogonal",
      showGrid: true,
      snapToGrid: true,
      colorTheme: "matchEditor",
      lodThreshold: 250,
    };
  }
}

/**
 * Builds the `modelscript/updateSettings` payload to keep the LSP server in sync with VS Code settings.
 */
export function buildLspSettingsPayload(languageIds: string[] = Object.keys(LANGUAGE_MATURITY_MAP)): {
  languages: {
    maturityTier: "all" | "betaAndStable" | "stableOnly";
    enabledOverrides: Record<string, boolean>;
  };
  codeLens: {
    enabled: boolean;
    simulate: boolean;
    verification: boolean;
    polyglotLinks: boolean;
    cadMetrics: boolean;
    fileConversions: boolean;
  };
  inlayHints: {
    enabled: boolean;
    unitsAndBounds: boolean;
    variabilityPrefixes: boolean;
  };
  diagnostics: {
    enabled: boolean;
    maxNumberOfProblems: number;
    disabledRules: string[];
  };
} {
  const langCfg = vscode.workspace?.getConfiguration?.("modelscript.languages");
  const rawTier = langCfg?.get<string>("maturityTier") ?? "all";
  const maturityTier: "all" | "betaAndStable" | "stableOnly" =
    rawTier === "stableOnly" || rawTier === "betaAndStable" ? rawTier : "all";

  const enabledOverrides: Record<string, boolean> = {};
  for (const id of languageIds) {
    const inspected = langCfg?.inspect<boolean>(`${id}.enabled`);
    const explicit = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
    if (typeof explicit === "boolean") {
      enabledOverrides[id.toLowerCase()] = explicit;
    }
  }

  const clCfg = vscode.workspace?.getConfiguration?.("modelscript.codeLens");
  const ihCfg = vscode.workspace?.getConfiguration?.("modelscript.inlayHints");
  const diagCfg = vscode.workspace?.getConfiguration?.("modelscript.diagnostics");

  return {
    languages: {
      maturityTier,
      enabledOverrides,
    },
    codeLens: {
      enabled: clCfg?.get<boolean>("enabled") ?? true,
      simulate: clCfg?.get<boolean>("simulate") ?? true,
      verification: clCfg?.get<boolean>("verification") ?? true,
      polyglotLinks: clCfg?.get<boolean>("polyglotLinks") ?? true,
      cadMetrics: clCfg?.get<boolean>("cadMetrics") ?? false,
      fileConversions: clCfg?.get<boolean>("fileConversions") ?? false,
    },
    inlayHints: {
      enabled: ihCfg?.get<boolean>("enabled") ?? true,
      unitsAndBounds: ihCfg?.get<boolean>("unitsAndBounds") ?? true,
      variabilityPrefixes: ihCfg?.get<boolean>("variabilityPrefixes") ?? true,
    },
    diagnostics: {
      enabled: diagCfg?.get<boolean>("enabled") ?? true,
      maxNumberOfProblems: diagCfg?.get<number>("maxNumberOfProblems") ?? 250,
      disabledRules: diagCfg?.get<string[]>("disabledRules") ?? [],
    },
  };
}
