// SPDX-License-Identifier: AGPL-3.0-or-later

import { ensureXmlParser, parseXml } from "./parser.js";
import { XmlStreamReader, type XmlStreamSource } from "./streaming.js";
import type { XmlDocument, XmlElement } from "./types.js";

export type XmlAttrType = "string" | "number" | "boolean";

export interface XmlAttrSpec<T = unknown> {
  type: XmlAttrType;
  required?: boolean;
  default?: T;
  validate?: (val: T) => boolean | string;
}

export interface XmlChildSpec {
  cardinality: "one" | "optional" | "repeat" | "dictionary";
  targetElement: string;
  tag?: string | string[];
  container?: string | string[];
  path?: string;
  keySelector?: (el: XmlElement) => string;
  valueSelector?: (el: XmlElement) => unknown;
  match?: (el: XmlElement) => boolean;
}

export interface XmlElementSpec {
  tags: string[];
  attributes: Record<string, XmlAttrSpec>;
  children: Record<string, XmlChildSpec>;
}

export interface XmlLanguageSpec {
  name: string;
  fileExtensions: string[];
  root: string;
  elements: Record<string, XmlElementSpec>;
}

export const xmlAttr = {
  string(options?: { required?: boolean; default?: string }): XmlAttrSpec<string> {
    return { type: "string", ...options };
  },
  number(options?: { required?: boolean; default?: number }): XmlAttrSpec<number> {
    return { type: "number", ...options };
  },
  boolean(options?: { required?: boolean; default?: boolean }): XmlAttrSpec<boolean> {
    return { type: "boolean", ...options };
  },
};

export const xmlChild = {
  one(targetElement: string, options?: Omit<XmlChildSpec, "cardinality" | "targetElement">): XmlChildSpec {
    return { cardinality: "one", targetElement, ...options };
  },
  optional(targetElement: string, options?: Omit<XmlChildSpec, "cardinality" | "targetElement">): XmlChildSpec {
    return { cardinality: "optional", targetElement, ...options };
  },
  repeat(targetElement: string, options?: Omit<XmlChildSpec, "cardinality" | "targetElement">): XmlChildSpec {
    return { cardinality: "repeat", targetElement, ...options };
  },
  dictionary(
    targetElement: string,
    options: {
      key: (el: XmlElement) => string;
      value: (el: XmlElement) => unknown;
      tag?: string | string[];
    },
  ): XmlChildSpec {
    const spec: XmlChildSpec = {
      cardinality: "dictionary",
      targetElement,
      keySelector: options.key,
      valueSelector: options.value,
    };
    if (options.tag !== undefined) {
      spec.tag = options.tag;
    }
    return spec;
  },
};

export function xmlElement(
  tags: string | string[],
  spec: {
    attributes?: Record<string, XmlAttrSpec>;
    children?: Record<string, XmlChildSpec>;
  },
): XmlElementSpec {
  return {
    tags: Array.isArray(tags) ? tags : [tags],
    attributes: spec.attributes ?? {},
    children: spec.children ?? {},
  };
}

export interface XmlSchemaDiagnostic {
  code: string;
  message: string;
  severity: "error" | "warning";
  startOffset: number;
  endOffset: number;
}

/**
 * Compiled XML schema model providing validation, typed AST instantiation, and streaming.
 */
export class XmlLanguageModel {
  readonly spec: XmlLanguageSpec;

  constructor(spec: XmlLanguageSpec) {
    this.spec = spec;
  }

  get name(): string {
    return this.spec.name;
  }

  get fileExtensions(): string[] {
    return this.spec.fileExtensions;
  }

  /**
   * Validates an XML document or source string against the schema, returning compiler diagnostics.
   */
  validate(input: string | XmlDocument): XmlSchemaDiagnostic[] {
    const doc = typeof input === "string" ? parseXml(input) : input;
    const diagnostics: XmlSchemaDiagnostic[] = [];

    for (const err of doc.errors) {
      diagnostics.push({
        code: "XML1001",
        message: "XML syntax error: malformed tag structure",
        severity: "error",
        startOffset: err.start,
        endOffset: err.end,
      });
    }

    if (!doc.root) return diagnostics;

    const rootSpec = this.spec.elements[this.spec.root];
    if (rootSpec && !rootSpec.tags.map((t) => t.toLowerCase()).includes(doc.root.name.toLowerCase())) {
      diagnostics.push({
        code: "XML2001",
        message: `Expected root element to be one of <${rootSpec.tags.join(", ")}>, got <${doc.root.name}>`,
        severity: "error",
        startOffset: doc.root.start,
        endOffset: doc.root.end,
      });
    }

    return diagnostics;
  }

  /**
   * Instantiates a typed AST from an XML document or source string.
   */
  instantiate(input: string | XmlDocument): Record<string, unknown> {
    ensureXmlParser();
    const doc = typeof input === "string" ? parseXml(input) : input;
    if (!doc.root) {
      throw new Error(`XML document has no root element for language ${this.name}`);
    }

    return this.instantiateElement(doc.root, this.spec.root);
  }

  private instantiateElement(el: XmlElement, elementName: string): Record<string, unknown> {
    const spec = this.spec.elements[elementName];
    const result: Record<string, unknown> = {
      $type: elementName,
      $name: el.name,
      $start: el.start,
      $end: el.end,
      $element: el,
    };

    if (!spec) return result;

    // Attributes
    for (const [attrName, attrSpec] of Object.entries(spec.attributes)) {
      const lower = attrName.toLowerCase();
      const raw = el.attributes.find((a) => a.name.toLowerCase() === lower)?.value;
      if (raw !== undefined) {
        if (attrSpec.type === "number") {
          result[attrName] = parseFloat(raw);
        } else if (attrSpec.type === "boolean") {
          result[attrName] = raw === "true" || raw === "1";
        } else {
          result[attrName] = raw;
        }
      } else if (attrSpec.default !== undefined) {
        result[attrName] = attrSpec.default;
      }
    }

    // Children
    for (const [childName, childSpec] of Object.entries(spec.children)) {
      const allowedTags = childSpec.tag
        ? (Array.isArray(childSpec.tag) ? childSpec.tag : [childSpec.tag]).map((t) => t.toLowerCase())
        : [childSpec.targetElement.toLowerCase()];

      let candidateChildren = el.children;
      if (childSpec.container) {
        const containers = (Array.isArray(childSpec.container) ? childSpec.container : [childSpec.container]).map((c) =>
          c.toLowerCase(),
        );
        const containerEls = el.children.filter((c) => containers.includes(c.name.toLowerCase()));
        candidateChildren = containerEls.flatMap((c) => c.children);
      } else if (childSpec.path) {
        const segments = childSpec.path.split(".");
        let curr = [el];
        for (let i = 0; i < segments.length - 1; i++) {
          const seg = segments[i]!.toLowerCase();
          curr = curr.flatMap((c) => c.children.filter((ch) => ch.name.toLowerCase() === seg));
        }
        candidateChildren = curr.flatMap((c) => c.children);
      }

      const matchedChildren = candidateChildren.filter((c) => {
        const tagMatches = allowedTags.includes(c.name.toLowerCase());
        return tagMatches && (!childSpec.match || childSpec.match(c));
      });

      if (childSpec.cardinality === "repeat") {
        result[childName] = matchedChildren.map((c) => this.instantiateElement(c, childSpec.targetElement));
      } else if (childSpec.cardinality === "optional") {
        result[childName] =
          matchedChildren.length > 0
            ? this.instantiateElement(matchedChildren[0]!, childSpec.targetElement)
            : undefined;
      } else if (childSpec.cardinality === "one") {
        result[childName] =
          matchedChildren.length > 0
            ? this.instantiateElement(matchedChildren[0]!, childSpec.targetElement)
            : undefined;
      } else if (childSpec.cardinality === "dictionary") {
        const dict: Record<string, unknown> = {};
        for (const c of matchedChildren) {
          if (childSpec.keySelector && childSpec.valueSelector) {
            dict[childSpec.keySelector(c)] = childSpec.valueSelector(c);
          }
        }
        result[childName] = dict;
      }
    }

    return result;
  }

  /**
   * Streams typed schema elements on the fly without holding the entire document in memory.
   */
  async *stream<T = Record<string, unknown>>(source: XmlStreamSource, targetElementName: string): AsyncIterable<T> {
    const spec = this.spec.elements[targetElementName];
    const tags = spec ? spec.tags : [targetElementName];
    const reader = new XmlStreamReader(source);

    for await (const el of reader.iterateElements(tags)) {
      yield this.instantiateElement(el, targetElementName) as T;
    }
  }
}

export function xmlLanguage(spec: XmlLanguageSpec): XmlLanguageModel {
  return new XmlLanguageModel(spec);
}
