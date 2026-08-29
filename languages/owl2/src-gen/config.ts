import type { DiffConfig, GraphicsConfig, I18nConfig, IndexerHook, RefHook } from "@modelscript/language/compiler";

export const INDEXER_HOOKS: IndexerHook[] = [];

export const REF_HOOKS: RefHook[] = [];

export const graphicsConfig: Record<string, GraphicsConfig> = {};

export const diffConfig: Record<string, DiffConfig> = {};

export const i18nConfig: Record<string, I18nConfig> = {};
