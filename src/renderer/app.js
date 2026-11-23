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

async function pintarRepos() {
  const q = ($("#buscar-repo").value || "").toLowerCase();
  const filtrados = repos.filter((r) => {
    const t = `${r.repo} ${r.name || ""} ${(r.patches || []).map((p) => p.name).join(" ")} ${(r.targetApps || []).join(" ")}`.toLowerCase();
    return !q || t.includes(q);
  });
  $("#cuenta-repos").textContent = `${filtrados.length} repositorios`;
  const caja = $("#lista-repos");
  caja.innerHTML = filtrados.slice(0, 300).map((r) => {
    const apps = (r.targetApps || []).slice(0, 3);
    const parches = (r.patches || []).slice(0, 8);
    return `<div class="repo">
      <div class="repo-cab">
        <span class="icono" data-img="${esc(r.bundleIconUrl || r.avatarUrl || "")}">?</span>
        <div class="repo-titulo">
          <strong>${esc(r.name || r.repo)}</strong>
          <small>${esc(r.repo)}</small>
        </div>
        <span class="pill-mini">${r.patchCount ?? (r.patches || []).length} parches</span>
      </div>
      <div class="apps">${apps.map((a) => `<span class="chip" title="${esc(a)}">${esc(a)}</span>`).join("")}${(r.targetApps || []).length > 3 ? `<span class="chip tenue">+${(r.targetApps || []).length - 3}</span>` : ""}</div>
      <div class="patches">${parches.map((x) => esc(x.name)).join(" · ")}</div>
      <details class="detalle">
        <summary>${(r.patches || []).length} parches con descripción</summary>
        <ul>${(r.patches || []).map((x) => `<li><strong>${esc(x.name)}</strong><br><span class="tenue">${esc(x.description || "")}</span></li>`).join("")}</ul>
      </details>
      <div class="pie-repo">
        <span class="tenue">★ ${r.stars ?? 0}</span>
        <button data-repo="${esc(r.repo)}">Descargar .mpp</button>
      </div>
    </div>`;
  }).join("");

  // iconos (bundleIconUrl; si falla, avatar del autor)
  document.querySelectorAll(".repo-cab .icono[data-img]").forEach(async (span) => {
    const url = span.dataset.img;
    if (!url) return;
    const data = await window.patchlab.imagen(url).catch(() => null);
    if (data) { span.style.backgroundImage = `url("${data}")`; span.textContent = ""; span.classList.add("con-imagen"); }
  });

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
