import { ConfigOption, ConfigSchema } from "../dsl.js";

export type ConfigCompilationMode = "compileTimeLocked" | "dynamicRuntime";

export interface ConfigLayoutEntry {
  key: string;
  category: string;
  name: string;
  type: ConfigOption["type"];
  offset: number;
  size: number;
  defaultValue: any;
  choices?: string[];
  min?: number;
  max?: number;
}

export interface ConfigLayoutResult {
  entries: Map<string, ConfigLayoutEntry>;
  totalSize: number;
  assemblyScriptCode: string;
}

/**
 * Computes memory offsets and generates AssemblyScript code for runtime/compile-time configuration access.
 */
export function generateConfigDomain(
  schema: ConfigSchema,
  mode: ConfigCompilationMode = "dynamicRuntime",
  userValues: Record<string, any> = {},
): ConfigLayoutResult {
  const entries = new Map<string, ConfigLayoutEntry>();

  // 1. Gather all options from schema
  const rawList: { key: string; category: string; name: string; opt: ConfigOption }[] = [];
  for (const catName of Object.keys(schema)) {
    const cat = schema[catName];
    for (const optName of Object.keys(cat)) {
      rawList.push({
        key: `${catName}.${optName}`,
        category: catName,
        name: optName,
        opt: cat[optName],
      });
    }
  }

  // 2. Sort by alignment requirement: 8-byte (floats), 4-byte (ints), 1-byte (enums, bools)
  rawList.sort((a, b) => {
    const getSize = (type: string) => (type === "float" ? 8 : type === "int" ? 4 : 1);
    return getSize(b.opt.type) - getSize(a.opt.type);
  });

  // 3. Assign packed byte offsets
  let currentOffset = 0;
  for (const item of rawList) {
    const opt = item.opt;
    let size = 1;
    let choices: string[] | undefined;

    if (opt.type === "float") {
      size = 8;
      // Align to 8 bytes
      currentOffset = Math.ceil(currentOffset / 8) * 8;
    } else if (opt.type === "int") {
      size = 4;
      // Align to 4 bytes
      currentOffset = Math.ceil(currentOffset / 4) * 4;
    } else if (opt.type === "enum") {
      size = 1;
      choices = opt.choices;
    } else if (opt.type === "bool") {
      size = 1;
    }

    const valueOverride = userValues[item.key] !== undefined ? userValues[item.key] : opt.default;

    entries.set(item.key, {
      key: item.key,
      category: item.category,
      name: item.name,
      type: opt.type,
      offset: currentOffset,
      size,
      defaultValue: valueOverride,
      choices,
      min: (opt as any).min,
      max: (opt as any).max,
    });

    currentOffset += size;
  }

  const totalSize = Math.ceil(currentOffset / 8) * 8; // Align total size to 8-byte boundary

  // 4. Generate AssemblyScript code
  let code = `// Auto-generated Configuration Engine (${mode})\n`;
  code += `import { atomicChunkAlloc } from "./arena";\n\n`;
  code += `export const CONFIG_TOTAL_SIZE: u32 = ${totalSize};\n`;
  code += `export let globalConfigPtr: u32 = 0;\n\n`;

  // Write offset constants
  for (const [key, entry] of entries) {
    const safeConstName = `OFFSET_${entry.category.toUpperCase()}_${entry.name.toUpperCase()}`;
    code += `export const ${safeConstName}: u32 = ${entry.offset};\n`;
  }
  code += `\n`;

  // Initialization routine
  code += `@inline\nexport function config_init(): u32 {\n`;
  code += `  if (globalConfigPtr == 0) {\n`;
  code += `    globalConfigPtr = atomicChunkAlloc(CONFIG_TOTAL_SIZE);\n`;
  code += `    config_resetDefaults(globalConfigPtr);\n`;
  code += `  }\n`;
  code += `  return globalConfigPtr;\n`;
  code += `}\n\n`;

  code += `@inline\nexport function config_resetDefaults(ptr: u32): void {\n`;
  for (const [key, entry] of entries) {
    if (entry.type === "float") {
      code += `  store<f64>(ptr + ${entry.offset}, ${Number(entry.defaultValue).toFixed(8)});\n`;
    } else if (entry.type === "int") {
      code += `  store<i32>(ptr + ${entry.offset}, ${entry.defaultValue});\n`;
    } else if (entry.type === "bool") {
      code += `  store<u8>(ptr + ${entry.offset}, ${entry.defaultValue ? 1 : 0});\n`;
    } else if (entry.type === "enum") {
      const idx = entry.choices ? Math.max(0, entry.choices.indexOf(entry.defaultValue)) : 0;
      code += `  store<u8>(ptr + ${entry.offset}, ${idx});\n`;
    }
  }
  code += `}\n\n`;

  // Getters & Setters
  for (const [key, entry] of entries) {
    const fnSuffix = `${entry.category}_${entry.name}`;
    const safeConstName = `OFFSET_${entry.category.toUpperCase()}_${entry.name.toUpperCase()}`;

    if (mode === "compileTimeLocked") {
      // Locked mode: emit inline static constants
      if (entry.type === "float") {
        code += `@inline\nexport function config_get_${fnSuffix}(): f64 { return ${Number(entry.defaultValue).toFixed(8)}; }\n`;
      } else if (entry.type === "int") {
        code += `@inline\nexport function config_get_${fnSuffix}(): i32 { return ${entry.defaultValue}; }\n`;
      } else {
        const val =
          entry.type === "enum"
            ? entry.choices
              ? Math.max(0, entry.choices.indexOf(entry.defaultValue))
              : 0
            : entry.defaultValue
              ? 1
              : 0;
        code += `@inline\nexport function config_get_${fnSuffix}(): u8 { return ${val}; }\n`;
      }
    } else {
      // Dynamic mode: read/write from WASM linear memory
      if (entry.type === "float") {
        code += `@inline\nexport function config_get_${fnSuffix}(): f64 {\n  let ptr = globalConfigPtr != 0 ? globalConfigPtr : config_init();\n  return load<f64>(ptr + ${safeConstName});\n}\n`;
        code += `export function config_set_${fnSuffix}(val: f64): void {\n  let ptr = globalConfigPtr != 0 ? globalConfigPtr : config_init();\n  store<f64>(ptr + ${safeConstName}, val);\n}\n`;
      } else if (entry.type === "int") {
        code += `@inline\nexport function config_get_${fnSuffix}(): i32 {\n  let ptr = globalConfigPtr != 0 ? globalConfigPtr : config_init();\n  return load<i32>(ptr + ${safeConstName});\n}\n`;
        code += `export function config_set_${fnSuffix}(val: i32): void {\n  let ptr = globalConfigPtr != 0 ? globalConfigPtr : config_init();\n  store<i32>(ptr + ${safeConstName}, val);\n}\n`;
      } else {
        code += `@inline\nexport function config_get_${fnSuffix}(): u8 {\n  let ptr = globalConfigPtr != 0 ? globalConfigPtr : config_init();\n  return load<u8>(ptr + ${safeConstName});\n}\n`;
        code += `export function config_set_${fnSuffix}(val: u8): void {\n  let ptr = globalConfigPtr != 0 ? globalConfigPtr : config_init();\n  store<u8>(ptr + ${safeConstName}, val);\n}\n`;
      }
    }
  }

  return {
    entries,
    totalSize,
    assemblyScriptCode: code,
  };
}
