// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveReplyRecipients } from "../src/components/compose/useComposeAutocomplete.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Compose Box 'Replying to' Recipient Resolution Suite", () => {
  const composeBoxSrc = fs.readFileSync(path.resolve(__dirname, "../src/components/ComposeBox.tsx"), "utf-8");
  const recipientsModalSrc = fs.readFileSync(
    path.resolve(__dirname, "../src/components/compose/ComposeRecipientsModal.tsx"),
    "utf-8",
  );

  describe("1. resolveReplyRecipients Unit Tests", () => {
    it("returns [author] when replying to one's own post without other mentions", () => {
      const post = {
        id: "101",
        username: "modelscript",
        content: "First post in a thread about differential-algebraic equations.",
      };
      const recipients = resolveReplyRecipients(post, "modelscript");
      assert.deepEqual(recipients, ["modelscript"]);
    });

    it("returns [author, ...others] when replying to one's own post with other mentions", () => {
      const post = {
        id: "102",
        username: "alice",
        content: "Hey @bob and @carol, what do you think?",
      };
      const recipients = resolveReplyRecipients(post, "alice");
      assert.deepEqual(recipients, ["alice", "bob", "carol"]);
    });

    it("returns [author] when replying to another user's post with no other mentions", () => {
      const post = {
        id: "103",
        username: "bob",
        content: "Here is a cool model.",
      };
      const recipients = resolveReplyRecipients(post, "alice");
      assert.deepEqual(recipients, ["bob"]);
    });

    it("excludes current user from other mentions when replying to someone else", () => {
      const post = {
        id: "104",
        username: "bob",
        content: "Hey @alice and @carol, check this out!",
      };
      const recipients = resolveReplyRecipients(post, "alice");
      // alice is replying to bob, so alice is not listed in mentions
      assert.deepEqual(recipients, ["bob", "carol"]);
    });

    it("extracts username from nested author object", () => {
      const post = {
        id: "105",
        author: { username: "dave" },
        content: "Nested author object test.",
      };
      const recipients = resolveReplyRecipients(post, "alice");
      assert.deepEqual(recipients, ["dave"]);
    });

    it("extracts username from author_username fallback", () => {
      const post = {
        id: "106",
        author_username: "eve",
        content: "Author username fallback test.",
      };
      const recipients = resolveReplyRecipients(post, "alice");
      assert.deepEqual(recipients, ["eve"]);
    });

    it("strips leading @ from author username and mentions", () => {
      const post = {
        id: "107",
        username: "@frank",
        content: "Hello @grace!",
      };
      const recipients = resolveReplyRecipients(post, "@heidi");
      assert.deepEqual(recipients, ["frank", "grace"]);
    });

    it("returns empty array when replyToPost is missing or falsy", () => {
      assert.deepEqual(resolveReplyRecipients(null, "alice"), []);
      assert.deepEqual(resolveReplyRecipients(undefined, "alice"), []);
    });

    it("returns empty array when post has no username or author info and no mentions", () => {
      const post = { id: 108 };
      assert.deepEqual(resolveReplyRecipients(post, "alice"), []);
    });
  });

  describe("2. UI Guard against blank 'Replying to' Banner", () => {
    it("ComposeBox guards 'Replying to' render with includedUsers.length > 0", () => {
      assert.ok(
        composeBoxSrc.includes("includedUsers.length > 0"),
        "ComposeBox must guard Replying to banner with includedUsers.length > 0 to prevent rendering blank banner",
      );
    });

    it("ComposeBox hydrates replyToPost via getPost when only ID is provided", () => {
      assert.ok(
        composeBoxSrc.includes("getPost(replyToPost.id)"),
        "ComposeBox must fetch incomplete replyToPost objects to populate author info",
      );
    });

    it("ComposeRecipientsModal checks others.length > 0 rather than allMentionedUsers.length > 1", () => {
      assert.ok(
        recipientsModalSrc.includes("others.length > 0"),
        "ComposeRecipientsModal must check others.length > 0 for additional conversation recipients",
      );
    });
  });

  describe("3. Reply Box Horizontal Rule and Content Shift Prevention", () => {
    const toolbarSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/components/compose/ComposeToolbar.tsx"),
      "utf-8",
    );

    it("ComposeToolbar suppresses borderTop horizontal rule when replyToPost is present", () => {
      assert.ok(
        toolbarSrc.includes('borderTop: isReply || isModal || !isExpanded ? "none" : "1px solid var(--color-border)"'),
        "ComposeToolbar must set borderTop to 'none' when replying to a post",
      );
    });

    it("ComposeToolbar keeps paddingTop constant in reply mode to prevent content jump on focus/blur", () => {
      assert.ok(
        toolbarSrc.includes('paddingTop: isReply ? "4px" : isExpanded ? "12px" : "4px"'),
        "ComposeToolbar must maintain constant paddingTop in reply mode",
      );
    });

    it("ComposeToolbar suppresses AI pills row in reply mode to prevent shifting the toolbar on focus", () => {
      assert.ok(
        toolbarSrc.includes("const hasAiPills = Boolean(\n    !isReply &&"),
        "ComposeToolbar must suppress expanding AI pills in reply mode",
      );
    });
  });
});
