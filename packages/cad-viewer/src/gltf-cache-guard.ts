// SPDX-License-Identifier: AGPL-3.0-or-later

import { useGLTF } from "@react-three/drei";
import { useEffect } from "react";

interface RetainedGltfEntry {
  refs: number;
  lastUsed: number;
}

const MAX_RETAINED_DYNAMIC_GLTF_URLS = 16;
const retainedUrls = new Map<string, RetainedGltfEntry>();
let clockSeq = 0;
let evictionScheduled = false;

function isDynamicGltfUrl(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("blob:");
}

function scheduleLruEviction(): void {
  if (evictionScheduled || retainedUrls.size <= MAX_RETAINED_DYNAMIC_GLTF_URLS) {
    return;
  }
  evictionScheduled = true;
  queueMicrotask(() => {
    evictionScheduled = false;
    while (retainedUrls.size > MAX_RETAINED_DYNAMIC_GLTF_URLS) {
      let oldestUrl: string | null = null;
      let oldestStamp = Infinity;
      for (const [candidateUrl, entry] of retainedUrls.entries()) {
        if (entry.refs <= 0 && entry.lastUsed < oldestStamp) {
          oldestStamp = entry.lastUsed;
          oldestUrl = candidateUrl;
        }
      }
      if (!oldestUrl) {
        break;
      }
      retainedUrls.delete(oldestUrl);
      try {
        useGLTF.clear(oldestUrl);
      } catch {
        // Ignore clear errors for already-evicted entries
      }
    }
  });
}

/**
 * Retains a `data:` or `blob:` GLTF/GLB URL in `@react-three/drei`'s shared `useGLTF`
 * cache across React StrictMode mount/cleanup cycles, pointer-hover re-renders, and
 * 2D ↔ 3D ↔ VR Rotunda switches, while still bounding cache size via deferred LRU eviction.
 *
 * IMPORTANT: Never call `useGLTF.clear(url)` or dispose the shared `scene` geometries
 * synchronously inside a component cleanup — `scene.clone(true)` shares BufferGeometry
 * and Material references with the cached scene, and synchronous eviction triggers an
 * infinite Suspense flicker loop on every re-render.
 */
export function useRetainGltfUrl(url: string): void {
  useEffect(() => {
    if (!isDynamicGltfUrl(url)) return;
    const existing = retainedUrls.get(url);
    if (existing) {
      existing.refs += 1;
      existing.lastUsed = ++clockSeq;
    } else {
      retainedUrls.set(url, { refs: 1, lastUsed: ++clockSeq });
    }
    return () => {
      const entry = retainedUrls.get(url);
      if (entry) {
        entry.refs = Math.max(0, entry.refs - 1);
        entry.lastUsed = ++clockSeq;
      }
      scheduleLruEviction();
    };
  }, [url]);
}
