#!/bin/sh
set -eu

# ExecStartPost runs as root after PostgreSQL has initialized/started. Use the
# postgres OS account and local peer auth so no credential is needed at build.
runuser -u postgres -- psql --dbname=postgres --set=ON_ERROR_STOP=1 \
  --command="ALTER ROLE postgres WITH LOGIN PASSWORD 'local-validation-only'"
