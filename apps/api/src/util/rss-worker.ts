import Parser from "rss-parser";
import type { LibraryDatabase } from "../database.js";

// Extensible framework for domain-specific feed handlers
interface FeedItemProcessor {
  matchUrl(url: string): boolean;
  processItem(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    item: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    feed: any,
    database: LibraryDatabase,
  ): { content: string; artifactViewId?: number | undefined };
}

const feedProcessors: FeedItemProcessor[] = [
  // YouTube Handler
  {
    matchUrl: (url) => url.includes("youtube.com"),
    processItem: (item, feed, database) => {
      let content = `**${item.title}**\n\n`;
      let artifactViewId: number | undefined;

      const extItem = item as typeof item & {
        mediaGroup?: Record<string, unknown[]>;
        videoId?: string;
      };

      if (extItem.mediaGroup) {
        const mg = extItem.mediaGroup;
        const thumbnail = mg["media:thumbnail"]?.[0]?.$?.url;

        if (extItem.videoId && thumbnail) {
          artifactViewId = database.createArtifactView(
            feed.user_id,
            "youtube_video",
            "youtube_id",
            JSON.stringify({ videoId: extItem.videoId }),
            item.title,
            thumbnail,
          );
        }

        const description = mg["media:description"]?.[0] || item.contentSnippet;
        if (description) {
          content += `${description.substring(0, 300)}...\n\n`;
        }
      }

      return { content, artifactViewId };
    },
  },
  // DailyMotion Handler (Example template)
  {
    matchUrl: (url) => url.includes("dailymotion.com"),
    processItem: (item) => {
      // Implement specific DailyMotion media extraction here
      let content = `**${item.title}**\n\n`;
      if (item.contentSnippet) {
        content += `${item.contentSnippet.substring(0, 300)}... (DailyMotion)`;
      }
      return { content };
    },
  },
  // Default Fallback Handler
  {
    matchUrl: () => true,
    processItem: (item) => {
      let content = `**${item.title}**\n\n`;
      if (item.contentSnippet) {
        content += `${item.contentSnippet.substring(0, 300)}...`;
      }
      return { content };
    },
  },
];

export async function processRssFeeds(database: LibraryDatabase) {
  const parser = new Parser({
    customFields: {
      feed: ["author"],
      item: [
        ["yt:videoId", "videoId"],
        ["yt:channelId", "channelId"],
        ["media:group", "mediaGroup"],
        ["published", "publishedAt"],
        ["updated", "updatedAt"],
      ],
    },
  });

  // Only get feeds that are due for polling
  const feeds = database.getRssFeedsToPoll();

  for (const feed of feeds) {
    try {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
        Accept: "application/rss+xml, application/xml, text/xml",
      };

      // 3. Smart HTTP Caching
      if (feed.etag) headers["If-None-Match"] = feed.etag;
      if (feed.last_modified) headers["If-Modified-Since"] = feed.last_modified;

      const res = await fetch(feed.url, { headers });

      // Adaptive Polling parameters
      const MIN_INTERVAL = 15; // 15 minutes
      const MAX_INTERVAL = 24 * 60; // 24 hours
      let currentInterval = feed.poll_interval_mins || MIN_INTERVAL;

      if (res.status === 304) {
        // Not modified. 4. Exponential Backoff
        currentInterval = Math.min(currentInterval * 1.5, MAX_INTERVAL); // Increase interval
        database.updateRssFeedPollMetadata(feed.id, feed.etag, feed.last_modified, Math.round(currentInterval));
        continue; // Skip parsing
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      // Read new headers
      const newEtag = res.headers.get("etag");
      const newLastModified = res.headers.get("last-modified");

      // Parse the body
      const xmlBody = await res.text();
      const parsed = await parser.parseString(xmlBody);
      const items = [...parsed.items].reverse();

      let lastGuidFound = false;
      let newPostsCount = 0;

      for (const item of items) {
        const guid = item.guid || ((item as unknown as Record<string, unknown>).id as string | undefined) || item.link;
        if (!guid) continue;

        if (feed.last_guid && !lastGuidFound) {
          if (guid === feed.last_guid) lastGuidFound = true;
          continue;
        }

        // Find the right processor for this domain
        const processor = (feedProcessors.find((p) => p.matchUrl(feed.url)) ||
          feedProcessors[feedProcessors.length - 1]) as FeedItemProcessor;
        const { content, artifactViewId } = processor.processItem(item, feed, database);

        const extItem = item as unknown as Record<string, unknown>;
        const pubDate =
          (item.isoDate as string) ||
          (item.pubDate as string) ||
          (extItem.publishedAt as string) ||
          new Date().toISOString();
        const updateDate = (extItem.updatedAt as string) || pubDate;

        database.createPost(
          feed.user_id,
          content,
          artifactViewId,
          undefined,
          undefined,
          undefined,
          undefined,
          item.link,
          pubDate,
          updateDate,
          undefined,
        );

        feed.last_guid = guid;
        newPostsCount++;
      }

      database.updateRssFeedStatus(feed.id, new Date().toISOString(), feed.last_guid);

      // If we found new posts, reset the poll interval!
      if (newPostsCount > 0) {
        currentInterval = MIN_INTERVAL;
        console.log(
          `[RSS Worker] Added ${newPostsCount} posts for feed ${feed.title}. Resetting interval to ${MIN_INTERVAL}m`,
        );
      } else {
        // Even if we downloaded the full feed (maybe server ignores ETags), if there's no new posts, back off.
        currentInterval = Math.min(currentInterval * 1.2, MAX_INTERVAL);
      }

      database.updateRssFeedPollMetadata(feed.id, newEtag, newLastModified, Math.round(currentInterval));
    } catch (err) {
      console.error(`[RSS Worker] Failed to process feed ${feed.url}:`, err);
      // On failure, slowly back off to avoid spamming a dead server
      const fallbackInterval = feed.poll_interval_mins || 15;
      database.updateRssFeedPollMetadata(
        feed.id,
        feed.etag,
        feed.last_modified,
        Math.min(Math.round(fallbackInterval * 1.5), 24 * 60),
      );
    }
  }
}
