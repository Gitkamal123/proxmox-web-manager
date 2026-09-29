# Proxmox Web Manager

Aplikasi web modern, responsif, dan ringan untuk memonitor serta mengelola infrastruktur server Proxmox VE (Virtual Environment). Dilengkapi dengan telemetri cluster real-time, manajemen siklus daya VM/LXC, serta konsol interaktif berbasis web (xterm.js dan noVNC).

---

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Teknologi yang Digunakan](#teknologi-yang-digunakan)
- [Struktur Direktori](#struktur-direktori)
- [Prasyarat Sistem](#prasyarat-sistem)
- [Persiapan API Token Proxmox VE](#persiapan-api-token-proxmox-ve)
- [Panduan Instalasi Lengkap](#panduan-instalasi-lengkap)
  - [1. Clone Repository](#1-clone-repository)
  - [2. Setup dan Jalankan Backend](#2-setup-dan-jalankan-backend)
  - [3. Setup dan Jalankan Frontend](#3-setup-dan-jalankan-frontend)
- [Panduan Penggunaan](#panduan-penggunaan)
- [Deployment Produksi (Opsional)](#deployment-produksi-opsional)
- [Troubleshooting & Solusi](#troubleshooting--solusi)
- [Keamanan](#keamanan)
- [Lisensi](#lisensi)

---

## Fitur Utama

- **Cluster & Node Telemetry:** Monitoring penggunaan CPU, RAM, disk, load average, dan status node secara real-time.
- **Manajemen VM & Container (LXC):** Kontrol siklus daya (Start, Shutdown, Stop, Reboot) untuk Virtual Machine (QEMU) dan Container (LXC).
- **Multi-Window Remote Console:**
  - **noVNC Console:** Akses display desktop grafis VM langsung dari browser tanpa instalasi software tambahan.
  - **xterm.js Terminal:** Shell terminal berbasis web yang cepat dan responsif untuk container/node.
  - **Window Workspace:** Tampilan jendela konsol floating yang dapat dipindahkan, diubah ukurannya (resizable), dan diminimalkan.
- **Konfigurasi Host Dinamis:** Pemilihan dan penyimpanan alamat host backend langsung dari antarmuka web.
- **Tampilan Gelap Modern:** Antarmuka responsif bernuansa dark mode yang nyaman untuk penggunaan jangka panjang.

---

## Teknologi yang Digunakan

- **Frontend:**
  - React 19
  - Vite
  - Tailwind CSS
  - Lucide React (Ikon)
  - Recharts (Visualisasi grafik metrik)
  - @novnc/novnc (Display remote desktop)
  - @xterm/xterm (Terminal interaktif)
- **Backend:**
  - Node.js & Express
  - Socket.IO & WebSocket (`ws`) untuk bridge noVNC/xterm
  - Axios (Komunikasi ke REST API Proxmox VE)

---

## Struktur Direktori

```text
proxmox-web-manager/
├── backend/
│   ├── .env.example       # Template konfigurasi environment backend
│   ├── package.json       # Daftar dependensi backend
│   └── server.js          # API gateway & WebSocket proxy (noVNC & xterm)
├── frontend/
│   ├── package.json       # Daftar dependensi frontend
│   ├── public/            # File aset statis
│   ├── src/               # Kode sumber aplikasi React
│   │   ├── App.jsx        # Komponen utama & dashboard
│   │   ├── ConsoleWindow.jsx   # Komponen konsol xterm & noVNC
│   │   ├── ConsoleWorkspace.jsx# Workspace multi-window
│   │   ├── LoginPage.jsx  # Halaman login & pemilihan host
│   │   └── config.js      # Konfigurasi koneksi & storage
│   ├── index.html         # Template HTML utama
│   └── vite.config.js     # Konfigurasi bundler Vite
├── .gitignore             # Pengabaian file sensitif (env, node_modules, dll.)
└── README.md              # Dokumentasi proyek
```

---

## Prasyarat Sistem

Pastikan perangkat Anda telah memenuhi kebutuhan berikut:
1. **Node.js** versi 18.x atau yang lebih baru (disarankan versi LTS).
2. **npm** (biasanya terpasang otomatis bersama Node.js).
3. **Git** terinstal di perangkat lokal.
4. Server **Proxmox VE** (versi 7.x / 8.x) yang dapat dijangkau melalui jaringan (IP lokal, VPN, atau Tailscale).

---

## Persiapan API Token Proxmox VE

Aplikasi ini menggunakan Proxmox API Token untuk otentikasi aman tanpa perlu mengekspos kata sandi akun root:

1. Buka dashboard web Proxmox VE Anda (`https://<IP_PROXMOX>:8006`).
2. Masuk ke menu **Datacenter** > **Permissions** > **API Tokens**.
3. Klik tombol **Add**:
   - **User:** Pilih user (contoh: `root@pam` atau user khusus yang Anda buat).
   - **Token ID:** Masukkan nama token (contoh: `web-mgmt-srv`).
   - **Privilege Separation:** Hapus centang (uncheck) jika ingin token mewarisi hak akses penuh dari user yang dipilih.
4. Klik **Add**, lalu simpan **Token ID** dan **Secret** yang muncul (Secret hanya ditampilkan satu kali).

---

## Panduan Instalasi Lengkap

### 1. Clone Repository

Buka terminal/PowerShell di komputer Anda, lalu jalankan perintah berikut:

```bash
git clone https://github.com/Gitkamal123/proxmox-web-manager.git
cd proxmox-web-manager
```
---

### 2. Setup dan Jalankan Backend

1. Masuk ke direktori `backend`:
   ```bash
   cd backend
   ```

2. Instal seluruh dependensi:
   ```bash
   npm install
   ```

3. Buat file `.env` dari template yang tersedia:
   - **Di Linux / macOS:**
     ```bash
     cp .env.example .env
     ```
   - **Di Windows (PowerShell / CMD):**
     ```powershell
     copy .env.example .env
     ```

4. Buka file `.env` menggunakan text editor pilihan Anda (VS Code, Notepad, atau nano), lalu sesuaikan nilainya:
   ```env
   PORT=5000
   PVE_URL=https://192.168.1.100:8006
   PVE_TOKEN=PVEAPIToken=root@pam!web-mgmt-srv=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```
   - Ganti `192.168.1.100:8006` dengan alamat IP dan port Proxmox VE Anda.
   - Ganti `PVE_TOKEN` dengan format token lengkap yang Anda dapatkan pada langkah persiapan.

5. Jalankan server backend:
   ```bash
   # Mode pengembangan (dengan auto-restart jika ada perubahan file)
   npm run dev

   # Atau mode standar
   npm start
   ```
   Jika berhasil, terminal akan menampilkan log bahwa server berjalan di `http://localhost:5000`.

---

### 3. Setup dan Jalankan Frontend

1. Buka **jendela terminal / tab baru**, lalu masuk ke direktori `frontend`:
   ```bash
   cd proxmox-web-manager/frontend
   ```

2. Instal dependensi frontend:
   ```bash
   npm install
   ```

3. Jalankan server development Vite:
   ```bash
   npm run dev
   ```

4. Terminal akan menampilkan tautan lokal aplikasi (biasanya `http://localhost:5173`). Buka URL tersebut di browser.

---

## Panduan Penggunaan

1. **Halaman Login & Koneksi:**
   - Masukkan alamat host backend pada kolom server (misalnya `localhost:5000` atau IP lokal perangkat backend seperti `192.168.1.50:5000`).
   - Masukkan kredensial Anda untuk masuk ke dashboard.
2. **Dashboard Resource:**
   - Melihat ringkasan resource cluster: CPU Usage, RAM Usage, Storage Pool, dan status node.
3. **Manajemen Virtual Machine & Container:**
   - Klik pada VM atau LXC untuk melihat detail spesifikasi.
   - Gunakan tombol kontrol daya: **Start**, **Shutdown**, **Stop**, atau **Reboot**.
4. **Membuka Remote Konsol:**
   - Klik tombol **Console (noVNC)** untuk membuka tampilan desktop virtual mesin.
   - Klik tombol **Terminal (xterm)** untuk membuka sesi shell berbasis teks.
   - Anda dapat membuka beberapa konsol sekaligus dalam workspace floating window.

---

## Deployment Produksi (Opsional)

Jika ingin menjalankan aplikasi secara permanen pada server atau mini PC:

### 1. Build Frontend
Kompilasi kode frontend menjadi file statis:
```bash
cd frontend
npm run build
```
File hasil build akan berada di direktori `frontend/dist`. Anda dapat menyajikannya menggunakan Nginx, Caddy, atau web server statis lainnya.

### 2. Jalankan Backend dengan Process Manager (PM2)
Agar backend tetap berjalan di latar belakang dan otomatis menyala saat sistem reboot:
```bash
# Instal PM2 secara global
npm install -g pm2

# Masuk ke folder backend dan jalankan proses
cd backend
pm2 start server.js --name "proxmox-backend"

# Simpan daftar proses agar otomatis start saat booting
pm2 save
pm2 startup
```

---

## Troubleshooting & Solusi

1. **Konsol noVNC atau Terminal xterm Tidak Terhubung:**
   - Pastikan port `5000` tidak diblokir oleh firewall lokal perangkat backend.
   - Pastikan backend dapat mengakses port `8006` Proxmox tanpa terhalang firewall jaringan.
2. **Error `SELF_SIGNED_CERT_IN_CHAIN` / Masalah Sertifikat SSL:**
   - Backend telah dikonfigurasi untuk mengabaikan verifikasi SSL self-signed bawaan Proxmox secara default. Pastikan URL menggunakan protokol `https://`.
3. **Error 401 Unauthorized atau 403 Forbidden dari API Proxmox:**
   - Periksa kembali format `PVE_TOKEN` pada file `.env`. Format wajib: `PVEAPIToken=USER@REALM!TOKENID=UUID`.
   - Pastikan API Token di Proxmox memiliki hak akses yang cukup pada path `/` (contoh: Role `Administrator` atau `PVEVMAdmin`).
4. **Port Backend Sudah Digunakan (`EADDRINUSE: 5000`):**
   - Ubah nilai `PORT` di file `backend/.env` (misalnya menjadi `PORT=5001`), lalu sesuaikan alamat server pada halaman login frontend.

---

## Lisensi

Proyek ini dirilis di bawah lisensi [MIT](LICENSE).
 
