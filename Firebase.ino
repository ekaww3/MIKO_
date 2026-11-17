#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Firebase_ESP_Client.h>

// Helper bawaan Firebase_ESP_Client
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>

#include "DHT.h"

#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""

// --- KONFIGURASI FIREBASE ---
#define API_KEY "AIzaSyC2bt-bN0bnonX1ROPR-59G6cA4eo_xZ2A"
#define DATABASE_URL "https://jamur-esp-default-rtdb.asia-southeast1.firebasedatabase.app/"

// Kredensial Akun Firebase
#define USER_EMAIL "fauzaneka890@gmail.com"
#define USER_PASSWORD "23456789"

// --- KONFIGURASI SENSOR & PIN ---
#define DHTPIN 4
#define DHTTYPE DHT22
#define RELAY_POMPA_PIN 5   // Relay 1: sanyo
#define RELAY2_PIN 18       // Relay 2: exhaust / lampu (sesuaikan dengan wiring Anda)

// --- KONFIGURASI OLED (SSD1306 128x64, I2C) ---
#define OLED_WIDTH    128
#define OLED_HEIGHT   64
#define OLED_RESET    -1     // -1 = tanpa pin reset
#define OLED_ADDR     0x3C   // alamat I2C umum (kadang 0x3D)
#define OLED_SDA_PIN  21     // SDA default ESP32
#define OLED_SCL_PIN  22     // SCL default ESP32

// Ubah ke LOW/HIGH (dibalik) jika modul relay bersifat Active-LOW
#define RELAY_ON  HIGH
#define RELAY_OFF LOW

const float DEFAULT_BATAS_LEMBAB = 80.0;   // sanyo ON jika kelembapan di bawah angka ini
const float DEFAULT_BATAS_SUHU   = 30.0;   // batas suhu maksimum
const float HISTERESIS_LEMBAB    = 2.0;    // sanyo baru OFF saat kelembapan >= batas + angka ini (0 = tanpa histeresis)
const bool  RELAY2_OTOMATIS_SUHU = true;   // true: relay 2 ikut menyala saat mode otomatis dan suhu > batas

// --- INTERVAL (millis, tanpa delay) ---
const unsigned long INTERVAL_SENSOR_MS  = 3000;  // baca DHT & kirim ke dasbor (DHT22 minimal 2000 ms)
const unsigned long INTERVAL_KONTROL_MS = 2000;  // cek toggle/batas dari dasbor & atur relay
const unsigned long INTERVAL_OLED_MS    = 500;   // refresh tampilan OLED
const unsigned long WIFI_TIMEOUT_MS     = 20000; // jika WiFi gagal terhubung selama ini, ESP restart

DHT dht(DHTPIN, DHTTYPE);
Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);

// --- OBJEK FIREBASE ---
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// Penanda waktu untuk masing-masing tugas
unsigned long prevSensorMs = 0;
unsigned long prevKontrolMs = 0;
unsigned long prevOledMs = 0;

// Data & status terakhir
float suhuTerakhir = 0, kelembapanTerakhir = 0;
bool sensorOk = false;            // true jika pembacaan DHT terakhir berhasil
float batasKelembapan = DEFAULT_BATAS_LEMBAB;
float batasSuhu = DEFAULT_BATAS_SUHU;
bool pompaOn = false;
bool relay2On = false;            // status relay 2 (disimpan global agar bisa ditampilkan di OLED)
bool modeOtomatisAktif = false;   // status mode terakhir (untuk OLED)
bool oledOk = false;              // true jika OLED berhasil diinisialisasi
String lastStatusPompa = "";

void setRelay(int pin, bool on) {
  digitalWrite(pin, on ? RELAY_ON : RELAY_OFF);
}

// Tampilkan suhu, kelembapan, dan status relay di OLED
void tampilkanOLED() {
  if (!oledOk) return;

  char buf[24];

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);

  // Baris judul + mode
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.print("Monitor Jamur");
  oled.setCursor(98, 0);
  oled.print(modeOtomatisAktif ? "AUTO" : "MANUAL");
  oled.drawLine(0, 10, OLED_WIDTH - 1, 10, SSD1306_WHITE);

  // Suhu & kelembapan (ukuran besar)
  oled.setTextSize(2);
  oled.setCursor(0, 15);
  if (sensorOk) {
    snprintf(buf, sizeof(buf), "Suhu:%.1fC", suhuTerakhir);
  } else {
    snprintf(buf, sizeof(buf), "Suhu:--");
  }
  oled.print(buf);

  oled.setCursor(0, 33);
  if (sensorOk) {
    snprintf(buf, sizeof(buf), "Lemb:%.1f%%", kelembapanTerakhir);
  } else {
    snprintf(buf, sizeof(buf), "Lemb:--");
  }
  oled.print(buf);

  // Status relay
  oled.drawLine(0, 52, OLED_WIDTH - 1, 52, SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 55);
  snprintf(buf, sizeof(buf), "Pompa:%s Relay2:%s", pompaOn ? "ON" : "OFF", relay2On ? "ON" : "OFF");
  oled.print(buf);

  oled.display();
}

// Tulis status pompa ke Firebase hanya jika berubah (hemat request)
void updateStatusPompa(const String &status) {
  if (status != lastStatusPompa) {
    if (Firebase.RTDB.setString(&fbdo, "/status/pompa", status)) {
      lastStatusPompa = status;
    }
  }
}

// Tugas 1: baca sensor lalu kirim ke dasbor Monitoring
void tugasSensor() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (isnan(h) || isnan(t)) {
    sensorOk = false;
    Serial.println("Gagal membaca sensor DHT!");
    return;
  }

  sensorOk = true;
  kelembapanTerakhir = h;
  suhuTerakhir = t;

  Firebase.RTDB.setFloat(&fbdo, "/monitoring/suhu", t);
  Firebase.RTDB.setFloat(&fbdo, "/monitoring/kelembapan", h);
}

// Tugas 2: ambil pengaturan dari dasbor lalu atur relay
void tugasKontrol() {
  bool modeOtomatis = false;
  if (Firebase.RTDB.getBool(&fbdo, "/kontrol/mode_otomatis")) {
    modeOtomatis = fbdo.boolData();
  } else {
    Serial.print("Gagal baca mode_otomatis! Error: ");
    Serial.println(fbdo.errorReason());
  }
  modeOtomatisAktif = modeOtomatis;

  // Batas dari dasbor Pengaturan (jika belum ada, pakai nilai terakhir / default)
  if (Firebase.RTDB.getFloat(&fbdo, "/kontrol/batas_kelembapan")) {
    batasKelembapan = fbdo.floatData();
  }
  if (Firebase.RTDB.getFloat(&fbdo, "/kontrol/batas_suhu")) {
    batasSuhu = fbdo.floatData();
  }

  bool relay2Manual = false;
  if (Firebase.RTDB.getBool(&fbdo, "/kontrol/relay2")) {
    relay2Manual = fbdo.boolData();
  }

  // --- Relay 1 (sanyo) ---
  if (modeOtomatis) {
    if (!sensorOk) {
      // Tanpa data sensor yang valid, pompa dimatikan demi keamanan
      pompaOn = false;
      updateStatusPompa("OFF (Auto, sensor error)");
    } else {
      if (!pompaOn && kelembapanTerakhir < batasKelembapan) {
        pompaOn = true;
      } else if (pompaOn && kelembapanTerakhir >= batasKelembapan + HISTERESIS_LEMBAB) {
        pompaOn = false;
      }
      updateStatusPompa(pompaOn ? "ON (Auto)" : "OFF (Auto)");
    }
  } else {
    bool pompaManual = false;
    if (Firebase.RTDB.getBool(&fbdo, "/kontrol/pompa_manual")) {
      pompaManual = fbdo.boolData();
    }
    pompaOn = pompaManual;
    updateStatusPompa(pompaOn ? "ON (Manual)" : "OFF (Manual)");
  }
  setRelay(RELAY_POMPA_PIN, pompaOn);

  // --- Relay 2 (exhaust / lampu) ---
  relay2On = relay2Manual;
  if (RELAY2_OTOMATIS_SUHU && modeOtomatis && sensorOk && suhuTerakhir > batasSuhu) {
    relay2On = true;
  }
  setRelay(RELAY2_PIN, relay2On);

  Serial.printf("Suhu: %.1f C (batas %.1f) | Lembap: %.1f %% (batas %.1f) | Auto: %s | Pompa: %s | R2: %s\n",
                suhuTerakhir, batasSuhu, kelembapanTerakhir, batasKelembapan,
                modeOtomatis ? "ya" : "tidak", pompaOn ? "ON" : "OFF", relay2On ? "ON" : "OFF");

  // Perbarui OLED segera setelah status relay berubah
  tampilkanOLED();
}

void setup() {
  Serial.begin(115200);

  pinMode(RELAY_POMPA_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  setRelay(RELAY_POMPA_PIN, false);
  setRelay(RELAY2_PIN, false);

  dht.begin();

  // Inisialisasi OLED
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  if (oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    oledOk = true;
    oled.clearDisplay();
    oled.setTextSize(1);
    oled.setTextColor(SSD1306_WHITE);
    oled.setCursor(0, 0);
    oled.println("Monitor Jamur");
    oled.println("Menghubungkan WiFi...");
    oled.display();
  } else {
    Serial.println("OLED tidak ditemukan, cek wiring/alamat I2C!");
  }

  // Koneksi WiFi (menunggu dengan millis, bukan delay)
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  unsigned long mulai = millis();
  unsigned long titikTerakhir = mulai;
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - titikTerakhir >= 500) {
      titikTerakhir = millis();
      Serial.print(".");
    }
    if (millis() - mulai > WIFI_TIMEOUT_MS) {
      Serial.println("\nWiFi gagal terhubung, restart...");
      ESP.restart();
    }
  }
  Serial.println();
  Serial.print("Connected with IP: ");
  Serial.println(WiFi.localIP());

  // Konfigurasi Firebase API & URL
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;

  // Autentikasi Email & Password
  auth.user.email = USER_EMAIL;
  auth.user.password = USER_PASSWORD;

  config.token_status_callback = tokenStatusCallback;

  // Inisialisasi Firebase
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // Supaya ketiga tugas langsung jalan di putaran loop pertama
  prevSensorMs = millis() - INTERVAL_SENSOR_MS;
  prevKontrolMs = millis() - INTERVAL_KONTROL_MS;
  prevOledMs = millis() - INTERVAL_OLED_MS;
}

void loop() {
  unsigned long sekarang = millis();

  // OLED tetap diperbarui walau Firebase belum siap
  if (sekarang - prevOledMs >= INTERVAL_OLED_MS) {
    prevOledMs = sekarang;
    tampilkanOLED();
  }

  if (!Firebase.ready()) return;

  // Sensor dulu, supaya kontrol memakai data terbaru
  if (sekarang - prevSensorMs >= INTERVAL_SENSOR_MS) {
    prevSensorMs = sekarang;
    tugasSensor();
  }

  if (sekarang - prevKontrolMs >= INTERVAL_KONTROL_MS) {
    prevKontrolMs = sekarang;
    tugasKontrol();
  }
}
