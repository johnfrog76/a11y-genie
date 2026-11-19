import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { OffLoopbackError, isLoopbackHost, takeBlockedAttempts } from "../helpers/no-network.js";

// These tests prove the guard in test/helpers/no-network.ts. It covers Node's fetch, http, https
// and net in the test process. It does not cover a browser; that guard comes with the browser tests.
// Each test drains the record, because the setup file fails any test that leaves an attempt behind.
describe("no-network guard (Node fetch, http, https and net only)", () => {
  it("fails a fetch to a host off loopback", async () => {
    await expect(fetch("http://192.0.2.1/")).rejects.toBeInstanceOf(OffLoopbackError);
    expect(takeBlockedAttempts()).toEqual(["http://192.0.2.1/"]);
  });

  it("fails an https fetch to a named host", async () => {
    await expect(fetch("https://example.com/")).rejects.toThrow(/not loopback/);
    expect(takeBlockedAttempts()).toHaveLength(1);
  });

  it("fails http.get to a host off loopback", () => {
    expect(() => http.get("http://192.0.2.1/")).toThrow(OffLoopbackError);
    expect(takeBlockedAttempts()).toHaveLength(1);
  });

  it("fails a raw net connection off loopback", () => {
    expect(() => net.connect({ host: "192.0.2.1", port: 80 })).toThrow(OffLoopbackError);
    expect(() => net.connect(80, "example.com")).toThrow(OffLoopbackError);
    expect(takeBlockedAttempts()).toHaveLength(2);
  });

  it("knows what loopback is", () => {
    for (const h of ["127.0.0.1", "127.1.2.3", "::1", "[::1]", "localhost"]) {
      expect(isLoopbackHost(h)).toBe(true);
    }
    for (const h of ["192.0.2.1", "example.com", "127.0.0.1.example.com", "0.0.0.0"]) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });
});
