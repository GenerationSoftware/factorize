import { mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
if (!existsSync(".dev-certs/key.pem")) {
  mkdirSync(".dev-certs", { recursive: true });
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", ".dev-certs/key.pem", "-out", ".dev-certs/cert.pem", "-days", "30", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
}
