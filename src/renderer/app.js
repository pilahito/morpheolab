const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let repos = [];
let apk = "";
let bundles = [];
let dispositivos = [];
let ultimoApk = "";
let paquete = "";

// pestañas
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("activa", x === b));
  document.querySelectorAll(".vista").forEach((v) => v.classList.toggle("oculta", v.id !== "v-" + b.dataset.vista));
}));

function log(id, texto) {
  const c = id === "parchear" || id === "listar" ? $("#consola-parchear")
    : id === "instalar" || id === "lanzar" || id === "logcat" ? $("#consola-probar") : null;
  if (!c) return;
  c.textContent += texto;
  c.scrollTop = c.scrollHeight;
}
window.patchlab.onLog(({ id, texto }) => log(id, texto));

async function refrescar() {
  const st = await window.patchlab.estado();
  apk = st.apk || "";
  bundles = st.bundles || [];
  dispositivos = st.dispositivos || [];
  ultimoApk = st.ultimoApk || ultimoApk;
  $("#apk-elegido").textContent = apk ? apk.split("/").pop() : "ningún APK";
  $("#estado-cab").textContent =
    `${st.java ? "Java ✓" : "Java ✗"} · ${st.adb ? "adb ✓" : "adb ✗"} · ${dispositivos.length} móvil(es)`;
  $("#sel-dispositivo").innerHTML = dispositivos.length
    ? dispositivos.map((d) => `<option value="${esc(d.split(/\s+/)[0])}">${esc(d)}</option>`).join("")
    : '<option value="">sin dispositivos</option>';
  $("#entorno").innerHTML = [
    `Java: ${st.java ? "instalado" : "falta"}`,
    `adb: ${st.adb ? "instalado" : "falta"}`,
    `morphe-desktop.jar: ${st.jar ? "presente" : "falta"}`,
    `parches oficiales (.mpp): ${st.patchesOficial ? "presente" : "falta"}`,
    `bundles descargados: ${bundles.length}`,
    `carpeta de salida: ${st.salida}`,
  ].map((x) => `<li>${esc(x)}</li>`).join("");
}

async function cargarCatalogo() {
  $("#cuenta-repos").textContent = "cargando…";
  try {
    repos = await window.patchlab.catalogo();
    pintarRepos();
  } catch (e) {
    $("#cuenta-repos").textContent = "no se pudo cargar: " + e.message;
  }
}

function pintarRepos() {
  const q = ($("#buscar-repo").value || "").toLowerCase();
  const filtrados = repos.filter((r) => {
    const t = `${r.repo} ${r.name || ""} ${(r.patches || []).map((p) => p.name).join(" ")}`.toLowerCase();
    return !q || t.includes(q);
  });
  $("#cuenta-repos").textContent = `${filtrados.length} repositorios`;
  $("#lista-repos").innerHTML = filtrados.slice(0, 300).map((r) => {
    const nombres = (r.patches || []).map((p) => p.name).slice(0, 6).join(" · ");
    return `<div class="repo">
      <strong>${esc(r.name || r.repo)}</strong>
      <small>${esc(r.repo)} · ${(r.patches || []).length} parches</small>
      <div class="patches">${esc(nombres)}</div>
      <button data-repo="${esc(r.repo)}">Descargar .mpp</button>
    </div>`;
  }).join("");
  void traducirVisibles();
  document.querySelectorAll("#lista-repos button[data-repo]").forEach((b) => b.addEventListener("click", async () => {
    b.textContent = "descargando…";
    try {
      const ruta = await window.patchlab.descargarBundle(b.dataset.repo);
      b.textContent = "✓ descargado";
      bundles = [...new Set([...bundles, ruta])];
      refrescar();
    } catch (e) {
      b.textContent = "error: " + e.message;
    }
  }));
}

async function traducirVisibles() {
  if (!$("#chk-traducir").checked) return;
  const nodos = [...document.querySelectorAll(".repo .patches")].slice(0, 24);
  if (!nodos.length) return;
  const textos = nodos.map((n) => n.textContent);
  try {
    const trad = await window.patchlab.traducir(textos);
    nodos.forEach((n, i) => { if (trad[i]) n.textContent = trad[i]; });
  } catch (e) { console.warn("traducción:", e.message); }
}
$("#chk-traducir").addEventListener("change", traducirVisibles);

$("#btn-catalogo").addEventListener("click", cargarCatalogo);
$("#buscar-repo").addEventListener("input", pintarRepos);

$("#btn-apk").addEventListener("click", async () => { await window.patchlab.elegirApk(); refrescar(); });
$("#btn-listar").addEventListener("click", async () => {
  const mpps = [...bundles];
  if (!mpps.length) return alert("descarga algún bundle primero");
  $("#lista-parches").innerHTML = '<p class="tenue">leyendo parches…</p>';
  const salida = await window.patchlab.listarParches(mpps.slice(0, 1));
  const nombres = [...salida.matchAll(/^\s*([A-Za-z0-9][\w .'()\-]{2,60})\s*$/gm)].map((m) => m[1].trim());
  const unicos = [...new Set(nombres)].slice(0, 200);
  $("#lista-parches").innerHTML = unicos.length
    ? unicos.map((n) => `<label><input type="checkbox" value="${esc(n)}" checked> ${esc(n)}</label>`).join("")
    : '<p class="tenue">no pude interpretar la lista; mira la consola.</p>';
});

$("#btn-parchear").addEventListener("click", async () => {
  if (!apk) return alert("elige un APK primero");
  if (!bundles.length) return alert("descarga un bundle primero");
  const incluir = [...document.querySelectorAll("#lista-parches input:checked")].map((i) => i.value);
  $("#consola-parchear").textContent = "";
  const r = await window.patchlab.parchear({ apk, mpps: bundles, incluir, excluir: [], unsigned: $("#chk-unsigned").checked });
  if (!r.ok) { log("parchear", `\n✗ ${r.error}\n`); return; }
  ultimoApk = r.salida;
  log("parchear", `\n✓ listo: ${r.salida} (${(r.tamano / 1e6).toFixed(1)} MB)\n`);
  alert("Parcheado:\n" + r.salida);
});

$("#btn-instalar").addEventListener("click", async () => {
  const disp = $("#sel-dispositivo").value;
  if (!disp) return alert("conecta un móvil con depuración USB");
  if (!ultimoApk) return alert("parchea un APK primero");
  $("#consola-probar").textContent = "";
  const r = await window.patchlab.instalar({ apk: ultimoApk, dispositivo: disp });
  if (!r.ok) return log("instalar", `\n✗ ${r.error}\n`);
  paquete = r.paquete;
  $("#info-prueba").textContent = paquete ? `instalado: ${paquete}` : "instalado (no pude detectar el paquete)";
  log("instalar", `\n✓ instalado${paquete ? ": " + paquete : ""}\n`);
});

$("#btn-lanzar").addEventListener("click", async () => {
  const disp = $("#sel-dispositivo").value;
  if (!disp || !paquete) return alert("instala primero el APK");
  const r = await window.patchlab.lanzar({ paquete, dispositivo: disp });
  log("lanzar", r.ok ? "\n✓ lanzada\n" : "\n✗ no se pudo lanzar\n");
});

$("#btn-captura").addEventListener("click", async () => {
  const disp = $("#sel-dispositivo").value;
  if (!disp) return alert("conecta un móvil");
  const r = await window.patchlab.captura(disp);
  $("#captura").src = "data:image/png;base64," + r.base64;
});

$("#btn-logcat").addEventListener("click", async () => {
  const disp = $("#sel-dispositivo").value;
  if (!disp) return alert("conecta un móvil");
  const r = await window.patchlab.logcat({ dispositivo: disp, paquete });
  $("#consola-probar").textContent = r.texto;
  $("#consola-probar").scrollTop = 0;
  log("logcat", `\n(fallos detectados: ${r.crasheos})\n`);
});
$("#btn-detener").addEventListener("click", () => window.patchlab.detener("parchear"));
$("#link-morphe").addEventListener("click", (e) => { e.preventDefault(); window.patchlab.abrirCarpeta("https://github.com/MorpheApp"); });

refrescar().then(cargarCatalogo);
