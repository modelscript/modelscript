// SPDX-License-Identifier: AGPL-3.0-or-later

import { parse } from "media-typer";
import pako from "pako";
import { type DataUrl } from "parse-data-url";
import { toEnum } from "./enum.js";

export enum ContentType {
  MODELICA = "text/x-modelica",
}

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

export function decodeDataUrl(dataUrl: DataUrl | null): [string, ContentType | null] {
  if (!dataUrl) return ["", null];
  const mediaType = parse(dataUrl.contentType);
  const contentType = toEnum(ContentType, mediaType.type + "/" + mediaType.subtype);
  if (dataUrl.base64 || mediaType.suffix === "zip") {
    const buffer = Buffer.from(dataUrl.data, "base64");
    if (mediaType.suffix === "zip") {
      return [new TextDecoder(dataUrl.charset).decode(pako.inflateRaw(buffer)), contentType];
    } else {
      return [new TextDecoder(dataUrl.charset).decode(buffer), contentType];
    }
  } else {
    return [dataUrl.data, contentType];
  }
}

export function encodeDataUrl(content: string, contentType: ContentType): string {
  const data = Buffer.from(pako.deflateRaw(Buffer.from(content, "utf8"))).toString("base64");
  return `data:${contentType}+zip;base64,${data}`;
}
