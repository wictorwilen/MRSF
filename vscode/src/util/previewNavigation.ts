import type { Uri } from "vscode";

let sequence = 0;
const targets = new Map<string, { line: number; id: number }>();

export function setPreviewScrollTarget(uri: Uri, line: number): void {
  if (!Number.isSafeInteger(line) || line < 1) return;
  targets.set(uri.toString(), { line, id: ++sequence });
}

export function getPreviewScrollTarget(uri: Uri) {
  return targets.get(uri.toString());
}