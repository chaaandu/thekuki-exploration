export {};

declare global {
  interface Window {
    KUKI: {
      assets: Record<string, string>;
      settings: {
        threshold: number;
        enable3d: boolean;
        soundDefaultOn: boolean;
        haptics: boolean;
        publishEvents: boolean;
        designMode: boolean;
      };
      routes: Record<string, string>;
      i18n?: Record<string, string>;
    };
    Shopify?: {
      analytics?: { publish?: (name: string, data?: unknown) => void };
      designMode?: boolean;
      devNow?: string;
    };
  }
}
