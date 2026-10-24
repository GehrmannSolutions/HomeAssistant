"""Local file store for plans and scripts the model writes: sandboxed, never executed."""
import os
import stat

import pytest

from ha_safe_mcp.files import FileError, FileStore


def test_saved_files_are_listed_read_and_deleted(tmp_path):
    store = FileStore(tmp_path / "files")
    saved = store.save("plan", "licht-abends.md", "# Plan\n1. Licht prüfen\n")
    assert saved["kind"] == "plan" and saved["name"] == "licht-abends.md" and saved["size"] > 0
    [listed] = store.entries()
    assert listed["name"] == "licht-abends.md" and "modified" in listed
    assert store.read("plan", "licht-abends.md") == "# Plan\n1. Licht prüfen\n"
    store.delete("plan", "licht-abends.md")
    assert store.entries() == []


def test_permissions_are_private(tmp_path):
    store = FileStore(tmp_path / "files")
    store.save("script", "backup.sh", "echo hi\n")
    assert stat.S_IMODE((tmp_path / "files").stat().st_mode) == 0o700
    path = tmp_path / "files" / "script" / "backup.sh"
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert not os.access(path, os.X_OK)


@pytest.mark.parametrize("name", ["../x.md", "a/b.md", ".hidden.md", "x.exe", "", "a" * 90 + ".md",
                                  "plan.md/", "x\x00.md", "Plan Groß.md"])
def test_unsafe_names_are_rejected(tmp_path, name):
    with pytest.raises(FileError):
        FileStore(tmp_path / "files").save("plan", name, "x")


def test_unknown_kind_is_rejected(tmp_path):
    with pytest.raises(FileError):
        FileStore(tmp_path / "files").save("config", "x.md", "x")


def test_symlinks_are_neither_followed_nor_listed(tmp_path):
    store = FileStore(tmp_path / "files")
    store.save("plan", "a.md", "x")
    outside = tmp_path / "secret.md"
    outside.write_text("geheim")
    (tmp_path / "files" / "plan" / "link.md").symlink_to(outside)
    assert [item["name"] for item in store.entries()] == ["a.md"]
    with pytest.raises(FileError):
        store.read("plan", "link.md")
    with pytest.raises(FileError):
        store.save("plan", "link.md", "overwrite")
    with pytest.raises(FileError):
        store.delete("plan", "link.md")
    assert outside.read_text() == "geheim"


def test_size_and_count_limits(tmp_path):
    store = FileStore(tmp_path / "files", max_bytes=10, max_files=2)
    with pytest.raises(FileError):
        store.save("plan", "big.md", "x" * 11)
    store.save("plan", "a.md", "1")
    store.save("plan", "b.md", "2")
    store.save("plan", "a.md", "3")  # overwriting an existing file does not count as a new one
    with pytest.raises(FileError):
        store.save("plan", "c.md", "3")


def test_existing_names_get_a_suffix_unless_overwrite(tmp_path):
    store = FileStore(tmp_path / "files")
    store.save("plan", "a.md", "1")
    second = store.save("plan", "a.md", "2", overwrite=False)
    assert second["name"] == "a-2.md" and store.read("plan", "a.md") == "1"


def test_missing_file_gives_a_german_error(tmp_path):
    with pytest.raises(FileError, match="nicht gefunden"):
        FileStore(tmp_path / "files").read("plan", "nix.md")


def test_code_blocks_in_an_answer_are_extracted_as_scripts():
    from ha_safe_mcp.files import code_blocks
    answer = ("Hier die Automation:\n```yaml\nalias: Licht\n```\nund ein Skript:\n```bash\necho ok\n```\n"
              "```\nohne Sprache\n```")
    assert code_blocks(answer) == [("yaml", "alias: Licht\n"), ("sh", "echo ok\n"), ("txt", "ohne Sprache\n")]
