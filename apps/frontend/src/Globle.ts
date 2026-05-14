const isProd = import.meta.env.PROD;

export const EXPRESS_BASE_URL = isProd
  ? import.meta.env.VITE_EXPRESS_URL
  : `http://${window.location.hostname}:3000`;

export const WS_BASE_URL = isProd
  ? import.meta.env.VITE_WS_URL
  : `ws://${window.location.hostname}:5000`;