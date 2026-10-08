// SPDX-License-Identifier: AGPL-3.0-or-later

import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const window = new JSDOM("").window;
const purify = DOMPurify(window as unknown as Window);

describe("SVG Sanitization Pipeline", () => {
  const sanitize = (rawSvg: string) =>
    purify.sanitize(rawSvg, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });

  it("neutralizes embedded script tags inside SVG", () => {
    const maliciousSvg = '<svg><script>alert("xss")</script><circle cx="50" cy="50" r="40"/></svg>';
    const sanitized = sanitize(maliciousSvg);
    assert.ok(!sanitized.includes("<script"), "Sanitized SVG must not contain script tags");
    assert.ok(!sanitized.includes("alert"), "Sanitized SVG must not contain alert payload");
    assert.ok(sanitized.includes("<circle"), "Sanitized SVG must preserve valid circle geometry");
  });

  it("removes inline event handlers like onload and onerror", () => {
    const maliciousSvg =
      '<svg><image href="invalid.png" onerror="alert(document.cookie)" onload="evil()"/><text>Safe</text></svg>';
    const sanitized = sanitize(maliciousSvg);
    assert.ok(!sanitized.includes("onerror"), "Sanitized SVG must not contain onerror handlers");
    assert.ok(!sanitized.includes("onload"), "Sanitized SVG must not contain onload handlers");
    assert.ok(!sanitized.includes("document.cookie"), "Sanitized SVG must not contain cookie access");
    assert.ok(sanitized.includes("<text>Safe</text>"), "Sanitized SVG must preserve safe text");
  });

  it("strips javascript: pseudo-protocols from xlink:href and href", () => {
    const maliciousSvg =
      '<svg><a href="javascript:alert(1)"><text>Click</text></a><a xlink:href="javascript:void(0)">Link</a></svg>';
    const sanitized = sanitize(maliciousSvg);
    assert.ok(!sanitized.includes("javascript:"), "Sanitized SVG must not contain javascript: URIs");
  });

  it("preserves valid engineering vector elements, filters, and gradients", () => {
    const validSvg =
      '<svg viewBox="0 0 100 100"><defs><linearGradient id="grad1"><stop offset="0%" stop-color="red"/></linearGradient></defs><rect width="100" height="100" fill="url(#grad1)"/><path d="M 10 10 L 90 90"/></svg>';
    const sanitized = sanitize(validSvg);
    assert.ok(sanitized.includes("linearGradient"), "Must retain linearGradient");
    assert.ok(sanitized.includes("<rect"), "Must retain rect");
    assert.ok(sanitized.includes("<path"), "Must retain path");
  });
});
