import { describe, expect, it } from "vitest";
import { isLoopbackEndpoint, isSecureEndpoint } from "./transport";

describe("isSecureEndpoint", () => {
  it("accepts HTTPS and WSS", () => {
    expect(isSecureEndpoint("https://chat.example.com")).toBe(true);
    expect(isSecureEndpoint("wss://chat.example.com/socket.io")).toBe(true);
  });

  it("rejects clear-text transports", () => {
    expect(isSecureEndpoint("http://chat.example.com")).toBe(false);
    expect(isSecureEndpoint("ws://chat.example.com/socket.io")).toBe(false);
  });

  it("recognizes local development endpoints", () => {
    expect(isLoopbackEndpoint("http://127.0.0.1:3000")).toBe(true);
    expect(isLoopbackEndpoint("http://localhost:3000")).toBe(true);
    expect(isLoopbackEndpoint("http://chat.example.com")).toBe(false);
  });
});
