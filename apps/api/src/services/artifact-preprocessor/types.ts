// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";

export interface PreprocessResult {
  svg?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
  viewConfigAdditions?: Record<string, unknown>;
}

/** Optional, user-chosen hints supplied at upload time (e.g. by the composer's attach wizard). */
export interface PreprocessOptions {
  /** Modelica: the class to render when a file declares several. */
  primaryClass?: string | undefined;
  /** Declared external library dependencies (e.g. from artifact view_config.dependencies). */
  dependencies?: Array<{ name: string; version: string; [key: string]: unknown }> | undefined;
}

export interface PreprocessContext {
  safeFilePath: string;
  resolvedDir: string;
  originalFilename: string;
  baseTitle: string;
  content: string;
  inlineCode: string | undefined;
  viewType: string;
  options: PreprocessOptions;
}

export const DEFAULT_UPLOAD_DIR =
  process.env["UPLOAD_DIR"] ||
  (process.env["DATA_DIR"]
    ? path.join(process.env["DATA_DIR"], "uploads")
    : path.resolve(process.cwd(), "data", "uploads"));
