// SPDX-License-Identifier: AGPL-3.0-or-later

export interface PostLocationItem {
  postId: number;
  countryCode: string;
  regionCode: string | null;
  count: number;
}

export interface PageViewItem {
  viewDate: string;
  surface: "web" | "docs";
  path: string;
  views: number;
  uniques: number;
}

export interface PageLocationItem {
  viewDate: string;
  surface: "web" | "docs";
  countryCode: string;
  regionCode: string;
  count: number;
}

export interface PackageDownloadItem {
  libraryName: string;
  libraryVersion: string;
  downloadDate: string;
  count: number;
}

export interface BatchAnalyticsPayload {
  postViews: [number, number][]; // [postId, delta][]
  postLocationViews: PostLocationItem[];
  pageViews: PageViewItem[];
  pageLocationViews: PageLocationItem[];
  packageDownloads: PackageDownloadItem[];
}

export interface AnalyticsBufferTarget {
  flushAnalyticsBatch(batch: BatchAnalyticsPayload): void;
}

export interface AnalyticsBufferOptions {
  /** Periodic flush interval in milliseconds (defaults to 5000ms; <= 0 disables timer). */
  flushIntervalMs?: number | undefined;
  /** Maximum number of uncommitted delta records before triggering an immediate flush (default: 2000). */
  maxBufferSize?: number | undefined;
  /** Whether to automatically start the flush timer (defaults to true in non-test mode). */
  autoStart?: boolean | undefined;
}

/**
 * In-Memory Write-Coalescing Buffer for High-Concurrency Analytics.
 *
 * Coalesces hot-path analytics increments (social post impressions, geo-distribution,
 * unified page views, and package downloads) in volatile RAM. Flushes periodically or
 * upon threshold in a single atomic SQLite transaction, reducing disk writes by 99.9%.
 */
export class AnalyticsBuffer {
  private postViews = new Map<number, number>();
  private postLocationViews = new Map<string, PostLocationItem>();
  private pageViews = new Map<string, PageViewItem>();
  private pageLocationViews = new Map<string, PageLocationItem>();
  private packageDownloads = new Map<string, PackageDownloadItem>();

  private timer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  public readonly flushIntervalMs: number;
  public readonly maxBufferSize: number;

  constructor(
    private readonly target: AnalyticsBufferTarget,
    options: AnalyticsBufferOptions = {},
  ) {
    const envFlushInterval = process.env["ANALYTICS_FLUSH_INTERVAL_MS"]
      ? Number(process.env["ANALYTICS_FLUSH_INTERVAL_MS"])
      : NaN;
    const defaultInterval = process.env["NODE_ENV"] === "test" ? 0 : 5000;
    this.flushIntervalMs =
      options.flushIntervalMs !== undefined
        ? options.flushIntervalMs
        : Number.isFinite(envFlushInterval) && envFlushInterval >= 0
          ? envFlushInterval
          : defaultInterval;

    const envMaxBufferSize = process.env["ANALYTICS_MAX_BUFFER_SIZE"]
      ? Number(process.env["ANALYTICS_MAX_BUFFER_SIZE"])
      : NaN;
    this.maxBufferSize =
      options.maxBufferSize !== undefined
        ? options.maxBufferSize
        : Number.isFinite(envMaxBufferSize) && envMaxBufferSize > 0
          ? envMaxBufferSize
          : 2000;

    const shouldAutoStart = options.autoStart ?? (process.env["NODE_ENV"] !== "test" && this.flushIntervalMs > 0);
    if (shouldAutoStart) {
      this.start();
    }
  }

  /**
   * Total number of uncommitted delta operations across all buffered maps.
   */
  public get pendingCount(): number {
    return (
      this.postViews.size +
      this.postLocationViews.size +
      this.pageViews.size +
      this.pageLocationViews.size +
      this.packageDownloads.size
    );
  }

  /**
   * Checks whether the given post has any uncommitted view counts or location stats in memory.
   */
  public hasPostPending(postId: number): boolean {
    if (this.postViews.has(postId)) return true;
    for (const item of this.postLocationViews.values()) {
      if (item.postId === postId) return true;
    }
    return false;
  }

  /**
   * Buffers a social post view and optional geographic breakdown.
   */
  public incrementPostView(postId: number, countryCode?: string, regionCode?: string): void {
    if (!Number.isFinite(postId) || postId <= 0) return;

    this.postViews.set(postId, (this.postViews.get(postId) ?? 0) + 1);

    const normCountry = countryCode ? countryCode.trim().toUpperCase() : "";
    if (/^[A-Z]{2}$/.test(normCountry)) {
      const normRegion =
        regionCode && /^[A-Za-z0-9]{1,6}$/.test(regionCode.trim()) ? regionCode.trim().toUpperCase() : null;
      const key = `${postId}:${normCountry}:${normRegion ?? ""}`;
      const existing = this.postLocationViews.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        this.postLocationViews.set(key, {
          postId,
          countryCode: normCountry,
          regionCode: normRegion,
          count: 1,
        });
      }
    }

    if (this.pendingCount >= this.maxBufferSize) {
      this.flushSync();
    }
  }

  /**
   * Buffers a unified first-party page view beacon.
   */
  public recordPageView(params: {
    surface: "web" | "docs";
    path: string;
    isUniqueVisitor?: boolean | undefined;
    countryCode?: string | undefined;
    regionCode?: string | undefined;
    date?: string | undefined;
  }): void {
    const viewDate =
      params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : new Date().toISOString().slice(0, 10);
    const surface: "web" | "docs" = params.surface === "docs" ? "docs" : "web";
    let cleanPath =
      String(params.path || "/")
        .split("?")[0]
        ?.split("#")[0]
        ?.trim() || "/";
    if (!cleanPath.startsWith("/")) {
      cleanPath = "/" + cleanPath;
    }
    while (cleanPath.length > 1 && cleanPath.endsWith("/")) {
      cleanPath = cleanPath.slice(0, -1);
    }
    if (cleanPath.length > 256) {
      cleanPath = cleanPath.slice(0, 256);
    }

    const uniqueInc = params.isUniqueVisitor ? 1 : 0;
    const pageKey = `${viewDate}:${surface}:${cleanPath}`;
    const existingPage = this.pageViews.get(pageKey);
    if (existingPage) {
      existingPage.views += 1;
      existingPage.uniques += uniqueInc;
    } else {
      this.pageViews.set(pageKey, {
        viewDate,
        surface,
        path: cleanPath,
        views: 1,
        uniques: uniqueInc,
      });
    }

    const normCountry = params.countryCode ? params.countryCode.trim().toUpperCase() : "";
    if (/^[A-Z]{2}$/.test(normCountry)) {
      const normRegion =
        params.regionCode && /^[A-Za-z0-9]{1,6}$/.test(params.regionCode.trim())
          ? params.regionCode.trim().toUpperCase()
          : "";
      const locKey = `${viewDate}:${surface}:${normCountry}:${normRegion}`;
      const existingLoc = this.pageLocationViews.get(locKey);
      if (existingLoc) {
        existingLoc.count += 1;
      } else {
        this.pageLocationViews.set(locKey, {
          viewDate,
          surface,
          countryCode: normCountry,
          regionCode: normRegion,
          count: 1,
        });
      }
    }

    if (this.pendingCount >= this.maxBufferSize) {
      this.flushSync();
    }
  }

  /**
   * Buffers a package tarball download event.
   */
  public recordPackageDownload(libraryName: string, libraryVersion: string, dateStr?: string): void {
    if (!libraryName || !libraryVersion) return;
    const date = dateStr ?? new Date().toISOString().slice(0, 10);
    const key = `${libraryName}:${libraryVersion}:${date}`;

    const existing = this.packageDownloads.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      this.packageDownloads.set(key, {
        libraryName,
        libraryVersion,
        downloadDate: date,
        count: 1,
      });
    }

    if (this.pendingCount >= this.maxBufferSize) {
      this.flushSync();
    }
  }

  /**
   * Synchronously flushes all coalesced in-memory analytics deltas to the database.
   * Performs an atomic swap of active maps with fresh empty maps to ensure concurrent
   * incoming requests are never blocked during the flush.
   */
  public flushSync(): void {
    if (this.pendingCount === 0 || this.isFlushing) return;

    this.isFlushing = true;
    const currentPostViews = this.postViews;
    const currentPostLocationViews = this.postLocationViews;
    const currentPageViews = this.pageViews;
    const currentPageLocationViews = this.pageLocationViews;
    const currentPackageDownloads = this.packageDownloads;

    this.postViews = new Map();
    this.postLocationViews = new Map();
    this.pageViews = new Map();
    this.pageLocationViews = new Map();
    this.packageDownloads = new Map();

    const batch: BatchAnalyticsPayload = {
      postViews: Array.from(currentPostViews.entries()),
      postLocationViews: Array.from(currentPostLocationViews.values()),
      pageViews: Array.from(currentPageViews.values()),
      pageLocationViews: Array.from(currentPageLocationViews.values()),
      packageDownloads: Array.from(currentPackageDownloads.values()),
    };

    try {
      this.target.flushAnalyticsBatch(batch);
    } catch (err) {
      console.error("[AnalyticsBuffer] Failed to flush batch to database. Merging back uncommitted deltas:", err);
      // Re-merge failed records back into active maps
      for (const [postId, delta] of batch.postViews) {
        this.postViews.set(postId, (this.postViews.get(postId) ?? 0) + delta);
      }
      for (const item of batch.postLocationViews) {
        const key = `${item.postId}:${item.countryCode}:${item.regionCode ?? ""}`;
        const existing = this.postLocationViews.get(key);
        if (existing) {
          existing.count += item.count;
        } else {
          this.postLocationViews.set(key, item);
        }
      }
      for (const item of batch.pageViews) {
        const key = `${item.viewDate}:${item.surface}:${item.path}`;
        const existing = this.pageViews.get(key);
        if (existing) {
          existing.views += item.views;
          existing.uniques += item.uniques;
        } else {
          this.pageViews.set(key, item);
        }
      }
      for (const item of batch.pageLocationViews) {
        const key = `${item.viewDate}:${item.surface}:${item.countryCode}:${item.regionCode}`;
        const existing = this.pageLocationViews.get(key);
        if (existing) {
          existing.count += item.count;
        } else {
          this.pageLocationViews.set(key, item);
        }
      }
      for (const item of batch.packageDownloads) {
        const key = `${item.libraryName}:${item.libraryVersion}:${item.downloadDate}`;
        const existing = this.packageDownloads.get(key);
        if (existing) {
          existing.count += item.count;
        } else {
          this.packageDownloads.set(key, item);
        }
      }
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Starts the periodic flush background timer.
   */
  public start(intervalMs?: number): void {
    if (this.timer) return;
    const interval = intervalMs ?? this.flushIntervalMs;
    if (interval <= 0) return;

    this.timer = setInterval(() => {
      try {
        this.flushSync();
      } catch (err) {
        console.error("[AnalyticsBuffer] Periodic tick flush error:", err);
      }
    }, interval);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stops the periodic timer and performs a final synchronous flush of all remaining data.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flushSync();
  }

  /**
   * Clears all in-memory buffers (useful for dev/test resets).
   */
  public clear(): void {
    this.postViews.clear();
    this.postLocationViews.clear();
    this.pageViews.clear();
    this.pageLocationViews.clear();
    this.packageDownloads.clear();
  }
}
