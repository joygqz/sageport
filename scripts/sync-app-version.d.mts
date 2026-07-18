export interface SyncAppVersionOptions {
  root: string;
  currentVersion: string;
  newVersion: string;
}

export function updateJsonVersion(
  contents: string,
  currentVersion: string,
  newVersion: string,
  file: string,
): string;

export function updateCargoPackageVersion(
  contents: string,
  currentVersion: string,
  newVersion: string,
): string;

export function updateCargoLockVersion(
  contents: string,
  currentVersion: string,
  newVersion: string,
): string;

export function syncAppVersion(options: SyncAppVersionOptions): string[];
