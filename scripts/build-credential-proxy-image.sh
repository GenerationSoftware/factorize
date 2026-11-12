#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

source_revision="$(git rev-parse HEAD)"
source_short="$(git rev-parse --short=12 HEAD)"
artifact_dir="${FACTORIZE_PROXY_IMAGE_ARTIFACT_DIR:-${HOME}/.factorize-job/credential-proxy-image}"
mkdir -p "$artifact_dir"
metadata_file="$(mktemp)"
trap 'rm -f "$metadata_file"' EXIT

docker buildx build \
  --platform linux/amd64 \
  --file packages/credential-proxy/Dockerfile \
  --tag "factorize-credential-proxy:source-${source_short}" \
  --build-arg "SOURCE_REVISION=${source_revision}" \
  --provenance=mode=max \
  --sbom=generator=docker/buildkit-syft-scanner@sha256:873a7458c3c8ac8e32c7b796c10e1600b07b963d2aa000a72a2d97aaaa2d6315 \
  --metadata-file "$metadata_file" \
  --output "type=oci,dest=${artifact_dir}/credential-proxy-${source_short}.oci.tar" \
  .

image_digest="$(jq -er '."containerimage.digest" | select(test("^sha256:[0-9a-f]{64}$"))' "$metadata_file")"
jq -n \
  --arg sourceRevision "$source_revision" \
  --arg imageDigest "$image_digest" \
  --arg baseImage "node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99" \
  --arg codexVersion "codex-cli 0.167.1" \
  --arg artifact "credential-proxy-${source_short}.oci.tar" \
  '{schemaVersion:1,sourceRevision:$sourceRevision,baseImage:$baseImage,codexVersion:$codexVersion,imageDigest:$imageDigest,ociArchive:$artifact,provenance:"BuildKit max provenance and SBOM are attached to the OCI output"}' \
  > "${artifact_dir}/build-provenance.json"
cat "${artifact_dir}/build-provenance.json"
