import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, Maximize2, Minimize2, X, Minus, LayoutGrid
} from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getServerHost, getWsProtocol } from './config';

export default function ConsoleWindow({
  session,
  index = 0,
  isActive = true,
  onFocus,
  onClose
}) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [snapPreset, setSnapPreset] = useState(null); // Snap Layout preset
  const [showSnapMenu, setShowSnapMenu] = useState(false);
  const [status, setStatus] = useState('connecting'); // 'connecting' | 'connected' | 'disconnected' | 'error'

  const isNodeShell = session.item?.type === 'node';

  // Position and Size state for dragging & manual resizing
  const defaultWidth = Math.min(850, typeof window !== 'undefined' ? window.innerWidth - 60 : 800);
  const defaultHeight = Math.min(540, typeof window !== 'undefined' ? window.innerHeight - 100 : 500);
  
  const [pos, setPos] = useState({
    x: Math.max(20, 60 + (index % 6) * 35),
    y: Math.max(20, 50 + (index % 6) * 35)
  });
  const [size, setSize] = useState({
    width: defaultWidth,
    height: defaultHeight
  });

  const containerRef = useRef(null);
  const rfbRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const snapMenuRef = useRef(null);
  const snapTimerRef = useRef(null);

  useEffect(() => {
    let active = true;

    const timer = setTimeout(() => {
      if (!containerRef.current || !active) return;
      containerRef.current.innerHTML = '';

      const { item, ticket, port } = session;
      const wsProtocol = getWsProtocol();
      const wsHost = getServerHost();

      if (isNodeShell) {
        // === 1. XTERM.JS TERMINAL UNTUK PVE HOST NODE SHELL ===
        try {
          const term = new XTerm({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
            theme: {
              background: '#020617',
              foreground: '#e2e8f0',
              cursor: '#38bdf8',
              selectionBackground: '#38bdf844'
            }
          });

          const fitAddon = new FitAddon();
          term.loadAddon(fitAddon);
          term.open(containerRef.current);

          setTimeout(() => {
            try { 
              fitAddon.fit(); 
              term.focus();
            } catch (e) {}
          }, 60);

          const userParam = session.user ? `&user=${encodeURIComponent(session.user)}` : '';
          const wsUrl = `${wsProtocol}//${wsHost}/api/vncproxy/node/${item.node}?port=${port}&vncticket=${encodeURIComponent(ticket)}${userParam}`;
          const ws = new WebSocket(wsUrl);
          ws.binaryType = 'arraybuffer';

          let pingTimer = null;

          ws.onopen = () => {
            if (!active) return;
            setStatus('connected');
            setTimeout(() => {
              try { 
                fitAddon.fit(); 
                term.focus();
                // Send initial terminal dimensions to Proxmox termproxy (1:cols:rows:)
                if (term.cols && term.rows) {
                  ws.send(`1:${term.cols}:${term.rows}:`);
                }
              } catch (e) {}
            }, 100);

            // Keepalive ping for termproxy
            pingTimer = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                try { ws.send('2'); } catch(e) {}
              }
            }, 25000);
          };

          ws.onmessage = (event) => {
            if (!active) return;
            if (typeof event.data === 'string') {
              if (event.data === 'OK\n' || event.data === 'OK') return;
              term.write(event.data);
            } else if (event.data instanceof ArrayBuffer) {
              const text = new TextDecoder().decode(event.data);
              if (text === 'OK\n' || text === 'OK') return;
              term.write(text);
            }
          };

          // Proxmox termproxy protocol for STDIN: 0:<byte_length>:<data>
          term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
              const bytes = new TextEncoder().encode(data);
              ws.send(`0:${bytes.length}:${data}`);
            }
          });

          // Proxmox termproxy protocol for RESIZE: 1:<cols>:<rows>:
          term.onResize(({ cols, rows }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(`1:${cols}:${rows}:`);
            }
          });

          ws.onclose = () => {
            if (pingTimer) clearInterval(pingTimer);
            if (active) setStatus('disconnected');
          };

          ws.onerror = (err) => {
            if (pingTimer) clearInterval(pingTimer);
            console.error('[xterm] WS error:', err);
            if (active) setStatus('error');
          };

          xtermRef.current = term;
          fitAddonRef.current = fitAddon;
          wsRef.current = ws;
        } catch (err) {
          console.error('[xterm] Init error:', err);
          setStatus('error');
        }
      } else {
        // === 2. noVNC (RFB) UNTUK VM (QEMU) & LXC CONTAINER ===
        import('@novnc/novnc').then(({ default: RFB }) => {
          if (!active || !containerRef.current) return;

          const wsUrl = `${wsProtocol}//${wsHost}/api/vncproxy/${item.node}/${item.type}/${item.vmid}?port=${port}&vncticket=${encodeURIComponent(ticket)}`;

          setStatus('connecting');

          try {
            const rfb = new RFB(containerRef.current, wsUrl, {
              credentials: { password: ticket }
            });

            rfb.scaleViewport = true;
            rfb.resizeSession = true;
            rfb.background = '#020617';
            rfb.focusOnClick = true;

            rfb.addEventListener('connect', () => {
              setStatus('connected');
              setTimeout(() => {
                try { rfb.focus(); } catch (e) {}
              }, 100);
            });

            rfb.addEventListener('credentialsrequired', () => {
              rfb.sendCredentials({ password: ticket });
            });

            rfb.addEventListener('disconnect', () => {
              setStatus('disconnected');
            });

            rfb.addEventListener('securityfailure', () => {
              setStatus('error');
            });

            rfbRef.current = rfb;
          } catch (err) {
            console.error('[noVNC] Init error:', err);
            setStatus('error');
          }
        }).catch(err => {
          console.error('[noVNC] Import error:', err);
          setStatus('error');
        });
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (e) {}
        wsRef.current = null;
      }
      if (xtermRef.current) {
        try { xtermRef.current.dispose(); } catch (e) {}
        xtermRef.current = null;
      }
      if (rfbRef.current) {
        try { rfbRef.current.disconnect(); } catch (e) {}
        rfbRef.current = null;
      }
    };
  }, [session.ticket, session.port, isNodeShell]);

  // Refit on size / maximize / snap change
  useEffect(() => {
    if (isNodeShell && fitAddonRef.current) {
      setTimeout(() => {
        try { 
          fitAddonRef.current.fit(); 
          if (xtermRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(`1:${xtermRef.current.cols}:${xtermRef.current.rows}:`);
          }
        } catch (e) {}
      }, 100);
    }
  }, [size, isMaximized, snapPreset, isNodeShell]);

  // AUTO-LOGOUT ON CLOSE HANDLER
  const handleClose = () => {
    if (isNodeShell && wsRef.current && status === 'connected') {
      try {
        const exitCmd = '\x03\nexit\n';
        const bytes = new TextEncoder().encode(exitCmd);
        wsRef.current.send(`0:${bytes.length}:${exitCmd}`);
      } catch (e) {}
      setTimeout(() => {
        onClose();
      }, 100);
    } else if (rfbRef.current && status === 'connected') {
      try {
        rfbRef.current.sendKey(0xffe3, 'ControlLeft', true);
        rfbRef.current.sendKey(0x0063, 'KeyC', true);
        rfbRef.current.sendKey(0x0063, 'KeyC', false);
        rfbRef.current.sendKey(0xffe3, 'ControlLeft', false);

        const exitCmd = ['\n', 'e', 'x', 'i', 't', '\n'];
        exitCmd.forEach(ch => {
          const sym = ch === '\n' ? 0xff0d : ch.charCodeAt(0);
          rfbRef.current.sendKey(sym, null, true);
          rfbRef.current.sendKey(sym, null, false);
        });
      } catch (e) {
        console.warn('[noVNC] Error sending logout:', e);
      }
      setTimeout(() => {
        onClose();
      }, 120);
    } else {
      onClose();
    }
  };

  const handleFocus = () => {
    if (onFocus) onFocus();
    if (isNodeShell && xtermRef.current) {
      try { xtermRef.current.focus(); } catch (e) {}
    } else if (rfbRef.current) {
      try { rfbRef.current.focus(); } catch (e) {}
    }
  };

  // DRAG HANDLER (Pindah posisi jendela via Titlebar)
  const handleDragStart = (e) => {
    if (e.target.closest('button') || isMaximized || snapPreset) return;
    e.preventDefault();
    handleFocus();

    const startX = e.clientX;
    const startY = e.clientY;
    const initialPosX = pos.x;
    const initialPosY = pos.y;

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 180, initialPosX + deltaX)),
        y: Math.max(0, Math.min(window.innerHeight - 80, initialPosY + deltaY))
      });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // RESIZE HANDLERS (Ubah ukuran jendela secara manual)
  const handleResizeStart = (e, direction) => {
    e.stopPropagation();
    e.preventDefault();
    handleFocus();
    if (isMaximized || snapPreset) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = size.width;
    const startHeight = size.height;

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      setSize(prev => ({
        width: direction.includes('right') ? Math.max(420, startWidth + deltaX) : prev.width,
        height: direction.includes('bottom') ? Math.max(280, startHeight + deltaY) : prev.height
      }));
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // SNAP LAYOUT APPLY
  const applySnap = (preset) => {
    setIsMaximized(false);
    setSnapPreset(preset);
    setShowSnapMenu(false);
    handleFocus();
  };

  const getSnapStyles = () => {
    if (isMaximized) {
      return {
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        borderRadius: '0px'
      };
    }

    if (!snapPreset) {
      return {
        top: `${pos.y}px`,
        left: `${pos.x}px`,
        width: `${size.width}px`,
        height: `${size.height}px`
      };
    }

    // Windows 11 Snap Presets
    const pad = 6;
    switch (snapPreset) {
      // 1. Split Left / Right (50/50)
      case 'left-50':
        return { top: `${pad}px`, left: `${pad}px`, width: `calc(50vw - ${pad * 1.5}px)`, height: `calc(100vh - ${pad * 2}px)` };
      case 'right-50':
        return { top: `${pad}px`, left: `calc(50vw + ${pad * 0.5}px)`, width: `calc(50vw - ${pad * 1.5}px)`, height: `calc(100vh - ${pad * 2}px)` };

      // 2. Split 2/3 + 1/3
      case 'left-66':
        return { top: `${pad}px`, left: `${pad}px`, width: `calc(66.66vw - ${pad * 1.5}px)`, height: `calc(100vh - ${pad * 2}px)` };
      case 'right-33':
        return { top: `${pad}px`, left: `calc(66.66vw + ${pad * 0.5}px)`, width: `calc(33.33vw - ${pad * 1.5}px)`, height: `calc(100vh - ${pad * 2}px)` };

      // 3. 3 Columns
      case 'col3-left':
        return { top: `${pad}px`, left: `${pad}px`, width: `calc(33.33vw - ${pad * 1.33}px)`, height: `calc(100vh - ${pad * 2}px)` };
      case 'col3-mid':
        return { top: `${pad}px`, left: `calc(33.33vw + ${pad * 0.66}px)`, width: `calc(33.33vw - ${pad * 1.33}px)`, height: `calc(100vh - ${pad * 2}px)` };
      case 'col3-right':
        return { top: `${pad}px`, left: `calc(66.66vw + ${pad * 0.66}px)`, width: `calc(33.33vw - ${pad * 1.33}px)`, height: `calc(100vh - ${pad * 2}px)` };

      // 4. 2x2 Grid (4 Quadrants)
      case 'quad-tl':
        return { top: `${pad}px`, left: `${pad}px`, width: `calc(50vw - ${pad * 1.5}px)`, height: `calc(50vh - ${pad * 1.5}px)` };
      case 'quad-tr':
        return { top: `${pad}px`, left: `calc(50vw + ${pad * 0.5}px)`, width: `calc(50vw - ${pad * 1.5}px)`, height: `calc(50vh - ${pad * 1.5}px)` };
      case 'quad-bl':
        return { top: `calc(50vh + ${pad * 0.5}px)`, left: `${pad}px`, width: `calc(50vw - ${pad * 1.5}px)`, height: `calc(50vh - ${pad * 1.5}px)` };
      case 'quad-br':
        return { top: `calc(50vh + ${pad * 0.5}px)`, left: `calc(50vw + ${pad * 0.5}px)`, width: `calc(50vw - ${pad * 1.5}px)`, height: `calc(50vh - ${pad * 1.5}px)` };

      // 5. Split Left 50 + Top/Bottom Right
      case 'l50-tr25':
        return { top: `${pad}px`, left: `calc(50vw + ${pad * 0.5}px)`, width: `calc(50vw - ${pad * 1.5}px)`, height: `calc(50vh - ${pad * 1.5}px)` };
      case 'l50-br25':
        return { top: `calc(50vh + ${pad * 0.5}px)`, left: `calc(50vw + ${pad * 0.5}px)`, width: `calc(50vw - ${pad * 1.5}px)`, height: `calc(50vh - ${pad * 1.5}px)` };

      default:
        return { top: `${pos.y}px`, left: `${pos.x}px`, width: `${size.width}px`, height: `${size.height}px` };
    }
  };

  const handleSnapMouseEnter = () => {
    clearTimeout(snapTimerRef.current);
    setShowSnapMenu(true);
  };

  const handleSnapMouseLeave = () => {
    snapTimerRef.current = setTimeout(() => {
      setShowSnapMenu(false);
    }, 300);
  };

  return (
    <>
      {/* 1. MINIMIZED DOCK PILL (Di pojok kanan bawah jika di-minimize) */}
      {isMinimized && (
        <div 
          onClick={() => {
            setIsMinimized(false);
            handleFocus();
          }}
          style={{
            position: 'fixed',
            bottom: `${20 + (index * 48)}px`,
            right: '20px',
            zIndex: 140
          }}
          className="flex items-center gap-2.5 bg-slate-900/95 hover:bg-slate-800 border border-slate-700/80 shadow-2xl px-3 py-2 rounded-xl backdrop-blur-md cursor-pointer transition-all hover:scale-105 select-none group">
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            status === 'connected' ? 'bg-emerald-400 animate-pulse' :
            status === 'connecting' ? 'bg-amber-400 animate-ping' :
            'bg-rose-500'
          }`} />
          <Terminal className="w-4 h-4 text-sky-400 shrink-0" />
          <div className="text-xs">
            <span className="font-bold text-white group-hover:text-sky-300 transition truncate max-w-[130px] inline-block align-bottom">
              {session.item?.name || `ID ${session.item?.vmid}`}
            </span>
            <span className="text-[10px] text-slate-400 ml-1 font-mono">
              {session.item?.type === 'node' ? `Node • ${session.item?.node}` : `(${session.item?.type === 'qemu' ? 'VM' : 'LXC'} • ${session.item?.node})`}
            </span>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
            className="p-1 ml-1 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition"
            title="Tutup Console">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 2. MAIN DRAGGABLE & RESIZABLE WINDOW */}
      <div
        onMouseDown={handleFocus}
        style={{ 
          display: isMinimized ? 'none' : 'flex',
          position: 'fixed',
          zIndex: isActive ? 130 : 110 + index,
          ...getSnapStyles()
        }}
        className={`flex flex-col bg-slate-950 border border-slate-700 shadow-2xl overflow-hidden transition-shadow ${
          isMaximized || snapPreset ? 'rounded-none border-slate-800' : 'rounded-xl ring-1 ring-white/10'
        }`}>
        
        {/* TITLE BAR (Bisa di-drag untuk memindah posisi jendela) */}
        <div 
          onMouseDown={handleDragStart}
          onDoubleClick={() => {
            if (snapPreset) setSnapPreset(null);
            else setIsMaximized(prev => !prev);
          }}
          className={`flex items-center justify-between px-3.5 py-2 bg-slate-900 border-b border-slate-800 shrink-0 select-none ${
            isMaximized || snapPreset ? 'cursor-default' : 'cursor-move'
          }`}>
          
          {/* Info Mesin */}
          <div className="flex items-center gap-2.5 overflow-hidden">
            <Terminal className="w-4 h-4 text-sky-400 shrink-0" />
            <div className="flex items-center gap-1.5 truncate">
              <h3 className="text-xs font-bold text-white truncate max-w-[180px] sm:max-w-xs">
                {session.item?.name || `ID ${session.item?.vmid}`}
              </h3>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono border border-slate-700 shrink-0">
                {session.item?.type === 'node' 
                  ? `PVE Host Shell • ${session.item?.node}` 
                  : `${session.item?.type === 'qemu' ? 'VM' : 'LXC'} • ${session.item?.node}:${session.item?.vmid}`}
              </span>
            </div>

            {/* Status Dot */}
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              status === 'connected' ? 'bg-emerald-400' :
              status === 'connecting' ? 'bg-amber-400 animate-pulse' :
              'bg-rose-500'
            }`} title={status === 'connected' ? 'Terhubung' : status} />
          </div>

          {/* Tombol Kontrol Jendela (Minimize, Snap Layouts / Maximize, Close) */}
          <div className="flex items-center gap-1 shrink-0">
            {/* 1. MINIMIZE BUTTON (-) */}
            <button
              onClick={() => setIsMinimized(true)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition"
              title="Minimize">
              <Minus className="w-3.5 h-3.5" />
            </button>

            {/* 2. MAXIMIZE & SNAP LAYOUTS BUTTON (□ / ❐) */}
            <div 
              className="relative"
              onMouseEnter={handleSnapMouseEnter}
              onMouseLeave={handleSnapMouseLeave}>
              
              <button
                onClick={() => {
                  if (snapPreset) setSnapPreset(null);
                  else setIsMaximized(prev => !prev);
                  setShowSnapMenu(false);
                }}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition"
                title={isMaximized || snapPreset ? "Restore Down" : "Maximize / Snap Layouts"}>
                {isMaximized || snapPreset ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>

              {/* WINDOWS 11 SNAP LAYOUTS FLYOUT MENU */}
              {showSnapMenu && (
                <div 
                  ref={snapMenuRef}
                  className="absolute right-0 top-full mt-1.5 z-[200] bg-slate-900/98 border border-slate-700 shadow-2xl p-3 rounded-xl backdrop-blur-xl w-64 grid grid-cols-2 gap-2.5 animate-in fade-in zoom-in-95 duration-150 select-none">
                  
                  {/* Template 1: 50 / 50 Split */}
                  <div className="p-1.5 bg-slate-950/80 border border-slate-800 hover:border-slate-600 rounded-lg flex gap-1 h-14 cursor-pointer group">
                    <div 
                      onClick={() => applySnap('left-50')}
                      className="flex-1 bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                      title="Snap Kiri (50%)"
                    />
                    <div 
                      onClick={() => applySnap('right-50')}
                      className="flex-1 bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                      title="Snap Kanan (50%)"
                    />
                  </div>

                  {/* Template 2: 2/3 + 1/3 Split */}
                  <div className="p-1.5 bg-slate-950/80 border border-slate-800 hover:border-slate-600 rounded-lg flex gap-1 h-14 cursor-pointer group">
                    <div 
                      onClick={() => applySnap('left-66')}
                      className="w-2/3 bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                      title="Snap Kiri Lebar (66%)"
                    />
                    <div 
                      onClick={() => applySnap('right-33')}
                      className="w-1/3 bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                      title="Snap Kanan Sempit (33%)"
                    />
                  </div>

                  {/* Template 3: Left 50% + Top/Bottom Right 25% */}
                  <div className="p-1.5 bg-slate-950/80 border border-slate-800 hover:border-slate-600 rounded-lg flex gap-1 h-14 cursor-pointer group">
                    <div 
                      onClick={() => applySnap('left-50')}
                      className="w-1/2 bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                      title="Snap Kiri (50%)"
                    />
                    <div className="w-1/2 flex flex-col gap-1">
                      <div 
                        onClick={() => applySnap('l50-tr25')}
                        className="flex-1 bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                        title="Snap Kanan Atas (25%)"
                      />
                      <div 
                        onClick={() => applySnap('l50-br25')}
                        className="flex-1 bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                        title="Snap Kanan Bawah (25%)"
                      />
                    </div>
                  </div>

                  {/* Template 4: 2x2 Grid (4 Quadrants) */}
                  <div className="p-1.5 bg-slate-950/80 border border-slate-800 hover:border-slate-600 rounded-lg grid grid-cols-2 gap-1 h-14 cursor-pointer group">
                    <div 
                      onClick={() => applySnap('quad-tl')}
                      className="bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                      title="Snap Kiri Atas"
                    />
                    <div 
                      onClick={() => applySnap('quad-tr')}
                      className="bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                      title="Snap Kanan Atas"
                    />
                    <div 
                      onClick={() => applySnap('quad-bl')}
                      className="bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                      title="Snap Kiri Bawah"
                    />
                    <div 
                      onClick={() => applySnap('quad-br')}
                      className="bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                      title="Snap Kanan Bawah"
                    />
                  </div>

                  {/* Template 5: 3 Columns */}
                  <div className="p-1.5 bg-slate-950/80 border border-slate-800 hover:border-slate-600 rounded-lg flex gap-1 h-14 cursor-pointer group">
                    <div 
                      onClick={() => applySnap('col3-left')}
                      className="flex-1 bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                      title="Snap Kolom 1"
                    />
                    <div 
                      onClick={() => applySnap('col3-mid')}
                      className="flex-1 bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                      title="Snap Kolom 2"
                    />
                    <div 
                      onClick={() => applySnap('col3-right')}
                      className="flex-1 bg-slate-800 group-hover:bg-slate-700 hover:!bg-sky-600 rounded transition" 
                      title="Snap Kolom 3"
                    />
                  </div>

                  {/* Unsnap button */}
                  <div 
                    onClick={() => {
                      setSnapPreset(null);
                      setIsMaximized(false);
                      setShowSnapMenu(false);
                    }}
                    className="p-1.5 bg-slate-950/80 border border-slate-800 hover:border-slate-600 hover:bg-slate-800 rounded-lg flex items-center justify-center text-[10px] text-slate-300 font-medium cursor-pointer transition">
                    Ukuran Bebas
                  </div>
                </div>
              )}
            </div>

            {/* 3. CLOSE BUTTON (✕) */}
            <button
              onClick={handleClose}
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/20 rounded-md transition"
              title="Tutup Console">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* CONSOLE CANVAS CONTAINER (Klik di sini langsung memfokuskan keyboard) */}
        <div
          onClick={handleFocus}
          className={`flex-1 bg-[#020617] relative overflow-hidden cursor-text ${isNodeShell ? 'p-2.5' : 'flex items-center justify-center'}`}
          style={{ minHeight: 0 }}>
          <div
            ref={containerRef}
            className={`w-full h-full overflow-hidden ${isNodeShell ? '' : 'flex items-center justify-center'}`}
            style={{ minHeight: 0 }}
          />
        </div>

        {/* MANUAL RESIZE HANDLERS (Hanya aktif saat window tidak maximized / snapped) */}
        {!isMaximized && !snapPreset && (
          <>
            {/* Right edge */}
            <div 
              onMouseDown={(e) => handleResizeStart(e, 'right')}
              className="absolute top-0 right-0 w-2 h-full cursor-ew-resize hover:bg-sky-500/20 transition" 
            />
            {/* Bottom edge */}
            <div 
              onMouseDown={(e) => handleResizeStart(e, 'bottom')}
              className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize hover:bg-sky-500/20 transition" 
            />
            {/* Bottom-Right corner handle */}
            <div 
              onMouseDown={(e) => handleResizeStart(e, 'right-bottom')}
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize hover:bg-sky-500/40 flex items-end justify-end p-0.5 transition"
              title="Tarik untuk mengubah ukuran">
              <div className="w-2 h-2 border-r-2 border-b-2 border-slate-500 hover:border-sky-400" />
            </div>
          </>
        )}
      </div>
    </>
  );
}
