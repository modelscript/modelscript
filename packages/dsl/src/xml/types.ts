// SPDX-License-Identifier: AGPL-3.0-or-later

export interface XmlAttribute {
  name: string;
  /** Decoded value (no quotes, entities decoded). */
  value: string;
  /** Range of the whole `name="value"` text. */
  start: number;
  end: number;
  /** Range of the value text between the quotes. */
  valueStart: number;
  valueEnd: number;
  quote: string;
}

export interface XmlElement {
  name: string;
  /** Whole element, from `<` to the end of the closing tag. */
  start: number;
  end: number;
  /** End offset of the open tag (after `>` or `/>`). */
  openEnd: number;
  /** Start of the closing tag; equals `end` for self-closing elements. */
  closeStart: number;
  selfClosing: boolean;
  attributes: XmlAttribute[];
  children: XmlElement[];
  /** Raw CDATA payloads (without the CDATA delimiters), in document order. */
  cdata: { start: number; end: number; text: string }[];
  /** Decoded plain character data (trimmed), concatenated. */
  text: string;
  parent: XmlElement | null;
}

export interface XmlDocument {
  source: string;
  root: XmlElement | null;
  /** Syntax-error ranges; empty when the document is well formed. */
  errors: { start: number; end: number }[];
}

export interface Splice {
  start: number;
  end: number;
  text: string;
}
