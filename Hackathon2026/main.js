const { app, BrowserWindow } = require("electron");
const path = require("path");
const WebSocket = require("ws");

let mainWindow;
let socket;

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile("index.html");
}

function connectToESP32() {
  console.log("Starting WebSocket client...");

  socket = new WebSocket("ws://192.168.4.1:81/");

  socket.on("open", () => {
    console.log("Connected to ESP32");

    if (mainWindow) {
      mainWindow.webContents.send("socket-status", {
        connected: true,
        message: "Connected to ESP32"
      });
    }
  });

  socket.on("message", (data) => {
    try {
      const json = JSON.parse(data.toString());
      console.log("Received:", json);

      if (mainWindow) {
        mainWindow.webContents.send("vitals-data", json);
      }
    } catch (err) {
      console.log("Raw message:", data.toString());
      console.log("JSON parse error:", err.message);
    }
  });

  socket.on("error", (err) => {
    console.log("Connection error:", err.message);

    if (mainWindow) {
      mainWindow.webContents.send("socket-status", {
        connected: false,
        message: `Connection error: ${err.message}`
      });
    }
  });

  socket.on("close", () => {
    console.log("Connection closed");

    if (mainWindow) {
      mainWindow.webContents.send("socket-status", {
        connected: false,
        message: "Connection closed"
      });
    }

    setTimeout(connectToESP32, 3000);
  });
}

app.whenReady().then(() => {
  createWindow();
  connectToESP32();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});