/* eslint-disable */
// @ts-nocheck
import { atomicChunkAlloc } from "./arena";

// 64-bit Hash Set implementation using linear probing
@unmanaged
export class UnmanagedSet64 {
    keys: usize;
    capacity: u32;
    size: u32;
    isActive: boolean;

    @inline init(initialCapacity: u32 = 16): void {
        this.capacity = initialCapacity;
        this.size = 0;
        this.isActive = true;
        this.keys = atomicChunkAlloc(initialCapacity * 8);
        memory.fill(this.keys, 0, initialCapacity * 8);
    }

    @inline add(hash: u64): void {
        if (hash == 0) hash = 1; // 0 is reserved for empty slot
        if (this.size * 2 >= this.capacity) this._resize();
        
        let mask = this.capacity - 1;
        let idx = (hash as u32) & mask;
        
        while (true) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) {
                store<u64>(this.keys + (idx * 8), hash);
                this.size++;
                return;
            }
            if (k == hash) return;
            idx = (idx + 1) & mask;
        }
    }

    @inline has(hash: u64): boolean {
        if (hash == 0) hash = 1;
        let mask = this.capacity - 1;
        let idx = (hash as u32) & mask;
        
        while (true) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) return false;
            if (k == hash) return true;
            idx = (idx + 1) & mask;
        }
    }

    _resize(): void {
        let oldCap = this.capacity;
        let oldKeys = this.keys;
        
        this.capacity = oldCap * 2;
        this.keys = atomicChunkAlloc(this.capacity * 8);
        memory.fill(this.keys, 0, this.capacity * 8);
        this.size = 0;
        
        for (let i: u32 = 0; i < oldCap; i++) {
            let k = load<u64>(oldKeys + (i * 8));
            if (k != 0) this.add(k);
        }
    }

    @inline release(): void {
        if (!this.isActive) return;
        this.isActive = false;
        releaseSet64(this);
    }
}

// 64-bit Hash Map implementation
@unmanaged
export class UnmanagedMap64 {
    keys: usize;
    values: usize;
    capacity: u32;
    size: u32;
    isActive: boolean;

    @inline init(initialCapacity: u32 = 16): void {
        this.capacity = initialCapacity;
        this.size = 0;
        this.isActive = true;
        this.keys = atomicChunkAlloc(initialCapacity * 8);
        this.values = atomicChunkAlloc(initialCapacity * 4);
        memory.fill(this.keys, 0, initialCapacity * 8);
    }

    @inline set(hash: u64, value: u32): void {
        if (hash == 0) hash = 1;
        if (this.size * 2 >= this.capacity) this._resize();
        
        let mask = this.capacity - 1;
        let idx = (hash as u32) & mask;
        
        while (true) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) {
                store<u64>(this.keys + (idx * 8), hash);
                store<u32>(this.values + (idx * 4), value);
                this.size++;
                return;
            }
            if (k == hash) {
                store<u32>(this.values + (idx * 4), value);
                return;
            }
            idx = (idx + 1) & mask;
        }
    }

    @inline get(hash: u64): u32 {
        if (hash == 0) hash = 1;
        let mask = this.capacity - 1;
        let idx = (hash as u32) & mask;
        
        while (true) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) return 0;
            if (k == hash) return load<u32>(this.values + (idx * 4));
            idx = (idx + 1) & mask;
        }
    }

    _resize(): void {
        let oldCap = this.capacity;
        let oldKeys = this.keys;
        let oldValues = this.values;
        
        this.capacity = oldCap * 2;
        this.keys = atomicChunkAlloc(this.capacity * 8);
        this.values = atomicChunkAlloc(this.capacity * 4);
        memory.fill(this.keys, 0, this.capacity * 8);
        this.size = 0;
        
        for (let i: u32 = 0; i < oldCap; i++) {
            let k = load<u64>(oldKeys + (i * 8));
            if (k != 0) {
                this.set(k, load<u32>(oldValues + (i * 4)));
            }
        }
        heap.free(oldKeys);
        heap.free(oldValues);
    }

    @inline release(): void {
        if (!this.isActive) return;
        this.isActive = false;
        releaseMap64(this);
    }
}

// Pooling logic
const setPool = new Array<UnmanagedSet64>(16);
let setPoolDepth: i32 = 16;
for (let i = 0; i < 16; i++) {
    let ptr = heap.alloc(offsetof<UnmanagedSet64>());
    let s = changetype<UnmanagedSet64>(ptr);
    s.isActive = false;
    setPool[i] = s;
}

export function createSet64(): u32 {
    let s: UnmanagedSet64;
    if (setPoolDepth > 0) {
        setPoolDepth--;
        s = setPool[setPoolDepth];
    } else {
        let ptr = heap.alloc(offsetof<UnmanagedSet64>());
        s = changetype<UnmanagedSet64>(ptr);
    }
    s.init();
    return changetype<u32>(s);
}

export function releaseSet64(s: UnmanagedSet64): void {
    if (setPoolDepth < 16) {
        setPool[setPoolDepth] = s;
        setPoolDepth++;
    } else {
        heap.free(changetype<usize>(s));
    }
}

const mapPool = new Array<UnmanagedMap64>(16);
let mapPoolDepth: i32 = 16;
for (let i = 0; i < 16; i++) {
    let ptr = heap.alloc(offsetof<UnmanagedMap64>());
    let m = changetype<UnmanagedMap64>(ptr);
    m.isActive = false;
    mapPool[i] = m;
}

export function createMap64(): u32 {
    let m: UnmanagedMap64;
    if (mapPoolDepth > 0) {
        mapPoolDepth--;
        m = mapPool[mapPoolDepth];
    } else {
        let ptr = heap.alloc(offsetof<UnmanagedMap64>());
        m = changetype<UnmanagedMap64>(ptr);
    }
    m.init();
    return changetype<u32>(m);
}

export function releaseMap64(m: UnmanagedMap64): void {
    if (mapPoolDepth < 16) {
        mapPool[mapPoolDepth] = m;
        mapPoolDepth++;
    } else {
        heap.free(changetype<usize>(m));
    }
}
// 64-bit to 64-bit Hash Map implementation
@unmanaged
export class UnmanagedMap64To64 {
    keys: usize;
    values: usize;
    capacity: u32;
    size: u32;
    isActive: boolean;

    @inline init(initialCapacity: u32 = 16): void {
        this.capacity = initialCapacity;
        this.size = 0;
        this.isActive = true;
        this.keys = atomicChunkAlloc(initialCapacity * 8);
        this.values = atomicChunkAlloc(initialCapacity * 8);
        memory.fill(this.keys, 0, initialCapacity * 8);
    }

    @inline set(hash: u64, value: u64): void {
        if (hash == 0) hash = 1;
        if (this.size * 2 >= this.capacity) this._resize();
        
        let mask = this.capacity - 1;
        let idx = (hash as u32) & mask;
        
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
        if (hash == 0) hash = 1;
        let mask = this.capacity - 1;
        let idx = (hash as u32) & mask;
        
        while (true) {
            let k = load<u64>(this.keys + (idx * 8));
            if (k == 0) return 0;
            if (k == hash) return load<u64>(this.values + (idx * 8));
            idx = (idx + 1) & mask;
        }
    }

    _resize(): void {
        let oldCap = this.capacity;
        let oldKeys = this.keys;
        let oldValues = this.values;
        
        this.capacity = oldCap * 2;
        this.keys = atomicChunkAlloc(this.capacity * 8);
        this.values = atomicChunkAlloc(this.capacity * 8);
        memory.fill(this.keys, 0, this.capacity * 8);
        this.size = 0;
        
        for (let i: u32 = 0; i < oldCap; i++) {
            let k = load<u64>(oldKeys + (i * 8));
            if (k != 0) {
                this.set(k, load<u64>(oldValues + (i * 8)));
            }
        }
        heap.free(oldKeys);
        heap.free(oldValues);
    }

    @inline release(): void {
        if (!this.isActive) return;
        this.isActive = false;
        releaseMap64To64(this);
    }
}

const map64Pool = new Array<UnmanagedMap64To64>(16);
let map64PoolDepth: i32 = 16;
for (let i = 0; i < 16; i++) {
    let ptr = atomicChunkAlloc(offsetof<UnmanagedMap64To64>());
    let m = changetype<UnmanagedMap64To64>(ptr);
    m.isActive = false;
    map64Pool[i] = m;
}

export function createMap64To64(): u32 {
    let m: UnmanagedMap64To64;
    if (map64PoolDepth > 0) {
        map64PoolDepth--;
        m = map64Pool[map64PoolDepth];
    } else {
        let ptr = atomicChunkAlloc(offsetof<UnmanagedMap64To64>());
        m = changetype<UnmanagedMap64To64>(ptr);
    }
    m.init();
    return changetype<u32>(m);
}

export function releaseMap64To64(m: UnmanagedMap64To64): void {
    if (map64PoolDepth < 16) {
        map64Pool[map64PoolDepth] = m;
        map64PoolDepth++;
    } else {
        heap.free(changetype<usize>(m));
    }
}
