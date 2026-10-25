// SPDX-License-Identifier: AGPL-3.0-or-later

export interface StorageObjectMetadata {
  size: number;
  contentHash: string; // sha256:...
  contentType?: string | undefined;
  lastModified?: Date | undefined;
}

export interface StorageDriver {
  readonly driverName: "filesystem" | "s3";

  /** Check if an object exists at the given key. */
  exists(key: string): Promise<boolean>;

  /** Read an object buffer by key. Returns null if not found. */
  read(key: string): Promise<Buffer | null>;

  /** Write an object buffer to the given key. */
  write(key: string, buffer: Buffer, metadata?: { contentType?: string }): Promise<void>;

  /** Delete an object by key. Returns true if removed, false if not found. */
  delete(key: string): Promise<boolean>;

  /** List object keys matching a prefix. */
  list(prefix?: string): Promise<string[]>;

  /** Delete all object keys starting with the given prefix. */
  deletePrefix(prefix: string): Promise<number>;

  /** Retrieve object metadata (size, contentHash, etc.) */
  getMetadata(key: string): Promise<StorageObjectMetadata | null>;
}
