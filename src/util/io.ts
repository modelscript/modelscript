// SPDX-License-Identifier: AGPL-3.0-or-later

import pako from "pako";

export interface Writer {
  write(string: string): void;
}

export class StringWriter implements Writer {
  #string = "";

  write(string: string): void {
    this.#string += string;
  }

  toString(): string {
    return this.#string;
  }
}

export function decodeAndInflateBase64Url(base64url: string): string {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const buffer = Buffer.from(base64, "base64");
  return new TextDecoder().decode(pako.inflateRaw(buffer));
}

export function deflateAndEncodeBase64Url(text: string): string {
  const buffer = pako.deflateRaw(Buffer.from(text, "utf8"));
  const base64 = Buffer.from(buffer).toString("base64");
  return base64.replaceAll("+", "-").replaceAll("/", "_");
}
