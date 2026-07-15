import { describe, expect, it } from "vitest";

import { formatForwardEndpoint, forwardInput } from "./forwardForm";

const values = {
  hostId: " host ",
  label: " Database ",
  kind: "local" as const,
  bindHost: " ",
  bindPort: "15432",
  targetHost: " db.internal ",
  targetPort: "5432",
  autoStart: true,
};

describe("forwardInput", () => {
  it("formats IPv4, hostnames, and IPv6 endpoints unambiguously", () => {
    expect(formatForwardEndpoint("127.0.0.1", 8080)).toBe("127.0.0.1:8080");
    expect(formatForwardEndpoint("localhost", 8080)).toBe("localhost:8080");
    expect(formatForwardEndpoint("::1", 8080)).toBe("[::1]:8080");
  });

  it("normalizes a valid local forward", () => {
    expect(forwardInput(values)).toEqual({
      input: {
        hostId: "host",
        label: "Database",
        kind: "local",
        bindHost: "127.0.0.1",
        bindPort: 15432,
        targetHost: "db.internal",
        targetPort: 5432,
        autoStart: true,
      },
    });
  });

  it("rejects missing targets and invalid port syntax or range", () => {
    expect(forwardInput({ ...values, bindPort: "1e3" })).toEqual({
      error: "invalidBindPort",
    });
    expect(forwardInput({ ...values, targetHost: " " })).toEqual({
      error: "targetRequired",
    });
    expect(forwardInput({ ...values, targetPort: "65536" })).toEqual({
      error: "invalidTargetPort",
    });
  });

  it("clears fixed targets for dynamic forwards", () => {
    expect(
      forwardInput({
        ...values,
        kind: "dynamic",
        targetHost: "ignored",
        targetPort: "invalid",
      }),
    ).toMatchObject({
      input: { kind: "dynamic", targetHost: null, targetPort: null },
    });
  });
});
