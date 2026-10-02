// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const RC_PATH = path.join(homedir(), ".modelscriptrc");

interface RcConfig {
  token?: string;
  apiUrl?: string;
}

function readRc(): RcConfig {
  try {
    if (existsSync(RC_PATH)) {
      return JSON.parse(readFileSync(RC_PATH, "utf-8"));
    }
  } catch {
    // corrupt file, start fresh
  }
  return {};
}

function writeRc(config: RcConfig): void {
  writeFileSync(RC_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function getApiUrl(): string {
  const envUrl = process.env.MODELSCRIPT_API_URL;
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
  return process.env.MODELSCRIPT_API_TOKEN || readRc().token;
}

export function saveToken(token: string): void {
  const config = readRc();
  config.token = token;
  writeRc(config);
}

export function clearToken(): void {
  try {
    if (existsSync(RC_PATH)) {
      unlinkSync(RC_PATH);
    }
  } catch {
    // ignore
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
