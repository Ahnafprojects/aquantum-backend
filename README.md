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
