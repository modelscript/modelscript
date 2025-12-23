export function makeWeakRef<T extends WeakKey>(target: T | null | undefined): WeakRef<T> | null {
  if (target) return new WeakRef(target);
  else return null;
}

export function makeWeakRefArray<T extends WeakKey>(targets: T[]): WeakRef<T>[] {
  return targets.map((t) => new WeakRef(t));
}
