// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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

export interface HostCredential {
  token?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
  headers?: Record<string, string> | undefined;
}

const HOST_CREDENTIALS_PATH = path.join(homedir(), ".modelscript", "credentials.json");

function normalizeHostEnvKey(host: string): string {
  return host.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function readHostCredentialsFile(): Record<string, HostCredential> {
  try {
    if (existsSync(HOST_CREDENTIALS_PATH)) {
      return JSON.parse(readFileSync(HOST_CREDENTIALS_PATH, "utf-8"));
    }
  } catch {
    // Corrupt credentials file; return empty
  }
  return {};
}

export function getHostAuth(host: string): HostCredential {
  const envSuffix = normalizeHostEnvKey(host);
  const envToken = process.env[`MSX_TOKEN_${envSuffix}`] || process.env[`MODELSCRIPT_TOKEN_${envSuffix}`];
  const envUser = process.env[`MSX_USER_${envSuffix}`];
  const envPass = process.env[`MSX_PASSWORD_${envSuffix}`];

  const stored = readHostCredentialsFile()[host.toLowerCase()] ?? {};
  return {
    token: envToken ?? stored.token,
    username: envUser ?? stored.username,
    password: envPass ?? stored.password,
    headers: stored.headers,
  };
}

export function saveHostAuth(host: string, creds: HostCredential): void {
  const dir = path.dirname(HOST_CREDENTIALS_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const all = readHostCredentialsFile();
  all[host.toLowerCase()] = creds;
  writeFileSync(HOST_CREDENTIALS_PATH, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
}

export function clearHostAuth(host: string): boolean {
  const all = readHostCredentialsFile();
  const key = host.toLowerCase();
  if (!(key in all)) return false;
  const next = Object.fromEntries(Object.entries(all).filter(([k]) => k !== key));
  writeFileSync(HOST_CREDENTIALS_PATH, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return true;
}
