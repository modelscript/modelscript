// SPDX-License-Identifier: AGPL-3.0-or-later

import axios, { type InternalAxiosRequestConfig } from "axios";

export const api = axios.create({
  baseURL: "/api/v1",
  timeout: 20000,
});

let inMemorySudoToken: string | null = null;

export function getAdminSudoToken(): string | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const stored = sessionStorage.getItem("modelscript-admin-sudo-token");
      if (stored) return stored;
    }
  } catch {
    // Ignore storage access errors
  }
  return inMemorySudoToken;
}

export function setAdminSudoToken(token: string | null): void {
  inMemorySudoToken = token;
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      if (token) {
        sessionStorage.setItem("modelscript-admin-sudo-token", token);
      } else {
        sessionStorage.removeItem("modelscript-admin-sudo-token");
      }
    }
  } catch {
    // Ignore storage access errors
  }
}

export interface SudoRequiredEventDetail {
  message?: string;
  handled?: boolean;
  resolve: (sudoToken: string) => void;
  reject: (err: unknown) => void;
}

// Automatically inject Authorization and X-Admin-Sudo-Token headers if present
api.interceptors.request.use((config) => {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const token = localStorage.getItem("modelscript-auth-token") || localStorage.getItem("token");
      if (token && !config.headers["Authorization"]) {
        config.headers["Authorization"] = `Bearer ${token}`;
      }
    }
    const sudoToken = getAdminSudoToken();
    if (sudoToken && !config.headers["X-Admin-Sudo-Token"]) {
      config.headers["X-Admin-Sudo-Token"] = sudoToken;
    }
  } catch {
    // Ignore SecurityError when running inside a cross-origin or sandboxed iframe
  }
  return config;
});

// Global response interceptor to handle token expiry / 401 Unauthorized, 403 SUDO_REQUIRED & 503 Maintenance Mode
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          const reqUrl = String(error.config?.url || "");
          const reqMethod = String(error.config?.method || "").toUpperCase();
          const isCredentialCheck =
            reqUrl.includes("/auth/login") ||
            reqUrl.includes("/auth/2fa/") ||
            reqUrl.includes("/admin/sudo") ||
            reqUrl.includes("/users/me/password") ||
            reqUrl.includes("/account/password") ||
            reqUrl.includes("/auth/password") ||
            reqUrl.includes("/auth/account") ||
            (reqMethod === "DELETE" && (reqUrl.includes("/users/me") || reqUrl.includes("/account")));
          if (!isCredentialCheck && localStorage.getItem("modelscript-auth-token")) {
            localStorage.removeItem("modelscript-auth-token");
            window.dispatchEvent(new CustomEvent("modelscript:auth-expired"));
          }
        }
      } catch {
        // Ignore SecurityError in sandboxed iframe
      }
    } else if (
      error.response &&
      error.response.status === 403 &&
      error.response.data?.code === "SUDO_REQUIRED" &&
      error.config &&
      !(error.config as InternalAxiosRequestConfig & { _sudoRetried?: boolean })._sudoRetried
    ) {
      if (typeof window !== "undefined") {
        let handled = false;
        let resolvePromise!: (sudoToken: string) => void;
        let rejectPromise!: (err: unknown) => void;
        const retryPromise = new Promise<string>((resolve, reject) => {
          resolvePromise = resolve;
          rejectPromise = reject;
        });
        const detail: SudoRequiredEventDetail = {
          message: error.response.data?.error || "Step-up administrator authentication required.",
          handled: false,
          resolve: resolvePromise,
          reject: rejectPromise,
        };
        window.dispatchEvent(new CustomEvent("modelscript:sudo-required", { detail }));
        handled = Boolean(detail.handled);
        if (handled) {
          return retryPromise.then((newSudoToken) => {
            const retryConfig = error.config as InternalAxiosRequestConfig & { _sudoRetried?: boolean };
            retryConfig._sudoRetried = true;
            retryConfig.headers["X-Admin-Sudo-Token"] = newSudoToken;
            return api.request(retryConfig);
          });
        }
      }
    } else if (error.response && error.response.status === 503 && error.response.data?.maintenanceMode) {
      try {
        if (typeof window !== "undefined") {
          const data = error.response.data;
          window.dispatchEvent(
            new CustomEvent("modelscript:branding-updated", {
              detail: {
                maintenanceMode: true,
                maintenanceLevel: data.maintenanceLevel || "read_only",
                maintenanceEta: data.maintenanceEta || "",
                ...(data.message ? { announcementBanner: data.message } : {}),
              },
            }),
          );
          window.dispatchEvent(
            new CustomEvent("modelscript:maintenance-503", {
              detail: {
                error: data.error || "Instance is currently undergoing maintenance.",
                maintenanceLevel: data.maintenanceLevel || "read_only",
                maintenanceEta: data.maintenanceEta || null,
                retryAfterSeconds: data.retryAfterSeconds || 300,
              },
            }),
          );
        }
      } catch {
        // Ignore in non-DOM environments
      }
    } else if (
      error.response &&
      (error.response.status === 402 || error.response.status === 403 || error.response.status === 501)
    ) {
      try {
        if (typeof window !== "undefined") {
          const body = error.response.data;
          const code = typeof body?.code === "string" ? body.code : "";
          const isEeGate =
            code === "EE_LICENSE_REQUIRED" ||
            code === "EE_LICENSE_EXPIRED" ||
            code === "EE_LICENSE_INVALID" ||
            code === "EE_FEATURE_NOT_ENTITLED" ||
            code === "EE_EDITION_REQUIRED" ||
            code === "EE_FEATURE_LOCKED" ||
            code === "EE_SEAT_LIMIT_EXCEEDED" ||
            code === "FEATURE_REQUIRES_EE" ||
            (error.response.status === 501 && body?.edition === "ce");
          if (isEeGate) {
            window.dispatchEvent(
              new CustomEvent("modelscript:ee-upgrade-required", {
                detail: { ...body, status: error.response.status },
              }),
            );
          }
        }
      } catch {
        // Ignore in non-DOM environments
      }
    }
    return Promise.reject(error);
  },
);

export default api;
