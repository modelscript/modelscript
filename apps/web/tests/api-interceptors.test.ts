// SPDX-License-Identifier: AGPL-3.0-or-later

import axios, { type InternalAxiosRequestConfig } from "axios";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

describe("Axios Interceptors & Auth Lifecycle", () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
      url: "https://modelscript.org/",
    });
    // Configure global browser environment for tests
    (globalThis as any).window = dom.window;
    (globalThis as any).localStorage = dom.window.localStorage;
    (globalThis as any).CustomEvent = dom.window.CustomEvent;
  });

  it("injects Bearer token into request Authorization header when token exists in localStorage", async () => {
    localStorage.setItem("modelscript-auth-token", "test-jwt-token-12345");

    const instance = axios.create({ baseURL: "/api/v1" });
    instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const token = localStorage.getItem("modelscript-auth-token");
      if (token && !config.headers["Authorization"]) {
        config.headers["Authorization"] = `Bearer ${token}`;
      }
      return config;
    });

    // Simulate an outgoing request config
    const testConfig: InternalAxiosRequestConfig = {
      headers: new axios.AxiosHeaders(),
    };

    // Run the request interceptor handler
    const handler = (instance.interceptors.request as any).handlers[0].fulfilled;
    const transformed = await handler(testConfig);

    assert.equal(transformed.headers["Authorization"], "Bearer test-jwt-token-12345");
  });

  it("clears localStorage token and dispatches modelscript:auth-expired event on 401 response", async () => {
    localStorage.setItem("modelscript-auth-token", "expired-token");

    let eventFired = false;
    dom.window.addEventListener("modelscript:auth-expired", () => {
      eventFired = true;
    });

    const instance = axios.create({ baseURL: "/api/v1" });
    instance.interceptors.response.use(
      (res) => res,
      (error) => {
        if (error.response && error.response.status === 401) {
          localStorage.removeItem("modelscript-auth-token");
          dom.window.dispatchEvent(new dom.window.CustomEvent("modelscript:auth-expired"));
        }
        return Promise.reject(error);
      },
    );

    const mock401Error = {
      response: {
        status: 401,
        statusText: "Unauthorized",
        data: { error: "Token expired" },
      },
    };

    const errorHandler = (instance.interceptors.response as any).handlers[0].rejected;
    await assert.rejects(async () => {
      await errorHandler(mock401Error);
    });

    assert.equal(localStorage.getItem("modelscript-auth-token"), null);
    assert.equal(eventFired, true);
  });
});
