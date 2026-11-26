<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed, ref } from "vue";
import { data as allPosts } from "../data/posts.data";

const { frontmatter } = useData();

const slug = computed(() => String(frontmatter.value.slug || ""));
const canonicalUrl = computed(() => `https://blog.modelscript.org/${slug.value}`);

const social = computed(() => {
  const raw = frontmatter.value.social && typeof frontmatter.value.social === "object"
    ? (frontmatter.value.social as Record<string, unknown>)
    : {};
  const hashtags = Array.isArray(raw.hashtags) ? raw.hashtags.map((h: unknown) => String(h)) : [];
  return {
    twitter: String(raw.twitter || frontmatter.value.description || frontmatter.value.title || ""),
    linkedin: String(raw.linkedin || frontmatter.value.description || ""),
    hashtags,
  };
});

const twitterShareHref = computed(() => {
  const params = new URLSearchParams({
    text: social.value.twitter,
    url: canonicalUrl.value,
  });
  return `https://x.com/intent/tweet?${params.toString()}`;
});

const linkedinShareHref = computed(() => {
  const params = new URLSearchParams({
    url: canonicalUrl.value,
  });
  return `https://www.linkedin.com/sharing/share-offsite/?${params.toString()}`;
});

const copiedState = ref<"none" | "link" | "linkedin">("none");

async function copyText(text: string, kind: "link" | "linkedin"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    copiedState.value = kind;
    setTimeout(() => {
      if (copiedState.value === kind) copiedState.value = "none";
    }, 2200);
  } catch {
    /* ignore clipboard permission issues */
  }
}

function copyLinkedinPost(): void {
  const tagsLine = social.value.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const full = [social.value.linkedin, "", canonicalUrl.value, ...(tagsLine ? ["", tagsLine] : [])].join("\n");
  void copyText(full, "linkedin");
}

const currentIndex = computed(() => allPosts.findIndex((p) => p.slug === slug.value));
const newerPost = computed(() => (currentIndex.value > 0 ? allPosts[currentIndex.value - 1] : null));
const olderPost = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < allPosts.length - 1 ? allPosts[currentIndex.value + 1] : null,
);
</script>

<template>
  <footer v-if="slug" class="ms-post-footer">
    <div class="ms-share-bar">
      <span class="ms-share-label">Share this post</span>
      <div class="ms-share-actions">
        <a :href="twitterShareHref" target="_blank" rel="noopener noreferrer" class="ms-share-btn">
          Post on X / Twitter ↗
        </a>
        <a :href="linkedinShareHref" target="_blank" rel="noopener noreferrer" class="ms-share-btn">
          Share on LinkedIn ↗
        </a>
        <button type="button" class="ms-share-btn" @click="copyLinkedinPost">
          {{ copiedState === "linkedin" ? "Copied LinkedIn Post ✓" : "Copy LinkedIn Copy" }}
        </button>
        <button type="button" class="ms-share-btn" @click="copyText(canonicalUrl, 'link')">
          {{ copiedState === "link" ? "Link Copied ✓" : "Copy Link" }}
        </button>
      </div>
    </div>

    <nav v-if="newerPost || olderPost" class="ms-post-nav" aria-label="Post navigation">
      <a v-if="newerPost" :href="newerPost.url" class="ms-post-nav-card">
        <span class="ms-nav-dir">← Newer post</span>
        <span class="ms-nav-title">{{ newerPost.title }}</span>
      </a>
      <div v-else />
      <a v-if="olderPost" :href="olderPost.url" class="ms-post-nav-card right">
        <span class="ms-nav-dir">Older post →</span>
        <span class="ms-nav-title">{{ olderPost.title }}</span>
      </a>
    </nav>
  </footer>
</template>

<style scoped>
.ms-post-footer {
  margin-top: 48px;
  padding-top: 28px;
  border-top: 1px solid var(--vp-c-divider);
}

.ms-share-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 16px 20px;
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  margin-bottom: 28px;
}

.ms-share-label {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.ms-share-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ms-share-btn {
  display: inline-flex;
  align-items: center;
  font-size: 12.5px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ms-share-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.ms-post-nav {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.ms-post-nav-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  text-decoration: none;
  transition: border-color 0.15s ease;
}

.ms-post-nav-card:hover {
  border-color: var(--vp-c-brand-1);
}

.ms-post-nav-card.right {
  text-align: right;
}

.ms-nav-dir {
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
}

.ms-nav-title {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--vp-c-brand-1);
}

@media (max-width: 640px) {
  .ms-post-nav {
    grid-template-columns: 1fr;
  }
}
</style>
