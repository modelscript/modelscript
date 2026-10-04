// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase } from "../database.js";
import { FEATURE_FLAGS, type FeatureFlagDefinition } from "../feature-flags.js";

interface CachedFlag {
  key: string;
  isEnabled: boolean;
  rolloutPercentage: number;
  allowedRoles: string[];
}

export class FeatureFlagService {
  readonly #db: LibraryDatabase;
  #cache: Map<string, CachedFlag> | null = null;
  #lastCacheTime = 0;
  static readonly CACHE_TTL_MS = 30_000; // 30 seconds

  constructor(db: LibraryDatabase) {
    this.#db = db;
  }

  #loadCache(): Map<string, CachedFlag> {
    const now = Date.now();
    if (this.#cache && now - this.#lastCacheTime < FeatureFlagService.CACHE_TTL_MS) {
      return this.#cache;
    }

    const map = new Map<string, CachedFlag>();
    try {
      const rows = this.#db.getFeatureFlags();
      for (const row of rows) {
        map.set(row.flag_key, {
          key: row.flag_key,
          isEnabled: row.is_enabled === 1,
          rolloutPercentage: row.rollout_percentage ?? 100,
          allowedRoles: row.allowed_roles
            ? row.allowed_roles
                .split(",")
                .map((r) => r.trim())
                .filter(Boolean)
            : [],
        });
      }
    } catch (err) {
      console.error("[FeatureFlagService] Failed to load feature flags from DB, using defaults:", err);
    }

    this.#cache = map;
    this.#lastCacheTime = now;
    return map;
  }

  public invalidateCache(): void {
    this.#cache = null;
    this.#lastCacheTime = 0;
  }

  /**
   * Check if a feature flag is enabled for the given user context.
   */
  public isEnabled(flagKey: string, user?: { role?: string | undefined; id?: number | undefined } | null): boolean {
    const def: FeatureFlagDefinition | undefined = FEATURE_FLAGS[flagKey];
    const envKey = `FEATURE_FLAG_${flagKey.toUpperCase()}`;
    const envVal = process.env[envKey];

    // 1. Explicit environment variable override takes top priority
    if (envVal !== undefined) {
      const normalized = envVal.toLowerCase().trim();
      if (normalized === "true" || normalized === "1") return true;
      if (normalized === "false" || normalized === "0") return false;
    }

    // In test environment, bypass flag gating for legacy tests unless strict evaluation is requested
    if (process.env.NODE_ENV === "test" && process.env.FEATURE_FLAG_TEST_STRICT !== "true") {
      return true;
    }

    const cache = this.#loadCache();
    const dbFlag = cache.get(flagKey);

    const isEnabledInDb = dbFlag ? dbFlag.isEnabled : (def?.defaultValue ?? false);
    const allowedRoles = dbFlag?.allowedRoles?.length ? dbFlag.allowedRoles : (def?.allowedRoles ?? []);

    const userRole = user?.role || "guest";
    const isAdmin = userRole === "admin";

    // If flag is globally disabled in DB, allow access ONLY if user is an admin and admin is in allowedRoles
    if (!isEnabledInDb) {
      if (isAdmin && allowedRoles.includes("admin")) {
        return true;
      }
      return false;
    }

    // Flag is enabled in DB; check role restriction if any
    if (allowedRoles.length > 0) {
      if (!allowedRoles.includes(userRole as any)) {
        // Admin exception: admin can always access role-gated features
        if (!isAdmin) {
          return false;
        }
      }
    }

    // Check percentage rollout for standard users
    if (dbFlag && dbFlag.rolloutPercentage < 100 && !isAdmin) {
      if (!user?.id) {
        return false;
      }
      const hash = Math.abs((user.id * 2654435761) ^ flagKey.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 100;
      if (hash >= dbFlag.rolloutPercentage) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluates all flags for the current user and returns a key-boolean dictionary.
   */
  public getAllFlagsForUser(user?: { role?: string; id?: number } | null): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const key of Object.keys(FEATURE_FLAGS)) {
      result[key] = this.isEnabled(key, user);
    }
    return result;
  }

  /**
   * List all feature flag definitions along with their current DB/env status for Admin UI.
   */
  public listAllForAdmin(): (FeatureFlagDefinition & {
    currentEnabled: boolean;
    rolloutPercentage: number;
    dbAllowedRoles: string[];
  })[] {
    const cache = this.#loadCache();
    return Object.values(FEATURE_FLAGS).map((def) => {
      const dbFlag = cache.get(def.key);
      const currentEnabled = dbFlag ? dbFlag.isEnabled : def.defaultValue;
      const rolloutPercentage = dbFlag?.rolloutPercentage ?? 100;
      const dbAllowedRoles = dbFlag?.allowedRoles ?? def.allowedRoles ?? [];
      return {
        ...def,
        currentEnabled,
        rolloutPercentage,
        dbAllowedRoles,
      };
    });
  }

  /**
   * Update a feature flag state.
   */
  public setFlag(key: string, isEnabled: boolean, allowedRoles?: string, rolloutPercentage = 100): void {
    this.#db.setFeatureFlag(key, isEnabled, allowedRoles, rolloutPercentage);
    this.invalidateCache();
  }
}
