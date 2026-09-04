// SPDX-License-Identifier: AGPL-3.0-or-later

import fs, { type Dirent, type Stats } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";

export type { Dirent, Stats };

export interface FileSystem {
  basename(path: string): string;
  extname(path: string): string;
  join(...paths: string[]): string;
  read(path: string): string;
  readBinary?(path: string): Uint8Array;
  readdir(path: string): Dirent[];
  resolve(...paths: string[]): string;
  sep: string;
  stat(path: string): Stats | null;
}

export class NodeFileSystem implements FileSystem {
  basename(path: string): string {
    return basename(path);
  }

  extname(path: string): string {
    return extname(path);
  }

  join(...paths: string[]): string {
    return join(...paths);
  }

  read(path: string): string {
    return fs.readFileSync(path, "utf8");
  }

  readBinary(path: string): Uint8Array {
    return fs.readFileSync(path);
  }

  readdir(path: string): Dirent[] {
    return fs.readdirSync(path, { withFileTypes: true });
  }

  resolve(...paths: string[]): string {
    return resolve(...paths);
  }

  get sep(): string {
    return sep;
  }

  stat(path: string): Stats | null {
    return fs.statSync(path, { throwIfNoEntry: false }) ?? null;
  }
}
