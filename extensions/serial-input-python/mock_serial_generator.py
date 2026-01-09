#!/usr/bin/env python3
"""
Mock PM100-style serial generator over TCP for pyserial socket://.

Sends lines like:
  0068 00AF 1234 ... \r\n
(4 hex chars per 16-bit word, space-delimited, CRLF terminated)
"""
from __future__ import annotations

import argparse
import json
import random
import socket
import time
from typing import Any


def make_pm100_line(values: list[int], trailing_space: bool = False) -> bytes:
    # Convert each value to a 16-bit word (two's complement if negative)
    words = [(v & 0xFFFF) for v in values]
    line = " ".join(f"{w:04X}" for w in words)
    if trailing_space:
        line += " "
    line += "\r\n"
    return line.encode("ascii")


def main() -> None:
    parser = argparse.ArgumentParser(description="Mock PM100 hex-word stream over TCP (pyserial socket://)")
    parser.add_argument("--host", default="127.0.0.1", help="TCP host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=7000, help="TCP port (default: 7000)")

    # Baud isn't used for TCP, but kept so your CLI stays familiar
    parser.add_argument("--baud", type=int, default=57600, help="(Unused for TCP) (default: 57600)")

    parser.add_argument("--n", type=int, default=4, help="How many 16-bit words per line (default: 20)")
    parser.add_argument("--cfile", type=str, default="./vars.json", help="Vars config file (default: ./vars.json)")
    parser.add_argument("--dmin", type=int, default=0, help="Default min (can be negative)")
    parser.add_argument("--dmax", type=int, default=65535, help="Default max")
    parser.add_argument("--interval", type=float, default=0.05, help="Seconds between lines")
    parser.add_argument("--rinterval", type=float, default=0.5, help="Seconds between restart attempts")
    parser.add_argument("--trailing-space", action="store_true", help="Add a trailing space before CRLF")
    args = parser.parse_args()

    while True:
        try:
            # Load optional per-index min/max overrides
            var_config: dict[int, dict[str, Any]] = {
                i: {"min": args.dmin, "max": args.dmax} for i in range(args.n)
            }

            try:
                with open(args.cfile, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if not isinstance(data, list):
                    raise ValueError("vars.json must be a list")

                for var in data:
                    if not isinstance(var, dict) or "id" not in var:
                        continue
                    idx = int(var["id"])
                    if idx in var_config:
                        # accept keys like {"id": 3, "min": -100, "max": 100}
                        if "min" in var:
                            var_config[idx]["min"] = int(var["min"])
                        if "max" in var:
                            var_config[idx]["max"] = int(var["max"])
            except FileNotFoundError:
                # No config file is fine; defaults will be used
                pass

            with socket.create_server((args.host, args.port)) as srv:
                srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                print(f"TCP mock PM100 server listening on {args.host}:{args.port} (n={args.n})")

                conn, addr = srv.accept()
                print("Client connected:", addr)

                with conn:
                    while True:
                        values = [
                            random.randint(var_config[i]["min"], var_config[i]["max"])
                            for i in range(args.n)
                        ]
                        conn.sendall(make_pm100_line(values, trailing_space=args.trailing_space))
                        time.sleep(args.interval)

        except Exception as e:
            print("Error:", e)
            print(f"Restarting in {args.rinterval}...")
            time.sleep(args.rinterval)


if __name__ == "__main__":
    main()
