import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registerValidate = vi.fn();
const registerReanchor = vi.fn();
const registerAdd = vi.fn();
const registerResolve = vi.fn();
const registerList = vi.fn();
const registerInit = vi.fn();
const registerStatus = vi.fn();
const registerRename = vi.fn();
const registerWatch = vi.fn();

const parseSpy = vi.fn();
const nameSpy = vi.fn();
const descriptionSpy = vi.fn();
const versionSpy = vi.fn();
const optionSpy = vi.fn();

class MockCommand {
  name = nameSpy.mockReturnThis();
  description = descriptionSpy.mockReturnThis();
  version = versionSpy.mockReturnThis();
  option = optionSpy.mockReturnThis();
  parse = parseSpy;
}

vi.mock("commander", () => ({
  Command: MockCommand,
}));

vi.mock("node:module", () => ({
  createRequire: () => () => ({ version: "0.4.1" }),
}));

vi.mock("../commands/validate.js", () => ({ registerValidate }));
vi.mock("../commands/reanchor.js", () => ({ registerReanchor }));
vi.mock("../commands/add.js", () => ({ registerAdd }));
vi.mock("../commands/resolve.js", () => ({ registerResolve }));
vi.mock("../commands/list.js", () => ({ registerList }));
vi.mock("../commands/init.js", () => ({ registerInit }));
vi.mock("../commands/status.js", () => ({ registerStatus }));
vi.mock("../commands/rename.js", () => ({ registerRename }));
vi.mock("../commands/watch.js", () => ({ registerWatch }));

const originalArgv = [...process.argv];
const originalCI = process.env.CI;
const originalIsTTY = process.stdout.isTTY;

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  });
}

async function importBin(): Promise<void> {
  vi.resetModules();
  await import("../bin.js");
}

beforeEach(() => {
  vi.clearAllMocks();
  process.argv = ["node", "/home/wictor/code/wictorwilen/mrsf/cli/src/bin.ts"];
  delete process.env.CI;
  setTTY(true);
});

afterEach(() => {
  process.argv = [...originalArgv];
  if (originalCI === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = originalCI;
  }
  setTTY(Boolean(originalIsTTY));
});

describe("bin entrypoint", () => {
  it("shows the banner, registers all commands, and parses the program in interactive mode", async () => {
    const stderrWriteSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await importBin();

    expect(stderrWriteSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrWriteSpy.mock.calls[0][0])).toContain("Markdown Review Sidecar Format");
    expect(String(stderrWriteSpy.mock.calls[0][0])).toContain("v0.4.1 (Node.js)");

    expect(nameSpy).toHaveBeenCalledWith("mrsf");
    expect(descriptionSpy).toHaveBeenCalledWith(
      "Markdown Review Sidecar Format — CLI & toolkit (Node.js)",
    );
    expect(versionSpy).toHaveBeenCalledWith("0.4.1 (Node.js)");
    expect(optionSpy).toHaveBeenCalledTimes(5);
    expect(registerValidate).toHaveBeenCalledTimes(1);
    expect(registerReanchor).toHaveBeenCalledTimes(1);
    expect(registerAdd).toHaveBeenCalledTimes(1);
    expect(registerResolve).toHaveBeenCalledTimes(1);
    expect(registerList).toHaveBeenCalledTimes(1);
    expect(registerInit).toHaveBeenCalledTimes(1);
    expect(registerStatus).toHaveBeenCalledTimes(1);
    expect(registerRename).toHaveBeenCalledTimes(1);
    expect(registerWatch).toHaveBeenCalledTimes(1);
    expect(parseSpy).toHaveBeenCalledTimes(1);

    stderrWriteSpy.mockRestore();
  });

  it("suppresses the banner in CI", async () => {
    const stderrWriteSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    process.env.CI = "true";

    await importBin();

    expect(stderrWriteSpy).not.toHaveBeenCalled();
    expect(parseSpy).toHaveBeenCalledTimes(1);

    stderrWriteSpy.mockRestore();
  });

  it("suppresses the banner when stdout is not a TTY", async () => {
    const stderrWriteSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    setTTY(false);

    await importBin();

    expect(stderrWriteSpy).not.toHaveBeenCalled();

    stderrWriteSpy.mockRestore();
  });

  it("suppresses the banner for quiet mode", async () => {
    const stderrWriteSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    process.argv = [
      "node",
      "/home/wictor/code/wictorwilen/mrsf/cli/src/bin.ts",
      "--quiet",
    ];

    await importBin();

    expect(stderrWriteSpy).not.toHaveBeenCalled();

    stderrWriteSpy.mockRestore();
  });
});