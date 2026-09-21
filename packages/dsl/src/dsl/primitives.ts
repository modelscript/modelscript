/**
 * AssemblyScript type polyfills and primitive constants/types
 * for TypeScript IDE compatibility.
 */

export type u32 = number;
export type u16 = number;
export type u8 = number;
export type i32 = number;
export type i16 = number;
export type i8 = number;
export type f32 = number;
export type f64 = number;
export type i64 = bigint;
export type u64 = bigint;
export type bool = boolean;
export type FieldId = u16;
export type SyntaxId = u16;
export type TensorHandle = u32;

export const SOURCE_PATH_SYMBOL: unique symbol = Symbol.for("modelscript.sourcePath");
export const SOURCE_TEXT_SYMBOL: unique symbol = Symbol.for("modelscript.sourceText");

export enum TensorType {
  Float64 = 0,
  Int32 = 1,
  Boolean = 2,
  Float32 = 3,
  Float16 = 4,
  Int64 = 5,
  Int16 = 6,
}
