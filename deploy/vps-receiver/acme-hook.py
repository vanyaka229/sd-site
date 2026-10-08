#!/usr/bin/env python3
"""Хуки certbot для DNS-01: создают и удаляют TXT-запись _acme-challenge через API Timeweb.

Зачем так: порты 80 и 443 на этом сервере заняты (Caddy и Amnezia VPN), поэтому обычная
проверка HTTP-01 невозможна. DNS-01 не требует портов вообще.

certbot вызывает:
    acme-hook.py auth      — создать запись (переменные CERTBOT_DOMAIN, CERTBOT_VALIDATION)
    acme-hook.py cleanup   — удалить запись

Токен Timeweb лежит в /etc/sd-studio/timeweb-token (права 600, только root) — потому что
хук запускается от root во время обновления сертификата.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

TOKEN_FILE = "/etc/sd-studio/timeweb-token"
API = "https://api.timeweb.cloud/api/v1/domains/{zone}/dns-records"
STATE = "/run/acme-timeweb-{domain}.json"


def read_token():
    with open(TOKEN_FILE, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                return line
    raise SystemExit("нет токена в " + TOKEN_FILE)


def call(url, method, payload, tok):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + tok,
        "Accept": "application/json",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8", "ignore")
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "ignore")[:300]


def zone_of(domain):
    parts = domain.split(".")
    return ".".join(parts[-2:])


def subdomain_of(domain, zone):
    if domain == zone:
        return "_acme-challenge"
    return "_acme-challenge." + domain[: -(len(zone) + 1)]


def wait_for_dns(name, value, timeout=300):
    url = "https://dns.google/resolve?name=" + name + "&type=TXT"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/dns-json", "User-Agent": "acme-hook"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8", "ignore"))
            for answer in data.get("Answer", []):
                if value in (answer.get("data") or ""):
                    return True
        except Exception:
            pass
        time.sleep(10)
    return False


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("auth", "cleanup"):
        raise SystemExit("использование: acme-hook.py auth|cleanup")
    mode = sys.argv[1]
    domain = os.environ["CERTBOT_DOMAIN"]
    validation = os.environ.get("CERTBOT_VALIDATION", "")
    zone = zone_of(domain)
    name = subdomain_of(domain, zone)
    tok = read_token()
    url = API.format(zone=zone)
    state_path = STATE.format(domain=domain)

    if mode == "auth":
        status, data = call(url, "POST", {"type": "TXT", "value": validation, "ttl": 60, "subdomain": name}, tok)
        if status not in (200, 201):
            raise SystemExit(f"не создал TXT {name}: HTTP {status} {data}")
        record_id = (data.get("dns_record") or {}).get("id")
        with open(state_path, "w", encoding="utf-8") as fh:
            json.dump({"id": record_id, "name": name, "zone": zone}, fh)
        print(f"TXT {name} создан (id {record_id}), жду распространения…", flush=True)
        ok = wait_for_dns(name + "." + zone, validation)
        print("DNS виден публично" if ok else "DNS пока не виден, отдаю проверку certbot'у", flush=True)
        return

    try:
        with open(state_path, encoding="utf-8") as fh:
            saved = json.load(fh)
    except Exception:
        print("нет сохранённого id — нечего удалять")
        return
    if saved.get("id"):
        status, data = call(f"{url}/{saved['id']}", "DELETE", None, tok)
        print(f"TXT {saved['name']} удалён: HTTP {status} {data if isinstance(data, str) else ''}", flush=True)
    try:
        os.unlink(state_path)
    except OSError:
        pass


if __name__ == "__main__":
    main()
