// SPDX-License-Identifier: AGPL-3.0-or-later

export interface FileSystem {
  basename(path: string): string;

  extname(path: string): string;

  join(...paths: string[]): string;

  read(path: string): string;

  readBinary(path: string): Uint8Array;

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
