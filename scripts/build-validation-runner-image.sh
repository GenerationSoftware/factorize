#!/usr/bin/env bash
set -euo pipefail

repository='generationsoftware/factorize-validation-runner'
registry='ghcr.int.exe.xyz'
tag="${1:-$(git rev-parse --short=12 HEAD)}"
metadata_file="$(mktemp)"
trap 'rm -f "$metadata_file"' EXIT

docker buildx build \
  --platform linux/amd64 \
  --file Dockerfile.validation-runner \
  --tag "${registry}/${repository}:${tag}" \
  --push \
  --metadata-file "$metadata_file" \
  .

digest="$(jq -er '.["containerimage.digest"] | select(test("^sha256:[0-9a-f]{64}$"))' "$metadata_file")"
printf 'Published image: ghcr.io/%s@%s\n' "$repository" "$digest"
