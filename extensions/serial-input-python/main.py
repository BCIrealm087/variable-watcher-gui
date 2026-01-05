#!/usr/bin/env python3
"""
Neutralino serial input Python extension.

This extension reads numeric values from a serial port and broadcasts
structured updates back to the Neutralino client. Commands are received
via Neutralino's extension dispatch events.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

try:
    import serial  # type: ignore
except ImportError as exc:  # pragma: no cover - runtime dependency
    raise SystemExit("pyserial is required. Run `pip install -r requirements.txt`.") from exc


EXTENSION_ID = os.environ.get("NL_EXTID", "serial-input-python")
DEFAULT_BAUDRATE = int(os.environ.get("SERIAL_BAUDRATE", "115200"))
DEFAULT_PORT = os.environ.get("SERIAL_PORT") or ""

# Neutralino passes the access token in the init payload. Store it once available.
_access_token: Optional[str] = os.environ.get("NL_TOKEN")
_outgoing_lock = threading.Lock()


@dataclass
class SerialState:
    port: str = DEFAULT_PORT
    baudrate: int = DEFAULT_BAUDRATE
    status: str = "idle"  # idle | connecting | connected | stopped | error
    last_error: Optional[str] = None
    last_value: Optional[Dict[str, Any]] = None
    last_seen: Optional[float] = None
    backoff_seconds: float = 1.0

    def to_health(self) -> Dict[str, Any]:
        return {
            "port": self.port,
            "baudrate": self.baudrate,
            "status": self.status,
            "lastError": self.last_error,
            "lastValue": self.last_value,
            "lastSeen": self.last_seen,
            "backoffSeconds": round(self.backoff_seconds, 3),
        }


_state = SerialState()
_stop_event = threading.Event()
_serial_thread: Optional[threading.Thread] = None


def log(msg: str) -> None:
    send_message({"method": "app.broadcast", "data": {"event": "serial:log", "data": msg}})


def send_message(payload: Dict[str, Any]) -> None:
    """Send a JSON payload to Neutralino over stdout."""
    with _outgoing_lock:
        sys.stdout.write(json.dumps(payload) + "\n")
        sys.stdout.flush()


def send_response(rpc_id: Any, result: Optional[Any] = None, error: Optional[Dict[str, Any]] = None) -> None:
    message: Dict[str, Any] = {"id": rpc_id, "success": error is None}
    if error:
        message["error"] = error
    if result is not None:
        message["data"] = result
    send_message(message)


def call_app(method: str, data: Dict[str, Any]) -> None:
    payload = {"method": method, "data": data}
    if _access_token:
        payload["accessToken"] = _access_token
    send_message(payload)


def broadcast(event: str, data: Any) -> None:
    call_app("app.broadcast", {"event": event, "data": data})


def parse_line(raw: bytes) -> Optional[Dict[str, Any]]:
    text = raw.decode(errors="ignore").strip()
    if not text:
        return None

    # Try JSON first
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and "id" in parsed and "value" in parsed:
            return {"id": str(parsed["id"]), "value": float(parsed["value"])}
    except json.JSONDecodeError:
        pass

    # Fallback: support "id:value" or "id,value" formats
    if ":" in text:
        parts = text.split(":", 1)
    else:
        parts = text.split(",", 1)

    if len(parts) == 2:
        try:
            return {"id": parts[0].strip(), "value": float(parts[1])}
        except ValueError:
            return None

    return None


def _reader_loop() -> None:
    global _state
    while not _stop_event.is_set():
        if not _state.port:
            _state.status = "error"
            _state.last_error = "No serial port configured"
            broadcast("serial:status", _state.to_health())
            time.sleep(1.0)
            continue

        try:
            _state.status = "connecting"
            broadcast("serial:status", _state.to_health())
            with serial.Serial(_state.port, _state.baudrate, timeout=1) as ser:
                _state.status = "connected"
                _state.last_error = None
                _state.backoff_seconds = 1.0
                broadcast("serial:status", _state.to_health())
                while not _stop_event.is_set():
                    raw = ser.readline()
                    if not raw:
                        continue
                    parsed = parse_line(raw)
                    if not parsed:
                        continue
                    parsed["timestamp"] = time.time()
                    _state.last_value = parsed
                    _state.last_seen = parsed["timestamp"]
                    broadcast("serial:update", parsed)
        except Exception as exc:  # pragma: no cover - hardware specific
            _state.status = "error"
            _state.last_error = str(exc)
            broadcast("serial:status", _state.to_health())
            time.sleep(_state.backoff_seconds)
            _state.backoff_seconds = min(_state.backoff_seconds * 1.5, 30.0)

    _state.status = "stopped"
    broadcast("serial:status", _state.to_health())


def ensure_thread_running() -> None:
    global _serial_thread
    if _serial_thread and _serial_thread.is_alive():
        return
    _stop_event.clear()
    _serial_thread = threading.Thread(target=_reader_loop, daemon=True)
    _serial_thread.start()


def handle_command(event: str, payload: Any) -> Dict[str, Any]:
    global _state
    if event == "start":
        if payload and isinstance(payload, dict):
            if payload.get("port"):
                _state.port = str(payload["port"])
            if payload.get("baudrate"):
                _state.baudrate = int(payload["baudrate"])
        ensure_thread_running()
        return {"ok": True, "status": _state.to_health()}

    if event == "stop":
        _stop_event.set()
        return {"ok": True, "status": _state.to_health()}

    if event == "configure":
        if not isinstance(payload, dict):
            raise ValueError("configure payload must be an object")
        _state.port = str(payload.get("port") or _state.port)
        if payload.get("baudrate"):
            _state.baudrate = int(payload["baudrate"])
        return {"ok": True, "status": _state.to_health()}

    if event == "health":
        return {"ok": True, "status": _state.to_health()}

    if event == "read":
        port = str(payload.get("port") or _state.port) if isinstance(payload, dict) else _state.port
        baud = int(payload.get("baudrate") or _state.baudrate) if isinstance(payload, dict) else _state.baudrate
        if not port:
            raise ValueError("No port configured")
        try:
            with serial.Serial(port, baud, timeout=2) as ser:
                raw = ser.readline()
                parsed = parse_line(raw)
                if not parsed:
                    raise ValueError("No parsable data")
                parsed["timestamp"] = time.time()
                return {"ok": True, "data": parsed}
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(str(exc))

    raise ValueError(f"Unknown event: {event}")


def handle_rpc(message: Dict[str, Any]) -> None:
    global _access_token
    method = message.get("method")
    rpc_id = message.get("id")

    # init payload captures the access token
    if method == "init":
        token = message.get("accessToken") or message.get("data", {}).get("accessToken")
        if token:
            _access_token = token
        send_response(rpc_id, {"ok": True, "extension": EXTENSION_ID})
        return

    if method != "extensions.dispatch":
        send_response(rpc_id, None, {"code": "unsupported_method", "message": str(method)})
        return

    try:
        payload = message.get("data", {})
        event = payload.get("event")
        data = payload.get("data")
        if not event:
            raise ValueError("Missing event in dispatch payload")
        result = handle_command(event, data)
        send_response(rpc_id, result)
    except Exception as exc:  # pragma: no cover - defensive
        send_response(rpc_id, None, {"code": "dispatch_error", "message": str(exc)})


def main() -> None:
    log(f"Starting extension {EXTENSION_ID}")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        handle_rpc(message)


if __name__ == "__main__":
    main()
