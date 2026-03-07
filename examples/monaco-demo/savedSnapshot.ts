import {
  applyReanchorResults,
  reanchorDocumentText,
  type MrsfDocument,
  type ReanchorResult,
} from "@mrsf/monaco-mrsf/browser";

export function reanchorSavedSnapshot<TSidecar extends MrsfDocument>(
  savedSidecar: TSidecar,
  documentText: string,
): { sidecar: TSidecar; results: ReanchorResult[]; changed: number } {
  const nextSidecar = structuredClone(savedSidecar);
  const results = reanchorDocumentText(nextSidecar, documentText);
  const changed = applyReanchorResults(nextSidecar, results);
  return {
    sidecar: nextSidecar,
    results,
    changed,
  };
}