// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unified Configuration System Types & Schema Builders.
 */

export interface EnumOption<T extends string = string> {
  type: "enum";
  choices: T[];
  default: T;
  description?: string | undefined;
}

export interface IntOption {
  type: "int";
  default: number;
  min?: number | undefined;
  max?: number | undefined;
  description?: string | undefined;
}

export interface FloatOption {
  type: "float";
  default: number;
  min?: number | undefined;
  max?: number | undefined;
  description?: string | undefined;
}

export interface BoolOption {
  type: "bool";
  default: boolean;
  description?: string | undefined;
}

export type ConfigOption = EnumOption<any> | IntOption | FloatOption | BoolOption;
export type ConfigSchemaCategory = Record<string, ConfigOption>;
export type ConfigSchema = Record<string, ConfigSchemaCategory>;

export function enumOption<T extends string>(opts: {
  choices: T[];
  default: T;
  description?: string | undefined;
}): EnumOption<T> {
  return { type: "enum", ...opts };
}

export function intOption(opts: {
  default: number;
  min?: number | undefined;
  max?: number | undefined;
  description?: string | undefined;
}): IntOption {
  return { type: "int", ...opts };
}

export function floatOption(opts: {
  default: number;
  min?: number | undefined;
  max?: number | undefined;
  description?: string | undefined;
}): FloatOption {
  return { type: "float", ...opts };
}

export function boolOption(opts: { default: boolean; description?: string | undefined }): BoolOption {
  return { type: "bool", ...opts };
}

export function defineConfigSchema<S extends ConfigSchema>(schema: S): S {
  return schema;
}

export type InferConfigValue<O extends ConfigOption> =
  O extends EnumOption<infer T>
    ? T
    : O extends IntOption
      ? number
      : O extends FloatOption
        ? number
        : O extends BoolOption
          ? boolean
          : never;

export type InferConfigCategory<C extends ConfigSchemaCategory> = {
  [K in keyof C]: InferConfigValue<C[K]>;
};

export type InferConfigSchema<S extends ConfigSchema> = {
  [K in keyof S]: InferConfigCategory<S[K]>;
};
