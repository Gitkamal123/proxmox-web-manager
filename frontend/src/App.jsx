import React, { useEffect, useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { 
  Server, Cpu, HardDrive, Play, Square, RotateCw, 
  Layers, AlertTriangle, CheckCircle, XCircle, Terminal, 
  ChevronDown, ChevronRight, Search, Camera, Copy, PlusCircle, 
  History, Shield, RotateCcw, Maximize2, Minimize2, X, Monitor, Minus,
  MoreHorizontal, MoreVertical, Cloud, Settings, Key, Globe, Edit2, Save,
  Check, RefreshCw, Box, Database, Network, Trash2, Tag, LogOut, Radio, User
} from 'lucide-react';
import ConsoleWindow from './ConsoleWindow';
import LoginPage from './LoginPage';
import { 
  api, getStoredToken, getStoredUser, clearAuthSession, 
  getApiBaseUrl, getSocketUrl, getServerHost, setServerHost, 
  setStoredToken, setStoredUser 
} from './config';

// Helper ekstraksi pesan error Proxmox agar rapi dan tidak muncul [object Object]
const extractErrorMessage = (err) => {
  if (!err) return 'Terjadi kesalahan sistem';
  if (typeof err === 'string') return err;
  if (err.response?.data) {
    const data = err.response.data;
    if (typeof data.errors === 'string') return data.errors;
    if (typeof data.errors === 'object' && data.errors !== null) {
      return Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join(', ');
    }
    if (typeof data.error === 'string') return data.error;
    if (typeof data.message === 'string') return data.message;
    if (typeof data === 'string') return data;
  }
  return err.message || JSON.stringify(err);
};

// Helper parsing parameter string Network Proxmox (net0, net1, dll)
const parseNetworkConfig = (netStr) => {
  if (!netStr || typeof netStr !== 'string') return null;
  const parts = netStr.split(',').map(s => s.trim()).filter(Boolean);
  const info = {
    raw: netStr,
    model: '',
    mac: '',
    bridge: '',
    firewall: '',
    tag: '',
    ip: '',
    ip6: '',
    gw: '',
    rate: '',
    name: ''
  };

  parts.forEach(part => {
    const eqIdx = part.indexOf('=');
    if (eqIdx !== -1) {
      const key = part.slice(0, eqIdx).trim();
      const val = part.slice(eqIdx + 1).trim();
      if (key === 'bridge') info.bridge = val;
      else if (key === 'firewall') info.firewall = val === '1' ? 'Active' : 'Disabled';
      else if (key === 'tag') info.tag = val;
      else if (key === 'ip') info.ip = val;
      else if (key === 'ip6') info.ip6 = val;
      else if (key === 'gw' || key === 'gw4') info.gw = val;
      else if (key === 'rate') info.rate = `${val} MB/s`;
      else if (key === 'name') info.name = val;
      else if (key === 'hwaddr' || key === 'macaddr') info.mac = val;
      else if (['virtio', 'e1000', 'rtl8139', 'vmxnet3', 'veth'].includes(key.toLowerCase())) {
        info.model = key.toUpperCase();
        info.mac = val;
      }
    } else {
      if (['virtio', 'e1000', 'rtl8139', 'vmxnet3', 'veth'].includes(part.toLowerCase())) {
        info.model = part.toUpperCase();
      }
    }
  });

  return info;
};

export default function App() {
  const [authToken, setAuthToken] = useState(getStoredToken());
  const [currentUser, setCurrentUser] = useState(getStoredUser());
  const [isVerifyingAuth, setIsVerifyingAuth] = useState(true);

  const [nodes, setNodes] = useState([]);
  const [vms, setVms] = useState([]);
  const [storages, setStorages] = useState([]);
  const [proxmoxHost, setProxmoxHost] = useState('');
  const [loadingAction, setLoadingAction] = useState(null);
  const [userRole, setUserRole] = useState('Admin');

  // State Accordion
  const [openNodes, setOpenNodes] = useState({});

  // 1. STATE FITUR SEARCH BAR
  const [searchQuery, setSearchQuery] = useState('');

  // Dropdown menu aksi aktif (per VM/LXC)
  const [openActionMenuId, setOpenActionMenuId] = useState(null);

  // 2. STATE FITUR AUDIT LOGS
  const [logs, setLogs] = useState([]);

  // 3. STATE FITUR SNAPSHOT & ROLLBACK MODAL
  const [snapshotModal, setSnapshotModal] = useState({ isOpen: false, item: null, snapshots: [] });
  const [snapForm, setSnapForm] = useState({ snapname: '', description: '' });

  // 4. STATE FITUR DEPLOY & CLONE MODAL
  const [createModal, setCreateModal] = useState({ isOpen: false, node: 'pve1' });
  const [createForm, setCreateForm] = useState({ 
    vmid: '', 
    name: '', 
    memory: 2048, 
    cores: 2, 
    disk: 32,
    type: 'qemu',
    ostemplate: '',
    customOstemplate: '',
    password: ''
  });
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  
  const [cloneModal, setCloneModal] = useState({ isOpen: false, item: null });
  const [cloneForm, setCloneForm] = useState({ newid: '', name: '', targetNode: '' });

  // 5. STATE FITUR HARDWARE & CLOUD-INIT MODAL
  const [configModal, setConfigModal] = useState({
    isOpen: false,
    item: null,
    activeTab: 'hardware', // 'hardware' | 'cloudinit'
    config: {},
    loading: false,
    saving: false,
    editField: null,
    editValue: ''
  });

  // 6. STATE FITUR HAPUS INSTANCE MODAL
  const [deleteModal, setDeleteModal] = useState({
    isOpen: false,
    item: null,
    loading: false
  });

  // 7. STATE FITUR UNIVERSAL EDIT CONFIG MODAL (Glassmorphic Custom Popup untuk Nama, CPU, RAM, Cloud-Init, dll)
  const [editModal, setEditModal] = useState({
    isOpen: false,
    item: null,
    field: '',
    title: '',
    label: '',
    value: '',
    placeholder: '',
    inputType: 'text', // 'text' | 'number' | 'password' | 'textarea'
    helperText: '',
    iconType: 'tag', // 'tag' | 'cpu' | 'memory' | 'user' | 'key' | 'network' | 'globe'
    loading: false,
    fromConfigModal: false
  });

  // Modal Confirm & Toast
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, item: null, action: null });
  const [toast, setToast] = useState({ show: false, message: '', type: 'info' });

  // 7. STATE FITUR MULTI-CONSOLE WINDOWS (Clean with Minimize, Maximize, Close)
  const [consoleSessions, setConsoleSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);

  const triggerToast = (message, type = 'info') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'info' }), 4000);
  };

  const toggleNodeAccordion = (nodeName) => {
    setOpenNodes(prev => ({ ...prev, [nodeName]: !prev[nodeName] }));
  };

  // 1. Cek validitas sesi login saat aplikasi dibuka
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setIsVerifyingAuth(false);
      return;
    }

    api.get('/auth/verify', { timeout: 5000 })
      .then(res => {
        if (res.data?.valid) {
          setAuthToken(token);
          if (res.data.user) {
            setCurrentUser(res.data.user);
            setStoredUser(res.data.user);
          }
        } else {
          clearAuthSession();
          setAuthToken(null);
          setCurrentUser(null);
        }
      }).catch(() => {
        // Jika offline atau server belum connect, tetap izinkan sesi lokal
      }).finally(() => {
        setIsVerifyingAuth(false);
      });
  }, []);

  // 2. Main data polling & socket subscription ketika authenticated
  useEffect(() => {
    if (!authToken) return;
    document.title = "Proxmox Datacenter Manager";
        
    api.get('/config')
      .then(res => res.data?.proxmoxHost && setProxmoxHost(res.data.proxmoxHost))
      .catch(() => {});

    // Load initial logs
    api.get('/logs')
      .then(res => setLogs(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});

    const socket = io(getSocketUrl());

    socket.on('proxmox-update', (data) => {
      if (!data) return;
      if (data.proxmoxHost) setProxmoxHost(data.proxmoxHost);

      const sortedNodes = (data.nodes || []).sort((a, b) => 
        a.node.localeCompare(b.node, undefined, { numeric: true, sensitivity: 'base' })
      );
      setNodes(sortedNodes);

      setOpenNodes(prev => {
        const nextState = { ...prev };
        sortedNodes.forEach(n => {
          if (nextState[n.node] === undefined) nextState[n.node] = false;
        });
        return nextState;
      });

      const vmList = (data.resources || [])
        .filter(item => item.type === 'qemu' || item.type === 'lxc')
        .sort((a, b) => Number(a.vmid) - Number(b.vmid));
      setVms(vmList);

      const storageList = (data.resources || [])
        .filter(item => item.type === 'storage')
        .sort((a, b) => a.node.localeCompare(b.node, undefined, { numeric: true }));
      setStorages(storageList);
    });

    // Real-time Audit Log Update
    socket.on('activity-log-update', (newLogs) => {
      setLogs(Array.isArray(newLogs) ? newLogs : []);
    });

    // Close action dropdowns when clicking outside
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.action-menu-wrapper')) {
        setOpenActionMenuId(null);
      }
    };
    window.addEventListener('click', handleOutsideClick);

    return () => {
      socket.disconnect();
      window.removeEventListener('click', handleOutsideClick);
    };
  }, [authToken]);

  // Handler Logout
  const handleLogout = async () => {
    try {
      await api.post('/auth/logout', {}, { timeout: 2500 });
    } catch (e) {}
    clearAuthSession();
    setAuthToken(null);
    setCurrentUser(null);
  };

  // FITUR SEARCH: Filter VM berdasarkan nama, ID, Node, atau Tipe
  const isSearchActive = searchQuery.trim().length > 0;
  const filteredVms = vms.filter(v => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const name = (v.name || '').toLowerCase();
    const vmid = String(v.vmid || '');
    const node = (v.node || '').toLowerCase();
    const type = (v.type === 'qemu' ? 'vm qemu' : 'lxc container').toLowerCase();
    return name.includes(q) || vmid.includes(q) || node.includes(q) || type.includes(q);
  });

  // POWER CONTROL HANDLER
  const openConfirmModal = (event, item, action) => {
    setConfirmModal({ isOpen: true, item, action });
  };

  const executePowerAction = async () => {
    const { item, action } = confirmModal;
    if (!item || !action) return;

    setConfirmModal({ isOpen: false, item: null, action: null });
    setLoadingAction(`${item.vmid}-${action}`);

    try {
      await api.post(`/vm/${item.node}/${item.type}/${item.vmid}/status/${action}`);
      triggerToast(`Perintah ${action.toUpperCase()} dikirim ke ${item.name || 'ID ' + item.vmid}`, 'success');
    } catch (err) {
      triggerToast(`Gagal ${action}: ` + extractErrorMessage(err), 'error');
    } finally {
      setLoadingAction(null);
    }
  };

  // SNAPSHOT HANDLERS
  const openSnapshotModal = async (item) => {
    try {
      const res = await api.get(`/vm/${item.node}/${item.type}/${item.vmid}/snapshots`);
      setSnapshotModal({ isOpen: true, item, snapshots: res.data?.snapshots || [] });
    } catch (err) {
      triggerToast("Gagal mengambil snapshot: " + extractErrorMessage(err), 'error');
    }
  };

  const handleCreateSnapshot = async (e) => {
    e.preventDefault();
    const { item } = snapshotModal;
    try {
      await api.post(`/vm/${item.node}/${item.type}/${item.vmid}/snapshot`, snapForm);
      triggerToast(`Snapshot "${snapForm.snapname}" berhasil dibuat`, 'success');
      setSnapForm({ snapname: '', description: '' });
      openSnapshotModal(item);
    } catch (err) {
      triggerToast("Gagal membuat snapshot: " + extractErrorMessage(err), 'error');
    }
  };

  const handleRollbackSnapshot = async (snapname) => {
    const { item } = snapshotModal;
    try {
      await api.post(`/vm/${item.node}/${item.type}/${item.vmid}/snapshot/${snapname}/rollback`, { role: userRole });
      triggerToast(`Rollback ke snapshot "${snapname}" berhasil`, 'success');
    } catch (err) {
      triggerToast("Gagal rollback: " + extractErrorMessage(err), 'error');
    }
  };

  // DEPLOY VM / LXC HANDLER (AUTO-RESET ON OPEN/CLOSE)
  const fetchTemplates = async (nodeName) => {
    setLoadingTemplates(true);
    try {
      const res = await api.get(`/node/${nodeName}/templates`);
      const tmpls = res.data?.templates || [];
      setAvailableTemplates(tmpls);
      if (tmpls.length > 0) {
        setCreateForm(prev => {
          if (!prev.ostemplate || prev.ostemplate === '') {
            return { ...prev, ostemplate: tmpls[0].volid };
          }
          return prev;
        });
      }
    } catch (e) {
      setAvailableTemplates([]);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const openCreateModal = (nodeName) => {
    const usedIds = vms.map(v => Number(v.vmid)).filter(n => !isNaN(n));
    const nextId = usedIds.length > 0 ? Math.max(...usedIds) + 1 : 100;

    setCreateForm({
      vmid: String(nextId),
      name: '',
      memory: 2048,
      cores: 2,
      disk: 32,
      type: 'qemu',
      ostemplate: '',
      customOstemplate: '',
      password: ''
    });
    setCreateModal({ isOpen: true, node: nodeName });
    fetchTemplates(nodeName);
  };

  const closeCreateModal = () => {
    setCreateModal({ isOpen: false, node: 'pve1' });
  };

  const handleDeployVM = async (e) => {
    e.preventDefault();
    try {
      const templatePath = createForm.ostemplate === 'custom' 
        ? createForm.customOstemplate 
        : (createForm.ostemplate || (availableTemplates[0]?.volid || ''));

      const res = await api.post(`/vm/create`, {
        ...createForm,
        ostemplate: templatePath,
        node: createModal.node,
        role: userRole
      });
      triggerToast(res.data?.message || `${createForm.type.toUpperCase()} ${createForm.name} berhasil di-deploy`, 'success');
      closeCreateModal();
    } catch (err) {
      triggerToast("Gagal deploy: " + extractErrorMessage(err), 'error');
    }
  };

  // CLONE VM / LXC HANDLER (AUTO-RESET ON OPEN/CLOSE)
  const openCloneModal = (item) => {
    const usedIds = vms.map(v => Number(v.vmid)).filter(n => !isNaN(n));
    const nextId = usedIds.length > 0 ? Math.max(...usedIds) + 1 : 100;

    setCloneForm({
      newid: String(nextId),
      name: item.name ? `${item.name}-clone` : `clone-${item.vmid}`,
      targetNode: item.node || ''
    });
    setCloneModal({ isOpen: true, item });
  };

  const closeCloneModal = () => {
    setCloneModal({ isOpen: false, item: null });
  };

  const handleCloneVM = async (e) => {
    e.preventDefault();
    const { item } = cloneModal;
    if (!item) return;
    try {
      const res = await api.post(`/vm/${item.node}/${item.type}/${item.vmid}/clone`, {
        ...cloneForm,
        role: userRole
      });
      triggerToast(res.data?.message || `Clone instance ke ID ${cloneForm.newid} berhasil dimulai`, 'success');
      closeCloneModal();
    } catch (err) {
      triggerToast("Gagal clone: " + extractErrorMessage(err), 'error');
    }
  };

  // HARDWARE & CLOUD-INIT CONFIG MODAL HANDLERS
  const openConfigModal = async (item, defaultTab = 'hardware') => {
    setConfigModal({
      isOpen: true,
      item,
      activeTab: defaultTab,
      config: {},
      pending: {},
      loading: true,
      saving: false,
      editField: null,
      editValue: ''
    });

    try {
      const res = await api.get(`/vm/${item.node}/${item.type}/${item.vmid}/config`);
      setConfigModal(prev => ({
        ...prev,
        config: res.data?.config || {},
        pending: res.data?.pending || {},
        loading: false
      }));
    } catch (err) {
      triggerToast("Gagal mengambil konfigurasi: " + extractErrorMessage(err), 'error');
      setConfigModal(prev => ({ ...prev, loading: false }));
    }
  };

  const handleSaveConfig = async (updatePayload) => {
    const { item } = configModal;
    if (!item) return;

    setConfigModal(prev => ({ ...prev, saving: true }));
    try {
      const res = await api.post(`/vm/${item.node}/${item.type}/${item.vmid}/config`, updatePayload);
      triggerToast(res.data?.message || "Konfigurasi berhasil disimpan", 'success');
      
      const refreshed = await api.get(`/vm/${item.node}/${item.type}/${item.vmid}/config`);
      setConfigModal(prev => ({
        ...prev,
        config: refreshed.data?.config || {},
        pending: refreshed.data?.pending || {},
        saving: false,
        editField: null
      }));
    } catch (err) {
      triggerToast("Gagal menyimpan konfigurasi: " + extractErrorMessage(err), 'error');
      setConfigModal(prev => ({ ...prev, saving: false }));
    }
  };

  // UNIVERSAL CONFIG EDIT MODAL HANDLERS (CPU, RAM, Hostname, Cloud-Init, dll)
  const openEditModal = ({
    item,
    field,
    title,
    label,
    value = '',
    placeholder = '',
    inputType = 'text',
    helperText = '',
    iconType = 'tag',
    fromConfigModal = false
  }) => {
    setEditModal({
      isOpen: true,
      item,
      field,
      title,
      label,
      value: String(value ?? ''),
      placeholder,
      inputType,
      helperText,
      iconType,
      loading: false,
      fromConfigModal
    });
  };

  const closeEditModal = () => {
    setEditModal({
      isOpen: false,
      item: null,
      field: '',
      title: '',
      label: '',
      value: '',
      placeholder: '',
      inputType: 'text',
      helperText: '',
      iconType: 'tag',
      loading: false,
      fromConfigModal: false
    });
  };

  const handleSaveEditModal = async (e) => {
    if (e) e.preventDefault();
    const { item, field, value, inputType, fromConfigModal } = editModal;
    if (!item || !field) return;

    const trimmed = typeof value === 'string' ? value.trim() : value;
    if (trimmed === '' && field !== 'sshkeys' && field !== 'searchdomain' && field !== 'nameserver') {
      triggerToast("Nilai tidak boleh kosong", "error");
      return;
    }

    setEditModal(prev => ({ ...prev, loading: true }));

    try {
      let finalVal = trimmed;
      if (inputType === 'number') {
        finalVal = Number(trimmed);
        if (isNaN(finalVal) || finalVal <= 0) {
          triggerToast("Masukkan angka yang valid", "error");
          setEditModal(prev => ({ ...prev, loading: false }));
          return;
        }
      }

      const payload = { [field]: finalVal };
      const res = await api.post(`/vm/${item.node}/${item.type}/${item.vmid}/config`, payload);
      
      triggerToast(res.data?.message || `Nama berhasil disimpan`, 'success');
      closeEditModal();

      // Optimistic update instan untuk nama VM/LXC di tabel utama
      if (field === 'name' || field === 'hostname') {
        const updatedName = res.data?.data?.name || res.data?.data?.hostname || finalVal;
        setVms(prev => prev.map(v => {
          if (v.node === item.node && String(v.vmid) === String(item.vmid)) {
            return { ...v, name: updatedName };
          }
          return v;
        }));
      }

      if (fromConfigModal || configModal.isOpen) {
        api.get(`/vm/${item.node}/${item.type}/${item.vmid}/config`)
          .then(refreshed => {
            setConfigModal(prev => ({
              ...prev,
              item: prev.item ? { ...prev.item, name: (field === 'name' || field === 'hostname') ? (res.data?.data?.name || res.data?.data?.hostname || finalVal) : prev.item.name } : prev.item,
              config: refreshed.data?.config || {},
              pending: refreshed.data?.pending || {}
            }));
          })
          .catch(() => {});
      }
    } catch (err) {
      triggerToast("Gagal menyimpan perubahan: " + extractErrorMessage(err), 'error');
      setEditModal(prev => ({ ...prev, loading: false }));
    }
  };

  // DELETE INSTANCE HANDLERS
  const openDeleteModal = (item) => {
    setDeleteModal({ isOpen: true, item, loading: false });
  };

  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, item: null, loading: false });
  };

  const handleDeleteVM = async () => {
    const { item } = deleteModal;
    if (!item) return;

    setDeleteModal(prev => ({ ...prev, loading: true }));
    try {
      const res = await api.delete(`/vm/${item.node}/${item.type}/${item.vmid}`);
      triggerToast(res.data?.message || `${item.type.toUpperCase()} ${item.name || item.vmid} berhasil dihapus`, 'success');
      closeDeleteModal();
    } catch (err) {
      triggerToast("Gagal menghapus instance: " + extractErrorMessage(err), 'error');
      setDeleteModal(prev => ({ ...prev, loading: false }));
    }
  };

  // PVE NODE SHELL HANDLER
  const openNodeShell = async (nodeName) => {
    const sessionId = `node-${nodeName}`;
    const existing = consoleSessions.find(s => s.id === sessionId);
    if (existing) {
      setActiveSessionId(sessionId);
      return;
    }

    try {
      const res = await api.get(`/node/${nodeName}/console`);
      const { ticket, port, user } = res.data;
      const newSession = {
        id: sessionId,
        item: { name: `PVE Host Shell (${nodeName})`, node: nodeName, type: 'node', vmid: 'host' },
        ticket,
        port,
        user
      };
      setConsoleSessions(prev => [...prev, newSession]);
      setActiveSessionId(sessionId);
    } catch (err) {
      triggerToast("Gagal membuka shell PVE node: " + extractErrorMessage(err), 'error');
    }
  };

  // CONSOLE HANDLERS — Buka jendela console VM/LXC
  const openConsole = async (item) => {
    const sessionId = `${item.node}-${item.type}-${item.vmid}`;
    
    // Jika console untuk VM/LXC ini sudah dibuka, cukup aktifkan window-nya
    const existing = consoleSessions.find(s => s.id === sessionId);
    if (existing) {
      setActiveSessionId(sessionId);
      return;
    }

    try {
      const res = await api.get(`/vm/${item.node}/${item.type}/${item.vmid}/console`);
      const { ticket, port } = res.data;
      const newSession = { id: sessionId, item, ticket, port };
      setConsoleSessions(prev => [...prev, newSession]);
      setActiveSessionId(sessionId);
    } catch (err) {
      triggerToast("Gagal membuka console: " + extractErrorMessage(err), 'error');
    }
  };

  const closeConsole = (sessionId) => {
    setConsoleSessions(prev => prev.filter(s => s.id !== sessionId));
  };

  const format2Dec = (val) => Number(val || 0).toFixed(2);
  const formatGB = (bytes) => format2Dec(bytes / (1024 * 1024 * 1024));

  // Tampilkan LoginPage jika belum terautentikasi
  if (!authToken) {
    return (
      <LoginPage 
        onLoginSuccess={(user, token) => {
          setCurrentUser(user);
          setAuthToken(token);
          triggerToast(`Selamat datang, ${user?.username || 'root'}!`, 'success');
        }} 
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 font-sans relative overflow-x-hidden">
      
      {/* Toast Notification */}
      {toast.show && (
        <div className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border ${
          toast.type === 'success' ? 'bg-emerald-950/90 border-emerald-500 text-emerald-200' :
          toast.type === 'error' ? 'bg-rose-950/90 border-rose-500 text-rose-200' :
          'bg-blue-950/90 border-blue-500 text-blue-200'
        }`}>
          {toast.type === 'success' && <CheckCircle className="w-5 h-5 text-emerald-400" />}
          {toast.type === 'error' && <XCircle className="w-5 h-5 text-rose-400" />}
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}

      {/* Header Bar */}
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-8 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-orange-500 flex items-center gap-2">
            <Layers className="w-8 h-8" /> FTTH Lab Proxmox Datacenter Manager 
          </h1>
          <p className="text-slate-400 text-xs mt-1">Cluster Management Dashboard</p>
        </div>

        {/* Controls: Search + Logout */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          {/* FITUR SEARCH BAR */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400 pointer-events-none" />
            <input 
              type="text" 
              placeholder="Cari VM, LXC, Node, atau ID" 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setSearchQuery('');
              }}
              className="w-full bg-slate-800/90 border border-slate-700 hover:border-slate-600 focus:border-orange-500 pl-9 pr-9 py-2 rounded-xl text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none transition shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition"
                title="Hapus Pencarian">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            title="Logout dari Dashboard"
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/50 hover:border-rose-700 text-rose-300 hover:text-white rounded-xl text-xs font-semibold transition active:scale-95 cursor-pointer">
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* Section 1: Nodes Overview */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4 text-slate-300 flex items-center gap-2">
          <Server className="w-5 h-5 text-blue-400" /> Status Nodes
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {nodes.map(node => {            
            const localStorageItem = storages.find(
              st => st.node === node.node && st.storage === 'local'
            );

            return (
              <div key={node.node} className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg">
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-lg text-white">{node.node}</h3>
                    {/* Tombol Buka Shell Host PVE */}
                    <button
                      onClick={() => openNodeShell(node.node)}
                      title={`Buka Shell / Terminal Host ${node.node}`}
                      className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-700/80 hover:bg-sky-600 text-slate-300 hover:text-white rounded-md text-xs font-semibold border border-slate-600/60 transition shadow-sm active:scale-95">
                      <Terminal className="w-3 h-3 text-sky-400" />
                      <span>Shell</span>
                    </button>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${node.status === 'online' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400'}`}>
                    {node.status.toUpperCase()}
                  </span>
                </div>
                <div className="space-y-3">
                  {/* CPU Load */}
                  <div>
                    <div className="flex justify-between text-xs mb-1 text-slate-400">
                      <span>CPU Load</span>
                      <span>{format2Dec((node.cpu || 0) * 100)}%</span>
                    </div>
                    <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                      <div className="bg-blue-500 h-full" style={{ width: `${(node.cpu || 0) * 100}%` }}></div>
                    </div>
                  </div>

                  {/* RAM Usage */}
                  <div>
                    <div className="flex justify-between text-xs mb-1 text-slate-400">
                      <span>RAM Usage</span>
                      <span>{formatGB(node.mem)} / {formatGB(node.maxmem)} GB</span>
                    </div>
                    <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                      <div className="bg-purple-500 h-full" style={{ width: `${(node.mem / (node.maxmem || 1)) * 100}%` }}></div>
                    </div>
                  </div>

                  {/* Storage (local) */}
                  <div>
                    <div className="flex justify-between text-xs mb-1 text-slate-400">
                      <span>Storage (local)</span>
                      <span>
                        {localStorageItem 
                          ? `${formatGB(localStorageItem.disk || 0)} / ${formatGB(localStorageItem.maxdisk || 0)} GB` 
                          : '-'}
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-amber-500 h-full" 
                        style={{ 
                          width: localStorageItem && localStorageItem.maxdisk 
                            ? `${((localStorageItem.disk || 0) / localStorageItem.maxdisk) * 100}%` 
                            : '0%' 
                        }}>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 2: VM & LXC Management */}
      <section className="mb-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold text-slate-300 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-orange-400" /> Virtual Machines & Containers
          </h2>

          {/* Indikator Filter Pencarian Aktif */}
          {isSearchActive && (
            <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 px-3 py-1 rounded-lg text-xs text-orange-300">
              <span>Hasil pencarian: <strong>"{searchQuery}"</strong> ({filteredVms.length} instance ditemukan)</span>
              <button 
                onClick={() => setSearchQuery('')}
                className="underline hover:text-white font-bold ml-1">
                Reset
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {nodes.map(nodeObj => {
            const nodeVms = filteredVms
              .filter(v => v.node === nodeObj.node)
              .sort((a, b) => Number(a.vmid) - Number(b.vmid));
            // Saat search aktif, otomatis buka accordion jika ada VM yang cocok
            const isOpen = isSearchActive ? (nodeVms.length > 0) : !!openNodes[nodeObj.node];

            return (
              <div key={nodeObj.node} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-xl">
                <div className="w-full flex justify-between items-center p-4 bg-slate-800/90 border-b border-slate-700/50">
                  <button 
                    onClick={() => toggleNodeAccordion(nodeObj.node)}
                    className="flex items-center gap-3">
                    {isOpen ? <ChevronDown className="w-5 h-5 text-orange-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
                    <span className="font-bold text-white uppercase text-base">{nodeObj.node}</span>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                      nodeVms.length > 0 
                        ? 'bg-slate-700 text-slate-200' 
                        : 'bg-slate-800 text-slate-500 border border-slate-700'
                    }`}>
                      {nodeVms.length} Instances {isSearchActive && `(Cocok)`}
                    </span>
                  </button>

                  {/* Tombol Deploy Instance Baris Node */}
                  {userRole === 'Admin' && (
                    <button 
                      onClick={() => openCreateModal(nodeObj.node)}
                      className="flex items-center gap-1.5 px-3 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold shadow transition active:scale-95">
                      <PlusCircle className="w-3.5 h-3.5" /> Deploy Instance
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-300">
                      <thead className="bg-slate-900/50 text-slate-400 text-xs uppercase border-b border-slate-700">
                        <tr>
                          <th className="p-4">ID</th>
                          <th className="p-4">Nama</th>
                          <th className="p-4">Tipe</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">CPU</th>
                          <th className="p-4">RAM</th>
                          <th className="p-4">Storage</th>
                          <th className="p-4 text-center">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/50">
                        {nodeVms.length > 0 ? (
                           nodeVms.map(item => {
                            const itemKey = `${item.node}-${item.type}-${item.vmid}`;
                            const isRunning = item.status === 'running';
                            const cpuVal = isRunning ? (item.cpuPercent ?? (item.cpu || 0) * 100) : 0;
                            const ramUsed = isRunning ? (item.mem || 0) : 0;
                            const ramMax = item.maxmem || 0;
                            const ramVal = isRunning && ramMax ? (item.ramPercent ?? ((ramUsed / ramMax) * 100)) : 0;
                            const diskUsed = isRunning ? (item.disk || 0) : 0;
                            const diskMax = item.maxdisk || 0;
                            const diskVal = isRunning && diskMax ? (item.diskPercent ?? ((diskUsed / diskMax) * 100)) : 0;

                            return (
                              <tr key={itemKey} className="hover:bg-slate-700/30">
                                <td className="p-4 font-mono font-medium text-slate-200">{item.vmid}</td>
                                <td className="p-4 font-semibold text-white">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate max-w-[200px]" title={item.name}>{item.name || '-'}</span>
                                    {userRole === 'Admin' && (
                                      <button
                                        onClick={() => openEditModal({
                                          item,
                                          field: item.type === 'qemu' ? 'name' : 'hostname',
                                          title: `Ubah ${item.type === 'qemu' ? 'Nama VM' : 'Hostname LXC'}`,
                                          label: item.type === 'qemu' ? 'Nama Virtual Machine' : 'Hostname Container LXC',
                                          value: item.name || '',
                                          placeholder: item.type === 'qemu' ? 'contoh: web-server-01' : 'contoh: ct-ubuntu-app',
                                          helperText: 'Gunakan huruf, angka, dan tanda strip (-). Spasi akan otomatis diubah menjadi tanda strip (-).',
                                          iconType: 'tag'
                                        })}
                                        className="p-1 text-slate-500 hover:text-sky-400 hover:bg-slate-800 rounded transition"
                                        title={`Ganti nama ${item.name || item.vmid}`}>
                                        <Edit2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="p-4">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.type === 'qemu' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-teal-500/20 text-teal-300'}`}>
                                    {item.type === 'qemu' ? 'VM' : 'LXC'}
                                  </span>
                                </td>
                                <td className="p-4">
                                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${isRunning ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></span>
                                    {item.status}
                                  </span>
                                </td>
                                
                                <td className="p-4 text-xs min-w-[120px]">
                                  {isRunning ? (
                                    <div className="space-y-1">
                                      <div className="flex justify-between font-mono">
                                        <span>{format2Dec(cpuVal)}%</span>
                                      </div>
                                      <div className="w-full bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                        <div className="bg-blue-500 h-full" style={{ width: `${Math.min(cpuVal, 100)}%` }}></div>
                                      </div>
                                    </div>
                                  ) : '-'}
                                </td>

                                <td className="p-4 text-xs min-w-[140px]">
                                  {isRunning ? (
                                    <div className="space-y-1">
                                      <div className="flex justify-between font-mono">
                                        <span>{formatGB(ramUsed)} / {formatGB(ramMax)} GB</span>
                                      </div>
                                      <div className="w-full bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                        <div className="bg-purple-500 h-full" style={{ width: `${Math.min(ramVal, 100)}%` }}></div>
                                      </div>
                                    </div>
                                  ) : '-'}
                                </td>

                                <td className="p-4 text-xs min-w-[140px]">
                                  {isRunning ? (
                                    <div className="space-y-1">
                                      <div className="flex justify-between font-mono">
                                        <span>{formatGB(diskUsed)} / {formatGB(diskMax)} GB</span>
                                      </div>
                                      <div className="w-full bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                        <div className="bg-amber-500 h-full" style={{ width: `${Math.min(diskVal, 100)}%` }}></div>
                                      </div>
                                    </div>
                                  ) : '-'}
                                </td>

                                {/* TOMBOL AKSI BARU */}
                                <td className="p-4 text-right">
                                  <div className="flex items-center justify-center gap-2">
                                    {/* 1. Tombol Console Utama */}
                                    <button
                                      disabled={!isRunning}
                                      onClick={() => openConsole(item)}
                                      title={isRunning ? "Buka Terminal Console" : "Instance Sedang Mati"}
                                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition shadow-sm ${
                                        isRunning 
                                          ? 'bg-sky-500/15 hover:bg-sky-500 text-sky-300 hover:text-white border-sky-500/30 active:scale-95' 
                                          : 'bg-slate-800/60 text-slate-500 border-slate-700/50 cursor-not-allowed opacity-50'
                                      }`}>
                                      <Terminal className="w-3.5 h-3.5" />
                                      <span>Console</span>
                                    </button>

                                    {/* 2. Tombol Cepat Power (Start / Stop) */}
                                    {userRole === 'Admin' && (
                                      isRunning ? (
                                        <button 
                                          disabled={loadingAction === `${item.vmid}-stop`}
                                          onClick={(e) => openConfirmModal(e, item, 'stop')}
                                          title="Hentikan Instance (Shutdown)"
                                          className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-500/15 hover:bg-rose-600 text-rose-300 hover:text-white rounded-lg border border-rose-500/30 text-xs font-medium transition active:scale-95">
                                          <Square className="w-3.5 h-3.5" />
                                          <span className="hidden sm:inline">Stop</span>
                                        </button>
                                      ) : (
                                        <button 
                                          disabled={loadingAction === `${item.vmid}-start`}
                                          onClick={(e) => openConfirmModal(e, item, 'start')}
                                          title="Nyalakan Instance"
                                          className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500/15 hover:bg-emerald-600 text-emerald-300 hover:text-white rounded-lg border border-emerald-500/30 text-xs font-medium transition active:scale-95">
                                          <Play className="w-3.5 h-3.5" />
                                          <span className="hidden sm:inline">Start</span>
                                        </button>
                                      )
                                    )}

                                    {/* 3. Dropdown Menu Opsi Lanjutan (•••) */}
                                    <div className="relative action-menu-wrapper inline-block">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenActionMenuId(openActionMenuId === itemKey ? null : itemKey);
                                        }}
                                        title="Opsi Lanjutan"
                                        className={`p-1.5 rounded-lg border transition ${
                                          openActionMenuId === itemKey 
                                            ? 'bg-slate-700 text-white border-slate-500' 
                                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700'
                                        }`}>
                                        <MoreHorizontal className="w-4 h-4" />
                                      </button>

                                      {/* Dropdown Menu Popup */}
                                      {openActionMenuId === itemKey && (
                                        <div 
                                          onClick={(e) => e.stopPropagation()}
                                          className="absolute right-0 top-full mt-1.5 z-40 bg-slate-900/98 border border-slate-700 rounded-xl shadow-2xl p-1.5 min-w-[195px] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 divide-y divide-slate-800 text-left">
                                          
                                          {/* Kelompok 1: Hardware & Cloud-Init */}
                                          <div className="py-1">
                                            <button
                                              onClick={() => {
                                                setOpenActionMenuId(null);
                                                openConfigModal(item, 'hardware');
                                              }}
                                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:text-sky-300 hover:bg-sky-500/15 rounded-lg transition">
                                              <Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                              <span>Hardware</span>
                                            </button>

                                            <button
                                              onClick={() => {
                                                setOpenActionMenuId(null);
                                                openConfigModal(item, 'cloudinit');
                                              }}
                                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:text-indigo-300 hover:bg-indigo-500/15 rounded-lg transition">
                                              <Cloud className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                              <span>Cloud-Init</span>
                                            </button>
                                          </div>

                                          {/* Kelompok 2: Snapshot & Clone */}
                                          <div className="py-1">
                                            <button
                                              onClick={() => {
                                                setOpenActionMenuId(null);
                                                openSnapshotModal(item);
                                              }}
                                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:text-purple-300 hover:bg-purple-500/15 rounded-lg transition">
                                              <Camera className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                                              <span>Snapshot Manager</span>
                                            </button>

                                            {userRole === 'Admin' && (
                                              <button
                                                onClick={() => {
                                                  setOpenActionMenuId(null);
                                                  openCloneModal(item);
                                                }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:text-teal-300 hover:bg-teal-500/15 rounded-lg transition">
                                                <Copy className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                                                <span>Clone Instance</span>
                                              </button>
                                            )}
                                          </div>

                                          {/* Kelompok 3: Power Extras */}
                                          {userRole === 'Admin' && isRunning && (
                                            <div className="py-1">
                                              <button
                                                disabled={loadingAction === `${item.vmid}-reboot`}
                                                onClick={(e) => {
                                                  setOpenActionMenuId(null);
                                                  openConfirmModal(e, item, 'reboot');
                                                }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:text-amber-300 hover:bg-amber-500/15 rounded-lg transition">
                                                <RotateCw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                                <span>Reboot</span>
                                              </button>

                                              <button
                                                disabled={loadingAction === `${item.vmid}-stop`}
                                                onClick={(e) => {
                                                  setOpenActionMenuId(null);
                                                  openConfirmModal(e, item, 'stop');
                                                }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/15 rounded-lg transition">
                                                <Square className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                                <span>Force Stop</span>
                                              </button>
                                            </div>
                                          )}

                                          {/* Kelompok 4: Hapus Instance (Danger Zone) */}
                                          {userRole === 'Admin' && (
                                            <div className="py-1">
                                              <button
                                                onClick={() => {
                                                  setOpenActionMenuId(null);
                                                  openDeleteModal(item);
                                                }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-400 hover:text-rose-200 hover:bg-rose-500/20 rounded-lg transition font-semibold">
                                                <Trash2 className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                                <span>Hapus Instance</span>
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan="8" className="p-4 text-center text-xs text-slate-500 italic">
                              Tidak ada VM/LXC yang cocok pada node ini.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* SECTION TASK LOGS SINKRON PROXMOX */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4 text-slate-300 flex items-center gap-2">
          <History className="w-5 h-5 text-emerald-400" /> Tasks Log
        </h2>
        
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-xl max-h-72 overflow-y-auto overflow-x-hidden">
          {logs.length > 0 ? (
            <table className="w-full table-fixed text-left text-xs text-slate-300">
              <thead className="bg-slate-800 text-slate-400 uppercase text-[11px] border-b border-slate-700 sticky top-0 z-10">
                <tr>
                  <th className="p-2.5 whitespace-nowrap overflow-hidden text-ellipsis w-[18%]">Start Time</th>
                  <th className="p-2.5 whitespace-nowrap overflow-hidden text-ellipsis w-[18%]">End Time</th>
                  <th className="p-2.5 whitespace-nowrap overflow-hidden text-ellipsis w-[10%]">Node</th>
                  <th className="p-2.5 whitespace-nowrap overflow-hidden text-ellipsis w-[14%]">User name</th>
                  <th className="p-2.5 whitespace-nowrap overflow-hidden text-ellipsis w-[30%]">Description</th>
                  <th className="p-2.5 whitespace-nowrap overflow-hidden text-ellipsis w-[10%] text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50 font-mono text-xs">
                {logs.map((task) => {
                  const formatPveDate = (timestamp) => {
                    if (!timestamp) return '';
                    const date = new Date(timestamp * 1000);
                    const optionsMonth = { month: 'short', day: 'numeric' };
                    const datePart = date.toLocaleDateString('en-US', optionsMonth);
                    const timePart = date.toLocaleTimeString('en-US', { hour12: false });
                    return `${datePart} ${timePart}`;
                  };

                  const startTimeStr = formatPveDate(task.starttime);
                  const endTimeStr = task.endtime ? formatPveDate(task.endtime) : '';
                  const isOK = task.status === 'OK' || task.status === 'stopped';

                  return (
                    <tr key={task.upid} className="hover:bg-slate-700/30">
                      <td className="p-2.5 whitespace-nowrap overflow-hidden text-ellipsis text-slate-300">{startTimeStr}</td>
                      <td className="p-2.5 whitespace-nowrap overflow-hidden text-ellipsis text-slate-400">{endTimeStr}</td>
                      <td className="p-2.5 whitespace-nowrap overflow-hidden text-ellipsis font-bold text-orange-400">{task.node}</td>
                      <td className="p-2.5 whitespace-nowrap overflow-hidden text-ellipsis text-slate-200">{task.user}</td>
                      <td className="p-2.5 whitespace-nowrap overflow-hidden text-ellipsis font-semibold text-white" title={task.description}>{task.description}</td>
                      <td className="p-2.5 whitespace-nowrap overflow-hidden text-ellipsis text-center">
                        {task.status ? (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isOK ? 'text-slate-200' : 'text-rose-400'
                          }`}>
                            {task.status}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[10px]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-slate-500 text-center py-6">Tidak ada log aktivitas.</p>
          )}
        </div>
      </section>

      {/* MULTI CONSOLE WINDOWS */}
      {consoleSessions.map((session, idx) => (
        <ConsoleWindow
          key={session.id}
          session={session}
          index={idx}
          isActive={activeSessionId === session.id}
          onFocus={() => setActiveSessionId(session.id)}
          onClose={() => closeConsole(session.id)}
        />
      ))}

      {/* 1. MODAL HARDWARE & CLOUD-INIT CONFIG (GAYA PROXMOX) */}
      {configModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="flex justify-between items-center px-6 py-4 bg-slate-950 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-400">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">
                    {configModal.item?.name || `Instance ${configModal.item?.vmid}`} ({configModal.item?.type === 'qemu' ? 'VM' : 'LXC'} • ID {configModal.item?.vmid})
                  </h3>
                  <p className="text-xs text-slate-400">Node: {configModal.item?.node}</p>
                </div>
              </div>
              <button 
                onClick={() => setConfigModal({ ...configModal, isOpen: false })} 
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tab Navigation */}
            <div className="flex items-center gap-2 px-6 pt-3 border-b border-slate-800 bg-slate-900/60 shrink-0">
              <button
                onClick={() => setConfigModal(prev => ({ ...prev, activeTab: 'hardware' }))}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition ${
                  configModal.activeTab === 'hardware'
                    ? 'border-sky-500 text-sky-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}>
                <Cpu className="w-4 h-4" />
                <span>Hardware</span>
              </button>

              <button
                onClick={() => setConfigModal(prev => ({ ...prev, activeTab: 'cloudinit' }))}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition ${
                  configModal.activeTab === 'cloudinit'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}>
                <Cloud className="w-4 h-4" />
                <span>Cloud-Init</span>
              </button>
            </div>

            {/* Modal Content Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {configModal.loading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
                  <span className="text-xs">Memuat konfigurasi dari Proxmox...</span>
                </div>
              ) : configModal.activeTab === 'hardware' ? (
                /* TAB HARDWARE (Persis seperti di Proxmox) */
                <div className="space-y-3">
                  {/* Banner jika ada pending changes */}
                  {configModal.pending && Object.keys(configModal.pending).length > 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl flex items-center gap-2.5 text-xs text-amber-300">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        Terdapat konfigurasi tertunda (<strong className="text-orange-400">warna orange</strong>). Nilai baru telah tersimpan di Proxmox dan akan aktif setelah VM di-reboot.
                      </span>
                    </div>
                  )}

                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl divide-y divide-slate-800/80 font-sans text-xs">
                    {/* Name / Hostname */}
                    <div className="p-3.5 flex justify-between items-center hover:bg-slate-800/30">
                      <div className="flex items-center gap-3">
                        <Tag className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="font-semibold text-slate-300 min-w-[130px]">{configModal.item?.type === 'qemu' ? 'Name' : 'Hostname'}</span>
                        <div>
                          <span className="text-white font-mono">{configModal.config.name || configModal.config.hostname || configModal.item?.name || '-'}</span>
                          {(configModal.pending?.name || configModal.pending?.hostname) && (
                            <div className="text-orange-400 font-bold text-xs mt-0.5 flex items-center gap-1">
                              <span>{configModal.pending?.name || configModal.pending?.hostname}</span>
                              <span className="text-[10px] font-normal bg-orange-500/20 text-orange-300 px-1.5 py-0.2 rounded border border-orange-500/30">Pending (Perlu Reboot)</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {userRole === 'Admin' && (
                        <button
                          onClick={() => {
                            const current = configModal.config.name || configModal.config.hostname || configModal.item?.name || '';
                            openEditModal({
                              item: configModal.item,
                              field: configModal.item?.type === 'qemu' ? 'name' : 'hostname',
                              title: `Ubah ${configModal.item?.type === 'qemu' ? 'Nama VM' : 'Hostname LXC'}`,
                              label: configModal.item?.type === 'qemu' ? 'Nama Virtual Machine' : 'Hostname Container LXC',
                              value: current,
                              placeholder: configModal.item?.type === 'qemu' ? '' : '',
                              iconType: 'tag',
                              fromConfigModal: true
                            });
                          }}
                          className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition"
                          title="Edit Nama">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Memory */}
                    <div className="p-3.5 flex justify-between items-center hover:bg-slate-800/30">
                      <div className="flex items-center gap-3">
                        <Cpu className="w-4 h-4 text-purple-400 shrink-0" />
                        <span className="font-semibold text-slate-300 min-w-[130px]">Memory</span>
                        <div>
                          <span className="text-white font-mono">
                            {configModal.config.memory ? `${(configModal.config.memory / 1024).toFixed(2)} GiB (${configModal.config.memory} MB)` : '-'}
                          </span>
                          {configModal.pending?.memory && (
                            <div className="text-orange-400 font-bold text-xs mt-0.5 flex items-center gap-1">
                              <span>{(configModal.pending.memory / 1024).toFixed(2)} GiB ({configModal.pending.memory} MB)</span>
                              <span className="text-[10px] font-normal bg-orange-500/20 text-orange-300 px-1.5 py-0.2 rounded border border-orange-500/30">Pending (Perlu Reboot)</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {userRole === 'Admin' && (
                        <button
                          onClick={() => {
                            const currentMem = configModal.pending?.memory || configModal.config.memory || '2048';
                            openEditModal({
                              item: configModal.item,
                              field: 'memory',
                              title: 'Ubah Alokasi Memory (RAM)',
                              label: 'Ukuran RAM (dalam Megabyte / MB)',
                              value: currentMem,
                              placeholder: 'Contoh: 2048 (untuk 2 GB) atau 4096 (untuk 4 GB)',
                              inputType: 'number',
                              helperText: '',
                              iconType: 'memory',
                              fromConfigModal: true
                            });
                          }}
                          className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition"
                          title="Edit Memory">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Processors / Cores */}
                    <div className="p-3.5 flex justify-between items-center hover:bg-slate-800/30">
                      <div className="flex items-center gap-3">
                        <Cpu className="w-4 h-4 text-sky-400 shrink-0" />
                        <span className="font-semibold text-slate-300 min-w-[130px]">Processors</span>
                        <div>
                          <span className="text-white font-mono">
                            {configModal.config.cores || 1} ({configModal.config.sockets || 1} sockets, {configModal.config.cores || 1} cores) [{configModal.config.cpu || 'host'}]
                          </span>
                          {configModal.pending?.cores && (
                            <div className="text-orange-400 font-bold text-xs mt-0.5 flex items-center gap-1">
                              <span>{configModal.pending.cores} Cores</span>
                              <span className="text-[10px] font-normal bg-orange-500/20 text-orange-300 px-1.5 py-0.2 rounded border border-orange-500/30">Pending (Perlu Reboot)</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {userRole === 'Admin' && (
                        <button
                          onClick={() => {
                            const currentCores = configModal.pending?.cores || configModal.config.cores || '2';
                            openEditModal({
                              item: configModal.item,
                              field: 'cores',
                              title: 'Ubah Jumlah CPU Cores',
                              label: 'Jumlah CPU Cores',
                              value: currentCores,
                              placeholder: 'Contoh: 2 atau 4',
                              inputType: 'number',
                              helperText: '',
                              iconType: 'cpu',
                              fromConfigModal: true
                            });
                          }}
                          className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition"
                          title="Edit Cores">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                  {/* BIOS */}
                  <div className="p-3.5 flex items-center gap-3 hover:bg-slate-800/30">
                    <Settings className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="font-semibold text-slate-300 min-w-[130px]">BIOS</span>
                    <span className="text-white font-mono">{configModal.config.bios || 'Default (SeaBIOS)'}</span>
                  </div>

                  {/* Display */}
                  <div className="p-3.5 flex items-center gap-3 hover:bg-slate-800/30">
                    <Monitor className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="font-semibold text-slate-300 min-w-[130px]">Display</span>
                    <span className="text-white font-mono">{configModal.config.vga || configModal.config.display || 'Default'}</span>
                  </div>

                  {/* Machine */}
                  <div className="p-3.5 flex items-center gap-3 hover:bg-slate-800/30">
                    <Settings className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-semibold text-slate-300 min-w-[130px]">Machine</span>
                    <span className="text-white font-mono">{configModal.config.machine || 'Default (i440fx)'}</span>
                  </div>

                  {/* SCSI Controller */}
                  <div className="p-3.5 flex items-center gap-3 hover:bg-slate-800/30">
                    <HardDrive className="w-4 h-4 text-blue-400 shrink-0" />
                    <span className="font-semibold text-slate-300 min-w-[130px]">SCSI Controller</span>
                    <span className="text-white font-mono">{configModal.config.scsihw || 'VirtIO SCSI single'}</span>
                  </div>

                  {/* CloudInit Drive */}
                  <div className="p-3.5 flex items-center gap-3 hover:bg-slate-800/30">
                    <Cloud className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span className="font-semibold text-slate-300 min-w-[130px]">CloudInit Drive</span>
                    <span className="text-white font-mono">{configModal.config.ide0 || configModal.config.ide2 || configModal.config.scsi1 || '-'}</span>
                  </div>

                  {/* Hard Disk */}
                  <div className="p-3.5 flex items-center gap-3 hover:bg-slate-800/30">
                    <HardDrive className="w-4 h-4 text-orange-400 shrink-0" />
                    <span className="font-semibold text-slate-300 min-w-[130px]">Hard Disk</span>
                    <span className="text-white font-mono">{configModal.config.scsi0 || configModal.config.rootfs || configModal.config.virtio0 || '-'}</span>
                  </div>

                  {/* Network Devices - Vertical Layout Breakdown */}
                  {(() => {
                    const netEntries = Object.entries(configModal.config || {})
                      .filter(([k, v]) => /^net\d+$/.test(k) && v)
                      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

                    return (
                      <div className="p-3.5 space-y-3 hover:bg-slate-800/20 transition">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <Network className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span className="font-semibold text-slate-300 text-xs">Network Interfaces</span>
                          </div>
                          <span className="text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded-full font-mono">
                            {netEntries.length} Device{netEntries.length > 1 ? 's' : ''}
                          </span>
                        </div>

                        {netEntries.length > 0 ? (
                          <div className="space-y-2.5">
                            {netEntries.map(([netKey, netVal]) => {
                              const parsed = parseNetworkConfig(netVal);
                              return (
                                <div key={netKey} className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-2.5">
                                  {/* Top header per network interface */}
                                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/70">
                                    <div className="flex items-center gap-2">
                                      <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 font-mono font-bold text-xs rounded border border-emerald-500/30">
                                        {netKey}
                                      </span>
                                      {parsed?.model && (
                                        <span className="px-2 py-0.5 bg-sky-500/15 text-sky-300 font-mono text-[10px] rounded border border-sky-500/20">
                                          Model: {parsed.model}
                                        </span>
                                      )}
                                      {parsed?.name && (
                                        <span className="px-2 py-0.5 bg-indigo-500/15 text-indigo-300 font-mono text-[10px] rounded border border-indigo-500/20">
                                          Dev: {parsed.name}
                                        </span>
                                      )}
                                    </div>
                                    {parsed?.firewall && (
                                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${
                                        parsed.firewall === 'Active' 
                                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' 
                                          : 'bg-slate-800 text-slate-400 border-slate-700'
                                      }`}>
                                        Firewall: {parsed.firewall}
                                      </span>
                                    )}
                                  </div>

                                  {/* Grid Vertikal Informasi Properties */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                    {parsed?.mac && (
                                      <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex flex-col">
                                        <span className="text-[10px] text-slate-400 font-medium">MAC Address</span>
                                        <span className="font-mono text-white text-xs select-all mt-0.5">{parsed.mac}</span>
                                      </div>
                                    )}
                                    {parsed?.bridge && (
                                      <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex flex-col">
                                        <span className="text-[10px] text-slate-400 font-medium">Bridge Network</span>
                                        <span className="font-mono text-emerald-400 text-xs font-semibold mt-0.5">{parsed.bridge}</span>
                                      </div>
                                    )}
                                    {parsed?.tag && (
                                      <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex flex-col">
                                        <span className="text-[10px] text-slate-400 font-medium">VLAN Tag</span>
                                        <span className="font-mono text-indigo-300 text-xs mt-0.5">{parsed.tag}</span>
                                      </div>
                                    )}
                                    {parsed?.ip && (
                                      <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex flex-col">
                                        <span className="text-[10px] text-slate-400 font-medium">IP Address / CIDR</span>
                                        <span className="font-mono text-sky-300 text-xs mt-0.5">{parsed.ip}</span>
                                      </div>
                                    )}
                                    {parsed?.gw && (
                                      <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex flex-col">
                                        <span className="text-[10px] text-slate-400 font-medium">Gateway</span>
                                        <span className="font-mono text-slate-300 text-xs mt-0.5">{parsed.gw}</span>
                                      </div>
                                    )}
                                    {parsed?.rate && (
                                      <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex flex-col">
                                        <span className="text-[10px] text-slate-400 font-medium">Rate Limit</span>
                                        <span className="font-mono text-amber-300 text-xs mt-0.5">{parsed.rate}</span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Raw parameter config fallback */}
                                  <div className="pt-0.5">
                                    <span className="text-[10px] text-slate-400 font-mono break-all bg-slate-950/50 px-2 py-1 rounded block border border-slate-800/60 select-all">
                                      {netVal}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 text-xs text-slate-400 italic">
                            Belum ada interface network yang terkonfigurasi.
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Serial Port */}
                  <div className="p-3.5 flex items-center gap-3 hover:bg-slate-800/30">
                    <Terminal className="w-4 h-4 text-teal-400 shrink-0" />
                    <span className="font-semibold text-slate-300 min-w-[130px]">Serial Port (serial0)</span>
                    <span className="text-white font-mono">{configModal.config.serial0 || '-'}</span>
                  </div>
                </div>
              </div>
            ) : (
                /* TAB CLOUD-INIT */
                <div className="space-y-4">
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl divide-y divide-slate-800/80 font-sans text-xs">
                    {/* User */}
                    <div className="p-3.5 flex justify-between items-center hover:bg-slate-800/30">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-slate-300 min-w-[140px]">👤 User</span>
                        <span className="text-white font-mono">{configModal.config.ciuser || '-'}</span>
                      </div>
                      {userRole === 'Admin' && (
                        <button
                          onClick={() => {
                            openEditModal({
                              item: configModal.item,
                              field: 'ciuser',
                              title: 'Ubah Cloud-Init Username',
                              label: 'Default Username Login',
                              value: configModal.config.ciuser || '',
                              placeholder: 'Contoh: ubuntu atau debian',
                              iconType: 'user',
                              fromConfigModal: true
                            });
                          }}
                          className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Password */}
                    <div className="p-3.5 flex justify-between items-center hover:bg-slate-800/30">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-slate-300 min-w-[140px]">🔒 Password</span>
                        <span className="text-white font-mono">{configModal.config.cipassword ? '••••••••••••' : '-'}</span>
                      </div>
                      {userRole === 'Admin' && (
                        <button
                          onClick={() => {
                            openEditModal({
                              item: configModal.item,
                              field: 'cipassword',
                              title: 'Ubah Password Cloud-Init',
                              label: 'Password Login Baru',
                              value: '',
                              placeholder: 'Masukkan password baru',
                              inputType: 'password',
                              iconType: 'key',
                              fromConfigModal: true
                            });
                          }}
                          className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* DNS Domain */}
                    <div className="p-3.5 flex justify-between items-center hover:bg-slate-800/30">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-slate-300 min-w-[140px]">🌐 DNS domain</span>
                        <span className="text-white font-mono">{configModal.config.searchdomain || 'use host settings'}</span>
                      </div>
                      {userRole === 'Admin' && (
                        <button
                          onClick={() => {
                            openEditModal({
                              item: configModal.item,
                              field: 'searchdomain',
                              title: 'Ubah DNS Search Domain',
                              label: 'Search Domain',
                              value: configModal.config.searchdomain || '',
                              placeholder: 'Contoh: local.lab atau domain.internal',
                              iconType: 'globe',
                              fromConfigModal: true
                            });
                          }}
                          className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* DNS Servers */}
                    <div className="p-3.5 flex justify-between items-center hover:bg-slate-800/30">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-slate-300 min-w-[140px]">🌐 DNS servers</span>
                        <span className="text-white font-mono">{configModal.config.nameserver || 'use host settings'}</span>
                      </div>
                      {userRole === 'Admin' && (
                        <button
                          onClick={() => {
                            openEditModal({
                              item: configModal.item,
                              field: 'nameserver',
                              title: 'Ubah DNS Servers',
                              label: 'Nameserver (pisahkan spasi)',
                              value: configModal.config.nameserver || '',
                              placeholder: 'Contoh: 1.1.1.1 8.8.8.8',
                              iconType: 'globe',
                              fromConfigModal: true
                            });
                          }}
                          className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* SSH Public Key */}
                    <div className="p-3.5 flex justify-between items-start hover:bg-slate-800/30">
                      <div className="flex items-start gap-3 flex-1 overflow-hidden pr-2">
                        <span className="font-semibold text-slate-300 min-w-[140px]">🔑 SSH public key</span>
                        <span className="text-white font-mono truncate max-w-sm">
                          {configModal.config.sshkeys ? decodeURIComponent(configModal.config.sshkeys) : '-'}
                        </span>
                      </div>
                      {userRole === 'Admin' && (
                        <button
                          onClick={() => {
                            openEditModal({
                              item: configModal.item,
                              field: 'sshkeys',
                              title: 'Ubah SSH Public Key',
                              label: 'Authorized SSH Public Key',
                              value: configModal.config.sshkeys ? decodeURIComponent(configModal.config.sshkeys) : '',
                              placeholder: 'ssh-rsa AAAAB3NzaC1yc2E...',
                              inputType: 'textarea',
                              iconType: 'key',
                              fromConfigModal: true
                            });
                          }}
                          className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Upgrade Packages */}
                    <div className="p-3.5 flex justify-between items-center hover:bg-slate-800/30">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-slate-300 min-w-[140px]">📦 Upgrade packages</span>
                        <span className="text-white font-mono">{configModal.config.ciupgrade ? 'Yes' : 'No'}</span>
                      </div>
                      {userRole === 'Admin' && (
                        <button
                          onClick={() => {
                            const current = configModal.config.ciupgrade ? 1 : 0;
                            const next = current ? 0 : 1;
                            handleSaveConfig({ ciupgrade: next });
                          }}
                          className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition"
                          title="Toggle Upgrade Packages">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* IP Config net0 */}
                    <div className="p-3.5 flex justify-between items-center hover:bg-slate-800/30">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-slate-300 min-w-[140px]">⇄ IP Config (net0)</span>
                        <span className="text-white font-mono">{configModal.config.ipconfig0 || 'ip=dhcp'}</span>
                      </div>
                      {userRole === 'Admin' && (
                        <button
                          onClick={() => {
                            openEditModal({
                              item: configModal.item,
                              field: 'ipconfig0',
                              title: 'Ubah IP Config (net0)',
                              label: 'IPv4 / IPv6 Configuration (net0)',
                              value: configModal.config.ipconfig0 || 'ip=dhcp',
                              placeholder: 'Contoh: ip=dhcp atau ip=192.168.1.50/24,gw=192.168.1.1',
                              iconType: 'network',
                              fromConfigModal: true
                            });
                          }}
                          className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* IP Config net1 */}
                    <div className="p-3.5 flex justify-between items-center hover:bg-slate-800/30">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-slate-300 min-w-[140px]">⇄ IP Config (net1)</span>
                        <span className="text-white font-mono">{configModal.config.ipconfig1 || '-'}</span>
                      </div>
                      {userRole === 'Admin' && (
                        <button
                          onClick={() => {
                            openEditModal({
                              item: configModal.item,
                              field: 'ipconfig1',
                              title: 'Ubah IP Config (net1)',
                              label: 'IPv4 / IPv6 Configuration (net1)',
                              value: configModal.config.ipconfig1 || '',
                              placeholder: 'Contoh: ip=10.10.10.50/24',
                              iconType: 'network',
                              fromConfigModal: true
                            });
                          }}
                          className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-slate-950 border-t border-slate-800 flex justify-between items-center shrink-0">
              <span className="text-[11px] text-slate-500">                </span>
              <button
                onClick={() => setConfigModal({ ...configModal, isOpen: false })}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition">
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. MODAL SNAPSHOT & ROLLBACK */}
      {snapshotModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-6">
            <div className="flex justify-between items-center border-b border-slate-700 pb-3">
              <h3 className="font-bold text-lg text-white flex items-center gap-2">
                <Camera className="w-5 h-5 text-purple-400" /> Snapshot Manager - {snapshotModal.item?.name || `ID ${snapshotModal.item?.vmid}`}
              </h3>
              <button onClick={() => setSnapshotModal({ isOpen: false, item: null, snapshots: [] })} className="text-slate-400 hover:text-white">✕</button>
            </div>

            {/* Form Create Snapshot */}
            <form onSubmit={handleCreateSnapshot} className="space-y-3 bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
              <h4 className="text-xs font-bold text-slate-300 uppercase">Buat Snapshot Baru</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input 
                  type="text" 
                  placeholder="Nama Snapshot" 
                  value={snapForm.snapname}
                  onChange={e => setSnapForm({...snapForm, snapname: e.target.value})}
                  required 
                  className="bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-purple-500"
                />
                <input 
                  type="text" 
                  placeholder="Deskripsi" 
                  value={snapForm.description}
                  onChange={e => setSnapForm({...snapForm, description: e.target.value})}
                  className="bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <button type="submit" className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition">
                Simpan Snapshot
              </button>
            </form>

            {/* List Snapshots & Rollback */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-300 uppercase">Daftar Snapshot</h4>
              <div className="max-h-40 overflow-y-auto space-y-2">
                {snapshotModal.snapshots.map(s => (
                  <div key={s.name} className="flex justify-between items-center p-3 bg-slate-900/80 rounded-lg border border-slate-700/40">
                    <div>
                      <p className="font-bold text-xs text-white">{s.name}</p>
                      <p className="text-[10px] text-slate-400">{s.description || 'Tidak ada deskripsi'}</p>
                    </div>
                    {userRole === 'Admin' && s.name !== 'current' && (
                      <button 
                        onClick={() => handleRollbackSnapshot(s.name)}
                        className="flex items-center gap-1 px-3 py-1 bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white rounded border border-amber-500/30 text-xs font-semibold transition">
                        <RotateCcw className="w-3 h-3" /> Rollback
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. MODAL DEPLOY INSTANCE (VM / LXC DENGAN PILIHAN DINAMIS & AUTO-RESET) */}
      {createModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-700 pb-3">
              <h3 className="font-bold text-lg text-white">Deploy Instance Baru ({createModal.node})</h3>
              <button onClick={closeCreateModal} className="text-slate-400 hover:text-white">✕</button>
            </div>

            {/* Selector Tipe: Virtual Machine (QEMU) vs Container (LXC) */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900 rounded-xl border border-slate-700/80">
              <button
                type="button"
                onClick={() => setCreateForm({ ...createForm, type: 'qemu' })}
                className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition ${
                  createForm.type === 'qemu'
                    ? 'bg-orange-500 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}>
                <Cpu className="w-4 h-4" />
                <span>VM (QEMU)</span>
              </button>

              <button
                type="button"
                onClick={() => setCreateForm({ ...createForm, type: 'lxc' })}
                className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition ${
                  createForm.type === 'lxc'
                    ? 'bg-teal-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}>
                <Box className="w-4 h-4" />
                <span>LXC Container</span>
              </button>
            </div>

            <form onSubmit={handleDeployVM} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 font-semibold">VMID</label>
                <input 
                  type="number" 
                  required 
                  value={createForm.vmid} 
                  onChange={e => setCreateForm({...createForm, vmid: e.target.value})} 
                  placeholder="Contoh: 105"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-orange-500" 
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold">{createForm.type === 'qemu' ? 'Nama VM' : 'Hostname LXC'}</label>
                <input 
                  type="text" 
                  required 
                  value={createForm.name} 
                  onChange={e => setCreateForm({...createForm, name: e.target.value})} 
                  placeholder={createForm.type === 'qemu' ? "" : ""}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-orange-500" 
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400 font-semibold">RAM (MB)</label>
                  <input 
                    type="number" 
                    required 
                    value={createForm.memory} 
                    onChange={e => setCreateForm({...createForm, memory: e.target.value})} 
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-orange-500" 
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-semibold">CPU Cores</label>
                  <input 
                    type="number" 
                    required 
                    value={createForm.cores} 
                    onChange={e => setCreateForm({...createForm, cores: e.target.value})} 
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-orange-500" 
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold">Ukuran Disk (GB)</label>
                <input 
                  type="number" 
                  value={createForm.disk} 
                  onChange={e => setCreateForm({...createForm, disk: e.target.value})} 
                  placeholder="Contoh: 32"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-orange-500" 
                />
              </div>

              {createForm.type === 'lxc' && (
                <>
                  <div>
                    <label className="text-xs text-slate-400 font-semibold">Root Password (LXC)</label>
                    <input 
                      type="password" 
                      value={createForm.password} 
                      onChange={e => setCreateForm({...createForm, password: e.target.value})} 
                      placeholder="Password login root container"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-teal-500" 
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs text-slate-400 font-semibold">OS Template Path</label>
                      {loadingTemplates && (
                        <span className="text-[10px] text-teal-400 flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin" /> Membaca storage...
                        </span>
                      )}
                    </div>

                    {availableTemplates.length > 0 ? (
                      <div className="space-y-2">
                        <select 
                          value={createForm.ostemplate} 
                          onChange={e => setCreateForm({...createForm, ostemplate: e.target.value})} 
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono focus:outline-none focus:border-teal-500">
                          {availableTemplates.map(tmpl => (
                            <option key={tmpl.volid} value={tmpl.volid}>
                              {tmpl.volid}
                            </option>
                          ))}
                          <option value="custom">-- Input Path Manual Lainnya --</option>
                        </select>

                        {createForm.ostemplate === 'custom' && (
                          <input 
                            type="text" 
                            required
                            value={createForm.customOstemplate || ''} 
                            onChange={e => setCreateForm({...createForm, customOstemplate: e.target.value})} 
                            placeholder="Contoh: local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono focus:outline-none focus:border-teal-500" 
                          />
                        )}
                      </div>
                    ) : (
                      <input 
                        type="text" 
                        required
                        value={createForm.ostemplate} 
                        onChange={e => setCreateForm({...createForm, ostemplate: e.target.value})} 
                        placeholder="Contoh: local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono focus:outline-none focus:border-teal-500" 
                      />
                    )}
                  </div>
                </>
              )}

              <button 
                type="submit" 
                className={`w-full py-2.5 rounded-xl text-xs font-bold transition shadow-lg mt-2 ${
                  createForm.type === 'qemu' 
                    ? 'bg-orange-500 hover:bg-orange-600 text-white' 
                    : 'bg-teal-600 hover:bg-teal-700 text-white'
                }`}>
                Deploy {createForm.type === 'qemu' ? 'VM' : 'LXC'} 
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 4. MODAL CLONE INSTANCE (AUTO-RESET ON OPEN/CLOSE) */}
      {cloneModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-700 pb-3">
              <h3 className="font-bold text-lg text-white">
                Clone {cloneModal.item?.type === 'qemu' ? 'VM' : 'LXC'} {cloneModal.item?.vmid}
              </h3>
              <button onClick={closeCloneModal} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleCloneVM} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 font-semibold">New Target VMID</label>
                <input 
                  type="number" 
                  required 
                  value={cloneForm.newid} 
                  onChange={e => setCloneForm({...cloneForm, newid: e.target.value})} 
                  placeholder="Contoh: 106"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-indigo-500" 
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold">Nama Instance Baru</label>
                <input 
                  type="text" 
                  required 
                  value={cloneForm.name} 
                  onChange={e => setCloneForm({...cloneForm, name: e.target.value})} 
                  placeholder="Nama hasil clone"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-indigo-500" 
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold">Target Node</label>
                <select 
                  value={cloneForm.targetNode} 
                  onChange={e => setCloneForm({...cloneForm, targetNode: e.target.value})} 
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-indigo-500">
                  <option value="">Node Saat Ini ({cloneModal.item?.node})</option>
                  {nodes.map(n => <option key={n.node} value={n.node}>{n.node}</option>)}
                </select>
              </div>
              <button type="submit" className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-lg mt-2">
                Proses Clone Sekarang
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal Power Confirm */}
      {confirmModal.isOpen && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full bg-slate-800 border-2 border-orange-500/50 rounded-2xl p-4 shadow-2xl space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/20 text-orange-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Konfirmasi Tindakan</h3>
              <p className="text-[11px] text-slate-400">
                Eksekusi <span className="font-bold uppercase text-orange-400">{confirmModal.action}</span> pada {confirmModal.item?.type === 'qemu' ? 'VM' : 'LXC'} <span className="text-white font-semibold">"{confirmModal.item?.name || confirmModal.item?.vmid}"</span>?
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-700/60">
            <button onClick={() => setConfirmModal({ isOpen: false, item: null, action: null })} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-lg transition">Batal</button>
            <button onClick={executePowerAction} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded-lg shadow-md transition">Ya, Lanjutkan</button>
          </div>
        </div>
      )}

      {/* Modal Hapus Instance (Danger Zone) */}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/50 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-400">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">Hapus Instance Permanen</h3>
                <p className="text-xs text-rose-300">
                  {deleteModal.item?.type === 'qemu' ? 'Virtual Machine' : 'LXC Container'} (ID {deleteModal.item?.vmid})
                </p>
              </div>
            </div>

            <div className="bg-rose-950/40 border border-rose-900/60 p-3.5 rounded-xl space-y-1.5 text-xs text-rose-200">
              <p className="font-semibold text-white">
                Apakah Anda yakin ingin menghapus <span className="text-rose-400 font-bold">"{deleteModal.item?.name || deleteModal.item?.vmid}"</span>?
              </p>
              <p className="text-[11px] text-slate-400">
                • Node: <strong className="text-white">{deleteModal.item?.node}</strong><br />
                • Disk & Data: Akan dihapus (purge) dari storage cluster secara permanen dan tidak dapat dipulihkan.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button 
                disabled={deleteModal.loading}
                onClick={closeDeleteModal} 
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition">
                Batal
              </button>
              <button 
                disabled={deleteModal.loading}
                onClick={handleDeleteVM} 
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-lg transition active:scale-95">
                {deleteModal.loading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Menghapus...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Ya, Hapus Sekarang</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. MODAL UNIVERSAL EDIT KONFIGURASI (Glassmorphic Custom Popup untuk Hostname, CPU, RAM, Cloud-Init, dll) */}
      {editModal.isOpen && (
        <div 
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget && !editModal.loading) closeEditModal();
          }}>
          <div className="bg-slate-900/95 border border-slate-700/80 ring-1 ring-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-sky-500/20 to-blue-500/10 border border-sky-500/30 rounded-xl">
                  {editModal.iconType === 'memory' || editModal.iconType === 'cpu' ? (
                    <Cpu className="w-5 h-5 text-sky-400" />
                  ) : editModal.iconType === 'user' ? (
                    <Server className="w-5 h-5 text-purple-400" />
                  ) : editModal.iconType === 'key' ? (
                    <Key className="w-5 h-5 text-amber-400" />
                  ) : editModal.iconType === 'network' ? (
                    <Network className="w-5 h-5 text-teal-400" />
                  ) : editModal.iconType === 'globe' ? (
                    <Globe className="w-5 h-5 text-indigo-400" />
                  ) : (
                    <Tag className="w-5 h-5 text-sky-400" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">
                    {editModal.title}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-400 font-mono">
                      ID: {editModal.item?.vmid}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono border border-slate-700">
                      Node: {editModal.item?.node}
                    </span>
                  </div>
                </div>
              </div>
              <button 
                disabled={editModal.loading}
                onClick={closeEditModal}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                title="Tutup">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveEditModal} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {editModal.label}
                </label>
                <div className="relative">
                  {editModal.inputType === 'textarea' ? (
                    <textarea
                      rows={4}
                      autoFocus
                      value={editModal.value}
                      onChange={(e) => setEditModal({ ...editModal, value: e.target.value })}
                      placeholder={editModal.placeholder}
                      className="w-full bg-slate-950 border border-slate-700 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none transition font-mono resize-none"
                    />
                  ) : (
                    <input
                      type={editModal.inputType}
                      required={editModal.field !== 'sshkeys' && editModal.field !== 'searchdomain' && editModal.field !== 'nameserver'}
                      autoFocus
                      value={editModal.value}
                      onChange={(e) => {
                        let val = e.target.value;
                        if (editModal.field === 'name' || editModal.field === 'hostname') {
                          val = val.replace(/\s+/g, '-');
                        }
                        setEditModal({ ...editModal, value: val });
                      }}
                      placeholder={editModal.placeholder}
                      className="w-full bg-slate-950 border border-slate-700 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition font-mono"
                    />
                  )}
                  {editModal.value && editModal.inputType !== 'textarea' && (
                    <button
                      type="button"
                      onClick={() => setEditModal({ ...editModal, value: '' })}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300 rounded transition">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                  {editModal.helperText}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  disabled={editModal.loading}
                  onClick={closeEditModal}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold rounded-xl transition">
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={editModal.loading || (editModal.inputType !== 'textarea' && !editModal.value?.toString().trim() && editModal.field !== 'sshkeys' && editModal.field !== 'searchdomain' && editModal.field !== 'nameserver')}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-sky-500/20 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                  {editModal.loading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Simpan Perubahan</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}