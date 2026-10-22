// CeisMon - Monitoring Grafik JavaScript
// =========================================================

// ==========================================
// CACHE - DIDEFINISIKAN PALING AWAL
// ==========================================
const CACHE_KEY       = 'ceismon_monitoring_v2';
const CACHE_KEY_STATE = 'ceismon_monitoring_state_v2';
const CACHE_MAX_DAYS  = 7;
const POINTS_PER_DAY  = 8640;

// BARU
function saveHistoryToCache() {
    // Batasi maksimal 500 titik di cache (cukup untuk display, hemat storage)
    const MAX_CACHE_POINTS = 500;
    let data = state.historyData.slice(-MAX_CACHE_POINTS);

    let attempts = 0;
    while (attempts < 6) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            // Berhasil — sync balik ke state supaya konsisten
            if (data.length < state.historyData.length) {
                state.historyData = state.historyData.slice(-MAX_CACHE_POINTS);
            }
            return;
        } catch (e) {
            attempts++;
            // Potong setengah setiap gagal
            data = data.slice(-Math.floor(data.length / 2));
            if (data.length < 10) {
                // Sudah terlalu kecil, bersihkan semua cache lama dulu
                try {
                    localStorage.removeItem(CACHE_KEY);
                    localStorage.removeItem(CACHE_KEY_STATE);
                    // Hapus juga log harian CeisMon jika ada
                    Object.keys(localStorage)
                        .filter(k => k.startsWith('ceismon_'))
                        .forEach(k => localStorage.removeItem(k));
                    console.warn('Cache dibersihkan karena storage penuh.');
                } catch (_) {}
                return;
            }
        }
    }
}

function saveStateToCache() {
    try {
        localStorage.setItem(CACHE_KEY_STATE, JSON.stringify({
            selectedCategory: state.selectedCategory,
            selectedRange:    state.selectedRange
        }));
    } catch (e) {}
}

function restoreHistoryFromCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return;
        const cutoff = Date.now() - (CACHE_MAX_DAYS * 24 * 60 * 60 * 1000);
        if (parsed[0] && parsed[0].isoTime) {
            state.historyData = parsed.filter(p => p.isoTime >= cutoff);
        } else {
            const now = Date.now();
            parsed.forEach((p, i) => { p.isoTime = now - ((parsed.length - i) * 10000); });
            state.historyData = parsed.filter(p => p.isoTime >= cutoff);
        }
        console.log('Cache restored:', state.historyData.length, 'points');
    } catch (e) {
        console.warn('Restore cache failed:', e);
        localStorage.removeItem(CACHE_KEY);
    }
}

function restoreStateFromCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY_STATE);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.selectedCategory) state.selectedCategory = saved.selectedCategory;
        if (saved.selectedRange)    state.selectedRange    = saved.selectedRange;
    } catch (e) {}
}

// ==========================================
// KONFIGURASI
// ==========================================
const CONFIG = {
    UPDATE_INTERVAL: 10000,
    MAX_DATA_POINTS: POINTS_PER_DAY * CACHE_MAX_DAYS,
    SERVLET_URL: window.location.origin + '/DataServlet',
};

// ==========================================
// STATE
// ==========================================
const state = {
    historyData:      [],
    currentData:      null,
    selectedCategory: 'VALIDASI',
    hiddenDatasets:   new Set(),
    selectedRange:    '1 Jam'
};

const RANGES = {
    '1 Jam':  60,
    '6 Jam':  360,
    '12 Jam': 720,
    '1 Hari': 1440,
    '3 Hari': 4320,
    '7 Hari': 10080
};

const CATEGORIES = {
    BILLING:    ['KIRIM BILLING', 'GAGAL KIRIM BILLING', 'TUNGGU REKON'],
    CN:         ['VALIDASI CN', 'PENJALURAN CN'],
    KIRIM:      ['ANTRIAN KIRIM LNSW'],
    PROSES:     ['TUNGGU PROSES LNSW'],
    VALIDASI:   ['VALIDASI DOKUMEN'],
    JALUR:      ['SIAP DIJALURKAN'],
    PENJALURAN: ['PROSES PENJALURAN'],
    PERBAIKAN:  ['VALIDASI PERBAIKAN'],
    PINDAH:     ['PROSES PINDAH DATA'],
    REJECT:     ['REJECT DOKUMEN'],
    NOPEN:     ['TOTAL NOPEN'],
    WEBHOOK:     ['WEBHOOK']
};

const COLORS = [
    '#4CAF50', '#2196F3', '#FF9800', '#E91E63',
    '#9C27B0', '#00BCD4', '#FFEB3B', '#795548',
    '#3F51B5', '#8BC34A'
];

// ==========================================
// TOOLTIP HELPER
// ==========================================
function _positionTooltip(tip, e) {
    const margin = 15;
    const tw = tip.offsetWidth  || 220;
    const th = tip.offsetHeight || 100;
    let tx = e.clientX + margin;
    let ty = e.clientY + margin;
    if (tx + tw > window.innerWidth  - 10) tx = e.clientX - tw - margin;
    if (ty + th > window.innerHeight - 10) ty = e.clientY - th - margin;
    tip.style.left = tx + 'px';
    tip.style.top  = ty + 'px';
}

// ==========================================
// THEME
// ==========================================
function toggleTheme() {
    const cur  = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
}

function loadTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
}

// ==========================================
// FORMAT TIMESTAMP
// ==========================================
function formatTimestamp(date) {
    const d  = String(date.getDate()).padStart(2, '0');
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const y  = date.getFullYear();
    const h  = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s  = String(date.getSeconds()).padStart(2, '0');
    return `${d}-${mo}-${y} ${h}:${mi}:${s}`;
}

// ==========================================
// ERROR HANDLING
// ==========================================
function clearError() {
    const el = document.getElementById('errorContainer');
    if (el) el.innerHTML = '';
}

function showError(message) {
    const el = document.getElementById('errorContainer');
    if (el) el.innerHTML = `<div class="error-message"><strong>⚠️ Error:</strong> Tidak dapat mengambil data! (${message})</div>`;
}

// ==========================================
// FETCH DATA
// ==========================================
async function fetchData() {
    try {
        const indicator = document.getElementById('updateIndicator');
        if (indicator) indicator.style.cssText = 'display:inline-block;width:10px;height:10px;border-radius:50%;background:#f6e05e;margin-left:8px;vertical-align:middle;';
        const response = await fetch(CONFIG.SERVLET_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        clearError();
        if (indicator) indicator.style.cssText = '';
        return data;
    } catch (error) {
        showError(error.message);
        return null;
    }
}

// ==========================================
// UPDATE DATA
// ==========================================
async function updateData() {
    const data = await fetchData();
    if (!data) return;
    const now       = new Date();
    const timestamp = formatTimestamp(now);
    const isoTime   = now.getTime();
    state.currentData = data;
    state.historyData.push({ timestamp, isoTime, postgreData: data.postgreData || [], oracleData: data.oracleData || [] });
    const cutoff = Date.now() - (CACHE_MAX_DAYS * 24 * 60 * 60 * 1000);
    state.historyData = state.historyData.filter(p => p.isoTime >= cutoff);
    saveHistoryToCache();
    updateUI(timestamp);
}

function getFilteredHistory() {
    const minutes = RANGES[state.selectedRange] || 60;
    const cutoff  = Date.now() - (minutes * 60 * 1000);
    return state.historyData.filter(p => p.isoTime >= cutoff);
}

// ==========================================
// UPDATE UI
// ==========================================
function updateUI(timestamp) {
    const dp = document.getElementById('dataPoints');
    if (dp) dp.textContent = state.historyData.length;
    const lu = document.getElementById('lastUpdate');
    if (lu) lu.textContent = timestamp;
    const subtitle = document.querySelector('.subtitle');
    if (subtitle) {
        const indicator = subtitle.querySelector('.update-indicator');
        const indicatorHTML = indicator ? indicator.outerHTML : '';
        subtitle.innerHTML = "Real-time Data Monitoring Dokumen Ceisa 4.0<br>" +
            `<small>Terakhir diupdate: ${timestamp}</small> ${indicatorHTML}`;
    }
    drawChart();
    updateTable();
}

// ==========================================
// CATEGORY & RANGE SELECTION
// ==========================================
function selectCategory(category, el) {
    state.selectedCategory = category;
    state.hiddenDatasets.clear();
    document.querySelectorAll('.category-btn').forEach(btn => btn.classList.remove('active'));
    if (el) el.classList.add('active');
    const title = document.getElementById('categoryTitle');
    if (title) title.textContent = category;
    saveStateToCache();
    drawChart();
    updateTable();
}

function selectRange(val) {
    state.selectedRange = val;
    saveStateToCache();
    drawChart();
}

function toggleDataset(label) {
    if (state.hiddenDatasets.has(label)) {
        state.hiddenDatasets.delete(label);
    } else {
        state.hiddenDatasets.add(label);
    }
    drawChart();
    updateTable();
}

// ==========================================
// PREPARE DATASETS
// ==========================================
function prepareDatasets(categoryList, filteredHistory) {
    const datasets = new Map();
    filteredHistory.forEach(item => {
        categoryList.forEach(cat => {
            const pg = (item.postgreData || []).find(d => d.KATEGORI === cat);
            if (pg) addToDataset(datasets, pg, 'KATEGORI');
            const or = (item.oracleData || []).find(d => d.kategori === cat);
            if (or) addToDataset(datasets, or, 'kategori');
        });
    });
    return datasets;
}

function addToDataset(datasets, item, categoryKey) {
    Object.keys(item).forEach(key => {
        if (key !== categoryKey) {
            const fieldName = `${item[categoryKey]}_${key}`;
            if (!datasets.has(fieldName)) datasets.set(fieldName, []);
            datasets.get(fieldName).push(parseInt(item[key]) || 0);
        }
    });
}

function findMaxValue(datasets) {
    let maxVal = 0;
    datasets.forEach((data, label) => {
        if (state.hiddenDatasets.has(label)) return;
        data.forEach(val => { const n = parseInt(val) || 0; if (n > maxVal) maxVal = n; });
    });
    return maxVal > 0 ? Math.ceil(maxVal * 1.1) : 100;
}

// ==========================================
// DRAW CHART
// ==========================================
function drawChart() {
    const svg = document.getElementById('lineChart');
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const parent = svg.parentElement;
    const width  = (parent ? parent.clientWidth : 0) || svg.clientWidth || 800;
    const height = 350;
    svg.setAttribute('width',  width);
    svg.setAttribute('height', height);

    // BARU
let filteredHistory = getFilteredHistory();

// Fallback: kalau filtered kosong tapi ada data history, pakai 1 titik terakhir
if (filteredHistory.length === 0 && state.historyData.length > 0) {
    filteredHistory = [state.historyData[state.historyData.length - 1]];
}

if (!filteredHistory || filteredHistory.length === 0) {
    drawEmptyMessage(svg, width, height, 'Menunggu data...');
    return;
}

    const categoryList = CATEGORIES[state.selectedCategory] || [];
    const datasets     = prepareDatasets(categoryList, filteredHistory);

    if (!datasets || datasets.size === 0) {
        drawEmptyMessage(svg, width, height, 'Tidak ada data untuk kategori ini');
        return;
    }

    const padding = 60;
    const chartW  = width  - padding * 2;
    const chartH  = height - padding * 2;
    const maxVal  = findMaxValue(datasets);

    // ── GRID ──
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const y = height - padding - (i * chartH / gridLines);
        const gl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        gl.setAttribute('x1', padding); gl.setAttribute('y1', y);
        gl.setAttribute('x2', width - padding); gl.setAttribute('y2', y);
        gl.setAttribute('stroke', '#e0e0e0'); gl.setAttribute('stroke-width', '1'); gl.setAttribute('opacity', '0.3');
        svg.appendChild(gl);
        const glbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        glbl.setAttribute('x', padding - 10); glbl.setAttribute('y', y + 5);
        glbl.setAttribute('text-anchor', 'end'); glbl.setAttribute('fill', '#888'); glbl.setAttribute('font-size', '11');
        glbl.textContent = Math.round((i * maxVal) / gridLines);
        svg.appendChild(glbl);
    }

    // ── BUILD label→color map (konsisten, tidak tergantung sort) ──
    const labelColorMap = new Map();
    let ci = 0;
    datasets.forEach((_, lbl) => { labelColorMap.set(lbl, COLORS[ci++ % COLORS.length]); });

    // ── Kumpulkan dots per time-index untuk tooltip multi-dataset ──
    const dotsByIndex = {};

    const legendHTML = [];
    const sortedEntries = [...datasets.entries()].sort((a, b) =>
        (state.hiddenDatasets.has(a[0]) ? 1 : 0) - (state.hiddenDatasets.has(b[0]) ? 1 : 0)
    );

    sortedEntries.forEach(([label, data]) => {
        const color    = labelColorMap.get(label);
        const isHidden = state.hiddenDatasets.has(label);

        if (!isHidden) {
            const points = data.map((value, index) => ({
                x: padding + (index * (chartW / Math.max(1, filteredHistory.length - 1))),
                y: height - padding - ((value / maxVal) * chartH),
                value, index
            }));

            // Garis
            // BARU — 1 titik tetap tampil sebagai garis horizontal pendek
if (points.length === 1) {
    const p = points[0];
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${p.x - 10},${p.y} L ${p.x + 10},${p.y}`);
    path.setAttribute('stroke', color);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-dasharray', '4,3');
    svg.appendChild(path);
} else if (points.length > 1) {
    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) d += ` L ${points[i].x},${points[i].y}`;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', color);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);
}

            // Dots - kumpulkan per index, gambar circle TANPA <title>
            points.forEach(p => {
                if (!dotsByIndex[p.index]) dotsByIndex[p.index] = { x: p.x, items: [] };
                dotsByIndex[p.index].items.push({ label, value: p.value, color });

                const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
                dot.setAttribute('r', '4'); dot.setAttribute('fill', color);
                dot.setAttribute('stroke', 'none'); dot.setAttribute('data-idx', p.index);
                dot.style.cursor = 'pointer';
                svg.appendChild(dot);
            });
        }

        const hiddenClass = isHidden ? ' hidden' : '';
        legendHTML.push(
            `<div class="legend-item${hiddenClass}" data-label="${label.replace(/"/g, '&quot;')}">` +
            `<div class="legend-color" style="background:${color}"></div><span>${label}</span></div>`
        );
    });

    // ── PASANG EVENT HOVER → custom HTML tooltip multi-dataset ──
    svg.querySelectorAll('circle[data-idx]').forEach(dot => {
        dot.addEventListener('mouseenter', (e) => {
            const idx  = parseInt(dot.getAttribute('data-idx'));
            const info = dotsByIndex[idx];
            const ts   = filteredHistory[idx]?.timestamp || '';
            if (!info) return;

            const rows = info.items.map(it =>
                `<div style="display:flex;align-items:center;gap:6px;margin-top:5px;">
                    <span style="width:10px;height:10px;border-radius:50%;background:${it.color};flex-shrink:0;display:inline-block;"></span>
                    <span style="color:#bbb;flex:1;">${it.label}:</span>
                    <strong style="color:#fff;">${it.value}</strong>
                </div>`
            ).join('');

            const tip = document.getElementById('chartTooltip');
            tip.innerHTML =
                `<div style="color:#4FC3F7;font-weight:bold;margin-bottom:6px;font-size:0.85em;">📅 ${ts}</div>` +
                `<div style="border-top:1px solid #444;padding-top:5px;">${rows}</div>`;
            tip.style.display = 'block';
            _positionTooltip(tip, e);

            // Perbesar semua dot di index yang sama
            svg.querySelectorAll(`circle[data-idx="${idx}"]`).forEach(d => d.setAttribute('r', '6'));
        });

        dot.addEventListener('mousemove', (e) => {
            const tip = document.getElementById('chartTooltip');
            if (tip.style.display === 'block') _positionTooltip(tip, e);
        });

        dot.addEventListener('mouseleave', () => {
            document.getElementById('chartTooltip').style.display = 'none';
            const idx = dot.getAttribute('data-idx');
            svg.querySelectorAll(`circle[data-idx="${idx}"]`).forEach(d => d.setAttribute('r', '4'));
        });
    });

    // ── X LABELS ──
    const showDate = RANGES[state.selectedRange] > 1440;
    const timeStep = Math.max(1, Math.floor(filteredHistory.length / 8));
    filteredHistory.forEach((item, i) => {
        if (i % timeStep === 0 || i === filteredHistory.length - 1) {
            const x = padding + (i * (chartW / Math.max(1, filteredHistory.length - 1)));
            const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            lbl.setAttribute('x', x); lbl.setAttribute('y', height - padding + 20);
            lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('fill', '#888'); lbl.setAttribute('font-size', '10');
            lbl.textContent = item.timestamp ? (showDate ? item.timestamp.substring(0, 14) : item.timestamp.substring(11)) : '';
            svg.appendChild(lbl);
        }
    });

    // ── TIME LABEL ──
    const timeLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    timeLbl.setAttribute('x', width / 2); timeLbl.setAttribute('y', height - 5);
    timeLbl.setAttribute('text-anchor', 'middle'); timeLbl.setAttribute('fill', '#888'); timeLbl.setAttribute('font-size', '12');
    timeLbl.textContent = 'Time';
    svg.appendChild(timeLbl);

    // ── LEGEND ──
    const legendEl = document.getElementById('legend');
    if (legendEl) {
        legendEl.innerHTML = legendHTML.join('');
        legendEl.querySelectorAll('.legend-item').forEach(el => {
            el.addEventListener('click', function () { toggleDataset(this.getAttribute('data-label')); });
        });
    }
}

function drawEmptyMessage(svg, width, height, msg) {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', width / 2); text.setAttribute('y', height / 2);
    text.setAttribute('text-anchor', 'middle'); text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('fill', '#888'); text.setAttribute('font-size', '14');
    text.textContent = msg || 'Menunggu data...';
    svg.appendChild(text);
}

// ==========================================
// ANALISIS TREN OTOMATIS - ENHANCED
// ==========================================
function analyzeTrends(datasets, filteredHistory) {
    const results = [];
    const labelColorMap = new Map();
    let ci = 0;
    datasets.forEach((_, lbl) => { labelColorMap.set(lbl, COLORS[ci++ % COLORS.length]); });

    datasets.forEach((data, label) => {
        if (state.hiddenDatasets.has(label)) return;
        if (data.length < 3) return;

        const color = labelColorMap.get(label);
        const shortLabel = label.includes('_')
            ? label.split('_').slice(1).join('_').toUpperCase()
            : label;

        // ── DETEKSI SEGMEN NAIK (minimal 3 titik berurutan naik) ──
        const risingSegments = [];
        let segStart = null;
        for (let i = 1; i < data.length; i++) {
            if (data[i] > data[i - 1]) {
                if (segStart === null) segStart = i - 1;
            } else {
                if (segStart !== null && (i - 1 - segStart) >= 2) {
                    risingSegments.push({ type: 'naik', from: segStart, to: i - 1 });
                }
                segStart = null;
            }
        }
        if (segStart !== null && (data.length - 1 - segStart) >= 2) {
            risingSegments.push({ type: 'naik', from: segStart, to: data.length - 1 });
        }

        // ── DETEKSI SEGMEN STUCK (nilai sama/±1% selama minimal 5 titik) ──
        const stuckSegments = [];
        let stuckStart = null;
        const STUCK_THRESHOLD = 0.01; // toleransi 1%
        for (let i = 1; i < data.length; i++) {
            const base = data[stuckStart !== null ? stuckStart : i - 1];
            const diff = base > 0 ? Math.abs(data[i] - base) / base : Math.abs(data[i] - base);
            if (diff <= STUCK_THRESHOLD && data[i] > 0) {
                if (stuckStart === null) stuckStart = i - 1;
            } else {
                if (stuckStart !== null && (i - 1 - stuckStart) >= 4) {
                    stuckSegments.push({ type: 'stuck', from: stuckStart, to: i - 1 });
                }
                stuckStart = null;
            }
        }
        if (stuckStart !== null && (data.length - 1 - stuckStart) >= 4) {
            stuckSegments.push({ type: 'stuck', from: stuckStart, to: data.length - 1 });
        }

        // ── Gabungkan semua segmen & ambil yang paling signifikan ──
        const allSegments = [...risingSegments, ...stuckSegments];
        if (allSegments.length === 0) return;

        // Sort: naik → by delta, stuck → by durasi
        allSegments.sort((a, b) => {
            const scoreA = a.type === 'naik'
                ? (data[a.to] - data[a.from])
                : (a.to - a.from) * (data[a.from] || 1);
            const scoreB = b.type === 'naik'
                ? (data[b.to] - data[b.from])
                : (b.to - b.from) * (data[b.from] || 1);
            return scoreB - scoreA;
        });

        // Ambil top 2 segmen per dataset (naik + stuck jika ada)
        const seen = { naik: 0, stuck: 0 };
        const maxPerType = 2;

        allSegments.forEach(seg => {
            if (seen[seg.type] >= maxPerType) return;
            seen[seg.type]++;

            const tsFrom = filteredHistory[seg.from]?.timestamp || '';
            const tsTo   = filteredHistory[seg.to]?.timestamp   || '';
            const timeFrom = tsFrom.length >= 19 ? tsFrom.substring(11, 16) : tsFrom;
            const timeTo   = tsTo.length   >= 19 ? tsTo.substring(11, 16)   : tsTo;
            const dateFrom = tsFrom.length >= 10 ? tsFrom.substring(0, 10)  : '';
            const dateTo   = tsTo.length   >= 10 ? tsTo.substring(0, 10)    : '';

            // Hitung durasi dalam menit
            const msFrom   = filteredHistory[seg.from]?.isoTime || 0;
            const msTo     = filteredHistory[seg.to]?.isoTime   || 0;
            const durasiMs = msTo - msFrom;
            const durasiMn = Math.round(durasiMs / 60000);
            const durasiStr = durasiMn >= 60
                ? `${Math.floor(durasiMn / 60)}j ${durasiMn % 60}m`
                : `${durasiMn}m`;

            const delta     = data[seg.to] - data[seg.from];
            const pctChange = data[seg.from] > 0
                ? Math.round((delta / data[seg.from]) * 100)
                : 0;

            // Apakah tanggal beda?
            const crossDay = dateFrom && dateTo && dateFrom !== dateTo;
            const timeLabel = crossDay
                ? `${dateFrom} ${timeFrom} s/d ${dateTo} ${timeTo}`
                : `${dateFrom} ${timeFrom} s/d ${timeTo}`;

            results.push({
                label, shortLabel, color,
                type:    seg.type,
                delta,   pctChange,
                fromVal: data[seg.from],
                toVal:   data[seg.to],
                timeLabel,
                durasiStr
            });
        });
    });

    // Sort final: naik dulu, lalu stuck; dalam grup → delta/durasi terbesar
    results.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'naik' ? -1 : 1;
        return Math.abs(b.delta) - Math.abs(a.delta);
    });

    return results;
}

// ==========================================
// DOWNLOAD PNG + ANALISIS TREN
// ==========================================
function downloadChartPNG() {
    const svg = document.getElementById('lineChart');
    if (!svg) return;

    const svgWidth  = parseInt(svg.getAttribute('width'))  || 800;
    const svgHeight = parseInt(svg.getAttribute('height')) || 350;

    const filteredHistory = getFilteredHistory();
    const categoryList    = CATEGORIES[state.selectedCategory] || [];
    const datasets        = prepareDatasets(categoryList, filteredHistory);
    const trends          = analyzeTrends(datasets, filteredHistory);

    const lineH     = 22;
    const padAnalys = 20;
    const headerH   = 36;
    const analysisH = trends.length > 0
        ? headerH + (trends.length * lineH) + padAnalys * 2
        : 0;

    const totalH  = svgHeight + (analysisH > 0 ? analysisH + 10 : 0);
    const isDark  = document.documentElement.getAttribute('data-theme') === 'dark';
    const bgColor = isDark ? '#1a2035' : '#ffffff';
    const textCol = isDark ? '#cccccc' : '#333333';

    // ── Clone & clean SVG ──
    const svgClone = svg.cloneNode(true);
    svgClone.setAttribute('xmlns',       'http://www.w3.org/2000/svg');
    svgClone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    svgClone.setAttribute('width',  svgWidth);
    svgClone.setAttribute('height', svgHeight);

    // Inject background rect as first child
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('width',  svgWidth);
    bgRect.setAttribute('height', svgHeight);
    bgRect.setAttribute('fill',   bgColor);
    svgClone.insertBefore(bgRect, svgClone.firstChild);

    // Remove any foreignObject elements (not supported in canvas)
    svgClone.querySelectorAll('foreignObject').forEach(el => el.remove());

    // Serialize
    const serializer = new XMLSerializer();
    const svgStr     = serializer.serializeToString(svgClone);

    // Encode as base64 data URI (avoids Blob/URL CSP issues)
    const svgBase64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));

    const scale   = 2;
    const canvas  = document.createElement('canvas');
    canvas.width  = svgWidth  * scale;
    canvas.height = totalH    * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, svgWidth, totalH);

    const img = new Image();

    img.onload = () => {
        ctx.drawImage(img, 0, 0, svgWidth, svgHeight);

        // ── Analysis section ──
        if (trends.length > 0) {
            const ay = svgHeight + 10;

            ctx.fillStyle = isDark ? '#252d45' : '#f0f4ff';
            ctx.beginPath();
            ctx.roundRect(10, ay, svgWidth - 20, analysisH, 8);
            ctx.fill();

            ctx.strokeStyle = '#667eea';
            ctx.lineWidth   = 2;
            ctx.beginPath();
            ctx.moveTo(10, ay); ctx.lineTo(svgWidth - 10, ay);
            ctx.stroke();

            ctx.font      = 'bold 13px sans-serif';
            ctx.fillStyle = '#667eea';
            ctx.textAlign = 'left';
            ctx.fillText('Analisis Tren Kenaikan Tertinggi', 20, ay + 24);

            const nowStr = formatTimestamp(new Date());
            ctx.font      = '10px sans-serif';
            ctx.fillStyle = isDark ? '#888' : '#999';
            ctx.textAlign = 'right';
            ctx.fillText(`Range: ${state.selectedRange}  |  Dibuat: ${nowStr}`, svgWidth - 20, ay + 24);
            ctx.textAlign = 'left';

            ctx.strokeStyle = isDark ? '#333' : '#ddd';
            ctx.lineWidth   = 1;
            ctx.beginPath();
            ctx.moveTo(20, ay + 32); ctx.lineTo(svgWidth - 20, ay + 32);
            ctx.stroke();

            trends.forEach((t, i) => {
    const ly = ay + headerH + (i * lineH);

    // Dot warna
    ctx.fillStyle = t.color;
    ctx.beginPath();
    ctx.arc(28, ly + 7, 5, 0, Math.PI * 2);
    ctx.fill();

    // Badge tipe: NAIK / STUCK
    const badgeColor = t.type === 'naik' ? '#43a047' : '#fb8c00';
    const badgeText  = t.type === 'naik' ? '▲ NAIK' : '⏸ STUCK';
    ctx.fillStyle    = badgeColor;
    ctx.font         = 'bold 9px sans-serif';
    const badgeW     = ctx.measureText(badgeText).width + 8;
    ctx.beginPath();
    ctx.roundRect(38, ly + 1, badgeW, 13, 3);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(badgeText, 42, ly + 11);

    // Nama field
    ctx.font      = 'bold 11px sans-serif';
    ctx.fillStyle = textCol;
    ctx.fillText(t.shortLabel, 38 + badgeW + 6, ly + 11);

    // Deskripsi
    let desc = '';
    if (t.type === 'naik') {
        desc = `${t.timeLabel}  (durasi ${t.durasiStr})  ${t.fromVal} → ${t.toVal}  [+${t.delta}  +${t.pctChange}%]`;
    } else {
        desc = `${t.timeLabel}  (durasi ${t.durasiStr})  nilai stagnan ±${t.fromVal}`;
    }

    ctx.font      = '10px sans-serif';
    ctx.fillStyle = isDark ? '#aaa' : '#555';
    const labelW  = ctx.measureText(t.shortLabel).width + badgeW + 50;
    ctx.fillText(desc, 38 + labelW, ly + 11);

    // Separator
    if (i < trends.length - 1) {
        ctx.strokeStyle = isDark ? '#2a3350' : '#e8ecf8';
        ctx.lineWidth   = 0.5;
        ctx.beginPath();
        ctx.moveTo(20, ly + lineH - 2); ctx.lineTo(svgWidth - 20, ly + lineH - 2);
        ctx.stroke();
    }
});

        }

        // ── Download ──
        canvas.toBlob((pngBlob) => {
            const blobUrl = URL.createObjectURL(pngBlob);
            const link    = document.createElement('a');
            const now     = new Date();
            link.download = `CeisMon_${state.selectedCategory}_${formatTimestamp(now).replace(/[-: ]/g, '').substring(0, 14)}.png`;
            link.href     = blobUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        }, 'image/png');
    };

    img.onerror = (e) => {
        console.error('SVG render error (base64 method failed):', e);
        alert('Gagal membuat PNG. Coba refresh halaman lalu download ulang.');
    };

    img.src = svgBase64;
}

// ==========================================
// TABLE UPDATE
// ==========================================
function updateTable() {
    if (!state.currentData) return;
    const categoryList = CATEGORIES[state.selectedCategory] || [];
    let html = '<table><thead><tr><th>Kategori</th><th>Detail</th></tr></thead><tbody>';
    categoryList.forEach(cat => {
        const pg   = state.currentData.postgreData.find(d => d.KATEGORI === cat);
        const or   = state.currentData.oracleData.find(d => d.kategori === cat);
        const item = pg || or;
        if (item) {
            html += `<tr><td><strong>${cat}</strong></td><td>`;
            Object.entries(item).forEach(([key, value]) => {
                if (key !== 'KATEGORI' && key !== 'kategori')
                    html += `<span class="value-badge">${key}: ${value}</span>`;
            });
            html += '</td></tr>';
        }
    });
    html += '</tbody></table>';
    const el = document.getElementById('tableContent');
    if (el) el.innerHTML = html;
}

// ==========================================
// RENDER RANGE DROPDOWN
// ==========================================
function renderRangeButtons() {
    const container = document.getElementById('rangeButtons');
    if (!container) return;
    const options = Object.keys(RANGES).map(r =>
        `<option value="${r}"${state.selectedRange === r ? ' selected' : ''}>${r}</option>`
    ).join('');
    container.innerHTML = `
        <select onchange="selectRange(this.value)" style="
            padding:7px 14px;border:2px solid var(--border-color);border-radius:20px;
            background:var(--card-bg);color:var(--card-text);font-size:0.9em;font-weight:600;
            cursor:pointer;outline:none;">
            ${options}
        </select>`;
}

// ==========================================
// INITIALIZATION
// ==========================================
async function init() {
    console.log("CeisMon Monitoring initializing...");
    loadTheme();
    restoreStateFromCache();
    restoreHistoryFromCache();
    renderRangeButtons();

    const title = document.getElementById('categoryTitle');
    if (title) title.textContent = state.selectedCategory;
    document.querySelectorAll('.category-btn').forEach(btn => {
        const oc = btn.getAttribute('onclick') || '';
        if (oc.includes(`'${state.selectedCategory}'`) || oc.includes(`"${state.selectedCategory}"`)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    if (state.historyData.length > 0) {
        const last = state.historyData[state.historyData.length - 1];
        state.currentData = { postgreData: last.postgreData || [], oracleData: last.oracleData || [] };
        setTimeout(() => updateUI(last.timestamp), 0);
    }

    await updateData();
    setInterval(updateData, CONFIG.UPDATE_INTERVAL);
    console.log("Initialized. History:", state.historyData.length, "points");
}

window.addEventListener('resize', () => {
    clearTimeout(window._resizeTimer);
    window._resizeTimer = setTimeout(drawChart, 200);
});

document.addEventListener('DOMContentLoaded', init);

window.toggleTheme      = toggleTheme;
window.toggleDataset    = toggleDataset;
window.selectCategory   = selectCategory;
window.selectRange      = selectRange;
window.downloadChartPNG = downloadChartPNG;