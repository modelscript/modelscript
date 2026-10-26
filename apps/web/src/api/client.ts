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
        localStorage.removeItem("modelscript-auth-token");
        window.dispatchEvent(new CustomEvent("modelscript:auth-expired"));
      }
    }
    return Promise.reject(error);
  },
);

export default api;
