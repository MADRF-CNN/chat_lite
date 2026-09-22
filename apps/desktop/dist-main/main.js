"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const tokenPath = () => node_path_1.default.join(electron_1.app.getPath("userData"), "session.bin");
async function createWindow() {
    const win = new electron_1.BrowserWindow({
        width: 1180,
        height: 760,
        minWidth: 900,
        minHeight: 620,
        titleBarStyle: "hiddenInset",
        backgroundColor: "#f4f1ea",
        webPreferences: { preload: node_path_1.default.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    if (!electron_1.app.isPackaged)
        await win.loadURL("http://localhost:5173");
    else
        await win.loadFile(node_path_1.default.join(__dirname, "../dist/index.html"));
}
electron_1.app.whenReady().then(async () => {
    electron_1.ipcMain.handle("session:save", async (_event, token) => {
        await (0, promises_1.mkdir)(node_path_1.default.dirname(tokenPath()), { recursive: true });
        if (!token)
            return (0, promises_1.writeFile)(tokenPath(), Buffer.alloc(0));
        if (!electron_1.safeStorage.isEncryptionAvailable())
            throw new Error("macOS Keychain unavailable");
        return (0, promises_1.writeFile)(tokenPath(), electron_1.safeStorage.encryptString(token));
    });
    electron_1.ipcMain.handle("session:load", async () => {
        try {
            const encrypted = await (0, promises_1.readFile)(tokenPath());
            return encrypted.length && electron_1.safeStorage.isEncryptionAvailable() ? electron_1.safeStorage.decryptString(encrypted) : null;
        }
        catch {
            return null;
        }
    });
    electron_1.ipcMain.handle("file:save", async (_event, options) => {
        const result = await electron_1.dialog.showSaveDialog({ defaultPath: options.name });
        if (!result.canceled && result.filePath)
            await (0, promises_1.writeFile)(result.filePath, Buffer.from(options.bytes));
        return !result.canceled;
    });
    await createWindow();
    electron_1.app.on("activate", () => { if (electron_1.BrowserWindow.getAllWindows().length === 0)
        void createWindow(); });
});
electron_1.app.on("window-all-closed", () => { if (process.platform !== "darwin")
    electron_1.app.quit(); });
