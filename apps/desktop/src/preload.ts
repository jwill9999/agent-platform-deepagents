import { contextBridge, ipcRenderer } from "electron";
// Fixed-purpose bridge; no generic IPC, filesystem or provider credential access.
contextBridge.exposeInMainWorld("harness", {
  connection: () => ipcRenderer.invoke("harness:connection"),
});
