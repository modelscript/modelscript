// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase } from "../database.js";
import { SocialBotOrchestrator } from "./ai/social-bot-orchestrator.js";

export class BotMentionWorker {
  #database: LibraryDatabase;
  #orchestrator: SocialBotOrchestrator;
  #isProcessing = false;
  #timer: NodeJS.Timeout | null = null;

  constructor(database: LibraryDatabase, orchestrator?: SocialBotOrchestrator) {
    this.#database = database;
    this.#orchestrator = orchestrator || new SocialBotOrchestrator(database);
  }

  start(intervalMs: number = 2000): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void this.processQueue();
    }, intervalMs);
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async processQueue(batchSize: number = 5): Promise<number> {
    if (this.#isProcessing) return 0;
    this.#isProcessing = true;

    let processedCount = 0;
    try {
      try {
        if (this.#database.getInstanceSettings().maintenanceMode) return 0;
      } catch {
        // Proceed if settings unavailable
      }
      const pendingJobs = this.#database.getPendingBotMentions(batchSize);
      for (const job of pendingJobs) {
        await this.#orchestrator.processMention(job.id);
        processedCount++;
      }
    } finally {
      this.#isProcessing = false;
    }

    return processedCount;
  }
}
