import contextlib
import inspect
import json
import sys
import uuid
from typing import Any


def write_response(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")


def compact_value(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [compact_value(item) for item in value]
    if isinstance(value, tuple):
        return [compact_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): compact_value(item) for key, item in value.items()}
    return value


async def maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def response_text(value: Any) -> str:
    compacted = compact_value(value)
    if isinstance(compacted, list):
        texts: list[str] = []
        for item in compacted:
            if isinstance(item, dict):
                for key in ("text", "answer", "content", "chunk", "data"):
                    field = item.get(key)
                    if isinstance(field, str) and field.strip():
                        texts.append(field.strip())
                        break
                else:
                    texts.append(json.dumps(item, ensure_ascii=False, default=str))
            else:
                texts.append(str(item))
        return "\n".join(texts)
    return str(compacted)


async def main() -> None:
    request = json.loads(sys.stdin.read() or "{}")
    action = request.get("action")

    with contextlib.redirect_stdout(sys.stderr):
        import cognee

    if action == "health":
        write_response({"ok": True, "version": getattr(cognee, "__version__", "unknown")})
        return

    if action == "remember":
        data = str(request.get("data") or "").strip()
        if not data:
            write_response({"ok": True, "skipped": "empty"})
            return
        session_id = request.get("session_id")
        if session_id:
            from cognee.infrastructure.session.get_session_manager import get_session_manager
            from cognee.modules.users.methods import get_default_user

            user = await maybe_await(get_default_user())
            user_id = str(user.id) if user and hasattr(user, "id") else ""
            if not user_id:
                raise RuntimeError("Cognee default user is unavailable")
            manager = get_session_manager()
            if not manager.is_available:
                raise RuntimeError("Cognee session cache is unavailable")
            qa_id = str(uuid.uuid4())
            await maybe_await(
                manager._cache.create_qa_entry(
                    user_id=user_id,
                    session_id=str(session_id),
                    qa_id=qa_id,
                    question="",
                    context="",
                    answer=data,
                    feedback_text=None,
                    feedback_score=None,
                    used_graph_element_ids=None,
                    used_session_context_ids=None,
                )
            )
            result = {"status": "session_stored", "qa_id": qa_id, "session_id": session_id}
        else:
            result = await maybe_await(
                cognee.remember(
                    data,
                    dataset_name=str(request.get("dataset") or "main_dataset"),
                    run_in_background=False,
                    self_improvement=False,
                )
            )
        write_response({"ok": True, "result": compact_value(result)})
        return

    if action == "recall":
        query = str(request.get("query") or "").strip()
        if not query:
            write_response({"ok": True, "text": "", "items": []})
            return
        recall_kwargs: dict[str, Any] = {
            "query_text": query,
            "top_k": int(request.get("top_k") or 5),
            "session_id": request.get("session_id"),
            "scope": ["session"] if request.get("session_id") else None,
        }
        if not recall_kwargs["session_id"]:
            recall_kwargs["datasets"] = [str(request.get("dataset") or "main_dataset")]
        result = await maybe_await(cognee.recall(**recall_kwargs))
        write_response({"ok": True, "text": response_text(result), "items": compact_value(result)})
        return

    write_response({"ok": False, "error": f"unsupported action: {action}"})


if __name__ == "__main__":
    import asyncio
    import os

    try:
        asyncio.run(main())
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(0)
    except Exception as error:
        write_response({"ok": False, "error": f"{type(error).__name__}: {error}"})
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)
