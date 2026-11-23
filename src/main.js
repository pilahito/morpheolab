// PatchLab — parchea APKs con Morphe y pruébalas en el móvil, desde el PC.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const BASE = path.join(__dirname, "..");
const BIN = path.join(BASE, "bin");
const JAR = path.join(BIN, "morphe-desktop.jar");
const MPP_OFICIAL = path.join(BIN, "patches.mpp");
const BUNDLES_DIR = path.join(BASE, "bundles");
const SALIDA = path.join(BASE, "salida");
const ESTADO = path.join(BASE, "estado.json");
fs.mkdirSync(BUNDLES_DIR, { recursive: true });
fs.mkdirSync(SALIDA, { recursive: true });

const procesos = new Map();
let ventana = null;
const enviar = (canal, datos) => { if (ventana && !ventana.isDestroyed()) ventana.webContents.send(canal, datos); };

function leerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO, "utf8")); } catch { return { bundles: [], apk: "", dispositivo: "" }; }
}
function guardarEstado(e) { fs.writeFileSync(ESTADO, JSON.stringify(e, null, 2)); }

function descargar(url, destino) {
  return new Promise((resolve, reject) => {
    const f = fs.createWriteStream(destino);
    https.get(url, { headers: { "user-agent": "PatchLab" } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        f.close(() => fs.rmSync(destino, { force: true }));
        return descargar(r.headers.location, destino).then(resolve, reject);
      }
      if (r.statusCode !== 200) { f.close(); fs.rmSync(destino, { force: true }); return reject(new Error("HTTP " + r.statusCode)); }
      r.pipe(f);
      f.on("finish", () => f.close(() => resolve(destino)));
    }).on("error", (e) => { f.close(); fs.rmSync(destino, { force: true }); reject(e); });
  });
}
function json(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "user-agent": "PatchLab", accept: "application/json" } }, (r) => {
      let d = "";
      r.on("data", (t) => (d += t));
      r.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

// Ejecuta un comando y va mandando su salida al renderer.
function ejecutar(id, comando, args, opciones = {}) {
  return new Promise((resolve) => {
    const p = spawn(comando, args, { cwd: BASE, ...opciones });
    procesos.set(id, p);
    p.stdout.on("data", (d) => enviar("log", { id, texto: d.toString() }));
    p.stderr.on("data", (d) => enviar("log", { id, texto: d.toString() }));
    p.on("close", (codigo) => { procesos.delete(id); resolve({ codigo }); });
    p.on("error", (e) => { procesos.delete(id); resolve({ codigo: -1, error: e.message }); });
  });
}

ipcMain.handle("estado", async () => {
  const st = leerEstado();
  const java = await ejecutar("check-java", "java", ["-version"]).then((r) => r.codigo === 0);
  const adb = await ejecutar("check-adb", "adb", ["version"]).then((r) => r.codigo === 0);
  const disp = await ejecutar("check-dev", "adb", ["devices", "-l"]).then((r) => r.codigo === 0);
  const salida = await new Promise((res) => {
    const p = spawn("adb", ["devices", "-l"]);
    let d = ""; p.stdout.on("data", (t) => (d += t)); p.on("close", () => res(d));
  });
  const dispositivos = salida.split("\n").slice(1).filter((l) => l.trim()).map((l) => l.trim());
  return {
    java, adb, jar: fs.existsSync(JAR), patchesOficial: fs.existsSync(MPP_OFICIAL),
    bundles: st.bundles || [], apk: st.apk || "", dispositivos,
    salida: SALIDA, version: app.getVersion(),
  };
});

ipcMain.handle("elegir-apk", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "APK", extensions: ["apk", "apkm", "xapk", "apks"] }] });
  if (r.canceled) return null;
  const st = leerEstado(); st.apk = r.filePaths[0]; guardarEstado(st);
  return st.apk;
});

// Descarga una imagen remota y la devuelve como data URL (para mostrarla con CSP estricta).
const CACHE_IMG = path.join(BASE, "cache-imagenes");
fs.mkdirSync(CACHE_IMG, { recursive: true });
function imagenComoDataUrl(url) {
  return new Promise((resolve) => {
    if (!/^https?:\/\//.test(url)) return resolve(null);
    const clave = require("node:crypto").createHash("sha1").update(url).digest("hex");
    const f = path.join(CACHE_IMG, clave);
    if (fs.existsSync(f)) {
      const tipo = url.endsWith(".svg") ? "image/svg+xml" : url.endsWith(".jpg") || url.endsWith(".jpeg") ? "image/jpeg" : "image/png";
      return resolve(`data:${tipo};base64,${fs.readFileSync(f).toString("base64")}`);
    }
    https.get(url, { headers: { "user-agent": "MorpheoLab" } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        return imagenComoDataUrl(r.headers.location).then(resolve);
      }
      if (r.statusCode !== 200) { r.resume(); return resolve(null); }
      const trozos = [];
      r.on("data", (d) => trozos.push(d));
      r.on("end", () => {
        const datos = Buffer.concat(trozos);
        if (datos.length > 3 * 1024 * 1024) return resolve(null);
        fs.writeFileSync(f, datos);
        const tipo = r.headers["content-type"] || "image/png";
        resolve(`data:${tipo.split(";")[0]};base64,${datos.toString("base64")}`);
      });
    }).on("error", () => resolve(null));
  });
}
ipcMain.handle("imagen", async (_e, url) => imagenComoDataUrl(url));

ipcMain.handle("catalogo", async () => {
  const d = await json("https://morphe-patches.software/data/bundles.json");
  return d.bundles || [];
});

ipcMain.handle("descargar-bundle", async (_e, repo) => {
  // busca el .mpp de la última release del repo
  const rel = await json(`https://api.github.com/repos/${repo}/releases/latest`);
  const asset = (rel.assets || []).find((a) => a.name.endsWith(".mpp"));
  if (!asset) throw new Error("ese repo no publica .mpp en la última release");
  const destino = path.join(BUNDLES_DIR, `${repo.replace("/", "__")}.mpp`);
  enviar("log", { id: "descarga", texto: `Descargando ${asset.name} (${(asset.size / 1e6).toFixed(1)} MB)…\n` });
  await descargar(asset.browser_download_url, destino);
  const st = leerEstado();
  st.bundles = [...new Set([...(st.bundles || []), destino])];
  guardarEstado(st);
  return destino;
});

ipcMain.handle("listar-parches", async (_e, mpps) => {
  const args = ["-jar", JAR, "list-patches"];
  for (const m of mpps) args.push("-p", m);
  const p = spawn("java", args, { cwd: BASE });
  let salida = "";
  p.stdout.on("data", (d) => { salida += d; enviar("log", { id: "listar", texto: d.toString() }); });
  p.stderr.on("data", (d) => { salida += d; enviar("log", { id: "listar", texto: d.toString() }); });
  await new Promise((r) => p.on("close", r));
  return salida;
});

ipcMain.handle("parchear", async (_e, { apk, mpps, incluir, excluir, unsigned }) => {
  const id = "parchear";
  const nombre = path.basename(apk).replace(/\.(apk|apkm|xapk|apks)$/i, "");
  const salidaApk = path.join(SALIDA, `${nombre}-parcheado.apk`);
  const args = ["-jar", JAR, "patch", "-p", mpps[0], "-o", salidaApk];
  for (const m of mpps.slice(1)) args.push("-p", m);
  for (const n of incluir || []) args.push("-e", n);
  for (const n of excluir || []) args.push("-d", n);
  if (unsigned) args.push("--unsigned");
  args.push(apk);
  enviar("log", { id, texto: `$ java -jar morphe-desktop.jar patch … ${path.basename(apk)}\n` });
  const r = await ejecutar(id, "java", args);
  if (r.codigo !== 0) return { ok: false, error: `morphe salió con código ${r.codigo}` };
  if (!fs.existsSync(salidaApk)) return { ok: false, error: "no se generó el APK de salida" };
  const st = leerEstado(); st.ultimoApk = salidaApk; guardarEstado(st);
  return { ok: true, salida: salidaApk, tamano: fs.statSync(salidaApk).size };
});

ipcMain.handle("instalar", async (_e, { apk, dispositivo }) => {
  const id = "instalar";
  const antes = await paquetes(dispositivo);
  const args = ["-s", dispositivo, "install", "-r", apk];
  enviar("log", { id, texto: `$ adb install -r ${path.basename(apk)}\n` });
  const r = await ejecutar(id, "adb", args);
  if (r.codigo !== 0) return { ok: false, error: "adb install falló (mira el log)" };
  const despues = await paquetes(dispositivo);
  const nuevo = [...despues].find((p) => !antes.has(p)) || "";
  return { ok: true, paquete: nuevo };
});

async function paquetes(dispositivo) {
  const p = spawn("adb", ["-s", dispositivo, "shell", "pm", "list", "packages", "-3"]);
  let d = ""; p.stdout.on("data", (t) => (d += t));
  await new Promise((r) => p.on("close", r));
  return new Set(d.split("\n").map((l) => l.replace(/^package:/, "").trim()).filter(Boolean));
}

ipcMain.handle("lanzar", async (_e, { paquete, dispositivo }) => {
  const r = await ejecutar("lanzar", "adb", ["-s", dispositivo, "shell", "monkey", "-p", paquete, "-c", "android.intent.category.LAUNCHER", "1"]);
  return { ok: r.codigo === 0 };
});

ipcMain.handle("captura", async (_e, dispositivo) => {
  const destino = path.join(SALIDA, `captura-${Date.now()}.png`);
  const p = spawn("adb", ["-s", dispositivo, "exec-out", "screencap", "-p"]);
  const f = fs.createWriteStream(destino);
  p.stdout.pipe(f);
  await new Promise((r) => p.on("close", r));
  return { ruta: destino, base64: fs.readFileSync(destino).toString("base64") };
});

ipcMain.handle("logcat", async (_e, { dispositivo, paquete }) => {
  const p = spawn("adb", ["-s", dispositivo, "logcat", "-d", "-t", "300"]);
  let d = ""; p.stdout.on("data", (t) => (d += t));
  await new Promise((r) => p.on("close", r));
  const lineas = d.split("\n");
  const crasheos = lineas.filter((l) => /FATAL EXCEPTION|AndroidRuntime.*(FATAL|Shutting down)/i.test(l)).length;
  return { texto: lineas.slice(-200).join("\n"), crasheos };
});

// Traducción de descripciones de parches (mismo motor local que las notificaciones).
const CACHE_TRAD = path.join(BASE, "cache-traducciones.json");
function leerCacheTrad() { try { return JSON.parse(fs.readFileSync(CACHE_TRAD, "utf8")); } catch { return {}; } }
function guardarCacheTrad(d) { try { fs.writeFileSync(CACHE_TRAD, JSON.stringify(d)); } catch {} }

ipcMain.handle("traducir", async (_e, textos) => {
  const cache = leerCacheTrad();
  const salida = [];
  for (const original of textos) {
    const limpio = String(original || "").trim();
    if (!limpio) { salida.push(original); continue; }
    if (cache[limpio]) { salida.push(cache[limpio]); continue; }
    if (!/[a-zA-Z]{3,}/.test(limpio)) { salida.push(original); continue; }
    try {
      const p = spawn("/usr/local/bin/traducir-notif", [JSON.stringify({ s: limpio, b: "" })]);
      let d = "";
      p.stdout.on("data", (x) => (d += x));
      await new Promise((r) => p.on("close", r));
      const trad = (JSON.parse(d || "{}").s || "").trim();
      if (trad) cache[limpio] = trad;
      salida.push(trad || original);
    } catch { salida.push(original); }
  }
  guardarCacheTrad(cache);
  return salida;
});


// ── conseguir el APK que falta (legal): del móvil o de F-Droid ──────────────
const APKS_DIR = path.join(BASE, "apks");
fs.mkdirSync(APKS_DIR, { recursive: true });

ipcMain.handle("apps-instaladas", async (_e, dispositivo) => {
  const p = spawn("adb", ["-s", dispositivo, "shell", "pm", "list", "packages", "-3", "-f"]);
  let d = "";
  p.stdout.on("data", (x) => (d += x));
  await new Promise((r) => p.on("close", r));
  return d.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("package:"))
    .map((l) => {
      const [ruta, paquete] = l.replace(/^package:/, "").split("=");
      return { paquete, ruta };
    })
    .sort((a, b) => a.paquete.localeCompare(b.paquete));
});

ipcMain.handle("extraer-apk", async (_e, { dispositivo, paquete }) => {
  const salida = [];
  const p = spawn("adb", ["-s", dispositivo, "shell", "pm", "path", paquete]);
  let d = "";
  p.stdout.on("data", (x) => (d += x));
  await new Promise((r) => p.on("close", r));
  const rutas = d.split("\n").map((l) => l.replace(/^package:/, "").trim()).filter(Boolean);
  if (!rutas.length) return { ok: false, error: "el paquete no está instalado o no se puede leer" };
  const carpeta = path.join(APKS_DIR, paquete);
  fs.mkdirSync(carpeta, { recursive: true });
  for (const ruta of rutas) {
    const destino = path.join(carpeta, path.basename(ruta));
    const r = await ejecutar("extraer", "adb", ["-s", dispositivo, "pull", ruta, destino]);
    if (r.codigo === 0 && fs.existsSync(destino)) salida.push(destino);
  }
  if (!salida.length) return { ok: false, error: "no se pudo extraer" };
  return { ok: true, ruta: salida[0], splits: salida.slice(1), carpeta };
});

// F-Droid: apps libres, descarga legítima.
function ficheroJson(url) { return json(url); }

ipcMain.handle("fdroid-descargar", async (_e, paquete) => {
  const info = await ficheroJson(`https://f-droid.org/api/v1/packages/${encodeURIComponent(paquete)}`);
  const ver = info?.suggestedVersionCode;
  if (!ver) throw new Error("F-Droid no conoce ese paquete");
  const destino = path.join(APKS_DIR, `${paquete}_${ver}.apk`);
  enviar("log", { id: "descarga-apk", texto: `Descargando ${paquete} ${info.suggestedVersionName || ver} de F-Droid…\n` });
  await descargar(`https://f-droid.org/repo/${paquete}_${ver}.apk`, destino);
  const st = leerEstado(); st.apk = destino; guardarEstado(st);
  return { ok: true, ruta: destino, version: info.suggestedVersionName || String(ver) };
});

ipcMain.handle("abrir-carpeta", (_e, ruta) => shell.openPath(ruta));
ipcMain.handle("detener", (_e, id) => { const p = procesos.get(id); if (p) p.kill("SIGTERM"); });

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1280, height: 860, title: "PatchLab",
    backgroundColor: "#0b0f19",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  ventana.loadFile(path.join(__dirname, "renderer", "index.html"));
}


// Menú en español (el de Electron viene en inglés).
function menuEspanol() {
  const abrir = (url) => () => shell.openExternal(url);
  return Menu.buildFromTemplate([
    { label: "Archivo", submenu: [{ role: "quit", label: "Salir" }] },
    {
      label: "Edición",
      submenu: [
        { role: "undo", label: "Deshacer" },
        { role: "redo", label: "Rehacer" },
        { type: "separator" },
        { role: "cut", label: "Cortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Pegar" },
        { role: "selectAll", label: "Seleccionar todo" },
      ],
    },
    {
      label: "Ver",
      submenu: [
        { role: "reload", label: "Recargar" },
        { role: "toggleDevTools", label: "Herramientas de desarrollo" },
        { type: "separator" },
        { role: "resetZoom", label: "Tamaño normal" },
        { role: "zoomIn", label: "Acercar" },
        { role: "zoomOut", label: "Alejar" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Pantalla completa" },
      ],
    },
    {
      label: "Ventana",
      submenu: [
        { role: "minimize", label: "Minimizar" },
        { role: "close", label: "Cerrar" },
      ],
    },
    {
      label: "Ayuda",
      submenu: [
        { label: "Índice de parches de Morphe", click: abrir("https://morphe-patches.software/") },
        { label: "Morphe Desktop (GitHub)", click: abrir("https://github.com/MorpheApp/morphe-desktop") },
        {
          label: "Acerca de MorpheoLab",
          click: () => dialog.showMessageBox(ventana, {
            type: "info",
            title: "Acerca de MorpheoLab",
            message: "MorpheoLab 0.1.0",
            detail: "Parchea APKs con Morphe y pruébalas en el móvil desde el PC.\n" +
              "Código propio (MIT). Morphe Desktop es software de terceros.\n" +
              "No publiques APKs parcheados: son software propietario modificado.",
            buttons: ["Vale"],
          }),
        },
      ],
    },
  ]);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(menuEspanol());
  crearVentana(); app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) crearVentana(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
