// ═══════════════════════════════════════════════════════════════════
// CeisMon – Server Monitoring UI
// Arsitektur:
//   • Backend polling 10 detik → INSERT ke DB (server.js backend)
//   • UI fetch dari /api/server_history setiap 10 detik (read-only)
//   • Daftar server canonical = servers.json (11 server, urutan tetap)
// ═══════════════════════════════════════════════════════════════════

const ADMIN_PASSWORD = 'Kumaha@ing';

// Warna per-server (urutan tetap sesuai servers.json index)
const SERVER_COLORS = [
    '#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c',
'#3498db','#9b59b6','#e91e63','#00bcd4','#8bc34a',
'#ff5722','#795548','#607d8b','#3f51b5','#673ab7',
'#cddc39','#009688','#03a9f4','#ff9800','#f44336',
'#4caf50','#2196f3','#9c27b0','#ff4081','#7955a5'
];

// ── State global ─────────────────────────────────────────────────
let serverList      = [];   // [{name,url,key}] dari servers.json — urutan canonical
let historicalData  = [];   // downsampled untuk grafik [{isoMs, timestamp, servers}]
let tableData       = [];   // full 10s resolution untuk dot tabel
let hiddenServers   = new Set();
let alarmAudio      = null;
let prevStatus      = {};   // untuk deteksi perubahan status

// Lookup titik chart per-index waktu, dipakai tooltip untuk mendeteksi dot
// server lain yang posisinya berdempetan/tumpang-tindih pada snapshot yang sama
let currentPointsByIndex = {};
// Jarak vertikal (px) maksimum antar-dot supaya dianggap "berdempetan"
const DOT_OVERLAP_PX = 13;

// ── Range filter ─────────────────────────────────────────────────
const RANGES = {
    '5 Menit':  5,
    '15 Menit': 15,
    '30 Menit': 30,
    '1 Jam':    60,
    '6 Jam':    360,
    '24 Jam':   1440
};
let selectedRange   = '15 Menit';  // default 15 menit
let filterMode      = 'relative';  // 'relative' | 'range'

// ── Timer ─────────────────────────────────────────────────────────
const REFRESH_MS    = 10000;  // 10 detik
let refreshTimer    = null;

// ═══════════════════════════════════════════════════════════════════
// 1. LOAD SERVERS  dari /api/servers (baca data/servers.json di backend)
// ═══════════════════════════════════════════════════════════════════
async function loadServerList() {
    try {
        const r    = await fetch('/api/servers');
        const data = await r.json();
        if (data.success && Array.isArray(data.servers)) {
            serverList = data.servers; // [{name, url, key, url_env, key_env}]
        }
    } catch (e) {
        console.warn('Gagal load /api/servers:', e);
    }
}

// ═══════════════════════════════════════════════════════════════════
// 2. FETCH DARI DB
// ═══════════════════════════════════════════════════════════════════
// Helper: konversi 1 raw snapshot array → format internal {isoMs, timestamp, servers}
function parseSnap(snap) {
    const byName = {};
    snap.forEach(row => {
        byName[row.name] = {
            status: row.status,
            rt:     Number(row.responseTime) || 0,
            ts:     new Date(row.timestamp)
        };
    });
    const refTs = snap[0] ? new Date(snap[0].timestamp) : new Date();
    return { isoMs: refTs.getTime(), timestamp: refTs, servers: byName };
}

let fetchFailCount = 0;

async function fetchFromDB() {
    try {
        let url;
        if (filterMode === 'relative') {
            url = `/api/server_history?minutes=${RANGES[selectedRange] || 60}`;
        } else {
            const f = document.getElementById('rangeFromInput');
            const t = document.getElementById('rangeToInput');
            if (!f?.value || !t?.value) return;
            url = `/api/server_history?from=${encodeURIComponent(new Date(f.value).toISOString())}&to=${encodeURIComponent(new Date(t.value).toISOString())}`;
        }

        const r = await fetch(url);

        // Cek content-type sebelum parse — hindari "Unexpected token '<'"
        // saat server mengembalikan halaman HTML error/timeout, bukan JSON
        const ctype = r.headers.get('content-type') || '';
        if (!ctype.includes('application/json')) {
            const text = await r.text();
            throw new Error(`Server mengembalikan respons tidak valid (status ${r.status}). ${text.slice(0, 100)}`);
        }

        const data = await r.json();
        if (!data.success) throw new Error(data.error || 'Unknown error');

        historicalData = (data.snapshots || []).map(parseSnap);
        tableData      = (data.allSnaps  || data.snapshots || []).map(parseSnap);

        // Pastikan serverList terisi (fallback dari DB jika belum ada)
        if (serverList.length === 0 && historicalData.length > 0) {
            const names = new Set();
            historicalData.forEach(h => Object.keys(h.servers).forEach(n => names.add(n)));
            serverList = Array.from(names).map(n => ({ name: n, url: '', key: '' }));
        }

        // Snapshot terbaru → status realtime
        const latest = tableData.length
            ? tableData[tableData.length - 1]
            : null;

        renderStats(latest);
        renderLegend();
        renderChart();
        renderTable(latest);
        updateIndicator();

        // Berhasil — bersihkan error & reset counter kegagalan
        fetchFailCount = 0;
        const c = document.getElementById('errorContainer');
        if (c) c.innerHTML = '';

    } catch (err) {
        fetchFailCount++;
        console.error('fetchFromDB error (attempt ' + fetchFailCount + '):', err);
        // Hanya tampilkan pesan error ke UI kalau gagal berulang (2x+)
        // agar 1x glitch jaringan/server restart tidak langsung memunculkan warning
        if (fetchFailCount >= 2) {
            showError('Gagal memuat data dari server: ' + err.message);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// 3. STATS  (UP/DOWN/ERROR dari snapshot TERBARU)
// ═══════════════════════════════════════════════════════════════════
function renderStats(latest) {
    let up = 0, err = 0, down = 0;
    if (latest) {
        serverList.forEach(sv => {
            const d = latest.servers[sv.name];
            if (!d) return;
            if (d.status === 'UP')    up++;
            else if (d.status === 'ERROR') err++;
            else down++;
        });

        // Cek alarm — trigger untuk DOWN maupun ERROR
        let hasIssue = false;
        serverList.forEach(sv => {
            const d = latest.servers[sv.name];
            if (!d) return;
            const prev = prevStatus[sv.name];
            if (d.status === 'DOWN' || d.status === 'ERROR') {
                hasIssue = true;
                if (prev && prev !== d.status) {
                    const icon = d.status === 'DOWN' ? '🔴' : '🟠';
                    showNotification(`${icon} ${sv.name} is ${d.status}!`);
                }
            }
            prevStatus[sv.name] = d.status;
        });
        if (hasIssue) playAlarm(); else stopAlarm();
    }

    setEl('upCount',    up);
    setEl('errorCount', err);
    setEl('downCount',  down);

    // Blink jika ada masalah
    const eb = document.querySelector('.stat-badge.error');
    const db = document.querySelector('.stat-badge.down');
    if (eb) eb.classList.toggle('blinking', err > 0);
    if (db) db.classList.toggle('blinking', down > 0);
}

// ═══════════════════════════════════════════════════════════════════
// 4. LEGEND
// ═══════════════════════════════════════════════════════════════════
function renderLegend() {
    const el = document.getElementById('legend');
    if (!el) return;
    el.innerHTML = '';
    serverList.forEach((sv, i) => {
        const color = SERVER_COLORS[i % SERVER_COLORS.length];
        const item  = document.createElement('div');
        item.className = 'legend-item' + (hiddenServers.has(sv.name) ? ' disabled' : '');
        item.innerHTML = `<div class="legend-color" style="background:${color}"></div><span>${sv.name}</span>`;
        item.onclick = () => {
            if (hiddenServers.has(sv.name)) hiddenServers.delete(sv.name);
            else hiddenServers.add(sv.name);
            renderLegend();
            renderChart();
        };
        el.appendChild(item);
    });
}

// ═══════════════════════════════════════════════════════════════════
// 5. CHART  (dari historicalData, difilter sesuai range)
// ═══════════════════════════════════════════════════════════════════
function renderChart() {
    const svg = document.getElementById('lineChart');
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    hideTooltip(svg); // buang tooltip lama (kalau ada) saat chart di-render ulang
    currentPointsByIndex = {};

    const W  = svg.clientWidth  || 900;
    const H  = 350;
    const PL = 65, PR = 20, PT = 20, PB = 45;
    const cW = W - PL - PR;
    const cH = H - PT - PB;

    // Filter historicalData sesuai range
    let filtered = historicalData;
    if (filterMode === 'relative') {
        const cutoff = Date.now() - (RANGES[selectedRange] || 60) * 60 * 1000;
        filtered = historicalData.filter(h => h.isoMs >= cutoff);
    }

    if (filtered.length === 0) {
        svgText(svg, W/2, H/2, 'Tidak ada data untuk range ini', '#888', 14, 'middle');
        return;
    }

    // Hitung maxRT
    let maxRT = 0;
    filtered.forEach(h => {
        serverList.forEach(sv => {
            if (!hiddenServers.has(sv.name)) {
                const d = h.servers[sv.name];
                if (d && d.rt > maxRT) maxRT = d.rt;
            }
        });
    });
    if (maxRT === 0) maxRT = 200;

    // Grid Y
    for (let i = 0; i <= 5; i++) {
        const y = PT + cH - (i * cH / 5);
        svgLine(svg, PL, y, PL + cW, y, '#ddd', 1, 0.4);
        svgText(svg, PL - 6, y + 4, Math.round(maxRT * i / 5) + 'ms', '#888', 11, 'end');
    }

    // Axis
    svgLine(svg, PL, PT, PL, PT + cH, '#999', 1.5);
    svgLine(svg, PL, PT + cH, PL + cW, PT + cH, '#999', 1.5);

    // X labels — max 10 label
    const step = Math.max(1, Math.floor(filtered.length / 10));
    const showDate = (RANGES[selectedRange] >= 1440) || filterMode === 'range';
    filtered.forEach((h, i) => {
        if (i % step !== 0) return;
        const x   = PL + (i / Math.max(1, filtered.length - 1)) * cW;
        const lbl = showDate
            ? fmtDT(h.timestamp, true)
            : fmtDT(h.timestamp, false);
        svgText(svg, x, PT + cH + 18, lbl, '#888', 10, 'middle');
    });

    // ── Gambar garis per server ──────────────────────────────────
    // Kumpulkan semua titik per server dulu
    const allPts = []; // [{sv, si, color, pts}]
    serverList.forEach((sv, si) => {
        if (hiddenServers.has(sv.name)) return;
        const color = SERVER_COLORS[si % SERVER_COLORS.length];
        const pts   = [];

        filtered.forEach((h, i) => {
            const d = h.servers[sv.name];
            if (!d) return;
            const x = PL + (i / Math.max(1, filtered.length - 1)) * cW;
            const y = d.status === 'DOWN'
                ? PT + cH  // dasar chart untuk DOWN
                : PT + cH - (d.rt / maxRT) * cH;
            const point = { x, y, d, h, i, sv, color };
            pts.push(point);
            (currentPointsByIndex[i] || (currentPointsByIndex[i] = [])).push(point);
        });

        if (pts.length > 0) allPts.push({ sv, si, color, pts });
    });

    // Pass 1: gambar semua GARIS (di bawah semua dot)
    allPts.forEach(({ color, pts }) => {
        let path = '';
        let pen  = false;
        pts.forEach(p => {
            if (p.d.status === 'DOWN') { pen = false; return; }
            if (!pen) { path += `M${p.x},${p.y}`; pen = true; }
            else       { path += `L${p.x},${p.y}`; }
        });
        if (path) {
            const el = svgEl('path');
            el.setAttribute('d', path);
            el.setAttribute('stroke', color);
            el.setAttribute('fill', 'none');
            el.setAttribute('stroke-width', '2');
            el.setAttribute('stroke-opacity', '0.85');
            svg.appendChild(el);
        }
    });

    // Pass 2: gambar dot UP (di atas garis, di bawah error/down)
    allPts.forEach(({ sv, si, color, pts }) => {
        pts.forEach(p => {
            if (p.d.status !== 'UP') return;
            const c = svgEl('circle');
            c.setAttribute('cx', p.x);
            c.setAttribute('cy', p.y);
            c.setAttribute('r', 4);
            c.setAttribute('fill', statusColor('UP'));
            c.setAttribute('fill-opacity', '0.85');
            c.setAttribute('stroke', color);
            c.setAttribute('stroke-width', '1.5');
            c.style.cursor = 'pointer';
            c.addEventListener('mouseenter', e => showChartTooltip(e, p, svg));
            c.addEventListener('mouseleave', () => hideTooltip(svg));
            svg.appendChild(c);
        });
    });

    // Pass 3: gambar dot ERROR & DOWN PALING ATAS — selalu terlihat di depan
    allPts.forEach(({ sv, si, color, pts }) => {
        pts.forEach(p => {
            if (p.d.status === 'UP') return;
            const isDown  = p.d.status === 'DOWN';
            const c = svgEl('circle');
            c.setAttribute('cx', p.x);
            c.setAttribute('cy', p.y);
            c.setAttribute('r', isDown ? 7 : 6);  // DOWN lebih besar agar mencolok
            c.setAttribute('fill', statusColor(p.d.status));
            c.setAttribute('fill-opacity', '1');
            c.setAttribute('stroke', isDown ? '#fff' : '#fff');
            c.setAttribute('stroke-width', '2');
            c.style.cursor = 'pointer';
            // Outline tambahan agar makin menonjol
            const outline = svgEl('circle');
            outline.setAttribute('cx', p.x);
            outline.setAttribute('cy', p.y);
            outline.setAttribute('r', isDown ? 10 : 9);
            outline.setAttribute('fill', 'none');
            outline.setAttribute('stroke', statusColor(p.d.status));
            outline.setAttribute('stroke-width', '1.5');
            outline.setAttribute('opacity', '0.4');
            svg.appendChild(outline);
            c.addEventListener('mouseenter', e => showChartTooltip(e, p, svg));
            c.addEventListener('mouseleave', () => hideTooltip(svg));
            svg.appendChild(c);
        });
    });

    // Label Y axis
    svgText(svg, 14, PT + cH / 2, 'ms', '#888', 12, 'middle');
}

// Tooltip grafik — HTML overlay yang nempel ke <body> (position:fixed),
// BUKAN elemen di dalam <svg>/.chart-wrapper — supaya tidak pernah
// terpotong oleh overflow:hidden milik container chart.
//
// Isi tooltip: default hanya data server yang di-hover. Kalau ada dot
// server lain pada snapshot waktu yang sama yang posisinya berdempetan
// secara visual (jarak vertikal <= DOT_OVERLAP_PX), data server-server
// tsb ikut ditampilkan dalam satu tooltip.
function showChartTooltip(e, p, svg) {
    hideTooltip(svg);

    const siblings = currentPointsByIndex[p.i] || [p];
    let group = siblings.filter(q => Math.abs(q.y - p.y) <= DOT_OVERLAP_PX);
    if (!group.some(q => q.sv.name === p.sv.name)) group.push(p);
    group.sort((a, b) => a.y - b.y);

    const tsStr = fmtDTFull(p.h.timestamp);
    const lines = [{ text: `🕐 ${tsStr}`, head: true }];
    group.forEach(q => {
        const icon = q.d.status === 'UP' ? '🟢' : q.d.status === 'ERROR' ? '🟠' : '🔴';
        lines.push({ text: `${icon} ${q.sv.name}: ${q.d.status} (${q.d.rt}ms)`, head: false });
    });

    const tip = document.createElement('div');
    tip.id = 'chart-tooltip-html';
    tip.style.cssText = `
        position: fixed;
        z-index: 99999;
        background: rgba(15,15,25,0.97);
        border: 1.5px solid #667eea;
        border-radius: 8px;
        padding: 10px 12px;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        line-height: 1.7;
        color: #e0e0e0;
        pointer-events: none;
        max-width: 320px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    `;
    tip.innerHTML = lines.map(({ text, head }) => `<div style="
        color:${head ? '#a0c4ff' : '#e0e0e0'};
        white-space:nowrap;
        ${head ? 'border-bottom:1px solid #444;padding-bottom:5px;margin-bottom:5px;font-weight:600;' : ''}
    ">${escapeHtml(text)}</div>`).join('');
    document.body.appendChild(tip);

    // Posisikan relatif kursor, lalu jaga supaya tidak keluar dari tepi layar
    const rect = tip.getBoundingClientRect();
    let left = e.clientX + 16;
    let top  = e.clientY - rect.height - 12;
    if (left + rect.width > window.innerWidth - 8) left = e.clientX - rect.width - 16;
    if (left < 8) left = 8;
    if (top < 8) top = e.clientY + 16; // ga cukup ruang di atas → taruh di bawah kursor
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    tip.style.left = left + 'px';
    tip.style.top  = top + 'px';
}

function hideTooltip(svg) {
    const old = document.getElementById('chart-tooltip-html');
    if (old) old.remove();
    // jaga-jaga kalau ada versi lama (svg-based) yang masih nyangkut
    const oldSvg = svg?.querySelector?.('#chart-tooltip');
    if (oldSvg) oldSvg.remove();
}

// ═══════════════════════════════════════════════════════════════════
// 6. TABLE  (canonical 11 server dari servers.json)
// ═══════════════════════════════════════════════════════════════════
function renderTable(latest) {
    const tc = document.getElementById('tableContent');
    if (!tc) return;

    if (serverList.length === 0) {
        tc.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Memuat daftar server...</div>';
        return;
    }

    let html = `<table>
        <thead><tr>
            <th style="width:30px">No</th>
            <th>Nama Server</th>
            <th style="width:600px">History Status (dot = per-interval DB)</th>
            <th>Response Time</th>
            <th>Waktu Update</th>
            <th>Aksi</th>
        </tr></thead><tbody>`;

    serverList.forEach((sv, i) => {
        const color   = SERVER_COLORS[i % SERVER_COLORS.length];
        const latData = latest?.servers[sv.name];

        // Status terbaru
        const curStatus = latData?.status || '–';
        const curRt     = latData?.rt ?? '–';
        const curTs     = latData?.ts ? fmtDTFull(latData.ts) : '–';
        const sColor    = statusColor(curStatus);

        const badge = `<span style="display:inline-block;padding:3px 10px;border-radius:10px;
            background:${sColor};color:white;font-weight:600;font-size:0.82em;">${curStatus}</span>`;

        // Dot history dari seluruh historicalData
        const dots = buildDots(sv.name);

        html += `<tr>
            <td>${i + 1}</td>
            <td><span class="value-badge" style="background:${color};">${sv.name}</span></td>
            <td class="status-cell"><div class="status-dots">${dots}</div></td>
            <td style="font-weight:600;color:${sColor};">${curRt}${curRt !== '–' ? ' ms' : ''}</td>
            <td style="font-size:0.85em;">${curTs}</td>
            <td style="white-space:nowrap;">
                <button class="action-btn edit" onclick="showEditModal(${i})">Edit</button>
                <button class="action-btn delete" onclick="deleteServer(${i})">Delete</button>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';
    tc.innerHTML = html;

    // Auto-scroll dots ke kanan (terbaru)
    setTimeout(() => {
        tc.querySelectorAll('.status-dots').forEach(d => { d.scrollLeft = d.scrollWidth; });
    }, 50);
}

// Buat string dot HTML untuk satu server dari tableData (full 10s resolution)
function buildDots(serverName) {
    let html = '';
    tableData.forEach(h => {
        const d = h.servers[serverName];
        if (!d) return;
        const cls  = d.status === 'UP' ? 'status-dot-up' : d.status === 'ERROR' ? 'status-dot-error' : 'status-dot-down';
        const tip  = `${fmtDTFull(h.timestamp)}\nStatus: ${d.status}\nResponse: ${d.rt}ms`;
        html += `<div class="status-dot ${cls}" title="${tip}"></div>`;
    });
    return html || '<span style="color:var(--text-secondary);font-size:0.85em;font-style:italic;">Menunggu data...</span>';
}

// ═══════════════════════════════════════════════════════════════════
// 7. RANGE CONTROLS
// ═══════════════════════════════════════════════════════════════════
function renderRangeDropdown() {
    const el = document.getElementById('serverRangeButtons');
    if (!el) return;
    const opts = Object.keys(RANGES).map(r =>
        `<option value="${r}"${selectedRange === r ? ' selected' : ''}>${r}</option>`
    ).join('');
    el.innerHTML = `<select onchange="selectRange(this.value)" style="
        padding:7px 16px;border:2px solid var(--border-color);border-radius:20px;
        background:var(--card-bg);color:var(--card-text);font-size:0.9em;font-weight:600;
        cursor:pointer;outline:none;">
        ${opts}
    </select>`;
}

function selectRange(val) {
    filterMode    = 'relative';
    selectedRange = val;
    localStorage.setItem('ceismon_server_range', val);
    // Bersihkan input tanggal
    const f = document.getElementById('rangeFromInput');
    const t = document.getElementById('rangeToInput');
    if (f) f.value = '';
    if (t) t.value = '';
    hideBtnRealtime();
    startAutoRefresh();
    fetchFromDB();
}
window.selectRange = selectRange;

function applyDateRange() {
    const f = document.getElementById('rangeFromInput');
    const t = document.getElementById('rangeToInput');
    if (!f?.value || !t?.value) { showNotification('❌ Isi Dari dan Sampai tanggal!'); return; }
    filterMode = 'range';
    stopAutoRefresh(); // mode range = tidak auto-refresh
    showBtnRealtime();
    fetchFromDB();
}
window.applyDateRange = applyDateRange;

function resetToRealtime() {
    filterMode = 'relative';
    const f = document.getElementById('rangeFromInput');
    const t = document.getElementById('rangeToInput');
    if (f) f.value = '';
    if (t) t.value = '';
    hideBtnRealtime();
    startAutoRefresh();
    fetchFromDB();
}
window.resetToRealtime = resetToRealtime;

function showBtnRealtime() {
    const b = document.getElementById('btnRealtimeBack');
    if (b) b.style.display = 'inline-block';
}
function hideBtnRealtime() {
    const b = document.getElementById('btnRealtimeBack');
    if (b) b.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════
// 8. AUTO-REFRESH
// ═══════════════════════════════════════════════════════════════════
function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(fetchFromDB, REFRESH_MS);
}
function stopAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

function updateIndicator() {
    const el = document.getElementById('updateIndicator');
    if (!el) return;
    const now  = new Date();
    const ts   = `${pad2(now.getDate())}-${pad2(now.getMonth()+1)}-${now.getFullYear()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    const mode = filterMode === 'relative' ? selectedRange + ' terakhir' : 'range tanggal';
    el.textContent = ` ⟳ ${ts} [${mode}]`;
    // Pastikan tidak wrap ke bawah
    el.style.cssText = 'white-space:nowrap;font-size:0.78em;color:var(--text-secondary);font-style:italic;';
}

// ═══════════════════════════════════════════════════════════════════
// 9. DOWNLOAD MODAL
// ═══════════════════════════════════════════════════════════════════
function showDownloadLogModal() {
    const pad2 = n => String(n).padStart(2, '0');
    const fmt  = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const s = new Date(); s.setHours(0,0,0,0);
    const e = new Date(); e.setHours(23,59,0,0);
    const div = document.createElement('div');
    div.innerHTML = `
    <div id="dlModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;
        justify-content:center;align-items:center;z-index:10001;">
      <div style="background:var(--card-bg);padding:30px;border-radius:15px;
          box-shadow:0 10px 50px rgba(0,0,0,0.6);max-width:480px;width:90%;border:2px solid var(--border-color);">
        <div style="text-align:center;margin-bottom:20px;">
            <div style="font-size:2.5em;">📥</div>
            <h2 style="color:var(--card-text);margin:8px 0 0;">Download Log dari Database</h2>
            <p style="color:var(--text-secondary);font-size:0.9em;margin:8px 0 0;">Filter range tanggal &amp; jam</p>
        </div>
        <div style="margin-bottom:14px;">
            <label style="display:block;color:var(--text-secondary);margin-bottom:6px;font-weight:600;">Dari:</label>
            <input type="datetime-local" id="dlFrom" value="${fmt(s)}" style="width:100%;padding:10px;
                border:2px solid var(--border-color);border-radius:8px;background:var(--hover-bg);
                color:var(--card-text);font-size:1em;box-sizing:border-box;">
        </div>
        <div style="margin-bottom:18px;">
            <label style="display:block;color:var(--text-secondary);margin-bottom:6px;font-weight:600;">Sampai:</label>
            <input type="datetime-local" id="dlTo" value="${fmt(e)}" style="width:100%;padding:10px;
                border:2px solid var(--border-color);border-radius:8px;background:var(--hover-bg);
                color:var(--card-text);font-size:1em;box-sizing:border-box;">
        </div>
        <p style="color:var(--text-secondary);font-size:0.82em;background:var(--hover-bg);
            padding:10px 14px;border-radius:8px;border-left:3px solid #667eea;margin:0 0 18px;">
            📋 Format CSV — bisa dibuka di Excel. Kolom: Timestamp, Server, URL, Status, Response Time, HTTP Code, Error</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button onclick="closeDlModal()" style="padding:11px 22px;border:2px solid var(--border-color);
                border-radius:8px;background:transparent;color:var(--card-text);font-weight:600;cursor:pointer;">Batal</button>
            <button onclick="doDownload()" style="padding:11px 22px;border:none;border-radius:8px;
                background:linear-gradient(135deg,#21a366,#1e7e34);color:white;font-weight:600;cursor:pointer;">📥 Download CSV</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(div);
}
function closeDlModal() {
    const m = document.getElementById('dlModal');
    if (m?.parentElement) m.parentElement.remove();
}
function doDownload() {
    const f = document.getElementById('dlFrom');
    const t = document.getElementById('dlTo');
    if (!f?.value || !t?.value) { showNotification('❌ Isi range!'); return; }
    const from = encodeURIComponent(new Date(f.value).toISOString());
    const to   = encodeURIComponent(new Date(t.value).toISOString());
    window.location.href = `/api/server_download?from=${from}&to=${to}`;
    closeDlModal();
}
window.showDownloadLogModal = showDownloadLogModal;
window.closeDlModal         = closeDlModal;
window.doDownload           = doDownload;

// ═══════════════════════════════════════════════════════════════════
// 10. SERVER MANAGEMENT  (Add/Edit/Delete → servers.json)
// ═══════════════════════════════════════════════════════════════════
function validatePassword(cb) {
    const div = document.createElement('div');
    div.innerHTML = `
    <div id="pwModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;
        justify-content:center;align-items:center;z-index:10002;">
      <div style="background:var(--card-bg);padding:30px;border-radius:14px;
          max-width:380px;width:90%;border:2px solid var(--border-color);">
        <div style="text-align:center;margin-bottom:20px;"><div style="font-size:2.5em;">🔐</div>
          <h3 style="color:var(--card-text);margin:6px 0 0;">Password Admin</h3></div>
        <input type="password" id="pwInput" placeholder="••••••••" style="width:100%;padding:12px;
            border:2px solid var(--border-color);border-radius:8px;background:var(--hover-bg);
            color:var(--card-text);font-size:1em;box-sizing:border-box;margin-bottom:10px;">
        <div id="pwErr" style="color:#f44336;font-size:0.88em;display:none;margin-bottom:10px;">❌ Password salah!</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button onclick="document.getElementById('pwModal').parentElement.remove()" style="padding:10px 20px;
                border:2px solid var(--border-color);border-radius:8px;background:transparent;
                color:var(--card-text);font-weight:600;cursor:pointer;">Batal</button>
            <button id="pwOkBtn" style="padding:10px 20px;border:none;border-radius:8px;
                background:linear-gradient(135deg,#667eea,#764ba2);color:white;font-weight:600;cursor:pointer;">OK</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(div);
    const inp = document.getElementById('pwInput');
    const check = () => {
        if (inp.value === ADMIN_PASSWORD) {
            document.getElementById('pwModal').parentElement.remove();
            cb();
        } else {
            document.getElementById('pwErr').style.display = 'block';
            inp.value = ''; inp.focus();
        }
    };
    document.getElementById('pwOkBtn').onclick = check;
    inp.onkeydown = e => { if (e.key === 'Enter') check(); };
    setTimeout(() => inp.focus(), 80);
}

async function getRawServers() {
    try {
        const r    = await fetch('/api/servers');
        const data = await r.json();
        if (data.success) return data.servers;
    } catch(e) {}
    return [];
}
async function saveRawServers(data) {
    // Simpan kembali ke format asli (pertahankan url_env/key_env jika ada)
    const toSave = data.map(s => {
        const entry = { name: s.name };
        // Kalau punya url_env, simpan url_env (struktur env-based)
        if (s.url_env) {
            entry.url_env = s.url_env;
            entry.key_env = s.key_env || '';
        }
        // Kalau punya url langsung, simpan url
        if (s.url) entry.url = s.url;
        if (s.key) entry.key = s.key;
        // Method/headers/body kustom (hasil parsing curl), hanya disimpan jika bukan default
        if (s.method && s.method.toUpperCase() !== 'GET') entry.method = s.method.toUpperCase();
        if (s.headers && Object.keys(s.headers).length) entry.headers = s.headers;
        if (s.body) entry.body = s.body;
        return entry;
    });
    const r = await fetch('/save_servers.jsp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSave)
    });
    if (!r.ok) throw new Error('save failed');
}

function addNewServer() { validatePassword(() => {
    const div = document.createElement('div');
    div.innerHTML = modalHtml('➕ Tambah Server', '', '', '', 'GET',
        `saveNewServer()`, `document.getElementById('svModal').parentElement.remove()`);
    document.body.appendChild(div);
}); }

function showEditModal(idx) { validatePassword(async () => {
    const sv = serverList[idx];
    if (!sv) return;
    const div = document.createElement('div');
    // Kalau server ini punya headers/body non-default, tampilkan sebagai
    // perintah curl supaya bisa diedit langsung; kalau tidak, tampilkan URL polos saja
    // dan method-nya dikontrol lewat dropdown Method.
    const useCurlDisplay = needsCurlDisplay(sv);
    const urlFieldValue = useCurlDisplay ? buildCurlString(sv) : sv.url;
    div.innerHTML = modalHtml('✏️ Edit Server', sv.name, urlFieldValue, sv.key,
        (sv.method || 'GET').toUpperCase(),
        `saveEditServer(${idx})`, `document.getElementById('svModal').parentElement.remove()`);
    document.body.appendChild(div);
}); }

function modalHtml(title, name, url, key, method, onSave, onCancel) {
    const methodOptions = ['GET','POST','PUT','PATCH','DELETE'].map(m =>
        `<option value="${m}" ${m===(method||'GET')?'selected':''}>${m}</option>`).join('');
    return `<div id="svModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;
        justify-content:center;align-items:center;z-index:10002;">
      <div style="background:var(--card-bg);padding:30px;border-radius:14px;
          max-width:540px;width:90%;border:2px solid var(--border-color);">
        <h2 style="color:var(--card-text);margin:0 0 18px;">${title}</h2>
        ${field('Nama Server', 'svName', name, 'contoh: API Gateway')}
        <div style="margin-bottom:13px;">
            <label style="display:block;color:var(--text-secondary);margin-bottom:6px;font-weight:600;">Method:</label>
            <select id="svMethod" style="width:100%;padding:11px;border:2px solid var(--border-color);
                border-radius:8px;background:var(--hover-bg);color:var(--card-text);font-size:1em;box-sizing:border-box;">
                ${methodOptions}
            </select>
        </div>
        ${fieldTextarea('URL atau perintah cURL', 'svUrl', url,
            'https://contoh.com/health  —  atau paste perintah curl lengkap di sini')}
        <div style="margin:-8px 0 13px;font-size:0.8em;color:var(--text-secondary);line-height:1.5;">
            Isi URL biasa + pilih Method di atas untuk kasus sederhana (mis. POST tanpa body).
            Untuk butuh header (mis. Authorization) atau body kustom, paste perintah <code>curl</code>
            lengkap di sini — kalau diisi curl, method &amp; header dari curl akan dipakai
            (dropdown Method di atas diabaikan). Contoh:<br>
            <code style="display:block;margin-top:4px;padding:8px;background:var(--hover-bg);
                border-radius:6px;white-space:pre-wrap;word-break:break-all;">curl -X POST https://contoh.com/api -H 'Authorization: Bearer TOKEN' -H 'Content-Type: application/json' -d '{"foo":"bar"}'</code>
        </div>
        ${field('Keyword (opsional)', 'svKey', key, 'keyword response')}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;">
            <button onclick="${onCancel}" style="padding:11px 22px;border:2px solid var(--border-color);
                border-radius:8px;background:transparent;color:var(--card-text);font-weight:600;cursor:pointer;">Batal</button>
            <button onclick="${onSave}" style="padding:11px 22px;border:none;border-radius:8px;
                background:linear-gradient(135deg,#667eea,#764ba2);color:white;font-weight:600;cursor:pointer;">💾 Simpan</button>
        </div>
      </div>
    </div>`;
}
function field(label, id, val, ph) {
    return `<div style="margin-bottom:13px;">
        <label style="display:block;color:var(--text-secondary);margin-bottom:6px;font-weight:600;">${label}:</label>
        <input type="text" id="${id}" value="${escapeAttr(val||'')}" placeholder="${ph}" style="width:100%;padding:11px;
            border:2px solid var(--border-color);border-radius:8px;background:var(--hover-bg);
            color:var(--card-text);font-size:1em;box-sizing:border-box;">
    </div>`;
}
function fieldTextarea(label, id, val, ph) {
    return `<div style="margin-bottom:13px;">
        <label style="display:block;color:var(--text-secondary);margin-bottom:6px;font-weight:600;">${label}:</label>
        <textarea id="${id}" placeholder="${ph}" rows="3" style="width:100%;padding:11px;
            border:2px solid var(--border-color);border-radius:8px;background:var(--hover-bg);
            color:var(--card-text);font-size:0.92em;font-family:'Courier New',monospace;
            box-sizing:border-box;resize:vertical;">${escapeHtml(val||'')}</textarea>
    </div>`;
}
function escapeAttr(str) {
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// =====================================================================
// PARSING & BUILDING CURL COMMANDS
// =====================================================================
// Memungkinkan isian "URL" pada modal Tambah/Edit Server diisi dengan
// perintah curl lengkap (method, header seperti Authorization, dan body),
// bukan cuma URL polos untuk GET request seperti sebelumnya.

// Tokenizer sederhana ala shell: memecah string jadi array token,
// menghormati tanda kutip tunggal & ganda.
function tokenizeShellLike(str) {
    const tokens = [];
    let cur = '';
    let quote = null; // null | "'" | '"'
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (quote) {
            if (ch === quote) { quote = null; }
            else if (ch === '\\' && quote === '"' && i + 1 < str.length) { cur += str[++i]; }
            else { cur += ch; }
            continue;
        }
        if (ch === "'" || ch === '"') { quote = ch; continue; }
        if (/\s/.test(ch)) {
            if (cur) { tokens.push(cur); cur = ''; }
            continue;
        }
        if (ch === '\\' && i + 1 < str.length) { cur += str[++i]; continue; }
        cur += ch;
    }
    if (cur) tokens.push(cur);
    return tokens;
}

// Flag curl yang TIDAK punya argumen (boolean flags)
const CURL_NOARG_FLAGS = new Set([
    '-s','--silent','-S','--show-error','-k','--insecure','-L','--location',
    '-v','--verbose','-i','--include','-I','--head','-g','--globoff','-f','--fail',
    '-4','--ipv4','-6','--ipv6','--compressed','-#','--progress-bar','-n','--netrc',
    '-N','--no-buffer','--http1.1','--http2'
]);
// Flag curl yang punya argumen tapi TIDAK relevan untuk kita (dilewati saja)
const CURL_SKIP_WITH_ARG = new Set([
    '-A','--user-agent','-e','--referer','-b','--cookie','-c','--cookie-jar',
    '--connect-timeout','-m','--max-time','-o','--output','--retry',
    '--limit-rate','-w','--write-out','--cacert','--cert','--key'
]);

// Boundary generator untuk multipart/form-data (dipakai flag -F/--form)
function makeMultipartBoundary() {
    return '----CeisMonBoundary' + Array.from({length: 16}, () =>
        Math.floor(Math.random() * 16).toString(16)).join('');
}

// Rakit body multipart/form-data dari daftar field {name, value}, sesuai
// format yang dikirim curl saat pakai flag -F/--form.
function buildMultipartBody(fields, boundary) {
    let body = '';
    for (const f of fields) {
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="${f.name}"\r\n\r\n`;
        body += `${f.value}\r\n`;
    }
    body += `--${boundary}--\r\n`;
    return body;
}

function parseCurlCommand(raw) {
    let str = raw.trim().replace(/\\\r?\n/g, ' '); // gabungkan line-continuation
    str = str.replace(/^curl\s+/i, '');
    const tokens = tokenizeShellLike(str);

    let url = '';
    let method = '';
    const headers = {};
    let body = '';
    const formFields = [];

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === '-X' || t === '--request') { method = (tokens[++i] || '').toUpperCase(); continue; }
        if (t === '-H' || t === '--header') {
            const h = tokens[++i] || '';
            const idx = h.indexOf(':');
            if (idx > -1) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
            continue;
        }
        if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-ascii') {
            body = tokens[++i] || '';
            if (!method) method = 'POST';
            continue;
        }
        if (t === '-F' || t === '--form') {
            const f = tokens[++i] || '';
            const idx = f.indexOf('=');
            if (idx > -1) {
                const fname = f.slice(0, idx).trim();
                let fval = f.slice(idx + 1).trim();
                // curl menerima value diapit tanda kutip, mis. name="value" — tokenizer
                // sudah melucuti kutip terluar token, tapi kalau masih tersisa, bersihkan juga
                if ((fval.startsWith('"') && fval.endsWith('"')) || (fval.startsWith("'") && fval.endsWith("'"))) {
                    fval = fval.slice(1, -1);
                }
                if (fval.startsWith('@')) {
                    // upload file (@path) tidak didukung di sini — lewati fieldnya
                } else {
                    formFields.push({ name: fname, value: fval });
                }
            }
            if (!method) method = 'POST';
            continue;
        }
        if (t === '-u' || t === '--user') {
            const cred = tokens[++i] || '';
            headers['Authorization'] = 'Basic ' + btoa(cred);
            continue;
        }
        if (t === '--url') { url = tokens[++i] || ''; continue; }
        if (CURL_NOARG_FLAGS.has(t)) continue;
        if (CURL_SKIP_WITH_ARG.has(t)) { i++; continue; }
        if (t.startsWith('-')) continue; // flag lain yang tak dikenal, abaikan
        if (!url) url = t; // token pertama yang bukan flag = URL
    }

    // Kalau ada -F/--form, rakit jadi body multipart (mengalahkan -d kalau keduanya ada,
    // meski jarang dipakai bersamaan)
    if (formFields.length) {
        const boundary = makeMultipartBoundary();
        body = buildMultipartBody(formFields, boundary);
        // Content-Type wajib match boundary yang dipakai di body, jadi selalu ditimpa
        headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
    }

    return { url, method: method || 'GET', headers, body };
}

// Parse isian field "URL" pada modal: bisa berupa URL polos atau perintah curl.
// dropdownMethod dipakai hanya kalau isian BUKAN perintah curl (curl selalu menang
// karena bisa bawa -X sendiri).
function parseServerInput(raw, dropdownMethod) {
    const trimmed = (raw || '').trim();
    if (/^curl\s/i.test(trimmed)) return parseCurlCommand(trimmed);
    return { url: trimmed, method: (dropdownMethod || 'GET').toUpperCase(), headers: {}, body: '' };
}

function needsCurlDisplay(sv) {
    return !!(
        (sv.method && sv.method.toUpperCase() !== 'GET') ||
        (sv.headers && Object.keys(sv.headers).length) ||
        sv.body
    );
}

// Rekonstruksi perintah curl dari data server tersimpan, untuk ditampilkan
// kembali di modal Edit supaya method/header/body bisa diedit langsung.
function buildCurlString(sv) {
    let cmd = 'curl';
    if (sv.method && sv.method.toUpperCase() !== 'GET') cmd += ` -X ${sv.method.toUpperCase()}`;
    cmd += ` '${sv.url}'`;
    if (sv.headers) {
        for (const [k, val] of Object.entries(sv.headers)) {
            cmd += ` -H '${k}: ${val}'`;
        }
    }
    if (sv.body) cmd += ` -d '${sv.body}'`;
    return cmd;
}

async function saveNewServer() {
    const name = v('svName'), rawUrl = v('svUrl'), key = v('svKey'), methodSel = v('svMethod');
    if (!name || !rawUrl) { showNotification('❌ Nama dan URL wajib!'); return; }
    const { url, method, headers, body } = parseServerInput(rawUrl, methodSel);
    if (!url) { showNotification('❌ URL tidak terbaca, cek kembali isian/perintah curl!'); return; }
    try {
        const servers = await getRawServers();
        servers.push({ name, url, key, method, headers, body });
        await saveRawServers(servers);
        showNotification('✅ Server ditambahkan!');
        document.getElementById('svModal').parentElement.remove();
        await loadServerList();
        renderLegend(); renderTable(tableData[tableData.length-1] || null);
    } catch(e) { showNotification('❌ Gagal: ' + e.message); }
}
async function saveEditServer(idx) {
    const name = v('svName'), rawUrl = v('svUrl'), key = v('svKey'), methodSel = v('svMethod');
    if (!name || !rawUrl) { showNotification('❌ Nama dan URL wajib!'); return; }
    const { url, method, headers, body } = parseServerInput(rawUrl, methodSel);
    if (!url) { showNotification('❌ URL tidak terbaca, cek kembali isian/perintah curl!'); return; }
    try {
        const servers = await getRawServers();
        if (servers[idx]) {
            const old = servers[idx];
            // Pertahankan url_env/key_env jika ada, tapi timpa url/key/method/headers/body
            servers[idx] = {
                name,
                ...(old.url_env ? { url_env: old.url_env } : {}),
                ...(old.key_env ? { key_env: old.key_env } : {}),
                url,
                key,
                method,
                headers,
                body
            };
        }
        await saveRawServers(servers);
        showNotification('✅ Server diperbarui!');
        document.getElementById('svModal').parentElement.remove();
        await loadServerList();
        renderLegend(); renderTable(tableData[tableData.length-1] || null);
    } catch(e) { showNotification('❌ Gagal: ' + e.message); }
}
function deleteServer(idx) {
    validatePassword(async () => {
        if (!confirm(`Hapus server "${serverList[idx]?.name}"?`)) return;
        try {
            const servers = await getRawServers();
            servers.splice(idx, 1);
            await saveRawServers(servers);
            showNotification('✅ Server dihapus!');
            await loadServerList();
            fetchFromDB();
        } catch(e) { showNotification('❌ Gagal: ' + e.message); }
    });
}
window.addNewServer  = addNewServer;
window.showEditModal = showEditModal;
window.saveNewServer = saveNewServer;
window.saveEditServer = saveEditServer;
window.deleteServer  = deleteServer;

// ═══════════════════════════════════════════════════════════════════
// 11. HELPERS
// ═══════════════════════════════════════════════════════════════════
function statusColor(s) {
    if (s === 'UP')    return '#4CAF50';
    if (s === 'ERROR') return '#FF9800'; 
    if (s === 'DOWN')  return '#f44336';
    return '#9e9e9e';
}
function fmtDT(d, withDate) {
    if (!d) return '';
    if (withDate)
        return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function fmtDTFull(d) {
    if (!d) return '–';
    return `${pad2(d.getDate())}-${pad2(d.getMonth()+1)}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function pad2(n) { return String(n).padStart(2, '0'); }
function setEl(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }
function v(id) { return (document.getElementById(id)?.value || '').trim(); }

function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
function svgLine(svg, x1, y1, x2, y2, stroke, sw, opacity) {
    const l = svgEl('line');
    l.setAttribute('x1',x1); l.setAttribute('y1',y1);
    l.setAttribute('x2',x2); l.setAttribute('y2',y2);
    l.setAttribute('stroke', stroke); l.setAttribute('stroke-width', sw);
    if (opacity) l.setAttribute('opacity', opacity);
    svg.appendChild(l);
}
function svgText(svg, x, y, txt, fill, size, anchor) {
    const t = svgEl('text');
    t.setAttribute('x',x); t.setAttribute('y',y);
    t.setAttribute('fill',fill); t.setAttribute('font-size',size);
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = txt;
    svg.appendChild(t);
    return t;
}

let alarmUnlocked  = false; // browser butuh interaksi user dulu sebelum bisa autoplay audio
let pendingAlarm   = false; // jika alarm seharusnya bunyi tapi belum unlocked

function initAlarm() {
    alarmAudio = new Audio('css/alarm-301729c.mp3');
    alarmAudio.loop = true;
    alarmAudio.preload = 'auto';

    // Unlock audio context begitu user berinteraksi pertama kali (klik/tap/keydown)
    // Tanpa ini, browser modern (Chrome/Edge/Safari) memblokir play() otomatis
    const unlock = () => {
        if (alarmUnlocked) return;
        alarmUnlocked = true;
        // Trik unlock: play+pause sekali secara silent
        alarmAudio.volume = 0;
        alarmAudio.play().then(() => {
            alarmAudio.pause();
            alarmAudio.currentTime = 0;
            alarmAudio.volume = 1;
            // Kalau memang ada alarm yang tertunda, langsung bunyikan
            if (pendingAlarm) playAlarm();
        }).catch(() => {
            alarmAudio.volume = 1;
        });
        ['click','keydown','touchstart'].forEach(evt => document.removeEventListener(evt, unlock));
    };
    ['click','keydown','touchstart'].forEach(evt => document.addEventListener(evt, unlock, { once: false }));
}
function playAlarm() {
    if (!alarmAudio) return;
    if (!alarmUnlocked) { pendingAlarm = true; return; }
    pendingAlarm = false;
    if (alarmAudio.paused) {
        alarmAudio.play().catch(err => console.warn('Alarm gagal diputar:', err.message));
    }
}
function stopAlarm() {
    pendingAlarm = false;
    if (alarmAudio) { alarmAudio.pause(); alarmAudio.currentTime = 0; }
}

function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
    localStorage.setItem('theme', cur === 'dark' ? 'light' : 'dark');
}
function loadTheme() {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'light');
}
function showError(msg) {
    const c = document.getElementById('errorContainer');
    if (c) c.innerHTML = `<div class="error-message">⚠️ ${msg}</div>`;
}
function showNotification(msg) {
    if (Notification?.permission === 'granted') new Notification('CeisMon', { body: msg });
    const n = document.createElement('div');
    n.style.cssText = 'position:fixed;top:20px;right:20px;background:#333;color:#fff;padding:16px 20px;border-radius:10px;box-shadow:0 5px 20px rgba(0,0,0,0.4);z-index:20000;max-width:320px;';
    n.innerHTML = `${msg}<button onclick="this.parentElement.remove()" style="float:right;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;margin-left:12px;">×</button>`;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 5000);
}
window.toggleTheme = toggleTheme;

// ═══════════════════════════════════════════════════════════════════
// 12. INIT
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    loadTheme();
    initAlarm();
    if (Notification?.permission === 'default') Notification.requestPermission();

    const saved = localStorage.getItem('ceismon_server_range');
    if (saved && RANGES[saved]) selectedRange = saved;

    await loadServerList();
    renderRangeDropdown();

    await fetchFromDB();
    startAutoRefresh();
});