#!/bin/sh
set -eu

# Bootstrap HTTPS trust from the pinned Node image until Debian's CA bundle is installed.
ca_bundle=$(mktemp)
trap 'rm -f "$ca_bundle"' EXIT
node -p 'require("node:tls").rootCertificates.join("\n")' > "$ca_bundle"
chmod 644 "$ca_bundle"

apt-get -o Acquire::https::CAInfo="$ca_bundle" -o APT::Update::Error-Mode=any update
apt-get -o Acquire::https::CAInfo="$ca_bundle" install -y --no-install-recommends \
    ca-certificates chromium
rm -rf /var/lib/apt/lists/*
