// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CollabManager } from "./collab-manager.js";

/**
 * Renders SVG overlay markup for multi-user visual presence:
 * floating cursor avatars, selection locks, and pinned sticky notes.
 */
export class CollabOverlayRenderer {
  /**
   * Generates SVG elements for peer cursors and selection outlines.
   */
  static renderSvgOverlay(manager: CollabManager): string {
    const peers = manager.getActivePeers();
    const comments = manager.getAllComments();
    const parts: string[] = [];

    parts.push(`<g id="modelscript-collab-overlay" pointer-events="none">`);

    // 1. Peer Cursors
    for (const peer of peers) {
      if (!peer.cursor) continue;
      const { x, y } = peer.cursor;
      const color = peer.color || "#007acc";
      const name = peer.name || "Peer";

      parts.push(`
        <g class="collab-peer-cursor" transform="translate(${x}, ${y})" style="transition: transform 0.08s ease-out;">
          <path d="M0,0 L12,18 L6,14 L0,22 Z" fill="${color}" stroke="#ffffff" stroke-width="1.5" />
          <g transform="translate(14, 14)">
            <rect rx="3" ry="3" x="0" y="-12" width="${Math.max(name.length * 7 + 12, 40)}" height="18" fill="${color}" opacity="0.9" />
            <text x="6" y="0" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="600">${escapeXml(name)}</text>
          </g>
        </g>
      `);
    }

    // 2. Sticky Notes / Comments
    for (const comment of comments) {
      const { id, x, y, authorName, text } = comment;
      parts.push(`
        <g class="collab-comment-pin" transform="translate(${x}, ${y})" pointer-events="auto" data-comment-id="${id}">
          <circle r="10" fill="#ff9800" stroke="#ffffff" stroke-width="2" />
          <text text-anchor="middle" y="4" fill="#ffffff" font-size="11" font-weight="bold">💬</text>
          <g class="collab-comment-card" transform="translate(14, -14)">
            <rect rx="6" ry="6" width="160" height="60" fill="#252526" stroke="#ff9800" stroke-width="1.5" filter="drop-shadow(0 4px 12px rgba(0,0,0,0.5))" />
            <text x="8" y="16" fill="#ff9800" font-size="10" font-weight="bold">${escapeXml(authorName)}</text>
            <text x="8" y="32" fill="#cccccc" font-size="11">${escapeXml(text)}</text>
          </g>
        </g>
      `);
    }

    parts.push(`</g>`);
    return parts.join("\n");
  }

  /**
   * Generates HTML/CSS styles required for collaborative canvas visual elements.
   */
  static getStyles(): string {
    return `
      .collab-peer-cursor {
        will-change: transform;
      }
      .collab-comment-pin {
        cursor: pointer;
      }
      .collab-selection-lock {
        stroke-dasharray: 4, 4;
        animation: collabDash 1s linear infinite;
      }
      @keyframes collabDash {
        to { stroke-dashoffset: -8; }
      }
    `;
  }
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
