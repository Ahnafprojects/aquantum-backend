// ============================================================
//  Aquantum Backend — PDAM Prepaid REST API
//  Konversi: 1 saldo = 10 liter air
// ============================================================

const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());           // izinkan semua origin
app.use(express.json());   // parse body JSON

// ============================================================
//  IN-MEMORY DATA STORE
// ============================================================

// Data master pelanggan
const customers = {
  P001: {
    nama:       'Budi Santoso',
    alamat:     'Jl. Merdeka No.12',
    saldo:      45.5,
    volume:     120.3,   // total liter yang sudah mengalir
    flowRate:   0,       // liter/menit saat ini
    valve:      true,
    lastUpdate: new Date().toISOString(),
    history:    []       // riwayat topup
  },
  P002: {
    nama:       'Siti Rahayu',
    alamat:     'Jl. Sudirman No.5',
    saldo:      12.0,
    volume:     340.7,
    flowRate:   2.1,
    valve:      true,
    lastUpdate: new Date().toISOString(),
    history:    []
  },
  P003: {
    nama:       'Ahmad Fauzi',
    alamat:     'Jl. Diponegoro No.88',
    saldo:      0,
    volume:     89.1,
    flowRate:   0,
    valve:      false,   // saldo 0 → katup tutup
    lastUpdate: new Date().toISOString(),
    history:    []
  },
  P004: {
    nama:       'Dewi Lestari',
    alamat:     'Jl. Pahlawan No.3',
    saldo:      78.2,
    volume:     210.5,
    flowRate:   1.3,
    valve:      true,
    lastUpdate: new Date().toISOString(),
    history:    []
  }
};

// Token bawaan hardware ESP32 (token → nilai saldo)
const PRESET_TOKENS = {
  '1111': 10,   // +10 saldo = +100 liter
  '4444': 20    // +20 saldo = +200 liter
};

// Set token yang sudah terpakai (sekali pakai)
const usedTokens = new Set();

// Token yang di-generate admin: token → nilai saldo
const adminTokens = {};

// Data pemakaian harian per pelanggan (di-generate saat server start)
const dailyUsage = {};

// ============================================================
//  GENERATE DUMMY DAILY USAGE (7 hari ke belakang)
// ============================================================

function generateDummyDailyUsage() {
  const today = new Date();

  Object.keys(customers).forEach((pid) => {
    dailyUsage[pid] = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const tanggal = d.toISOString().split('T')[0];

      // Volume harian acak 5–35 liter, 0 jika pelanggan nonaktif (P003)
      const isActive  = customers[pid].valve || i > 0; // hari sebelumnya bisa saja aktif
      const volume    = isActive
        ? parseFloat((Math.random() * 30 + 5).toFixed(1))
        : 0;
      const saldoTerpakai = parseFloat((volume / 10).toFixed(2));

      dailyUsage[pid].push({ tanggal, volume, saldo_terpakai: saldoTerpakai });
    }
  });

  console.log('📅 Daily usage (7 hari) berhasil di-generate');
}

generateDummyDailyUsage();

// ============================================================
//  HELPER: Validasi & Proses Token
// ============================================================

/**
 * Cek token, tambah saldo pelanggan, catat history.
 * Return objek result { valid, nilai, saldo_baru, message }.
 */
function processToken(pelangganId, token) {
  const customer = customers[pelangganId];
  if (!customer) {
    return { valid: false, message: 'Pelanggan tidak ditemukan' };
  }

  // Cek apakah token sudah pernah dipakai
  if (usedTokens.has(token)) {
    return { valid: false, message: 'Token sudah pernah digunakan' };
  }

  // Tentukan nilai saldo dari token (preset atau admin-generated)
  let nilai = null;
  if (PRESET_TOKENS[token] !== undefined) {
    nilai = PRESET_TOKENS[token];
  } else if (adminTokens[token] !== undefined) {
    nilai = adminTokens[token];
  } else {
    return { valid: false, message: 'Token tidak valid' };
  }

  // Tandai token sudah terpakai
  usedTokens.add(token);

  // Tambah saldo & buka valve jika sebelumnya tertutup karena saldo 0
  customer.saldo      = parseFloat((customer.saldo + nilai).toFixed(2));
  customer.valve      = customer.saldo > 0;
  customer.lastUpdate = new Date().toISOString();

  // Catat ke history pelanggan
  customer.history.push({
    type:         'topup',
    token,
    nilai,
    saldo_sesudah: customer.saldo,
    timestamp:    customer.lastUpdate
  });

  return {
    valid:     true,
    nilai,
    saldo_baru: customer.saldo,
    message:   `Topup berhasil! +${nilai} saldo (+${nilai * 10} liter)`
  };
}

// ============================================================
//  ESP32 ENDPOINTS
// ============================================================

/**
 * POST /api/esp32/data
 * Terima data sensor dari ESP32, update memory, kembalikan status valve.
 * Body : { pelanggan_id, saldo, volume, flowRate }
 * Return: { valve: true|false, status: "ok" }
 *
 * ESP32 mengirim saldo terkini (sudah dikurangi pemakaian di sisi hardware).
 * Server menjadi sumber kebenaran valve berdasarkan saldo tersebut.
 */
app.post('/api/esp32/data', (req, res) => {
  const { pelanggan_id, saldo, volume, flowRate } = req.body;

  if (!pelanggan_id) {
    return res.status(400).json({ error: 'pelanggan_id diperlukan' });
  }

  const customer = customers[pelanggan_id];
  if (!customer) {
    return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
  }

  // Update field yang dikirim ESP32 (undefined artinya tidak dikirim, skip)
  if (saldo    !== undefined) customer.saldo    = parseFloat(Number(saldo).toFixed(2));
  if (volume   !== undefined) customer.volume   = parseFloat(Number(volume).toFixed(1));
  if (flowRate !== undefined) customer.flowRate = parseFloat(Number(flowRate).toFixed(2));

  customer.lastUpdate = new Date().toISOString();

  // Valve buka jika saldo > 0, tutup jika habis
  customer.valve = customer.saldo > 0;

  res.json({ valve: customer.valve, status: 'ok' });
});

/**
 * POST /api/esp32/token
 * Validasi token yang dimasukkan lewat keypad di ESP32.
 * Body : { pelanggan_id, token }
 * Return: { valid, nilai, saldo_baru, message }
 */
app.post('/api/esp32/token', (req, res) => {
  const { pelanggan_id, token } = req.body;

  if (!pelanggan_id || !token) {
    return res.status(400).json({ error: 'pelanggan_id dan token diperlukan' });
  }

  const result = processToken(pelanggan_id, String(token).trim());

  if (!result.valid) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// ============================================================
//  CUSTOMER ENDPOINTS
// ============================================================

/**
 * GET /api/customer/:id
 * Ambil profil lengkap pelanggan termasuk history topup.
 * Return: { id, nama, alamat, saldo, volume, flowRate, valve, lastUpdate, history }
 */
app.get('/api/customer/:id', (req, res) => {
  const { id } = req.params;
  const customer = customers[id];

  if (!customer) {
    return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
  }

  res.json({
    id,
    nama:       customer.nama,
    alamat:     customer.alamat,
    saldo:      customer.saldo,
    volume:     customer.volume,
    flowRate:   customer.flowRate,
    valve:      customer.valve,
    lastUpdate: customer.lastUpdate,
    history:    customer.history
  });
});

/**
 * POST /api/customer/topup
 * Topup saldo pelanggan via aplikasi/web menggunakan kode token.
 * Body : { pelanggan_id, token }
 * Return: { success, nilai, saldo_baru, message }
 */
app.post('/api/customer/topup', (req, res) => {
  const { pelanggan_id, token } = req.body;

  if (!pelanggan_id || !token) {
    return res.status(400).json({ success: false, error: 'pelanggan_id dan token diperlukan' });
  }

  const result = processToken(pelanggan_id, String(token).trim());

  if (!result.valid) {
    return res.status(400).json({ success: false, ...result });
  }

  res.json({ success: true, ...result });
});

// ============================================================
//  ADMIN ENDPOINTS
// ============================================================

/**
 * GET /api/admin/dashboard
 * Daftar semua pelanggan beserta ringkasan statistik global.
 * Return: { pelanggan[], summary: { total_aktif, total_nonaktif,
 *           total_volume_hari_ini, total_saldo_beredar } }
 */
app.get('/api/admin/dashboard', (req, res) => {
  const daftarPelanggan = Object.entries(customers).map(([id, data]) => ({
    id,
    nama:       data.nama,
    alamat:     data.alamat,
    saldo:      data.saldo,
    volume:     data.volume,
    flowRate:   data.flowRate,
    valve:      data.valve,
    lastUpdate: data.lastUpdate
  }));

  // Hitung ringkasan
  const totalAktif    = daftarPelanggan.filter((p) => p.valve).length;
  const totalNonaktif = daftarPelanggan.filter((p) => !p.valve).length;

  // Agregat volume hari ini dari daily usage
  const hariIni = new Date().toISOString().split('T')[0];
  let totalVolumeHariIni = 0;

  Object.keys(dailyUsage).forEach((pid) => {
    const hari = dailyUsage[pid].find((d) => d.tanggal === hariIni);
    if (hari) totalVolumeHariIni += hari.volume;
  });

  // Total saldo seluruh pelanggan
  const totalSaldoBeredar = daftarPelanggan.reduce((sum, p) => sum + p.saldo, 0);

  res.json({
    pelanggan: daftarPelanggan,
    summary: {
      total_aktif:           totalAktif,
      total_nonaktif:        totalNonaktif,
      total_volume_hari_ini: parseFloat(totalVolumeHariIni.toFixed(1)),
      total_saldo_beredar:   parseFloat(totalSaldoBeredar.toFixed(2))
    }
  });
});

/**
 * GET /api/admin/usage-chart
 * Data pemakaian air 7 hari terakhir per pelanggan + agregat semua pelanggan.
 * Return: { per_pelanggan[], aggregate[] }
 *   aggregate: [ { tanggal, total_volume } ] — cocok untuk chart bar/line
 */
app.get('/api/admin/usage-chart', (req, res) => {
  // Data per pelanggan
  const perPelanggan = Object.entries(dailyUsage).map(([pid, data]) => ({
    pelanggan_id: pid,
    nama:         customers[pid]?.nama || 'Unknown',
    data          // array { tanggal, volume, saldo_terpakai }
  }));

  // Agregat semua pelanggan per tanggal
  const firstPid   = Object.keys(dailyUsage)[0];
  const allDates   = firstPid ? dailyUsage[firstPid].map((d) => d.tanggal) : [];

  const aggregate = allDates.map((tanggal) => {
    let totalVolume = 0;

    Object.keys(dailyUsage).forEach((pid) => {
      const day = dailyUsage[pid].find((d) => d.tanggal === tanggal);
      if (day) totalVolume += day.volume;
    });

    return { tanggal, total_volume: parseFloat(totalVolume.toFixed(1)) };
  });

  res.json({ per_pelanggan: perPelanggan, aggregate });
});

/**
 * POST /api/admin/generate-token
 * Generate kode token 4 digit unik untuk dijual ke pelanggan.
 * Body : { nilai: 10 | 20 }
 * Return: { token, nilai, message }
 *
 * Token disimpan di adminTokens hingga dipakai pelanggan.
 * Dijamin unik: tidak bentrok dengan preset maupun token lain yang ada.
 */
app.post('/api/admin/generate-token', (req, res) => {
  const { nilai } = req.body;

  if (!nilai || ![10, 20].includes(Number(nilai))) {
    return res.status(400).json({ error: 'Nilai harus 10 atau 20' });
  }

  // Generate token 4 digit numerik yang belum pernah ada
  let token;
  let attempt = 0;

  do {
    token = String(Math.floor(1000 + Math.random() * 9000));
    attempt++;
    if (attempt > 200) {
      return res.status(500).json({ error: 'Gagal generate token unik, coba lagi' });
    }
  } while (
    PRESET_TOKENS[token] !== undefined    ||  // bentrok preset
    adminTokens[token]   !== undefined    ||  // sudah pernah di-generate
    usedTokens.has(token)                     // sudah terpakai
  );

  adminTokens[token] = Number(nilai);

  res.json({
    token,
    nilai: Number(nilai),
    message: `Token ${token} berhasil dibuat — nilai: ${nilai} saldo (${nilai * 10} liter)`
  });
});

/**
 * POST /api/admin/valve
 * Admin override: paksa buka atau tutup katup pelanggan tertentu.
 * Body : { pelanggan_id, valve: true | false }
 * Return: { pelanggan_id, valve, message }
 */
app.post('/api/admin/valve', (req, res) => {
  const { pelanggan_id, valve } = req.body;

  if (!pelanggan_id || typeof valve !== 'boolean') {
    return res.status(400).json({ error: 'pelanggan_id dan valve (boolean) diperlukan' });
  }

  const customer = customers[pelanggan_id];
  if (!customer) {
    return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
  }

  customer.valve      = valve;
  customer.lastUpdate = new Date().toISOString();

  res.json({
    pelanggan_id,
    valve,
    message: `Valve pelanggan ${pelanggan_id} berhasil di${valve ? 'buka' : 'tutup'} oleh admin`
  });
});

// ============================================================
//  START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log('============================================');
  console.log(`  Aquantum Backend  |  port ${PORT}`);
  console.log('============================================');
  console.log(`  Pelanggan terdaftar : ${Object.keys(customers).length}`);
  console.log(`  Preset token        : ${Object.keys(PRESET_TOKENS).join(', ')}`);
  console.log('');
  console.log('  Endpoint tersedia:');
  console.log('  [ESP32]   POST /api/esp32/data');
  console.log('  [ESP32]   POST /api/esp32/token');
  console.log('  [Customer] GET  /api/customer/:id');
  console.log('  [Customer] POST /api/customer/topup');
  console.log('  [Admin]   GET  /api/admin/dashboard');
  console.log('  [Admin]   GET  /api/admin/usage-chart');
  console.log('  [Admin]   POST /api/admin/generate-token');
  console.log('============================================');
});
