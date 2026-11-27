import { resolve, dirname, relative } from "node:path";
import ts from "typescript";

const rawCredentialModules = new Set([
  "credentials/application/agent-credentials",
  "credentials/application/provider-credentials",
  "credentials/application/x-proxy-token",
]);
const egress = "proxy/transport/credential-backed-egress";

export function capabilityBoundaryViolations(file, source, root = "/factorize/src") {
  const failures = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const from = relative(root, file).replaceAll("\\", "/").replace(/\.[cm]?[jt]sx?$/, "");
  function check(specifier, typeOnly = false) {
    const to = specifier.startsWith(".")
      ? relative(root, resolve(dirname(file), specifier)).replaceAll("\\", "/").replace(/\.[cm]?[jt]sx?$/, "") : specifier;
    const deny = reason => failures.push(`${from}: ${reason} (${specifier})`);
    if (rawCredentialModules.has(to) && !(from === egress || from.startsWith("credentials/"))) {
      deny("raw credential resolution is private to credential and egress adapters");
    }
    if (to === "proxy/transport/outbound-forwarder" && from !== egress && !typeOnly) {
      deny("forwarding is private to credential-backed egress");
    }
    if (to === egress && from !== "proxy/application/agent-api") {
      deny("only the proxy use case may invoke credential-backed egress");
    }
    if (from.includes("/domain/") && !typeOnly
      && (/^(?:cloudflare:|@cloudflare\/|pg$|hono$|drizzle-orm)/.test(to)
        || /(?:^|\/)(?:api|storage|transport|postgres|config|credentials|application)(?:\/|$)/.test(to))) {
      deny("domain rules must not depend on infrastructure");
    }
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)) {
      check(node.moduleSpecifier.text, node.isTypeOnly || node.importClause?.isTypeOnly);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteralLike(node.moduleReference.expression)) check(node.moduleReference.expression.text, node.isTypeOnly);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === "require")
      && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) check(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return failures;
}
