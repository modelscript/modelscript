// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SeedCommentReply {
  author?: string | undefined;
  authorUsername?: string | undefined;
  createdHoursAgo?: number | undefined;
  content: string;
  likedBy?: string[] | undefined;
}

export interface SeedComment {
  author?: string | undefined;
  authorUsername?: string | undefined;
  createdHoursAgo?: number | undefined;
  content: string;
  likedBy?: string[] | undefined;
  replies?: SeedCommentReply[] | undefined;
}

export interface SeedPostSpec {
  /** Optional deterministic identifier */
  id?: string | undefined;
  /** Canonical language directory name under `languages/` (1 of 44) */
  language?: string | undefined;
  /** Alias for language directory name under `languages/` */
  languageId?: string | undefined;
  /** Author username from SEED_PERSONAS */
  author?: string | undefined;
  /** Alias for author username from SEED_PERSONAS */
  authorUsername?: string | undefined;
  /** Artifact title (used for idempotency and viewer header) */
  title: string;
  /** Original filename with canonical extension for preprocessor dispatch */
  filename: string;
  /** Artifact view_type dispatched by ViewerDispatcher & pregenerateServerSvgThumbnail */
  viewType: string;
  /** Rich technical social post body with domain context & hashtags */
  postContent: string;
  /** Full authentic engineering source code / deck content */
  code: string;
  /** Additional viewer config properties merged with preprocessor output */
  extraViewConfig?: Record<string, unknown> | undefined;
  /** Peer engineering comments and nested replies */
  comments: SeedComment[];
  /** Usernames of personas who liked this post */
  likedBy: string[];
  /** Usernames of personas who reposted this post */
  repostedBy?: string[] | undefined;
  /** Usernames of personas who bookmarked this post */
  bookmarkedBy?: string[] | undefined;
  /** Relative offset in hours before now for realistic timeline ordering */
  hoursAgo?: number | undefined;
  /** Alias for hoursAgo */
  createdHoursAgo?: number | undefined;
}
