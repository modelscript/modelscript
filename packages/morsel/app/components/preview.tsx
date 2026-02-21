// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Context,
  ModelicaClassInstance,
  ModelicaStoredDefinitionSyntaxNode,
  renderDiagram,
} from "@modelscript/modelscript";
import React, { useEffect, useState } from "react";

interface ModelPreviewProps {
  content: string;
  context: Context | null;
  width?: number;
  height?: number;
}

function hashContent(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

const CACHE_KEY = "morsel_preview_cache_v2";
const MAX_CACHE_SIZE = 50;

let globalParseLock = Promise.resolve();

export const ModelPreview: React.FC<ModelPreviewProps> = ({ content, context, width = 120, height = 120 }) => {
  const [svgHtml, setSvgHtml] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const contentHash = hashContent(content);

    try {
      const cacheRaw = localStorage.getItem(CACHE_KEY);
      if (cacheRaw) {
        const cache = JSON.parse(cacheRaw);
        if (cache[contentHash]) {
          setSvgHtml(cache[contentHash]);
          return;
        }
      }
    } catch (e) {
      console.error("Cache read failed", e);
    }

    async function generatePreview() {
      await globalParseLock;
      if (!active) return;

      let resolveLock: () => void;
      globalParseLock = new Promise((r) => (resolveLock = r));

      try {
        if (!context || !content) {
          resolveLock!();
          return;
        }

        await new Promise((r) => setTimeout(r, 50));
        if (!active) {
          resolveLock!();
          return;
        }

        const tree = context.parse(".mo", content);
        if (!tree || !tree.rootNode || !active) {
          resolveLock!();
          return;
        }

        const node = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
        if (!node || node.classDefinitions.length === 0 || !active) {
          resolveLock!();
          return;
        }

        const instance = new ModelicaClassInstance(context, node.classDefinitions[0]);
        instance.instantiate();
        if (!active) {
          resolveLock!();
          return;
        }

        const svg = renderDiagram(instance);
        if (svg && active) {
          const html = svg.svg();
          setSvgHtml(html);

          try {
            const cacheRaw = localStorage.getItem(CACHE_KEY);
            let cache: Record<string, string> = cacheRaw ? JSON.parse(cacheRaw) : {};

            const keys = Object.keys(cache);
            if (keys.length >= MAX_CACHE_SIZE) {
              delete cache[keys[0]];
            }

            cache[contentHash] = html;
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
          } catch (e) {
            console.error("Cache write failed", e);
          }
        }
      } catch (e) {
        console.error("Failed to generate preview", e);
      } finally {
        resolveLock!();
      }
    }

    generatePreview();
    return () => {
      active = false;
    };
  }, [content, context]);

  if (!svgHtml) {
    return (
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.05)",
          borderRadius: 4,
        }}
      >
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Loading...</span>
      </div>
    );
  }

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        backgroundColor: "white",
        borderRadius: 4,
        padding: 4,
        border: "1px solid rgba(255,255,255,0.1)",
      }}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
};
