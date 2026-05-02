# Aquantum Backend

REST API untuk sistem PDAM Prepaid **Aquantum** berbasis Node.js + Express.  
Data disimpan sepenuhnya di memory — tidak memerlukan database.

---

## Daftar Isi

- [Persyaratan](#persyaratan)
- [Instalasi](#instalasi)
- [Konfigurasi](#konfigurasi)
- [Menjalankan Server](#menjalankan-server)
- [Konversi Saldo](#konversi-saldo)
- [Sistem Token](#sistem-token)
- [Data Pelanggan](#data-pelanggan)
- [Dokumentasi API](#dokumentasi-api)
  - [ESP32 Endpoints](#esp32-endpoints)
  - [Customer Endpoints](#customer-endpoints)
  - [Admin Endpoints](#admin-endpoints)
- [Contoh Request & Response](#contoh-request--response)

---

## Persyaratan

- [Node.js](https://nodejs.org/) v16 atau lebih baru
- npm (sudah termasuk bersama Node.js)

---

## Instalasi

```bash
# 1. Masuk ke direktori project
cd aquantum-backend

# 2. Install semua dependency
npm install
```

---

## Konfigurasi

Salin atau buka file `.env` di root project:

```env
PORT=3000
NODE_ENV=development
```

| Variabel    | Default       | Keterangan             |
|-------------|---------------|------------------------|
| `PORT`      | `3000`        | Port yang digunakan server |
| `NODE_ENV`  | `development` | Environment aplikasi   |

---

## Menjalankan Server

```bash
# Mode production
npm start

# Mode development (auto-reload saat file berubah)
npm run dev
```

Output saat server berhasil berjalan:

```
============================================
  Aquantum Backend  |  port 3000
============================================
  Pelanggan terdaftar : 4
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
============================================
```

---

## Konversi Saldo

| Saldo | Air     |
|-------|---------|
| 1     | 10 liter |
| 10    | 100 liter |
| 20    | 200 liter |

> **Aturan valve:** Katup air otomatis **terbuka** jika `saldo > 0` dan **tertutup** jika `saldo ≤ 0`.

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

Data dummy 4 pelanggan yang tersedia saat server pertama kali dijalankan:

| ID    | Nama          | Alamat                   | Saldo | Valve  |
|-------|---------------|--------------------------|-------|--------|
| P001  | Budi Santoso  | Jl. Merdeka No.12        | 45.5  | Buka   |
| P002  | Siti Rahayu   | Jl. Sudirman No.5        | 12.0  | Buka   |
| P003  | Ahmad Fauzi   | Jl. Diponegoro No.88     | 0     | Tutup  |
| P004  | Dewi Lestari  | Jl. Pahlawan No.3        | 78.2  | Buka   |

> Data pemakaian harian 7 hari ke belakang di-generate otomatis saat server start.

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
  "saldo": 44.5,
  "volume": 121.3,
  "flowRate": 1.5
}
```

| Field          | Tipe    | Wajib | Keterangan                          |
|----------------|---------|-------|-------------------------------------|
| `pelanggan_id` | string  | Ya    | ID pelanggan                        |
| `saldo`        | number  | Tidak | Saldo terkini dari ESP32            |
| `volume`       | number  | Tidak | Total volume air mengalir (liter)   |
| `flowRate`     | number  | Tidak | Debit aliran saat ini (liter/menit) |

**Response `200 OK`**

```json
{
  "valve": true,
  "status": "ok"
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

**Contoh Request**

```
GET /api/customer/P001
```

**Response `200 OK`**

```json
{
  "id": "P001",
  "nama": "Budi Santoso",
  "alamat": "Jl. Merdeka No.12",
  "saldo": 45.5,
  "volume": 120.3,
  "flowRate": 0,
  "valve": true,
  "lastUpdate": "2026-05-02T08:37:53.766Z",
  "history": [
    {
      "type": "topup",
      "token": "1111",
      "nilai": 10,
      "saldo_sesudah": 54.5,
      "timestamp": "2026-05-02T08:38:03.479Z"
    }
  ]
}
```

**Response — Pelanggan Tidak Ditemukan `404`**

```json
{
  "error": "Pelanggan tidak ditemukan"
}
```

---

#### `POST /api/customer/topup`

Melakukan topup saldo pelanggan menggunakan kode token (via aplikasi atau web).

**Request Body**

```json
{
  "pelanggan_id": "P003",
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

**Response — Gagal `400`**

```json
{
  "success": false,
  "valid": false,
  "message": "Token tidak valid"
}
```

---

### Admin Endpoints

#### `GET /api/admin/dashboard`

Mengembalikan daftar semua pelanggan beserta ringkasan statistik global.

**Contoh Request**

```
GET /api/admin/dashboard
```

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
      "flowRate": 0,
      "valve": true,
      "lastUpdate": "2026-05-02T08:37:53.766Z"
    }
  ],
  "summary": {
    "total_aktif": 3,
    "total_nonaktif": 1,
    "total_volume_hari_ini": 72.7,
    "total_saldo_beredar": 135.7
  }
}
```

| Field `summary`           | Keterangan                                      |
|---------------------------|-------------------------------------------------|
| `total_aktif`             | Jumlah pelanggan dengan valve terbuka           |
| `total_nonaktif`          | Jumlah pelanggan dengan valve tertutup          |
| `total_volume_hari_ini`   | Total liter yang mengalir hari ini (semua pelanggan) |
| `total_saldo_beredar`     | Jumlah saldo seluruh pelanggan saat ini         |

---

#### `GET /api/admin/usage-chart`

Mengembalikan data pemakaian air 7 hari terakhir, tersedia per-pelanggan maupun dalam bentuk agregat untuk kebutuhan chart.

**Contoh Request**

```
GET /api/admin/usage-chart
```

**Response `200 OK`**

```json
{
  "per_pelanggan": [
    {
      "pelanggan_id": "P001",
      "nama": "Budi Santoso",
      "data": [
        { "tanggal": "2026-04-26", "volume": 6.3, "saldo_terpakai": 0.63 },
        { "tanggal": "2026-04-27", "volume": 14.2, "saldo_terpakai": 1.42 }
      ]
    }
  ],
  "aggregate": [
    { "tanggal": "2026-04-26", "total_volume": 72.8 },
    { "tanggal": "2026-04-27", "total_volume": 95.1 }
  ]
}
```

| Field `per_pelanggan[].data` | Keterangan                          |
|------------------------------|-------------------------------------|
| `tanggal`                    | Tanggal (format `YYYY-MM-DD`)       |
| `volume`                     | Volume air mengalir pada hari itu (liter) |
| `saldo_terpakai`             | Saldo yang terpotong (`volume / 10`) |

---

#### `POST /api/admin/valve`

Admin override untuk membuka atau menutup katup air pelanggan tertentu secara paksa, terlepas dari status saldo.

**Request Body**

```json
{
  "pelanggan_id": "P003",
  "valve": true
}
```

| Field          | Tipe    | Wajib | Keterangan                    |
|----------------|---------|-------|-------------------------------|
| `pelanggan_id` | string  | Ya    | ID pelanggan                  |
| `valve`        | boolean | Ya    | `true` = buka, `false` = tutup |

**Response `200 OK`**

```json
{
  "pelanggan_id": "P003",
  "valve": true,
  "message": "Valve pelanggan P003 berhasil dibuka oleh admin"
}
```

**Response — Input Tidak Valid `400`**

```json
{
  "error": "pelanggan_id dan valve (boolean) diperlukan"
}
```

> **Catatan:** Override ini akan ditimpa kembali oleh ESP32 pada saat ia mengirim data sensor berikutnya via `POST /api/esp32/data`, karena endpoint tersebut menghitung ulang status valve dari saldo.

---

#### `POST /api/admin/generate-token`

Membuat token topup baru dengan nilai saldo yang ditentukan.

**Request Body**

```json
{
  "nilai": 20
}
```

| Field   | Tipe   | Wajib | Nilai yang Diterima |
|---------|--------|-------|---------------------|
| `nilai` | number | Ya    | `10` atau `20`      |

**Response `200 OK`**

```json
{
  "token": "7064",
  "nilai": 20,
  "message": "Token 7064 berhasil dibuat — nilai: 20 saldo (200 liter)"
}
```

**Response — Nilai Tidak Valid `400`**

```json
{
  "error": "Nilai harus 10 atau 20"
}
```

---

## Contoh Request & Response

Contoh penggunaan dengan `curl`:

```bash
# Kirim data sensor dari ESP32
curl -X POST http://localhost:3000/api/esp32/data \
  -H "Content-Type: application/json" \
  -d '{"pelanggan_id":"P001","saldo":44.5,"volume":121.3,"flowRate":1.5}'

# Topup via keypad ESP32
curl -X POST http://localhost:3000/api/esp32/token \
  -H "Content-Type: application/json" \
  -d '{"pelanggan_id":"P001","token":"1111"}'

# Cek data pelanggan
curl http://localhost:3000/api/customer/P002

# Topup via aplikasi
curl -X POST http://localhost:3000/api/customer/topup \
  -H "Content-Type: application/json" \
  -d '{"pelanggan_id":"P003","token":"4444"}'

# Dashboard admin
curl http://localhost:3000/api/admin/dashboard

# Chart pemakaian 7 hari
curl http://localhost:3000/api/admin/usage-chart

# Generate token baru (nilai 10 saldo)
curl -X POST http://localhost:3000/api/admin/generate-token \
  -H "Content-Type: application/json" \
  -d '{"nilai":10}'

# Override valve pelanggan (buka)
curl -X POST http://localhost:3000/api/admin/valve \
  -H "Content-Type: application/json" \
  -d '{"pelanggan_id":"P003","valve":true}'
```
