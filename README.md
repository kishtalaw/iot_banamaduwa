# Firebase IOT ESP Project

This repository contains the full stack for a home automation / IoT project that allows you to control ESP32 and ESP8266 devices using an Android app, a Web app, and HTTP `curl` commands, all synchronized through Firebase Realtime Database.

This documentation serves as a runbook and reference guide for setting up the environment, deploying new devices, and managing the applications.

---

## 🏗️ Architecture Overview

The system consists of the following components:
1. **IoT Devices (Arduino/ESP8266/ESP32)**: Devices connect to Wi-Fi and listen to specific paths in the Firebase Realtime Database (RTDB) using Server-Sent Events (SSE). They act on commands (e.g., `ON`, `OFF`) and report their state back. Supported features include OTA (Over-The-Air) updates.
2. **Firebase Cloud Functions**: Acts as a secure HTTP API layer. It handles external `curl` requests, verifies API keys using Google Cloud Secret Manager, checks user authorization, writes commands to the RTDB, logs actions, and handles scheduled cleanups/resets (e.g., auto-closing a gate).
3. **Android App (Flutter)**: A mobile interface for users to log in (via Google Auth), view their allowed devices, and send commands.
4. **Web App**: A lightweight web interface built with vanilla JS and Tailwind CSS for controlling devices from a browser.

---

## 🚀 1. Adding a New IoT Device (ESP8266 / ESP32)

To deploy a new device, you will need to upload the Arduino C++ code to your ESP board.

### Prerequisites
- Install the **Arduino IDE**.
- Install the **ESP8266** or **ESP32** board manager in Arduino IDE (`File > Preferences > Additional Boards Manager URLs`).
- Install the following Arduino libraries (via `Sketch > Include Library > Manage Libraries`):
  - `Firebase Arduino Client Library for ESP8266 and ESP32` by Mobizt
  - `ArduinoOTA` (usually included with board manager)

### Configuration Steps
1. Navigate to the `Arduino/` directory and open one of the template sketches (e.g., `esp8266_firebase_OTA_SSE_fan_light.ino`).
2. Update the following configuration variables at the top of the file:
   ```cpp
   // Wi-Fi credentials
   const char* ssid = "YOUR_WIFI_SSID";
   const char* pass = "YOUR_WIFI_PASSWORD";

   // Firebase Configuration
   const String deviceName = "YOUR_DEVICE_NAME"; // e.g., "fan_light"
   const String basePath  = "/houses/YOUR_HOUSE_ID/devices/" + deviceName;

   // In setup():
   config.host = "home-automation-460908-default-rtdb.firebaseio.com";
   config.signer.tokens.legacy_token = "YOUR_FIREBASE_LEGACY_TOKEN"; // Found in Firebase Console -> Project Settings -> Service Accounts -> Database Secrets
   ```
3. Set your specific pin mappings (e.g., `const int LIGHT_PIN = 0;`).
4. Select your board and COM port in the Arduino IDE, and click **Upload**.
5. Once uploaded, the device will connect to Wi-Fi and begin streaming data from Firebase. Future updates can be pushed wirelessly using Arduino OTA by selecting the device's IP/Hostname in the Ports menu (Password: `cast123` by default).

---

## ☁️ 2. Firebase & Cloud Functions Setup

The backend logic is powered by Firebase Functions (Node.js).

### Prerequisites
- Install [Node.js](https://nodejs.org/) (Engine set to v22).
- Install Firebase CLI: `npm install -g firebase-tools`
- Run `firebase login` to authenticate.

### Deployment
1. Navigate to the `functions/` directory:
   ```bash
   cd functions
   npm install
   ```
2. **Secret Manager**: The API endpoint uses Google Cloud Secret Manager to protect the HTTP endpoint.
   - Go to Google Cloud Console > Secret Manager.
   - Create a secret named `SECRETS_API_KEY`.
   - Ensure the Firebase Functions service account has `Secret Manager Secret Accessor` role.
3. **Cloud Tasks**: The system uses Cloud Tasks for delayed actions (like auto-closing a gate). Ensure you have a queue named `gate-reset-queue` in `us-central1`.
4. Deploy the functions:
   ```bash
   firebase deploy --only functions
   ```

---

## 📱 3. Android App Setup (Flutter)

The mobile application is built using Flutter.

### Prerequisites
- Install [Flutter SDK](https://flutter.dev/docs/get-started/install).
- Install Android Studio and set up an Android Emulator or physical device.

### Build and Run
1. Navigate to the app directory:
   ```bash
   cd androidapp/banamaduwaapp
   ```
2. Get dependencies:
   ```bash
   flutter pub get
   ```
3. Ensure your `google-services.json` (for Android) or `GoogleService-Info.plist` (for iOS) is placed in the correct directories as provided by the Firebase Console.
4. Run the app:
   ```bash
   flutter run
   ```

---

## 🌐 4. Web App Setup

The web application is a static site utilizing Tailwind CSS and Firebase Web SDK.

### Prerequisites
- Node.js installed.

### Build and Run
1. Navigate to the web app directory:
   ```bash
   cd webapp
   npm install
   ```
2. Build Tailwind CSS:
   ```bash
   npm run tw:build
   ```
3. Update `webapp/src/firebaseConfig.js` (or similar) with your Firebase project config keys.
4. Host the `public/` folder using Firebase Hosting or any static web server:
   ```bash
   firebase deploy --only hosting
   ```

---

## 🔌 5. Controlling Devices via API (cURL)

You can trigger devices externally (e.g., from a smart home hub, a webhook, or a script) by calling the `hello` cloud function.

### HTTP POST Request
**Endpoint:** `https://us-central1-home-automation-460908.cloudfunctions.net/hello`

**Headers:**
- `Content-Type: application/json`
- `x-api-key: YOUR_SECRET_API_KEY` (Must match the value in Google Cloud Secret Manager)

**Payload:**
```json
{
  "uid": "YOUR_FIREBASE_USER_ID",
  "houseId": "house123",
  "deviceId": "fan_light",
  "command": "ON"
}
```
*(Valid commands: "OPEN", "CLOSE", "STOP", "ON", "OFF")*

**Example cURL command:**
```bash
curl -X POST https://us-central1-home-automation-460908.cloudfunctions.net/hello \
     -H "Content-Type: application/json" \
     -H "x-api-key: YOUR_SECRET_API_KEY" \
     -d '{"uid": "admin123", "houseId": "house123", "deviceId": "fan_light", "command": "ON"}'
```

### Access Control Note
The HTTP endpoint verifies that the `uid` has explicit access to the device under the Firebase RTDB path `user_access/{uid}/{deviceId}/{houseId}` before allowing the command.
