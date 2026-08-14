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
 *  - **Zero Garbage Collection**: Allocates keys/values using AssemblyScript TLSF `heap.alloc`.
 *  - **Linear Probing**: Open addressing with cache-friendly contiguous array scanning.
 *  - **Power-of-Two Capacity**: Guarantees fast bitwise masking (`hash & (capacity - 1)`).
 *  - **Load Factor Threshold**: Automatically resizes (doubles capacity) when `size * 2 >= capacity` (50% load factor).
 *  - **Reserved Null Slot**: Key `0` is reserved for empty/unoccupied slots. Input key `0` is mapped to `1`.
 *  - **LIFO Object Pooling**: Fixed-size 16-element stack pools (`setPool`, `mapPool`, `map64Pool`) eliminate allocation churn.
 */

/**
 * Unmanaged 64-bit Hash Set using open addressing and linear probing.
 * Designed for high-frequency symbol lookup, deduplication, and dependency graph indexing.
 */
@unmanaged
export class UnmanagedSet64 {
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
            this.keys = heap.alloc(initialCapacity * 8) as usize; // 8 bytes per u64 key
            this.capacity = initialCapacity;
        }
        this.size = 0;
        this.isActive = true;

        // Zero-fill key memory buffer to mark all slots as empty (0 = empty slot)
        memory.fill(this.keys, 0, this.capacity * 8);
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
        
        // Double capacity and allocate new zeroed key buffer
        this.capacity = oldCap * 2;
        this.keys = heap.alloc(this.capacity * 8) as usize;
        memory.fill(this.keys, 0, this.capacity * 8);
        this.size = 0;
        
        // Re-hash all non-zero keys from old buffer into new buffer
        for (let i: u32 = 0; i < oldCap; i++) {
            let k = load<u64>(oldKeys + (i * 8));
            if (k != 0) this.add(k);
        }
        if (oldKeys != 0) heap.free(oldKeys);
    }

    /**
     * Releases this set back to the LIFO object pool or frees its memory if pool is full.
     */
    @inline release(): void {
        if (!this.isActive) return; // Prevent double release
        this.isActive = false;
        releaseSet64(this);
    }
}

/**
 * Unmanaged Hash Map storing 64-bit integer keys and 32-bit integer values (`u64` -> `u32`).
 * Used for mapping symbol hashes to AST node pointers, string hashes to IDs, etc.
 */
@unmanaged
export class UnmanagedMap64 {
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
            this.keys = heap.alloc(initialCapacity * 8) as usize;  // 8 bytes per u64 key
            this.values = heap.alloc(initialCapacity * 4) as usize; // 4 bytes per u32 value
            this.capacity = initialCapacity;
        }
        this.size = 0;
        this.isActive = true;

        // Zero-fill key buffer (0 = empty slot)
        memory.fill(this.keys, 0, this.capacity * 8);
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
     * Gets a 32-bit value associated with a 64-bit key.
     * 
     * @param hash 64-bit key.
     * @returns 32-bit value if found, 0 if key does not exist.
     */
    @inline get(hash: u64): u32 {
        if (hash == 0) hash = 1;
        let mask = this.capacity - 1;
        let idx = ((hash as u32) ^ ((hash >> 32) as u32)) & mask;
        
        while (true) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) return 0;
            if (k == hash) return load<u32>(this.values + (idx * 4));
            idx = (idx + 1) & mask;
        }
    }

    /**
     * Internal helper to double capacity and re-hash map entries.
     */
    _resize(): void {
        let oldCap = this.capacity;
        let oldKeys = this.keys;
        let oldValues = this.values;
        
        this.capacity = oldCap * 2;
        this.keys = heap.alloc(this.capacity * 8) as usize;
        this.values = heap.alloc(this.capacity * 4) as usize;
        memory.fill(this.keys, 0, this.capacity * 8);
        this.size = 0;
        
        for (let i: u32 = 0; i < oldCap; i++) {
            let k = load<u64>(oldKeys + (i * 8));
            if (k != 0) {
                this.set(k, load<u32>(oldValues + (i * 4)));
            }
        }
        if (oldKeys != 0) heap.free(oldKeys);
        if (oldValues != 0) heap.free(oldValues);
    }

    /**
     * Releases this map instance back to the object pool.
     */
    @inline release(): void {
        if (!this.isActive) return;
        this.isActive = false;
        releaseMap64(this);
    }
}

// ----------------------------------------------------------------------------
// Pooling Logic for UnmanagedSet64 & UnmanagedMap64
// ----------------------------------------------------------------------------

/** Fixed-size LIFO stack pool for recycling UnmanagedSet64 instances. */
const setPool = new Array<UnmanagedSet64>(16);
let setPoolDepth: i32 = 16;
for (let i = 0; i < 16; i++) {
    let ptr = heap.alloc(offsetof<UnmanagedSet64>());
    memory.fill(ptr, 0, offsetof<UnmanagedSet64>());
    let s = changetype<UnmanagedSet64>(ptr);
    s.isActive = false;
    setPool[i] = s;
}

/**
 * Creates or recycles a 64-bit hash set from the object pool.
 * @returns Pointer (u32) to initialized UnmanagedSet64 instance.
 */
export function createSet64(): u32 {
    let s: UnmanagedSet64;
    if (setPoolDepth > 0) {
        setPoolDepth--;
        s = setPool[setPoolDepth];
    } else {
        let ptr = heap.alloc(offsetof<UnmanagedSet64>());
        memory.fill(ptr, 0, offsetof<UnmanagedSet64>());
        s = changetype<UnmanagedSet64>(ptr);
    }
    s.init();
    return changetype<u32>(s);
}

/**
 * Recycles an UnmanagedSet64 instance back to the pool.
 * @param s UnmanagedSet64 instance to recycle.
 */
export function releaseSet64(s: UnmanagedSet64): void {
    if (s.capacity > 1024) {
        if (s.keys != 0) heap.free(s.keys);
        s.keys = 0;
        s.capacity = 0;
    }
    if (setPoolDepth < 16) {
        setPool[setPoolDepth] = s;
        setPoolDepth++;
    } else {
        if (s.keys != 0) heap.free(s.keys);
        heap.free(changetype<usize>(s));
    }
}

/** Fixed-size LIFO stack pool for recycling UnmanagedMap64 instances. */
const mapPool = new Array<UnmanagedMap64>(16);
let mapPoolDepth: i32 = 16;
for (let i = 0; i < 16; i++) {
    let ptr = heap.alloc(offsetof<UnmanagedMap64>());
    memory.fill(ptr, 0, offsetof<UnmanagedMap64>());
    let m = changetype<UnmanagedMap64>(ptr);
    m.isActive = false;
    mapPool[i] = m;
}

/**
 * Creates or recycles a 64-bit to 32-bit hash map from the object pool.
 * @returns Pointer (u32) to initialized UnmanagedMap64 instance.
 */
export function createMap64(): u32 {
    let m: UnmanagedMap64;
    if (mapPoolDepth > 0) {
        mapPoolDepth--;
        m = mapPool[mapPoolDepth];
    } else {
        let ptr = heap.alloc(offsetof<UnmanagedMap64>());
        memory.fill(ptr, 0, offsetof<UnmanagedMap64>());
        m = changetype<UnmanagedMap64>(ptr);
    }
    m.init();
    return changetype<u32>(m);
}

/**
 * Recycles an UnmanagedMap64 instance back to the pool or frees its memory if pool is full.
 * @param m UnmanagedMap64 instance to recycle.
 */
export function releaseMap64(m: UnmanagedMap64): void {
    if (m.capacity > 1024) {
        if (m.keys != 0) heap.free(m.keys);
        if (m.values != 0) heap.free(m.values);
        m.keys = 0;
        m.values = 0;
        m.capacity = 0;
    }
    if (mapPoolDepth < 16) {
        mapPool[mapPoolDepth] = m;
        mapPoolDepth++;
    } else {
        if (m.keys != 0) heap.free(m.keys);
        if (m.values != 0) heap.free(m.values);
        heap.free(changetype<usize>(m));
    }
}

// ----------------------------------------------------------------------------
// UnmanagedMap64To64 (64-bit key to 64-bit value)
// ----------------------------------------------------------------------------

/**
 * Unmanaged Hash Map storing 64-bit keys and 64-bit values (`u64` -> `u64`).
 * Used for 64-bit handle mappings, large pointer structures, and double-precision numeric hashes.
 */
@unmanaged
export class UnmanagedMap64To64 {
    /** Pointer to 64-bit keys array (`u64[]`). */
    keys: usize;
    /** Pointer to 64-bit values array (`u64[]`). */
    values: usize;
    /** Power-of-two capacity. */
    capacity: u32;
    /** Number of active entries. */
    size: u32;
    /** Pool state flag. */
    isActive: boolean;

    /**
     * Initializes or re-initializes the 64-to-64 hash map.
     * @param initialCapacity Requested capacity (rounded to power of 2, min 16).
     */
    @inline init(initialCapacity: u32 = 16): void {
        if (initialCapacity < 16) initialCapacity = 16;
        let cap: u32 = 16;
        while (cap < initialCapacity) cap <<= 1;
        initialCapacity = cap;

        if (this.keys == 0 || this.capacity != initialCapacity) {
            this.keys = heap.alloc(initialCapacity * 8) as usize;   // 8 bytes per u64 key
            this.values = heap.alloc(initialCapacity * 8) as usize; // 8 bytes per u64 value
            this.capacity = initialCapacity;
        }
        this.size = 0;
        this.isActive = true;
        memory.fill(this.keys, 0, this.capacity * 8);
        memory.fill(this.values, 0, this.capacity * 8);
    }

    /**
     * Sets or updates a 64-bit key to 64-bit value entry.
     * @param hash 64-bit key.
     * @param value 64-bit value.
     */
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

    /**
     * Gets a 64-bit value associated with a 64-bit key.
     * @param hash 64-bit key.
     * @returns 64-bit value if found, 0 otherwise.
     */
    @inline get(hash: u64): u64 {
        if (hash == 0) hash = 1;
        let mask = this.capacity - 1;
        let idx = ((hash as u32) ^ ((hash >> 32) as u32)) & mask;
        
        while (true) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) return 0;
            if (k == hash) return load<u64>(this.values + (idx * 8));
            idx = (idx + 1) & mask;
        }
    }

    /**
     * Internal helper to double capacity and re-hash 64-to-64 entries.
     */
    _resize(): void {
        let oldCap = this.capacity;
        let oldKeys = this.keys;
        let oldValues = this.values;
        
        this.capacity = oldCap * 2;
        this.keys = heap.alloc(this.capacity * 8) as usize;
        this.values = heap.alloc(this.capacity * 8) as usize;
        memory.fill(this.keys, 0, this.capacity * 8);
        this.size = 0;
        
        for (let i: u32 = 0; i < oldCap; i++) {
            let k = load<u64>(oldKeys + (i * 8));
            if (k != 0) {
                this.set(k, load<u64>(oldValues + (i * 8)));
            }
        }
        if (oldKeys != 0) heap.free(oldKeys);
        if (oldValues != 0) heap.free(oldValues);
    }

    /**
     * Releases this 64-to-64 map instance back to the object pool.
     */
    @inline release(): void {
        if (!this.isActive) return;
        this.isActive = false;
        releaseMap64To64(this);
    }
}

/** Fixed-size LIFO stack pool for recycling UnmanagedMap64To64 instances. */
const map64Pool = new Array<UnmanagedMap64To64>(16);
let map64PoolDepth: i32 = 16;
for (let i = 0; i < 16; i++) {
    let ptr = heap.alloc(offsetof<UnmanagedMap64To64>());
    memory.fill(ptr, 0, offsetof<UnmanagedMap64To64>());
    let m = changetype<UnmanagedMap64To64>(ptr);
    m.isActive = false;
    map64Pool[i] = m;
}

/**
 * Creates or recycles a 64-bit key to 64-bit value hash map from the object pool.
 * @returns Pointer (u32) to initialized UnmanagedMap64To64 instance.
 */
export function createMap64To64(): u32 {
    let m: UnmanagedMap64To64;
    if (map64PoolDepth > 0) {
        map64PoolDepth--;
        m = map64Pool[map64PoolDepth];
    } else {
        let ptr = heap.alloc(offsetof<UnmanagedMap64To64>());
        memory.fill(ptr, 0, offsetof<UnmanagedMap64To64>());
        m = changetype<UnmanagedMap64To64>(ptr);
    }
    m.init();
    return changetype<u32>(m);
}

/**
 * Recycles an UnmanagedMap64To64 instance back to the pool or frees its memory if pool is full.
 * @param m UnmanagedMap64To64 instance to recycle.
 */
export function releaseMap64To64(m: UnmanagedMap64To64): void {
    if (m.capacity > 1024) {
        if (m.keys != 0) heap.free(m.keys);
        if (m.values != 0) heap.free(m.values);
        m.keys = 0;
        m.values = 0;
        m.capacity = 0;
    }
    if (map64PoolDepth < 16) {
        map64Pool[map64PoolDepth] = m;
        map64PoolDepth++;
    } else {
        if (m.keys != 0) heap.free(m.keys);
        if (m.values != 0) heap.free(m.values);
        heap.free(changetype<usize>(m));
    }
}
