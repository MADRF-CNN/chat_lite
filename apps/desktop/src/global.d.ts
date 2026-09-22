export {};

declare global {
  interface Window {
    desktop?: {
      saveRefreshToken(token: string | null): Promise<void>;
      loadRefreshToken(): Promise<string | null>;
      saveSecureValue(name: string, value: string | null): Promise<void>;
      loadSecureValue(name: string): Promise<string | null>;
      saveFile(name: string, bytes: Uint8Array): Promise<boolean>;
    };
  }
}
