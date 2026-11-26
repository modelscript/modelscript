<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { resolveAuthor } from "../data/authors";
import { data as allPosts } from "../data/posts.data";

const selectedTag = ref<string | null>(null);

const allTags = computed(() => {
  const counts = new Map<string, number>();
  for (const post of allPosts) {
    for (const tag of post.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
});

const filteredPosts = computed(() => {
  if (!selectedTag.value) return allPosts;
  return allPosts.filter((p) => p.tags.includes(selectedTag.value!));
});

const featuredPost = computed(() => {
  if (selectedTag.value) return null;
  return allPosts.find((p) => p.featured) ?? allPosts[0] ?? null;
});

const feedPosts = computed(() => {
  if (!featuredPost.value) return filteredPosts.value;
  return filteredPosts.value.filter((p) => p.slug !== featuredPost.value!.slug);
});

function formatDate(isoDate: string): string {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
</script>

<template>
  <div class="ms-blog-home">
    <header class="ms-blog-hero">
      <p class="ms-blog-eyebrow">MODELSCRIPT ENGINEERING BLOG</p>
      <h1 class="ms-blog-headline">Computable Engineering, Live in the Browser</h1>
      <p class="ms-blog-lead">
        Deep dives on polyglot simulation, linear-memory WebAssembly compilers, formal verification, and interactive
        Ansatz artifacts you can run directly inside every post.
      </p>
    </header>

    <!-- Tag Filter Bar -->
    <div v-if="allTags.length > 0" class="ms-tag-bar" role="tablist" aria-label="Filter posts by tag">
      <button
        type="button"
        class="ms-tag-pill"
        :class="{ active: selectedTag === null }"
        @click="selectedTag = null"
      >
        All ({{ allPosts.length }})
      </button>
      <button
        v-for="item in allTags"
        :key="item.tag"
        type="button"
        class="ms-tag-pill"
        :class="{ active: selectedTag === item.tag }"
        @click="selectedTag = selectedTag === item.tag ? null : item.tag"
      >
        #{{ item.tag }} <span class="ms-tag-count">{{ item.count }}</span>
      </button>
    </div>

    <!-- Featured Post -->
    <a v-if="featuredPost" :href="featuredPost.url" class="ms-featured-card">
      <div class="ms-featured-media">
        <img :src="featuredPost.ogImage" :alt="featuredPost.title" loading="eager" />
      </div>
      <div class="ms-featured-body">
        <div class="ms-post-meta">
          <span class="ms-featured-badge">Latest</span>
          <time :datetime="featuredPost.date">{{ formatDate(featuredPost.date) }}</time>
          <span aria-hidden="true">·</span>
          <span>{{ featuredPost.readingTimeMinutes }} min read</span>
        </div>
        <h2 class="ms-featured-title">{{ featuredPost.title }}</h2>
        <p class="ms-featured-desc">{{ featuredPost.description }}</p>
        <div class="ms-post-footer-row">
          <span class="ms-author-name">{{ resolveAuthor(featuredPost.author).name }}</span>
          <div class="ms-card-tags">
            <span v-for="t in featuredPost.tags.slice(0, 4)" :key="t" class="ms-mini-tag">#{{ t }}</span>
          </div>
        </div>
      </div>
    </a>

    <!-- Chronological Feed -->
    <section v-if="feedPosts.length > 0" class="ms-post-grid" aria-label="Blog posts">
      <a v-for="post in feedPosts" :key="post.slug" :href="post.url" class="ms-post-card">
        <div class="ms-post-meta">
          <time :datetime="post.date">{{ formatDate(post.date) }}</time>
          <span aria-hidden="true">·</span>
          <span>{{ post.readingTimeMinutes }} min read</span>
        </div>
        <h3 class="ms-post-card-title">{{ post.title }}</h3>
        <p class="ms-post-card-desc">{{ post.description }}</p>
        <div class="ms-post-footer-row">
          <span class="ms-author-name">{{ resolveAuthor(post.author).name }}</span>
          <div class="ms-card-tags">
            <span v-for="t in post.tags.slice(0, 3)" :key="t" class="ms-mini-tag">#{{ t }}</span>
          </div>
        </div>
      </a>
    </section>

    <p v-if="filteredPosts.length === 0" class="ms-empty">No posts match this tag yet.</p>
  </div>
</template>

<style scoped>
.ms-blog-home {
  max-width: 1040px;
  margin: 0 auto;
  padding: 48px 24px 80px;
}

.ms-blog-hero {
  margin-bottom: 36px;
  max-width: 760px;
}

.ms-blog-eyebrow {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--vp-c-brand-1);
  margin: 0 0 12px;
}

.ms-blog-headline {
  font-size: clamp(2rem, 4.2vw, 3rem);
  line-height: 1.12;
  font-weight: 800;
  letter-spacing: -0.025em;
  margin: 0 0 16px;
  color: var(--vp-c-text-1);
}

.ms-blog-lead {
  font-size: 1.1rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0;
}

.ms-tag-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 28px;
}

.ms-tag-pill {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
}

.ms-tag-pill:hover,
.ms-tag-pill.active {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.ms-tag-count {
  opacity: 0.7;
  margin-left: 2px;
}

.ms-featured-card {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 28px;
  padding: 24px;
  border-radius: 18px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  color: inherit;
  margin-bottom: 32px;
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.ms-featured-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
  box-shadow: 0 18px 40px -18px rgba(2, 6, 23, 0.3);
}

.ms-featured-media {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  aspect-ratio: 1200 / 630;
  background: var(--vp-c-bg-alt);
}

.ms-featured-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ms-featured-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.ms-featured-badge {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.ms-featured-title {
  font-size: 1.6rem;
  line-height: 1.25;
  font-weight: 800;
  margin: 10px 0 12px;
  color: var(--vp-c-text-1);
}

.ms-featured-desc {
  font-size: 0.98rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0 0 18px;
}

.ms-post-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.ms-post-card {
  display: flex;
  flex-direction: column;
  padding: 22px;
  border-radius: 14px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.ms-post-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.ms-post-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
}

.ms-post-card-title {
  font-size: 1.2rem;
  line-height: 1.35;
  font-weight: 700;
  margin: 10px 0 8px;
  color: var(--vp-c-text-1);
}

.ms-post-card-desc {
  font-size: 0.92rem;
  line-height: 1.55;
  color: var(--vp-c-text-2);
  margin: 0 0 16px;
  flex: 1;
}

.ms-post-footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: auto;
}

.ms-author-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.ms-card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.ms-mini-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-brand-1);
}

.ms-empty {
  color: var(--vp-c-text-2);
  padding: 24px 0;
}

@media (max-width: 768px) {
  .ms-featured-card {
    grid-template-columns: 1fr;
  }
}
</style>
