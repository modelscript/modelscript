/* eslint-disable */
// @ts-nocheck
/**
 * @fileoverview High-Performance Unmanaged 64-bit Hash Structures & Memory Pooling
 *
 * Provides thread-safe / GC-free high-performance open-addressing hash maps and hash sets for WebAssembly:
 *  1. `UnmanagedSet64`    - 64-bit integer hash set
 *  2. `UnmanagedMap64`    - 64-bit key to 32-bit value hash map
 *  3. `UnmanagedMap64To64` - 64-bit key to 64-bit value hash map
 *
 * Features & Design Decisions:
 *  - **Zero Garbage Collection**: Allocates keys/values using AssemblyScript TLSF `atomicChunkAlloc`.
 *  - **Linear Probing**: Open addressing with cache-friendly contiguous array scanning.
 *  - **Power-of-Two Capacity**: Guarantees fast bitwise masking (`hash & (capacity - 1)`).
 *  - **Load Factor Threshold**: Automatically resizes (doubles capacity) when `size * 2 >= capacity` (50% load factor).
 *  - **Reserved Null Slot**: Key `0` is reserved for empty/unoccupied slots. Input key `0` is mapped to `1`.
 */
import { atomicChunkAlloc } from "./array";

/**
 * Unmanaged 64-bit Hash Set using open addressing and linear probing.
 * Designed for high-frequency symbol lookup, deduplication, and dependency graph indexing.
 */
@unmanaged
export class UnmanagedSet64 {
    static poolBuf: usize = 0;
    static poolDepth: i32 = 0;

    /** Pointer to the contiguous 64-bit keys memory block in WebAssembly linear memory (`u64[]`). */
    keys: usize;
    /** Total number of allocated key slots. Must always be a power of two. */
    capacity: u32;
    /** Current number of active keys stored in the set. */
    size: u32;
    /** Flag tracking whether this set instance is active or currently recycled in the pool. */
    isActive: boolean;

    /**
     * Initializes or re-initializes the hash set.
     * Reuses existing key memory block if capacity matches, avoiding redundant allocations.
     * 
     * @param initialCapacity Requested initial capacity. Automatically rounded up to next power of 2 (min 16).
     */
    @inline init(initialCapacity: u32 = 16): void {
        // Enforce minimum capacity of 16 and power-of-two rounding for safe bitwise masking
        if (initialCapacity < 16) initialCapacity = 16;
        let cap: u32 = 16;
        while (cap < initialCapacity) cap <<= 1;
        initialCapacity = cap;

        // Reallocate memory block only if uninitialized or requested capacity changed
        if (this.keys == 0 || this.capacity != initialCapacity) {
            this.keys = atomicChunkAlloc(initialCapacity * 8) as usize; // 8 bytes per u64 key
            this.capacity = initialCapacity;
        }
        this.size = 0;
        this.isActive = true;

        // Zero-fill key memory buffer to mark all slots as empty (0 = empty slot)
        memory.fill(this.keys, 0, this.capacity * 8);
    }

    @inline clear(): void {
        if (this.keys != 0 && this.capacity != 0) {
            memory.fill(this.keys, 0, this.capacity * 8);
        }
        this.size = 0;
    }

    /**
     * Inserts a 64-bit hash key into the set.
     * 
     * @param hash 64-bit integer key to insert.
     */
    add(hash: u64): void {
        // Key 0 is reserved to represent empty slots; map key 0 to 1
        if (hash == 0) hash = 1;

        // Maintain 50% max load factor; double capacity if load exceeds threshold
        if (this.size * 2 >= this.capacity) this._resize();
        
        let mask = this.capacity - 1;
        let idx = ((hash as u32) ^ ((hash >> 32) as u32)) & mask; // Bit-mix 64-bit key to avoid high/low bit collision clustering
        
        // Linear probing loop: scan sequentially until empty slot or matching key is found
        while (true) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) {
                // Empty slot found; insert key and increment size
                store<u64>(this.keys + (idx * 8), hash);
                this.size++;
                return;
            }
            if (k == hash) return; // Key already present; no-op
            idx = (idx + 1) & mask; // Advance to next slot with wraparound
        }
    }

    /**
     * Checks if a 64-bit hash key exists in the set.
     * 
     * @param hash 64-bit integer key to query.
     * @returns True if the key exists in the set, false otherwise.
     */
    @inline has(hash: u64): boolean {
        if (hash == 0) hash = 1;
        let mask = this.capacity - 1;
        let idx = ((hash as u32) ^ ((hash >> 32) as u32)) & mask;
        
        // Linear probing search loop
        while (true) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) return false; // Encountered empty slot -> key is not present
            if (k == hash) return true; // Exact key match found
            idx = (idx + 1) & mask; // Probe next slot
        }
    }

    /**
     * Internal helper to double the capacity of the set and re-hash all existing keys.
     */
    _resize(): void {
        let oldCap = this.capacity;
        let oldKeys = this.keys;
        
        let newCap = oldCap * 2;
        let newKeys = atomicChunkAlloc(newCap * 8) as usize;
        memory.fill(newKeys, 0, newCap * 8);
        
        let mask = newCap - 1;
        for (let i: u32 = 0; i < oldCap; i++) {
            let k = load<u64>(oldKeys + (i * 8));
            if (k != 0) {
                let idx = ((k as u32) ^ ((k >> 32) as u32)) & mask;
                while (load<u64>(newKeys + (idx * 8)) != 0) {
                    idx = (idx + 1) & mask;
                }
                store<u64>(newKeys + (idx * 8), k);
            }
        }
        
        this.capacity = newCap;
        this.keys = newKeys;
    }

    /**
     * Releases this set back to the LIFO object pool or frees its memory if pool is full.
     */
    @inline release(): void {
        if (!this.isActive) return; // Prevent double release
        this.isActive = false;
        if (this.capacity > 1024) {
            this.keys = 0;
            this.capacity = 0;
        }
        if (UnmanagedSet64.poolBuf == 0) {
            UnmanagedSet64.poolBuf = atomicChunkAlloc(16 * sizeof<usize>());
        }
        if (UnmanagedSet64.poolDepth < 16) {
            store<usize>(UnmanagedSet64.poolBuf + (UnmanagedSet64.poolDepth * sizeof<usize>()), changetype<usize>(this));
            UnmanagedSet64.poolDepth++;
        }
    }

    /**
     * Creates a 64-bit hash set.
     */
    static create(): u32 {
        let ptr = atomicChunkAlloc(32);
        memory.fill(ptr, 0, 32);
        let s = changetype<UnmanagedSet64>(ptr);
        s.init();
        return changetype<u32>(s);
    }
}

/**
 * Unmanaged Hash Map storing 64-bit integer keys and 32-bit integer values (`u64` -> `u32`).
 * Used for mapping symbol hashes to AST node pointers, string hashes to IDs, etc.
 */
@unmanaged
export class UnmanagedMap64 {
    static poolBuf: usize = 0;
    static poolDepth: i32 = 0;
    /** Pointer to contiguous 64-bit keys array (`u64[]`). */
    keys: usize;
    /** Pointer to contiguous 32-bit values array (`u32[]`). */
    values: usize;
    /** Allocated capacity (power of two). */
    capacity: u32;
    /** Number of stored entries. */
    size: u32;
    /** Recycling status flag. */
    isActive: boolean;

    /**
     * Initializes or re-initializes the hash map.
     * Reuses existing key/value buffers if capacity matches.
     * 
     * @param initialCapacity Requested initial capacity (rounded to power of 2, min 16).
     */
    @inline init(initialCapacity: u32 = 16): void {
        if (initialCapacity < 16) initialCapacity = 16;
        let cap: u32 = 16;
        while (cap < initialCapacity) cap <<= 1;
        initialCapacity = cap;

        if (this.keys == 0 || this.capacity != initialCapacity) {
            this.keys = atomicChunkAlloc(initialCapacity * 8) as usize;  // 8 bytes per u64 key
            this.values = atomicChunkAlloc(initialCapacity * 4) as usize; // 4 bytes per u32 value
            this.capacity = initialCapacity;
        }
        this.size = 0;
        this.isActive = true;

        // Zero-fill key and value buffers (0 = empty slot)
        memory.fill(this.keys, 0, this.capacity * 8);
        memory.fill(this.values, 0, this.capacity * 4);
    }

    @inline clear(): void {
        if (this.keys != 0 && this.capacity != 0) {
            memory.fill(this.keys, 0, this.capacity * 8);
            if (this.values != 0) {
                memory.fill(this.values, 0, this.capacity * 4);
            }
        }
        this.size = 0;
    }

    /**
     * Sets or updates a key-value pair in the map.
     * 
     * @param hash 64-bit key.
     * @param value 32-bit value.
     */
    set(hash: u64, value: u32): void {
        if (hash == 0) hash = 1;
        if (this.size * 2 >= this.capacity) this._resize();
        
        let mask = this.capacity - 1;
        let idx = ((hash as u32) ^ ((hash >> 32) as u32)) & mask;
        
        while (true) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) {
                // Insert new key and value
                store<u64>(this.keys + (idx * 8), hash);
                store<u32>(this.values + (idx * 4), value);
                this.size++;
                return;
            }
            if (k == hash) {
                // Update existing value for key
                store<u32>(this.values + (idx * 4), value);
                return;
            }
            idx = (idx + 1) & mask;
        }
    }

    /**
     * Looks up the value associated with the given 64-bit key.
     * 
     * @param hash 64-bit key.
     * @returns The associated 32-bit value, or 0 if not found.
     */
    @inline get(hash: u64): u32 {
        if (this.keys == 0 || this.capacity == 0) return 0;
        if (hash == 0) hash = 1;
        let mask = this.capacity - 1;
        let idx = ((hash as u32) ^ ((hash >> 32) as u32)) & mask;
        
        let probes: u32 = 0;
        while (probes < this.capacity) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) return 0;
            if (k == hash) return load<u32>(this.values + (idx * 4));
            idx = (idx + 1) & mask;
            probes++;
        }
        return 0;
    }

    @inline has(hash: u64): boolean {
        if (this.keys == 0 || this.capacity == 0) return false;
        if (hash == 0) hash = 1;
        let mask = this.capacity - 1;
        let idx = ((hash as u32) ^ ((hash >> 32) as u32)) & mask;
        let probes: u32 = 0;
        while (probes < this.capacity) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) return false;
            if (k == hash) return true;
            idx = (idx + 1) & mask;
            probes++;
        }
        return false;
    }

    /**
     * Internal helper to double capacity and re-hash map entries.
     */
    _resize(): void {
        let oldCap = this.capacity;
        let oldKeys = this.keys;
        let oldValues = this.values;
        
        let newCap = oldCap * 2;
        let newKeys = atomicChunkAlloc(newCap * 8) as usize;
        let newValues = atomicChunkAlloc(newCap * 4) as usize;
        memory.fill(newKeys, 0, newCap * 8);
        memory.fill(newValues, 0, newCap * 4);
        
        let mask = newCap - 1;
        for (let i: u32 = 0; i < oldCap; i++) {
            let k = load<u64>(oldKeys + (i * 8));
            if (k != 0) {
                let v = load<u32>(oldValues + (i * 4));
                let idx = ((k as u32) ^ ((k >> 32) as u32)) & mask;
                while (load<u64>(newKeys + (idx * 8)) != 0) {
                    idx = (idx + 1) & mask;
                }
                store<u64>(newKeys + (idx * 8), k);
                store<u32>(newValues + (idx * 4), v);
            }
        }
        
        this.capacity = newCap;
        this.keys = newKeys;
        this.values = newValues;
    }

    /**
     * Releases this map instance back to the object pool.
     */
    @inline release(): void {
        this.isActive = false;
    }

    /**
     * Creates a 64-bit to 32-bit hash map.
     */
    static create(initialCapacity: u32 = 16): u32 {
        let ptr = atomicChunkAlloc(32);
        memory.fill(ptr, 0, 32);
        let m = changetype<UnmanagedMap64>(ptr);
        m.init(initialCapacity);
        return changetype<u32>(m);
    }
}

// ----------------------------------------------------------------------------
// UnmanagedMap64To64 (64-bit key to 64-bit value)
// ----------------------------------------------------------------------------

@unmanaged
export class UnmanagedMap64To64 {
    static poolBuf: usize = 0;
    static poolDepth: i32 = 0;
    keys: usize;
    values: usize;
    capacity: u32;
    size: u32;
    isActive: boolean;

    @inline init(initialCapacity: u32 = 16): void {
        if (initialCapacity < 16) initialCapacity = 16;
        let cap: u32 = 16;
        while (cap < initialCapacity) cap <<= 1;
        this.capacity = cap;
        this.size = 0;
        this.isActive = true;
        this.keys = atomicChunkAlloc(cap * 8) as usize;
        this.values = atomicChunkAlloc(cap * 8) as usize;
        memory.fill(this.keys, 0, cap * 8);
        memory.fill(this.values, 0, cap * 8);
    }

    @inline clear(): void {
        if (this.keys != 0 && this.capacity != 0) {
            memory.fill(this.keys, 0, this.capacity * 8);
            if (this.values != 0) {
                memory.fill(this.values, 0, this.capacity * 8);
            }
        }
        this.size = 0;
    }

    set(hash: u64, value: u64): void {
        if (hash == 0) hash = 1;
        if (this.size * 2 >= this.capacity) this._resize();
        
        let mask = this.capacity - 1;
        let idx = ((hash as u32) ^ ((hash >> 32) as u32)) & mask;
        
        while (true) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) {
                store<u64>(this.keys + (idx * 8), hash);
                store<u64>(this.values + (idx * 8), value);
                this.size++;
                return;
            }
            if (k == hash) {
                store<u64>(this.values + (idx * 8), value);
                return;
            }
            idx = (idx + 1) & mask;
        }
    }

    @inline get(hash: u64): u64 {
        if (this.keys == 0 || this.capacity == 0) return 0;
        if (hash == 0) hash = 1;
        let mask = this.capacity - 1;
        let idx = ((hash as u32) ^ ((hash >> 32) as u32)) & mask;
        
        let probes: u32 = 0;
        while (probes < this.capacity) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) return 0;
            if (k == hash) return load<u64>(this.values + (idx * 8));
            idx = (idx + 1) & mask;
            probes++;
        }
        return 0;
    }

    @inline has(hash: u64): boolean {
        if (this.keys == 0 || this.capacity == 0) return false;
        if (hash == 0) hash = 1;
        let mask = this.capacity - 1;
        let idx = ((hash as u32) ^ ((hash >> 32) as u32)) & mask;
        let probes: u32 = 0;
        while (probes < this.capacity) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) return false;
            if (k == hash) return true;
            idx = (idx + 1) & mask;
            probes++;
        }
        return false;
    }

    _resize(): void {
        let oldCap = this.capacity;
        let oldKeys = this.keys;
        let oldValues = this.values;
        
        let newCap = oldCap * 2;
        let newKeys = atomicChunkAlloc(newCap * 8) as usize;
        let newValues = atomicChunkAlloc(newCap * 8) as usize;
        memory.fill(newKeys, 0, newCap * 8);
        memory.fill(newValues, 0, newCap * 8);
        
        let mask = newCap - 1;
        for (let i: u32 = 0; i < oldCap; i++) {
            let k = load<u64>(oldKeys + (i * 8));
            if (k != 0) {
                let v = load<u64>(oldValues + (i * 8));
                let idx = ((k as u32) ^ ((k >> 32) as u32)) & mask;
                while (load<u64>(newKeys + (idx * 8)) != 0) {
                    idx = (idx + 1) & mask;
                }
                store<u64>(newKeys + (idx * 8), k);
                store<u64>(newValues + (idx * 8), v);
            }
        }
        
        this.capacity = newCap;
        this.keys = newKeys;
        this.values = newValues;
    }

    @inline release(): void {
        this.isActive = false;
    }

    static create(): u32 {
        let ptr = atomicChunkAlloc(32);
        memory.fill(ptr, 0, 32);
        let m = changetype<UnmanagedMap64To64>(ptr);
        m.init();
        return changetype<u32>(m);
    }
}

// ----------------------------------------------------------------------------
// Exported C-ABI Pool Functions
// ----------------------------------------------------------------------------

export function createSet64(): u32 {
    return UnmanagedSet64.create();
}

export function releaseSet64(s: UnmanagedSet64): void {
    s.release();
}

export function createMap64(initialCapacity: u32 = 16): u32 {
    return UnmanagedMap64.create(initialCapacity);
}

export function releaseMap64(m: UnmanagedMap64): void {
    m.release();
}

export function createMap64To64(): u32 {
    return UnmanagedMap64To64.create();
}

export function releaseMap64To64(m: UnmanagedMap64To64): void {
    m.release();
}
