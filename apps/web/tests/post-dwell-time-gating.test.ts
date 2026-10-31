// SPDX-License-Identifier: AGPL-3.0-or-later

import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  POST_VIEW_DWELL_TIME_MS,
  clearViewedPostsSession,
  isPostViewedInSession,
  setupPostDwellObservation,
} from "../src/util/post-dwell.js";

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observedElements: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observedElements.push(element);
  }

  unobserve(element: Element) {
    this.observedElements = this.observedElements.filter((el) => el !== element);
  }

  disconnect() {
    this.observedElements = [];
  }

  trigger(entries: Partial<IntersectionObserverEntry>[]) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

describe("Post Impression Dwell-Time Gating Suite", () => {
  let dom: JSDOM;

  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    dom = new JSDOM(
      `<!DOCTYPE html>
      <html>
        <body>
          <div id="post-container"></div>
        </body>
      </html>`,
      { url: "https://ansatz.social/" },
    );
    (globalThis as any).window = dom.window;
    (globalThis as any).document = dom.window.document;
    (globalThis as any).sessionStorage = dom.window.sessionStorage;
    (globalThis as any).IntersectionObserver = MockIntersectionObserver;
    clearViewedPostsSession();
  });

  it("exports POST_VIEW_DWELL_TIME_MS configured to 750ms", () => {
    assert.strictEqual(typeof POST_VIEW_DWELL_TIME_MS, "number");
    assert.strictEqual(POST_VIEW_DWELL_TIME_MS, 750);
  });

  it("bypasses dwell gating and records immediately on direct detail view", () => {
    const container = dom.window.document.getElementById("post-container") as HTMLElement;
    let viewRecorded = false;

    setupPostDwellObservation(container, {
      postId: 101,
      isDetail: true,
      onView: () => {
        viewRecorded = true;
      },
    });

    assert.strictEqual(viewRecorded, true, "Detail view must record view immediately without dwell wait");
    assert.strictEqual(isPostViewedInSession(101), true, "Post must be marked viewed in session");
  });

  it("cancels impression registration if scrolled out of viewport before dwell threshold", async () => {
    const container = dom.window.document.getElementById("post-container") as HTMLElement;
    let viewRecorded = false;

    const cleanup = setupPostDwellObservation(container, {
      postId: 202,
      dwellTimeMs: 150, // Scaled for fast unit test
      onView: () => {
        viewRecorded = true;
      },
    });

    const observer = MockIntersectionObserver.instances[0];
    assert.ok(observer, "IntersectionObserver instance should be created");

    // 1. User scrolls into view
    observer.trigger([{ isIntersecting: true }]);

    // 2. User flings past within 50ms (< 150ms dwell threshold)
    await new Promise((r) => setTimeout(r, 50));
    observer.trigger([{ isIntersecting: false }]);

    // 3. Wait past the original 150ms window
    await new Promise((r) => setTimeout(r, 150));

    assert.strictEqual(viewRecorded, false, "Impression must NOT be recorded on fast transit scroll");
    assert.strictEqual(isPostViewedInSession(202), false, "Post must not be marked viewed in session");

    cleanup();
  });

  it("records impression when user dwells continuously in viewport past threshold", async () => {
    const container = dom.window.document.getElementById("post-container") as HTMLElement;
    let viewRecorded = false;

    const cleanup = setupPostDwellObservation(container, {
      postId: 303,
      dwellTimeMs: 100, // Scaled for fast unit test
      onView: () => {
        viewRecorded = true;
      },
    });

    const observer = MockIntersectionObserver.instances[0];
    assert.ok(observer);

    // User enters viewport and stays dwelling
    observer.trigger([{ isIntersecting: true }]);
    await new Promise((r) => setTimeout(r, 140));

    assert.strictEqual(viewRecorded, true, "Impression must be recorded once dwell threshold is reached");
    assert.strictEqual(isPostViewedInSession(303), true);

    // Re-triggering intersection does not fire redundant views
    viewRecorded = false;
    observer.trigger([{ isIntersecting: true }]);
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(viewRecorded, false, "Subsequent intersections must not fire redundant views");

    cleanup();
  });

  it("cancels dwell timer if user switches tabs (document visibility hidden)", async () => {
    const container = dom.window.document.getElementById("post-container") as HTMLElement;
    let viewRecorded = false;

    const cleanup = setupPostDwellObservation(container, {
      postId: 404,
      dwellTimeMs: 150,
      onView: () => {
        viewRecorded = true;
      },
    });

    const observer = MockIntersectionObserver.instances[0];
    assert.ok(observer);

    // Enter viewport
    observer.trigger([{ isIntersecting: true }]);

    // User switches tab after 40ms
    await new Promise((r) => setTimeout(r, 40));
    Object.defineProperty(dom.window.document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));

    // Wait past remaining timer
    await new Promise((r) => setTimeout(r, 160));

    assert.strictEqual(viewRecorded, false, "Impression must not be recorded if tab was hidden during dwell");
    assert.strictEqual(isPostViewedInSession(404), false);

    cleanup();
  });

  it("respects custom dwellTimeMs passed via options", async () => {
    const container = dom.window.document.getElementById("post-container") as HTMLElement;
    let viewRecorded = false;

    const cleanup = setupPostDwellObservation(container, {
      postId: 505,
      dwellTimeMs: 100,
      onView: () => {
        viewRecorded = true;
      },
    });

    const observer = MockIntersectionObserver.instances[0];
    assert.ok(observer);
    observer.trigger([{ isIntersecting: true }]);

    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(viewRecorded, false, "Should not record before custom dwell threshold");

    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(viewRecorded, true, "Should record once custom dwell threshold reached");

    cleanup();
  });
});
