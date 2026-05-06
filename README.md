# Aquantum — Sistem PDAM Prepaid

Repositori ini berisi **backend API** dan **firmware ESP32** untuk sistem PDAM Prepaid **Aquantum**.

| Komponen | Teknologi | Peran |
|----------|-----------|-------|
| `aquantum-backend` | Node.js + Express | REST API, manajemen saldo & token |
| `aquantum-esp32` | Arduino / ESP32 | Baca flow sensor, kontrol valve, kirim data |
| `aquacontrol` | Next.js | Dashboard admin |
| `aquallet` | Next.js | Aplikasi pelanggan |

---

## Daftar Isi

- [Langkah Cepat Menjalankan Sistem](#langkah-cepat-menjalankan-sistem)
- [Aquantum Backend](#aquantum-backend)
  - [Persyaratan](#persyaratan)
  - [Instalasi](#instalasi)
  - [Konfigurasi](#konfigurasi)
  - [Menjalankan Server](#menjalankan-server)
  - [Konversi Saldo](#konversi-saldo)
  - [Sistem Token](#sistem-token)
  - [Data Pelanggan](#data-pelanggan)
  - [Dokumentasi API](#dokumentasi-api)
  - [Contoh Request & Response](#contoh-request--response)
- [Aquantum ESP32 — Firmware](#aquantum-esp32--firmware)
  - [Gambaran Umum ESP32](#gambaran-umum-esp32)
  - [Komponen Hardware](#komponen-hardware)
  - [Wiring / Skema Koneksi](#wiring--skema-koneksi)
  - [Instalasi Library Arduino](#instalasi-library-arduino)
  - [Konfigurasi Firmware](#konfigurasi-firmware)
  - [Cara Upload ke ESP32](#cara-upload-ke-esp32)
  - [Cara Kerja Firmware](#cara-kerja-firmware)
  - [Token & Saldo di Firmware](#token--saldo-di-firmware)
  - [Mode Offline](#mode-offline)
  - [Troubleshooting ESP32](#troubleshooting-esp32)

---

## Langkah Cepat Menjalankan Sistem

Ikuti urutan ini setiap kali ingin menjalankan seluruh sistem dari awal.

**1. Pastikan semua perangkat terhubung ke WiFi yang sama**

Laptop dan ESP32 harus berada di jaringan WiFi yang sama. Contoh: hotspot HP `OPPO A78`.

**2. Cari tahu IP laptop saat ini**

```bash
# Mac / Linux
ipconfig getifaddr en0

# Windows (Command Prompt)
ipconfig
# Lihat "IPv4 Address" di bagian adapter WiFi
```

Contoh hasil: `10.201.138.14`

**3. Isi konfigurasi di `aquantum-esp32.ino` lalu upload**

Edit 4 baris berikut di bagian atas file `.ino`:

```cpp
const char*   WIFI_SSID    = "OPPO A78";
const char*   WIFI_PASS    = "passwordwifi";
const char*   SERVER_URL   = "http://10.201.138.14:3000"; // IP laptop dari langkah 2
const String  PELANGGAN_ID = "P001";
```

Upload ke ESP32 via Arduino IDE (lihat [Cara Upload ke ESP32](#cara-upload-ke-esp32)).

> **IP laptop bisa berubah** setiap ganti jaringan WiFi. Ulangi langkah 2–3 setiap kali ganti hotspot.

**4. Jalankan backend dan aplikasi web**

Buka tiga terminal terpisah:

```bash
# Terminal 1 — Backend (wajib jalan duluan)
cd aquantum-backend && npm run dev

# Terminal 2 — Dashboard Admin
cd aquacontrol && npm run dev

# Terminal 3 — Aplikasi Pelanggan
cd aquallet && npm run dev
```

**5. Buka di browser**

| Aplikasi | URL | Login |
|----------|-----|-------|
| AquaControl (admin) | `http://localhost:3001` | `admin` / `pdam2024` |
| Aquallet (pelanggan) | `http://localhost:3002` | ID: `P001` atau `P002` |

**6. Verifikasi koneksi ESP32**

Buka AquaControl. Kolom **Last Update** pada tabel pelanggan akan berubah setiap ~1 detik, menandakan ESP32 sudah terhubung dan mengirim data.

---

# Aquantum Backend

REST API untuk sistem PDAM Prepaid **Aquantum** berbasis Node.js + Express.  
Data disimpan sepenuhnya di memory — tidak memerlukan database.

---

---

## Persyaratan

- [Node.js](https://nodejs.org/) v16 atau lebih baru
- npm (sudah termasuk bersama Node.js)

---

## Instalasi

```bash
cd aquantum-backend
npm install
```

---

## Konfigurasi

Buat file `.env` di root project (opsional):

```env
PORT=3000
NODE_ENV=development
```

| Variabel   | Default       | Keterangan                  |
|------------|---------------|-----------------------------|
| `PORT`     | `3000`        | Port yang digunakan server  |
| `NODE_ENV` | `development` | Environment aplikasi        |

---

## Menjalankan Server

```bash
# Mode development (auto-reload saat file berubah)
npm run dev

# Mode production
npm start
```

Output saat server berhasil berjalan:

```
============================================
  Aquantum Backend  |  port 3000
============================================
  Pelanggan terdaftar : 2
  Preset token        : 1111, 4444

  Endpoint tersedia:
  [ESP32]    POST /api/esp32/data
  [ESP32]    POST /api/esp32/token
  [Customer] GET  /api/customer/:id
  [Customer] POST /api/customer/topup
  [Admin]    GET  /api/admin/dashboard
  [Admin]    GET  /api/admin/usage-chart
  [Admin]    POST /api/admin/generate-token
  [Admin]    POST /api/admin/valve
  [Admin]    POST /api/admin/reset-saldo
  [Admin]    POST /api/admin/set-saldo
  [Admin]    POST /api/admin/reset-volume-hari-ini
  [Admin]    POST /api/admin/reset-saldo-semua
============================================
```

---

## Konversi Saldo

| Saldo | Air       |
|-------|-----------|
| 1     | 10 liter  |
| 10    | 100 liter |
| 20    | 200 liter |

> **Aturan valve:** Katup air otomatis **terbuka** jika `saldo > 0` dan **tertutup** jika `saldo ≤ 0`.
>
> **Aturan low balance:** Field `low_balance: true` dikirim ke ESP32 saat `saldo < 5`, dan ke aplikasi pelanggan saat `saldo <= 5`.

---

## Sistem Token

Token adalah kode 4 digit numerik yang digunakan pelanggan untuk mengisi saldo.

### Token Preset (bawaan hardware)

| Token  | Nilai Saldo | Setara Air  |
|--------|-------------|-------------|
| `1111` | +10 saldo   | +100 liter  |
| `4444` | +20 saldo   | +200 liter  |

### Aturan Token

- Setiap token **hanya bisa digunakan satu kali** (one-time use).
- Token yang sudah terpakai akan ditolak dengan pesan `"Token sudah pernah digunakan"`.
- Admin dapat membuat token baru via endpoint `POST /api/admin/generate-token`.
- Token yang di-generate admin dijamin **unik** — tidak akan bentrok dengan token lain.

---

## Data Pelanggan

Data pelanggan yang tersedia saat server pertama kali dijalankan:

| ID   | Nama         | Alamat             | Saldo Awal | Valve |
|------|--------------|--------------------|------------|-------|
| P001 | Budi Santoso | Jl. Merdeka No.12  | 45.5       | Buka  |
| P002 | Siti Rahayu  | Jl. Sudirman No.5  | 12.0       | Buka  |

> Data pemakaian harian 7 hari ke belakang di-inisialisasi otomatis saat server start.  
> Semua data tersimpan **di memory** — akan reset ke nilai awal saat server restart.

---

## Dokumentasi API

Base URL: `http://localhost:3000`

---

### ESP32 Endpoints

#### `POST /api/esp32/data`

Menerima data sensor dari perangkat ESP32 dan mengembalikan status valve yang harus diterapkan.

**Request Body**

```json
{
  "pelanggan_id": "P001",
  "volume": 121.3,
  "flowRate": 1.5
}
```

| Field          | Tipe   | Wajib | Keterangan                          |
|----------------|--------|-------|-------------------------------------|
| `pelanggan_id` | string | Ya    | ID pelanggan                        |
| `volume`       | number | Tidak | Total volume air mengalir (liter)   |
| `flowRate`     | number | Tidak | Debit aliran saat ini (liter/menit) |

**Response `200 OK`**

```json
{
  "valve": true,
  "status": "ok",
  "saldo": 44.5
}
```

Jika saldo turun ke bawah `5`, backend juga mengirim:

```json
{
  "valve": true,
  "status": "ok",
  "saldo": 4.2,
  "low_balance": true
}
```

---

#### `POST /api/esp32/token`

Memvalidasi token yang dimasukkan pelanggan lewat keypad pada perangkat ESP32.

**Request Body**

```json
{
  "pelanggan_id": "P001",
  "token": "1111"
}
```

**Response — Token Valid `200 OK`**

```json
{
  "valid": true,
  "nilai": 10,
  "saldo_baru": 54.5,
  "message": "Topup berhasil! +10 saldo (+100 liter)"
}
```

**Response — Token Tidak Valid `400`**

```json
{
  "valid": false,
  "message": "Token sudah pernah digunakan"
}
```

---

### Customer Endpoints

#### `GET /api/customer/:id`

Mengambil data lengkap satu pelanggan beserta riwayat topup.

**Response `200 OK`**

```json
{
  "id": "P001",
  "nama": "Budi Santoso",
  "alamat": "Jl. Merdeka No.12",
  "saldo": 45.5,
  "low_balance": false,
  "volume": 120.3,
  "flowRate": 0,
  "valve": true,
  "lastUpdate": "2026-05-06T08:37:53.766Z",
  "history": []
}
```

| Field         | Keterangan                                          |
|---------------|-----------------------------------------------------|
| `low_balance` | `true` jika `saldo <= 5`, `false` jika `saldo > 5` |

---

#### `POST /api/customer/topup`

Melakukan topup saldo pelanggan menggunakan kode token (via aplikasi atau web).

**Request Body**

```json
{
  "pelanggan_id": "P001",
  "token": "4444"
}
```

**Response — Berhasil `200 OK`**

```json
{
  "success": true,
  "valid": true,
  "nilai": 20,
  "saldo_baru": 20,
  "message": "Topup berhasil! +20 saldo (+200 liter)"
}
```

---

### Admin Endpoints

#### `GET /api/admin/dashboard`

Mengembalikan daftar semua pelanggan beserta ringkasan statistik global.

**Response `200 OK`**

```json
{
  "pelanggan": [
    {
      "id": "P001",
      "nama": "Budi Santoso",
      "alamat": "Jl. Merdeka No.12",
      "saldo": 45.5,
      "volume": 120.3,
      "flowRate": 1.5,
      "valve": true,
      "lastUpdate": "2026-05-06T08:37:53.766Z"
    }
  ],
  "summary": {
    "total_aktif": 1,
    "total_nonaktif": 1,
    "total_volume_hari_ini": 72.7,
    "total_saldo_beredar": 57.5
  }
}
```

| Field `summary`           | Keterangan                                           |
|---------------------------|------------------------------------------------------|
| `total_aktif`             | Jumlah pelanggan dengan valve terbuka                |
| `total_nonaktif`          | Jumlah pelanggan dengan valve tertutup               |
| `total_volume_hari_ini`   | Total liter yang mengalir hari ini (semua pelanggan) |
| `total_saldo_beredar`     | Jumlah saldo seluruh pelanggan saat ini              |

---

#### `GET /api/admin/usage-chart`

Mengembalikan data pemakaian air 7 hari terakhir per pelanggan dan agregat.

**Response `200 OK`**

```json
{
  "per_pelanggan": [
    {
      "pelanggan_id": "P001",
      "nama": "Budi Santoso",
      "data": [
        { "tanggal": "2026-04-30", "volume": 6.3, "saldo_terpakai": 0.63 },
        { "tanggal": "2026-05-06", "volume": 14.2, "saldo_terpakai": 1.42 }
      ]
    }
  ],
  "aggregate": [
    { "tanggal": "2026-04-30", "total_volume": 72.8 },
    { "tanggal": "2026-05-06", "total_volume": 95.1 }
  ]
}
```

---

#### `POST /api/admin/valve`

Override buka/tutup katup air pelanggan tertentu secara paksa.

**Request Body**

```json
{
  "pelanggan_id": "P001",
  "valve": true
}
```

**Response `200 OK`**

```json
{
  "pelanggan_id": "P001",
  "valve": true,
  "message": "Valve pelanggan P001 berhasil dibuka oleh admin"
}
```

> **Catatan:** Override ini akan ditimpa saat ESP32 mengirim data berikutnya via `POST /api/esp32/data`, karena backend menghitung ulang valve dari saldo.

---

#### `POST /api/admin/generate-token`

Membuat token topup baru dengan nilai saldo yang ditentukan.

**Request Body**

```json
{
  "nilai": 10
}
```

| Field   | Nilai yang Diterima |
|---------|---------------------|
| `nilai` | `10` atau `20`      |

**Response `200 OK`**

```json
{
  "token": "7064",
  "nilai": 10,
  "message": "Token 7064 berhasil dibuat — nilai: 10 saldo (100 liter)"
}
```

---

#### `POST /api/admin/reset-saldo`

Reset saldo satu pelanggan ke `0` dan tutup valve-nya.

**Request Body**

```json
{
  "pelanggan_id": "P001"
}
```

**Response `200 OK`**

```json
{
  "pelanggan_id": "P001",
  "saldo": 0,
  "valve": false,
  "message": "Saldo pelanggan P001 berhasil direset ke 0"
}
```

---

#### `POST /api/admin/set-saldo`

Set saldo pelanggan ke nilai tertentu (tidak harus 0).

**Request Body**

```json
{
  "pelanggan_id": "P001",
  "saldo": 6
}
```

**Response `200 OK`**

```json
{
  "pelanggan_id": "P001",
  "saldo": 6,
  "valve": true,
  "message": "Saldo pelanggan P001 berhasil diset ke 6"
}
```

> Valve otomatis terbuka jika saldo yang di-set `> 0`, dan tertutup jika `= 0`.

---

#### `POST /api/admin/reset-volume-hari-ini`

Reset volume pemakaian hari ini ke `0` untuk semua pelanggan. Berguna untuk demo atau pengujian ulang.

**Response `200 OK`**

```json
{
  "message": "Volume hari ini berhasil direset ke 0",
  "tanggal": "2026-05-06"
}
```

---

#### `POST /api/admin/reset-saldo-semua`

Reset saldo semua pelanggan ke `0` dan tutup semua valve. Berguna untuk simulasi ulang dari kondisi awal.

**Response `200 OK`**

```json
{
  "message": "Saldo semua pelanggan berhasil direset ke 0",
  "total_saldo_beredar": 0
}
```

---

## Contoh Request & Response

```bash
# Kirim data sensor dari ESP32
curl -X POST http://localhost:3000/api/esp32/data \
  -H "Content-Type: application/json" \
  -d '{"pelanggan_id":"P001","volume":121.3,"flowRate":1.5}'

# Topup via keypad ESP32
curl -X POST http://localhost:3000/api/esp32/token \
  -H "Content-Type: application/json" \
  -d '{"pelanggan_id":"P001","token":"1111"}'

# Cek data pelanggan
curl http://localhost:3000/api/customer/P001

# Topup via aplikasi
curl -X POST http://localhost:3000/api/customer/topup \
  -H "Content-Type: application/json" \
  -d '{"pelanggan_id":"P001","token":"4444"}'

# Dashboard admin
curl http://localhost:3000/api/admin/dashboard

# Chart pemakaian 7 hari
curl http://localhost:3000/api/admin/usage-chart

# Generate token baru
curl -X POST http://localhost:3000/api/admin/generate-token \
  -H "Content-Type: application/json" \
  -d '{"nilai":10}'

# Override valve (buka)
curl -X POST http://localhost:3000/api/admin/valve \
  -H "Content-Type: application/json" \
  -d '{"pelanggan_id":"P001","valve":true}'

# Reset saldo P001 ke 0
curl -X POST http://localhost:3000/api/admin/reset-saldo \
  -H "Content-Type: application/json" \
  -d '{"pelanggan_id":"P001"}'

# Set saldo P001 ke nilai tertentu
curl -X POST http://localhost:3000/api/admin/set-saldo \
  -H "Content-Type: application/json" \
  -d '{"pelanggan_id":"P001","saldo":6}'

# Reset volume hari ini semua pelanggan
curl -X POST http://localhost:3000/api/admin/reset-volume-hari-ini

# Reset saldo semua pelanggan ke 0
curl -X POST http://localhost:3000/api/admin/reset-saldo-semua
```

---

# Aquantum ESP32 — Firmware

Firmware Arduino untuk perangkat **Aquantum** berbasis ESP32. Mengukur debit dan volume air via flow sensor, lalu mengirim data ke backend secara real-time lewat WiFi.

---

## Gambaran Umum ESP32

```
┌────────────────────────────────────────────────┐
│               AQUANTUM DEVICE                  │
│                                                │
│  Flow Sensor ──► ESP32 ──► WiFi ──► Backend    │
│                                 (port 3000)    │
└────────────────────────────────────────────────┘
```

ESP32 berperan sebagai:
1. **Pengukur** — membaca pulsa flow sensor untuk menghitung debit (L/menit) dan volume (liter)
2. **Controller** — mengontrol valve berdasarkan instruksi backend (buka/tutup sesuai saldo)
3. **Pengirim data** — mengirim data sensor ke backend setiap 1 detik via HTTP POST

---

## Komponen Hardware

| Komponen | Spesifikasi | Qty |
|----------|-------------|-----|
| ESP32 DevKit | 38-pin dev board | 1 |
| Flow Sensor | YF-S201 | 1 |
| Kabel jumper | Male-to-male / male-female | secukupnya |

---

## Wiring / Skema Koneksi

### Flow Sensor YF-S201

| Kabel Sensor | Pin ESP32 |
|--------------|-----------|
| Merah (VCC) | 5V |
| Hitam (GND) | GND |
| Kuning (Signal) | GPIO 27 |

---

## Instalasi Library Arduino

Buka Arduino IDE → **Tools → Manage Libraries** (`Ctrl+Shift+I`), lalu install:

| Library | Author | Versi |
|---------|--------|-------|
| `ArduinoJson` | Benoit Blanchon | **6.x** |

---

## Konfigurasi Firmware

Edit 4 baris berikut di bagian paling atas file `aquantum-esp32.ino`:

```cpp
const char*   WIFI_SSID    = "NamaWiFi";
const char*   WIFI_PASS    = "PasswordWiFi";
const char*   SERVER_URL   = "http://10.201.138.14:3000"; // IP laptop + port backend
const String  PELANGGAN_ID = "P001";                      // ID pelanggan di sistem
```

| Parameter | Keterangan |
|-----------|-----------|
| `WIFI_SSID` | Nama hotspot / WiFi yang digunakan |
| `WIFI_PASS` | Password WiFi |
| `SERVER_URL` | `http://` + IP laptop + `:3000` — IP diperoleh dari `ipconfig getifaddr en0` (Mac) atau `ipconfig` (Windows) |
| `PELANGGAN_ID` | ID pelanggan yang terdaftar di backend (`P001` atau `P002`) |

> **Penting:** IP laptop bisa berubah setiap kali berganti jaringan WiFi. Perbarui `SERVER_URL` lalu upload ulang ke ESP32.

---

## Cara Upload ke ESP32

1. Hubungkan ESP32 ke laptop via kabel USB
2. Arduino IDE → **Tools → Board** → pilih `ESP32 Dev Module`
3. **Tools → Port** → pilih port yang sesuai (`COMx` di Windows, `/dev/tty.usbserial-xxx` di Mac)
4. Edit konfigurasi `WIFI_SSID`, `WIFI_PASS`, dan `SERVER_URL`
5. Klik tombol **Upload** (ikon panah →)
6. Tunggu hingga muncul `Done uploading`
7. Buka **Serial Monitor** (baud rate `115200`) untuk melihat log koneksi WiFi

---

## Cara Kerja Firmware

```
[BOOT]
  └─► Inisialisasi Flow Sensor (GPIO 27)
  └─► Koneksi WiFi (timeout 10 detik / 20 percobaan)
        ├─ Berhasil → lanjut kirim data ke backend
        └─ Gagal   → mode offline aktif, tetap jalan

[LOOP — berjalan terus-menerus]

  Setiap 1 detik:
    └─► Baca pulsa flow sensor
    └─► Hitung flowRate (liter/menit) & volume (liter)
    └─► Kurangi saldo lokal: setiap 10L → 1 saldo berkurang
    └─► POST /api/esp32/data  →  terima instruksi valve (true/false)

  Saat token disubmit:
    └─► Validasi token lokal (1111 atau 4444)
    └─► Jika valid → tambah saldo lokal
    └─► POST /api/esp32/token  →  server catat one-time use
```

ESP32 membaca field `valve` dari response backend:
- `true` → biarkan air mengalir (valve terbuka)
- `false` → valve ditutup (saldo habis)

---

## Token & Saldo di Firmware

### Konversi Saldo ke Air

| Saldo | Air |
|-------|-----|
| 1 | 10 liter |
| 10 | 100 liter |
| 20 | 200 liter |

Saldo berkurang otomatis: setiap **10 liter** air mengalir, **1 saldo** terpotong.

### Token Preset (built-in di firmware)

| Kode | Saldo Ditambah | Setara Air |
|------|----------------|------------|
| `1111` | +10 saldo | +100 liter |
| `4444` | +20 saldo | +200 liter |

Token diproses secara lokal di ESP32, lalu dilaporkan ke backend via `POST /api/esp32/token` untuk dicatat sebagai one-time use.

---

## Mode Offline

Jika WiFi tidak tersedia atau terputus di tengah jalan:

- ESP32 **tetap berjalan normal** — flow sensor tetap aktif mengukur
- Token lokal (`1111` / `4444`) tetap dapat digunakan untuk menambah saldo secara lokal
- Data **tidak dikirim** ke backend selama offline
- Begitu WiFi terhubung kembali, pengiriman data real-time otomatis berlanjut

> Data yang terlewat selama offline **tidak dikirim ulang** — hanya data real-time saat koneksi aktif yang terkirim.

---

## Troubleshooting ESP32

| Masalah | Kemungkinan Penyebab | Solusi |
|---------|----------------------|--------|
| WiFi gagal konek | SSID / password salah | Periksa `WIFI_SSID` dan `WIFI_PASS` |
| Data tidak masuk ke backend | IP backend berubah | Cek IP laptop terbaru, perbarui `SERVER_URL`, upload ulang |
| Backend tidak merespons | Backend belum jalan | Jalankan `npm run dev` di folder `aquantum-backend` |
| Token diterima lokal tapi ditolak server | Token sudah pernah dipakai | Generate token baru dari AquaControl |
| Volume tidak bertambah | Flow sensor tidak terbaca | Periksa wiring GPIO 27, pastikan ada aliran air |
| Serial Monitor kosong | Baud rate salah | Set ke `115200` |
