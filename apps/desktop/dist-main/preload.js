"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("desktop", {
    saveRefreshToken: (token) => electron_1.ipcRenderer.invoke("session:save", token),
    loadRefreshToken: () => electron_1.ipcRenderer.invoke("session:load"),
    saveFile: (name, bytes) => electron_1.ipcRenderer.invoke("file:save", { name, bytes }),
});
