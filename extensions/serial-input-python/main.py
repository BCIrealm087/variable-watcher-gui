#!/usr/bin/env python3
"""
Neutralino serial input Python extension.

This extension reads numeric values from a serial port and broadcasts
structured updates back to the Neutralino client. Commands are received
via Neutralino's extension dispatch events.
"""
from __future__ import annotations

import json, uuid
import os
import sys
import threading
import time
import asyncio
from dataclasses import dataclass
from operator import itemgetter
from typing import Any, Dict, Optional
from collections.abc import Callable

try:
    import serial  # type: ignore
except ImportError as exc:  # pragma: no cover - runtime dependency
    raise SystemExit("pyserial is required. Run `pip install -r requirements.txt`.") from exc

try:
    import websockets  # type: ignore
except ImportError as exc:  # pragma: no cover - runtime dependency
    raise SystemExit("websockets is required. Run `pip install -r requirements.txt`.") from exc

EXTENSION_ID = os.environ.get("NL_EXTID", "serial-input-python")
DEFAULT_BAUDRATE = int(os.environ.get("SERIAL_BAUDRATE", "57600"))
DEFAULT_PORT = os.environ.get("SERIAL_PORT") or ""

# Neutralino passes the connection info in the init payload. Store it once available.
_port: Optional[str]
_token: Optional[str]
_connect_token: Optional[str]
_extension_id: Optional[str]
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

_broadcast_method_label = "app.broadcast"

def log(msg: str) -> None:
    send_message_stdout({"method": _broadcast_method_label, "data": {"event": "serial:log", "data": msg}})

def send_message_stdout(payload: Dict[str, Any]) -> None:
    """Send a JSON payload to Neutralino over stdout."""
    with _outgoing_lock:
        sys.stdout.write(json.dumps(payload) + "\n")
        sys.stdout.flush()

def parse_pm100_line(raw: bytes) -> Optional[Dict[str, Any]]:
    """
    PM100 stream format (per manual):
      - Each value is a 16-bit word transmitted as 4 ASCII hex chars (nibbles)
      - Each word is followed by a space delimiter
      - A full set ends with CRLF

    Returns:
      {"values": {"0": word0, "1": word1, ...}}
      where each word is an int in [0, 65535]
    """
    # raw likely includes b"...\r\n"
    text = raw.decode("ascii", errors="ignore").strip()
    if not text:
        return None

    parts = text.split()
    if not parts:
        return None

    # Fallback: if nibbles are separated as single chars ("0 0 6 8 ..."),
    # group every 4 into one word.
    if all(len(p) == 1 for p in parts):
        if len(parts) % 4 != 0:
            return None
        parts = ["".join(parts[i:i+4]) for i in range(0, len(parts), 4)]

    words: list[int] = []
    for p in parts:
        token = p.strip()

        # If something weird slips in, try to salvage last 4 hex chars.
        if len(token) < 4:
            return None
        if len(token) > 4:
            token = token[-4:]

        try:
            words.append(int(token, 16))
        except ValueError:
            return None

    return {"values": {str(i): w for i, w in enumerate(words)}}

def open_serial(port: str, baud: int, timeout: float = 1):
    # pySerial URL handlers contain "://": loop://, socket://, rfc2217://, etc.
    if "://" in port:
        return serial.serial_for_url(port, baudrate=baud, timeout=timeout)
    return serial.Serial(port, baudrate=baud, timeout=timeout)

def _reader_loop(broadcast_fn: Callable[[str, Any], asyncio.Handle]) -> None:
    global _state
    while not _stop_event.is_set():
        if not _state.port:
            _state.status = "error"
            _state.last_error = "No serial port configured"
            broadcast_fn("serial:status", _state.to_health())
            time.sleep(1.0)
            continue

        try:
            _state.status = "connecting"
            broadcast_fn("serial:status", _state.to_health())
            with open_serial(_state.port, _state.baudrate, timeout=1) as ser:
                _state.status = "connected"
                _state.last_error = None
                _state.backoff_seconds = 1.0
                broadcast_fn("serial:status", _state.to_health())
                while not _stop_event.is_set():
                    raw = ser.readline()
                    if not raw:
                        continue
                    parsed = parse_pm100_line(raw)
                    if not parsed:
                        continue
                    parsed["timestamp"] = time.time()
                    _state.last_value = parsed
                    _state.last_seen = parsed["timestamp"]
                    broadcast_fn("serial:update", parsed)
        except Exception as exc:  # pragma: no cover - hardware specific
            _state.status = "error"
            _state.last_error = str(exc)
            broadcast_fn("serial:status", _state.to_health())
            time.sleep(_state.backoff_seconds)
            _state.backoff_seconds = min(_state.backoff_seconds * 1.5, 30.0)

    _state.status = "stopped"
    broadcast_fn("serial:status", _state.to_health())

def ensure_thread_running(broadcast_fn: Callable[[str, Any], asyncio.Handle]) -> None:
    global _serial_thread
    if _serial_thread and _serial_thread.is_alive():
        return
    _stop_event.clear()
    _serial_thread = threading.Thread(target=_reader_loop, args=(broadcast_fn,), daemon=True)
    _serial_thread.start()

def loadInitData(message: Dict[str, Any]) -> None:
    global _port, _token, _connect_token, _extension_id
    initDataKeys = ["nlPort", "nlToken", "nlConnectToken", "nlExtensionId"]
    if not isinstance(message, dict):
        log(f"Missing or incorrectly typed data received during initialization of extension {EXTENSION_ID}")
        return
    _port, _token, _connect_token, _extension_id \
      = itemgetter(*initDataKeys)(message)
    firstMissing: tuple[str, str | None]
    if any((not (firstMissing := i)[1]) for i in zip(initDataKeys, [_port, _token, _connect_token, _extension_id])):
      raise ValueError(f"During initialization of extension {EXTENSION_ID}: no valid value for {firstMissing} was provided")
    log(f"Init data for extension {EXTENSION_ID} loaded succesfuly")

async def receiver(
    ws: websockets.ClientConnection, 
    onMsgReceived: Callable[[websockets.Data, Callable[[str, Any], asyncio.Handle]], None], 
    broadcast_fn: Callable[[str, Any], asyncio.Handle]
):
    async for msg in ws:   # ends if connection closes
        onMsgReceived(msg, broadcast_fn)

async def sender(ws: websockets.ClientConnection, out_q: asyncio.Queue):
    while True:
        msg = await out_q.get()
        await ws.send(msg)

async def wsClient(
    onMsgReceived: Callable[[websockets.Data, Callable[[str, Any], asyncio.Handle]], None], 
    workers: Optional[list[Callable[[Callable[[str, Any], asyncio.Handle]], None]]] = None
) -> None:
    uri = f"ws://localhost:{_port}?extensionId={_extension_id}&connectToken={_connect_token}"
    out_q: asyncio.Queue[str] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    broadcast_fn: Callable[[str, Any], asyncio.Handle] \
      = lambda event, data: loop.call_soon_threadsafe(
          out_q.put_nowait, json.dumps(
              {
                "id": str(uuid.uuid4()),
                "method": _broadcast_method_label, 
                "accessToken": _token, 
                "data": {"event": event, "data": data}
              }
          )
        )
    if workers:
      threads = [
              threading.Thread(target=worker, args=(broadcast_fn,), daemon=True)
              for worker in workers
          ]
      for t in threads:
          t.start()
    log(f"{EXTENSION_ID} establishing ws connection through `{uri}`")
    async with websockets.connect(uri) as ws:
        send_task = asyncio.create_task(sender(ws, out_q))
        await receiver(ws, onMsgReceived, broadcast_fn)
        send_task.cancel()

def handle_command(event: str, data: Any, broadcast_fn: Callable[[str, Any], asyncio.Handle]) -> Dict[str, Any]:
    global _state
    if event == "start":
        if data and isinstance(data, dict):
            if data.get("port"):
                _state.port = str(data["port"])
            if data.get("baudrate"):
                _state.baudrate = int(data["baudrate"])
        ensure_thread_running(broadcast_fn)
        return {"ok": True, "status": _state.to_health()}

    if event == "stop":
        _stop_event.set()
        return {"ok": True, "status": _state.to_health()}

    if event == "configure":
        if not isinstance(data, dict):
            raise ValueError("configure payload must be an object")
        _state.port = str(data.get("port") or _state.port)
        if data.get("baudrate"):
            _state.baudrate = int(data["baudrate"])
        return {"ok": True, "status": _state.to_health()}

    if event == "health":
        return {"ok": True, "status": _state.to_health()}

    return {"ok": False, "status": _state.to_health()}
    # unknown event: ignore

def handle_message(data: Any, broadcast_fn: Callable[[str, Any], asyncio.Handle]):
    try:
        message = json.loads(data)
    except json.JSONDecodeError:
        return
    try:
        event = message["event"]
        event_data = message["data"]
    except:
        return
    if event:
      response = handle_command(event, event_data, broadcast_fn)
      send_message_stdout(response)

def main() -> None:
    log(f"Starting extension {EXTENSION_ID}")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
            loadInitData(message)
            asyncio.run(wsClient(
                handle_message
            ))
        except json.JSONDecodeError:
            continue

if __name__ == "__main__":
    main()
