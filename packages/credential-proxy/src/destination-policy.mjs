import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { connect as tlsConnect, checkServerIdentity } from "node:tls";

const DEFAULT_HTTPS_PORT = 443;

function ipv4Number(address) {
  return address.split(".").reduce((value, part) => (value * 256) + Number(part), 0) >>> 0;
}

function ipv6Number(address) {
  let source = address.toLowerCase();
  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":");
    const v4 = ipv4Number(source.slice(lastColon + 1));
    source = `${source.slice(0, lastColon)}:${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = source.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group || "0"}`), 0n);
}

function inV4Range(address, network, prefix) {
  const shift = 32 - prefix;
  return (ipv4Number(address) >>> shift) === (ipv4Number(network) >>> shift);
}

function inV6Range(value, network, prefix) {
  const shift = 128n - BigInt(prefix);
  return (value >> shift) === (ipv6Number(network) >> shift);
}

const NON_PUBLIC_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

const NON_PUBLIC_V6 = [
  ["::", 128], ["::1", 128], ["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
];

/** Return true only for globally routable IP literals. */
export function isPublicAddress(address) {
  if (typeof address !== "string") return false;
  const unzoned = address.split("%")[0];
  const family = isIP(unzoned);
  if (family === 4) return !NON_PUBLIC_V4.some(([network, prefix]) => inV4Range(unzoned, network, prefix));
  if (family !== 6) return false;

  const value = ipv6Number(unzoned);
  // IPv4-mapped IPv6 addresses inherit the embedded IPv4 address policy.
  if (value >> 32n === 0xffffn) {
    const embedded = Number(value & 0xffffffffn);
    return isPublicAddress([24, 16, 8, 0].map((shift) => (embedded >>> shift) & 255).join("."));
  }
  // Global unicast is the only IPv6 range eligible for outbound connections.
  if ((value >> 125n) !== 1n) return false; // 2000::/3
  return !NON_PUBLIC_V6.some(([network, prefix]) => inV6Range(value, network, prefix));
}

function parseHttpsUrl(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\\")) {
    throw new TypeError(`${label} must be an absolute HTTPS URL`);
  }
  const authorityMatch = /^https:\/\/([^/?#]*)/i.exec(value);
  const authority = authorityMatch?.[1] ?? "";
  if (!authority || /[%\\\s@]/.test(authority) || authority.endsWith(":")) {
    throw new TypeError(`${label} has a malformed authority`);
  }
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${label} must be an absolute HTTPS URL`); }
  if (url.protocol !== "https:") throw new TypeError(`${label} must use HTTPS`);
  if (url.username || url.password) throw new TypeError(`${label} must not contain credentials`);
  if (!url.hostname || /[%\s]/.test(url.hostname)) throw new TypeError(`${label} has a malformed host`);
  const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1).toLowerCase() : url.hostname.toLowerCase();
  const family = isIP(hostname);
  if (!family && (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(hostname))) {
    throw new TypeError(`${label} has a malformed host`);
  }
  const port = url.port ? Number(url.port) : DEFAULT_HTTPS_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError(`${label} has an invalid port`);
  return { url, hostname, port, family };
}

function normalizeAddress(address) {
  let value = String(address).split("%")[0].toLowerCase();
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice(7);
    if (isIP(mapped) === 4) value = mapped;
    else if (mapped.includes(":")) {
      const words = mapped.split(":");
      const high = Number.parseInt(words.at(-2), 16);
      const low = Number.parseInt(words.at(-1), 16);
      value = [high >>> 8, high & 255, low >>> 8, low & 255].join(".");
    }
  }
  if (isIP(value) === 6) return `v6:${ipv6Number(value).toString(16)}`;
  return value;
}

async function resolveAll(hostname) {
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) }];
  return lookup(hostname, { all: true, verbatim: true });
}

function openTlsSocket({ hostname, port, address, ca, timeoutMs = 10_000 }) {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({
      host: address,
      ca,
      port,
      servername: isIP(hostname) ? undefined : hostname,
      checkServerIdentity: (_server, certificate) => checkServerIdentity(hostname, certificate),
    });
    const timer = setTimeout(() => failed(new Error("upstream connect deadline exceeded")), timeoutMs);
    timer.unref?.();
    const failed = (error) => { clearTimeout(timer); socket.destroy(); reject(error); };
    socket.once("error", failed);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      socket.removeListener("error", failed);
      resolve(socket);
    });
  });
}

/**
 * Build a connector bound to one configured HTTPS origin. Every DNS answer is
 * checked, and the selected public address is passed directly to the connector
 * so a second DNS lookup cannot change the destination between validation and
 * connection. Paths, queries, methods, and bodies remain available to callers.
 */
export function createOriginConnector(configuredOrigin, { resolve = resolveAll, connect = openTlsSocket, timeoutMs = 10_000 } = {}) {
  const configured = parseHttpsUrl(configuredOrigin, "configured origin");
  if (configured.url.pathname !== "/" || configured.url.search || configured.url.hash) {
    throw new TypeError("configured origin must contain only an HTTPS origin");
  }
  return async function connectToOrigin(requestUrl) {
    const target = parseHttpsUrl(requestUrl, "request URL");
    if (target.url.origin !== configured.url.origin || target.hostname !== configured.hostname || target.port !== configured.port) {
      throw new TypeError("request URL does not match the configured HTTPS origin");
    }
    const answers = await resolve(target.hostname);
    if (!Array.isArray(answers) || answers.length === 0) throw new Error("origin did not resolve to an address");
    for (const answer of answers) {
      if (!answer || !isPublicAddress(answer.address)) throw new Error("origin resolved to a non-public address");
    }
    const address = answers[0].address;
    const socket = await connect({ hostname: target.hostname, port: target.port, address, servername: target.hostname, timeoutMs });
    const rawPeerAddress = socket?.remoteAddress ?? "";
    const peerAddress = normalizeAddress(rawPeerAddress);
    if (!peerAddress || peerAddress !== normalizeAddress(address) || !isPublicAddress(rawPeerAddress)) {
      socket?.destroy?.();
      throw new Error("connected peer did not match the validated public address");
    }
    return { socket, url: target.url };
  };
}

/** Exact fixture origin/address only; production connector is unchanged. */
export function createTestOriginConnector({ testMode, origin, address, ca }) {
  if (testMode !== true || !isIP(address) || typeof ca !== "string" || !ca.startsWith("-----BEGIN CERTIFICATE-----")) throw new TypeError("invalid test transport");
  const configured = parseHttpsUrl(origin, "test origin");
  if (configured.url.origin !== origin) throw new TypeError("test origin must be canonical");
  return (requestedOrigin) => {
    if (requestedOrigin !== origin) return createOriginConnector(requestedOrigin);
    return async requestUrl => {
      const target = parseHttpsUrl(requestUrl, "request URL");
      if (target.url.origin !== origin) throw new Error("test origin mismatch");
      const socket = await openTlsSocket({ hostname: configured.hostname, port: configured.port, address, ca });
      if (normalizeAddress(socket.remoteAddress) !== normalizeAddress(address)) { socket.destroy(); throw new Error("test peer mismatch"); }
      return { socket, url: target.url };
    };
  };
}
