/**
 * Which addresses are the machine's own or its network's: the address classifier behind the private-network
 * rule (docs/ARCHITECTURE.md, *The private-network rule*, and `armContext` in src/context.ts). It reads the host as written in the address and never
 * looks a name up, so a public name that resolves to a private address reads public (docs/KNOWN-GAPS.md, G7).
 *
 * The ranges:
 * - loopback: `127.0.0.0/8`, `::1`, and the name `localhost` (with any name under `.localhost`, which
 *   browsers send to loopback too);
 * - private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, and IPv6 unique local `fc00::/7`;
 * - link-local: `169.254.0.0/16` and `fe80::/10`;
 * - unspecified: `0.0.0.0/8`, and `::`, which reach the machine itself on many systems;
 * - IPv4-mapped IPv6, `::ffff:0:0/96`, is judged by the IPv4 address inside it, and so is the NAT64
 *   well-known prefix, `64:ff9b::/96` (RFC 6052), which a NAT64 gateway translates to that IPv4 address;
 * - so are IPv4-translated `::ffff:0:0:0/96` and the deprecated IPv4-compatible `::/96` (beyond `::` and `::1`);
 * - the local-use NAT64 prefix, `64:ff9b:1::/48` (RFC 8215), reads private (see `kindOfIpv6`).
 *
 * Anything else reads public, `100.64.0.0/10` (shared address space) among them, since it is not one of the
 * ranges above.
 */

export type AddressKind = "loopback" | "private" | "link-local" | "unspecified" | "public";

/** The IPv4 address as four numbers, or undefined when `host` is not a dotted IPv4 address. */
function ipv4(host: string): [number, number, number, number] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4) return undefined;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (numbers.some((n) => !(n >= 0 && n <= 255))) return undefined;
  return numbers as [number, number, number, number];
}

function kindOfIpv4([a, b]: [number, number, number, number]): AddressKind {
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "link-local";
  return "public";
}

/**
 * The IPv6 address as eight 16-bit groups, or undefined when `host` is not one. It reads the form the URL
 * parser writes (hex groups, at most one `::`), which `addressKind` puts the host in first.
 */
function ipv6(host: string): number[] | undefined {
  if (!host.includes(":")) return undefined;
  const halves = host.split("::");
  if (halves.length > 2) return undefined;
  const groups = (half: string): number[] | undefined => {
    if (half === "") return [];
    const out: number[] = [];
    for (const group of half.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  const head = groups(halves[0] ?? "");
  const tail = halves.length === 2 ? groups(halves[1] ?? "") : [];
  if (head === undefined || tail === undefined) return undefined;
  const given = head.length + tail.length;
  if (halves.length === 1) return given === 8 ? head : undefined;
  if (given > 7) return undefined;
  return [...head, ...Array<number>(8 - given).fill(0), ...tail];
}

function kindOfIpv6(groups: number[]): AddressKind {
  const [g0 = 0, g1 = 0, g2 = 0, , g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const zeroUpTo = (n: number) => groups.slice(0, n).every((g) => g === 0);
  if (zeroUpTo(8)) return "unspecified";
  if (zeroUpTo(7) && g7 === 1) return "loopback";
  const embedded = (): AddressKind => kindOfIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  if (zeroUpTo(5) && g5 === 0xffff) return embedded();
  // IPv4-translated ::ffff:0:0:0/96 (RFC 2765) and the deprecated IPv4-compatible ::/96 (RFC 4291 2.5.5.1), apart
  // from :: and ::1 above. Chromium hands both to the network as they are; whether they reach the IPv4 address
  // inside depends on a translator or tunnel there, as with NAT64, so they are judged by it.
  if (zeroUpTo(4) && g4 === 0xffff && g5 === 0) return embedded();
  if (zeroUpTo(6)) return embedded();
  // NAT64 well-known prefix 64:ff9b::/96 (RFC 6052): the IPv4 address is the last 32 bits, as in ::ffff:0:0/96.
  if (g0 === 0x64 && g1 === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) return embedded();
  // NAT64 local-use prefix 64:ff9b:1::/48 (RFC 8215): a network picks its own prefix length inside it (RFC 6052
  // section 2.2: 32, 40, 48, 56, 64 or 96), and the IPv4 address sits in a different place for each, so it
  // cannot be read from the address alone. Blocked outright, as private.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return "private";
  if ((g0 & 0xfe00) === 0xfc00) return "private";
  if ((g0 & 0xffc0) === 0xfe80) return "link-local";
  return "public";
}

/**
 * What kind of address a host is, as written: `127.0.0.1`, `[::1]` or `::1`, `localhost`, or a name. The
 * host is first put in the form a browser's URL parser gives it, so `0x7f.1`, `2130706433` and
 * `[::ffff:127.0.0.1]` read as the loopback addresses they are. A name reads public.
 */
export function addressKind(host: string): AddressKind {
  let name = host.trim().toLowerCase();
  if (name.includes(":") && !name.startsWith("[")) name = `[${name}]`;
  try {
    name = new URL(`http://${name}/`).hostname;
  } catch {
    return "public";
  }
  name = name.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (name === "localhost" || name.endsWith(".localhost")) return "loopback";
  const v4 = ipv4(name);
  if (v4 !== undefined) return kindOfIpv4(v4);
  const v6 = ipv6(name);
  if (v6 !== undefined) return kindOfIpv6(v6);
  return "public";
}

/** Whether a host is loopback, link-local, private or unspecified: anything but public. */
export function isPrivateHost(host: string): boolean {
  return addressKind(host) !== "public";
}

/** The kind of an address's host, or undefined when it is not a valid address or has no host. */
export function addressKindOfUrl(url: string): AddressKind | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname === "") return undefined;
  return addressKind(parsed.hostname);
}
