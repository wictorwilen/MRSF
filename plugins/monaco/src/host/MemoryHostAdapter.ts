import type { MrsfDocument } from "@mrsf/cli/browser";
import type { HostDisposer, MonacoMrsfHostAdapter } from "./HostAdapter.js";

export interface MemoryHostResource {
  documentText: string;
  documentPath?: string | null;
  sidecarPath?: string | null;
  sidecar?: MrsfDocument | null;
  persistedSidecar?: MrsfDocument | null;
}

export interface MemoryHostAdapterState {
  resources: Record<string, MemoryHostResource>;
}

type Watcher = () => void | Promise<void>;

export class MemoryHostAdapter implements MonacoMrsfHostAdapter {
  private readonly resources = new Map<string, MemoryHostResource>();
  private readonly documentWatchers = new Map<string, Set<Watcher>>();
  private readonly sidecarWatchers = new Map<string, Set<Watcher>>();

  constructor(initialState: MemoryHostAdapterState) {
    for (const [resourceId, resource] of Object.entries(initialState.resources)) {
      this.resources.set(resourceId, {
        documentText: resource.documentText,
        documentPath: resource.documentPath ?? null,
        sidecarPath: resource.sidecarPath ?? null,
        sidecar: resource.sidecar ?? null,
        persistedSidecar: structuredClone(resource.persistedSidecar ?? resource.sidecar ?? null),
      });
    }
  }

  async getDocumentText(resourceId: string): Promise<string> {
    return this.requireResource(resourceId).documentText;
  }

  async getDocumentPath(resourceId: string): Promise<string | null> {
    return this.requireResource(resourceId).documentPath ?? null;
  }

  async discoverSidecar(resourceId: string): Promise<string | null> {
    return this.requireResource(resourceId).sidecarPath ?? null;
  }

  async readSidecar(sidecarPath: string): Promise<MrsfDocument | null> {
    return this.findBySidecarPath(sidecarPath)?.sidecar ?? null;
  }

  async writeSidecar(sidecarPath: string, document: MrsfDocument): Promise<void> {
    const resource = this.findBySidecarPath(sidecarPath);
    if (!resource) {
      throw new Error(`Unknown sidecar '${sidecarPath}'.`);
    }

    resource.sidecar = structuredClone(document);
    resource.persistedSidecar = structuredClone(document);
    await this.notify(this.sidecarWatchers.get(sidecarPath));
  }

  watchDocument(resourceId: string, onChange: Watcher): HostDisposer {
    const watchers = this.documentWatchers.get(resourceId) ?? new Set<Watcher>();
    watchers.add(onChange);
    this.documentWatchers.set(resourceId, watchers);
    return () => {
      watchers.delete(onChange);
    };
  }

  watchSidecar(sidecarPath: string, onChange: Watcher): HostDisposer {
    const watchers = this.sidecarWatchers.get(sidecarPath) ?? new Set<Watcher>();
    watchers.add(onChange);
    this.sidecarWatchers.set(sidecarPath, watchers);
    return () => {
      watchers.delete(onChange);
    };
  }

  async updateDocument(resourceId: string, documentText: string): Promise<void> {
    const resource = this.requireResource(resourceId);
    resource.documentText = documentText;
    await this.notify(this.documentWatchers.get(resourceId));
  }

  async updateSidecar(resourceId: string, sidecar: MrsfDocument | null): Promise<void> {
    const resource = this.requireResource(resourceId);
    resource.sidecar = sidecar ? structuredClone(sidecar) : null;
    if (resource.sidecarPath) {
      await this.notify(this.sidecarWatchers.get(resource.sidecarPath));
    }
  }

  snapshot(resourceId: string): MemoryHostResource {
    return structuredClone(this.requireResource(resourceId));
  }

  savedSidecarSnapshot(resourceId: string): MrsfDocument | null {
    return structuredClone(this.requireResource(resourceId).persistedSidecar ?? null);
  }

  private requireResource(resourceId: string): MemoryHostResource {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      throw new Error(`Unknown resource '${resourceId}'.`);
    }
    return resource;
  }

  private findBySidecarPath(sidecarPath: string): MemoryHostResource | null {
    for (const resource of this.resources.values()) {
      if (resource.sidecarPath === sidecarPath) {
        return resource;
      }
    }
    return null;
  }

  private async notify(watchers?: Set<Watcher>): Promise<void> {
    if (!watchers || watchers.size === 0) return;
    for (const watcher of [...watchers]) {
      await watcher();
    }
  }
}