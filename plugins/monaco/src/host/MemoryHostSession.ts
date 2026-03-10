import type { MrsfDocument } from "@mrsf/cli/browser";
import { MemoryHostAdapter, type MemoryHostResource } from "./MemoryHostAdapter.js";

export interface EnsureMemorySidecarOptions {
  documentPath?: string | null;
  sidecarPath?: string | null;
  document?: string;
}

export class MemoryHostSession {
  constructor(
    private readonly host: MemoryHostAdapter,
    private readonly resourceId: string,
  ) {}

  snapshot(): MemoryHostResource {
    return this.host.snapshot(this.resourceId);
  }

  savedSidecarSnapshot(): MrsfDocument | null {
    return this.host.savedSidecarSnapshot(this.resourceId);
  }

  async updateDocumentText(documentText: string): Promise<void> {
    await this.host.updateDocument(this.resourceId, documentText);
  }

  ensureSidecar(options: EnsureMemorySidecarOptions = {}): MrsfDocument {
    const snapshot = this.host.snapshot(this.resourceId);
    if (snapshot.sidecar) {
      return structuredClone(snapshot.sidecar);
    }

    const documentPath = options.documentPath ?? snapshot.documentPath ?? this.resourceId;
    return {
      mrsf_version: "1.0",
      document: options.document ?? documentPath,
      comments: [],
    };
  }

  async replaceSidecar(sidecar: MrsfDocument | null): Promise<void> {
    await this.host.updateSidecar(this.resourceId, sidecar);
  }

  async mutateSidecar(
    mutator: (sidecar: MrsfDocument, snapshot: MemoryHostResource) => void | Promise<void>,
    options: EnsureMemorySidecarOptions = {},
  ): Promise<MrsfDocument> {
    const snapshot = this.host.snapshot(this.resourceId);
    const sidecar = this.ensureSidecar(options);
    await mutator(sidecar, snapshot);
    await this.host.updateSidecar(this.resourceId, sidecar);
    return sidecar;
  }

  async persistCurrentSidecar(): Promise<MrsfDocument> {
    const snapshot = this.host.snapshot(this.resourceId);
    if (!snapshot.sidecarPath || !snapshot.sidecar) {
      throw new Error("No sidecar is available for this resource.");
    }

    await this.host.writeSidecar(snapshot.sidecarPath, snapshot.sidecar);
    return structuredClone(snapshot.sidecar);
  }
}