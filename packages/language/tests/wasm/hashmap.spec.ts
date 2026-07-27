import {
  createMap64,
  createMap64To64,
  createSet64,
  UnmanagedMap64,
  UnmanagedMap64To64,
  UnmanagedSet64,
} from "../../src/codegen/runtime/hashmap";

describe("UnmanagedSet64", () => {
  it("should add keys and verify existence correctly", () => {
    let setPtr = createSet64();
    let set = changetype<UnmanagedSet64>(setPtr);

    expect<boolean>(set.has(100)).toBe(false, "Key 100 should initially not exist");
    set.add(100);
    expect<boolean>(set.has(100)).toBe(true, "Key 100 should exist after add()");

    set.add(200);
    set.add(300);
    expect<boolean>(set.has(200)).toBe(true);
    expect<boolean>(set.has(300)).toBe(true);
    expect<boolean>(set.has(400)).toBe(false);

    set.release();
  });

  it("should handle key 0 mapping correctly", () => {
    let setPtr = createSet64();
    let set = changetype<UnmanagedSet64>(setPtr);

    set.add(0); // Should be remapped to key 1
    expect<boolean>(set.has(0)).toBe(true, "Key 0 should be found");
    expect<boolean>(set.has(1)).toBe(true, "Key 1 should also evaluate as found due to remapping");

    set.release();
  });

  it("should automatically resize when load factor exceeds 50%", () => {
    let setPtr = createSet64();
    let set = changetype<UnmanagedSet64>(setPtr);
    let initialCap = set.capacity;

    // Add elements to trigger resize (capacity starts at 16, resizes at 8)
    for (let i: u64 = 1; i <= 20; i++) {
      set.add(i * 100);
    }

    expect<u32>(set.capacity).toBeGreaterThan(initialCap, "Capacity should have expanded");
    expect<u32>(set.size).toBe(20, "Size should match inserted element count");

    for (let i: u64 = 1; i <= 20; i++) {
      expect<boolean>(set.has(i * 100)).toBe(true, `Key ${i * 100} should survive resize`);
    }

    set.release();
  });
});

describe("UnmanagedMap64", () => {
  it("should insert, update, and retrieve u32 values", () => {
    let mapPtr = createMap64();
    let map = changetype<UnmanagedMap64>(mapPtr);

    expect<u32>(map.get(1001)).toBe(0, "Non-existent key should return 0");
    map.set(1001, 42);
    expect<u32>(map.get(1001)).toBe(42, "Key 1001 should return value 42");

    // Update existing key
    map.set(1001, 99);
    expect<u32>(map.get(1001)).toBe(99, "Key 1001 value should update to 99");

    map.release();
  });

  it("should handle map capacity expansion correctly", () => {
    let mapPtr = createMap64();
    let map = changetype<UnmanagedMap64>(mapPtr);

    for (let i: u32 = 1; i <= 50; i++) {
      map.set(i as u64, i * 10);
    }

    expect<u32>(map.size).toBe(50);
    for (let i: u32 = 1; i <= 50; i++) {
      expect<u32>(map.get(i as u64)).toBe(i * 10, `Key ${i} should return value ${i * 10}`);
    }

    map.release();
  });
});

describe("UnmanagedMap64To64", () => {
  it("should insert and retrieve 64-bit keys and 64-bit values", () => {
    let mapPtr = createMap64To64();
    let map = changetype<UnmanagedMap64To64>(mapPtr);

    let bigKey: u64 = 0x123456789abcdef0;
    let bigVal: u64 = 0xfedcba9876543210;

    map.set(bigKey, bigVal);
    expect<u64>(map.get(bigKey)).toBe(bigVal, "64-bit value should match");

    map.release();
  });
});

describe("Object Pool Recycling", () => {
  it("should reuse pooled instances without leaking memory or carrying stale state", () => {
    let mapPtr1 = createMap64();
    let map1 = changetype<UnmanagedMap64>(mapPtr1);
    map1.set(555, 777);
    map1.release();

    let mapPtr2 = createMap64();
    expect<u32>(mapPtr2).toBe(mapPtr1, "Pooled object should reuse previous pointer");

    let map2 = changetype<UnmanagedMap64>(mapPtr2);
    expect<u32>(map2.size).toBe(0, "Recycled map size must be zeroed");
    expect<u32>(map2.get(555)).toBe(0, "Stale keys must be wiped");

    map2.release();
  });
});
