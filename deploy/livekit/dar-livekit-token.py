#!/usr/bin/env python3
"""Issue a LiveKit access token for the Dar test room (HS256, no dependencies)."""
import base64
import hashlib
import hmac
import json
import os
import sys
import time

ENV_PATH = os.environ.get("LIVEKIT_ENV", "/etc/dar/livekit.env")


def load_keys():
    keys = {}
    with open(ENV_PATH, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            keys[k.strip()] = v.strip()
    return keys["LIVEKIT_API_KEY"], keys["LIVEKIT_API_SECRET"]


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def main():
    if len(sys.argv) < 3:
        print("usage: dar-live-token ROOM IDENTITY [NAME] [TTL_HOURS]", file=sys.stderr)
        return 2
    room, identity = sys.argv[1], sys.argv[2]
    name = sys.argv[3] if len(sys.argv) > 3 else identity
    ttl_s = int(float(sys.argv[4]) * 3600) if len(sys.argv) > 4 else 6 * 3600
    key, secret = load_keys()
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": key,
        "sub": identity,
        "name": name,
        "nbf": now - 10,
        "exp": now + ttl_s,
        "video": {
            "roomJoin": True,
            "room": room,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
    }
    signing_input = b64(json.dumps(header, separators=(",", ":")).encode()) + "." + b64(
        json.dumps(payload, separators=(",", ":")).encode()
    )
    signature = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    print(signing_input + "." + b64(signature))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
