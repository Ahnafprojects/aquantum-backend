// ================================================================
//  Aquantum ESP32 — Smart Water Meter
//  Hardware : ESP32 + Flow Sensor YF-S201 + Keypad 4x4 + LCD I2C
//
//  Library yang perlu di-install di Arduino IDE (Library Manager):
//    1. Keypad              by Mark Stanley, Alexander Brevig
//    2. LiquidCrystal I2C   by Frank de Brabander
//    3. ArduinoJson         by Benoit Blanchon  (versi 6.x)
//    WiFi & HTTPClient sudah built-in di paket board ESP32.
// ================================================================

#include <Keypad.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ================================================================
//  KONFIGURASI — Sesuaikan bagian ini sebelum upload ke ESP32
// ================================================================
const char*   WIFI_SSID     = "OPPO A78";
const char*   WIFI_PASS     = "raja123raja123raja";
const char*   SERVER_URL    = "http://10.201.138.14:3000";
const String  PELANGGAN_ID  = "P001";
// ================================================================

// ================= LCD =================
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ================= FLOW SENSOR =================
volatile int pulseCount = 0;
float flowRate = 0;
float volume   = 0;

unsigned long lastTime = 0;
const int flowPin = 27;

// ================= SALDO =================
float saldo = 0;

// ================= KEYPAD =================
const byte ROWS = 4;
const byte COLS = 4;

char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};

byte rowPins[ROWS] = {14, 26, 25, 33};
byte colPins[COLS] = {32, 23, 18, 19};

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ================= TOKEN =================
String inputToken = "";

// ================= STATUS DARI SERVER =================
bool valveOk = true;

// ================= INTERRUPT =================
void IRAM_ATTR countPulse() {
  pulseCount++;
}

// ================================================================
//  Ambil saldo awal dari server saat boot
//  Endpoint : GET /api/customer/:id
// ================================================================
void ambilSaldoDariServer() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/customer/" + PELANGGAN_ID;

  http.begin(url);
  http.setTimeout(5000);

  int httpCode = http.GET();

  if (httpCode == 200) {
    String respStr = http.getString();
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, respStr) == DeserializationError::Ok) {
      saldo  = doc["saldo"].as<float>();
      volume = doc["volume"].as<float>();
      valveOk = doc["valve"].as<bool>();
      Serial.print("Saldo dari server: ");
      Serial.println(saldo);
    }
  } else {
    Serial.println("[HTTP] Gagal ambil saldo, mulai dari 0");
  }

  http.end();
}

// ================================================================
//  Kirim data sensor ke backend setiap 1 detik
//  Endpoint : POST /api/esp32/data
//  Response : { valve: true/false, status: "ok" }
// ================================================================
void kirimDataKeServer() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/esp32/data";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);

  // saldo TIDAK dikirim — server yang kelola saldo
  StaticJsonDocument<200> doc;
  doc["pelanggan_id"] = PELANGGAN_ID;
  doc["volume"]       = volume;
  doc["flowRate"]     = flowRate;

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);

  if (httpCode == 200) {
    String respStr = http.getString();
    StaticJsonDocument<200> resp;
    if (deserializeJson(resp, respStr) == DeserializationError::Ok) {
      valveOk = resp["valve"].as<bool>();
      // Ambil saldo terkini dari server
      if (resp.containsKey("saldo")) {
        saldo = resp["saldo"].as<float>();
      }
    }
  }

  http.end();
}

// ================================================================
//  Lapor token ke backend
//  Endpoint : POST /api/esp32/token
// ================================================================
void laporTokenKeServer(String kode) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/esp32/token";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);

  StaticJsonDocument<100> doc;
  doc["pelanggan_id"] = PELANGGAN_ID;
  doc["token"]        = kode;

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);

  lcd.clear();

  if (httpCode == 200) {
    String respStr = http.getString();
    StaticJsonDocument<200> resp;
    if (deserializeJson(resp, respStr) == DeserializationError::Ok) {
      saldo = resp["saldo_baru"].as<float>();
      lcd.setCursor(0, 0);
      lcd.print("Server: OK!");
      lcd.setCursor(0, 1);
      lcd.print("Saldo:");
      lcd.print(saldo, 1);
    }
  } else if (httpCode > 0) {
    String respStr = http.getString();
    StaticJsonDocument<200> resp;
    if (deserializeJson(resp, respStr) == DeserializationError::Ok) {
      String msg = resp["message"].as<String>();
      lcd.setCursor(0, 0);
      lcd.print("Server Tolak!");
      lcd.setCursor(0, 1);
      lcd.print(msg.substring(0, 16));
    }
  } else {
    Serial.println("[HTTP] laporToken gagal, code: " + String(httpCode));
    lcd.setCursor(0, 0);
    lcd.print("Server timeout");
  }

  http.end();
  delay(2000);
  lcd.clear();
}

// ================================================================
//  SETUP
// ================================================================
void setup() {
  Serial.begin(115200);

  // FIX: INPUT_PULLUP mencegah pin floating dan pulsa palsu
  pinMode(flowPin, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(flowPin), countPulse, RISING);

  lcd.init();
  lcd.backlight();

  lcd.setCursor(0, 0);
  lcd.print("AQUANTUM");
  lcd.setCursor(0, 1);
  lcd.print("Smart Water");
  delay(2000);
  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi");
  Serial.print("Menghubungkan ke WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    lcd.setCursor(attempts % 16, 1);
    lcd.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi terhubung!");
    Serial.print("IP ESP32: ");
    Serial.println(WiFi.localIP());

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi OK!");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP());
    delay(2000);

    // FIX: Ambil saldo dari server agar tidak mulai dari 0
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Sync saldo...");
    ambilSaldoDariServer();
    lcd.setCursor(0, 1);
    lcd.print("Saldo:");
    lcd.print(saldo, 1);
    delay(2000);

  } else {
    Serial.println("\nWiFi gagal — mode offline aktif.");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi GAGAL");
    lcd.setCursor(0, 1);
    lcd.print("Mode Offline");
    delay(2000);
  }

  lcd.clear();
  lastTime = millis();
}

// ================================================================
//  LOOP
// ================================================================
void loop() {

  // ===== INPUT KEYPAD =====
  char key = keypad.getKey();

  if (key) {
    if (key == '#') {
      prosesToken(inputToken);
      inputToken = "";
    }
    else if (key == '*') {
      inputToken = "";
    }
    else {
      inputToken += key;
    }
  }

  // ===== FLOW SENSOR + KIRIM DATA KE SERVER setiap 1 detik =====
  if (millis() - lastTime >= 1000) {

    detachInterrupt(flowPin);

    flowRate = pulseCount / 7.5;
    float liter = flowRate / 60.0;
    volume += liter;

    saldo -= (liter / 10.0);
    if (saldo < 0) saldo = 0;

    pulseCount = 0;
    lastTime = millis();

    attachInterrupt(digitalPinToInterrupt(flowPin), countPulse, RISING);

    kirimDataKeServer();
  }

  // ===== LCD =====
  lcd.setCursor(0, 0);
  lcd.print("S:");
  lcd.print(saldo, 1);
  lcd.print(" V:");
  lcd.print(volume, 1);
  lcd.print("   ");

  if (saldo <= 0 || !valveOk) {
    lcd.setCursor(0, 1);
    lcd.print("!! ISI TOKEN !!  ");
  } else {
    lcd.setCursor(0, 1);
    lcd.print("In:");
    lcd.print(inputToken);
    lcd.print("            ");
  }

  delay(200);
}

// ================================================================
//  TOKEN SYSTEM
// ================================================================
void prosesToken(String kode) {

  lcd.clear();
  bool tokenValid = false;

  if (kode == "1111") {
    saldo += 10;
    valveOk = true;
    lcd.print("Topup 10");
    tokenValid = true;
  }
  else if (kode == "4444") {
    saldo += 20;
    valveOk = true;
    lcd.print("Topup 20");
    tokenValid = true;
  }
  else {
    lcd.print("Token Salah");
  }

  delay(1500);
  lcd.clear();

  if (tokenValid) {
    laporTokenKeServer(kode);
  }
}
