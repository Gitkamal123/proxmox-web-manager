import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Lock, User, AlertCircle, ArrowRight, Eye, EyeOff, Settings, 
  Wifi, Server, CheckCircle2, XCircle, RefreshCw, ChevronDown, ChevronUp, Zap
} from 'lucide-react';
import { 
  setStoredToken, setStoredUser, getApiBaseUrl, autoDiscoverServer, 
  getServerHost, setServerHost, getEffectiveServerUrl, testServerConnection,
  SERVER_CANDIDATE_HOSTS 
} from './config';

export default function LoginPage({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Server Config Drawer / Modal state
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [currentHost, setCurrentHostState] = useState(getServerHost());
  const [inputHost, setInputHost] = useState(getServerHost());
  const [testingHost, setTestingHost] = useState(false);
  const [testResult, setTestResult] = useState(null); // { success, latency, error }

  useEffect(() => {
    // Auto test initial connection
    testConnection(getServerHost());
    // Auto discover in background
    autoDiscoverServer().then((res) => {
      if (res && res.success) {
        setCurrentHostState(res.host);
        setInputHost(res.host);
        setTestResult({ success: true, latency: 20 });
      }
    }).catch(() => {});
  }, []);

  const testConnection = async (hostToTest) => {
    setTestingHost(true);
    setTestResult(null);
    try {
      const res = await testServerConnection(hostToTest);
      setTestResult(res);
      if (res.success) {
        setCurrentHostState(res.host);
      }
    } catch (e) {
      setTestResult({ success: false, error: 'Koneksi gagal' });
    } finally {
      setTestingHost(false);
    }
  };

  const handleSaveServerHost = (hostToSave) => {
    const target = hostToSave || inputHost;
    setServerHost(target);
    const resolved = getServerHost();
    setCurrentHostState(resolved);
    setInputHost(resolved);
    testConnection(resolved);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Silakan masukkan username dan password.');
      return;
    }

    setLoading(true);
    const apiUrl = `${getApiBaseUrl()}/auth/login`;

    try {
      const response = await axios.post(apiUrl, {
        username: username.trim(),
        password: password
      }, { timeout: 8000 });

      if (response.data?.success && response.data?.token) {
        setStoredToken(response.data.token);
        setStoredUser(response.data.user);
        if (onLoginSuccess) {
          onLoginSuccess(response.data.user, response.data.token);
        }
      } else {
        setError(response.data?.message || 'Username atau password salah.');
      }
    } catch (err) {
      console.error('Login error:', err);
      if (err.response?.data?.message) {
        setError(err.response.data.message);
      } else if (err.code === 'ECONNABORTED' || err.message?.includes('Network Error')) {
        const effectiveUrl = getEffectiveServerUrl();
        setError(`Gagal menghubungi server (${effectiveUrl}). Pastikan PC Server dan HP terhubung ke jaringan yang sama atau periksa IP server.`);
        setShowServerSettings(true); // Otomatis buka form ganti IP agar user mudah memasukkan IP yang benar
      } else {
        setError('Terjadi kesalahan saat memproses login.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Background Decorative Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[550px] h-[550px] bg-gradient-to-tr from-purple-600/20 via-indigo-600/15 to-violet-600/10 rounded-full blur-3xl pointer-events-none -z-10 animate-pulse"></div>

      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-2xl space-y-5 relative">
        
        {/* Header Branding with new Purple Lightning Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 bg-gradient-to-br from-purple-600/25 to-indigo-600/10 rounded-2xl border border-purple-500/30 shadow-lg shadow-purple-900/30 text-purple-400 mb-1">
            <svg className="w-10 h-10" viewBox="0 0 100 100" fill="none">
              <defs>
                <linearGradient id="loginLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#7C3AED" />
                  <stop offset="50%" stopColor="#A855F7" />
                  <stop offset="100%" stopColor="#6366F1" />
                </linearGradient>
                <filter id="loginGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>
              <polygon points="34,32 66,32 53,49 74,49 46,73 52,58 28,58 42,44 24,44" fill="#8B5CF6" opacity="0.4" filter="url(#loginGlow)" />
              <polygon points="34,32 66,32 53,49 74,49 46,73 52,58 28,58 42,44 24,44" fill="url(#loginLogoGrad)" />
            </svg>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center justify-center gap-1.5">
            FTTH Proxmox Manager
          </h1>
          <p className="text-xs text-slate-400">
            Datacenter & Virtualization Control Portal
          </p>
        </div>

        {/* Server Host Status Pill & Quick Toggle */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-2.5">
          <button 
            type="button"
            onClick={() => setShowServerSettings(!showServerSettings)}
            className="w-full flex items-center justify-between text-xs text-left text-slate-300 hover:text-white transition px-1 py-0.5"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <Server className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span className="text-slate-400">Target:</span>
              <span className="font-mono text-purple-300 font-medium truncate">
                {currentHost}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 pl-2">
              {testingHost ? (
                <span className="flex items-center gap-1 text-[11px] text-amber-400 font-medium">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Tes...
                </span>
              ) : testResult?.success ? (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3" /> Online {testResult.latency ? `(${testResult.latency}ms)` : ''}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-rose-400 font-medium bg-rose-950/60 px-2 py-0.5 rounded-full border border-rose-500/30">
                  <XCircle className="w-3 h-3" /> Offline
                </span>
              )}
              {showServerSettings ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
            </div>
          </button>

          {/* Expandable Server Host Configuration Drawer */}
          {showServerSettings && (
            <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-3 animate-in fade-in slide-in-from-top-2">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                  <span>Alamat Server / IP Laptop</span>
                  <span className="text-[10px] text-slate-500">Port default: 5000</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputHost}
                    onChange={(e) => setInputHost(e.target.value)}
                    placeholder="Contoh: 10.10.1.80:5000"
                    className="flex-1 bg-slate-900 border border-slate-700 focus:border-purple-500 px-3 py-1.5 rounded-xl text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveServerHost(inputHost)}
                    disabled={testingHost}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white text-xs font-bold rounded-xl shadow transition disabled:opacity-50 flex items-center gap-1"
                  >
                    {testingHost ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Terapkan'}
                  </button>
                </div>
              </div>

              {/* Quick Candidates Buttons */}
              <div className="space-y-1">
                <div className="text-[10px] font-medium text-slate-400">Pilihan Cepat Server:</div>
                <div className="flex flex-wrap gap-1.5">
                  {SERVER_CANDIDATE_HOSTS.map((cHost) => (
                    <button
                      key={cHost}
                      type="button"
                      onClick={() => {
                        setInputHost(cHost);
                        handleSaveServerHost(cHost);
                      }}
                      className={`text-[10px] px-2 py-1 rounded-lg border font-mono transition flex items-center gap-1 ${
                        currentHost === cHost 
                          ? 'bg-purple-950/80 border-purple-500 text-purple-200' 
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <Wifi className="w-2.5 h-2.5" />
                      <span>{cHost}</span>
                    </button>
                  ))}
                </div>
              </div>

              {testResult && !testResult.success && testResult.error && (
                <div className="text-[11px] text-rose-400 bg-rose-950/40 p-2 rounded-lg border border-rose-900/50 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{testResult.error}. Pastikan laptop server sudah menyalakan backend dan HP terhubung ke Wi-Fi yang sama.</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-3 bg-rose-950/70 border border-rose-500/50 rounded-xl text-rose-300 text-xs flex items-start gap-2.5 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">
              {error}
            </div>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Input Username */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" /> Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="Masukkan username"
              autoComplete="username"
              className="w-full bg-slate-800/90 border border-slate-700 focus:border-purple-500 px-4 py-2.5 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none transition shadow-inner font-mono"
            />
          </div>

          {/* Input Password */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-slate-400" /> Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Masukkan password"
                autoComplete="current-password"
                className="w-full bg-slate-800/90 border border-slate-700 focus:border-purple-500 pl-4 pr-10 py-2.5 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none transition shadow-inner font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 p-0.5">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-purple-600 via-purple-700 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 active:scale-[0.99] text-white font-bold rounded-xl shadow-lg shadow-purple-900/30 transition flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer mt-2">
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span>Memverifikasi...</span>
              </>
            ) : (
              <>
                <span>Masuk ke Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer Info */}
        <div className="pt-2 border-t border-slate-800 text-center flex items-center justify-center text-[11px] text-slate-500">
          <span className="font-mono">FTTH Lab Datacenter Portal</span>
        </div>
      </div>
    </div>
  );
}
