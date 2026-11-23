// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Shared `PolyglotEngine` & Per-Tenant `PolyglotContext` Factory for `@modelscript/api`.
 *
 * Implements GraalVM's `Engine` vs. `Context` separation for multi-tenant API requests:
 *   - One long-lived `PolyglotEngine` shares compiled WASM modules, frozen stdlib snapshots,
 *     and TGG PIC dispatch tables across all requests with zero duplication.
 *   - Each API request / tenant spawns a lightweight, capability-sandboxed `PolyglotContext`
 *     with strict memory, domain, and wall-time limits, disposed cleanly at request end.
 */

import {
  type PolyglotCapabilities,
  type PolyglotContext,
  PolyglotEngine,
  registerDefaultInteropLibraries,
} from "@modelscript/runtime";

let _sharedApiPolyglotEngine: PolyglotEngine | null = null;

/**
 * Returns the process-wide shared immutable `PolyglotEngine` for `@modelscript/api`.
 */
export function getSharedApiPolyglotEngine(): PolyglotEngine {
  if (!_sharedApiPolyglotEngine) {
    _sharedApiPolyglotEngine = new PolyglotEngine();
    registerDefaultInteropLibraries(_sharedApiPolyglotEngine.interopRegistry);
  }
  return _sharedApiPolyglotEngine;
}

/**
 * Creates a sandboxed per-request / per-tenant `PolyglotContext` backed by the shared engine.
 */
export function createApiRequestPolyglotContext(
  tenantId: string,
  overrides?: Partial<PolyglotCapabilities>,
): PolyglotContext {
  const engine = getSharedApiPolyglotEngine();
  return engine.createContext({
    contextId: `api:${tenantId}:${Date.now().toString(36)}`,
    capabilities: {
      allowExternalSolvers: true,
      allowFileSystemRead: [],
      allowNetwork: false,
      maxWasmMemoryPages: 2048, // 128 MiB per API tenant request
      maxSimulationWallTimeMs: 15_000,
      ...overrides,
    },
  });
}
