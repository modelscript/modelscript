// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CLI helper to print ready-to-paste Twitter/X and LinkedIn copy for a blog post.
// Usage: pnpm --filter @modelscript/blog social [slug]

import { discoverPosts, SITE_URL } from "./blog-schema.js";

function main(): void {
  const targetSlug = process.argv[2]?.trim();
  const { posts } = discoverPosts({ includeDrafts: true });

  if (posts.length === 0) {
    console.log("No blog posts found in apps/blog/blog/posts/.");
    return;
  }

  const selected = targetSlug ? posts.filter((p) => p.slug === targetSlug) : [posts[0]!];
  if (selected.length === 0) {
    console.error(`Post "${targetSlug}" not found. Available slugs: ${posts.map((p) => p.slug).join(", ")}`);
    process.exit(1);
  }

  for (const post of selected) {
    const hashtags = (post.social.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
    const ogAbsolute = /^https?:\/\//.test(post.ogImage)
      ? post.ogImage
      : `${SITE_URL}/${post.ogImage.replace(/^\/+/, "")}`;

    console.log(`\n══════════════════════════════════════════════════════════════`);
    console.log(`POST:  ${post.title}`);
    console.log(`URL:   ${post.canonicalUrl}`);
    console.log(`OG:    ${ogAbsolute}`);
    console.log(`══════════════════════════════════════════════════════════════\n`);

    console.log(`--- X / TWITTER (${post.social.twitter.length} chars + link) ---`);
    console.log(`${post.social.twitter}\n\n${post.canonicalUrl}\n`);

    if (post.social.twitterThread && post.social.twitterThread.length > 0) {
      console.log(`--- X / TWITTER THREAD (${post.social.twitterThread.length} replies) ---`);
      post.social.twitterThread.forEach((tweet, i) => {
        console.log(`[${i + 1}] (${tweet.length} chars) ${tweet}`);
      });
      console.log("");
    }

    console.log(`--- LINKEDIN (${post.social.linkedin.length} chars) ---`);
    console.log(post.social.linkedin);
    console.log(`\n${post.canonicalUrl}`);
    if (hashtags) {
      console.log(`\n${hashtags}`);
    }
    console.log("");
  }
}

main();
