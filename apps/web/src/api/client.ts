// SPDX-License-Identifier: AGPL-3.0-or-later

import axios from "axios";

export const api = axios.create({
  baseURL: "/api/v1",
  timeout: 20000,
});

// Automatically inject Authorization header from localStorage if present
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined" && window.localStorage) {
    const token = localStorage.getItem("modelscript-auth-token");
    if (token && !config.headers["Authorization"]) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
  }
  return config;
});

// Global response interceptor to handle token expiry / 401 Unauthorized
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      if (typeof window !== "undefined" && window.localStorage) {
        const reqUrl = String(error.config?.url || "");
        const reqMethod = String(error.config?.method || "").toUpperCase();
        const isCredentialCheck =
          reqUrl.includes("/auth/login") ||
          reqUrl.includes("/auth/2fa/") ||
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
    }
    return Promise.reject(error);
  },
);

export default api;
