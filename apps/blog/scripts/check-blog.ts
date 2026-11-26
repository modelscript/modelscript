// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Validates all blog posts in `apps/blog/blog/posts/YYYY-MM-DD-<slug>/index.md`:
//   - Uniform folder-per-post naming
//   - Required frontmatter (title, slug, date, description, author, tags)
//   - Twitter (short) & LinkedIn (medium) social summary metadata & character budgets
//   - Unique slugs and valid explicit OG image paths

import fs from "node:fs";
import path from "node:path";
import {
  discoverPosts,
  LINKEDIN_MAX_CHARS,
  LINKEDIN_MIN_CHARS,
  LINKEDIN_RECOMMENDED_MAX_CHARS,
  PUBLIC_ROOT,
  TWITTER_MAX_CHARS,
  TWITTER_THREAD_MAX_CHARS,
} from "./blog-schema.js";

function main(): void {
  const { posts, structureErrors } = discoverPosts({ includeDrafts: true });
  const errors: string[] = [...structureErrors];
  const warnings: string[] = [];
  const seenSlugs = new Map<string, string>();

  for (const post of posts) {
    const loc = `posts/${post.folderName}/index.md`;

    if (!post.title) {
      errors.push(`${loc}: Missing required frontmatter field "title".`);
    }
    if (!post.slug) {
      errors.push(`${loc}: Missing required frontmatter field "slug".`);
    } else if (post.slug !== post.folderSlug) {
      errors.push(
        `${loc}: Frontmatter slug "${post.slug}" does not match folder slug "${post.folderSlug}". Keep them identical.`,
      );
    }

    if (!post.date || !/^\d{4}-\d{2}-\d{2}$/.test(post.date)) {
      errors.push(`${loc}: Missing or invalid frontmatter "date" (expected YYYY-MM-DD).`);
    } else if (post.date !== post.folderDate) {
      errors.push(`${loc}: Frontmatter date "${post.date}" does not match folder date prefix "${post.folderDate}".`);
    }

    if (!post.description) {
      errors.push(`${loc}: Missing required frontmatter field "description".`);
    } else if (post.description.length > 200) {
      warnings.push(`${loc}: "description" is ${post.description.length} chars (recommended ≤ 160 for SEO).`);
    }

    if (!post.author) {
      errors.push(`${loc}: Missing required frontmatter field "author".`);
    }

    if (post.tags.length === 0) {
      errors.push(`${loc}: Frontmatter "tags" must contain at least one tag.`);
    }

    if (post.slug) {
      const prev = seenSlugs.get(post.slug);
      if (prev) {
        errors.push(`${loc}: Duplicate slug "${post.slug}" (already used by ${prev}).`);
      } else {
        seenSlugs.set(post.slug, loc);
      }
    }

    // Social summary metadata checks (Twitter & LinkedIn)
    if (!post.social.twitter) {
      errors.push(`${loc}: Missing required "social.twitter" short summary for X/Twitter publishing.`);
    } else if (post.social.twitter.length > TWITTER_MAX_CHARS) {
      errors.push(
        `${loc}: "social.twitter" is ${post.social.twitter.length} chars (max ${TWITTER_MAX_CHARS} to leave room for the canonical URL).`,
      );
    }

    if (post.social.twitterThread) {
      post.social.twitterThread.forEach((tweet, idx) => {
        if (tweet.length > TWITTER_THREAD_MAX_CHARS) {
          errors.push(
            `${loc}: "social.twitterThread[${idx}]" is ${tweet.length} chars (max ${TWITTER_THREAD_MAX_CHARS}).`,
          );
        }
      });
    }

    if (!post.social.linkedin) {
      errors.push(`${loc}: Missing required "social.linkedin" medium summary for LinkedIn publishing.`);
    } else {
      if (post.social.linkedin.length < LINKEDIN_MIN_CHARS) {
        warnings.push(
          `${loc}: "social.linkedin" is quite short (${post.social.linkedin.length} chars; recommended ${LINKEDIN_MIN_CHARS}–${LINKEDIN_RECOMMENDED_MAX_CHARS}).`,
        );
      }
      if (post.social.linkedin.length > LINKEDIN_MAX_CHARS) {
        errors.push(`${loc}: "social.linkedin" is ${post.social.linkedin.length} chars (max ${LINKEDIN_MAX_CHARS}).`);
      } else if (post.social.linkedin.length > LINKEDIN_RECOMMENDED_MAX_CHARS) {
        warnings.push(
          `${loc}: "social.linkedin" is ${post.social.linkedin.length} chars (recommended ≤ ${LINKEDIN_RECOMMENDED_MAX_CHARS} for optimal feed engagement).`,
        );
      }
    }

    // Validate explicit OG image path (auto-generated `/og/<slug>.png` is created by gen-og.ts)
    if (post.ogImageExplicit && !/^https?:\/\//.test(post.ogImageExplicit)) {
      const autoPath = `/og/${post.slug}.png`;
      if (post.ogImageExplicit !== autoPath) {
        const candidatePublic = path.join(PUBLIC_ROOT, post.ogImageExplicit.replace(/^\/+/, ""));
        const candidateLocal = path.resolve(path.dirname(post.filePath), post.ogImageExplicit);
        if (!fs.existsSync(candidatePublic) && !fs.existsSync(candidateLocal)) {
          errors.push(`${loc}: Explicit ogImage "${post.ogImageExplicit}" was not found on disk.`);
        }
      }
    }
  }

  for (const w of warnings) {
    console.warn(`⚠ ${w}`);
  }

  if (errors.length > 0) {
    console.error(`\n✗ Blog validation failed with ${errors.length} error(s):\n`);
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  const publishedCount = posts.filter((p) => !p.draft).length;
  const draftCount = posts.length - publishedCount;
  console.log(
    `✓ Blog validation passed (${publishedCount} published post${publishedCount === 1 ? "" : "s"}${draftCount ? `, ${draftCount} draft` : ""}).`,
  );
}

main();
