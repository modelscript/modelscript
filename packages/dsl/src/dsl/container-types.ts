/**
 * Container & Archive Extraction DSL (Zero-Copy & Generic Toolkit).
 */

/** Metadata for an individual entry inside a container archive */
export interface ContainerEntryMeta {
  name: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
  compressionMethod: number;
  offset?: number;
}

/** Toolkit supplied to custom container extractors */
export interface ContainerToolkit {
  /** Fast in-memory zero-copy ZIP parser */
  zip: {
    entries(data: Uint8Array): ContainerEntryMeta[];
    read(data: Uint8Array, entryPath: string): Uint8Array | null;
    readText(data: Uint8Array, entryPath: string, encoding?: string): string | null;
  };
  /** DOM-free XML attribute and tag extractor */
  xml: {
    extractAttr(xml: string, tag: string, attr: string): string | null;
    extractAttrFromStr(attrStr: string, attrName: string): string | null;
    extractTags(xml: string, tag: string): { attrs: string; body: string }[];
    parse(xml: string): Record<string, any>;
  };
  /** Raw compression / decompression routines */
  inflate: (compressed: Uint8Array) => Uint8Array;
  deflate: (data: Uint8Array) => Uint8Array;
  /** Text encoding / decoding */
  text: {
    decode(bytes: Uint8Array, encoding?: string): string;
    encode(str: string): Uint8Array;
  };
  /** Path and glob pattern matching */
  glob: {
    match(path: string, pattern: string | RegExp): boolean;
  };
}

/** A member file entry exposed from an extracted container */
export interface ContainerFileEntry {
  /** Relative path inside the virtual container mount */
  path: string;
  /** Size in bytes if known */
  size?: number;
  /** Lazy reader returning the raw byte content */
  read: () => Uint8Array | null;
  /** Optional lazy reader returning text content */
  readText?: () => string | null;
  /** Handling action for the workspace index */
  action?: "parse_as_language" | "mount_vfs" | "binary_blob" | "extract_nested";
  /** Target language identifier if action is 'parse_as_language' */
  targetLanguage?: string;
}

/** Result returned by a container extractor lambda */
export interface ContainerExtractionResult {
  /** Primary manifest or virtual entry (e.g. SystemStructure.ssd, modelDescription.xml, package.mo) */
  manifest?: {
    path: string;
    content: string | Uint8Array;
    language?: string;
  };
  /** Member entries exposed to the virtual file system / workspace */
  entries?: ContainerFileEntry[];
  /** Optional metadata dictionary */
  metadata?: Record<string, any>;
  /** Optional projection callback to synthesize virtual target language source (e.g. Modelica block) */
  project?: (targetLanguage: string) => string | any | null;
}

/** Function signature for custom container extractor lambdas */
export type ContainerExtractor = (
  data: Uint8Array,
  toolkit: ContainerToolkit,
) => ContainerExtractionResult | null | Promise<ContainerExtractionResult | null>;

/** Configuration for declaring container format handling on a language */
export interface ContainerDeclaration<RuleName extends string = string> {
  /** Recognized container file extensions (e.g. [".ssp", ".fmu", ".molib", ".jar"]) */
  extensions: string[];
  /** Custom extraction lambda with supplied generic extraction toolkit */
  extract: ContainerExtractor;
  /** Optional declarative manifest specification for standard inspection */
  manifestPath?: string | RegExp;
  /** Optional default entry rule */
  entryRule?: RuleName;
}

export function containerDeclaration<RuleName extends string = string>(
  options: ContainerDeclaration<RuleName>,
): ContainerDeclaration<RuleName> {
  return options;
}
