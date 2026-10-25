// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";

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
 * Returns the configured or default Co-Simulation MQTT WebSocket URL.
 */
export function getMqttWsUrl(): string {
  try {
    const config = vscode.workspace?.getConfiguration?.("modelscript.cosim");
    const custom = config?.get<string>("brokerUrl");
    if (custom && typeof custom === "string" && custom.trim().length > 0) {
      return custom.trim();
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
    const config = vscode.workspace?.getConfiguration?.("modelscript.llm");
    const custom = config?.get<string>("ollamaUrl");
    if (custom && typeof custom === "string" && custom.trim().length > 0) {
      return custom.trim().replace(/\/+$/, "");
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
    const config = vscode.workspace?.getConfiguration?.("modelscript.registry");
    const custom = config?.get<string>("url");
    if (custom && typeof custom === "string" && custom.trim().length > 0) {
      return custom.trim().replace(/\/+$/, "");
    }
  } catch {
    // Fallback
  }
  return `${getApiBaseUrl()}/registry`;
}
