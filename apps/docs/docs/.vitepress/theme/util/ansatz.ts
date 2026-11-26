// SPDX-License-Identifier: AGPL-3.0-or-later
import { onMounted, ref } from "vue";

/**
 * Returns the active origin for the Ansatz platform.
 * In production (modelscript.org), this resolves to `https://ansatz.social`.
 * In local development, it dynamically resolves to the local platform container (e.g. `http://localhost:3001`).
 */
export function useAnsatzOrigin() {
  const ansatzOrigin = ref("https://ansatz.social");

  onMounted(() => {
    if (typeof window !== "undefined") {
      const { hostname, port, protocol } = window.location;
      const isLocal =
        hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
      if (isLocal) {
        const targetPort = port && port !== "5173" && port !== "4173" ? port : "3001";
        ansatzOrigin.value = `${protocol}//${hostname}:${targetPort}`;
      }
    }
  });

  return { ansatzOrigin };
}

/**
 * Returns the active origin for the ModelScript Blog.
 * In production (modelscript.org), resolves to `https://blog.modelscript.org`.
 * In local development, resolves to `http://blog.localhost` (when on `docs.localhost`) or `http://localhost:5174`.
 */
export function useBlogOrigin() {
  const blogOrigin = ref("https://blog.modelscript.org");

  onMounted(() => {
    if (typeof window !== "undefined") {
      const { hostname, port, protocol } = window.location;
      const isLocal =
        hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
      if (isLocal) {
        if (hostname === "docs.localhost" && !port) {
          blogOrigin.value = `${protocol}//blog.localhost`;
        } else {
          blogOrigin.value = `${protocol}//${hostname}:5174`;
        }
      }
    }
  });

  return { blogOrigin };
}
