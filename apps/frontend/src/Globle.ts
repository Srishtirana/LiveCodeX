const isProd = import.meta.env.PROD;

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function toWebSocketUrl(url: string): string {
  const cleanUrl = stripTrailingSlash(url);

  if (cleanUrl.startsWith("https://")) {
    return `wss://${cleanUrl.slice("https://".length)}`;
  }

  if (cleanUrl.startsWith("http://")) {
    return `ws://${cleanUrl.slice("http://".length)}`;
  }

  return cleanUrl;
}

export const EXPRESS_BASE_URL = isProd
  ? stripTrailingSlash(import.meta.env.VITE_EXPRESS_URL)
  : `http://${window.location.hostname}:3000`;

export const WS_BASE_URL = isProd
  ? toWebSocketUrl(import.meta.env.VITE_WS_URL)
  : `ws://${window.location.hostname}:5000`;
