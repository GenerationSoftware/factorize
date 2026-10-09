import "./dev-cert.mjs";
import { spawn } from "node:child_process";
const processes = ["dev:api", "dev:app"].map(script => spawn("npm", ["run", script], { stdio: "inherit", detached: process.platform !== "win32" }));
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of processes) { try { if (process.platform === "win32") child.kill("SIGTERM"); else process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; } } }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
for (const child of processes) child.on("exit", code => { if (code) process.exitCode = code; stop(); });
