// src/lib/defined.ts
export function defined<T extends Record<string, any>>(obj: T) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)
  ) as Partial<T>;
}
