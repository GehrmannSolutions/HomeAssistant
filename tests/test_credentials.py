"""Local credential store: encrypted at rest, 0600, values never leave through the public view."""
import json
import os
import stat

import pytest

from ha_safe_mcp.credentials import CredentialError, CredentialStore, resolve_refs, scrub

SECRET = "s3cr3t-Pa55word!"


def make(tmp_path):
    return CredentialStore(tmp_path / "creds")


def test_empty_store_lists_nothing_and_creates_no_files(tmp_path):
    store = make(tmp_path)
    assert store.list_public() == []
    assert not (tmp_path / "creds").exists()


def test_saved_credential_is_encrypted_and_private(tmp_path):
    store = make(tmp_path)
    store.save("shelly_admin", "Shelly Geräte", {"username": "admin", "password": SECRET})
    data_file, key_file = store.data_path, store.key_path
    assert stat.S_IMODE(os.stat(tmp_path / "creds").st_mode) == 0o700
    assert stat.S_IMODE(data_file.stat().st_mode) == 0o600
    assert stat.S_IMODE(key_file.stat().st_mode) == 0o600
    raw = data_file.read_bytes()
    assert SECRET.encode() not in raw and b"admin" not in raw and b"shelly_admin" not in raw


def test_public_view_has_names_and_fields_but_never_values(tmp_path):
    store = make(tmp_path)
    store.save("shelly_login", "Shelly Geräte", {"username": "geheimer-nutzer", "password": SECRET})
    public = store.list_public()
    assert public == [{"alias": "shelly_login", "label": "Shelly Geräte", "fields": ["password", "username"],
                       "updated": public[0]["updated"]}]
    assert SECRET not in json.dumps(public) and "geheimer-nutzer" not in json.dumps(public)


def test_update_keeps_unchanged_fields_when_left_blank(tmp_path):
    store = make(tmp_path)
    store.save("shelly_admin", "Shelly", {"username": "admin", "password": SECRET})
    store.save("shelly_admin", "Shelly neu", {"username": "admin2", "password": ""})
    assert store.value("shelly_admin", "password") == SECRET
    assert store.value("shelly_admin", "username") == "admin2"
    assert store.list_public()[0]["label"] == "Shelly neu"


def test_delete_removes_credential(tmp_path):
    store = make(tmp_path)
    store.save("a_one", "A", {"password": SECRET})
    store.save("b_two", "B", {"password": "other-secret-1"})
    store.delete("a_one")
    assert [item["alias"] for item in store.list_public()] == ["b_two"]
    with pytest.raises(CredentialError):
        store.delete("a_one")


@pytest.mark.parametrize("alias, fields", [
    ("Shelly", {"password": "x"}), ("1abc", {"password": "x"}), ("a" * 65, {"password": "x"}),
    ("ok_alias", {}), ("ok_alias", {"Bad Field": "x"}), ("ok_alias", {"password": "x\ny"}),
    ("ok_alias", {"password": "x" * 5000}),
])
def test_invalid_input_is_rejected(tmp_path, alias, fields):
    with pytest.raises(CredentialError):
        make(tmp_path).save(alias, "Label", fields)


def test_new_credential_needs_every_field_value(tmp_path):
    with pytest.raises(CredentialError):
        make(tmp_path).save("fresh_one", "Neu", {"username": "admin", "password": ""})


def test_a_tampered_store_fails_closed(tmp_path):
    store = make(tmp_path)
    store.save("shelly_admin", "Shelly", {"password": SECRET})
    store.data_path.write_bytes(b"garbage")
    with pytest.raises(CredentialError):
        store.list_public()


def test_references_resolve_only_top_level_values(tmp_path):
    store = make(tmp_path)
    store.save("shelly_admin", "Shelly", {"username": "admin", "password": SECRET})
    resolved, used = resolve_refs(store, {
        "host": "10.0.0.5",
        "password": {"$credential": "shelly_admin", "field": "password"},
        "username": {"$credential": "shelly_admin", "field": "username"},
    })
    assert resolved == {"host": "10.0.0.5", "password": SECRET, "username": "admin"}
    assert used == {SECRET: "shelly_admin.password", "admin": "shelly_admin.username"}


@pytest.mark.parametrize("bad", [
    {"password": {"$credential": "missing", "field": "password"}},
    {"password": {"$credential": "shelly_admin", "field": "token"}},
    {"password": {"$credential": "shelly_admin"}},
])
def test_unknown_references_fail_without_leaking(tmp_path, bad):
    store = make(tmp_path)
    store.save("shelly_admin", "Shelly", {"password": SECRET})
    with pytest.raises(CredentialError) as info:
        resolve_refs(store, bad)
    assert SECRET not in str(info.value)


def test_scrub_replaces_secret_values_anywhere_in_a_result():
    used = {SECRET: "shelly_admin.password"}
    result = {"type": "form", "data_schema": [{"name": "password", "default": SECRET}],
              "errors": {"base": "invalid_auth"}, "note": f"tried {SECRET} twice"}
    clean = scrub(result, used)
    assert SECRET not in json.dumps(clean)
    assert clean["data_schema"][0]["default"] == "[credential:shelly_admin.password]"
    assert clean["note"] == "tried [credential:shelly_admin.password] twice"
