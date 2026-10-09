"""Verify the plugin's license parsing/verification with an independent RFC 8032 signer."""
import base64
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("lic", ROOT / "src/endstone_mumble_host/license.py")
lic = importlib.util.module_from_spec(spec)
sys.modules["lic"] = lic
spec.loader.exec_module(lic)

# --- Independent Ed25519 signer (RFC 8032 reference style) ---
P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = -121665 * pow(121666, P - 2, P) % P
I = pow(2, (P - 1) // 4, P)


def _xrecover(y):
    xx = (y * y - 1) * pow(D * y * y + 1, P - 2, P)
    x = pow(xx, (P + 3) // 8, P)
    if (x * x - xx) % P != 0:
        x = x * I % P
    if x % 2 != 0:
        x = P - x
    return x


By = 4 * pow(5, P - 2, P) % P
Bx = _xrecover(By)
B = [Bx % P, By % P]


def _edwards(Pp, Q):
    x1, y1, x2, y2 = Pp[0], Pp[1], Q[0], Q[1]
    x3 = (x1 * y2 + x2 * y1) * pow(1 + D * x1 * x2 * y1 * y2, P - 2, P)
    y3 = (y1 * y2 + x1 * x2) * pow(1 - D * x1 * x2 * y1 * y2, P - 2, P)
    return [x3 % P, y3 % P]


def _scalarmult(Pp, e):
    if e == 0:
        return [0, 1]
    Q = _scalarmult(Pp, e // 2)
    Q = _edwards(Q, Q)
    if e & 1:
        Q = _edwards(Q, Pp)
    return Q


def _encodeint(y):
    return y.to_bytes(32, "little")


def _encodepoint(Pp):
    x, y = Pp[0], Pp[1]
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def _hint(m):
    return int.from_bytes(hashlib.sha512(m).digest(), "little")


def keypair(seed: bytes):
    h = hashlib.sha512(seed).digest()
    a = 2**254 + sum(2**i * ((h[i // 8] >> (i % 8)) & 1) for i in range(3, 254))
    public = _encodepoint(_scalarmult(B, a))
    return seed, public, a, h


def sign(seed: bytes, public: bytes, a: int, h: bytes, msg: bytes) -> bytes:
    r = _hint(h[32:] + msg)
    R = _scalarmult(B, r)
    S = (r + _hint(_encodepoint(R) + public + msg) * a) % L
    return _encodepoint(R) + _encodeint(S)


def make_license(seed, server="5fb3cecf", port=18655, users=99, issued="2026-10-09"):
    _, public, a, h = keypair(seed)
    msg = lic.license_message(server, port, users, issued)
    sig = sign(seed, public, a, h, msg)
    body = {"format": lic.FORMAT, "server": server, "port": port, "users": users,
            "issued": issued, "signature": base64.b64encode(sig).decode()}
    return json.dumps(body), public.hex()


seed = hashlib.sha256(b"test-seed").digest()[:32]
text, pub_hex = make_license(seed)

# Valid license parses and returns correct fields.
got = lic.parse_license(text, pub_hex)
assert (got.server, got.port, got.users, got.issued) == ("5fb3cecf", 18655, 99, "2026-10-09")

# Wrong public key is rejected.
other = hashlib.sha256(b"other").digest()[:32]
_, other_pub, _, _ = keypair(other)
try:
    lic.parse_license(text, other_pub.hex()); raise SystemExit("wrong key accepted")
except lic.LicenseError as e:
    assert e.code == "signature"

# Tampered field (port) breaks the signature.
tampered = json.loads(text); tampered["port"] = 19000
try:
    lic.parse_license(json.dumps(tampered), pub_hex); raise SystemExit("tampered accepted")
except lic.LicenseError as e:
    assert e.code == "signature"

# Malformed inputs.
for bad in ['not json', '{}', json.dumps({"format": "x"}),
            json.dumps({**json.loads(text), "users": 0}),
            json.dumps({**json.loads(text), "server": "ZZZZ"})]:
    try:
        lic.parse_license(bad, pub_hex); raise SystemExit("malformed accepted: " + bad[:20])
    except lic.LicenseError as e:
        assert e.code == "malformed"

# server_identity reads P_SERVER_UUID and returns the 8-char prefix.
env = {"P_SERVER_UUID": "5fb3cecf-9cb9-428b-9053-9fb65a47b5df"}
assert lic.server_identity(env) == "5fb3cecf"
try:
    lic.server_identity({}); raise SystemExit("missing identity accepted")
except lic.LicenseError as e:
    assert e.code == "no_identity"

# load_license enforces the server match.
with tempfile.TemporaryDirectory() as d:
    path = Path(d) / "license.json"; path.write_text(text)
    assert lic.load_license(path, env, pub_hex).users == 99
    try:
        lic.load_license(path, {"P_SERVER_UUID": "11111111-9cb9-428b-9053-9fb65a47b5df"}, pub_hex)
        raise SystemExit("server mismatch accepted")
    except lic.LicenseError as e:
        assert e.code == "server_mismatch"
    try:
        lic.load_license(Path(d) / "nope.json", env, pub_hex); raise SystemExit("missing file accepted")
    except lic.LicenseError as e:
        assert e.code == "missing"

print("MumbleHost license verification: OK")
