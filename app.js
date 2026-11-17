// GANTI DENGAN FIREBASE CONFIG ANDA
const firebaseConfig = {
apiKey: "AIzaSyC2bt-bN0bnonX1ROPR-59G6cA4eo_xZ2A",
    authDomain: "jamur-esp.firebaseapp.com",
    databaseURL: "https://jamur-esp-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "jamur-esp",
    storageBucket: "jamur-esp.firebasestorage.app",
    messagingSenderId: "772846279758",
    appId: "1:772846279758:web:ca3f4a9396b1aa9409f71f"
}

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ===== Data acuan jamur (silakan ubah/tambah) =====
// suhu & lembab: [minimum, maksimum]
const JAMUR = [
    { nama: 'Jamur tiram putih', latin: 'Pleurotus ostreatus',
      inkubasi: { suhu: [22, 28], lembab: [60, 80] }, tumbuh: { suhu: [20, 28], lembab: [80, 90] },
      catatan: 'Paling mudah untuk pemula dan tahan suhu hangat.' },
    { nama: 'Jamur kuping', latin: 'Auricularia auricula-judae',
      inkubasi: { suhu: [24, 30], lembab: [60, 75] }, tumbuh: { suhu: [22, 28], lembab: [85, 95] },
      catatan: 'Butuh kelembapan tinggi saat tubuh buah muncul.' },
    { nama: 'Jamur merang', latin: 'Volvariella volvacea',
      inkubasi: { suhu: [30, 35], lembab: [70, 80] }, tumbuh: { suhu: [28, 35], lembab: [80, 90] },
      catatan: 'Menyukai suhu panas; tumbuh cepat.' },
    { nama: 'Jamur lingzhi', latin: 'Ganoderma lucidum',
      inkubasi: { suhu: [25, 30], lembab: [70, 80] }, tumbuh: { suhu: [25, 30], lembab: [85, 95] },
      catatan: 'Pertumbuhan lambat; jaga sirkulasi udara.' },
    { nama: 'Jamur shiitake', latin: 'Lentinula edodes',
      inkubasi: { suhu: [20, 25], lembab: [60, 70] }, tumbuh: { suhu: [12, 20], lembab: [80, 90] },
      catatan: 'Butuh suhu sejuk untuk memunculkan tubuh buah.' },
    { nama: 'Jamur kancing', latin: 'Agaricus bisporus',
      inkubasi: { suhu: [22, 25], lembab: [85, 90] }, tumbuh: { suhu: [14, 18], lembab: [85, 92] },
      catatan: 'Butuh suhu sejuk; sulit di daerah panas tanpa pendingin.' },
    { nama: 'Jamur enoki', latin: 'Flammulina velutipes',
      inkubasi: { suhu: [20, 25], lembab: [65, 75] }, tumbuh: { suhu: [8, 15], lembab: [85, 95] },
      catatan: 'Tubuh buah baru muncul di suhu dingin.' }
];

// ===== Util & elemen =====
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const jam = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const autoToggle = $('autoToggle'), manualToggle = $('manualToggle'), statusPompaEl = $('statusPompa');
const connStatus = $('connStatus'), connText = $('connText'), jenisEl = $('jenisJamur');
const setLembab = $('setLembab'), setSuhu = $('setSuhu'), setLembabVal = $('setLembabVal'), setSuhuVal = $('setSuhuVal');
const saveBtn = $('saveBtn'), saveMsg = $('saveMsg');

// ===== Pindah dasbor =====
const JUDUL = {
    monitoring: 'Monitoring Real-time & Kendali Aktuator',
    data: 'Data Sensor Realtime',
    pengaturan: 'Pengaturan Setpoint & Parameter'
};
const DESK = {
    monitoring: 'Pantau suhu dan kelembapan kumbung secara real-time, lalu kendalikan sanyo dari satu layar.',
    data: 'Grafik dan tabel hasil pembacaan sensor DHT22 yang masuk selama halaman ini terbuka.',
    pengaturan: 'Atur batas kelembapan dan suhu secara manual, atau pakai acuan sesuai jenis jamur.'
};
function showView() {
    const h = location.hash.slice(1);
    const name = JUDUL[h] ? h : 'monitoring';
    Object.keys(JUDUL).forEach((k) => {
        $('view-' + k).hidden = k !== name;
        const tab = $('tab-' + k);
        tab.classList.toggle('active', k === name);
        if (k === name) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== name; });
    $('judul').textContent = JUDUL[name];
    $('deskripsi').textContent = DESK[name];
}
window.addEventListener('hashchange', showView);

// Jam WIB
setInterval(() => {
    $('jamWib').textContent = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }) + ' WIB';
}, 1000);

// ===== State =====
let saved = { lembab: 80, suhu: 30 };   // nilai awal jika belum ada di Firebase
let modeAuto = false, lastData = null, statusPompaTerakhir = '-', prevKontrol = null;
let aktif = { jenis: 0, fase: 'tumbuh' };   // profil yang tersimpan di Firebase
let draftPilihan = null;                      // pilihan dari tombol "Pakai" yang belum disimpan
const FASE_NAMA = { inkubasi: 'Inkubasi', tumbuh: 'Tubuh buah' };
const logList = [];

function catat(teks) {
    logList.unshift({ t: Date.now(), teks });
    if (logList.length > 20) logList.pop();
    renderLog();
}
function renderLog() {
    $('logList').innerHTML = logList.length
        ? logList.map((l) => `<li><span>${esc(l.teks)}</span><time>${jam(l.t)}</time></li>`).join('')
        : '<li class="empty">Belum ada kejadian.</li>';
}
function gotoLog() { $('logPanel').scrollIntoView({ behavior: 'smooth', block: 'center' }); }

// ===== Kartu KPI =====
JAMUR.forEach((j, i) => jenisEl.add(new Option(j.nama, i)));
function setVal(el, v, unit) { el.innerHTML = v == null ? '--' : Number(v).toFixed(1) + '<span>' + unit + '</span>'; }
function setBadge(el, teks, level) { el.textContent = teks; el.className = 'badge ' + level; }

function renderStatus() {
    $('suhuTarget').textContent = 'Target: ≤ ' + saved.suhu.toFixed(1) + ' °C';
    $('lembabTarget').textContent = 'Target: ≥ ' + saved.lembab + ' %';
    if (!lastData) return;
    const t = Number(lastData.suhu), h = Number(lastData.kelembapan);
    const maxRH = Math.max(JAMUR[aktif.jenis][aktif.fase].lembab[1], saved.lembab);
    if (t > saved.suhu) setBadge($('suhuBadge'), 'Melebihi batas', 'bad');
    else setBadge($('suhuBadge'), 'Dalam batas', '');
    if (h < saved.lembab) setBadge($('lembabBadge'), 'Terlalu kering', 'warn');
    else if (h > maxRH) setBadge($('lembabBadge'), 'Terlalu lembap', 'warn');
    else setBadge($('lembabBadge'), 'Sesuai target', '');
}
// Pilihan jenis jamur & fase (disimpan di Firebase bersama setpoint-nya)
function renderPilihan() {
    jenisEl.value = aktif.jenis;
    document.querySelectorAll('#faseSeg button').forEach((b) => b.classList.toggle('active', b.dataset.fase === aktif.fase));
    $('chipJamur').textContent = 'Jamur: ' + JAMUR[aktif.jenis].nama.replace('Jamur ', '');
    $('chipFase').textContent = 'Fase: ' + FASE_NAMA[aktif.fase].toLowerCase();
}
function terapkanPilihan(jenis, fase) {
    const f = JAMUR[jenis][fase];
    const l = f.lembab[0], s = f.suhu[1];
    const ok = confirm('Terapkan ' + JAMUR[jenis].nama + ', fase ' + FASE_NAMA[fase] + '?\nSetpoint baru: RH minimum ' + l + ' %, suhu maksimum ' + s + ' °C.');
    if (!ok) { renderPilihan(); return; }
    db.ref('kontrol').update({ jenis: JAMUR[jenis].nama, fase: fase, batas_kelembapan: l, batas_suhu: s })
        .then(() => catat('Profil: ' + JAMUR[jenis].nama + ', fase ' + FASE_NAMA[fase] + ' (RH ' + l + ' %, suhu maks ' + s + ' °C)'))
        .catch(() => { catat('Gagal menerapkan profil'); renderPilihan(); });
}
function renderMode() {
    $('modeVal').textContent = modeAuto ? 'OTOMATIS' : 'MANUAL';
    $('modeMeta').textContent = 'Sanyo ON jika RH < ' + saved.lembab + ' % | suhu maks ' + saved.suhu.toFixed(1) + ' °C';
    $('chipMode').textContent = 'Mode: ' + (modeAuto ? 'otomatis (setpoint aktif)' : 'manual');
}
jenisEl.addEventListener('change', () => terapkanPilihan(Number(jenisEl.value), aktif.fase));
document.querySelectorAll('#faseSeg button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.fase !== aktif.fase) terapkanPilihan(aktif.jenis, b.dataset.fase);
}));

function spark(svg, key) {
    const d = riwayat.slice(-30).map((p) => p[key]);
    if (d.length < 2) { svg.innerHTML = ''; return; }
    let lo = Math.min(...d), hi = Math.max(...d);
    if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
    const path = d.map((v, i) => (i ? 'L' : 'M') + ((i / (d.length - 1)) * 200).toFixed(1) + ' ' + (36 - ((v - lo) / (hi - lo)) * 32).toFixed(1)).join(' ');
    svg.innerHTML = `<path d="${path}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// ===== Grafik realtime & tabel =====
const MAX_POINTS = 600;
const riwayat = [];            // { no, t, suhu, lembab, pompa }
let titikTimer = null, nomorData = 0, rentangMs = 180000;
const CW = 600, CH = 220, PL = 46, PR = 14, PT = 14, PB = 28;
const dataRentang = () => (rentangMs ? riwayat.filter((p) => p.t >= Date.now() - rentangMs) : riwayat);

function drawChart(svg, statEl, key, batas, minSpan) {
    const riwayat = dataRentang();
    if (riwayat.length < 2) {
        svg.innerHTML = `<text class="ax" x="${CW / 2}" y="${CH / 2}" text-anchor="middle">Menunggu data…</text>`;
        return;
    }
    const vals = riwayat.map((p) => p[key]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const rataRata = vals.reduce((a, b) => a + b, 0) / vals.length;
    statEl.textContent = `Min ${lo.toFixed(1)}, rata-rata ${rataRata.toFixed(1)}, maks ${hi.toFixed(1)}`;

    // Sertakan garis batas hanya jika dekat dengan data, supaya grafik tidak gepeng
    const tampilBatas = batas >= lo - minSpan && batas <= hi + minSpan;
    if (tampilBatas) { lo = Math.min(lo, batas); hi = Math.max(hi, batas); }
    if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;

    const t0 = riwayat[0].t, t1 = riwayat[riwayat.length - 1].t;
    const x = (t) => PL + ((t - t0) / (t1 - t0 || 1)) * (CW - PL - PR);
    const y = (v) => PT + ((hi - v) / (hi - lo)) * (CH - PT - PB);

    const pts = riwayat.map((p) => [x(p.t), y(p[key])]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${CH - PB} L${pts[0][0].toFixed(1)} ${CH - PB} Z`;
    const last = pts[pts.length - 1];

    let grid = '';
    [lo, (lo + hi) / 2, hi].forEach((v) => {
        grid += `<line class="grid-line" x1="${PL}" x2="${CW - PR}" y1="${y(v)}" y2="${y(v)}"/>` +
                `<text class="ax" x="${PL - 8}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`;
    });
    const limit = tampilBatas
        ? `<line class="lim" x1="${PL}" x2="${CW - PR}" y1="${y(batas)}" y2="${y(batas)}"/>` +
          `<text class="lim-label" x="${CW - PR}" y="${y(batas) - 5}" text-anchor="end">batas ${batas}</text>`
        : '';

    svg.innerHTML = `
        <defs><linearGradient id="g-${key}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="currentColor" stop-opacity=".35"/>
            <stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
        ${grid}
        <path d="${area}" fill="url(#g-${key})"/>
        <path class="ln" d="${line}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${limit}
        <circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="currentColor" stroke="#18232b" stroke-width="2"/>
        <text class="ax" x="${PL}" y="${CH - 8}" text-anchor="start">${jam(t0)}</text>
        <text class="ax" x="${CW - PR}" y="${CH - 8}" text-anchor="end">${jam(t1)}</text>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const waktuLengkap = (ms) => new Date(ms).toLocaleString('id-ID');

function renderTabel() {
    if (!riwayat.length) return;
    $('dataBody').innerHTML = riwayat.slice(-100).reverse().map((p) =>
        `<tr><td>${p.no}</td><td>${waktuLengkap(p.t)}</td><td>${p.suhu.toFixed(1)}</td><td>${p.lembab.toFixed(1)}</td><td>${esc(p.pompa)}</td></tr>`
    ).join('');
}

function unduhCSV() {
    if (!riwayat.length) return;
    const baris = ['No,Waktu,Suhu (C),Kelembapan (%),Status pompa'].concat(riwayat.map((p) =>
        [p.no, '"' + waktuLengkap(p.t) + '"', p.suhu.toFixed(1), p.lembab.toFixed(1), '"' + String(p.pompa).replace(/"/g, '""') + '"'].join(',')
    ));
    const blob = new Blob(['\ufeff' + baris.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'data-sensor-jamur.csv';
    a.click();
    URL.revokeObjectURL(a.href);
}

function drawCharts() {
    drawChart($('chartSuhu'), $('statSuhu'), 'suhu', saved.suhu, 4);
    drawChart($('chartLembab'), $('statLembab'), 'lembab', saved.lembab, 10);
}

// ESP menulis suhu lalu kelembapan berurutan; tunggu sebentar agar jadi satu titik
function jadwalkanTitik(d) {
    if (d.suhu == null || d.kelembapan == null) return;
    clearTimeout(titikTimer);
    titikTimer = setTimeout(() => {
        riwayat.push({ no: ++nomorData, t: Date.now(), suhu: Number(d.suhu), lembab: Number(d.kelembapan), pompa: statusPompaTerakhir });
        if (riwayat.length > MAX_POINTS) riwayat.shift();
        drawCharts(); renderTabel();
        spark($('spSuhu'), 'suhu'); spark($('spLembab'), 'lembab');
    }, 1000);
}

document.querySelectorAll('#rangeSeg button').forEach((b) => b.addEventListener('click', () => {
    rentangMs = Number(b.dataset.ms);
    document.querySelectorAll('#rangeSeg button').forEach((x) => x.classList.toggle('active', x === b));
    drawCharts();
}));

// ===== Pengaturan (batas kelembapan & suhu) =====
const isDirty = () => Number(setLembab.value) !== saved.lembab || Number(setSuhu.value) !== saved.suhu ||
    (draftPilihan !== null && (draftPilihan.jenis !== aktif.jenis || draftPilihan.fase !== aktif.fase));
function flash(text) { saveMsg.textContent = text; }
function renderDraft() {
    setLembabVal.textContent = Number(setLembab.value) + ' %';
    setSuhuVal.textContent = Number(setSuhu.value).toFixed(1) + ' °C';
    saveBtn.disabled = !isDirty();
}
function renderSaved() {
    $('activeLembab').textContent = saved.lembab + ' %';
    $('activeSuhu').textContent = saved.suhu.toFixed(1) + ' °C';
    renderMode(); renderPilihan(); renderStatus(); drawCharts();
}
[setLembab, setSuhu].forEach((el) => el.addEventListener('input', () => { flash(''); renderDraft(); }));
document.querySelectorAll('.step').forEach((btn) => btn.addEventListener('click', () => {
    const input = $(btn.dataset.target);
    input.value = Number(input.value) + Number(btn.dataset.step);
    flash(''); renderDraft();
}));
function resetDefault() { setLembab.value = 80; setSuhu.value = 30; flash(''); renderDraft(); }
function simpanPengaturan() {
    saveBtn.disabled = true;
    const l = Number(setLembab.value), s = Number(setSuhu.value);
    const data = { batas_kelembapan: l, batas_suhu: s };
    if (draftPilihan) { data.jenis = JAMUR[draftPilihan.jenis].nama; data.fase = draftPilihan.fase; }
    db.ref('kontrol').update(data)
        .then(() => { draftPilihan = null; flash('Tersimpan. Alat akan memakai batas yang baru.'); catat('Setpoint disimpan: RH ' + l + ' %, suhu maks ' + s.toFixed(1) + ' °C'); })
        .catch(() => { flash('Gagal menyimpan. Periksa koneksi lalu coba lagi.'); renderDraft(); });
}

// ===== Kartu acuan jamur =====
const fmt = (r) => r[0] + '–' + r[1];
function faseHTML(label, key, f, idx, fk) {
    return `<div class="fase">
        <div class="fase-head"><span>${label}</span>
            <button class="pakai" type="button" data-nama="${key}" data-jenis="${idx}" data-fase="${fk}" data-lembab="${f.lembab[0]}" data-suhu="${f.suhu[1]}">Pakai</button></div>
        <p>Kelembapan ${fmt(f.lembab)}%<br>Suhu ${fmt(f.suhu)} °C</p></div>`;
}
$('jamurList').innerHTML = JAMUR.map((j, i) => `
    <article class="jamur">
        <h3>${j.nama}</h3><p class="latin">${j.latin}</p>
        ${faseHTML('Inkubasi (miselium)', j.nama + ', inkubasi', j.inkubasi, i, 'inkubasi')}
        ${faseHTML('Tubuh buah', j.nama + ', tubuh buah', j.tumbuh, i, 'tumbuh')}
        <p class="note">${j.catatan}</p>
    </article>`).join('');

$('jamurList').addEventListener('click', (e) => {
    const b = e.target.closest('.pakai');
    if (!b) return;
    setLembab.value = b.dataset.lembab;
    setSuhu.value = b.dataset.suhu;
    draftPilihan = { jenis: Number(b.dataset.jenis), fase: b.dataset.fase };
    renderDraft();
    flash('Nilai ' + b.dataset.nama + ' dimasukkan. Tekan Simpan untuk menerapkan.');
    $('setSuhu').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// ===== Firebase: koneksi, monitoring, status, kontrol =====
db.ref('.info/connected').on('value', (snap) => {
    const online = snap.val() === true;
    connStatus.classList.toggle('online', online);
    connStatus.classList.toggle('offline', !online);
    connText.textContent = online ? 'System: online' : 'System: terputus';
    catat(online ? 'Terhubung ke Firebase' : 'Koneksi ke Firebase terputus');
});

db.ref('monitoring').on('value', (snap) => {
    const d = snap.val();
    if (!d) return;
    lastData = d;
    setVal($('suhuVal'), d.suhu, '°C');
    setVal($('lembabVal'), d.kelembapan, '%');
    const t = 'Diperbarui ' + jam(Date.now());
    $('suhuMeta').textContent = t; $('lembabMeta').textContent = t;
    renderStatus(); jadwalkanTitik(d);
});

db.ref('status/pompa').on('value', (snap) => {
    const st = snap.val() || 'Mati';
    if (statusPompaTerakhir !== '-' && st !== statusPompaTerakhir) catat('Sanyo: ' + st);
    statusPompaTerakhir = st;
    const on = /^(on|hidup|nyala)/i.test(String(st));
    statusPompaEl.textContent = st;
    statusPompaEl.classList.toggle('on', on);
    $('pompaVal').textContent = on ? 'MENYALA' : 'MATI';
});

db.ref('kontrol').on('value', (snap) => {
    const d = snap.val();
    if (!d) return;
    autoToggle.checked = !!d.mode_otomatis;
    manualToggle.checked = !!d.pompa_manual;
    manualToggle.disabled = !!d.mode_otomatis;   // manual nonaktif saat otomatis nyala
    modeAuto = !!d.mode_otomatis;
    if (prevKontrol) {
        if (prevKontrol.mode_otomatis !== d.mode_otomatis) catat('Mode ' + (d.mode_otomatis ? 'otomatis diaktifkan' : 'manual diaktifkan'));
        else if (prevKontrol.pompa_manual !== d.pompa_manual) catat('Sanyo manual ' + (d.pompa_manual ? 'dinyalakan' : 'dimatikan'));
    }
    const idx = JAMUR.findIndex((x) => x.nama === d.jenis);
    if (idx >= 0) aktif.jenis = idx;
    if (d.fase && JAMUR[0][d.fase]) aktif.fase = d.fase;
    prevKontrol = d;

    const wasDirty = isDirty();
    if (d.batas_kelembapan != null) saved.lembab = Number(d.batas_kelembapan);
    if (d.batas_suhu != null) saved.suhu = Number(d.batas_suhu);
    if (!wasDirty) { setLembab.value = saved.lembab; setSuhu.value = saved.suhu; }
    renderDraft(); renderSaved();
});

// Mengirim perintah ke Firebase
function updateFirebase(type) {
    if (type === 'auto') db.ref('kontrol').update({ mode_otomatis: autoToggle.checked });
    else if (type === 'manual') db.ref('kontrol').update({ pompa_manual: manualToggle.checked });
}
function darurat() {
    if (!confirm('Matikan mode otomatis, sanyo manual, dan relay 2 sekarang?')) return;
    db.ref('kontrol').update({ mode_otomatis: false, pompa_manual: false, relay2: false })
        .then(() => catat('Emergency override: semua kontrol dimatikan'));
}

// ===== Tampilan awal =====
showView(); renderLog(); renderDraft(); renderSaved();