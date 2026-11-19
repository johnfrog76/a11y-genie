import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

const PAGES = ["icon-button.html", "contrast.html", "impact-mix.html", "clean.html"];

describe("fixture server", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it("listens on loopback, on a port it chose", () => {
    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(server.port).toBeGreaterThan(0);
  });

  it.each(PAGES)("serves %s as HTML with a comment naming its rules", async (page) => {
    const res = await fetch(server.url(page));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const body = await res.text();
    expect(body).toMatch(/Must fire:/);
    expect(body).toMatch(/<main>/);
  });

  it("answers 404 for a page that is not there", async () => {
    const res = await fetch(server.url("missing.html"));
    expect(res.status).toBe(404);
  });

  it("does not serve files outside the fixtures folder", async () => {
    const res = await fetch(`${server.origin}/..%2f..%2fhelpers%2ffixture-server.ts`);
    expect(res.status).toBe(403);
  });
});
