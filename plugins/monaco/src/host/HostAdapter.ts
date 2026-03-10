import type { MrsfDocument } from "@mrsf/cli/browser";

export type HostDisposer = () => void | Promise<void>;

export interface MonacoMrsfHostAdapter {
  getDocumentText(resourceId: string): Promise<string>;
  getDocumentPath?(resourceId: string): Promise<string | null>;
  discoverSidecar(resourceId: string): Promise<string | null>;
  readSidecar(sidecarPath: string): Promise<MrsfDocument | null>;
  writeSidecar(sidecarPath: string, document: MrsfDocument): Promise<void>;
  watchDocument?(
    resourceId: string,
    onChange: () => void | Promise<void>,
  ): HostDisposer | Promise<HostDisposer>;
  watchSidecar?(
    sidecarPath: string,
    onChange: () => void | Promise<void>,
  ): HostDisposer | Promise<HostDisposer>;
}

export function splitDocumentLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}