#include <ESP8266WiFi.h>
#include <WiFiClientSecureBearSSL.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoOTA.h>
#include <ArduinoJson.h>

// ————————————————————————————————————————————
//  Wi-Fi credentials
// ————————————————————————————————————————————
const char* ssid = "Chandrani-fiber";
const char* pass = "Uncle@1953";

//const char* ssid = "cpe-06AEC8";
//const char* pass = "63ED41D1";

// ————————————————————————————————————————————
//  Firebase RTDB info
// ————————————————————————————————————————————
const char* host     = "home-automation-460908-default-rtdb.firebaseio.com";
const char* dbSecret = "oh9l4wEfSXMS1nbGu1Jfs9jZ4mktyYgYbDGV6QvT";
const String houseId = "house123";
const String deviceId = "solar_light";

// ————————————————————————————————————————————
//  Pin definition
// ————————————————————————————————————————————  
const int LIGHT_PIN = 0;
String lastLightState = "OFF";

// ————————————————————————————————————————————
//  Streaming client
// ————————————————————————————————————————————  
BearSSL::WiFiClientSecure streamClient;
bool streamerConnected = false;

// Forward declarations
void connectToWiFi();
void startFirebaseStream();
void handleFirebaseStream();
void rtdbPut(const String& path, const String& value);
String buildURL(const String& path);
void onWiFiDisconnect(const WiFiEventStationModeDisconnected& evt);

void setup() {
  Serial.begin(115200);
  pinMode(LIGHT_PIN, OUTPUT);
  digitalWrite(LIGHT_PIN, LOW);
  lastLightState = "OFF";

  // — Wi-Fi & reconnect callback
  WiFi.onStationModeDisconnected(onWiFiDisconnect);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);
  connectToWiFi();

  // — OTA setup
  ArduinoOTA.setHostname("solar-light");
  ArduinoOTA.setPassword("cast123");
  ArduinoOTA.onStart([]() { Serial.println("OTA Start"); });
  ArduinoOTA.onEnd([]()   { Serial.println("\nOTA End"); });
  ArduinoOTA.onProgress([](unsigned int prog, unsigned int tot) {
    Serial.printf("OTA Progress: %u%%\r", (prog / (tot / 100)));
  });
  ArduinoOTA.onError([](ota_error_t err) {
    Serial.printf("OTA Error[%u]: ", err);
    if      (err == OTA_AUTH_ERROR)    Serial.println("Auth Failed");
    else if (err == OTA_BEGIN_ERROR)   Serial.println("Begin Failed");
    else if (err == OTA_CONNECT_ERROR) Serial.println("Connect Failed");
    else if (err == OTA_RECEIVE_ERROR) Serial.println("Receive Failed");
    else if (err == OTA_END_ERROR)     Serial.println("End Failed");
  });
  ArduinoOTA.begin();
  Serial.println("OTA Ready");

  // — Start the SSE stream
  streamClient.setInsecure();  // skip cert validation
  startFirebaseStream();
}

void loop() {
  ArduinoOTA.handle();

  // Reconnect stream if needed
  if (!streamerConnected) {
    Serial.println("Reconnecting Firebase stream...");
    startFirebaseStream();
  } else {
    handleFirebaseStream();
  }
}

// ————————————————————————————————————————————
//  Wi-Fi disconnect callback
// ————————————————————————————————————————————
void onWiFiDisconnect(const WiFiEventStationModeDisconnected& evt) {
  Serial.printf("Wi-Fi disconnected, reason: %d\n", evt.reason);
  connectToWiFi();
  streamerConnected = false;
}

// ————————————————————————————————————————————
//  Connect (or re-connect) to Wi-Fi
// ————————————————————————————————————————————
void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("Connecting to Wi-Fi ");
  WiFi.begin(ssid, pass);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(500);
    Serial.print('.');
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" connected!");
  } else {
    Serial.println(" FAILED");
  }
}

// ————————————————————————————————————————————
//  Build Firebase REST URL (no leading slash in path)
// ————————————————————————————————————————————
String buildURL(const String& path) {
  String p = path.startsWith("/") ? path.substring(1) : path;
  String url = "/" + p + ".json?auth=" + String(dbSecret);
  return url;
}

// ————————————————————————————————————————————
//  Open an HTTPS SSE (streaming) connection to Firebase
// ————————————————————————————————————————————
void startFirebaseStream() {
  if (WiFi.status() != WL_CONNECTED) return;

  String urlPath = buildURL("houses/" + houseId + "/devices/" + deviceId + "/command");
//  Serial.print("Streaming GET ");
//  Serial.println(urlPath);

  if (!streamClient.connect(host, 443)) {
    Serial.println("Stream connect failed!");
    streamerConnected = false;
    return;
  }

  // Send HTTP request
  streamClient.printf("GET %s HTTP/1.1\r\n", urlPath.c_str());
  streamClient.printf("Host: %s\r\n", host);
  streamClient.print  ("Accept: text/event-stream\r\n");
  streamClient.print  ("Connection: keep-alive\r\n");
  streamClient.print  ("\r\n");

  // wait for headers end
  while (streamClient.connected()) {
    String line = streamClient.readStringUntil('\n');
    if (line == "\r" || line == "") {
      streamerConnected = true;
      Serial.println(">> Firebase stream opened");
      return;
    }
    // optionally print headers:
    // Serial.print("< "); Serial.println(line);
  }
  streamerConnected = false;
}

// ————————————————————————————————————————————
//  Read and handle events from the SSE stream
// ————————————————————————————————————————————
void handleFirebaseStream() {
  String pendingCmd = "";

  while (streamClient.available()) {
    String line = streamClient.readStringUntil('\n');
    line.trim();
    if (line.startsWith("data: ")) {
      String json = line.substring(6);

      StaticJsonDocument<200> doc;
      if (deserializeJson(doc, json) == DeserializationError::Ok) {
        String cmd = doc["data"].as<const char*>();
        if ((cmd == "ON" || cmd == "OFF") && cmd != lastLightState) {
          pendingCmd = cmd;
          // Stop reading further until after we PUT
          break;
        }
      }
    }
  }

  // If we read something new, close the stream and push the update
  if (pendingCmd.length()) {
    streamClient.stop();
    streamerConnected = false;

    // Physically flip the relay/output
    digitalWrite(LIGHT_PIN, (pendingCmd == "ON") ? LOW : HIGH);
    Serial.println("Light turned " + pendingCmd);

    // Now that the stream is closed, this TLS PUT will succeed
    rtdbPut("houses/" + houseId + "/devices/" + deviceId + "/state", pendingCmd);
    lastLightState = pendingCmd;
  }

  // If the stream dropped on us, mark for reconnect
  if (streamerConnected && !streamClient.connected()) {
    Serial.println("Firebase stream disconnected");
    streamerConnected = false;
    streamClient.stop();
  }
}

// ————————————————————————————————————————————
//  PUT (write) a node to RTDB
// ————————————————————————————————————————————
void rtdbPut(const String& path, const String& value) {
  String url = "https://" + String(host) + "/" + path + ".json?auth=" + String(dbSecret);
//  Serial.println("PUT → " + url + " = " + value);

  BearSSL::WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;
  if (!https.begin(client, url)) {
    Serial.println("HTTPS begin failed");
    return;
  }
  https.setTimeout(15000);  // 15 seconds
  https.addHeader("Content-Type", "application/json");
  int code = https.PUT("\"" + value + "\"");
  https.end();

  if (code == 200 || code == 204) {
    Serial.println("State PUT OK");
  } else {
    Serial.printf("State PUT failed, code: %d\n", code);
  }
}
