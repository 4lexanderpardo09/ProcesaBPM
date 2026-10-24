#!/usr/bin/env bash
# Smoke test of the web image (CI, "Docker images"): it starts as the compose file runs it (read-only, no capabilities,
# no-new-privileges) and serves the app, its routes and its bundles. WEB_IMAGE is the tag to test.
set -euo pipefail

WEB_IMAGE=${WEB_IMAGE:?set WEB_IMAGE}
name=smoke-web-$$
docker run -d --name "$name" --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true -p 127.0.0.1::8080 "$WEB_IMAGE" >/dev/null
trap 'status=$?; [ "$status" -eq 0 ] || docker logs "$name" 2>&1 | tail -n 20; docker rm -f "$name" >/dev/null' EXIT
port=$(docker port "$name" 8080/tcp | head -n 1 | sed 's/.*://')
base="http://127.0.0.1:$port"
for _ in $(seq 1 20); do curl -fs -o /dev/null "$base/" && break; sleep 0.5; done

fail() { echo "::error::$*"; exit 1; }
index=$(curl -fs "$base/") || fail "the web does not answer on /"
grep -q '<div id="root">' <<<"$index" || fail "/ is not the app's index.html"
curl -fs "$base/tickets/some-ticket" | grep -q '<div id="root">' || fail "a route of the app does not open the app"
bundle=$(grep -o '/assets/[^"]*\.js' <<<"$index" | head -n 1)
[ -n "$bundle" ] || fail "index.html names no bundle"
curl -fsI "$base$bundle" | grep -qi 'cache-control: .*immutable' || fail "the bundle $bundle is missing or not cached"
status=$(curl -s -o /dev/null -w '%{http_code}' "$base/assets/missing.js")
[ "$status" = 404 ] || fail "a missing bundle answers $status, not 404"
echo "web image OK ($bundle)"
