// Centralized API configuration helper for local & live deployments
const STORAGE_KEY = 'lph_backend_api_url';

export function getApiBaseUrl() {
  if (typeof window !== 'undefined') {
    // 1. Check URL query param (?apiUrl=... or ?api=...)
    const params = new URLSearchParams(window.location.search);
    const paramUrl = params.get('apiUrl') || params.get('api');
    if (paramUrl) {
      const cleanUrl = paramUrl.trim().replace(/\/$/, '');
      localStorage.setItem(STORAGE_KEY, cleanUrl);
      return cleanUrl;
    }

    // 2. Check localStorage
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved.trim().replace(/\/$/, '');
  }

  // 3. Vite environment variable
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.trim().replace(/\/$/, '');
  }

  // 4. Default tunnel URL fallback if on Vercel preview/production
  if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
    return 'https://ministry-founded-refinance-construction.trycloudflare.com';
  }

  // 5. Local development fallback (uses relative path proxied by Vite)
  return '';
}

export function setApiBaseUrl(url) {
  if (typeof window !== 'undefined') {
    if (!url || !url.trim()) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, url.trim().replace(/\/$/, ''));
    }
  }
}

export function apiUrl(endpoint) {
  const base = getApiBaseUrl();
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return base ? `${base}${path}` : path;
}

export function assetUrl(path) {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
  const base = getApiBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${cleanPath}` : cleanPath;
}
