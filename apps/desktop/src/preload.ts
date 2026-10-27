import { contextBridge, ipcRenderer } from "electron";
// Fixed-purpose bridge; no generic IPC, filesystem or provider credential access.
contextBridge.exposeInMainWorld("harness", {
  connection: () => ipcRenderer.invoke("harness:connection"),
  cancelNotifications: () => ipcRenderer.invoke("harness:notifications-cancel"),
  notify: (session: string) => ipcRenderer.invoke("harness:notify", session),
  testNotification: () => ipcRenderer.invoke("harness:notification-test"),
  onActivity: (callback: (id: number | null) => void) => {
    const listener = (_event: unknown, id: number | null) => callback(id);
    ipcRenderer.on("harness:activity-open", listener);
    return () => ipcRenderer.removeListener("harness:activity-open", listener);
  },
  onNotificationStatus: (callback: (status: string) => void) => {
    const listener = (_event: unknown, status: string) => callback(status);
    ipcRenderer.on("harness:notification-status", listener);
    return () =>
      ipcRenderer.removeListener("harness:notification-status", listener);
  },
});
