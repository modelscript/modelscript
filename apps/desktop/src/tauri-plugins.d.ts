// SPDX-License-Identifier: AGPL-3.0-or-later

declare module "@tauri-apps/plugin-fs" {
  export function readTextFile(path: string): Promise<string>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function writeTextFile(path: string, content: string): Promise<void>;
  export function writeFile(path: string, content: Uint8Array): Promise<void>;
}

declare module "@tauri-apps/plugin-dialog" {
  export interface OpenOptions {
    multiple?: boolean | undefined;
    directory?: boolean | undefined;
    filters?: { name: string; extensions: string[] }[] | undefined;
  }
  export interface SaveOptions {
    defaultPath?: string | undefined;
    filters?: { name: string; extensions: string[] }[] | undefined;
  }
  export function open(options?: OpenOptions): Promise<string | string[] | null>;
  export function save(options?: SaveOptions): Promise<string | null>;
}

declare module "@tauri-apps/plugin-os" {
  export function platform(): Promise<string>;
  export function arch(): Promise<string>;
}
