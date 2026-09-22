#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
certificate="$script_dir/../chat-lite-private-ca.crt"
if [ ! -f "$certificate" ]; then
  echo "Missing certificate: $certificate" >&2
  exit 1
fi
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$certificate"
echo "Chat Lite private CA is now trusted by macOS."
