# Contributing to Home Assistant projects

Thanks for improving the reusable tooling. The [MIT license](LICENSE) applies to source and documentation submitted here. Please make changes in the project's own subdirectory (`ha-safe-mcp/`); do not submit an export of your Home Assistant installation.

## Before sharing a patch

- **No secrets or household data:** never include `.env`, long-lived access tokens, passwords, key files, real entity/device IDs, serials, MAC addresses, private addresses, hostnames, log excerpts, camera images, or config exports. Use `example.com`, documentation-only IP ranges (`192.0.2.0/24`) and fictional entity IDs for examples. Review the **full diff and untracked files**, not only a quick keyword search.
- State which Home Assistant Core version you tested if changing version-sensitive configuration tools. Test first against a disposable instance, never a production home.
- Do not add arbitrary HTTP/WS proxy capabilities to bypass the fixed catalog. For a new write tool, document its effect, permission class, validation, failure mode, and read-back limitations.
- The UI and its error messages are currently German; changes to localization should be explicit rather than silently mixing strings.

## Local checks

From `ha-safe-mcp/`:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
.venv/bin/python -m pytest -q
.venv/bin/python scripts/gen_tool_reference.py --check
```

The tool table in `docs/TOOLS.md` is generated from the registered MCP tool schemas; after adding/editing tools, regenerate with `.venv/bin/python scripts/gen_tool_reference.py` and include the generated change. Update the [user guide](ha-safe-mcp/docs/USER_GUIDE.md) and [technical docs](ha-safe-mcp/docs/TECHNICAL.md) for behavior or security changes. For stronger testing see the [testing section](ha-safe-mcp/docs/TECHNICAL.md#tests-verification-and-limitations).

## Security reports

Please do **not** put tokens, private HA data, or exploit details that affect a real household in a public issue. Contact the repository maintainers through a private channel or use GitHub's private vulnerability reporting if enabled for this repository. Revoke/rotate exposed HA tokens through Home Assistant. Do not run reproduction steps against someone else's installation.
