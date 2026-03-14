const heartRateEl = document.getElementById("heartRate");
const spo2El = document.getElementById("spo2");
const piEl = document.getElementById("pi");
const motionEl = document.getElementById("motion");
const batteryEl = document.getElementById("battery");
const lastUpdatedEl = document.getElementById("lastUpdated");
const triageEl = document.getElementById("triageStatus");
const alertBannerEl = document.getElementById("alertBanner");
const mainPatientNameEl = document.getElementById("mainPatientName");
const patientButtons = document.querySelectorAll(".patient-item");

// ─── Patient State ────────────────────────────────────────────────────────────

const patients = {
  A: { name: "BoyA Cyril", battery: 100, mode: "normal", live: true },
  B: { name: "BoyA Nethen", battery: 87,  mode: "critical" },
  C: { name: "BoyA Safeer", battery: 74,  mode: "normal" },
  D: { name: "BoyA Anas", battery: 91,  mode: "warning" },
  E: { name: "GirlA Julie", battery: 91, mode: "normal", live: true}
};

let selectedPatient = "A";

// ─── ESP32 WebSocket (Patient A) ──────────────────────────────────────────────

const ESP32_WS_URL = "ws://192.168.4.1:81/";
let ws = null;
let wsConnected = false;
let liveVitals = null;
let lastVitalsTime = 0;

function connectWebSocket() {
  if (ws) ws.close();

  ws = new WebSocket(ESP32_WS_URL);

  ws.onopen = () => {
    wsConnected = true;
    console.log("[WS] Connected to ESP32-C3 at", ESP32_WS_URL);
  };

  ws.onmessage = (event) => {
    wsConnected = true;
    try {
      const data = JSON.parse(event.data);

      // Reject invalid sensor flags
      if (data.validHeartRate === false || data.validSPO2 === false) return;

      // Reject zero or missing values
      if (!data.heartRate || !data.spo2) return;

      // Reject readings outside realistic human ranges
      if (data.heartRate < 40 || data.heartRate > 200) return;
      if (data.spo2 < 50 || data.spo2 > 100) return;

      // Only stamp time after passing all guards
      lastVitalsTime = Date.now();

      liveVitals = {
        hr:      Math.round(data.heartRate ?? data.hr ?? 0),
        spo2:    Math.round(data.spo2 ?? 0),
        pi:      parseFloat((data.pi ?? 9.0).toFixed(1)),
        battery: Math.round(data.battery ?? patients.A.battery),
        motion:  data.motion ?? "Stable"
      };

      patients.A.battery = liveVitals.battery;

      const triage = getTriage(liveVitals.hr, liveVitals.spo2, liveVitals.pi);
      patients.A.mode = triage === "red" ? "critical" : triage === "yellow" ? "warning" : "normal";
      patients.A.latest = liveVitals;

      // Always update Patient A's sidebar badge
      const buttonA = document.querySelector('.patient-item[data-patient="A"]');
      if (buttonA) updateSidebarBadge(buttonA, triage);

      // Update main card only if Patient A is selected
      if (selectedPatient === "A") {
        mainPatientNameEl.textContent = patients.A.name;
        updateMainCard(liveVitals.hr, liveVitals.spo2, liveVitals.pi, liveVitals.motion, liveVitals.battery);
      }

    } catch (err) {
      console.error("[WS] Failed to parse message:", event.data, err);
    }
  };

  ws.onerror = (err) => {
    console.warn("[WS] WebSocket error:", err);
    wsConnected = false;
  };

  ws.onclose = () => {
    wsConnected = false;
    console.warn("[WS] Connection closed. Retrying in 3s…");
    setTimeout(connectWebSocket, 3000);
  };
}

connectWebSocket();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime() {
  return new Date().toLocaleTimeString();
}

function getTriage(hr, spo2, pi) {
  const piVal = (pi == null || pi === 0) ? 5 : pi;
  if (spo2 <= 90 || hr >= 160 || hr <= 30 || piVal < 1) return "red";
  if (spo2 <= 94 || hr >= 130 || hr <= 50 || piVal <= 7) return "yellow";
  return "green";
}

// ─── Main Card Renderer ───────────────────────────────────────────────────────

function updateMainCard(hr, spo2, pi, motion, batteryLevel) {
  heartRateEl.innerHTML  = `${hr} <span>BPM</span>`;
  spo2El.innerHTML       = `${spo2} <span>%</span>`;
  piEl.innerHTML         = `${pi} <span>%</span>`;
  motionEl.textContent   = motion;
  batteryEl.textContent  = `${batteryLevel}%`;
  lastUpdatedEl.textContent = formatTime();

  const triage = getTriage(hr, spo2, pi);

  triageEl.className = "triage-badge";
  alertBannerEl.className = "alert-banner";

  if (triage === "red") {
    triageEl.classList.add("triage-red");
    triageEl.textContent      = "RED - IMMEDIATE";
    alertBannerEl.classList.add("alert-critical");
    alertBannerEl.textContent = "Critical alert: Responder attention needed NOW!";
  } else if (triage === "yellow") {
    triageEl.classList.add("triage-yellow");
    triageEl.textContent      = "YELLOW - MODERATE";
    alertBannerEl.classList.add("alert-moderate");
    alertBannerEl.textContent = "Warning: Patient vitals need closer monitoring.";
  } else {
    triageEl.classList.add("triage-green");
    triageEl.textContent      = "GREEN - MINOR";
    alertBannerEl.classList.add("alert-good");
    alertBannerEl.textContent = "No active critical alerts.";
  }
}

// ─── Fake-data Generator (Patients B, C, D) ───────────────────────────────────

function rnd(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateFakeVitals(patientKey) {
  let hr, spo2, pi, motion;

  switch (patientKey) {
    case "B": // Critical / RED
      hr     = rnd(160, 175);
      spo2   = rnd(85, 90);
      pi     = parseFloat((Math.random() * 0.8).toFixed(1));
      motion = Math.random() > 0.5 ? "Movement detected" : "Unstable";
      break;

    case "C": // Good / GREEN
      hr     = rnd(65, 90);
      spo2   = rnd(97, 100);
      pi     = parseFloat((Math.random() * 3 + 7).toFixed(1));
      motion = Math.random() > 0.85 ? "Movement detected" : "Stable";
      break;

    case "D": // Moderate / YELLOW
      hr     = rnd(110, 125);
      spo2   = rnd(91, 94);
      pi     = parseFloat((Math.random() * 5 + 2).toFixed(1));
      motion = Math.random() > 0.7 ? "Movement detected" : "Stable";
      break;

    default:
      hr = 70; spo2 = 98; pi = 5; motion = "Stable";
  }

  return { hr, spo2, pi, motion };
}

// ─── Sidebar Badge ────────────────────────────────────────────────────────────

function updateSidebarBadge(button, triage) {
  const badge = button.querySelector(".mini-triage");
  badge.className = "mini-triage";

  if (triage === "red") {
    badge.classList.add("triage-red-lite");
    badge.textContent = "RED";
  } else if (triage === "yellow") {
    badge.classList.add("triage-yellow-lite");
    badge.textContent = "YELLOW";
  } else {
    badge.classList.add("triage-green-lite");
    badge.textContent = "GREEN";
  }
}

// ─── Tick (every 500ms) ───────────────────────────────────────────────────────

function tickAllPatients() {
  patientButtons.forEach((button) => {
    const key     = button.dataset.patient;
    const patient = patients[key];

    // ── Patient A: driven by WebSocket ──────────────────────────────────────
    if (key === "A" || key === "E") {
      patient.battery = Math.max(0, patient.battery - 0.01);

      // Reset liveVitals if no valid packet in last 3 seconds
      const stale = lastVitalsTime > 0 && (Date.now() - lastVitalsTime > 3000);
      if (stale) liveVitals = null;

      if (!wsConnected || liveVitals === null) {
        const badge = button.querySelector(".mini-triage");
        badge.className   = "mini-triage";
        badge.textContent = "—";

        if (selectedPatient === "A") {
          mainPatientNameEl.textContent = patient.name;
          heartRateEl.innerHTML         = `-- <span>BPM</span>`;
          spo2El.innerHTML              = `-- <span>%</span>`;
          piEl.innerHTML                = `-- <span>%</span>`;
          motionEl.textContent          = "Sensor not detecting...";
          batteryEl.textContent         = `${Math.floor(patient.battery)}%`;
          lastUpdatedEl.textContent     = formatTime();
          triageEl.className            = "triage-badge";
          triageEl.textContent          = "NO SIGNAL";
          alertBannerEl.className       = "alert-banner";
          alertBannerEl.textContent     = "Sensor not detecting...";
        }
      }
      return;
    }

    // ── Patients B / C / D: fake data ───────────────────────────────────────
    patient.battery = Math.max(20, patient.battery - 0.05);

    const vitals = generateFakeVitals(key);
    patient.latest = vitals;

    const triage = getTriage(vitals.hr, vitals.spo2, vitals.pi);
    updateSidebarBadge(button, triage);

    if (key === selectedPatient) {
      mainPatientNameEl.textContent = patient.name;
      updateMainCard(vitals.hr, vitals.spo2, vitals.pi, vitals.motion, Math.floor(patient.battery));
    }
  });
}

// ─── Patient Selection Clicks ─────────────────────────────────────────────────

patientButtons.forEach((button) => {
  button.addEventListener("click", () => {
    patientButtons.forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    selectedPatient = button.dataset.patient;

    const patient = patients[selectedPatient];
    mainPatientNameEl.textContent = patient.name;

    if (selectedPatient === "A") {
      if (liveVitals) {
        updateMainCard(liveVitals.hr, liveVitals.spo2, liveVitals.pi, liveVitals.motion, Math.floor(patient.battery));
      }
    } else if (patient.latest) {
      updateMainCard(patient.latest.hr, patient.latest.spo2, patient.latest.pi, patient.latest.motion, Math.floor(patient.battery));
    }
  });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

tickAllPatients();
setInterval(tickAllPatients, 500);