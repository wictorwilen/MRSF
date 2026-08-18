from unittest.mock import patch

from click.testing import CliRunner

from mrsf.cli.main import cli


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
