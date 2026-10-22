// ============================================================================
// CEISMON — tiket.js (FIXED)
// Kompatibel penuh dengan struktur HTML tiket.html
// Semua konflik variabel const dihapus (CONTEXT, API_BASE, dll sudah di inline <script>)
// Semua selector disesuaikan dengan ID elemen yang ada di HTML
// ============================================================================

// CATATAN: Variabel berikut sudah didefinisikan di inline <script> HTML:
//   CONTEXT, API_BASE, REFRESH_MS, ps, activeLayer, refreshTimer,
//   perfChartInst, officerChartInst, dailyMiniInst, donutInst,
//   dpaChartInst, ikcChartInst,
//   submitTicketsData, layer1TicketsData, laporanTicketsData,
//   ikuTicketsData, capaianTicketsData, tiketl0TicketsData, tiketl1TicketsData
// File ini TIDAK mendefinisikan ulang variabel tersebut.

// ============================================================================
// SORTING STATE (hanya untuk tabel layer detail)
// ============================================================================
const sortState = {
    layer1: { col: null, dir: 'asc' },
    layer2: { col: null, dir: 'asc' },
    layer3: { col: null, dir: 'asc' },
    urgent: { col: null, dir: 'asc' },
    perf:   { col: null, dir: 'asc' },
};

// ============================================================================
// PATCH: override loadAll dari inline script agar memanggil processData yg benar
// ============================================================================
// (Fungsi loadAll, processData, updateStats, dll sudah ada di inline script.
//  File ini hanya menambah fitur sorting dan patcher kecil tanpa redefinisi.)

// ============================================================================
// SORTING — Layer Table
// ============================================================================
function sortLayerData(layer, col, dataType) {
    const st = sortState[layer];
    if (st.col === col) {
        st.dir = st.dir === 'asc' ? 'desc' : 'asc';
    } else {
        st.col = col;
        st.dir = 'asc';
    }

    const arr = [...ps[layer].all];
    arr.sort((a, b) => {
        let av = a[col] == null ? '' : a[col];
        let bv = b[col] == null ? '' : b[col];
        if (dataType === 'number') {
            av = parseFloat(av) || 0;
            bv = parseFloat(bv) || 0;
        } else {
            av = av.toString().toLowerCase();
            bv = bv.toString().toLowerCase();
        }
        if (av > bv) return st.dir === 'asc' ? 1 : -1;
        if (av < bv) return st.dir === 'asc' ? -1 : 1;
        return 0;
    });

    ps[layer].fil = arr;
    ps[layer].pg = 1;
    renderLayerTable();
    updateSortIcons(layer, col, st.dir);
}

function sortUrgentData(col, dataType) {
    const st = sortState.urgent;
    if (st.col === col) {
        st.dir = st.dir === 'asc' ? 'desc' : 'asc';
    } else {
        st.col = col;
        st.dir = 'asc';
    }

    const arr = [...ps.urgent.all];
    arr.sort((a, b) => {
        let av = a[col] == null ? '' : a[col];
        let bv = b[col] == null ? '' : b[col];
        if (dataType === 'number') {
            av = parseFloat(av) || 0;
            bv = parseFloat(bv) || 0;
        } else {
            av = av.toString().toLowerCase();
            bv = bv.toString().toLowerCase();
        }
        if (av > bv) return st.dir === 'asc' ? 1 : -1;
        if (av < bv) return st.dir === 'asc' ? -1 : 1;
        return 0;
    });

    ps.urgent.fil = arr;
    ps.urgent.pg = 1;
    renderUrgent();
    updateUrgentSortIcons(col, st.dir);
}

function sortPerfData(col, dataType) {
    const st = sortState.perf;
    if (st.col === col) {
        st.dir = st.dir === 'asc' ? 'desc' : 'asc';
    } else {
        st.col = col;
        st.dir = 'asc';
    }

    const arr = [...ps.perf.all];
    arr.sort((a, b) => {
        let av = a[col] == null ? '' : a[col];
        let bv = b[col] == null ? '' : b[col];
        if (dataType === 'number') {
            av = parseFloat(av) || 0;
            bv = parseFloat(bv) || 0;
        } else {
            av = av.toString().toLowerCase();
            bv = bv.toString().toLowerCase();
        }
        if (av > bv) return st.dir === 'asc' ? 1 : -1;
        if (av < bv) return st.dir === 'asc' ? -1 : 1;
        return 0;
    });

    ps.perf.fil = arr;
    ps.perf.pg = 1;
    renderPerf();
    updatePerfSortIcons(col, st.dir);
}

function updateSortIcons(layer, activeCol, dir) {
    // Tidak ada <th sortable> di HTML saat ini, fungsi ini aman kosong
    // Jika nanti ditambahkan, implementasikan di sini
}
function updateUrgentSortIcons(activeCol, dir) {}
function updatePerfSortIcons(activeCol, dir) {}

// ============================================================================
// KEYBOARD SHORTCUT: ESC menutup semua popup
// ============================================================================
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        ['popupOverlay','popupLayer1Overlay','popupLayer2Overlay',
         'popupIkuOverlay','popupCapaianOverlay','popupTiketl0Overlay',
         'popupTiketl1Overlay'].forEach(function(id) {
            const el = document.getElementById(id);
            if (el) el.classList.remove('active');
        });
    }
});

// ============================================================================
// EXPORT CSV — Utility
// ============================================================================
function exportTableToCSV(data, filename) {
    if (!data || !data.length) return;
    const keys = Object.keys(data[0]);
    const header = keys.join(',');
    const rows = data.map(function(row) {
        return keys.map(function(k) {
            const v = row[k] == null ? '' : String(row[k]);
            return '"' + v.replace(/"/g, '""') + '"';
        }).join(',');
    });
    const csv = [header].concat(rows).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Ekspor tiket layer yang sedang aktif
function exportActiveLayer() {
    exportTableToCSV(ps[activeLayer].fil, activeLayer + '_tiket.csv');
}

// Ekspor urgent
function exportUrgent() {
    exportTableToCSV(ps.urgent.fil, 'urgent_tiket.csv');
}

// ============================================================================
// SEARCH EXTENSION — juga filter tabel perf
// ============================================================================
(function patchSearch() {
    // Tunggu DOM ready
    document.addEventListener('DOMContentLoaded', function() {
        const input = document.getElementById('globalSearch');
        if (!input) return;

        input.addEventListener('input', function() {
            const q = this.value.toLowerCase().trim();

            // Filter perf table
            if (ps && ps.perf && ps.perf.all) {
                ps.perf.fil = q
                    ? ps.perf.all.filter(function(t) {
                        return Object.values(t).some(function(v) {
                            return (v || '').toString().toLowerCase().includes(q);
                        });
                    })
                    : [...ps.perf.all];
                ps.perf.pg = 1;
                if (typeof renderPerf === 'function') renderPerf();
            }
        });
    });
})();

// ============================================================================
// TOOLTIP KUSTOM — Tampilkan detail tiket saat hover baris tabel
// ============================================================================
document.addEventListener('mouseover', function(e) {
    const row = e.target.closest('tr[data-ticket]');
    if (!row) return;
    // Implementasi tooltip minimal (opsional, tidak wajib)
});

// ============================================================================
// BADGE HELPER — dipakai oleh inline script jika diperlukan
// ============================================================================
function getBadgeClass(kategori) {
    if (!kategori) return 'badge-ok';
    const k = kategori.toLowerCase();
    if (k.includes('diatas') || k.includes('1 jam')) return 'badge-danger';
    if (k.includes('30') && k.includes('60'))        return 'badge-warn';
    return 'badge-ok';
}

// ============================================================================
// HIGHLIGHT SEARCH — tandai teks yang cocok di tabel
// ============================================================================
function highlightText(text, query) {
    if (!query || !text) return esc ? esc(text) : (text || '—');
    const escaped = String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
    return escaped.replace(re, '<mark>$1</mark>');
}

// ============================================================================
// PATCHER: Pastikan donutCenter update benar (fix querySelector null error)
// ============================================================================
(function patchDonutCenter() {
    // Override buildStatusDonut jika ada — hanya patch bagian querySelector
    const origProcess = window.processData;
    if (typeof origProcess === 'function') {
        // Sudah ada, tidak perlu patch
        return;
    }

    // Safety: pastikan donutCenter ada sebelum diakses
    const observer = new MutationObserver(function() {
        const dc = document.getElementById('donutCenter');
        if (dc) {
            // Pastikan child .big dan .small selalu ada
            if (!dc.querySelector('.big')) {
                dc.innerHTML = '<div class="big">—</div><div class="small">total aktif</div>';
            }
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();

// ============================================================================
// FIX UTAMA: Override buildStatusDonut dari inline script
// Penyebab error: document.querySelector('#donutCenter .big') null
// karena donutCenter innerHTML belum diisi sebelum querySelector dipanggil
// ============================================================================
window.buildStatusDonut = function(d) {
    const sub  = +(d.stats && d.stats.status && (d.stats.status.Submit  || d.stats.status.SUBMIT  || {}) || {}).total  || 0;
    const l1   = +(d.stats && d.stats.status && (d.stats.status.Layer1  || d.stats.status.LAYER1  || {}) || {}).total  || 0;
    const l2   = +(d.stats && d.stats.status && (d.stats.status.Layer2  || d.stats.status.LAYER2  || {}) || {}).total  || 0;
    const l3p  = +(d.stats && d.stats.status && (d.stats.status.Layer3_PSI || d.stats.status.LAYER3_PSI || {}) || {}).total || 0;
    const l3l  = +(d.stats && d.stats.status && (d.stats.status.Layer3_PLD || d.stats.status.LAYER3_PLD || {}) || {}).total || 0;

    const getStatusVal = function(key1, key2) {
        if (!d.stats || !d.stats.status) return 0;
        const obj = d.stats.status[key1] || d.stats.status[key2] || {};
        return +(obj.total || 0);
    };

    const subVal = getStatusVal('Submit','SUBMIT');
    const l1Val  = getStatusVal('Layer1','LAYER1');
    const l2Val  = getStatusVal('Layer2','LAYER2');
    const l3pVal = getStatusVal('Layer3_PSI','LAYER3_PSI');
    const l3lVal = getStatusVal('Layer3_PLD','LAYER3_PLD');
    const total  = subVal + l1Val + l2Val + l3pVal + l3lVal;

    // FIX: Set innerHTML dulu, BARU akses querySelector
    const dc = document.getElementById('donutCenter');
    if (dc) {
        dc.innerHTML = '<div class="big">' + total.toLocaleString() + '</div><div class="small">total aktif</div>';
    }

    const ctx = document.getElementById('statusDonut');
    if (!ctx) return;

    // Hapus chart lama jika ada
    if (window.donutInst) {
        window.donutInst.destroy();
        window.donutInst = null;
    }

    window.donutInst = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Submit','Layer 1','Layer 2','L3 PSI','L3 PLD'],
            datasets: [{
                data: [subVal, l1Val, l2Val, l3pVal, l3lVal],
                backgroundColor: [
                    'rgba(245,101,101,.7)',
                    'rgba(237,137,54,.7)',
                    'rgba(124,106,247,.7)',
                    'rgba(79,209,197,.7)',
                    'rgba(72,187,120,.7)'
                ],
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1a1a28',
                    titleColor: '#f0f0f8',
                    bodyColor: '#6b6b8a',
                    borderColor: 'rgba(255,255,255,.1)',
                    borderWidth: 1
                }
            }
        }
    });

    // Pills
    const pills = [
        { label: 'Submit: '  + subVal, color: 'var(--danger)'  },
        { label: 'L1: '      + l1Val,  color: 'var(--warn)'    },
        { label: 'L2: '      + l2Val,  color: 'var(--accent)'  },
        { label: 'L3 PSI: '  + l3pVal, color: 'var(--accent2)' },
        { label: 'L3 PLD: '  + l3lVal, color: 'var(--success)' },
    ];
    const pillEl = document.getElementById('statusPills');
    if (pillEl) {
        pillEl.innerHTML = pills.map(function(p) {
            return '<span class="pill" style="color:' + p.color + ';background:' + p.color + '22;border:1px solid ' + p.color + '44">' + p.label + '</span>';
        }).join('');
    }
};

// ============================================================================

// ============================================================================
// FIX: Override populateIkuPopup — field mapping disesuaikan
// ============================================================================
window.populateIkuPopup = function() {
    const tbody = document.getElementById('ikuTicketsBody');
    if (!tbody) return;
    const data = window.ikuTicketsData;
    if (!data || !data.tickets || !data.tickets.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="no-data">Tidak ada data</td></tr>';
        return;
    }
    tbody.innerHTML = data.tickets.map(function(t) {
        return '<tr>' +
            '<td>' + escSafe(t.ticket_number) + '</td>' +
            '<td>' + escSafe(t.office_name)   + '</td>' +
            '<td>' + escSafe(t.duration)       + '</td>' +
            '<td class="mono">' + escSafe(t.status) + '</td>' +
            '</tr>';
    }).join('');
    const ts = document.getElementById('timestampIku');
    if (ts) ts.textContent = 'Generated: ' + new Date().toLocaleString('id-ID');
};

// ============================================================================
// FIX: Override populateCapaianPopup
// ============================================================================
window.populateCapaianPopup = function() {
    const tbody = document.getElementById('capaianTicketsBody');
    if (!tbody) return;
    const data = window.capaianTicketsData;
    if (!data || !data.tickets || !data.tickets.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">Tidak ada data</td></tr>';
        return;
    }
    tbody.innerHTML = data.tickets.slice(0, 200).map(function(t) {
        return '<tr>' +
            '<td>' + escSafe(t.ticket_number) + '</td>' +
            '<td>' + escSafe(t.office_name)   + '</td>' +
            '<td>' + escSafe(t.duration)       + '</td>' +
            '<td>' + escSafe(t.kategori)       + '</td>' +
            '<td class="mono">' + escSafe(t.status) + '</td>' +
            '</tr>';
    }).join('');
};




// download 


window.CLAYER1 = {
  raw:[]
};

function escSafe(v){

  return String(v ?? '')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}


// =========================
// FORMAT WIB
// =========================
function formatTanggalWIB(dateStr){

  if(!dateStr) return '-';

  const d = new Date(dateStr);

  return d.toLocaleDateString(
    'id-ID',
    {
      timeZone:'Asia/Jakarta',
      year:'numeric',
      month:'2-digit',
      day:'2-digit'
    }
  );
}


// =========================
// TODAY WIB
// =========================
function isTodayWIB(dateStr){

  const now = new Date();

  const today =
    now.toLocaleDateString(
      'sv-SE',
      {
        timeZone:'Asia/Jakarta'
      }
    );

  const d = new Date(dateStr);

  const rowDate =
    d.toLocaleDateString(
      'sv-SE',
      {
        timeZone:'Asia/Jakarta'
      }
    );

  return rowDate === today;
}


// =========================
// INIT
// =========================

// ============================================================================
// SYNC CLAYER1 RAW — tanpa mengganti implementasi initClayer1 dari tiket.html
// initClayer1 utama tetap milik HTML. Wrapper ini hanya menyimpan data mentah
// untuk fitur download PDAD dan pencarian global.
// ============================================================================


// ============================================================================
// FIX: Capaian Duktek / PDAD
// ----------------------------------------------------------------------------
// Struktur HTML tiket.html untuk card ini adalah:
// Tanggal | Kantor | Tiket Masuk | Tiket Selesai | Tiket Diteruskan
// Data clayer1 dari API menggunakan field:
// tanggal, kantor, tiket_masuk, tiket_selesai, tiket_diteruskan.
// Jangan memakai ticket_number/officer_name/duration karena itu struktur
// tiket detail yang berbeda dan menyebabkan tabel menjadi 0 / "—".
// ============================================================================
function renderClayer1PDAD(rows){
  const tickets = Array.isArray(rows) ? rows : [];
  window._clayer1Tickets = tickets;

  const tbody = document.getElementById('clayer1TableBody');
  if (tbody) {
    tbody.innerHTML = tickets.map(function(t){
      const masuk = Number(t.tiket_masuk ?? t.officer_name ?? 0);
      const selesai = Number(t.tiket_selesai ?? t.duration ?? 0);
      const diteruskan = Number(t.tiket_diteruskan ?? t.diteruskan ?? 0);

      return '<tr>' +
        '<td>' + escSafe(formatTanggalWIB(t.tanggal || new Date().toISOString())) + '</td>' +
        '<td>' + escSafe(t.kantor || t.ticket_number || '-') + '</td>' +
        '<td class="mono">' + masuk.toLocaleString('id-ID') + '</td>' +
        '<td class="mono">' + selesai.toLocaleString('id-ID') + '</td>' +
        '<td class="mono">' + diteruskan.toLocaleString('id-ID') + '</td>' +
      '</tr>';
    }).join('') ||
      '<tr><td colspan="5" class="no-data">Tidak ada data</td></tr>';
  }

  const ctx = document.getElementById('dpaBarChart');
  if (!ctx || typeof Chart === 'undefined') return;

  // Chart.js menyimpan instance berdasarkan canvas. Jangan hanya mengandalkan
  // CHART.dpa karena instance bisa masih terdaftar di Chart.js walaupun
  // reference CHART.dpa sudah berubah/hilang.
  try {
    const existingChart =
      (typeof Chart.getChart === 'function' ? Chart.getChart(ctx) : null) ||
      (window.CHART && CHART.dpa ? CHART.dpa : null);

    if (existingChart) {
      existingChart.destroy();
    }
  } catch (e) {
    console.warn('[PDAD] gagal destroy chart lama:', e);
  }

  if (window.CHART) {
    CHART.dpa = null;
  } else {
    window.CHART = {};
  }

  // Chart menggunakan total per kantor agar tidak menampilkan tanggal
  // berulang-ulang dan tetap representatif terhadap data PDAD.
  const byKantor = {};
  tickets.forEach(function(t){
    const kantor = t.kantor || t.ticket_number || '-';
    if (!byKantor[kantor]) {
      byKantor[kantor] = { masuk:0, selesai:0, diteruskan:0 };
    }
    byKantor[kantor].masuk += Number(t.tiket_masuk ?? t.officer_name ?? 0);
    byKantor[kantor].selesai += Number(t.tiket_selesai ?? t.duration ?? 0);
    byKantor[kantor].diteruskan += Number(t.tiket_diteruskan ?? t.diteruskan ?? 0);
  });

  const top = Object.entries(byKantor)
    .sort(function(a,b){ return b[1].masuk - a[1].masuk; })
    .slice(0, 10);

  CHART.dpa = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(function(x){ return x[0]; }),
      datasets: [
        {
          label: 'Tiket Masuk',
          data: top.map(function(x){ return x[1].masuk; }),
          backgroundColor: 'rgba(124,106,247,.65)',
          borderRadius: 3,
          borderSkipped: false
        },
        {
          label: 'Tiket Selesai',
          data: top.map(function(x){ return x[1].selesai; }),
          backgroundColor: 'rgba(79,209,197,.75)',
          borderRadius: 3,
          borderSkipped: false
        },
        {
          label: 'Tiket Diteruskan',
          data: top.map(function(x){ return x[1].diteruskan; }),
          backgroundColor: 'rgba(237,137,54,.70)',
          borderRadius: 3,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { display:false },
        tooltip: {
          backgroundColor:'#374151',
          titleColor:'#e2e8f0',
          bodyColor:'#a0aec0',
          borderColor:'rgba(255,255,255,.1)',
          borderWidth:1
        }
      },
      scales: {
        x: {
          grid:{display:false},
          ticks:{color:'#a0aec0',font:{size:9},maxRotation:60}
        },
        y: {
          beginAtZero:true,
          grid:{color:'rgba(128,128,128,.06)'},
          ticks:{color:'#a0aec0',font:{size:10}}
        }
      }
    }
  });
}

(function syncClayer1Raw(){
  const install = function(){
    const original = window.initClayer1;
    if(typeof original !== 'function' || original.__clayer1SyncWrapped) return;

    const wrapped = function(data){
      const rows = Array.isArray(data)
        ? data
        : Array.isArray(data?.tickets)
          ? data.tickets
          : [];

      // Simpan data penuh hanya saat tidak sedang melakukan Global Search.
      // Saat search aktif, _rawClayer1 tetap menjadi sumber data asli.
      const searchValue = (document.getElementById('globalSearch')?.value || '').trim();
      if (!searchValue) {
        window.CLAYER1.raw = rows;
        window._rawClayer1 = rows;
      }

      // Gunakan renderer PDAD yang sesuai dengan struktur data clayer1.
      return renderClayer1PDAD(rows);
    };

    wrapped.__clayer1SyncWrapped = true;
    window.initClayer1 = wrapped;
  };

  install();

  if(typeof window.initClayer1 !== 'function'){
    document.addEventListener('DOMContentLoaded', install, { once:true });
  }
})();
// OPEN MODAL
// =========================
function openDownloadModal(){

  document.getElementById(
    'downloadModal'
  ).style.display = 'flex';

  buildDownloadKantor();
}


// =========================
// CLOSE MODAL
// =========================
function closeDownloadModal(){

  document.getElementById(
    'downloadModal'
  ).style.display = 'none';
}


// =========================
// CUSTOM RANGE
// =========================
function toggleCustomRange(){

  const val =
    document.getElementById(
      'downloadRange'
    ).value;

  document.getElementById(
    'customDateWrap'
  ).style.display =

    val === 'custom'
      ? 'block'
      : 'none';
}


// =========================
// BUILD KANTOR
// =========================
// =========================
// BUILD KANTOR
// =========================
function buildDownloadKantor(){

  const wrap =
    document.getElementById(
      'pdadDownloadKantor'
    );

  if(!wrap) return;

  const raw =

    Array.isArray(CLAYER1?.raw)

      ? CLAYER1.raw

      : [];

  const list = [

    ...new Set(
      raw
        .map(x => x.kantor)
        .filter(Boolean)
    )

  ].sort();

  wrap.innerHTML =

    `
    <label
      style="
        display:flex;
        align-items:center;
        gap:8px;
        margin-bottom:10px;
        cursor:pointer;
        font-weight:600;
      "
    >
      <input
        type="checkbox"
        value="ALL"
        checked
      >

      <span>Semua Kantor</span>
    </label>
    `

    +

    list.map(k => `

      <label
        style="
          display:flex;
          align-items:center;
          gap:8px;
          margin-bottom:8px;
          cursor:pointer;
        "
      >

        <input
  type="checkbox"
  class="pdad-kantor-item"
  value="${k}"
  onchange="syncPDADAllCheckbox()"
>

        <span>${k}</span>

      </label>

    `).join('');
}



function syncPDADAllCheckbox(){

  const allBox =

    document.querySelector(
      '#pdadDownloadKantor input[value="ALL"]'
    );

  const items =

    document.querySelectorAll(
      '.pdad-kantor-item'
    );

  const checked =

    document.querySelectorAll(
      '.pdad-kantor-item:checked'
    );

  if(!allBox) return;

  allBox.checked =

    items.length > 0
    &&
    items.length === checked.length;
}



// =========================
// OPEN MODAL
// =========================
function closeDownloadPDADModal(){

  const modal =
    document.getElementById(
      'downloadPDADModal'
    );

  if(!modal) return;

  modal.style.display =
    'none';
}


// =========================
// CLOSE MODAL
// =========================
function closeDownloadPDADModal(){

  const modal =
    document.getElementById(
      'downloadPDADModal'
    );

  if(!modal) return;

  modal.style.display = 'none';
}


// =========================
// TOGGLE RANGE
// =========================
function togglePDADCustomRange(){

  const range =
    document.getElementById(
      'pdadDownloadRange'
    );

  const wrap =
    document.getElementById(
      'pdadCustomDateWrap'
    );

  if(!range || !wrap) return;

  wrap.style.display =

    range.value === 'custom'

      ? 'block'

      : 'none';
}


// =========================
// FILTER DATA
// =========================
function getFilteredDownloadData(){

  // =========================
  // CEK ALL KANTOR
  // =========================
  const allChecked =

    document.querySelector(
      '#pdadDownloadKantor input[value="ALL"]'
    )?.checked;

  // =========================
  // AMBIL KANTOR TERPILIH
  // =========================
  let selectedKantor = [];

  if(!allChecked){

    selectedKantor =

      Array.from(
        document.querySelectorAll(
          '.pdad-kantor-item:checked'
        )
      ).map(x => x.value);
  }

  // =========================
  // RANGE
  // =========================
  const range =

    document.getElementById(
      'pdadDownloadRange'
    )?.value || '31';

  // =========================
  // SOURCE DATA
  // =========================
  let rows =

    Array.isArray(CLAYER1?.raw)

      ? [...CLAYER1.raw]

      : [];

  console.log(
    'ROWS AWAL:',
    rows
  );

  // =========================
  // FILTER KANTOR
  // =========================
  if(!allChecked){

    rows = rows.filter(x =>

      selectedKantor.includes(
        x.kantor
      )
    );
  }

  // =========================
  // FILTER RANGE
  // =========================
  if(range !== 'custom'){

    const now =
      new Date();

    const start =
      new Date();

    start.setHours(
      0,0,0,0
    );

    start.setDate(
      now.getDate()
      -
      (
        Number(range) - 1
      )
    );

    rows = rows.filter(r => {

      const d =
        new Date(r.tanggal);

      return d >= start;
    });

  }else{

    const startVal =

      document.getElementById(
        'pdadCustomStart'
      )?.value;

    const endVal =

      document.getElementById(
        'pdadCustomEnd'
      )?.value;

    if(startVal && endVal){

      const start =
        new Date(startVal);

      const end =
        new Date(endVal);

      end.setHours(
        23,59,59,999
      );

      rows = rows.filter(r => {

        const d =
          new Date(r.tanggal);

        return d >= start
            && d <= end;
      });
    }
  }

  console.log(
    'ROWS FILTER:',
    rows
  );

  return rows;
}


// =========================
// DOWNLOAD
// =========================
function downloadPDADReport(){

  const rows =
    getFilteredDownloadData();

  console.log(
    'DOWNLOAD ROWS:',
    rows
  );

  if(!rows.length){

    alert('Data kosong');

    return;
  }

  const format =
    document.getElementById(
      'pdadDownloadFormat'
    )?.value || 'excel';

  if(format === 'excel'){

    exportPDADExcel(rows);

  }else{

    exportPDADPDF(rows);
  }

  closeDownloadPDADModal();
}


// =========================
// EXPORT EXCEL
// =========================
function exportPDADExcel(rows){

  const data = rows.map(r => ({

    Tanggal:
      formatTanggalWIB(
        r.tanggal
      ),

    Kantor:
      r.kantor,

    Tiket_Masuk:
      r.tiket_masuk,

    Tiket_Selesai:
      r.tiket_selesai,

    Tiket_Diteruskan:
      r.tiket_diteruskan

  }));

  const ws =
    XLSX.utils.json_to_sheet(
      data
    );

  const wb =
    XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    ws,
    'PDAD'
  );

  XLSX.writeFile(
    wb,
    'Laporan_PDAD.xlsx'
  );
}


// =========================
// EXPORT PDF
// =========================
function exportPDADPDF(rows){

  const {
    jsPDF
  } = window.jspdf;

  const doc =
    new jsPDF({
      orientation:
        'landscape'
    });

  // TOTAL
  const totalMasuk =
    rows.reduce(
      (a,b)=>
        a + Number(
          b.tiket_masuk || 0
        ),
      0
    );

  const totalSelesai =
    rows.reduce(
      (a,b)=>
        a + Number(
          b.tiket_selesai || 0
        ),
      0
    );

  const totalDiteruskan =
    rows.reduce(
      (a,b)=>
        a + Number(
          b.tiket_diteruskan || 0
        ),
      0
    );

  doc.setFontSize(18);

  doc.text(
    'Laporan PDAD',
    14,
    18
  );

  doc.setFontSize(11);

  doc.text(
    `Total Tiket Masuk: ${totalMasuk}`,
    14,
    34
  );

  doc.text(
    `Selesai: ${totalSelesai}`,
    14,
    42
  );

  doc.text(
    `Diteruskan: ${totalDiteruskan}`,
    14,
    50
  );

  doc.autoTable({

    startY: 60,

    head:[[
      'Tanggal',
      'Kantor',
      'Masuk',
      'Selesai',
      'Diteruskan'
    ]],

    body: rows.map(r => [

      formatTanggalWIB(
        r.tanggal
      ),

      r.kantor,

      r.tiket_masuk,

      r.tiket_selesai,

      r.tiket_diteruskan

    ])
  });

  doc.save(
    'Laporan_PDAD.pdf'
  );
}




// ============================================================================
// VISIBILITY CHANGE
// Inline script tiket.html sudah menangani stop/start refresh.
// File ini tidak menduplikasi handler visibility.
// ============================================================================

console.log(
  '%c CeisMon Tiket JS Loaded — cleaned / IKC compatible ',
  'background:#7c6af7;color:#fff;padding:4px 10px;border-radius:4px;font-weight:bold;'
);