import { describe, expect, it } from "vitest";
import { noAnswerRefusal } from "../../src/run-scan.js";

// The browser's words for a page that did not answer, as playwright-core 1.65.1 words them. No browser runs
// here, so the DNS failure is tested by its message and no name is looked up.
describe("noAnswerRefusal", () => {
  const url = "http://example.test:8080/page";

  it("words a refused connection, a missing host name and a timeout", () => {
    const refused = noAnswerRefusal(
      new Error("page.goto: net::ERR_CONNECTION_REFUSED at " + url),
      url,
      30000,
    );
    expect(refused?.message).toBe("http://example.test:8080 did not answer: the connection was refused.");
    expect(refused?.hint).toBe("check the address, and that the server is running.");
    expect(noAnswerRefusal(new Error("net::ERR_NAME_NOT_RESOLVED"), url, 30000)?.message).toBe(
      "http://example.test:8080 did not answer: the host name was not found.",
    );
    const timeout = Object.assign(new Error("Timeout 30000ms exceeded."), { name: "TimeoutError" });
    expect(noAnswerRefusal(timeout, url, 30000)?.message).toBe(
      "http://example.test:8080 did not answer: no answer within 30 seconds.",
    );
  });

  it("names any other network error by its code, and leaves other errors alone", () => {
    expect(noAnswerRefusal(new Error("net::ERR_CONNECTION_RESET"), url, 30000)?.message).toContain(
      "the browser reported ERR_CONNECTION_RESET",
    );
    expect(noAnswerRefusal(new Error("something else"), url, 30000)).toBeNull();
    expect(noAnswerRefusal("not an error", url, 30000)).toBeNull();
  });
});
