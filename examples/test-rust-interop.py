"""Exercise the public Rust, Node, and Python SDKs against each other's files.

Run from any directory after building cli/ and installing python/. Cargo builds
the Rust example once; subsequent checks execute it directly rather than running
the package manager for every fixture. Temporary files are cleaned up on exit.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import mrsf

ROOT = Path(__file__).resolve().parents[1]
RUNTIMES = ("rust", "node", "python")
SHARED = {"labels": ["日本語", True, None, {"number": 3}], "note": "😀"}

NODE_BRIDGE = r"""
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [entry, mode, input, output] = process.argv.slice(1);
const sdk = await import(pathToFileURL(entry).href);
const doc = mode === "create"
  ? JSON.parse(await readFile(input, "utf8"))
  : await sdk.parseSidecar(input);
const report = await sdk.validate(doc);
if (!report.valid) throw new Error(JSON.stringify(report.errors));
if (mode === "update") {
  if (!sdk.resolveComment(doc, doc.comments[0].id)) {
    throw new Error("Cannot resolve the interoperability comment");
  }
  doc.comments[0].x_node = { checked: true, nested: ["日本語", null] };
  await copyFile(input, output);
}
if (mode !== "validate") await sdk.writeSidecar(output, doc);
"""


def run(*args: str | Path) -> None:
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True)


def seed() -> dict[str, Any]:
    text = "😀 日本語"
    return {
        "mrsf_version": "1.0",
        "document": "guide.md",
        "x_workspace": {"owner": "interop"},
        "comments": [
            {
                "id": "interop",
                "author": "Interop",
                "timestamp": "2026-01-01T00:00:00Z",
                "text": "Review this",
                "resolved": False,
                "line": 1,
                "start_column": 0,
                "end_column": 6,
                "selected_text": text,
                "selected_text_hash": mrsf.compute_hash(text),
                "x_shared": SHARED,
            }
        ],
    }


def node(mode: str, source: Path, destination: Path | None = None) -> None:
    args = [
        "node",
        "--input-type=module",
        "-e",
        NODE_BRIDGE,
        str(ROOT / "cli" / "dist" / "index.js"),
        mode,
        str(source),
    ]
    if destination is not None:
        args.append(str(destination))
    run(*args)


def python_validate(path: Path) -> dict[str, Any]:
    doc = mrsf.parse_sidecar(path)
    report = mrsf.validate(doc)
    assert report.valid, f"{path}: {report.errors}"
    return doc.to_dict()


def assert_preserved(before: dict[str, Any], after: dict[str, Any]) -> None:
    for key, value in before.items():
        if key != "comments":
            assert after[key] == value, f"Changed top-level field: {key}"
    assert len(after["comments"]) == len(before["comments"])
    for old, new in zip(before["comments"], after["comments"], strict=True):
        for key, value in old.items():
            if key != "resolved":
                assert new[key] == value, f"Changed comment field: {key}"
        assert new["resolved"] is True


def main() -> None:
    run(
        "cargo",
        "build",
        "--locked",
        "--manifest-path",
        ROOT / "rust" / "Cargo.toml",
        "--example",
        "interoperability",
    )
    metadata = subprocess.check_output(
        [
            "cargo",
            "metadata",
            "--manifest-path",
            str(ROOT / "rust" / "Cargo.toml"),
            "--format-version=1",
            "--no-deps",
        ],
        cwd=ROOT,
        text=True,
    )
    target = Path(json.loads(metadata)["target_directory"])
    rust_example = (
        target
        / "debug"
        / "examples"
        / ("interoperability.exe" if os.name == "nt" else "interoperability")
    )
    assert rust_example.is_file(), f"Rust example not built: {rust_example}"
    assert Path(mrsf.__file__).resolve().is_relative_to(ROOT / "python"), (
        "Install this checkout's Python SDK, not a released package"
    )

    validations = 0
    with tempfile.TemporaryDirectory(prefix="mrsf-rust-interop-") as directory:
        work = Path(directory)
        seed_path = work / "seed.review.json"
        seed_path.write_text(json.dumps(seed(), ensure_ascii=False), encoding="utf-8")
        for format_name in ("yaml", "json"):
            for producer in RUNTIMES:
                source = work / f"{producer}.review.{format_name}"
                if producer == "rust":
                    run(rust_example, "create", format_name, source)
                elif producer == "node":
                    node("create", seed_path, source)
                else:
                    mrsf.write_sidecar(source, mrsf.MrsfDocument.from_dict(seed()))
                baseline = python_validate(source)
                assert isinstance(baseline["x_workspace"], dict)
                assert isinstance(baseline["comments"][0]["x_shared"], dict)
                if format_name == "yaml":
                    source.write_bytes(
                        b"# cross-language annotation\n" + source.read_bytes()
                    )

                for reader in RUNTIMES:
                    if reader == "rust":
                        run(rust_example, "validate", source)
                    elif reader == "node":
                        node("validate", source)
                    else:
                        python_validate(source)
                    validations += 1

                # Chain the edits so each writer must also preserve fields added
                # by earlier writers, not merely the common starting fixture.
                for updater in RUNTIMES:
                    destination = work / f"{producer}-{updater}.review.{format_name}"
                    before = python_validate(source)
                    annotation_present = (
                        b"# cross-language annotation" in source.read_bytes()
                    )
                    if updater == "rust":
                        run(rust_example, "update", source, destination)
                    elif updater == "node":
                        node("update", source, destination)
                    else:
                        doc = mrsf.parse_sidecar(source)
                        assert mrsf.resolve_comment(doc, doc.comments[0].id)
                        doc.comments[0].extra["x_python"] = {
                            "checked": True,
                            "nested": ["日本語", None],
                        }
                        shutil.copyfile(source, destination)
                        mrsf.write_sidecar(destination, doc)
                    after = python_validate(destination)
                    assert_preserved(before, after)
                    assert isinstance(after["comments"][0][f"x_{updater}"], dict)
                    # The Rust writer promises lossless YAML updates. The Node
                    # writer currently reserializes structured extensions, so
                    # cross-language parity checks data, not its formatting.
                    if (
                        format_name == "yaml"
                        and updater == "rust"
                        and annotation_present
                    ):
                        assert (
                            b"# cross-language annotation" in destination.read_bytes()
                        )
                    for reader in RUNTIMES:
                        if reader == "rust":
                            run(rust_example, "validate", destination)
                        elif reader == "node":
                            node("validate", destination)
                        else:
                            python_validate(destination)
                        validations += 1
                    source = destination

        invalid = seed()
        invalid["comments"][0]["resolved"] = "not-a-boolean"
        invalid_path = work / "invalid.review.json"
        invalid_path.write_text(json.dumps(invalid), encoding="utf-8")
        assert not mrsf.validate(mrsf.parse_sidecar(invalid_path)).valid
        for command in (
            [str(rust_example), "validate", str(invalid_path)],
            [
                "node",
                "--input-type=module",
                "-e",
                NODE_BRIDGE,
                str(ROOT / "cli" / "dist" / "index.js"),
                "validate",
                str(invalid_path),
            ],
        ):
            result = subprocess.run(
                command, cwd=ROOT, capture_output=True, text=True, check=False
            )
            assert result.returncode != 0, f"Invalid sidecar accepted: {command[0]}"
            assert result.stderr.strip(), f"Failure lacked diagnostics: {command[0]}"

    print(
        f"Passed {validations} cross-language reader checks, "
        "18 chained updates, and invalid-input rejection in all SDKs."
    )


if __name__ == "__main__":
    main()
