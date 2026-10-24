// SPDX-License-Identifier: AGPL-3.0-or-later

import { decodeEntities } from "./parser.js";
import type { XmlAttribute, XmlElement } from "./types.js";

export type XmlStreamEventKind = "startElement" | "endElement" | "text" | "cdata" | "comment";

export interface XmlStreamEvent {
  kind: XmlStreamEventKind;
  name?: string;
  attributes?: XmlAttribute[];
  text?: string;
  selfClosing?: boolean;
  start: number;
  end: number;
}

export type XmlStreamSource =
  | string
  | AsyncIterable<string | Uint8Array>
  | Iterable<string | Uint8Array>
  | ReadableStream<Uint8Array>;

/**
 * Fast, memory-bounded streaming pull-parser for multi-gigabyte XML documents.
 * Operates in O(tree depth) memory rather than O(document size).
 */
export class XmlStreamReader {
  private buffer = "";
  private globalOffset = 0;
  private iterator: AsyncIterator<string | Uint8Array> | null = null;
  private isDoneReading = false;

  constructor(source: XmlStreamSource) {
    if (typeof source === "string") {
      this.buffer = source;
      this.isDoneReading = true;
    } else if (typeof (source as any)[Symbol.asyncIterator] === "function") {
      this.iterator = (source as AsyncIterable<string | Uint8Array>)[Symbol.asyncIterator]();
    } else if (typeof (source as any)[Symbol.iterator] === "function") {
      const syncIter = (source as Iterable<string | Uint8Array>)[Symbol.iterator]();
      this.iterator = {
        async next() {
          return syncIter.next();
        },
      };
    } else if (typeof (source as any).getReader === "function") {
      const reader = (source as ReadableStream<Uint8Array>).getReader();
      this.iterator = {
        async next(): Promise<IteratorResult<string | Uint8Array>> {
          const res = await reader.read();
          if (res.done) {
            return { done: true, value: undefined };
          }
          return { done: false, value: res.value };
        },
      };
    }
  }

  private async fillBuffer(minChars = 1024): Promise<boolean> {
    if (this.isDoneReading || !this.iterator) return false;
    while (this.buffer.length < minChars) {
      const { done, value } = await this.iterator.next();
      if (done || value === undefined) {
        this.isDoneReading = true;
        break;
      }
      const chunkStr = typeof value === "string" ? value : new TextDecoder().decode(value, { stream: true });
      this.buffer += chunkStr;
      if (this.buffer.length >= minChars) break;
    }
    return this.buffer.length > 0;
  }

  private advance(count: number): void {
    this.buffer = this.buffer.slice(count);
    this.globalOffset += count;
  }

  /**
   * Pulls the next XML token/event from the stream.
   */
  async nextEvent(): Promise<XmlStreamEvent | null> {
    while (true) {
      if (this.buffer.length < 512 && !this.isDoneReading) {
        await this.fillBuffer(4096);
      }
      if (this.buffer.length === 0) return null;

      // Skip leading whitespace between tags
      const wsMatch = /^\s+/.exec(this.buffer);
      if (wsMatch) {
        this.advance(wsMatch[0].length);
        continue;
      }

      if (this.buffer.startsWith("<!--")) {
        // Comment
        const endIdx = this.buffer.indexOf("-->");
        if (endIdx === -1) {
          if (!this.isDoneReading) {
            await this.fillBuffer(this.buffer.length + 4096);
            continue;
          }
          const fullComment = this.buffer;
          const start = this.globalOffset;
          this.advance(fullComment.length);
          return { kind: "comment", text: fullComment, start, end: this.globalOffset };
        }
        const commentText = this.buffer.slice(4, endIdx);
        const start = this.globalOffset;
        this.advance(endIdx + 3);
        return { kind: "comment", text: commentText, start, end: this.globalOffset };
      }

      if (this.buffer.startsWith("<![CDATA[")) {
        // CDATA
        const endIdx = this.buffer.indexOf("]]>");
        if (endIdx === -1) {
          if (!this.isDoneReading) {
            await this.fillBuffer(this.buffer.length + 4096);
            continue;
          }
          const cdataText = this.buffer.slice(9);
          const start = this.globalOffset;
          this.advance(this.buffer.length);
          return { kind: "cdata", text: cdataText, start, end: this.globalOffset };
        }
        const cdataText = this.buffer.slice(9, endIdx);
        const start = this.globalOffset;
        this.advance(endIdx + 3);
        return { kind: "cdata", text: cdataText, start, end: this.globalOffset };
      }

      if (this.buffer.startsWith("<?")) {
        // Processing instruction
        const endIdx = this.buffer.indexOf("?>");
        if (endIdx === -1) {
          if (!this.isDoneReading) {
            await this.fillBuffer(this.buffer.length + 4096);
            continue;
          }
          this.advance(this.buffer.length);
          continue;
        }
        this.advance(endIdx + 2);
        continue;
      }

      if (this.buffer.startsWith("</")) {
        // Closing tag
        const closeMatch = /^<\/([A-Za-z_:][A-Za-z0-9_.:-]*)[ \t\r\n]*>/.exec(this.buffer);
        if (!closeMatch) {
          if (!this.isDoneReading) {
            await this.fillBuffer(this.buffer.length + 512);
            continue;
          }
          this.advance(1);
          continue;
        }
        const tagName = closeMatch[1]!;
        const start = this.globalOffset;
        this.advance(closeMatch[0].length);
        return { kind: "endElement", name: tagName, start, end: this.globalOffset };
      }

      if (this.buffer.startsWith("<")) {
        // Opening tag or empty tag
        const endTagIdx = this.buffer.indexOf(">");
        if (endTagIdx === -1) {
          if (!this.isDoneReading) {
            await this.fillBuffer(this.buffer.length + 4096);
            continue;
          }
          this.advance(1);
          continue;
        }

        const tagContent = this.buffer.slice(0, endTagIdx + 1);
        const selfClosing = tagContent.endsWith("/>");
        const nameMatch = /^<([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(tagContent);
        if (!nameMatch) {
          this.advance(endTagIdx + 1);
          continue;
        }

        const tagName = nameMatch[1]!;
        const start = this.globalOffset;
        const attributes: XmlAttribute[] = [];
        const attrRe = /([A-Za-z_:][A-Za-z0-9_.:-]*)[ \t\r\n]*=[ \t\r\n]*("([^"]*)"|'([^']*)')/g;
        attrRe.lastIndex = nameMatch[0].length;
        let m: RegExpExecArray | null;
        while ((m = attrRe.exec(tagContent))) {
          const raw = m[3] ?? m[4] ?? "";
          const attrStart = start + m.index;
          const valStart = attrStart + m[0].length - raw.length - 1;
          attributes.push({
            name: m[1]!,
            value: decodeEntities(raw),
            start: attrStart,
            end: attrStart + m[0].length,
            valueStart: valStart,
            valueEnd: valStart + raw.length,
            quote: m[2]![0]!,
          });
        }

        this.advance(endTagIdx + 1);
        return {
          kind: "startElement",
          name: tagName,
          attributes,
          selfClosing,
          start,
          end: this.globalOffset,
        };
      }

      // Plain character data until next '<'
      const nextAngle = this.buffer.indexOf("<");
      if (nextAngle === -1) {
        if (!this.isDoneReading) {
          await this.fillBuffer(this.buffer.length + 4096);
          continue;
        }
        const text = decodeEntities(this.buffer.trim());
        const start = this.globalOffset;
        this.advance(this.buffer.length);
        if (text) return { kind: "text", text, start, end: this.globalOffset };
        return null;
      }

      const textChunk = this.buffer.slice(0, nextAngle);
      const start = this.globalOffset;
      this.advance(nextAngle);
      const text = decodeEntities(textChunk.trim());
      if (text) {
        return { kind: "text", text, start, end: this.globalOffset };
      }
    }
  }

  /**
   * Asynchronously streams top-level or matching subtrees matching targetTag.
   * Materializes each subtree as an XmlElement and discards it after the consumer yields,
   * keeping peak memory consumption constant O(depth).
   */
  async *iterateElements(targetTag: string | string[]): AsyncIterable<XmlElement> {
    const targets = Array.isArray(targetTag) ? targetTag.map((t) => t.toLowerCase()) : [targetTag.toLowerCase()];
    const stack: XmlElement[] = [];

    while (true) {
      const event = await this.nextEvent();
      if (!event) break;

      if (event.kind === "startElement") {
        const isMatch = targets.includes(event.name!.toLowerCase());

        if (stack.length === 0 && !isMatch) {
          // If not currently inside a matched subtree and this doesn't start one, ignore
          continue;
        }

        const el: XmlElement = {
          name: event.name!,
          start: event.start,
          end: event.end,
          openEnd: event.end,
          closeStart: event.end,
          selfClosing: Boolean(event.selfClosing),
          attributes: event.attributes ?? [],
          children: [],
          cdata: [],
          text: "",
          parent: stack.length > 0 ? stack[stack.length - 1]! : null,
        };

        if (stack.length > 0) {
          stack[stack.length - 1]!.children.push(el);
        }

        if (event.selfClosing) {
          if (stack.length === 0) {
            yield el;
          }
        } else {
          stack.push(el);
        }
      } else if (event.kind === "endElement") {
        if (stack.length === 0) continue;

        const current = stack.pop()!;
        current.end = event.end;
        current.closeStart = event.start;

        if (stack.length === 0) {
          // Reached root of matched subtree! Yield to caller.
          yield current;
        }
      } else if (event.kind === "text") {
        if (stack.length > 0) {
          stack[stack.length - 1]!.text += event.text ?? "";
        }
      } else if (event.kind === "cdata") {
        if (stack.length > 0) {
          stack[stack.length - 1]!.cdata.push({
            start: event.start,
            end: event.end,
            text: event.text ?? "",
          });
        }
      }
    }
  }
}
