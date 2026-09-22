export function isSecureEndpoint(url: string) {
  const protocol = new URL(url).protocol;
  return protocol === "https:" || protocol === "wss:";
}

export function isLoopbackEndpoint(url: string) {
  const hostname = new URL(url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
