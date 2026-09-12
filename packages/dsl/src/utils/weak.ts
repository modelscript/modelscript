export function makeWeakRef<T extends WeakKey>(target: T | null | undefined): WeakRef<T> | null {
  if (target) return { deref: () => target } as unknown as WeakRef<T>;
  else return null;
}

export function makeWeakRefArray<T extends WeakKey>(targets: T[]): WeakRef<T>[] {
  return targets.map((t) => ({ deref: () => t }) as unknown as WeakRef<T>);
}
