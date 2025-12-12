// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";

export interface FileSystem {
  basename(path: string): string;

  extname(path: string): string;

  join(...paths: string[]): string;

  read(path: string): string;

  readdir(path: string): Dirent[];

  resolve(...paths: string[]): string;

  get sep(): string;

  stat(path: string): Stats | null;
}

export interface Dirent {
  isFile(): boolean;
  isDirectory(): boolean;
  name: string;
  parentPath: string;
}

export interface Stats {
  atime: Date;
  ctime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
  mtime: Date;
  size: number;
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
    return readFileSync(path, { encoding: "utf8" });
  }

  readdir(path: string): Dirent[] {
    return readdirSync(path, { withFileTypes: true });
  }

  resolve(...paths: string[]): string {
    return resolve(...paths);
  }

  get sep(): string {
    return sep;
  }

  stat(path: string): Stats | null {
    return statSync(path, { throwIfNoEntry: false }) ?? null;
  }
}
