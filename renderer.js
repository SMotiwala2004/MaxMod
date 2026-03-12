/**
 * This file is loaded via the <script> tag in the index.html file and will
 * be executed in the renderer process for that window. No Node.js APIs are
 * available in this process because `nodeIntegration` is turned off and
 * `contextIsolation` is turned on. Use the contextBridge API in `preload.js`
 * to expose Node.js functionality from the main process.
 */

const heartRate = document.getElementById("heartRate");
const spo2 = document.getElementById("spo2");

function updateVitals() {
  const hr = Math.floor(Math.random() * 25) + 70;
  const oxygen = Math.floor(Math.random() * 4) + 95;

  heartRate.textContent = `${hr} BPM`;
  spo2.textContent = `${oxygen} %`;
}

updateVitals();
setInterval(updateVitals, 1000);