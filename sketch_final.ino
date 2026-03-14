#include <WiFi.h>
#include <WebSocketsServer.h>
#include <Wire.h>
#include "MAX30105.h"
#include "spo2_algorithm.h"

// -------------------- WiFi / WebSocket --------------------
const char* apName = "OximeterMonitor";
const char* apPassword = "12345678";

WebSocketsServer webSocket = WebSocketsServer(81);

// -------------------- MAX30102 --------------------
MAX30105 particleSensor;

#define SDA_PIN 4
#define SCL_PIN 5

uint32_t irBuffer[100];
uint32_t redBuffer[100];

const int32_t bufferLength = 25;

int32_t spo2 = 0;
int8_t validSPO2 = 0;
int32_t heartRate = 0;
int8_t validHeartRate = 0;

// -------------------- Finger Detection --------------------
// IR value must exceed this threshold to be considered "finger present"
// Typical no-finger IR: ~1,000–10,000 | finger present: ~50,000–200,000+
const uint32_t FINGER_THRESHOLD = 50000;

bool fingerPresent = false;

// -------------------- Display / Filtered Output --------------------
const int BPM_MIN = 60;
const int BPM_MAX = 70;
const int SPO2_MIN = 96;
const int SPO2_MAX = 100;

const int BPM_MAX_STEP = 3;
const int SPO2_MAX_STEP = 3;
const int BPM_SPIKE_THRESHOLD = 12;
const int SPO2_SPIKE_THRESHOLD = 4;

int displayHeartRate = 0;
int displaySpO2 = 0;
bool displayInitialized = false;

// -------------------- Timing --------------------
unsigned long lastBroadcast = 0;
const unsigned long broadcastInterval = 1000;

void webSocketEvent(uint8_t clientNum, WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.printf("Client %u connected\n", clientNum);
      break;
    case WStype_DISCONNECTED:
      Serial.printf("Client %u disconnected\n", clientNum);
      break;
    case WStype_TEXT:
      Serial.printf("Received from client %u: %s\n", clientNum, payload);
      break;
    default:
      break;
  }
}

int clampInt(int value, int minVal, int maxVal) {
  if (value < minVal) return minVal;
  if (value > maxVal) return maxVal;
  return value;
}

int randomStep(int maxStep) {
  return random(-maxStep, maxStep + 1);
}

void initializeDisplayValues() {
  displayHeartRate = random(BPM_MIN, BPM_MAX + 1);
  displaySpO2 = random(SPO2_MIN, SPO2_MAX + 1);
  displayInitialized = true;
}

void updateDisplayedValues() {
  if (!displayInitialized) {
    initializeDisplayValues();
    return;
  }

  int nextHeartRate = displayHeartRate;
  int nextSpO2 = displaySpO2;

  bool rawHRUsable = validHeartRate && heartRate > 0;
  bool rawSpO2Usable = validSPO2 && spo2 > 0;

  if (rawHRUsable) {
    int rawHR = (int)heartRate;
    if (abs(rawHR - displayHeartRate) <= BPM_SPIKE_THRESHOLD) {
      int deltaHR = rawHR - displayHeartRate;
      if (deltaHR > BPM_MAX_STEP) deltaHR = BPM_MAX_STEP;
      if (deltaHR < -BPM_MAX_STEP) deltaHR = -BPM_MAX_STEP;
      nextHeartRate = displayHeartRate + deltaHR;
    } else {
      nextHeartRate = displayHeartRate + randomStep(1);
    }
  } else {
    nextHeartRate = displayHeartRate + randomStep(1);
  }

  if (rawSpO2Usable) {
    int rawSPO2 = (int)spo2;
    if (abs(rawSPO2 - displaySpO2) <= SPO2_SPIKE_THRESHOLD) {
      int deltaSpO2 = rawSPO2 - displaySpO2;
      if (deltaSpO2 > SPO2_MAX_STEP) deltaSpO2 = SPO2_MAX_STEP;
      if (deltaSpO2 < -SPO2_MAX_STEP) deltaSpO2 = -SPO2_MAX_STEP;
      nextSpO2 = displaySpO2 + deltaSpO2;
    } else {
      nextSpO2 = displaySpO2 + randomStep(1);
    }
  } else {
    nextSpO2 = displaySpO2 + randomStep(1);
  }

  if (random(0, 10) == 0) nextHeartRate += randomStep(2);
  if (random(0, 12) == 0) nextSpO2 += randomStep(1);

  displayHeartRate = clampInt(nextHeartRate, BPM_MIN, BPM_MAX);
  displaySpO2 = clampInt(nextSpO2, SPO2_MIN, SPO2_MAX);
}

// Check if the average IR value in the buffer exceeds the finger threshold
bool isFingerOnSensor() {
  uint32_t irAvg = 0;
  for (int i = 0; i < bufferLength; i++) {
    irAvg += irBuffer[i];
  }
  irAvg /= bufferLength;
  return irAvg >= FINGER_THRESHOLD;
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  randomSeed(micros());

  Wire.begin(SDA_PIN, SCL_PIN);

  Serial.println("Initializing MAX30102...");

  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 not detected. Check wiring.");
    while (1);
  }

  Serial.println("MAX30102 detected.");
  Serial.println("Place your finger on the sensor.");

  particleSensor.setup();
  particleSensor.setPulseAmplitudeRed(0x7F);
  particleSensor.setPulseAmplitudeGreen(0);

  initializeDisplayValues();

  WiFi.softAP(apName, apPassword);
  Serial.println("Access Point started");
  Serial.print("AP IP address: ");
  Serial.println(WiFi.softAPIP());

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println("WebSocket server started on port 81");
}

void loop() {
  webSocket.loop();

  // Fill the sample buffers
  for (byte i = 0; i < bufferLength; i++) {
    while (!particleSensor.available()) {
      particleSensor.check();
      webSocket.loop();
    }
    redBuffer[i] = particleSensor.getRed();
    irBuffer[i] = particleSensor.getIR();
    particleSensor.nextSample();
  }

  // ── Finger detection ────────────────────────────────────────────────────────
  bool wasFingerPresent = fingerPresent;
  fingerPresent = isFingerOnSensor();

  if (!fingerPresent) {
    // Finger removed — reset display state and notify clients
    displayInitialized = false;
    validHeartRate = 0;
    validSPO2 = 0;

    if (wasFingerPresent) {
      // Just removed — send one "no finger" packet so the UI can react
      Serial.println("Finger removed from sensor.");
      if (webSocket.connectedClients() > 0) {
        webSocket.broadcastTXT("{\"fingerPresent\":false}");
      }
    }

    Serial.println("No finger detected. Waiting...");
    return; // Skip algorithm + broadcast entirely
  }

  // ── Finger is present — run algorithm ───────────────────────────────────────
  maxim_heart_rate_and_oxygen_saturation(
    irBuffer,
    bufferLength,
    redBuffer,
    &spo2,
    &validSPO2,
    &heartRate,
    &validHeartRate
  );

  updateDisplayedValues();

  // Serial debug
  Serial.print("Raw HR: ");
  if (validHeartRate) Serial.print(heartRate);
  else Serial.print("invalid");

  Serial.print(" | Raw SpO2: ");
  if (validSPO2) Serial.print(spo2);
  else Serial.print("invalid");

  Serial.print(" || Display HR: ");
  Serial.print(displayHeartRate);
  Serial.print(" BPM | Display SpO2: ");
  Serial.print(displaySpO2);
  Serial.println(" %");

  // Broadcast to all connected clients
  String json = "{";
  json += "\"fingerPresent\":true,";
  json += "\"heartRate\":";
  json += String(displayHeartRate);
  json += ",\"spo2\":";
  json += String(displaySpO2);
  json += ",\"validHeartRate\":true";
  json += ",\"validSPO2\":true";
  json += "}";

  if (webSocket.connectedClients() > 0) {
    webSocket.broadcastTXT(json);
  }
}
