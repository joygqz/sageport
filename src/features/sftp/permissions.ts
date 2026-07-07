export type PermClass = "owner" | "group" | "others";
export type PermBit = "read" | "write" | "execute";

const CLASS_SHIFT: Record<PermClass, number> = {
  owner: 6,
  group: 3,
  others: 0,
};

const BIT_VALUE: Record<PermBit, number> = {
  read: 4,
  write: 2,
  execute: 1,
};

export function modeToOctal(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

export function octalToMode(octal: string): number | null {
  if (!/^[0-7]{1,4}$/.test(octal)) return null;
  return parseInt(octal, 8) & 0o777;
}

export function hasBit(mode: number, cls: PermClass, bit: PermBit): boolean {
  return (mode & (BIT_VALUE[bit] << CLASS_SHIFT[cls])) !== 0;
}

export function toggleBit(mode: number, cls: PermClass, bit: PermBit): number {
  return mode ^ (BIT_VALUE[bit] << CLASS_SHIFT[cls]);
}
