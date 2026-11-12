# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99

ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="Factorize credential proxy" \
      org.opencontainers.image.source="https://github.com/GenerationSoftware/factorize" \
      org.opencontainers.image.revision="$SOURCE_REVISION"

ENV NODE_ENV=production \
    FACTORIZE_PROXY_TUNNEL_PORT=9090

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/factorize/credential-proxy
COPY packages/credential-proxy/image/package.json packages/credential-proxy/image/package-lock.json /opt/codex/
RUN npm ci --prefix /opt/codex --omit=dev --ignore-scripts \
    && ln -s /opt/codex/node_modules/.bin/codex /usr/local/bin/codex \
    && test "$(codex --version)" = "codex-cli 0.167.1" \
    && npm cache clean --force \
    && chown -R node:node /opt/codex

COPY packages/credential-proxy/src/ ./src/
RUN for command in 'credential-proxy main' 'proxy-startup startup' 'proxy-certify-vm vm-certificate' 'proxy-authorize-run authorize-run'; do \
      set -- $command; \
      printf '#!/bin/sh\nexec node /opt/factorize/credential-proxy/src/%s.mjs "$@"\n' "$2" > "/usr/local/bin/factorize-$1"; \
      chmod 0755 "/usr/local/bin/factorize-$1"; \
    done
RUN mkdir -p /var/lib/factorize/codex-accounts /run/factorize-proxy \
    && chown -R node:node /opt/factorize /var/lib/factorize /run/factorize-proxy

USER node
EXPOSE 9090
ENTRYPOINT ["node", "/opt/factorize/credential-proxy/src/main.mjs"]
