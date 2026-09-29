import axios from 'axios';

// Centralized Config for Proxmox Web Management & Mobile APK

export const STORAGE_KEYS = {
  SERVER_HOST: 'pmx_server_host',
  AUTH_TOKEN: 'pmx_auth_token',
  AUTH_USER: 'pmx_auth_user',
  SAVED_CREDENTIALS: 'pmx_saved_credentials'
};

// Daftar kandidat auto-discovery server untuk semua jaringan (Wi-Fi Lokal, Tailscale, & Domain Publik)
export const SERVER_CANDIDATE_HOSTS = [
  '10.10.1.80:5000',              // Wi-Fi Lokal Laptop / PC Server saat ini
  '100.94.136.73:5000',           // Tailscale IP
  'localhost:5000',               // Localhost
  '192.168.1.5:5000',             // Wi-Fi Alternatif
  'rizkyz.tail5d22f4.ts.net'       // Tailscale Funnel / Public Domain
];

/**
 * Mendapatkan host backend server yang aktif.
 */
export function getServerHost() {
  if (typeof window === 'undefined') return '10.10.1.80:5000';

  const savedHost = localStorage.getItem(STORAGE_KEYS.SERVER_HOST);
  if (savedHost && savedHost.trim()) {
    return cleanHostString(savedHost.trim());
  }

  const hostname = window.location.hostname;
  if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1' && !window.location.href.startsWith('capacitor://')) {
    const port = window.location.port ? `:${window.location.port}` : '';
    return `${hostname}${port || ':5000'}`;
  }

  // Default prioritas untuk Mobile APK: IP Wi-Fi Server
  return '10.10.1.80:5000';
}

export function cleanHostString(raw) {
  if (!raw) return '10.10.1.80:5000';
  let clean = raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  // Jika hanya IP tanpa port dan bukan domain public
  if (!clean.includes(':') && !clean.includes('.ts.net') && !clean.includes('.trycloudflare.com') && !clean.includes('.loca.lt')) {
    clean = `${clean}:5000`;
  }
  return clean;
}

/**
 * Simpan server host
 */
export function setServerHost(host) {
  if (!host || !host.trim()) {
    localStorage.removeItem(STORAGE_KEYS.SERVER_HOST);
    return;
  }
  localStorage.setItem(STORAGE_KEYS.SERVER_HOST, cleanHostString(host.trim()));
}

export function isHttpsTarget(host) {
  const h = host || getServerHost();
  return h.includes('.ts.net') || h.includes('.trycloudflare.com') || h.includes('.loca.lt') || (typeof window !== 'undefined' && window.location.protocol === 'https:');
}

export function getEffectiveServerUrl(host) {
  const targetHost = cleanHostString(host || getServerHost());
  const protocol = isHttpsTarget(targetHost) ? 'https:' : 'http:';
  return `${protocol}//${targetHost}`;
}

/**
 * Tes koneksi ke server backend dengan timeout dan latency check
 */
export async function testServerConnection(host) {
  const targetHost = cleanHostString(host || getServerHost());
  const protocol = isHttpsTarget(targetHost) ? 'https:' : 'http:';
  const url = `${protocol}//${targetHost}/api/config`;
  
  const startTime = Date.now();
  try {
    const res = await axios.get(url, { timeout: 3500 });
    const latency = Date.now() - startTime;
    if (res.data) {
      return { 
        success: true, 
        host: targetHost, 
        latency, 
        data: res.data,
        proxmoxHost: res.data.proxmoxHost || null
      };
    }
  } catch (err) {
    const latency = Date.now() - startTime;
    let message = 'Gagal menghubungi server';
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      message = 'Koneksi timeout (server tidak merespons)';
    } else if (err.message?.includes('Network Error')) {
      message = 'Network Error (IP salah atau beda Wi-Fi)';
    } else if (err.response?.status) {
      message = `Server merespons error ${err.response.status}`;
    }
    return { 
      success: false, 
      host: targetHost, 
      latency, 
      error: message 
    };
  }
  return { success: false, host: targetHost, latency: 0, error: 'Tidak ada respons' };
}

/**
 * Auto-Discovery: Memindai kandidat host di jaringan secara paralel
 */
export async function autoDiscoverServer() {
  const currentHost = getServerHost();
  const candidates = Array.from(new Set([
    currentHost,
    typeof window !== 'undefined' && window.location.hostname && !window.location.href.startsWith('capacitor://') && window.location.hostname !== 'localhost' ? `${window.location.hostname}:5000` : null,
    ...SERVER_CANDIDATE_HOSTS
  ])).filter(Boolean);

  const probe = async (host) => {
    try {
      const clean = cleanHostString(host);
      const protocol = isHttpsTarget(clean) ? 'https:' : 'http:';
      const res = await axios.get(`${protocol}//${clean}/api/config`, { timeout: 2500 });
      if (res.data && res.data.proxmoxHost) {
        return { success: true, host: clean, data: res.data };
      }
    } catch (e) {
      // Ignore failure
    }
    return null;
  };

  try {
    const results = await Promise.all(candidates.map(c => probe(c)));
    const active = results.find(r => r && r.success);
    if (active) {
      setServerHost(active.host);
      return { success: true, host: active.host, data: active.data };
    }
  } catch (err) {}

  return { success: false, host: currentHost };
}

export function getApiBaseUrl() {
  const host = getServerHost();
  const protocol = isHttpsTarget(host) ? 'https:' : 'http:';
  return `${protocol}//${host}/api`;
}

export function getSocketUrl() {
  const host = getServerHost();
  const protocol = isHttpsTarget(host) ? 'https:' : 'http:';
  return `${protocol}//${host}`;
}

export function getWsProtocol() {
  const host = getServerHost();
  return isHttpsTarget(host) ? 'wss:' : 'ws:';
}

export function getWsHost() {
  const host = getServerHost();
  return host.split(':')[0];
}

export function getWsPort() {
  const host = getServerHost();
  const parts = host.split(':');
  return parts.length > 1 ? parts[1] : (isHttpsTarget(host) ? '443' : '5000');
}

// Global dynamic Axios instance with auto-resolved baseURL and Bearer token
export const api = axios.create();

api.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth Token Helpers
export function getStoredToken() {
  return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) || null;
}

export function setStoredToken(token) {
  if (token) {
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
  } else {
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AUTH_USER);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setStoredUser(user) {
  if (user) {
    localStorage.setItem(STORAGE_KEYS.AUTH_USER, JSON.stringify(user));
  } else {
    localStorage.removeItem(STORAGE_KEYS.AUTH_USER);
  }
}

export function clearAuthSession() {
  localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.AUTH_USER);
}
