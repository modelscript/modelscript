import Parser from "rss-parser";
import type { LibraryDatabase } from "../database.js";

export async function processRssFeeds(database: LibraryDatabase) {
  const parser = new Parser({
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      Accept:
        "application/rss+xml, application/rdf+xml;q=0.8, application/atom+xml;q=0.6, application/xml;q=0.4, text/xml;q=0.4, text/html;q=0.2, */*;q=0.1",
    },
  });
  const feeds = database.getAllRssFeeds();

  for (const feed of feeds) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = [...parsed.items].reverse(); // oldest to newest

      let lastGuidFound = false;
      let newPostsCount = 0;

      for (const item of items) {
        const guid = item.guid || item.id || item.link;
        if (!guid) continue;

        // If we have a last_guid, skip until we find it
        if (feed.last_guid && !lastGuidFound) {
          if (guid === feed.last_guid) lastGuidFound = true;
          continue;
        }

        // It's a new item!
        const content = `${item.title}\n\n${item.contentSnippet ? item.contentSnippet.substring(0, 200) + "..." : ""}\n\n${item.link}`;

        database.createPost(feed.user_id, content);

        feed.last_guid = guid;
        newPostsCount++;
      }

      database.updateRssFeedStatus(feed.id, new Date().toISOString(), feed.last_guid);
      if (newPostsCount > 0) {
        console.log(`[RSS Worker] Added ${newPostsCount} posts for feed ${feed.title}`);
      }
    } catch (err) {
      console.error(`[RSS Worker] Failed to process feed ${feed.url}:`, err);
    }
  }
}
