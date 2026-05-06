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

// Data master pelanggan — hanya pelanggan aktif terhubung ESP32
const customers = {
  P001: {
    nama:       'Budi Santoso',
    alamat:     'Jl. Merdeka No.12',
    saldo:      45.5,
    volume:     0,
    flowRate:   0,
    valve:      true,
    lastUpdate: new Date().toISOString(),
    history:    []
  },
  P002: {
    nama:       'Siti Rahayu',
    alamat:     'Jl. Sudirman No.5',
    saldo:      12.0,
    volume:     0,
    flowRate:   0,
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

// Pemakaian harian real — diisi dari data ESP32 saat server berjalan
const dailyUsage = {};

function initDailyUsage() {
  const today = new Date();

  Object.keys(customers).forEach((pid) => {
    dailyUsage[pid] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dailyUsage[pid].push({
        tanggal:        d.toISOString().split('T')[0],
        volume:         0,
        saldo_terpakai: 0,
      });
    }
  });

  console.log('📅 Daily usage tracking diinisialisasi (data real dari ESP32)');
}

initDailyUsage();

// Tambah volume ke pemakaian hari ini untuk pelanggan tertentu
function catatPemakaianHariIni(pelangganId, deltaVolume) {
  if (!dailyUsage[pelangganId]) return;
  const hariIni = new Date().toISOString().split('T')[0];
  const entry   = dailyUsage[pelangganId].find((d) => d.tanggal === hariIni);
  if (entry) {
    entry.volume         = parseFloat((entry.volume + deltaVolume).toFixed(1));
    entry.saldo_terpakai = parseFloat((entry.volume / 10).toFixed(2));
  }
}

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
  const { pelanggan_id, volume, flowRate } = req.body;

  if (!pelanggan_id) {
    return res.status(400).json({ error: 'pelanggan_id diperlukan' });
  }

  const customer = customers[pelanggan_id];
  if (!customer) {
    return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
  }

  // Hitung saldo dari delta volume (server jadi sumber kebenaran saldo)
  // Jika volume ESP32 naik → kurangi saldo sesuai selisih (10 liter = 1 saldo)
  if (volume !== undefined) {
    const newVolume = parseFloat(Number(volume).toFixed(1));
    if (customer.volume === 0) {
      // Pertama kali data masuk setelah server start — jadikan baseline, jangan hitung delta
      customer.volume = newVolume;
    } else if (newVolume > customer.volume) {
      const delta       = newVolume - customer.volume;
      const saldoKurang = parseFloat((delta / 10).toFixed(4));
      customer.saldo    = Math.max(0, parseFloat((customer.saldo - saldoKurang).toFixed(2)));
      // Catat pemakaian real hari ini untuk grafik
      catatPemakaianHariIni(pelanggan_id, delta);
      customer.volume = newVolume;
    }
  }

  if (flowRate !== undefined) customer.flowRate = parseFloat(Number(flowRate).toFixed(2));

  customer.lastUpdate = new Date().toISOString();
  customer.valve      = customer.saldo > 0;

  const lowBalance = customer.saldo < 5;

  res.json({
    valve:  customer.valve,
    status: 'ok',
    saldo:  customer.saldo,
    ...(lowBalance ? { low_balance: true } : {})
  });
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
    low_balance: customer.saldo <= 5,
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

  // Hitung ringkasan — aktif/nonaktif berdasarkan saldo (sesuai logika ESP32)
  const totalAktif    = daftarPelanggan.filter((p) => p.saldo > 0).length;
  const totalNonaktif = daftarPelanggan.filter((p) => p.saldo <= 0).length;

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

/**
 * POST /api/admin/reset-saldo
 * Reset saldo pelanggan ke 0 dan tutup valve.
 * Body : { pelanggan_id }
 */
app.post('/api/admin/reset-saldo', (req, res) => {
  const { pelanggan_id } = req.body;

  if (!pelanggan_id) {
    return res.status(400).json({ error: 'pelanggan_id diperlukan' });
  }

  const customer = customers[pelanggan_id];
  if (!customer) {
    return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
  }

  customer.saldo      = 0;
  customer.valve      = false;
  customer.lastUpdate = new Date().toISOString();

  res.json({
    pelanggan_id,
    saldo: 0,
    valve: false,
    message: `Saldo pelanggan ${pelanggan_id} berhasil direset ke 0`
  });
});

/**
 * POST /api/admin/reset-volume-hari-ini
 * Reset volume hari ini ke 0 untuk semua pelanggan.
 */
app.post('/api/admin/reset-volume-hari-ini', (req, res) => {
  const hariIni = new Date().toISOString().split('T')[0];

  Object.keys(dailyUsage).forEach((pid) => {
    const entry = dailyUsage[pid].find((d) => d.tanggal === hariIni);
    if (entry) {
      entry.volume         = 0;
      entry.saldo_terpakai = 0;
    }
  });

  res.json({ message: 'Volume hari ini berhasil direset ke 0', tanggal: hariIni });
});

/**
 * POST /api/admin/set-saldo
 * Set saldo pelanggan ke nilai tertentu.
 * Body : { pelanggan_id, saldo }
 */
app.post('/api/admin/set-saldo', (req, res) => {
  const { pelanggan_id, saldo } = req.body;

  if (!pelanggan_id || saldo === undefined) {
    return res.status(400).json({ error: 'pelanggan_id dan saldo diperlukan' });
  }

  const customer = customers[pelanggan_id];
  if (!customer) {
    return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
  }

  customer.saldo      = parseFloat(Number(saldo).toFixed(2));
  customer.valve      = customer.saldo > 0;
  customer.lastUpdate = new Date().toISOString();

  res.json({
    pelanggan_id,
    saldo: customer.saldo,
    valve: customer.valve,
    message: `Saldo pelanggan ${pelanggan_id} berhasil diset ke ${customer.saldo}`
  });
});

/**
 * POST /api/admin/reset-saldo-semua
 * Reset saldo semua pelanggan ke 0 dan tutup semua valve.
 */
app.post('/api/admin/reset-saldo-semua', (req, res) => {
  Object.keys(customers).forEach((pid) => {
    customers[pid].saldo      = 0;
    customers[pid].valve      = false;
    customers[pid].lastUpdate = new Date().toISOString();
  });

  res.json({ message: 'Saldo semua pelanggan berhasil direset ke 0', total_saldo_beredar: 0 });
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
