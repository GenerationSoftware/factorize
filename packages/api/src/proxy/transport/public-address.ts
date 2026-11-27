import { isIP } from "node:net";

function ipv4Number(address: string) {
  return address.split(".").reduce((value, part) => (value * 256) + Number(part), 0) >>> 0;
}

function ipv6Number(address: string) {
  let source = address.toLowerCase();
  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":");
    const v4 = ipv4Number(source.slice(lastColon + 1));
    source = `${source.slice(0, lastColon)}:${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = source.split("::");
  const left = halves[0] ? halves[0]!.split(":") : [];
  const right = halves[1] ? halves[1]!.split(":") : [];
  const groups = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group || "0"}`), 0n);
}

function inV4Range(address: string, network: string, prefix: number) {
  const shift = 32 - prefix;
  return (ipv4Number(address) >>> shift) === (ipv4Number(network) >>> shift);
}

function inV6Range(value: bigint, network: string, prefix: number) {
  const shift = 128n - BigInt(prefix);
  return (value >> shift) === (ipv6Number(network) >> shift);
}

const NON_PUBLIC_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

const NON_PUBLIC_V6: Array<[string, number]> = [
  ["::", 128], ["::1", 128], ["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
];

/** Return true only for globally routable IP literals. */
export function isPublicAddress(address: string) {
  if (typeof address !== "string") return false;
  const unzoned = address.split("%")[0]!;
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


export function isPublicHttpsOrigin(value: string, backendOrigin = ""): boolean {
  try {
    const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, "");
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password && value !== backendOrigin
      && (isIP(host) ? isPublicAddress(host) : host.includes(".") && !/(?:^|\.)(?:localhost|internal|local|test|invalid|example)$/.test(host));
  } catch { return false; }
}
