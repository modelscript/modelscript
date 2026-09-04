import { ConfigLayoutResult } from "@modelscript/dsl/codegen/config.js";

export interface WASMMemoryLike {
  buffer: ArrayBufferLike;
}

/**
 * Host-side TypeScript client for inspecting and mutating WebAssembly linear memory runtime configurations in O(1).
 */
export class RuntimeConfigClient {
  private memory: WASMMemoryLike;
  private layout: ConfigLayoutResult;
  private getPtrFn?: () => number;

  constructor(memory: WASMMemoryLike, layout: ConfigLayoutResult, getPtrFn?: () => number) {
    this.memory = memory;
    this.layout = layout;
    this.getPtrFn = getPtrFn;
  }

  private getConfigPtr(): number {
    if (this.getPtrFn) {
      return this.getPtrFn();
    }
    return 0;
  }

  /**
   * Retrieves a configuration option value from WASM linear memory.
   */
  get(key: string): any {
    const entry = this.layout.entries.get(key);
    if (!entry) {
      throw new Error(`[ConfigClient] Unknown configuration key '${key}'`);
    }

    const basePtr = this.getConfigPtr();
    const targetOffset = basePtr + entry.offset;
    const view = new DataView(this.memory.buffer);

    if (entry.type === "float") {
      return view.getFloat64(targetOffset, true);
    } else if (entry.type === "int") {
      return view.getInt32(targetOffset, true);
    } else if (entry.type === "bool") {
      return view.getUint8(targetOffset) !== 0;
    } else if (entry.type === "enum") {
      const idx = view.getUint8(targetOffset);
      return entry.choices && entry.choices[idx] !== undefined ? entry.choices[idx] : idx;
    }
  }

  /**
   * Mutates a configuration option value directly in WASM linear memory.
   */
  set(key: string, value: any): void {
    const entry = this.layout.entries.get(key);
    if (!entry) {
      throw new Error(`[ConfigClient] Unknown configuration key '${key}'`);
    }

    const basePtr = this.getConfigPtr();
    const targetOffset = basePtr + entry.offset;
    const view = new DataView(this.memory.buffer);

    if (entry.type === "float") {
      const numVal = Number(value);
      if (isNaN(numVal)) throw new Error(`[ConfigClient] Invalid float value for key '${key}': ${value}`);
      if (entry.min !== undefined && numVal < entry.min)
        throw new Error(`[ConfigClient] Value ${numVal} below min threshold ${entry.min} for key '${key}'`);
      if (entry.max !== undefined && numVal > entry.max)
        throw new Error(`[ConfigClient] Value ${numVal} exceeds max threshold ${entry.max} for key '${key}'`);
      view.setFloat64(targetOffset, numVal, true);
    } else if (entry.type === "int") {
      const intVal = Math.floor(Number(value));
      if (isNaN(intVal)) throw new Error(`[ConfigClient] Invalid int value for key '${key}': ${value}`);
      if (entry.min !== undefined && intVal < entry.min)
        throw new Error(`[ConfigClient] Value ${intVal} below min threshold ${entry.min} for key '${key}'`);
      if (entry.max !== undefined && intVal > entry.max)
        throw new Error(`[ConfigClient] Value ${intVal} exceeds max threshold ${entry.max} for key '${key}'`);
      view.setInt32(targetOffset, intVal, true);
    } else if (entry.type === "bool") {
      const boolVal = Boolean(value);
      view.setUint8(targetOffset, boolVal ? 1 : 0);
    } else if (entry.type === "enum") {
      let idx = -1;
      if (typeof value === "number") {
        idx = value;
      } else if (entry.choices) {
        idx = entry.choices.indexOf(String(value));
      }
      if (idx === -1 || (entry.choices && idx >= entry.choices.length)) {
        throw new Error(
          `[ConfigClient] Invalid enum choice '${value}' for key '${key}'. Valid choices: [${entry.choices?.join(", ")}]`,
        );
      }
      view.setUint8(targetOffset, idx);
    }
  }

  /**
   * Dumps current state of all configuration entries.
   */
  getAll(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const key of this.layout.entries.keys()) {
      result[key] = this.get(key);
    }
    return result;
  }
}
