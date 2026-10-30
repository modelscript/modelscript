// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ANSATZ_RC_PATH = path.join(homedir(), ".ansatzrc");
const MODELSCRIPT_RC_PATH = path.join(homedir(), ".modelscriptrc");

interface RcConfig {
  token?: string | undefined;
  apiUrl?: string | undefined;
}

function getActiveRcPath(): string {
  if (existsSync(ANSATZ_RC_PATH)) return ANSATZ_RC_PATH;
  return MODELSCRIPT_RC_PATH;
}

function readRc(): RcConfig {
  for (const rcPath of [ANSATZ_RC_PATH, MODELSCRIPT_RC_PATH]) {
    try {
      if (existsSync(rcPath)) {
        return JSON.parse(readFileSync(rcPath, "utf-8"));
      }
    } catch {
      // corrupt file, continue to next
    }
  }
  return {};
}

function writeRc(config: RcConfig): void {
  const target = getActiveRcPath();
  writeFileSync(target, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function getApiUrl(): string {
  const envUrl = process.env["ANSATZ_API_URL"] || process.env["MODELSCRIPT_API_URL"];
  if (envUrl) return envUrl.replace(/\/+$/, "");
  const rcUrl = readRc().apiUrl;
  if (rcUrl) return rcUrl.replace(/\/+$/, "");
  return "http://localhost:3000";
}

export function saveApiUrl(url: string): void {
  const config = readRc();
  config.apiUrl = url.replace(/\/+$/, "");
  writeRc(config);
}

export function getToken(): string | undefined {
  return (
    process.env["ANSATZ_API_TOKEN"] ||
    process.env["ANSATZ_TOKEN"] ||
    process.env["MODELSCRIPT_API_TOKEN"] ||
    process.env["MODELSCRIPT_AUTH_TOKEN"] ||
    process.env["MODELSCRIPT_TOKEN"] ||
    readRc().token
  );
}

export function saveToken(token: string): void {
  const config = readRc();
  config.token = token;
  writeRc(config);
}

export function clearToken(): void {
  for (const rcPath of [ANSATZ_RC_PATH, MODELSCRIPT_RC_PATH]) {
    try {
      if (existsSync(rcPath)) {
        unlinkSync(rcPath);
      }
    } catch {
      // ignore
    }
  }
}

export function getAuthHeaders(): Record<string, string> {
  const token = getToken();
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

export function requireToken(): string {
  const token = getToken();
  if (!token) {
    console.error("Error: You must be logged in to perform this action.");
    console.error("Run: msx login");
    process.exit(1);
  }
  return token;
}
