import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, Maximize2, Minimize2, X, RotateCcw, 
  CornerDownLeft, Shield, AlertCircle, CheckCircle2, 
  Plus, Send, Copy, ArrowLeft, Monitor
} from 'lucide-react';
import { getServerHost, getWsProtocol } from './config';

export default function ConsoleWorkspace({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onReconnectTab,
  onOpenNewConsole,
  allVms = [],
  onBackToDashboard
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [showNewDropdown, setShowNewDropdown] = useState(false);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  return (
    <div className={`flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 ${
      fullscreen 
        ? 'fixed inset-0 z-[200] rounded-none border-0' 
        : 'w-full h-[calc(100vh-140px)] min-h-[580px]'
    }`}>
      {/* 1. TOP TAB BAR */}
      <div className="flex items-center justify-between bg-slate-950 px-3 pt-2 border-b border-slate-800 select-none overflow-x-auto">
        <div className="flex items-center gap-1">
          {/* Back to Dashboard Button */}
          {onBackToDashboard && !fullscreen && (
            <button
              onClick={onBackToDashboard}
              className="flex items-center gap-1.5 px-3 py-1.5 mr-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
              title="Kembali ke Dashboard Utama">
              <ArrowLeft className="w-3.5 h-3.5 text-orange-400" />
              <span>Dashboard</span>
            </button>
          )}

          {/* Console Tabs */}
          {tabs.map(tab => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`group flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-t-xl cursor-pointer border-t border-x transition-all ${
                  isActive
                    ? 'bg-slate-900 text-white border-slate-700 shadow-md border-b-transparent'
                    : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border-transparent'
                }`}>
                {/* Status Dot */}
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  tab.status === 'connected' ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50 animate-pulse' :
                  tab.status === 'connecting' ? 'bg-amber-400 animate-ping' :
                  'bg-rose-500'
                }`} />

                <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" />

                <span className="truncate max-w-[130px]" title={tab.item?.name || `ID ${tab.item?.vmid}`}>
                  {tab.item?.name || `ID ${tab.item?.vmid}`}
                </span>

                <span className="text-[10px] text-slate-400 font-mono">
                  ({tab.item?.type === 'qemu' ? 'VM' : 'LXC'})
                </span>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="p-0.5 ml-1 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition"
                  title="Tutup tab ini">
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* Plus button to open another console */}
          <div className="relative">
            <button
              onClick={() => setShowNewDropdown(prev => !prev)}
              className="flex items-center gap-1 px-2.5 py-1.5 ml-1 text-xs text-slate-400 hover:text-white bg-slate-900/60 hover:bg-slate-800 rounded-lg border border-slate-800 transition"
              title="Buka console VM/LXC lain">
              <Plus className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Buka Console</span>
            </button>

            {/* Dropdown list of available running VMs/LXCs */}
            {showNewDropdown && (
              <div className="absolute left-0 mt-1 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-2 z-50 max-h-72 overflow-y-auto">
                <div className="px-3 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  Pilih VM / LXC Berjalan:
                </div>
                {allVms.filter(v => v.status === 'running').length === 0 ? (
                  <div className="px-3 py-3 text-xs text-slate-400 text-center">
                    Tidak ada VM/LXC yang aktif
                  </div>
                ) : (
                  allVms
                    .filter(v => v.status === 'running')
                    .map(v => (
                      <button
                        key={`${v.node}-${v.type}-${v.vmid}`}
                        onClick={() => {
                          onOpenNewConsole(v);
                          setShowNewDropdown(false);
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 hover:text-sky-400 text-left transition">
                        <span className="truncate">{v.name || `ID ${v.vmid}`}</span>
                        <span className="text-[10px] text-slate-400 font-mono ml-2">
                          {v.type.toUpperCase()} • ID {v.vmid}
                        </span>
                      </button>
                    ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Global Toolbar Quick Controls */}
        <div className="flex items-center gap-2 pb-1.5">
          <button
            onClick={() => setFullscreen(f => !f)}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
            title={fullscreen ? 'Kecilkan layar (Exit Fullscreen)' : 'Perbesar Layar Penuh (Fullscreen)'}>
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 2. ACTIVE SESSION TOOLBAR & CONTROL PANEL */}
      {activeTab && (
        <div className="flex flex-wrap items-center justify-between px-4 py-2 bg-slate-800/90 border-b border-slate-700/80 gap-2 shrink-0">
          {/* Machine Info & Status */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-white">
                {activeTab.item?.name || `ID ${activeTab.item?.vmid}`}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-mono">
                {activeTab.item?.type === 'qemu' ? 'KVM/QEMU' : 'LXC Container'}
              </span>
              <span className="text-xs text-slate-400">
                Node: <strong className="text-slate-200">{activeTab.item?.node}</strong> • ID: <strong className="text-slate-200">{activeTab.item?.vmid}</strong>
              </span>
            </div>

            {/* Status Pill */}
            <div className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full border">
              {activeTab.status === 'connected' ? (
                <span className="flex items-center gap-1.5 text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Terhubung
                </span>
              ) : activeTab.status === 'connecting' ? (
                <span className="flex items-center gap-1.5 text-amber-400 border-amber-500/30 bg-amber-500/10">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                  Menghubungkan...
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-rose-400 border-rose-500/30 bg-rose-500/10">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Terputus
                </span>
              )}
            </div>
          </div>

          {/* Interactive Keyboard & Console Quick Buttons */}
          <div className="flex items-center gap-2">
            {/* WAKE UP / ENTER BUTTON */}
            <button
              onClick={() => activeTab.sendEnter && activeTab.sendEnter()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600/20 hover:bg-sky-600 text-sky-300 hover:text-white text-xs font-semibold rounded-lg border border-sky-500/40 transition shadow-sm"
              title="Kirim tombol Enter (Sangat berguna untuk memunculkan prompt login Linux LXC/VM)">
              <CornerDownLeft className="w-3.5 h-3.5" />
              <span>Kirim Enter</span>
            </button>

            {/* Ctrl + Alt + Del */}
            <button
              onClick={() => activeTab.sendCtrlAltDel && activeTab.sendCtrlAltDel()}
              className="px-2.5 py-1.5 bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white text-xs font-semibold rounded-lg border border-red-500/30 transition"
              title="Kirim Ctrl+Alt+Del">
              Ctrl+Alt+Del
            </button>

            {/* Esc Key */}
            <button
              onClick={() => activeTab.sendEsc && activeTab.sendEsc()}
              className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-lg transition"
              title="Kirim tombol Escape">
              Esc
            </button>

            {/* Tab Key */}
            <button
              onClick={() => activeTab.sendTab && activeTab.sendTab()}
              className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-lg transition"
              title="Kirim tombol Tab">
              Tab
            </button>

            {/* Focus Keyboard */}
            <button
              onClick={() => activeTab.focusCanvas && activeTab.focusCanvas()}
              className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-lg transition"
              title="Fokuskan Keyboard ke Layar Console">
              Fokus Keyboard
            </button>

            {/* Send Text / Command Modal */}
            <button
              onClick={() => setShowPasteModal(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-lg transition"
              title="Ketik atau paste perintah langsung ke terminal">
              <Send className="w-3 h-3 text-orange-400" />
              <span>Ketik/Paste</span>
            </button>

            {/* Reconnect */}
            <button
              onClick={() => onReconnectTab(activeTab.id)}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition"
              title="Hubungkan Ulang (Reconnect)">
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Close */}
            <button
              onClick={() => onCloseTab(activeTab.id)}
              className="p-1.5 text-slate-300 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
              title="Tutup Console">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 3. HELPER BANNER */}
      <div className="bg-slate-950/90 px-4 py-1.5 border-b border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sky-400 font-bold">💡 Tips:</span>
          <span>
            Jika layar console awal hitam/kosong, klik tombol <strong className="text-sky-300">"Kirim Enter"</strong> di toolbar atas atau klik di dalam console untuk memunculkan prompt login Linux.
          </span>
        </div>
        <div className="text-slate-500 font-mono text-[10px] hidden md:block">
          Proxmox RFB VNC Engine
        </div>
      </div>

      {/* 4. CONSOLE SESSIONS CANVAS CONTAINER */}
      <div className="flex-1 relative bg-[#020617] overflow-hidden flex items-center justify-center">
        {tabs.length === 0 ? (
          <div className="text-center p-8 text-slate-400">
            <Monitor className="w-12 h-12 mx-auto mb-3 text-slate-600" />
            <h4 className="text-base font-semibold text-slate-300 mb-1">Tidak ada Console yang aktif</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
              Pilih VM atau LXC dari Dashboard atau klik tombol "Buka Console" di atas untuk memulai sesi console.
            </p>
            {onBackToDashboard && (
              <button
                onClick={onBackToDashboard}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold rounded-xl shadow-lg transition">
                Kembali ke Dashboard
              </button>
            )}
          </div>
        ) : (
          tabs.map(tab => (
            <TabSessionView
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
            />
          ))
        )}
      </div>

      {/* 5. PASTE / SEND TEXT MODAL */}
      {showPasteModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Send className="w-4 h-4 text-orange-400" />
                Kirim Teks / Perintah ke Console
              </h4>
              <button
                onClick={() => setShowPasteModal(false)}
                className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Ketikkan teks atau paste perintah di bawah. Teks akan dikirimkan langsung ke terminal sesi aktif.
            </p>
            <textarea
              rows={4}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder="Contoh: root atau ls -la atau perintah lainnya..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500 mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowPasteModal(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg">
                Batal
              </button>
              <button
                onClick={() => {
                  if (activeTab?.pasteText && pasteText) {
                    activeTab.pasteText(pasteText);
                    setPasteText('');
                    setShowPasteModal(false);
                  }
                }}
                className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg shadow transition">
                Kirim ke Terminal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// INDIVIDUAL SESSION VIEW COMPONENT
function TabSessionView({ tab, isActive }) {
  const containerRef = useRef(null);
  const rfbRef = useRef(null);

  useEffect(() => {
    let active = true;
    let rfb = null;

    const timer = setTimeout(() => {
      if (!containerRef.current || !active) return;
      containerRef.current.innerHTML = '';

      import('@novnc/novnc').then(({ default: RFB }) => {
        if (!active || !containerRef.current) return;

        const { item, ticket, port } = tab;
        const wsProtocol = getWsProtocol();
        const wsHost = getServerHost();
        const wsUrl = `${wsProtocol}//${wsHost}/api/vncproxy/${item.node}/${item.type}/${item.vmid}?port=${port}&vncticket=${encodeURIComponent(ticket)}`;

        console.log(`[noVNC Tab ${tab.id}] Connecting to:`, wsUrl);
        tab.updateStatus('connecting');

        try {
          // Pass credentials with ticket as password for Proxmox VNC challenge authentication!
          rfb = new RFB(containerRef.current, wsUrl, {
            credentials: { password: ticket }
          });

          rfb.scaleViewport = true;
          rfb.resizeSession = true;
          rfb.background = '#020617';
          rfb.focusOnClick = true;

          rfb.addEventListener('connect', () => {
            console.log(`[noVNC Tab ${tab.id}] Connected`);
            tab.updateStatus('connected');
            setTimeout(() => {
              try { rfb.focus(); } catch(e) {}
            }, 100);
          });

          rfb.addEventListener('credentialsrequired', () => {
            console.log(`[noVNC Tab ${tab.id}] Credentials required, sending ticket...`);
            rfb.sendCredentials({ password: ticket });
          });

          rfb.addEventListener('disconnect', (e) => {
            console.log(`[noVNC Tab ${tab.id}] Disconnected`, e.detail);
            tab.updateStatus('disconnected');
          });

          rfb.addEventListener('securityfailure', (e) => {
            console.error(`[noVNC Tab ${tab.id}] Security failure:`, e.detail);
            tab.updateStatus('error');
          });

          rfbRef.current = rfb;

          // Expose helper actions to the tab object
          tab.sendEnter = () => {
            if (rfbRef.current) {
              rfbRef.current.sendKey(0xFF0D, 'Enter');
              rfbRef.current.focus();
            }
          };

          tab.sendCtrlAltDel = () => {
            if (rfbRef.current) {
              rfbRef.current.sendCtrlAltDel();
              rfbRef.current.focus();
            }
          };

          tab.sendEsc = () => {
            if (rfbRef.current) {
              rfbRef.current.sendKey(0xFF1B, 'Escape');
              rfbRef.current.focus();
            }
          };

          tab.sendTab = () => {
            if (rfbRef.current) {
              rfbRef.current.sendKey(0xFF09, 'Tab');
              rfbRef.current.focus();
            }
          };

          tab.focusCanvas = () => {
            if (rfbRef.current) {
              rfbRef.current.focus();
            }
          };

          tab.pasteText = (text) => {
            if (rfbRef.current && text) {
              // Kirim karakter satu demi satu atau clipboardPasteFrom
              try {
                rfbRef.current.clipboardPasteFrom(text);
              } catch (e) {
                // Fallback: kirim character keys
                for (let i = 0; i < text.length; i++) {
                  const charCode = text.charCodeAt(i);
                  rfbRef.current.sendKey(charCode, null);
                }
              }
              rfbRef.current.focus();
            }
          };

        } catch (err) {
          console.error(`[noVNC Tab ${tab.id}] Init error:`, err);
          tab.updateStatus('error');
        }
      }).catch(err => {
        console.error(`[noVNC Tab ${tab.id}] Import error:`, err);
        tab.updateStatus('error');
      });
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
      if (rfbRef.current) {
        try { rfbRef.current.disconnect(); } catch (e) {}
        rfbRef.current = null;
      }
    };
  }, [tab.ticket, tab.port]);

  // Focus canvas whenever tab becomes active
  useEffect(() => {
    if (isActive && rfbRef.current) {
      setTimeout(() => {
        try { rfbRef.current.focus(); } catch (e) {}
      }, 50);
    }
  }, [isActive]);

  return (
    <div
      style={{ display: isActive ? 'flex' : 'none' }}
      className="absolute inset-0 flex items-center justify-center p-2 cursor-text"
      onClick={() => {
        if (rfbRef.current) {
          try { rfbRef.current.focus(); } catch (e) {}
        }
      }}>
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center overflow-hidden"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
