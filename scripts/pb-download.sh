#!/usr/bin/env bash
# Governing: ADR-0001 (PocketBase as backend), SPEC-0007 REQ "Local Development", REQ "Container" (pinned version)
#
# Downloads the pinned PocketBase release (HH_PB_VERSION) for this platform into .pb/ and verifies its SHA-256
# against the release's checksums.txt. Supports macOS (arm64, amd64) and Linux (amd64).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${HH_PB_VERSION:-}" ] && [ -f "$root/.env" ]; then
  HH_PB_VERSION="$(sed -n 's/^HH_PB_VERSION=//p' "$root/.env" | head -n1 | tr -d '"'"'"' \r')"
fi
if [ -z "${HH_PB_VERSION:-}" ]; then
  echo "missing configuration: HH_PB_VERSION" >&2
  exit 1
fi
version="${HH_PB_VERSION#v}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform="darwin_arm64" ;;
  Darwin-x86_64) platform="darwin_amd64" ;;
  Linux-x86_64) platform="linux_amd64" ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

archive="pocketbase_${version}_${platform}.zip"
base="https://github.com/pocketbase/pocketbase/releases/download/v${version}"
dest="$root/.pb"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$dest"
echo "Downloading PocketBase ${version} (${platform})"
curl -fsSL -o "$tmp/$archive" "$base/$archive"
curl -fsSL -o "$tmp/checksums.txt" "$base/checksums.txt"

expected="$(awk -v f="$archive" '$2 == f || $2 == "*" f { print $1 }' "$tmp/checksums.txt")"
if [ -z "$expected" ]; then
  echo "no checksum listed for $archive" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$archive" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "$tmp/$archive" | awk '{ print $1 }')"
fi
if [ "$expected" != "$actual" ]; then
  echo "checksum mismatch for $archive" >&2
  exit 1
fi

unzip -q -o "$tmp/$archive" pocketbase -d "$tmp/out"
install -m 0755 "$tmp/out/pocketbase" "$dest/pocketbase"
echo "Installed $("$dest/pocketbase" --version) to .pb/pocketbase (checksum verified)"
