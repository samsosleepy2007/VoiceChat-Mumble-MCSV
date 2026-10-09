"""Signed install license: binds the voice port and user limit to one MCSV server.

The website signs the license with a private key that never leaves the server
side; this module only holds the public key, so it can check a license but
cannot create one. A copy of the plugin on another server fails because the
license names a different Pelican server identifier.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

FORMAT = "sleepymumla-license-1"
PUBLIC_KEY_HEX = "56197d3070ef98e58220828fdf41e93f092d0f211a377c66fbdfb633aa14d73d"
MAX_USERS = 500


class LicenseError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class License:
    server: str
    port: int
    users: int
    issued: str


def license_message(server: str, port: int, users: int, issued: str) -> bytes:
    return (
        f"{FORMAT}\nserver={server}\nport={port}\nusers={users}\nissued={issued}\n"
    ).encode("utf-8")


# Ed25519 signature check (RFC 8032), pure Python so customer servers need no extra packages.
_P = 2**255 - 19
_L = 2**252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_SQRT_M1 = pow(2, (_P - 1) // 4, _P)


def _recover_x(y: int, sign: int) -> int | None:
    if y >= _P:
        return None
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P) % _P
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P:
        x = x * _SQRT_M1 % _P
    if (x * x - x2) % _P:
        return None
    if (x & 1) != sign:
        x = _P - x
    return x


def _point_add(a: tuple, b: tuple) -> tuple:
    p1 = (a[1] - a[0]) * (b[1] - b[0]) % _P
    p2 = (a[1] + a[0]) * (b[1] + b[0]) % _P
    p3 = 2 * a[3] * b[3] * _D % _P
    p4 = 2 * a[2] * b[2] % _P
    e, f, g, h = p2 - p1, p4 - p3, p4 + p3, p2 + p1
    return (e * f % _P, g * h % _P, f * g % _P, e * h % _P)


def _point_mul(scalar: int, point: tuple) -> tuple:
    result = (0, 1, 1, 0)
    while scalar > 0:
        if scalar & 1:
            result = _point_add(result, point)
        point = _point_add(point, point)
        scalar >>= 1
    return result


def _point_equal(a: tuple, b: tuple) -> bool:
    return (a[0] * b[2] - b[0] * a[2]) % _P == 0 and (a[1] * b[2] - b[1] * a[2]) % _P == 0


def _decompress(data: bytes) -> tuple | None:
    if len(data) != 32:
        return None
    y = int.from_bytes(data, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    if x is None:
        return None
    return (x, y, 1, x * y % _P)


_BASE_Y = 4 * pow(5, _P - 2, _P) % _P
_BASE_X = _recover_x(_BASE_Y, 0)
_BASE = (_BASE_X, _BASE_Y, 1, _BASE_X * _BASE_Y % _P)


def ed25519_verify(public: bytes, message: bytes, signature: bytes) -> bool:
    if len(public) != 32 or len(signature) != 64:
        return False
    key = _decompress(public)
    r_point = _decompress(signature[:32])
    if key is None or r_point is None:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= _L:
        return False
    h = int.from_bytes(hashlib.sha512(signature[:32] + public + message).digest(), "little") % _L
    return _point_equal(_point_mul(s, _BASE), _point_add(r_point, _point_mul(h, key)))


_SERVER = re.compile(r"^[0-9a-f]{8}$")


def parse_license(text: str, public_key_hex: str = PUBLIC_KEY_HEX) -> License:
    """Validate the file contents and signature; does not check which server runs it."""
    try:
        data = json.loads(text)
    except ValueError:
        raise LicenseError("malformed", "license.json is not valid JSON") from None
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        raise LicenseError("malformed", "license.json has an unknown format")
    server, port, users = data.get("server"), data.get("port"), data.get("users")
    issued, signature = data.get("issued"), data.get("signature")
    if (
        not isinstance(server, str) or not _SERVER.match(server)
        or type(port) is not int or not 1 <= port <= 65535
        or type(users) is not int or not 1 <= users <= MAX_USERS
        or not isinstance(issued, str) or not 0 < len(issued) <= 40 or "\n" in issued
        or not isinstance(signature, str) or len(signature) > 200
    ):
        raise LicenseError("malformed", "license.json has invalid fields")
    try:
        raw_signature = base64.b64decode(signature, validate=True)
        public = bytes.fromhex(public_key_hex)
    except ValueError:
        raise LicenseError("malformed", "license.json has an invalid signature encoding") from None
    if not ed25519_verify(public, license_message(server, port, users, issued), raw_signature):
        raise LicenseError("signature", "license.json signature is not valid")
    return License(server, port, users, issued)


def server_identity(env: dict | None = None) -> str:
    """The Pelican server identifier: first 8 hex chars of the container's server UUID."""
    value = str((os.environ if env is None else env).get("P_SERVER_UUID", "")).strip().lower()
    if not re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", value):
        raise LicenseError("no_identity", "this server does not report an MCSV server identity")
    return value[:8]


def load_license(path: Path, env: dict | None = None, public_key_hex: str = PUBLIC_KEY_HEX) -> License:
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        raise LicenseError("missing", "license.json was not found") from None
    except OSError:
        raise LicenseError("missing", "license.json could not be read") from None
    found = parse_license(text, public_key_hex)
    if found.server != server_identity(env):
        raise LicenseError("server_mismatch", "license.json belongs to a different server")
    return found
