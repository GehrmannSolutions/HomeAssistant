"""Assist: pipelines, entity exposure to voice assistants, sentence test (HA assist_pipeline, exposed_entities)."""
import pytest

from ha_safe_mcp.assist import HAAssist
from ha_safe_mcp.server import HAClient

URL = "http://ha:8123"
FIELDS = {"conversation_engine": "conversation.home_assistant", "conversation_language": "de", "language": "de",
          "name": "Home Assistant", "stt_engine": None, "stt_language": None, "tts_engine": "tts.google_en_com",
          "tts_language": "de", "tts_voice": None, "wake_word_entity": None, "wake_word_id": None,
          "prefer_local_intents": False}


class FakeWS:
    def __init__(self):
        self.pipelines = {"01AAA": {"id": "01AAA", **FIELDS}}
        self.preferred = "01AAA"
        self.exposed = {"light.flur": {"conversation": True}}
        self.expose_new = {"conversation": False, "cloud.alexa": False, "cloud.google_assistant": False}
        self.calls = []
        self.counter = 0

    async def command(self, kind, payload=None):
        payload = payload or {}
        self.calls.append((kind, payload))
        if kind == "assist_pipeline/pipeline/list":
            return {"pipelines": [dict(p) for p in self.pipelines.values()], "preferred_pipeline": self.preferred}
        if kind == "assist_pipeline/pipeline/create":
            self.counter += 1
            item = {"id": f"01NEW{self.counter}", **payload}
            self.pipelines[item["id"]] = item
            return dict(item)
        if kind == "assist_pipeline/pipeline/update":
            data = {k: v for k, v in payload.items() if k != "pipeline_id"}
            assert set(FIELDS) - {"prefer_local_intents"} <= data.keys(), "update needs every field"
            self.pipelines[payload["pipeline_id"]].update(data)
            return dict(self.pipelines[payload["pipeline_id"]])
        if kind == "assist_pipeline/pipeline/delete":
            if payload["pipeline_id"] == self.preferred:
                raise RuntimeError("Home Assistant WebSocket error: not_allowed")
            del self.pipelines[payload["pipeline_id"]]
            return None
        if kind == "assist_pipeline/pipeline/set_preferred":
            self.preferred = payload["pipeline_id"]
            return None
        if kind == "conversation/agent/list":
            return {"agents": [{"id": "conversation.home_assistant", "name": "Home Assistant",
                                "supported_languages": ["de", "en"]}]}
        if kind == "homeassistant/expose_entity/list":
            return {"exposed_entities": {k: dict(v) for k, v in self.exposed.items() if any(v.values())}}
        if kind == "homeassistant/expose_entity":
            for entity_id in payload["entity_ids"]:
                for assistant in payload["assistants"]:
                    self.exposed.setdefault(entity_id, {})[assistant] = payload["should_expose"]
            return None
        if kind == "homeassistant/expose_new_entities/get":
            return {"expose_new": self.expose_new[payload["assistant"]]}
        if kind == "homeassistant/expose_new_entities/set":
            self.expose_new[payload["assistant"]] = payload["expose_new"]
            return None
        if kind == "conversation/agent/homeassistant/debug":
            words = {"de": "licht", "en": "light"}.get(payload.get("language"), "licht")
            return {"results": [{"match": True, "intent": {"name": "HassTurnOn"},
                                 "targets": {"light.flur": {"matched": True}}} if words in s.lower() else None
                                for s in payload["sentences"]]}
        raise AssertionError(kind)


class FakeClient(HAClient):
    async def _request(self, method, path, **kwargs):
        if path == "/api/config":
            return {"language": "de"}
        assert path == "/api/states"
        return [{"entity_id": "light.flur", "state": "on", "attributes": {}},
                {"entity_id": "switch.plug", "state": "off", "attributes": {}}]


def make(ws, *, admin=True, delete=False):
    return HAAssist(FakeClient(URL, "t", allow_write=True), ws, allow_admin_write=admin, allow_delete=delete)


async def test_pipelines_list_marks_the_preferred_one_and_lists_agents():
    result = await make(FakeWS()).list_pipelines()
    assert result["pipelines"][0]["preferred"] is True and result["pipelines"][0]["name"] == "Home Assistant"
    assert result["conversation_agents"][0]["id"] == "conversation.home_assistant"


async def test_create_fills_defaults_and_update_sends_every_field():
    ws = FakeWS()
    assist = make(ws)
    created = await assist.save_pipeline(None, {"name": "English", "language": "en"})
    assert created["name"] == "English" and created["conversation_language"] == "en"
    assert created["conversation_engine"] == "conversation.home_assistant" and created["tts_engine"] is None
    updated = await assist.save_pipeline("01AAA", {"tts_voice": "de-DE-x"})
    assert updated["tts_voice"] == "de-DE-x" and updated["name"] == "Home Assistant"
    with pytest.raises(ValueError, match="unknown"):
        await assist.save_pipeline("01AAA", {"evil": 1})
    with pytest.raises(ValueError, match="pipeline_id"):
        await assist.save_pipeline("nope", {"name": "x"})


async def test_pipeline_writes_need_the_right_level():
    with pytest.raises(ValueError, match="admin write"):
        await make(FakeWS(), admin=False).save_pipeline(None, {"name": "x", "language": "en"})
    with pytest.raises(ValueError, match="delete"):
        await make(FakeWS()).delete_pipeline("01AAA")


async def test_preferred_pipeline_cannot_be_deleted_and_can_be_switched():
    ws = FakeWS()
    assist = make(ws, delete=True)
    with pytest.raises(ValueError, match="preferred"):
        await assist.delete_pipeline("01AAA")
    other = await assist.save_pipeline(None, {"name": "B", "language": "en"})
    await assist.set_preferred(other["id"])
    assert ws.preferred == other["id"]
    await assist.delete_pipeline("01AAA")
    assert "01AAA" not in ws.pipelines


async def test_exposure_lists_per_assistant_and_new_entity_rule():
    result = await make(FakeWS()).list_exposure()
    assert result["exposed"]["conversation"] == ["light.flur"]
    assert result["exposed"]["cloud.alexa"] == []
    assert result["expose_new_entities"] == {"conversation": False, "cloud.alexa": False,
                                             "cloud.google_assistant": False}


async def test_set_exposure_checks_entities_and_assistants_and_returns_before():
    ws = FakeWS()
    assist = make(ws)
    result = await assist.set_exposure(["switch.plug", "light.flur"], True, ["conversation"])
    assert ws.exposed["switch.plug"]["conversation"] is True
    assert result["changed"] == ["switch.plug"]
    with pytest.raises(ValueError, match="assistant"):
        await assist.set_exposure(["switch.plug"], True, ["siri"])
    with pytest.raises(ValueError, match="unknown entity"):
        await assist.set_exposure(["light.ghost"], True)
    assert (await assist.exposure_of(["switch.plug", "light.flur"], ["conversation"])) == {
        "switch.plug": {"conversation": True}, "light.flur": {"conversation": True}}


async def test_restore_exposure_puts_each_value_back():
    ws = FakeWS()
    assist = make(ws)
    before = await assist.exposure_of(["switch.plug", "light.flur"], ["conversation"])
    await assist.set_exposure(["switch.plug", "light.flur"], False, ["conversation"])
    await assist.restore_exposure(before)
    assert ws.exposed["light.flur"]["conversation"] is True and ws.exposed["switch.plug"]["conversation"] is False


async def test_expose_new_entities_rule():
    ws = FakeWS()
    await make(ws).set_expose_new("conversation", True)
    assert ws.expose_new["conversation"] is True


async def test_sentence_test_only_recognises():
    ws = FakeWS()
    result = await make(ws, admin=False).test_sentences(["Licht im Flur an", "Wie spät ist es"], "de")
    assert result["results"][0]["match"] is True and result["results"][1] is None
    assert [kind for kind, _ in ws.calls] == ["conversation/agent/homeassistant/debug"]


async def test_sentence_test_without_language_tries_system_and_pipeline_languages():
    ws = FakeWS()
    ws.pipelines["01BBB"] = {"id": "01BBB", **FIELDS, "language": "en"}
    result = await make(ws, admin=False).test_sentences(["turn on the light", "Licht an", "what time is it"])
    assert result["languages_tried"] == ["de", "en"]
    assert result["results"][0]["matched_in_language"] == "en" and result["results"][1]["matched_in_language"] == "de"
    assert result["results"][2] is None
    assert all(kind != "conversation/process" for kind, _ in ws.calls)
    with pytest.raises(ValueError):
        await make(ws).test_sentences([], "de")


def test_assist_tools_levels():
    from ha_safe_mcp.ollama_client import write_level
    assert write_level("ha_list_assist_pipelines") is None and write_level("ha_test_assist_sentences") is None
    assert write_level("ha_save_assist_pipeline") == "admin" and write_level("ha_set_exposure") == "admin"
    assert write_level("ha_delete_assist_pipeline") == "delete"
