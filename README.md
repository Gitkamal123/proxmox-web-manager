# Proxmox Web Management

Aplikasi web modern dan ringan untuk memonitor dan mengelola server Proxmox VE (Virtual Environment). Dilengkapi dengan visualisasi statistik real-time, manajemen VM/LXC, serta dukungan konsol interaktif (xterm.js & noVNC).

---

## Fitur Utama

- **Cluster & Node Telemetry:** Monitoring penggunaan CPU, RAM, disk, load average, dan status node secara real-time.
- **Manajemen VM & Container (LXC):** Kontrol siklus daya (Start, Shutdown, Stop, Reboot) untuk Virtual Machine (QEMU) dan Container (LXC).
- **Multi-Window Remote Console:**
  - **noVNC Console:** Tampilan desktop grafis langsung dari browser.
  - **xterm.js Terminal:** Akses shell terminal berbasis web yang cepat dan responsif.
  - **Window Workspace:** Dukungan floating window yang dapat dipindah, diatur ukurannya, dan diminimalkan.
- **Antarmuka Modern:** Tampilan gelap (dark mode) responsif berbasis Tailwind CSS.
- **Konfigurasi Host Dinamis:** Dukungan pemilihan dan penyimpanan host backend langsung dari antarmuka login.

---

## Struktur Proyek

```text
proxmox-web-management/
├── backend/
│   ├── .env.example       # Template konfigurasi environment backend
│   ├── package.json       # Dependensi backend (Express, Socket.IO, ws)
│   └── server.js          # API proxy, WebSocket bridge (noVNC & xterm)
├── frontend/
│   ├── package.json       # Dependensi frontend (React, Vite, Tailwind CSS)
│   ├── src/               # Kode sumber antarmuka React
│   └── vite.config.js     # Konfigurasi Vite bundler
└── README.md
```

---

## Prasyarat

Sebelum menjalankan aplikasi, pastikan Anda telah menginstal:
- **Node.js** (versi 18 ke atas disarankan)
- **npm** atau package manager sejenis
- Akses ke server **Proxmox VE** dengan API Token yang valid

---

## Panduan Instalasi & Menjalankan

### 1. Konfigurasi Backend

Masuk ke folder `backend`:
```bash
cd backend
npm install
```

Salin template file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```

Buka file `.env` dan sesuaikan dengan konfigurasi Proxmox Anda:
```env
PORT=5000
PVE_URL=https://<IP_PROXMOX>:8006
PVE_TOKEN=PVEAPIToken=root@pam!<TOKEN_ID>=<TOKEN_SECRET>
```

Jalankan backend server:
```bash
# Mode development (auto-reload)
npm run dev

# Atau mode produksi
npm start
```
Backend akan berjalan di port `5000` (atau port sesuai konfigurasi file `.env`).

---

### 2. Konfigurasi Frontend

Buka terminal baru dan masuk ke folder `frontend`:
```bash
cd frontend
npm install
```

Jalankan server development:
```bash
npm run dev
```

Buka browser dan akses URL lokal yang tampil di terminal (biasanya `http://localhost:5173`).

---

## Build untuk Produksi

Untuk mengompilasi frontend menjadi file statis siap deploy:

```bash
cd frontend
npm run build
```

Hasil build akan tersimpan di dalam folder `frontend/dist`.

---

## Keamanan

- Jangan pernah mengunggah file `.env` atau kredensial token Proxmox ke repository publik.
- File `.gitignore` pada proyek ini telah dikonfigurasi untuk mencegah file kredensial dan folder `node_modules` ikut ter-commit.
- Sangat disarankan untuk membatasi hak akses Proxmox API Token hanya pada resource yang dibutuhkan (Role: `PVEVMAdmin`, `PVESysAdmin`, atau role kustom dengan hak minimal).

---

## Lisensi

Proyek ini dibuat untuk keperluan internal dan manajemen infrastruktur mandiri. Silakan gunakan dan sesuaikan sesuai kebutuhan.
"# proxmox-web-manager" 
