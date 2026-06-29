#!/usr/bin/env python3
"""
Abilita la capability NETWORK_EXTENSIONS sugli App ID dell'app e dell'estensione tunnel,
e registra l'App ID dell'estensione se manca. Idempotente. Usa i secret ASC dall'ambiente
(ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8_BASE64). Gira in CI prima di sigh.
"""
import os, sys, time, json, base64, jwt, requests

KEY_ID = os.environ["ASC_KEY_ID"]
ISSUER = os.environ["ASC_ISSUER_ID"]
P8 = base64.b64decode(os.environ["ASC_KEY_P8_BASE64"]).decode()
BASE = "https://api.appstoreconnect.apple.com"

APP_ID = "com.oleventechnologies.iiprivatemessenger"
EXT_ID = "com.oleventechnologies.iiprivatemessenger.tunnel"

def token():
    now = int(time.time())
    return jwt.encode({"iss": ISSUER, "iat": now, "exp": now + 19*60, "aud": "appstoreconnect-v1"},
                      P8, algorithm="ES256", headers={"kid": KEY_ID, "typ": "JWT"})

def api(method, path, body=None):
    return requests.request(method, BASE + path,
                            headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"},
                            data=json.dumps(body) if body else None, timeout=60)

def get_bundle(identifier):
    r = api("GET", f"/v1/bundleIds?filter[identifier]={identifier}&include=bundleIdCapabilities&limit=200")
    for b in r.json().get("data", []):
        if b["attributes"]["identifier"] == identifier:
            return b, r.json().get("included", [])
    return None, []

def ensure_bundle(identifier, name):
    b, included = get_bundle(identifier)
    if b:
        print(f"  bundle {identifier} presente (id={b['id']})")
        return b["id"], included
    body = {"data": {"type": "bundleIds", "attributes": {"identifier": identifier, "name": name, "platform": "IOS"}}}
    r = api("POST", "/v1/bundleIds", body)
    if r.status_code in (200, 201):
        bid = r.json()["data"]["id"]
        print(f"  bundle {identifier} CREATO (id={bid})")
        return bid, []
    print(f"  ERRORE creazione bundle {identifier}: {r.status_code} {r.text[:300]}")
    return None, []

def has_netext(included):
    for c in included:
        if c.get("type") == "bundleIdCapabilities" and c.get("attributes", {}).get("capabilityType") == "NETWORK_EXTENSIONS":
            return True
    return False

def enable_netext(bundle_db_id):
    body = {"data": {"type": "bundleIdCapabilities",
                     "attributes": {"capabilityType": "NETWORK_EXTENSIONS"},
                     "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bundle_db_id}}}}}
    r = api("POST", "/v1/bundleIdCapabilities", body)
    if r.status_code in (200, 201):
        print("    NETWORK_EXTENSIONS abilitata")
    elif r.status_code == 409:
        print("    NETWORK_EXTENSIONS gia' attiva (409)")
    else:
        print(f"    NOTA enable NETWORK_EXTENSIONS: {r.status_code} {r.text[:300]}")

def main():
    for identifier, name in [(APP_ID, "IIPrivateMessenger"), (EXT_ID, "IIPrivateMessengerTunnel")]:
        print(f">> {identifier}")
        bid, included = ensure_bundle(identifier, name)
        if not bid:
            continue
        if has_netext(included):
            print("    NETWORK_EXTENSIONS gia' presente")
        else:
            enable_netext(bid)
    print(">> capabilities done")

if __name__ == "__main__":
    main()
