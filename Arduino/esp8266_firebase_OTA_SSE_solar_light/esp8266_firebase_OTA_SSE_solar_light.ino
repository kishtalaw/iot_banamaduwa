#include <ESP8266WiFi.h>
#include <Firebase_ESP_Client.h>
#include <ArduinoOTA.h>

// Wi-Fi credentials
const char* ssid = "Chandrani-fiber";
const char* pass = "80ExqR4Tsd";

//const char* ssid = "cpe-06AEC8";
//const char* pass = "63ED41D1";

// Firebase objects
FirebaseConfig config;
FirebaseAuth   auth;
FirebaseData   fbdo;    // for REST PUTs
FirebaseData   stream;  // for streaming

const String   deviceName= "solar_light";
const String   basePath  = "/houses/house123/devices/" + deviceName;
const String   cmdPath   = basePath + "/command";
const int      LIGHT_PIN = 0;
String         lastLight = "NULL";

// helper to (re)connect Wi‑Fi
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("Connecting to Wi‑Fi");
  WiFi.begin(ssid, pass);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  Serial.println(" connected!");
}

// helper to (re)start the RTDB stream
void startFirebaseStream() {
  // keep retrying until we succeed
  while (!Firebase.RTDB.beginStream(&stream, basePath)) {
    Serial.printf("Stream begin failed: %s\n", stream.errorReason().c_str());
    Serial.println("Retrying in 2 seconds...");
    delay(2000);
  }
  Serial.println("Stream began successfully");
  Firebase.RTDB.setStreamCallback(&stream, streamCallback, streamTimeoutCallback);
  forceSyncFromDatabase();
}

// Called when a streaming update arrives
void streamCallback(FirebaseStream data) {
  if (data.dataPath() != "/command") return;
  String cmd = data.stringData();
  Serial.printf("Command event: %s -> %s\n", data.dataPath().c_str(), cmd.c_str());
  if ((cmd == "ON" || cmd == "OFF") && cmd != lastLight) {
    digitalWrite(LIGHT_PIN, cmd == "ON" ? LOW : HIGH);
    lastLight = cmd;

    String statePath = basePath + "/state";
    if (!Firebase.RTDB.setString(&fbdo, statePath, cmd)) {
      Serial.printf("State PUT failed: %s\n", fbdo.errorReason().c_str());
    } else {
      Serial.println("State PUT OK");
    }
  }
}

// Called on stream timeout/disconnect
void streamTimeoutCallback(bool timeout) {
  if (timeout) {
    Serial.println("Stream timeout, reconnecting…");

    // Try forcing a sync in case we missed a command during disconnect
    forceSyncFromDatabase();

    // Re-establish the stream connection
    if (!Firebase.RTDB.beginStream(&stream, basePath)) {
      Serial.printf("Stream re-begin failed: %s\n", stream.errorReason().c_str());
    } else {
      Firebase.RTDB.setStreamCallback(&stream, streamCallback, streamTimeoutCallback);
      forceSyncFromDatabase();
    }
  }
}

// Force sync from database in case of missed updates or at startup
void forceSyncFromDatabase() {
  if (Firebase.RTDB.getString(&fbdo, cmdPath)) {
    String cmd = fbdo.stringData();
    Serial.printf("Forced sync command: %s\n", cmd.c_str());
    if ((cmd == "ON" || cmd == "OFF") && cmd != lastLight) {
      digitalWrite(LIGHT_PIN, cmd == "ON" ? LOW : HIGH);
      lastLight = cmd;

      String statePath = basePath + "/state";
      if (!Firebase.RTDB.setString(&fbdo, statePath, cmd)) {
        Serial.printf("State PUT failed (sync): %s\n", fbdo.errorReason().c_str());
      } else {
        Serial.println("State PUT OK (sync)");
      }
    }
  } else {
    Serial.printf("Sync get failed: %s\n", fbdo.errorReason().c_str());
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LIGHT_PIN, OUTPUT);
  digitalWrite(LIGHT_PIN, LOW);

  // Wi-Fi
  connectWiFi();

  // OTA
  ArduinoOTA.setHostname(deviceName.c_str());
  ArduinoOTA.setPassword("cast123");
  ArduinoOTA.begin();
  Serial.println("OTA Ready");

  // Firebase initialization
  config.host = "home-automation-460908-default-rtdb.firebaseio.com";
  config.signer.tokens.legacy_token = "oh9l4wEfSXMS1nbGu1Jfs9jZ4mktyYgYbDGV6QvT";
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // Force sync on boot in case of power loss/reboot
  forceSyncFromDatabase();

  // Start RTDB streaming
  startFirebaseStream();
}

void loop() {
  ArduinoOTA.handle();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi‑Fi lost, reconnecting…");
    connectWiFi();
    // after Wi‑Fi back, re‑start the stream
    startFirebaseStream();
  }

  // Periodic fallback sync every 10 minutes (600000 ms)
  static unsigned long lastSync = 0;
  if (millis() - lastSync > 600000 && WiFi.status() == WL_CONNECTED) {
    lastSync = millis();
    Serial.println("[Periodic Sync] Checking command state from Firebase...");
    forceSyncFromDatabase();
  }
  //Serial.println(WiFi.RSSI());
} 
