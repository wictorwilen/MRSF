import json
from pathlib import Path
from unittest.mock import patch

import pytest
from click.testing import CliRunner

from mrsf.cli.main import cli
from mrsf.parser import parse_sidecar, read_document_lines
from mrsf.reanchor import reanchor_comment

SELECTION_CASES = json.loads(
    (Path(__file__).parents[2] / "evaluation" / "reanchor" / "column-conformance.json")
    .read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", SELECTION_CASES, ids=lambda case: case["name"])
def test_add_selection_conformance(tmp_path, case):
    document = tmp_path / "doc.md"
    document.write_text(case["text"], encoding="utf-8")
    args = [
        "--cwd", str(tmp_path), "--quiet", "add", "doc.md",
        "--author", "tester", "--text", "Review", "--line", str(case["line"]),
    ]
    for field, flag in [
        ("end_line", "--end-line"),
        ("start_column", "--start-column"),
        ("end_column", "--end-column"),
    ]:
        if field in case:
            args.extend([flag, str(case[field])])
    result = CliRunner().invoke(cli, args)
    assert result.exit_code == 0, result.output
    comment = parse_sidecar(tmp_path / "doc.md.review.yaml").comments[0]
    assert comment.selected_text == case["selected_text"]
    assert comment.selected_text_hash
    anchored = reanchor_comment(comment, read_document_lines(document))
    assert anchored.status == "anchored"
    assert anchored.new_line == case["line"]
    if "start_column" in case:
        assert anchored.new_start_column == case["start_column"]
        assert anchored.new_end_column == case["end_column"]


def test_add_preserves_explicit_selected_text(tmp_path):
    (tmp_path / "doc.md").write_text("actual text\n", encoding="utf-8")
    result = CliRunner().invoke(cli, [
        "--cwd", str(tmp_path), "add", "doc.md", "--author", "tester",
        "--text", "Review", "--line", "1", "--selected-text", "original selection",
    ])
    assert result.exit_code == 0, result.output
    assert (
        parse_sidecar(tmp_path / "doc.md.review.yaml").comments[0].selected_text
        == "original selection"
    )


def test_add_uses_repository_local_git_identity(tmp_path):
    document = tmp_path / "guide.md"
    document.write_text("# Guide\n", encoding="utf-8")

    with (
        patch("mrsf.cli.add.find_repo_root", return_value=str(tmp_path)),
        patch("mrsf.cli.add.get_git_user_name", return_value="Repository Author"),
    ):
        result = CliRunner().invoke(
            cli,
            ["--cwd", str(tmp_path), "add", "guide.md", "--text", "Review note"],
        )

    assert result.exit_code == 0, result.output
    sidecar = (tmp_path / "guide.md.review.yaml").read_text(encoding="utf-8")
    assert "author: Repository Author" in sidecar


def test_add_prefers_explicit_author_over_repository_identity(tmp_path):
    document = tmp_path / "guide.md"
    document.write_text("# Guide\n", encoding="utf-8")

    with patch("mrsf.cli.add.get_git_user_name") as get_git_user_name:
        result = CliRunner().invoke(
            cli,
            [
                "--cwd",
                str(tmp_path),
                "add",
                "guide.md",
                "--author",
                "Explicit Author",
                "--text",
                "Review note",
            ],
        )

    assert result.exit_code == 0, result.output
    assert get_git_user_name.call_count == 0
    sidecar = (tmp_path / "guide.md.review.yaml").read_text(encoding="utf-8")
    assert "author: Explicit Author" in sidecar


def test_add_requires_author_when_local_git_identity_is_missing(tmp_path):
    document = tmp_path / "guide.md"
    document.write_text("# Guide\n", encoding="utf-8")

    with (
        patch("mrsf.cli.add.find_repo_root", return_value=str(tmp_path)),
        patch("mrsf.cli.add.get_git_user_name", return_value=None),
    ):
        result = CliRunner().invoke(
            cli,
            ["--cwd", str(tmp_path), "add", "guide.md", "--text", "Review note"],
        )

    assert result.exit_code == 2
    assert "Comment author is required" in result.output
