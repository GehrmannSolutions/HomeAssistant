"""Assist: voice pipelines, which entities voice assistants may use, and a recognise-only sentence test.

Sources (HA Core 2026.10): components/assist_pipeline/pipeline.py (storage collection
``assist_pipeline/pipeline/{list,create,update,delete,get,set_preferred}``; update needs every field),
components/homeassistant/exposed_entities.py (``homeassistant/expose_entity``, ``.../list``,
``homeassistant/expose_new_entities/{get,set}``; assistants conversation, cloud.alexa, cloud.google_assistant),
components/conversation/http.py (``conversation/agent/list``, ``conversation/agent/homeassistant/debug``).

Guardrails:
- the sentence test only recognises intents, it never runs them; free-form "tell Assist" (conversation/process) is
  deliberately missing because Assist would switch devices past this MCP's domain allowlist
- admin write for pipelines and exposure, delete level for deleting a pipeline; the preferred pipeline cannot be
  deleted (HA refuses too)
- exposure changes are journaled by the server with the previous value of every entity and assistant
"""
from __future__ import annotations

import re
from typing import Any

from .server import HAClient

ASSISTANTS = ("conversation", "cloud.alexa", "cloud.google_assistant")
PIPELINE_FIELDS = ("conversation_engine", "conversation_language", "language", "name", "stt_engine",
                   "stt_language", "tts_engine", "tts_language", "tts_voice", "wake_word_entity", "wake_word_id",
                   "prefer_local_intents", "acknowledge_media_id")
REQUIRED = PIPELINE_FIELDS[:11]
PIPELINE_ID = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$|^[0-9a-zA-Z_]{1,64}$")
ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
MAX_ENTITIES = 200


class HAAssist:
    def __init__(self, client: HAClient, ws, *, allow_admin_write: bool = False, allow_delete: bool = False):
        self.client, self.ws = client, ws
        self.allow_admin_write, self.allow_delete = allow_admin_write, allow_delete

    def _check_write(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")

    def _check_delete(self):
        self._check_write()
        if not self.allow_delete:
            raise ValueError("delete disabled; enable HA_ALLOW_DELETE")

    # ------------------------------------------------------------------ pipelines
    async def _pipelines(self) -> tuple[list[dict], str | None]:
        data = await self.ws.command("assist_pipeline/pipeline/list") or {}
        items = [p for p in data.get("pipelines") or [] if isinstance(p, dict)]
        return items, data.get("preferred_pipeline")

    async def pipeline(self, pipeline_id: str) -> dict | None:
        items, _ = await self._pipelines()
        return next((p for p in items if p.get("id") == pipeline_id), None)

    async def preferred(self) -> str | None:
        return (await self._pipelines())[1]

    async def list_pipelines(self) -> dict:
        items, preferred = await self._pipelines()
        try:
            agents = (await self.ws.command("conversation/agent/list") or {}).get("agents") or []
        except RuntimeError:
            agents = []
        return {"pipelines": [{**p, "preferred": p.get("id") == preferred} for p in items],
                "conversation_agents": [{"id": a.get("id"), "name": a.get("name"),
                                         "supported_languages": a.get("supported_languages")} for a in agents]}

    async def save_pipeline(self, pipeline_id: str | None, changes: dict) -> dict:
        """Create (pipeline_id None) or update a pipeline; unknown fields are refused, missing ones filled."""
        self._check_write()
        if not isinstance(changes, dict) or not changes:
            raise ValueError("changes: an object with pipeline fields such as name, language, tts_engine")
        extra = sorted(set(changes) - set(PIPELINE_FIELDS))
        if extra:
            raise ValueError(f"unknown pipeline fields: {', '.join(extra)}; allowed: {', '.join(PIPELINE_FIELDS)}")
        if pipeline_id is None:
            if not changes.get("name") or not changes.get("language"):
                raise ValueError("a new pipeline needs name and language")
            language = changes["language"]
            payload = {"conversation_engine": "conversation.home_assistant", "conversation_language": language,
                       "stt_engine": None, "stt_language": None, "tts_engine": None, "tts_language": None,
                       "tts_voice": None, "wake_word_entity": None, "wake_word_id": None, **changes}
            return await self.ws.command("assist_pipeline/pipeline/create", payload)
        if not isinstance(pipeline_id, str) or not PIPELINE_ID.fullmatch(pipeline_id):
            raise ValueError("invalid pipeline_id: use an id from ha_list_assist_pipelines")
        current = await self.pipeline(pipeline_id)
        if current is None:
            raise ValueError("unknown pipeline_id: use an id from ha_list_assist_pipelines")
        payload = {key: current.get(key) for key in REQUIRED}
        payload.update({key: current[key] for key in PIPELINE_FIELDS[11:] if current.get(key) is not None})
        payload.update(changes)
        return await self.ws.command("assist_pipeline/pipeline/update", {"pipeline_id": pipeline_id, **payload})

    async def delete_pipeline(self, pipeline_id: str) -> dict:
        self._check_delete()
        items, preferred = await self._pipelines()
        if not any(p.get("id") == pipeline_id for p in items):
            raise ValueError("unknown pipeline_id: use an id from ha_list_assist_pipelines")
        if pipeline_id == preferred:
            raise ValueError("this is the preferred pipeline; make another one preferred first "
                             "(ha_set_preferred_assist_pipeline)")
        await self.ws.command("assist_pipeline/pipeline/delete", {"pipeline_id": pipeline_id})
        return {"deleted": pipeline_id}

    async def set_preferred(self, pipeline_id: str) -> dict:
        self._check_write()
        if await self.pipeline(pipeline_id) is None:
            raise ValueError("unknown pipeline_id: use an id from ha_list_assist_pipelines")
        await self.ws.command("assist_pipeline/pipeline/set_preferred", {"pipeline_id": pipeline_id})
        return {"preferred": pipeline_id}

    # ------------------------------------------------------------------ exposure
    async def _exposed(self) -> dict:
        data = await self.ws.command("homeassistant/expose_entity/list") or {}
        return data.get("exposed_entities") or {}

    async def list_exposure(self) -> dict:
        exposed = await self._exposed()
        rules = {}
        for assistant in ASSISTANTS:
            try:
                rules[assistant] = (await self.ws.command("homeassistant/expose_new_entities/get",
                                                          {"assistant": assistant}) or {}).get("expose_new")
            except RuntimeError:
                rules[assistant] = None
        return {"exposed": {a: sorted(e for e, to in exposed.items() if to.get(a)) for a in ASSISTANTS},
                "expose_new_entities": rules,
                "note": "conversation = Assist (also local voice); cloud.* only matter with Home Assistant Cloud"}

    @staticmethod
    def _assistants(assistants) -> list[str]:
        assistants = assistants or ["conversation"]
        if not isinstance(assistants, list) or not set(assistants) <= set(ASSISTANTS):
            raise ValueError(f"assistants: any of {', '.join(ASSISTANTS)}")
        return assistants

    async def exposure_of(self, entity_ids: list[str], assistants=None) -> dict:
        assistants = self._assistants(assistants)
        exposed = await self._exposed()
        return {e: {a: bool((exposed.get(e) or {}).get(a)) for a in assistants} for e in entity_ids}

    async def set_exposure(self, entity_ids, should_expose: bool, assistants=None) -> dict:
        self._check_write()
        assistants = self._assistants(assistants)
        if isinstance(entity_ids, str):
            entity_ids = [entity_ids]
        if not isinstance(entity_ids, list) or not 0 < len(entity_ids) <= MAX_ENTITIES or not all(
                isinstance(e, str) and ENTITY_ID.fullmatch(e) for e in entity_ids):
            raise ValueError(f"entity_ids: 1-{MAX_ENTITIES} entity IDs")
        if not isinstance(should_expose, bool):
            raise ValueError("should_expose must be true or false")
        states = {s.get("entity_id") for s in await self.client._request("GET", "/api/states") or []
                  if isinstance(s, dict)}
        unknown = [e for e in entity_ids if e not in states]
        if unknown:
            raise ValueError(f"unknown entity: {', '.join(unknown[:10])}")
        before = await self.exposure_of(entity_ids, assistants)
        await self.ws.command("homeassistant/expose_entity", {"assistants": assistants, "entity_ids": entity_ids,
                                                              "should_expose": should_expose})
        changed = [e for e in entity_ids if any(v != should_expose for v in before[e].values())]
        return {"exposed" if should_expose else "hidden": entity_ids, "assistants": assistants, "changed": changed}

    async def restore_exposure(self, before: dict) -> dict:
        """Write back {entity_id: {assistant: bool}}, grouped into as few commands as possible."""
        self._check_write()
        groups: dict[tuple[str, bool], list[str]] = {}
        for entity_id, per in (before or {}).items():
            for assistant, value in per.items():
                groups.setdefault((assistant, bool(value)), []).append(entity_id)
        for (assistant, value), entity_ids in groups.items():
            await self.ws.command("homeassistant/expose_entity", {"assistants": [assistant],
                                                                  "entity_ids": entity_ids, "should_expose": value})
        return {"restored": sorted(before or {})}

    async def expose_new(self, assistant: str) -> bool | None:
        self._assistants([assistant])
        return (await self.ws.command("homeassistant/expose_new_entities/get", {"assistant": assistant}) or {}
                ).get("expose_new")

    async def set_expose_new(self, assistant: str, expose_new: bool) -> dict:
        self._check_write()
        self._assistants([assistant])
        if not isinstance(expose_new, bool):
            raise ValueError("expose_new must be true or false")
        await self.ws.command("homeassistant/expose_new_entities/set", {"assistant": assistant,
                                                                        "expose_new": expose_new})
        return {"assistant": assistant, "expose_new": expose_new}

    # ------------------------------------------------------------------ sentence test
    async def test_sentences(self, sentences, language: str = "") -> dict:
        if isinstance(sentences, str):
            sentences = [sentences]
        if not isinstance(sentences, list) or not 0 < len(sentences) <= 20 or not all(
                isinstance(s, str) and 0 < len(s) <= 300 for s in sentences):
            raise ValueError("sentences: 1-20 sentences of up to 300 characters")
        if language:
            languages = [language]
        else:
            # Assist understands a sentence only in the language it is spoken in: try the system language and
            # every pipeline language, report where it matched
            languages = []
            try:
                config = await self.client._request("GET", "/api/config")
                languages.append(config.get("language"))
            except (RuntimeError, AttributeError):
                pass
            try:
                languages += [p.get("language") for p in (await self._pipelines())[0]]
            except RuntimeError:
                pass
            languages = list(dict.fromkeys(x for x in languages if isinstance(x, str) and x)) or [""]
        results: list[Any] = [None] * len(sentences)
        tried = []
        for lang in languages[:4]:
            payload: dict[str, Any] = {"sentences": sentences}
            if lang:
                payload["language"] = lang
            data = await self.ws.command("conversation/agent/homeassistant/debug", payload) or {}
            tried.append(lang)
            for index, result in enumerate(data.get("results") or []):
                if index >= len(results) or not isinstance(result, dict):
                    continue
                current = results[index]
                if current is None or (not current.get("match") and result.get("match")):
                    results[index] = {**result, "matched_in_language" if result.get("match") else "checked_in_language": lang}
        return {"results": results, "sentences": sentences, "languages_tried": tried,
                "note": "recognised only, nothing was run; match false or null = Assist would not understand the "
                        "sentence in any of languages_tried; matched_in_language names the only language that matched"}
