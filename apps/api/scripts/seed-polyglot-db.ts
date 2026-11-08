// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import { fileURLToPath } from "node:url";

import { LibraryDatabase } from "../src/database.js";
import { seedPolyglotSocialData } from "../src/seed/index.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(SCRIPT_DIR, "..");

async function main(): Promise<void> {
  const db = new LibraryDatabase(process.env["DB_PATH"] || process.env["DB_DIR"]);
  const uploadDir = path.join(db.dbDir, "uploads");
  try {
    const summary = await seedPolyglotSocialData(db, { uploadDir });
    console.log(
      `[PolyglotSeed] Completed: ${summary.usersSeeded} users, ${summary.artifactsCreated} artifacts, ${summary.postsCreated} posts, ${summary.commentsCreated} comments/replies, ${summary.organizationsSeeded ?? 0} orgs, ${summary.spacesSeeded ?? 0} spaces, ${summary.messagesSeeded ?? 0} chat messages.`,
    );
  } finally {
    db.close();
  }
}

void main();
