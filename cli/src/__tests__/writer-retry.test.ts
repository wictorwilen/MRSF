import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeSidecar } from "../lib/writer.js";
import type { MrsfDocument } from "../lib/types.js";

const renameMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: (...args: Parameters<typeof actual.rename>) => renameMock(...args) };
});

let directory: string;
let target: string;
const document: MrsfDocument = { mrsf_version: "1.0", document: "doc.md", comments: [] };

beforeEach(async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  renameMock.mockReset().mockImplementation(actual.rename);
  directory = await mkdtemp(path.join(os.tmpdir(), "mrsf-writer-retry-"));
  target = path.join(directory, "doc.md.review.json");
  await writeFile(target, JSON.stringify(document));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("atomic sidecar replacement under file contention", () => {
  it.each(["EPERM", "EACCES", "EBUSY"])("retries transient %s failures without losing Unicode content", async (code) => {
    const error = Object.assign(new Error("File is temporarily locked"), { code });
    renameMock.mockRejectedValueOnce(error).mockRejectedValueOnce(error);
    const updated: MrsfDocument = {
      ...document,
      comments: [{
        id: "unicode", author: "山田 👩‍💻", text: "日本語 😀 🇯🇵 𠮷 Cafe\u0301",
        timestamp: "2026-09-17T00:00:00Z",
      }],
    };

    await writeSidecar(target, updated);

    expect(renameMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual(updated);
    expect(await readdir(directory)).toEqual(["doc.md.review.json"]);
  });

  it("propagates permanent failures immediately and preserves the original file", async () => {
    const error = Object.assign(new Error("No space left"), { code: "ENOSPC" });
    renameMock.mockRejectedValue(error);

    await expect(writeSidecar(target, document)).rejects.toBe(error);

    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual(document);
    expect(await readdir(directory)).toEqual(["doc.md.review.json"]);
  });

  it("bounds retries and cleans up when a lock does not clear", async () => {
    const error = Object.assign(new Error("Permission denied"), { code: "EPERM" });
    renameMock.mockRejectedValue(error);

    await expect(writeSidecar(target, document)).rejects.toBe(error);

    expect(renameMock).toHaveBeenCalledTimes(6);
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual(document);
    expect(await readdir(directory)).toEqual(["doc.md.review.json"]);
  });
});
