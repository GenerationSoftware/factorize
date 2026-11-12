#!/usr/bin/env bash
set -euo pipefail

expected_node=24.12.0
expected_npm=11.19.0
expected_playwright=1.64.0

[[ "$(node --version)" == "v${expected_node}" ]]
[[ "$(npm --version)" == "${expected_npm}" ]]
[[ "$(node -p 'require("/usr/local/lib/node_modules/playwright/package.json").version')" == "${expected_playwright}" ]]
[[ "${PLAYWRIGHT_BROWSERS_PATH:-}" == "/opt/ms-playwright" ]]

# This must work for an ordinary non-login exedev process with the environment
# inherited from the VM image, as used by job execution.
runuser --preserve-environment -u exedev -- node --input-type=module -e '
  import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";
  if (process.env.PLAYWRIGHT_BROWSERS_PATH !== "/opt/ms-playwright") throw new Error("Playwright image environment was not inherited");
  const browser = await chromium.launch({ headless: true });
  console.log(`Chromium ${browser.version()} launched as uid ${process.getuid()} via the non-login image environment`);
  await browser.close();
'

# Password authentication uses the same URL and password as bootstrap-test.mjs.
psql 'postgresql://postgres:local-validation-only@localhost:5432/postgres' \
  --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --command='SELECT current_user, inet_server_addr()'
