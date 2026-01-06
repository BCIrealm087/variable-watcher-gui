"""Simple mock serial generator for testing without hardware.

It writes synthetic payloads like `temp:21.5` to a loopback serial URL or
any provided port. Compatible with the extension's parser.
"""
from __future__ import annotations

import argparse
import random
import time

import serial


def main() -> None:
    parser = argparse.ArgumentParser(description="Mock serial data generator")
    parser.add_argument("--port", default="loop://", help="Serial port or pyserial URL (default: loop://)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: 115200)")
    parser.add_argument("--id", default="2", help="Variable id to emit")
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between frames")
    args = parser.parse_args()

    with serial.serial_for_url(args.port, args.baud, timeout=1) as ser:
        print(f"Writing mock data to {args.port} at {args.baud} baud…")
        while True:
            value = round(random.uniform(10, 40), 2)
            payload = f"{args.id}:{value}\n"
            ser.write(payload.encode())
            ser.flush()
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
