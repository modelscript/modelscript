// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import { fileURLToPath } from "node:url";

import { LibraryDatabase } from "../src/database.js";
import { seedPolyglotSocialData } from "../src/seed/index.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(SCRIPT_DIR, "..");

async function main(): Promise<void> {
  const dbPath = path.join(API_ROOT, "data", "modelscript.db");
  const uploadDir = path.join(API_ROOT, "data", "uploads");
  const db = new LibraryDatabase(dbPath);
  try {
    const summary = await seedPolyglotSocialData(db, { uploadDir });
    console.log(
      `[PolyglotSeed] Completed: ${summary.usersSeeded} users, ${summary.artifactsCreated} artifacts, ${summary.postsCreated} posts, ${summary.commentsCreated} comments/replies.`,
    );
  } finally {
    db.close();
  }
}

void main();
