const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("patchlab", {
  estado: () => ipcRenderer.invoke("estado"),
  elegirApk: () => ipcRenderer.invoke("elegir-apk"),
  catalogo: () => ipcRenderer.invoke("catalogo"),
  imagen: (url) => ipcRenderer.invoke("imagen", url),
  descargarBundle: (repo) => ipcRenderer.invoke("descargar-bundle", repo),
  listarParches: (mpps) => ipcRenderer.invoke("listar-parches", mpps),
  parchear: (datos) => ipcRenderer.invoke("parchear", datos),
  instalar: (datos) => ipcRenderer.invoke("instalar", datos),
  lanzar: (datos) => ipcRenderer.invoke("lanzar", datos),
  captura: (disp) => ipcRenderer.invoke("captura", disp),
  logcat: (datos) => ipcRenderer.invoke("logcat", datos),
  traducir: (textos) => ipcRenderer.invoke("traducir", textos),
  abrirCarpeta: (r) => ipcRenderer.invoke("abrir-carpeta", r),
  detener: (id) => ipcRenderer.invoke("detener", id),
  onLog: (cb) => ipcRenderer.on("log", (_e, d) => cb(d)),
});
