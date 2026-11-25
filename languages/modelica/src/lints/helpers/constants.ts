// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/helpers/constants
 *
 * Primitive type tags, variability levels, member kinds, tool flags, and Modelica grammar symbol map.
 */

import type { u16, u32, u8 } from "@modelscript/dsl";

/** Sentinel type tag indicating an unresolved or unknown expression/variable type. */
export const TYPE_UNKNOWN: u16 = 0xffff;

/** Built-in primitive `Real` scalar type tag. */
export const TYPE_REAL: u16 = 0;

/** Built-in primitive `Integer` scalar type tag. */
export const TYPE_INTEGER: u16 = 1;

/** Built-in primitive `Boolean` scalar type tag. */
export const TYPE_BOOLEAN: u16 = 2;

/** Built-in primitive `String` scalar type tag. */
export const TYPE_STRING: u16 = 3;

/** Built-in `enumeration(...)` scalar type tag. */
export const TYPE_ENUM: u16 = 4;

/** Synchronous `Clock` type tag (MLS Chapter 16). */
export const TYPE_CLOCK: u16 = 5;

/** Continuous-time variability level (default for `Real` variables). */
export const VARIABILITY_CONTINUOUS: u8 = 0;

/** Discrete-time variability level (`discrete` prefix or clocked/when-assigned). */
export const VARIABILITY_DISCRETE: u8 = 1;

/** Parameter variability level (`parameter` prefix, constant during simulation). */
export const VARIABILITY_PARAMETER: u8 = 2;

/** Constant variability level (`constant` prefix or literal expression). */
export const VARIABILITY_CONSTANT: u8 = 3;

/** Member kind tag indicating that no matching member exists in the class hierarchy. */
export const MEMBER_NONE: u16 = 0;

/** Member kind tag indicating a `model`, `block`, or `connector` component declaration. */
export const MEMBER_COMPONENT: u16 = 1;

/** Member kind tag indicating an inner class or type definition. */
export const MEMBER_CLASS: u16 = 2;

/** Member kind tag indicating a primitive or `record` component declaration. */
export const MEMBER_RECORD_COMPONENT: u16 = 3;

/** Tool flag bit: OMC old frontend (`-d=-newInst`). */
export const TOOL_FLAG_OLD_FRONTEND: u32 = 1;

/** Tool flag bit: `--ignoreReplaceable`. */
export const TOOL_FLAG_IGNORE_REPLACEABLE: u32 = 2;

/** Tool flag bit: `+intEnumConversion`. */
export const TOOL_FLAG_INT_ENUM_CONVERSION: u32 = 4;

/** Per-lint-run memo discriminator for {@link getToolFlags}. */
export const TOOL_FLAGS_MEMO_KIND: u32 = 0x464c4147;

/**
 * Map of Modelica grammar rule names to their linear-memory node type IDs (`u16`).
 * Compatible with `ASTLintFunction`'s `$` parameter (`Record<string, u16>`).
 */
export interface ModelicaGrammarSymbols {
  algorithm_section?: u16 | undefined;
  annotation?: u16 | undefined;
  annotation_clause?: u16 | undefined;
  argument?: u16 | undefined;
  array_arguments?: u16 | undefined;
  array_arguments_non_first?: u16 | undefined;
  array_subscripts?: u16 | undefined;
  base_prefix?: u16 | undefined;
  call_expression?: u16 | undefined;
  class_definition?: u16 | undefined;
  class_modification?: u16 | undefined;
  class_or_inheritance_modification?: u16 | undefined;
  class_specifier?: u16 | undefined;
  component_clause?: u16 | undefined;
  component_clause1?: u16 | undefined;
  component_declaration?: u16 | undefined;
  component_declaration1?: u16 | undefined;
  component_reference?: u16 | undefined;
  composition?: u16 | undefined;
  condition_attribute?: u16 | undefined;
  connect_equation?: u16 | undefined;
  declaration?: u16 | undefined;
  description?: u16 | undefined;
  description_string?: u16 | undefined;
  element?: u16 | undefined;
  element_modification?: u16 | undefined;
  element_modification_or_replaceable?: u16 | undefined;
  element_redeclaration?: u16 | undefined;
  element_replaceable?: u16 | undefined;
  enumeration_literal?: u16 | undefined;
  enum_list?: u16 | undefined;
  equation?: u16 | undefined;
  equation_or_procedure?: u16 | undefined;
  equation_section?: u16 | undefined;
  expression?: u16 | undefined;
  expression_list?: u16 | undefined;
  extends_clause?: u16 | undefined;
  external_clause?: u16 | undefined;
  for_equation?: u16 | undefined;
  for_index?: u16 | undefined;
  for_indices?: u16 | undefined;
  for_statement?: u16 | undefined;
  function_argument?: u16 | undefined;
  function_arguments?: u16 | undefined;
  function_call?: u16 | undefined;
  function_call_args?: u16 | undefined;
  identifier?: u16 | undefined;
  if_equation?: u16 | undefined;
  if_statement?: u16 | undefined;
  import_clause?: u16 | undefined;
  inheritance_modification?: u16 | undefined;
  lhs_expression?: u16 | undefined;
  lhs_primary?: u16 | undefined;
  long_class_specifier?: u16 | undefined;
  modification?: u16 | undefined;
  modification_expression?: u16 | undefined;
  name?: u16 | undefined;
  named_argument?: u16 | undefined;
  number?: u16 | undefined;
  output_expression_list?: u16 | undefined;
  primary?: u16 | undefined;
  protected?: u16 | undefined;
  root?: u16 | undefined;
  short_class_definition?: u16 | undefined;
  short_class_specifier?: u16 | undefined;
  simple_equation?: u16 | undefined;
  some_equation?: u16 | undefined;
  statement?: u16 | undefined;
  stored_definition?: u16 | undefined;
  string_literal?: u16 | undefined;
  subscript?: u16 | undefined;
  type_prefix?: u16 | undefined;
  type_specifier?: u16 | undefined;
  unsigned_integer?: u16 | undefined;
  unsigned_number?: u16 | undefined;
  unsigned_real?: u16 | undefined;
  when_equation?: u16 | undefined;
  when_statement?: u16 | undefined;
  while_statement?: u16 | undefined;
  [key: string]: u16 | undefined;
}
