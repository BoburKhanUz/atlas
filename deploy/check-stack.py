#!/usr/bin/env python3
"""Checks a running Lookly stack through its front door (Caddy), as a phone and a
browser reach it: the routing (/api/* to Go, the rest to the website), the security
headers on both, and one journey that needs every part (the database and its
schema, the image volume, the worker).

  python3 -I deploy/check-stack.py [base URL] [--outbox-volume NAME] [--remote]

The base URL defaults to http://127.0.0.1:3000 (docker-compose.yml). With
--outbox-volume (a development stack, whose reset mails are files in that volume)
it also waits for the worker to write the reset mail; without it the worker is
not checked. Standard library only; it prints what it checked and exits 1 at the
first failure.

It creates one test account with one wardrobe item and deletes it again (also
after a failure, when it can). An address other than this machine needs
--remote: never point it at production, and on a stack whose AI is switched on
its one upload is one paid clothing analysis (owner approval, CLAUDE.md rule 4).
"""

import json
import os
import urllib.parse
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PICTURE = os.path.join(ROOT, "apps/api/testdata/images/deep.png")  # 300x300 PNG
MOBILE = {"X-Atlas-Client": "mobile"}


class Failed(Exception):
    pass


def request(base, method, path, body=None, headers=None, raw=None, content_type=None):
    data = raw
    hdrs = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    if content_type:
        hdrs["Content-Type"] = content_type
    url = path if path.startswith("http") else base + path
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read()
    except urllib.error.HTTPError as err:
        return err.code, {k.lower(): v for k, v in err.headers.items()}, err.read()


def expect(cond, what):
    if not cond:
        raise Failed(what)
    print(f"ok  {what}")


def headers_of(name, hdrs, *, frame_csp=True):
    expect(hdrs.get("x-content-type-options") == "nosniff", f"{name}: X-Content-Type-Options nosniff")
    expect(hdrs.get("x-frame-options") == "DENY", f"{name}: X-Frame-Options DENY")
    if frame_csp:
        expect(hdrs.get("content-security-policy") == "frame-ancestors 'none'", f"{name}: CSP frame-ancestors 'none'")
    expect("x-powered-by" not in hdrs, f"{name}: no X-Powered-By")
    expect(hdrs.get("strict-transport-security", "").startswith("max-age="), f"{name}: Strict-Transport-Security (Caddy)")


def multipart(field, filename, mime, content):
    boundary = uuid.uuid4().hex
    head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n").encode()
    return head + content + f"\r\n--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def outbox_files(volume):
    out = subprocess.run(["docker", "run", "--rm", "-v", f"{volume}:/outbox:ro", "postgres:16-alpine", "ls", "/outbox"],
                         capture_output=True, text=True, check=True)
    return [line for line in out.stdout.split() if line]


def main(argv):
    base = "http://127.0.0.1:3000"
    volume = None
    remote = False
    args = list(argv)
    while args:
        a = args.pop(0)
        if a == "--outbox-volume":
            if not args:
                raise Failed("--outbox-volume needs a volume name")
            volume = args.pop(0)
        elif a == "--remote":
            remote = True
        elif a.startswith("-"):
            raise Failed(f"unknown option {a}")
        else:
            base = a.rstrip("/")
    host = urllib.parse.urlsplit(base).hostname
    if host not in ("127.0.0.1", "localhost", "::1") and not remote:
        raise Failed(f"{base} is not this machine: it would get a test account (and, with its AI on, a paid "
                     "analysis); pass --remote to go ahead, and never for production")

    # The API, through Caddy, answered by Go.
    status, hdrs, body = request(base, "GET", "/api/health")
    expect(status == 200 and json.loads(body).get("status") == "ok", "GET /api/health: 200, status ok")
    expect(bool(hdrs.get("x-request-id")), "GET /api/health: answered by Go (X-Request-Id)")
    headers_of("GET /api/health", hdrs)
    expect(hdrs.get("referrer-policy") == "strict-origin-when-cross-origin", "GET /api/health: Referrer-Policy")
    status, _, body = request(base, "GET", "/api")
    expect(status == 404 and "code" in json.loads(body), "GET /api: Go's 404 envelope (the bare prefix goes to Go too)")
    status, hdrs, body = request(base, "GET", "/api/v1/no-such-route")
    expect(status == 404 and "code" in json.loads(body) and bool(hdrs.get("x-request-id")),
           "GET /api/v1/no-such-route: Go's 404 envelope, not the website's page")

    # The website, through Caddy.
    for path in ("/", "/privacy", "/terms"):
        status, hdrs, body = request(base, "GET", path)
        expect(status == 200 and "text/html" in hdrs.get("content-type", ""), f"GET {path}: 200 HTML")
        headers_of(f"GET {path}", hdrs)
        expect("x-request-id" not in hdrs, f"GET {path}: answered by the website, not Go")
    expect(b"Lookly" in request(base, "GET", "/")[2], "GET /: the landing page")
    status, hdrs, _ = request(base, "GET", "/reset-password?token=check")
    expect(status == 200 and hdrs.get("referrer-policy") == "no-referrer", "GET /reset-password: 200, no referrer")

    # One journey through every part: sign-up (database, schema), an upload (the
    # image volume, the image pipeline), its signed image through Caddy, a reset
    # request (the job queue; with --outbox-volume, the worker's mail).
    status, _, body = request(base, "GET", "/api/v1/legal")
    version = json.loads(body).get("version") if status == 200 else None
    expect(bool(version), "GET /api/v1/legal: the current legal version")
    email = f"stack-check-{uuid.uuid4().hex[:12]}@example.test"
    status, _, body = request(base, "POST", "/api/v1/auth/register", headers=MOBILE, body={
        "name": "Stack check", "email": email, "password": "stack-Check-Passw0rd!",
        "acceptedLegalVersion": version, "ageConfirmed": True})
    expect(status == 201, f"POST /api/v1/auth/register: 201 (got {status})")
    token = json.loads(body)["accessToken"]
    try:
        journey(base, volume, email, token)
    finally:
        status, _, _ = request(base, "DELETE", "/api/v1/account", headers={**MOBILE, "Authorization": f"Bearer {token}"})
        expect(status == 200, f"DELETE /api/v1/account: the test account removed (got {status})")
        status, _, _ = request(base, "POST", "/api/v1/auth/login", headers=MOBILE,
                               body={"email": email, "password": "stack-Check-Passw0rd!"})
        expect(status == 401, "the deleted account can no longer sign in")
    print("stack check passed")


def journey(base, volume, email, token):
    with open(PICTURE, "rb") as f:
        data, ctype = multipart("file", "black-coat.png", "image/png", f.read())
    status, _, body = request(base, "POST", "/api/v1/wardrobe/items", raw=data, content_type=ctype,
                              headers={**MOBILE, "Authorization": f"Bearer {token}"})
    expect(status == 201, f"POST /api/v1/wardrobe/items: 201, the picture stored (got {status} {body[:200]!r})")
    image = json.loads(body)["item"]["primaryImage"]
    status, hdrs, body = request(base, "GET", image["url"])
    expect(status == 200 and hdrs.get("content-type", "").startswith("image/") and len(body) > 0,
           "GET the signed image: 200, an image")
    expect(hdrs.get("x-content-type-options") == "nosniff", "GET the signed image: nosniff")
    before = set(outbox_files(volume)) if volume else set()
    status, _, _ = request(base, "POST", "/api/v1/auth/password/forgot", body={"email": email})
    expect(status == 200, "POST /api/v1/auth/password/forgot: 200")
    if volume:
        deadline = time.time() + 30
        while time.time() < deadline and not (set(outbox_files(volume)) - before):
            time.sleep(1)
        expect(bool(set(outbox_files(volume)) - before), "the worker wrote the reset mail to the outbox")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Failed as err:
        print(f"FAIL {err}", file=sys.stderr)
        sys.exit(1)
