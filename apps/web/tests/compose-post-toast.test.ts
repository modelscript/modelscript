// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { getPostUrl } from "../src/util/url.js";

describe("Compose Post Toast with Link Suite", () => {
  const submitSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/compose/useComposeSubmit.ts"),
    "utf-8",
  );
  const toastSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/ToastContext.tsx"), "utf-8");

  describe("1. getPostUrl Canonical Routing", () => {
    it("generates canonical /@username/status/:id when username is present", () => {
      assert.equal(getPostUrl({ id: "101", username: "octocat" }), "/@octocat/status/101");
      assert.equal(getPostUrl({ id: 202, username: "alice" }), "/@alice/status/202");
    });

    it("strips redundant leading @ from username if already prefixed", () => {
      assert.equal(getPostUrl({ id: "303", username: "@bob" }), "/@bob/status/303");
      assert.equal(getPostUrl({ id: "404", username: "@@carol" }), "/@carol/status/404");
    });

    it("extracts username from nested author object if present", () => {
      assert.equal(getPostUrl({ id: "505", author: { username: "dave" } }), "/@dave/status/505");
    });

    it("falls back to /posts/:id if username is missing or empty", () => {
      assert.equal(getPostUrl({ id: "606" }), "/posts/606");
      assert.equal(getPostUrl({ id: 707, username: "" }), "/posts/707");
      assert.equal(getPostUrl({ id: 808, username: null }), "/posts/808");
    });

    it("returns null if post or post.id is missing", () => {
      assert.equal(getPostUrl(null), null);
      assert.equal(getPostUrl(undefined), null);
      assert.equal(getPostUrl({ id: undefined }), null);
      assert.equal(getPostUrl({ id: null }), null);
    });
  });

  describe("2. ToastContext Action Link & Node Enhancements", () => {
    it("defines ActionLink and actionCommonStyles for accessible anchor actions", () => {
      assert.ok(toastSrc.includes("const ActionLink = styled.a"), "ToastContext must define ActionLink as styled.a");
      assert.ok(toastSrc.includes("href?: string | undefined"), "ToastOptions action must support optional href");
    });

    it("supports React.ReactNode messages and fallbackToastContext", () => {
      assert.ok(
        toastSrc.includes("message: React.ReactNode"),
        "ToastOptions must support React.ReactNode for flexible toast message content",
      );
      assert.ok(
        toastSrc.includes("fallbackToastContext"),
        "useToast must return fallbackToastContext when outside ToastProvider to guard tests",
      );
    });

    it("renders ActionLink with href when t.action.href is present", () => {
      assert.ok(
        toastSrc.includes("t.action.href ? (") && toastSrc.includes("<ActionLink"),
        "ToastCard must render ActionLink when action.href is provided",
      );
    });
  });

  describe("3. useComposeSubmit Toast Integration", () => {
    it("imports useToast, useNavigate, and getPostUrl", () => {
      assert.ok(
        submitSrc.includes('import { useToast } from "../ToastContext"'),
        "useComposeSubmit must import useToast",
      );
      assert.ok(
        submitSrc.includes('import { useNavigate } from "react-router-dom"'),
        "useComposeSubmit must import useNavigate",
      );
      assert.ok(
        submitSrc.includes('import { getPostUrl } from "../../util/url"'),
        "useComposeSubmit must import getPostUrl",
      );
    });

    it("triggers toast with post link upon successful post creation", () => {
      assert.ok(
        submitSrc.includes("const postUrl = getPostUrl(post)"),
        "useComposeSubmit must compute postUrl via getPostUrl",
      );
      assert.ok(submitSrc.includes('label: "View post"'), "useComposeSubmit must provide 'View post' action label");
      assert.ok(submitSrc.includes("href: postUrl"), "useComposeSubmit must pass postUrl as action href");
      assert.ok(submitSrc.includes("navigate(postUrl)"), "useComposeSubmit action onClick must navigate to postUrl");
    });

    it("displays error toast on post creation failure", () => {
      assert.ok(submitSrc.includes("toast.error("), "useComposeSubmit must show error toast in catch block");
    });
  });
});
