import { describe, expect, it } from "vitest";
import { addressKind, addressKindOfUrl, isPrivateHost } from "../../src/private-address.js";

// The address classifier behind the private-network rule (spec 8A.1), over each range it names and the
// edges of each, with no browser and no lookup: it judges the host as written.

describe("the address classifier", () => {
  it.each([
    // 127.0.0.0/8, ::1 and localhost
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["::1", "loopback"],
    ["[::1]", "loopback"],
    ["0:0:0:0:0:0:0:1", "loopback"],
    ["localhost", "loopback"],
    ["LOCALHOST", "loopback"],
    ["localhost.", "loopback"],
    ["app.localhost", "loopback"],
    // The other ways a URL can write 127.0.0.1, as the URL parser reads them
    ["0x7f.1", "loopback"],
    ["2130706433", "loopback"],
    ["0177.0.0.1", "loopback"],
    // 0.0.0.0/8 and ::
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "unspecified"],
    ["::", "unspecified"],
    ["[::]", "unspecified"],
    // RFC 1918
    ["10.0.0.1", "private"],
    ["10.255.255.255", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.0.1", "private"],
    ["192.168.255.255", "private"],
    // fc00::/7
    ["fc00::1", "private"],
    ["fd12:3456::1", "private"],
    ["fdff:ffff::1", "private"],
    // 169.254.0.0/16 and fe80::/10
    ["169.254.0.1", "link-local"],
    ["169.254.169.254", "link-local"],
    ["fe80::1", "link-local"],
    ["febf::1", "link-local"],
    // ::ffff:0:0/96, judged by the IPv4 address inside
    ["::ffff:127.0.0.1", "loopback"],
    ["[::ffff:7f00:1]", "loopback"],
    ["::ffff:10.1.2.3", "private"],
    ["0:0:0:0:0:ffff:c0a8:0101", "private"],
    ["::ffff:169.254.169.254", "link-local"],
    ["::ffff:0.0.0.0", "unspecified"],
    ["::ffff:8.8.8.8", "public"],
    // 64:ff9b::/96 (RFC 6052), judged by the IPv4 address in its last 32 bits
    ["64:ff9b::7f00:1", "loopback"],
    ["64:ff9b::a00:1", "private"],
    ["64:ff9b::808:808", "public"],
    ["64:ff9b::10.0.0.1", "private"],
    ["[64:ff9b::10.0.0.1]", "private"],
    ["64:FF9B::A00:1", "private"],
    ["64:ff9b:0:0:0:0:a00:1", "private"],
    ["0064:ff9b:0000:0000:0000:0000:0a00:0001", "private"],
    ["64:ff9b::169.254.169.254", "link-local"],
    ["64:ff9b::0.0.0.0", "unspecified"],
    // 64:ff9b:1::/48 (RFC 8215) cannot be judged, so it is blocked
    ["64:ff9b:1::a00:1", "private"],
    ["64:ff9b:1::808:808", "private"],
    ["64:ff9b:1:ffff::1", "private"],
    ["64:FF9B:1::A00:1", "private"],
    // outside both prefixes: ordinary IPv6
    ["64:ff9c::a00:1", "public"],
    ["64:ff9b:2::a00:1", "public"],
    ["64:ff9b::1:a00:1", "public"],
  ])("%s is %s", (host, kind) => {
    expect(addressKind(host)).toBe(kind);
  });

  it.each([
    // The edges just outside each range
    "126.255.255.255",
    "128.0.0.1",
    "1.0.0.0",
    "9.255.255.255",
    "11.0.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "192.167.255.255",
    "192.169.0.1",
    "169.253.255.255",
    "169.255.0.1",
    "fbff::1",
    "fe00::1",
    "fec0::1",
    // Not in the spec's list, so public
    "100.64.0.1",
    "100.127.255.255",
    "::2",
    // IPv4-compatible (::/96, deprecated) is not IPv4-mapped
    "::7f00:1",
    "2001:db8::1",
    "8.8.8.8",
    // Names are judged as written: no lookup (gap G7)
    "example.com",
    "localhost.example.com",
    "notlocalhost",
    "127.0.0.1.example.com",
    // Not an address at all
    "",
    "[::1",
    "1.2.3.4.5",
  ])("%s is public", (host) => {
    expect(addressKind(host)).toBe("public");
    expect(isPrivateHost(host)).toBe(false);
  });

  it("reads the host of a full address, and nothing for an address with none", () => {
    expect(addressKindOfUrl("http://127.0.0.1:4173/page.html")).toBe("loopback");
    expect(addressKindOfUrl("ws://[::1]:9000/socket")).toBe("loopback");
    expect(addressKindOfUrl("https://user:pass@192.168.1.1/admin")).toBe("private");
    expect(addressKindOfUrl("http://[::ffff:a9fe:a9fe]/latest/meta-data")).toBe("link-local");
    expect(addressKindOfUrl("http://[64:ff9b::a00:1]/admin")).toBe("private");
    expect(addressKindOfUrl("https://example.com/")).toBe("public");
    expect(addressKindOfUrl("data:text/plain,hello")).toBeUndefined();
    expect(addressKindOfUrl("not a url")).toBeUndefined();
  });
});
