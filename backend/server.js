const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const https = require('https');
const WebSocket = require('ws');
const url = require('url');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const httpsAgent = new https.Agent({ 
    rejectUnauthorized: false,
    keepAlive: false,
    timeout: 10000
});

// KONFIGURASI PROXMOX ANDA
const PROXMOX_HOST = 'https://172.20.22.2:8006';
const TOKEN_ID = 'root@pam!web-mgmt-srv';
const TOKEN_SECRET = 'ae9f4566-82c8-4b6b-be1e-a89a523d8a16';

// KONFIGURASI AUTENTIKASI DASHBOARD
const DASHBOARD_AUTH = {
    username: process.env.DASHBOARD_USER || 'root',
    password: process.env.DASHBOARD_PASSWORD || 'Admin@TA305'
};

// Simple in-memory valid tokens map (token -> { username, createdAt })
const validSessions = new Map();

// Generate simple secure session token
function generateSessionToken(username) {
    const randomHex = require('crypto').randomBytes(24).toString('hex');
    const token = `pmx_${Buffer.from(username).toString('base64')}_${randomHex}`;
    validSessions.set(token, {
        username,
        role: 'Admin',
        createdAt: Date.now()
    });
    return token;
}

// API AUTH: Login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });
    }

    if (username === DASHBOARD_AUTH.username && password === DASHBOARD_AUTH.password) {
        const token = generateSessionToken(username);
        console.log(`[AUTH] Login berhasil untuk user: ${username}`);
        return res.json({
            success: true,
            message: 'Login berhasil',
            token,
            user: {
                username,
                role: 'Admin'
            }
        });
    }

    console.warn(`[AUTH] Login gagal: username atau password salah untuk '${username}'`);
    return res.status(401).json({
        success: false,
        message: 'Username atau password salah'
    });
});

// API AUTH: Verify Token
app.get('/api/auth/verify', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : req.query.token;

    if (token && validSessions.has(token)) {
        const session = validSessions.get(token);
        return res.json({
            valid: true,
            user: {
                username: session.username,
                role: session.role
            }
        });
    }

    return res.status(401).json({ valid: false, message: 'Sesi tidak valid atau telah kadaluarsa' });
});

// API AUTH: Logout
app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : req.body?.token;
    if (token) {
        validSessions.delete(token);
    }
    res.json({ success: true, message: 'Logout berhasil' });
});

const headers = {
    Authorization: `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`
};

const proxmoxApi = axios.create({
    baseURL: `${PROXMOX_HOST}/api2/json`,
    headers,
    httpsAgent,
    timeout: 8000
});

app.get('/api/config', (req, res) => {
    res.json({ 
        proxmoxHost: PROXMOX_HOST,
        serverTime: new Date().toISOString()
    });
});

// Cache Override Sementara untuk Nama VM/LXC yang baru diubah (mencegah lag cache cluster Proxmox ~10 detik)
const recentNameOverrides = new Map();

// Function Ambil Data Proxmox (Dioptimalkan dengan persistent HTTP keep-alive)
async function getProxmoxData() {
    try {
        const [nodesRes, resRes] = await Promise.all([
            proxmoxApi.get('/nodes'),
            proxmoxApi.get('/cluster/resources')
        ]);

        const rawNodes = nodesRes.data.data || [];
        const rawResources = resRes.data.data || [];

        // Process status live Node secara paralel
        const liveNodes = await Promise.all(
            rawNodes.map(async(nodeObj) => {
                try {
                    const statusRes = await proxmoxApi.get(`/nodes/${nodeObj.node}/status`);
                    const statusData = statusRes.data.data;
                    return {
                        ...nodeObj,
                        cpu: statusData.cpu,
                        mem: statusData.memory?.used || 0,
                        maxmem: statusData.memory?.total || 0
                    };
                } catch (e) {
                    return nodeObj;
                }
            })
        );

        // Format data VM & LXC agar persentase CPU, RAM, dan Storage mudah dibaca oleh Frontend
        const now = Date.now();
        const formattedResources = rawResources.map(item => {
            if (item.type === 'qemu' || item.type === 'lxc') {
                const overrideKey = `${item.node}-${item.type}-${item.vmid}`;
                const override = recentNameOverrides.get(overrideKey);
                let finalName = item.name || `VM ${item.vmid}`;

                if (override) {
                    if (now < override.expireAt) {
                        finalName = override.name;
                    } else {
                        recentNameOverrides.delete(overrideKey);
                    }
                }

                return {
                    id: item.id,
                    vmid: item.vmid,
                    name: finalName,
                    node: item.node,
                    type: item.type, // 'qemu' (VM) atau 'lxc'
                    status: item.status, // 'running' atau 'stopped'
                    // CPU usage (misal: 0.05 = 5%)
                    cpu: item.status === 'running' ? (item.cpu || 0) : 0,
                    // RAM usage dalam Byte
                    mem: item.status === 'running' ? (item.mem || 0) : 0,
                    maxmem: item.maxmem || 0,
                    // Storage/Disk usage dalam Byte
                    disk: item.status === 'running' ? (item.disk || 0) : 0,
                    maxdisk: item.maxdisk || 0,
                    // Persentase matang untuk UI
                    cpuPercent: item.status === 'running' ? ((item.cpu || 0) * 100).toFixed(1) : 0,
                    ramPercent: item.status === 'running' && item.maxmem ? ((item.mem / item.maxmem) * 100).toFixed(1) : 0,
                    diskPercent: item.status === 'running' && item.maxdisk ? ((item.disk / item.maxdisk) * 100).toFixed(1) : 0
                };
            }
            return item;
        });

        return {
            nodes: liveNodes,
            resources: formattedResources
        };
    } catch (err) {
        console.error('Error fetching Proxmox data:', err.message);
        return null;
    }
}

// Function membaca Tasks Log Asli dari Proxmox Cluster (/cluster/tasks)
async function getProxmoxTasks() {
    try {
        let rawTasks = [];
        try {
            const clusterRes = await proxmoxApi.get('/cluster/tasks');
            rawTasks = clusterRes.data?.data || [];
        } catch (e) {
            const nodesRes = await proxmoxApi.get('/nodes');
            const nodes = nodesRes.data?.data || [];
            const taskPromises = nodes.map(async(nodeObj) => {
                try {
                    const res = await proxmoxApi.get(`/nodes/${nodeObj.node}/tasks?limit=30`);
                    return res.data?.data || [];
                } catch (err) {
                    return [];
                }
            });
            const results = await Promise.all(taskPromises);
            results.forEach(tasks => rawTasks.push(...tasks));
        }

        // Urutkan berdasarkan waktu mulai terbaru
        rawTasks.sort((a, b) => b.starttime - a.starttime);

        return rawTasks.slice(0, 50).map(task => {
            let description = task.type || 'Task';
            const idStr = task.id ? ` ${task.id}` : '';

            if (task.type === 'vncproxy' || task.type === 'vncshell') {
                description = task.id ? `VM/CT ${task.id} - Console` : `PVE Host Shell (${task.node})`;
            } else if (task.type === 'qmstart' || task.type === 'vzstart') {
                description = `Start ${task.type === 'qmstart' ? 'VM' : 'LXC'}${idStr}`;
            } else if (task.type === 'qmstop' || task.type === 'vzstop') {
                description = `Stop ${task.type === 'qmstop' ? 'VM' : 'LXC'}${idStr}`;
            } else if (task.type === 'qmreboot' || task.type === 'vzreboot') {
                description = `Reboot ${task.type === 'qmreboot' ? 'VM' : 'LXC'}${idStr}`;
            } else if (task.type === 'qmconfig' || task.type === 'vzconfig') {
                description = `Config ${task.type === 'qmconfig' ? 'VM' : 'LXC'}${idStr}`;
            } else if (task.type === 'qmsnapshot') {
                description = `Snapshot VM${idStr}`;
            } else if (task.type === 'qmdel' || task.type === 'vzdel' || task.type === 'qmdestroy' || task.type === 'vzdestroy') {
                description = `Destroy VM/CT${idStr}`;
            } else if (task.type === 'aptupdate') {
                description = `Update Repository (${task.node})`;
            } else {
                description = `${task.type}${idStr}`;
            }

            return {
                upid: task.upid,
                starttime: task.starttime,
                endtime: task.endtime,
                node: task.node,
                user: task.user || 'root@pam',
                description: description,
                status: task.status || (task.endtime ? 'OK' : 'RUNNING')
            };
        });
    } catch (err) {
        console.error('Gagal mengambil Task Log Cluster:', err.message);
        return [];
    }
}

// Endpoint HTTP
app.get('/api/logs', async(req, res) => {
    const tasks = await getProxmoxTasks();
    res.json(tasks);
});

// Broadcast Real-time Engine
let isBroadcasting = false;
async function broadcastProxmoxData() {
    if (isBroadcasting) return;
    isBroadcasting = true;
    try {
        if (io.engine.clientsCount > 0) {
            const data = await getProxmoxData();
            if (data) {
                io.emit('proxmox-update', {
                    ...data,
                    proxmoxHost: PROXMOX_HOST
                });
            }
        }
    } catch (err) {
        console.error('Broadcast error:', err.message);
    } finally {
        isBroadcasting = false;
    }
}

// Polling cepat data status & resources
setInterval(broadcastProxmoxData, 1000);

// Polling Task Logs
setInterval(async() => {
    if (io.engine.clientsCount > 0) {
        const tasks = await getProxmoxTasks();
        io.emit('activity-log-update', tasks);
    }
}, 2500);

// Socket.io Real-time Connection
io.on('connection', (socket) => {
    console.log('Client terhubung ke Real-time Dashboard:', socket.id);

    // Kirim data langsung saat pertama kali konek
    getProxmoxData().then(data => {
        if (data) {
            socket.emit('proxmox-update', {
                ...data,
                proxmoxHost: PROXMOX_HOST
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('Client terputus:', socket.id);
    });
});

// Endpoint Power Control (Start / Stop / Reboot)
app.post('/api/vm/:node/:type/:vmid/status/:action', async(req, res) => {
    const { node, type, vmid, action } = req.params;

    try {
        // Proxmox API status endpoint
        await proxmoxApi.post(`/nodes/${node}/${type}/${vmid}/status/${action}`);

        // Catat ke Audit Log
        addLog('Admin', action.toUpperCase(), `${type.toUpperCase()} ID ${vmid}`, 'SUCCESS');

        // Trigger broadcast data langsung
        setTimeout(broadcastProxmoxData, 300);

        res.json({ message: `Berhasil mengirim perintah ${action}` });
    } catch (err) {
        addLog('Admin', action.toUpperCase(), `${type.toUpperCase()} ID ${vmid}`, 'FAILED', err.message);
        res.status(500).json({ error: err.response?.data?.errors || err.message });
    }
});

// ==========================================
// 1. AUDIT LOG SYSTEM IN-MEMORY / DATABASE
// ==========================================
const activityLogs = [];

const addLog = (user, action, target, status = 'SUCCESS', details = '') => {
    const logEntry = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        user,
        action,
        target,
        status,
        details
    };
    activityLogs.unshift(logEntry); // Tambah log ke paling atas
    if (activityLogs.length > 100) activityLogs.pop(); // Simpan max 100 log terbaru
    io.emit('activity-log-update', activityLogs); // Broadcast log ke semua client
};

// Endpoint ambil Log
app.get('/api/logs', (req, res) => {
    res.json(activityLogs);
});

// ==========================================
// 2. IP ADDRESS GUEST AGENT & INTERFACES
// ==========================================
app.get('/api/vm/:node/:type/:vmid/interfaces', async(req, res) => {
    const { node, type, vmid } = req.params;
    try {
        let response;
        if (type === 'qemu') {
            response = await proxmoxApi.get(`/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`);
            const interfaces = response.data ?.data ?.result || [];
            res.json({ interfaces });
        } else {
            response = await proxmoxApi.get(`/nodes/${node}/lxc/${vmid}/interfaces`);
            res.json({ interfaces: response.data ?.data || [] });
        }
    } catch (err) {
        res.status(500).json({ error: "Gagal mengambil IP Address (Guest Agent/LXC offline)" });
    }
});

// Format pesan error Proxmox agar rapi dan tidak muncul [object Object]
const formatProxmoxError = (err) => {
    if (!err) return 'Terjadi kesalahan sistem';
    if (typeof err === 'string') return err;
    if (err.response?.data) {
        const data = err.response.data;
        if (typeof data.errors === 'string') return data.errors;
        if (typeof data.errors === 'object' && data.errors !== null) {
            return Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join(', ');
        }
        if (typeof data.message === 'string') return data.message;
        if (typeof data.error === 'string') return data.error;
        if (typeof data === 'string') return data;
    }
    return err.message || JSON.stringify(err);
};

// ==========================================
// 3. CREATE INSTANCE (VM / LXC)
// ==========================================
app.post(['/api/vm/create', '/api/vm/:node/create'], async(req, res) => {
    const node = req.params.node || req.body.node || 'pve1';
    const { vmid, name, memory, cores, disk, type = 'qemu', ostemplate, password } = req.body;

    if (!vmid || !name) {
        return res.status(400).json({ error: "VMID dan Nama wajib diisi" });
    }

    try {
        if (type === 'qemu') {
            const params = {
                vmid: Number(vmid),
                name: name,
                memory: Number(memory) || 2048,
                cores: Number(cores) || 2,
                scsihw: 'virtio-scsi-pci'
            };
            if (disk) {
                params.scsi0 = `local-lvm:${disk},iothread=1`;
            }
            await proxmoxApi.post(`/nodes/${node}/qemu`, params);
        } else {
            const params = {
                vmid: Number(vmid),
                hostname: name,
                memory: Number(memory) || 1024,
                cores: Number(cores) || 1,
                storage: 'local-lvm'
            };
            if (ostemplate) params.ostemplate = ostemplate;
            if (password) params.password = password;
            if (disk) params.rootfs = `local-lvm:${disk}`;
            await proxmoxApi.post(`/nodes/${node}/lxc`, params);
        }
        addLog('Admin', 'CREATE', `${type.toUpperCase()} ${name} (ID ${vmid})`, 'SUCCESS');
        setTimeout(broadcastProxmoxData, 500);
        res.json({ message: `Berhasil membuat ${type.toUpperCase()} ${name}` });
    } catch (err) {
        const errMsg = formatProxmoxError(err);
        addLog('Admin', 'CREATE', `${type.toUpperCase()} ${name}`, 'FAILED', errMsg);
        res.status(500).json({ error: errMsg });
    }
});

// ==========================================
// 4. CLONE VM / LXC TEMPLATE
// ==========================================
app.post('/api/vm/:node/:type/:vmid/clone', async(req, res) => {
    const { node, type, vmid } = req.params;
    const { newid, name, targetNode } = req.body;

    if (!newid) {
        return res.status(400).json({ error: "New VMID wajib diisi" });
    }

    try {
        const cloneParams = {
            newid: Number(newid),
            full: 1
        };
        if (name) {
            if (type === 'qemu') cloneParams.name = name;
            else cloneParams.hostname = name;
        }
        if (targetNode && targetNode !== node) {
            cloneParams.target = targetNode;
        }

        await proxmoxApi.post(`/nodes/${node}/${type}/${vmid}/clone`, cloneParams);
        addLog('Admin', 'CLONE', `From ID ${vmid} to ${name || newid} (ID ${newid})`, 'SUCCESS');
        setTimeout(broadcastProxmoxData, 500);
        res.json({ message: `Proses clone ke ID ${newid} berhasil dimulai` });
    } catch (err) {
        const errMsg = formatProxmoxError(err);
        addLog('Admin', 'CLONE', `From ID ${vmid}`, 'FAILED', errMsg);
        res.status(500).json({ error: errMsg });
    }
});

// ==========================================
// 5. HARDWARE & CLOUD-INIT CONFIG
// ==========================================
// Ambil Konfigurasi Hardware & Cloud-Init VM/LXC beserta status Pending
app.get('/api/vm/:node/:type/:vmid/config', async(req, res) => {
    const { node, type, vmid } = req.params;
    try {
        const [cfgRes, pendingRes] = await Promise.all([
            proxmoxApi.get(`/nodes/${node}/${type}/${vmid}/config`),
            type === 'qemu'
                ? proxmoxApi.get(`/nodes/${node}/qemu/${vmid}/pending`).catch(() => ({ data: { data: [] } }))
                : Promise.resolve({ data: { data: [] } })
        ]);

        const rawConfig = cfgRes.data?.data || {};
        const rawPendingList = pendingRes.data?.data || [];

        const pending = {};
        if (Array.isArray(rawPendingList)) {
            rawPendingList.forEach(item => {
                if (item.pending !== undefined) {
                    pending[item.key] = item.pending;
                }
            });
        }

        res.json({ config: rawConfig, pending });
    } catch (err) {
        res.status(500).json({ error: formatProxmoxError(err) });
    }
});

// Ambil Daftar OS Template LXC yang tersedia di Proxmox Storage (vztmpl)
app.get('/api/node/:node/templates', async(req, res) => {
    const { node } = req.params;
    try {
        let templates = [];
        try {
            const storageRes = await proxmoxApi.get(`/nodes/${node}/storage`);
            const storages = storageRes.data?.data || [];
            const tmplStorages = storages.filter(s => s.content && s.content.includes('vztmpl'));
            const targetStorages = tmplStorages.length > 0 ? tmplStorages : [{ storage: 'local' }];

            for (const st of targetStorages) {
                try {
                    const contentRes = await proxmoxApi.get(`/nodes/${node}/storage/${st.storage}/content?content=vztmpl`);
                    const items = contentRes.data?.data || [];
                    items.forEach(item => {
                        if (item.volid) {
                            templates.push({
                                volid: item.volid,
                                format: item.format,
                                size: item.size,
                                storage: st.storage
                            });
                        }
                    });
                } catch (err) {}
            }
        } catch (e) {
            // Fallback coba query storage 'local' langsung
            try {
                const contentRes = await proxmoxApi.get(`/nodes/${node}/storage/local/content?content=vztmpl`);
                const items = contentRes.data?.data || [];
                items.forEach(item => {
                    if (item.volid) {
                        templates.push({
                            volid: item.volid,
                            format: item.format,
                            size: item.size,
                            storage: 'local'
                        });
                    }
                });
            } catch (err2) {}
        }
        res.json({ templates });
    } catch (err) {
        res.json({ templates: [] });
    }
});

// Update Konfigurasi Hardware, Cloud-Init, atau Ganti Nama (VM / LXC)
app.post('/api/vm/:node/:type/:vmid/config', async(req, res) => {
    const { node, type, vmid } = req.params;
    let updateData = { ...req.body };

    try {
        // Normalisasi key nama/hostname sesuai tipe instance
        if (type === 'lxc') {
            if (updateData.name && !updateData.hostname) {
                updateData.hostname = updateData.name;
                delete updateData.name;
            }
            if (updateData.hostname) {
                // Bersihkan spasi atau karakter ilegal pada hostname LXC (harus format DNS valid)
                updateData.hostname = String(updateData.hostname).trim().toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/^-+|-+$/g, '');
            }
        } else if (type === 'qemu') {
            if (updateData.hostname && !updateData.name) {
                updateData.name = updateData.hostname;
                delete updateData.hostname;
            }
            if (updateData.name) {
                // Bersihkan spasi di nama VM (Proxmox QEMU melarang spasi)
                updateData.name = String(updateData.name).trim().replace(/\s+/g, '-');
            }
        }

        const formParams = new URLSearchParams();
        for (const [key, value] of Object.entries(updateData)) {
            if (value !== undefined && value !== null && key !== 'role') {
                formParams.append(key, String(value));
            }
        }

        const configHeaders = {
            ...headers,
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        if (type === 'qemu') {
            await proxmoxApi.post(`/nodes/${node}/qemu/${vmid}/config`, formParams.toString(), { headers: configHeaders });
        } else {
            // Proxmox LXC config: Coba PUT terlebih dahulu, lalu POST jika gagal
            try {
                await proxmoxApi.put(`/nodes/${node}/lxc/${vmid}/config`, formParams.toString(), { headers: configHeaders });
            } catch (putErr) {
                await proxmoxApi.post(`/nodes/${node}/lxc/${vmid}/config`, formParams.toString(), { headers: configHeaders });
            }
        }
        
        // Simpan ke Cache Override Nama seketika
        if (updateData.name || updateData.hostname) {
            const newName = updateData.name || updateData.hostname;
            recentNameOverrides.set(`${node}-${type}-${vmid}`, {
                name: newName,
                expireAt: Date.now() + 20000 // Override selama 20 detik hingga Proxmox pvestatd sinkron
            });
        }

        const changeLabel = updateData.name || updateData.hostname ? `RENAME (${updateData.name || updateData.hostname})` : 'CONFIG_UPDATE';
        addLog('Admin', changeLabel, `${type.toUpperCase()} ID ${vmid}`, 'SUCCESS');
        
        // Trigger broadcast real-time segera
        broadcastProxmoxData();

        res.json({ 
            message: updateData.name || updateData.hostname 
                ? `Nama berhasil diubah menjadi "${updateData.name || updateData.hostname}"` 
                : "Konfigurasi berhasil disimpan",
            data: updateData
        });
    } catch (err) {
        const errMsg = formatProxmoxError(err);
        addLog('Admin', 'CONFIG_UPDATE', `${type.toUpperCase()} ID ${vmid}`, 'FAILED', errMsg);
        res.status(500).json({ error: errMsg });
    }
});

// ==========================================
// 6. DELETE INSTANCE (VM / LXC)
// ==========================================
app.delete('/api/vm/:node/:type/:vmid', async(req, res) => {
    const { node, type, vmid } = req.params;

    try {
        // Cek status apakah sedang running, jika running coba kirim stop terlebih dahulu
        try {
            const statusRes = await proxmoxApi.get(`/nodes/${node}/${type}/${vmid}/status/current`);
            if (statusRes.data?.data?.status === 'running') {
                await proxmoxApi.post(`/nodes/${node}/${type}/${vmid}/status/stop`);
                // Berikan jeda 1 detik agar proses stop selesai
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (statusErr) {
            // Lanjutkan jika gagal cek status
        }

        const deleteParams = new URLSearchParams({
            purge: '1',
            'destroy-unreferenced-disks': '1'
        });
        if (type === 'lxc') {
            deleteParams.append('force', '1');
        }

        await proxmoxApi.delete(`/nodes/${node}/${type}/${vmid}?${deleteParams.toString()}`);

        addLog('Admin', 'DELETE', `${type.toUpperCase()} ID ${vmid}`, 'SUCCESS');

        // Broadcast perubahan segera
        setTimeout(broadcastProxmoxData, 500);

        res.json({ message: `Berhasil menghapus ${type.toUpperCase()} ID ${vmid}` });
    } catch (err) {
        const errMsg = formatProxmoxError(err);
        addLog('Admin', 'DELETE', `${type.toUpperCase()} ID ${vmid}`, 'FAILED', errMsg);
        res.status(500).json({ error: errMsg });
    }
});

// ==========================================
// 6. SNAPSHOT MANAGER
// ==========================================
// Get Snapshots
app.get('/api/vm/:node/:type/:vmid/snapshots', async(req, res) => {
    const { node, type, vmid } = req.params;
    try {
        const response = await proxmoxApi.get(`/nodes/${node}/${type}/${vmid}/snapshot`);
        res.json({ snapshots: response.data ?.data || [] });
    } catch (err) {
        res.status(500).json({ error: formatProxmoxError(err) });
    }
});

// Create Snapshot
app.post('/api/vm/:node/:type/:vmid/snapshot', async(req, res) => {
    const { node, type, vmid } = req.params;
    const { snapname, description } = req.body;
    try {
        await proxmoxApi.post(`/nodes/${node}/${type}/${vmid}/snapshot`, {
            snapname,
            description
        });
        addLog('Admin', 'SNAPSHOT_CREATE', `${snapname} on ID ${vmid}`, 'SUCCESS');
        res.json({ message: "Snapshot berhasil dibuat" });
    } catch (err) {
        const errMsg = formatProxmoxError(err);
        addLog('Admin', 'SNAPSHOT_CREATE', `${snapname} on ID ${vmid}`, 'FAILED', errMsg);
        res.status(500).json({ error: errMsg });
    }
});

// Rollback Snapshot
app.post('/api/vm/:node/:type/:vmid/snapshot/:snapname/rollback', async(req, res) => {
    const { node, type, vmid, snapname } = req.params;
    try {
        await proxmoxApi.post(`/nodes/${node}/${type}/${vmid}/snapshot/${snapname}/rollback`);
        addLog('Admin', 'SNAPSHOT_ROLLBACK', `Rollback to ${snapname} on ID ${vmid}`, 'SUCCESS');
        res.json({ message: "Rollback snapshot berhasil diproses" });
    } catch (err) {
        const errMsg = formatProxmoxError(err);
        addLog('Admin', 'SNAPSHOT_ROLLBACK', `Rollback to ${snapname} on ID ${vmid}`, 'FAILED', errMsg);
        res.status(500).json({ error: errMsg });
    }
});

// ==========================================
// 7. VNC CONSOLE (VM/LXC & PVE NODE SHELL)
// ==========================================

// Endpoint: tiket vncproxy untuk VM/LXC
app.get('/api/vm/:node/:type/:vmid/console', async(req, res) => {
    const { node, type, vmid } = req.params;
    try {
        const response = await proxmoxApi.post(
            `/nodes/${node}/${type}/${vmid}/vncproxy`,
            new URLSearchParams({ websocket: 1 }).toString(),
            {
                headers: {
                    ...headers,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const { ticket, port } = response.data.data;
        res.json({ ticket, port });
    } catch (err) {
        console.error('Console/vncproxy error:', err.response?.status, err.response?.data || err.message);
        res.status(err.response?.status || 500).json({ error: formatProxmoxError(err) });
    }
});

// Endpoint: tiket vncproxy / termproxy untuk PVE Host Node Shell
app.get('/api/node/:node/console', async(req, res) => {
    const { node } = req.params;
    try {
        const response = await proxmoxApi.post(
            `/nodes/${node}/termproxy`,
            new URLSearchParams({ cmd: 'login' }).toString(),
            {
                headers: {
                    ...headers,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const { ticket, port, user } = response.data.data;
        res.json({ ticket, port, user });
    } catch (err) {
        console.error('Node Shell termproxy error:', err.response?.status, err.response?.data || err.message);
        res.status(err.response?.status || 500).json({ error: formatProxmoxError(err) });
    }
});

// WebSocket Proxy: relay browser WS <-> Proxmox vncwebsocket
// Mendukung:
// 1. VM/LXC: /api/vncproxy/:node/:type/:vmid?port=X&vncticket=Y
// 2. Node Shell: /api/vncproxy/node/:node?port=X&vncticket=Y
const vncWss = new WebSocket.Server({ noServer: true });

vncWss.on('connection', (clientWs, req) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const vmMatch = pathname.match(/^\/api\/vncproxy\/([^\/]+)\/([^\/]+)\/([^\/]+)$/);
    const nodeMatch = pathname.match(/^\/api\/vncproxy\/node\/([^\/]+)$/);
    
    const { port: vncPort, vncticket } = parsed.query;

    if (!vncPort || !vncticket) {
        clientWs.close(1008, 'Missing port or vncticket');
        return;
    }

    let proxmoxWsUrl = '';
    if (vmMatch) {
        const [, node, type, vmid] = vmMatch;
        proxmoxWsUrl = `wss://${PROXMOX_HOST.replace(/^https?:\/\//, '')}/api2/json/nodes/${node}/${type}/${vmid}/vncwebsocket?port=${vncPort}&vncticket=${encodeURIComponent(vncticket)}`;
        console.log(`[VNC Proxy] Connecting to VM/LXC: ${node}/${type}/${vmid} port=${vncPort}`);
    } else if (nodeMatch) {
        const [, node] = nodeMatch;
        proxmoxWsUrl = `wss://${PROXMOX_HOST.replace(/^https?:\/\//, '')}/api2/json/nodes/${node}/vncwebsocket?port=${vncPort}&vncticket=${encodeURIComponent(vncticket)}`;
        console.log(`[VNC Proxy] Connecting to PVE Node Shell: ${node} port=${vncPort}`);
    } else {
        clientWs.close(1008, 'Invalid path');
        return;
    }

    // Buffer jika pesan tiba sebelum koneksi siap
    const pendingToProxmox = [];
    const pendingToClient = [];

    // Buat koneksi WebSocket ke Proxmox
    const proxmoxWs = new WebSocket(proxmoxWsUrl, ['binary'], {
        rejectUnauthorized: false,
        headers: {
            ...headers
        }
    });

    proxmoxWs.on('open', () => {
        console.log(`[VNC Proxy] Connected to Proxmox vncwebsocket`);
        
        if (nodeMatch) {
            const authUser = parsed.query.user || TOKEN_ID;
            console.log(`[VNC Proxy] Sending auth ticket for ${authUser} to Proxmox termproxy`);
            proxmoxWs.send(`${authUser}:${vncticket}\n`);
        }

        // Flush buffer ke Proxmox
        while (pendingToProxmox.length > 0) {
            const item = pendingToProxmox.shift();
            try {
                proxmoxWs.send(item.data, { binary: item.isBinary });
            } catch (err) {
                console.error('[VNC Proxy] Error flushing to Proxmox:', err.message);
            }
        }
    });

    let nodePingInterval = null;
    if (nodeMatch) {
        nodePingInterval = setInterval(() => {
            if (proxmoxWs.readyState === WebSocket.OPEN) {
                try { proxmoxWs.send('2'); } catch(e) {}
            }
        }, 25000);
    }

    // Relay: Browser -> Proxmox
    clientWs.on('message', (data, isBinary) => {
        let payload = data;
        // Jika Node Shell, pastikan payload ter-frame sesuai protokol termproxy
        if (nodeMatch && !isBinary) {
            const str = data.toString();
            // Jika belum di-frame dengan 0:, 1:, atau 2
            if (!/^[012]:/.test(str) && str !== '2') {
                const len = Buffer.byteLength(str, 'utf8');
                payload = `0:${len}:${str}`;
            }
        }

        if (proxmoxWs.readyState === WebSocket.OPEN) {
            proxmoxWs.send(payload, { binary: isBinary });
        } else if (proxmoxWs.readyState === WebSocket.CONNECTING) {
            pendingToProxmox.push({ data: payload, isBinary });
        }
    });

    // Relay: Proxmox -> Browser
    proxmoxWs.on('message', (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data, { binary: isBinary });
        } else if (clientWs.readyState === WebSocket.CONNECTING) {
            pendingToClient.push({ data, isBinary });
        }
    });

    // Cleanup saat browser disconnect
    clientWs.on('close', () => {
        if (nodePingInterval) clearInterval(nodePingInterval);
        console.log(`[VNC Proxy] Browser disconnected`);
        if (proxmoxWs.readyState === WebSocket.OPEN || proxmoxWs.readyState === WebSocket.CONNECTING) {
            try { proxmoxWs.close(); } catch(e) {}
        }
    });

    clientWs.on('error', (err) => {
        if (nodePingInterval) clearInterval(nodePingInterval);
        console.error('[VNC Proxy] Browser WS error:', err.message);
        try { proxmoxWs.close(); } catch(e) {}
    });

    // Cleanup saat Proxmox disconnect
    proxmoxWs.on('close', (code, reason) => {
        if (nodePingInterval) clearInterval(nodePingInterval);
        console.log(`[VNC Proxy] Proxmox disconnected (code: ${code})`);
        if (clientWs.readyState === WebSocket.OPEN) {
            try { clientWs.close(); } catch(e) {}
        }
    });

    proxmoxWs.on('error', (err) => {
        if (nodePingInterval) clearInterval(nodePingInterval);
        console.error('[VNC Proxy] Proxmox WS error:', err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
            try { clientWs.close(1011, 'Proxmox connection failed'); } catch(e) {}
        }
    });
});

// Intercept HTTP upgrade: route ke VNC proxy atau Socket.IO
server.on('upgrade', (req, socket, head) => {
    const pathname = url.parse(req.url).pathname;
    
    if (pathname.startsWith('/api/vncproxy/')) {
        // Route ke VNC WebSocket proxy
        vncWss.handleUpgrade(req, socket, head, (ws) => {
            vncWss.emit('connection', ws, req);
        });
    }
    // Socket.IO handles semua upgrade lainnya secara otomatis
});

const PORT = 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend Real-Time WebSocket Server running on http://0.0.0.0:${PORT}`);
});