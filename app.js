/* Brew Board — Live Dashboard
   Condensed version of Brew Board Analytics for permanent display on a
   monitor: week strip, stat cards, and SKU pies only. No workload chart,
   trend, maintenance/grain notes, or email export — see the full
   "prototype" version for those.
   Reads data.json (parsed from the Live Brewery Board export).
*/

const TODAY = new Date();

// Builds a YYYY-MM-DD string from LOCAL date parts. Deliberately not
// TODAY.toISOString().slice(0,10) — toISOString() converts to UTC first,
// which can shift the date by a day (and therefore land on the wrong
// day-of-week) for anyone in a timezone ahead of or behind UTC.
function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Light canonicalisation for known spelling/typo variants seen across weeks.
// Everything else is used as-is; rare one-off codes get folded into "Other"
// at chart-render time.
const SKU_ALIASES = {
  'WAY': 'GBWAY',
  'WIND': 'GBWIND',
  'MEAGUV': 'MEGAUV',
  'BLAGER': 'BLACKLAGER',
  'LARGARITA': 'LAGERITA',
  'LAGARITA': 'LAGERITA',
  'LRITA': 'LAGERITA',
  'SUBTROP': 'SUBTROPIC',
};

const PALETTE = [
  '#E0A93B', '#C1652F', '#7C9A5E', '#5C87A6', '#9C7A9E',
  '#B8863B', '#4E7A6E', '#A15C4B', '#6E7FA6', '#8AA0A0',
  '#C99A54', '#6F8F4C', '#B06B8C', '#5E97B0', '#9A7A4E',
];

// Brand/label colours supplied for specific SKUs. Checked before the
// hash-based fallback palette. Keys are canonical (post-SKU_ALIASES) codes.
const FIXED_SKU_COLORS = {
  'XPA': '#47D7AC',        // PMS 3385
  'EAZY': '#FDAA63',       // PMS 714
  'HAZY': '#FFD637',       // PMS 810
  'IPA': '#7566A0',        // PMS 7676
  'LAGER': '#99D6EA',      // PMS 2975
  'LPA': '#6BC1E0',        // light blue — distinct shade from LAGER above
  'BLACKLAGER': '#000000', // Black Lager
  'BLACK': '#000000',      // same dark colourway — see README note
  'CPT': '#F1EB9C',        // Captain Sensible, PMS 600
  'GBWIND': '#DC3B2E',     // Green Beacon Windjammer — red (approximate, no PMS given)
  'GBWAY': '#4E9F5B',      // Green Beacon Wayfarer — green (approximate, no PMS given)
  'SUBTROPIC': '#FF8A1E',  // Subtropic — bright orange (approximate, no PMS given)
};

const skuColorCache = {};
function colorFor(sku) {
  if (skuColorCache[sku]) return skuColorCache[sku];
  let color = FIXED_SKU_COLORS[sku];
  if (!color) {
    let hash = 0;
    for (let i = 0; i < sku.length; i++) hash = (hash * 31 + sku.charCodeAt(i)) >>> 0;
    color = PALETTE[hash % PALETTE.length];
  }
  skuColorCache[sku] = color;
  return color;
}

function canon(sku) {
  return SKU_ALIASES[sku] || sku;
}

function fmt(n, decimals = 0) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toLocaleString('en-AU', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

const DAY_LABELS = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

let DATA = null;
let charts = {};
let currentWeekIndex = null;
let logoReady = null; // Promise<string|null> resolving to a PNG data URL

function prepareLogoImage() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 200; // rendered at 2x-ish for retina screens
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('Logo rasterisation failed:', err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = 'logo.svg';
  });
}

async function init() {
  logoReady = prepareLogoImage();
  const res = await fetch('data.json');
  DATA = await res.json();
  populateWeekSelect();
  const defaultIdx = pickDefaultWeekIndex();
  document.getElementById('weekSelect').value = defaultIdx;
  renderWeek(defaultIdx);
  document.getElementById('weekSelect').addEventListener('change', (e) => renderWeek(parseInt(e.target.value, 10)));
  document.getElementById('exportGmailBtn').addEventListener('click', exportToGmail);
}

function weekLabel(w) {
  const start = new Date(w.weekStart + 'T00:00:00');
  const end = new Date(w.weekEnd + 'T00:00:00');
  const opts = { day: '2-digit', month: 'short' };
  return `WC ${start.toLocaleDateString('en-AU', opts)} \u2013 ${end.toLocaleDateString('en-AU', { ...opts, year: 'numeric' })}`;
}

function populateWeekSelect() {
  const sel = document.getElementById('weekSelect');
  sel.innerHTML = '';
  DATA.weeks.forEach((w, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = weekLabel(w);
    sel.appendChild(opt);
  });
}

function pickDefaultWeekIndex() {
  let best = DATA.weeks.length - 1;
  for (let i = 0; i < DATA.weeks.length; i++) {
    const start = new Date(DATA.weeks[i].weekStart + 'T00:00:00');
    if (start <= TODAY) best = i;
  }
  return best;
}

function aggregateBySku(entries, volKey) {
  const totals = {};
  entries.forEach(e => {
    const sku = canon(e.sku);
    totals[sku] = (totals[sku] || 0) + e[volKey];
  });
  return totals;
}

function collectCategory(week, category) {
  const all = [];
  week.days.forEach(day => { day[category].forEach(e => all.push(e)); });
  return all;
}

function toChartData(totalsObj, maxSlices = 7) {
  const arr = Object.entries(totalsObj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (arr.length > maxSlices) {
    const head = arr.slice(0, maxSlices - 1);
    const tailSum = arr.slice(maxSlices - 1).reduce((s, [, v]) => s + v, 0);
    head.push(['Other', tailSum]);
    return head;
  }
  return arr;
}

function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function renderPie(canvasId, emptyId, totalsObj, listId) {
  destroy(canvasId);
  const data = toChartData(totalsObj);
  const wrap = document.getElementById(canvasId).parentElement;
  const emptyEl = document.getElementById(emptyId);
  const listEl = listId ? document.getElementById(listId) : null;
  if (data.length === 0) {
    wrap.style.display = 'none';
    emptyEl.style.display = 'block';
    if (listEl) listEl.innerHTML = '';
    return;
  }
  wrap.style.display = 'block';
  emptyEl.style.display = 'none';
  const ctx = document.getElementById(canvasId).getContext('2d');
  const total = data.reduce((s, [, v]) => s + v, 0);
  charts[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(([sku]) => sku),
      datasets: [{
        data: data.map(([, v]) => v),
        backgroundColor: data.map(([sku]) => sku === 'Other' ? '#C9C6BC' : colorFor(sku)),
        borderColor: '#FFFFFF',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed;
              const pct = ((v / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${fmt(v, 1)} hL (${pct}%)`;
            },
          },
        },
      },
    },
  });

  if (listEl) {
    listEl.innerHTML = data.map(([sku, v]) => {
      const pct = ((v / total) * 100).toFixed(0);
      const color = sku === 'Other' ? '#C9C6BC' : colorFor(sku);
      return `<span class="chart-sku-line"><span class="sku-dot" style="background:${color}"></span>${sku} <span class="muted">${fmt(v, 1)} hL &middot; ${pct}%</span></span>`;
    }).join('');
  }
}

function renderWeek(idx) {
  currentWeekIndex = idx;
  const week = DATA.weeks[idx];
  document.getElementById('weekRange').textContent = weekLabel(week);

  renderWeekStrip(week);
  renderStats(week);

  const brewingEntries = [...collectCategory(week, 'kronesBrews'), ...collectCategory(week, 'dmeBrews')];
  renderPie('chartBrewing', 'emptyBrewing', aggregateBySku(brewingEntries, 'volumeHL'), 'skuListBrewing');
  renderPie('chartTransfer', 'emptyTransfer', aggregateBySku(collectCategory(week, 'transfers'), 'volumeHL'), 'skuListTransfer');
  renderPie('chartCanned', 'emptyCanned', aggregateBySku(collectCategory(week, 'cartons'), 'volumeHL'), 'skuListCanned');
  renderPie('chartKegged', 'emptyKegged', aggregateBySku(collectCategory(week, 'kegs'), 'volumeHL'), 'skuListKegged');
}

function skuListFor(entries, max = 4) {
  const skus = [...new Set(entries.map(e => canon(e.sku)))];
  if (skus.length === 0) return '';
  if (skus.length > max) return skus.slice(0, max).join(', ') + ` +${skus.length - max}`;
  return skus.join(', ');
}

// Short form for the in-bar rotated label: just the first SKU, plus a
// "+N" count of any others, so it stays compact enough to fit vertically
// inside a bar. Full detail is still available via the bar's title tooltip.
function skuLabelFor(entries, max = 2) {
  const skus = [...new Set(entries.map(e => canon(e.sku)))];
  if (skus.length === 0) return '';
  if (skus.length <= max) return skus.join(', ');
  return skus.slice(0, max).join(', ') + ` +${skus.length - max}`;
}

function renderWeekStrip(week) {
  const strip = document.getElementById('weekStrip');
  strip.innerHTML = '';

  const categorized = week.days.map(d => ({
    brew: d.dmeBrewVolumeHL + d.kronesBrewVolumeHL,
    transfer: d.transferVolumeHL,
    canning: d.cartonVolumeHL,
    kegging: d.kegVolumeHL,
  }));
  // Shared scale across all four bars and all seven days, so heights are
  // comparable both within a day and across the week.
  const sharedMax = Math.max(1, ...categorized.flatMap(c => [c.brew, c.transfer, c.canning, c.kegging]));

  week.days.forEach((day, i) => {
    const { brew, transfer, canning, kegging } = categorized[i];
    const isToday = day.date === toLocalISODate(TODAY);
    const card = document.createElement('div');
    card.className = 'day-card' + (isToday ? ' is-today' : '');
    card.setAttribute('role', 'listitem');
    const dateLabel = day.date ? new Date(day.date + 'T00:00:00').getDate() : '';
    const pctOf = (v) => Math.round((v / sharedMax) * 100);

    const brewSkus = skuListFor([...day.dmeBrews, ...day.kronesBrews]);
    const transferSkus = skuListFor(day.transfers);
    const canningSkus = skuListFor(day.cartons);
    const keggingSkus = skuListFor(day.kegs);
    const brewLabel = skuLabelFor([...day.dmeBrews, ...day.kronesBrews]);
    const transferLabel = skuLabelFor(day.transfers);
    const canningLabel = skuLabelFor(day.cartons);
    const keggingLabel = skuLabelFor(day.kegs);

    const bar = (cls, value, label, skuTitle) => `
        <span class="gauge-bar ${cls}" title="${cls.replace('gauge-bar-', '')}: ${fmt(value, 1)} hL${skuTitle ? ' — ' + skuTitle : ''}">
          <span class="gauge-bar-fill" style="height:${pctOf(value)}%"></span>
          ${label ? `<span class="gauge-bar-label">${label}</span>` : ''}
        </span>`;

    card.innerHTML = `
      ${day.hasMaintenanceNote ? '<svg class="day-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" title="Maintenance / non-production note logged"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>' : ''}
      ${day.grainDeliveries.length > 0 ? '<svg class="day-grain-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" title="Grain delivered to silo"><path d="M12 3c2 2 2 4 0 6-2-2-2-4 0-6Z"/><path d="M12 9v12"/><path d="M12 12c2.5 0 4-1.5 4-4-2.5 0-4 1.5-4 4Z"/><path d="M12 12c-2.5 0-4-1.5-4-4 2.5 0 4 1.5 4 4Z"/><path d="M12 16c2.5 0 4-1.5 4-4-2.5 0-4 1.5-4 4Z"/><path d="M12 16c-2.5 0-4-1.5-4-4 2.5 0 4 1.5 4 4Z"/></svg>' : ''}
      <span class="day-name">${day.dayName}</span>
      <span class="day-date">${dateLabel}</span>
      <span class="day-gauge">
        ${bar('gauge-bar-brew', brew, brewLabel, brewSkus)}
        ${bar('gauge-bar-transfer', transfer, transferLabel, transferSkus)}
        ${bar('gauge-bar-canning', canning, canningLabel, canningSkus)}
        ${bar('gauge-bar-kegging', kegging, keggingLabel, keggingSkus)}
      </span>
      <span class="day-total">${fmt(day.totalVolumeHL)}<small style="font-size:10px;color:var(--text-faint)"> hL</small></span>
    `;
    strip.appendChild(card);
  });
}

function renderStats(week) {
  const grid = document.getElementById('statGrid');
  const brewed = week.days.reduce((s, d) => s + d.dmeBrewVolumeHL + d.kronesBrewVolumeHL, 0);
  const transferred = week.days.reduce((s, d) => s + d.transferVolumeHL, 0);
  const maintDays = week.days.filter(d => d.hasMaintenanceNote).length;
  const grainDeliveries = week.days.reduce((s, d) => s + d.grainDeliveries.length, 0);
  const totalCartons = collectCategory(week, 'cartons').reduce((s, e) => s + e.cartons, 0);
  const totalKegs = collectCategory(week, 'kegs').reduce((s, e) => s + e.kegs, 0);

  const cells = [
    ['Brewing', fmt(brewed), 'hL'],
    ['Transferring', fmt(transferred), 'hL'],
    ['Canning', fmt(totalCartons), 'cartons'],
    ['Kegging', fmt(totalKegs), 'kegs'],
    ['Maintenance days', fmt(maintDays), maintDays === 1 ? 'day' : 'days'],
    ['Grain deliveries', fmt(grainDeliveries), grainDeliveries === 1 ? 'delivery' : 'deliveries'],
  ];
  grid.innerHTML = cells.map(([label, value, unit]) => `
    <div class="stat-cell">
      <p class="stat-label">${label}</p>
      <p class="stat-value">${value}<small>${unit}</small></p>
    </div>
  `).join('');
}

// ---------- Email export ----------
// Builds a self-contained, inline-styled HTML report (not a screenshot),
// condensed to match what's actually on this dashboard: the week strip,
// weekly totals, and SKU pies. No workload/trend/notes/grain sections,
// since this trimmed dashboard doesn't show those either. Copies as rich
// HTML to the clipboard — nothing is uploaded anywhere, and no email
// client is opened; paste it into whatever email you like.

const EMAIL_VOID = '#FFFFFF';
const EMAIL_PANEL = '#FFFFFF';
const EMAIL_LINE = '#DEDAD1';
const EMAIL_LINE_SOFT = '#ECE9E2';
const EMAIL_TEXT = '#1F2124';
const EMAIL_MUTED = '#6B6E6B';
const EMAIL_FAINT = '#9A9C98';
const EMAIL_AMBER = '#E0A93B';
const EMAIL_AMBER_INK = '#A97A1C';
const EMAIL_COPPER = '#C1652F';
const EMAIL_HOP = '#7C9A5E';
const EMAIL_STEEL_BLUE = '#5C87A6';
const EMAIL_PLUM = '#9C7A9E';
const FONT_BODY = "'Lexend', Arial, sans-serif";
const FONT_MONO = "'IBM Plex Mono', 'Courier New', monospace";

const ARROW_ICON_SVG = '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>';
const CHECK_ICON_SVG = '<polyline points="20 6 9 17 4 12"/>';

function renderChartToImage(config, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const chart = new Chart(ctx, {
    ...config,
    options: {
      ...config.options,
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      devicePixelRatio: 2,
    },
  });
  const dataUrl = canvas.toDataURL('image/png');
  chart.destroy();
  return dataUrl;
}

function emailPieImage(totalsObj, width = 120, height = 120) {
  const data = toChartData(totalsObj);
  if (data.length === 0) return null;
  return renderChartToImage({
    type: 'doughnut',
    data: {
      labels: data.map(([sku]) => sku),
      datasets: [{
        data: data.map(([, v]) => v),
        backgroundColor: data.map(([sku]) => sku === 'Other' ? '#C9C6BC' : colorFor(sku)),
        borderColor: EMAIL_PANEL,
        borderWidth: 2,
      }],
    },
    options: {
      cutout: '58%',
      plugins: { legend: { display: false } },
    },
  }, width, height);
}

// Small pie + a compact text list of SKU/hL/% below it, in one bordered
// card — mirrors the site's pie cards.
function emailPieCard(totalsObj, chipColor, title) {
  const data = toChartData(totalsObj);
  const cardOpen = `<div style="background:${EMAIL_PANEL};border:1px solid ${EMAIL_LINE};border-radius:6px;padding:10px;">`;
  const heading = `<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.02em;color:${EMAIL_TEXT};font-family:${FONT_BODY};margin-bottom:8px;white-space:normal;"><span style="display:inline-block;width:8px;height:8px;background:${chipColor};border-radius:2px;margin-right:5px;vertical-align:middle;"></span>${title}</div>`;

  if (data.length === 0) {
    return `${cardOpen}${heading}<p style="margin:30px 0;text-align:center;color:${EMAIL_FAINT};font-family:${FONT_BODY};font-size:11px;">No data</p></div>`;
  }

  const total = data.reduce((s, [, v]) => s + v, 0);
  const img = emailPieImage(totalsObj);
  const imgTag = `<img src="${img}" width="120" height="120" alt="${title} volume by SKU" style="display:block;width:120px;height:120px;margin:0 auto;">`;
  const rowHtml = ([sku, v]) => {
    const pct = ((v / total) * 100).toFixed(0);
    const dotColor = sku === 'Other' ? '#C9C6BC' : colorFor(sku);
    return `<div style="font-size:10px;line-height:1.4;color:${EMAIL_TEXT};font-family:${FONT_BODY};margin-bottom:2px;"><span style="display:inline-block;width:7px;height:7px;background:${dotColor};border-radius:50%;margin-right:5px;"></span>${sku} <span style="color:${EMAIL_MUTED};">${fmt(v, 1)}hL&middot;${pct}%</span></div>`;
  };
  const half = Math.ceil(data.length / 2);
  const colA = data.slice(0, half).map(rowHtml).join('');
  const colB = data.slice(half).map(rowHtml).join('');
  const listBlock = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;padding-top:8px;border-top:1px solid ${EMAIL_LINE_SOFT};">
      <tr>
        <td width="50%" style="vertical-align:top;padding-right:6px;">${colA}</td>
        <td width="50%" style="vertical-align:top;padding-left:6px;">${colB}</td>
      </tr>
    </table>`;

  return `${cardOpen}${heading}${imgTag}${listBlock}</div>`;
}

function drawRoundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Recreates the site's week-strip: each day as its own white, bordered card
// with a day name, date, four bars (brew/transfer/canning/kegging), a total,
// the SKUs involved in each category, and small dot badges for maintenance/
// grain-delivery flags. Drawn as one composite image so it lines up cleanly
// with the rest of the report's fixed-width sections.
function emailWeekStripImage(week) {
  const scale = 2;
  const cardW = 130, gap = 8, pad = 4;
  const n = week.days.length;
  const width = pad * 2 + n * cardW + (n - 1) * gap;

  const categorized = week.days.map(d => ({
    brew: d.dmeBrewVolumeHL + d.kronesBrewVolumeHL,
    transfer: d.transferVolumeHL,
    canning: d.cartonVolumeHL,
    kegging: d.kegVolumeHL,
  }));
  const sharedMax = Math.max(1, ...categorized.flatMap(c => [c.brew, c.transfer, c.canning, c.kegging]));
  const trackW = 26, trackH = 95, trackGap = 4;
  const barColors = ['#E0A93B', '#7C9A5E', '#5C87A6', '#9C7A9E'];
  const todayISO = toLocalISODate(TODAY);
  const tracksY = pad + 40;
  const cardH = tracksY - pad + trackH + 30;
  const height = pad * 2 + cardH;

  const perDay = week.days.map((day) => ([
    skuLabelFor([...day.dmeBrews, ...day.kronesBrews]),
    skuLabelFor(day.transfers),
    skuLabelFor(day.cartons),
    skuLabelFor(day.kegs),
  ]));

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';

  week.days.forEach((day, i) => {
    const x = pad + i * (cardW + gap);
    const y = pad;
    const isToday = day.date === todayISO;

    drawRoundedRectPath(ctx, x, y, cardW, cardH, 6);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = isToday ? 2 : 1;
    ctx.strokeStyle = isToday ? '#E0A93B' : '#DEDAD1';
    ctx.stroke();

    ctx.fillStyle = '#6B6E6B';
    ctx.font = "10px 'IBM Plex Mono'";
    ctx.fillText(day.dayName.toUpperCase(), x + cardW / 2, y + 17);

    ctx.fillStyle = '#9A9C98';
    ctx.font = "10px 'Lexend'";
    const dateNum = day.date ? new Date(day.date + 'T00:00:00').getDate() : '';
    ctx.fillText(String(dateNum), x + cardW / 2, y + 30);

    const vals = [categorized[i].brew, categorized[i].transfer, categorized[i].canning, categorized[i].kegging];
    const tracksTotalW = trackW * 4 + trackGap * 3;
    const tracksX = x + (cardW - tracksTotalW) / 2;
    vals.forEach((v, vi) => {
      const tx = tracksX + vi * (trackW + trackGap);
      drawRoundedRectPath(ctx, tx, tracksY, trackW, trackH, 3);
      ctx.fillStyle = '#F4F2EC';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#DEDAD1';
      ctx.stroke();
      const fillH = Math.max(0, Math.round((v / sharedMax) * trackH));
      if (fillH > 0) {
        drawRoundedRectPath(ctx, tx, tracksY + (trackH - fillH), trackW, fillH, 3);
        ctx.fillStyle = barColors[vi];
        ctx.fill();
      }
      const label = perDay[i][vi];
      if (label) {
        ctx.save();
        ctx.translate(tx + trackW / 2, tracksY + trackH - 6);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#1F2124';
        ctx.font = "600 8px 'Lexend'";
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    });
    ctx.textAlign = 'center';

    const totalStr = fmt(day.totalVolumeHL);
    ctx.font = "600 12px 'IBM Plex Mono'";
    const totalW = ctx.measureText(totalStr).width;
    ctx.font = "9px 'Lexend'";
    const hlW = ctx.measureText(' hL').width;
    const pairStartX = x + cardW / 2 - (totalW + hlW) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1F2124';
    ctx.font = "600 12px 'IBM Plex Mono'";
    ctx.fillText(totalStr, pairStartX, tracksY + trackH + 18);
    ctx.fillStyle = '#9A9C98';
    ctx.font = "9px 'Lexend'";
    ctx.fillText(' hL', pairStartX + totalW, tracksY + trackH + 18);
    ctx.textAlign = 'center';

    if (day.hasMaintenanceNote) {
      ctx.beginPath();
      ctx.arc(x + cardW - 8, y + 8, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#C1502E';
      ctx.fill();
    }
    if (day.grainDeliveries.length > 0) {
      ctx.beginPath();
      ctx.arc(x + 8, y + 8, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#E0A93B';
      ctx.fill();
    }
  });

  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

function emailImgTag(dataUrl, displayWidth, alt) {
  if (!dataUrl) return `<p style="margin:0 0 4px;color:${EMAIL_FAINT};font-family:${FONT_BODY};font-size:13px;">No data for this chart this week.</p>`;
  return `<img src="${dataUrl}" width="${displayWidth}" alt="${alt}" style="display:block;width:${displayWidth}px;height:auto;">`;
}

function buildEmailHtml(week, logoPng) {
  const brewed = week.days.reduce((s, d) => s + d.dmeBrewVolumeHL + d.kronesBrewVolumeHL, 0);
  const transferred = week.days.reduce((s, d) => s + d.transferVolumeHL, 0);
  const cartons = collectCategory(week, 'cartons').reduce((s, e) => s + e.cartons, 0);
  const kegs = collectCategory(week, 'kegs').reduce((s, e) => s + e.kegs, 0);
  const maintDays = week.days.filter(d => d.hasMaintenanceNote);
  const grainCount = week.days.reduce((s, d) => s + d.grainDeliveries.length, 0);
  const withVolume = week.days.filter(d => d.totalVolumeHL > 0);
  const heaviest = withVolume.length ? withVolume.reduce((a, b) => (b.totalVolumeHL > a.totalVolumeHL ? b : a)) : null;
  const lightest = withVolume.length ? withVolume.reduce((a, b) => (b.totalVolumeHL < a.totalVolumeHL ? b : a)) : null;

  const weekStrip = emailWeekStripImage(week);
  const brewingTotals = aggregateBySku([...collectCategory(week, 'kronesBrews'), ...collectCategory(week, 'dmeBrews')], 'volumeHL');
  const transferTotals = aggregateBySku(collectCategory(week, 'transfers'), 'volumeHL');
  const cannedTotals = aggregateBySku(collectCategory(week, 'cartons'), 'volumeHL');
  const keggedTotals = aggregateBySku(collectCategory(week, 'kegs'), 'volumeHL');

  const h2 = (text, marginTop = 26) => `<h2 style="font-size:14px;font-weight:700;font-family:${FONT_BODY};text-transform:uppercase;letter-spacing:0.03em;color:${EMAIL_TEXT};border-bottom:1px solid ${EMAIL_LINE_SOFT};padding-bottom:8px;margin:${marginTop}px 0 14px;">${text}</h2>`;

  const statCell = (label, value) => `
    <td width="33.33%" bgcolor="${EMAIL_PANEL}" style="background:${EMAIL_PANEL};padding:14px 14px 12px;">
      <div style="font-size:10px;font-family:${FONT_MONO};letter-spacing:0.06em;text-transform:uppercase;color:${EMAIL_MUTED};margin-bottom:6px;">${label}</div>
      <div style="font-size:19px;font-family:${FONT_MONO};font-weight:600;color:${EMAIL_TEXT};">${value}</div>
    </td>`;

  const pieCells = [
    ['Brewing', EMAIL_AMBER, brewingTotals],
    ['Cellar Transfers', EMAIL_HOP, transferTotals],
    ['Canning', EMAIL_STEEL_BLUE, cannedTotals],
    ['Kegging', EMAIL_PLUM, keggedTotals],
  ].map(([title, chip, totals]) => `<td width="25%" style="vertical-align:top;padding:0 4px;">${emailPieCard(totals, chip, title)}</td>`).join('');
  const pieRows = [`<tr>${pieCells}</tr>`];

  return `
<div style="width:966px;margin:0 auto;background:${EMAIL_VOID};padding:28px;font-family:${FONT_BODY};color:${EMAIL_TEXT};">
  ${logoPng ? `<div style="text-align:center;margin-bottom:16px;"><img src="${logoPng}" width="52" height="52" alt="Company logo" style="display:inline-block;width:52px;height:52px;"></div>` : ''}
  <div style="border-bottom:3px solid ${EMAIL_AMBER};padding-bottom:10px;margin-bottom:20px;">
    <div style="font-size:11px;font-family:${FONT_MONO};letter-spacing:0.1em;text-transform:uppercase;color:${EMAIL_COPPER};font-weight:bold;">Live Brewery Board</div>
    <div style="font-size:21px;font-family:${FONT_BODY};font-weight:700;color:${EMAIL_TEXT};margin-top:3px;">${weekLabel(week)}</div>
  </div>

  ${h2('Daily breakdown', 0)}
  <div style="margin:0 0 12px;font-family:${FONT_MONO};">
    <span style="display:inline-block;margin-right:16px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${EMAIL_MUTED};"><span style="display:inline-block;width:9px;height:9px;background:${EMAIL_AMBER};border-radius:2px;margin-right:6px;"></span>Brew</span>
    <span style="display:inline-block;margin-right:16px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${EMAIL_MUTED};"><span style="display:inline-block;width:9px;height:9px;background:${EMAIL_HOP};border-radius:2px;margin-right:6px;"></span>Transfer</span>
    <span style="display:inline-block;margin-right:16px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${EMAIL_MUTED};"><span style="display:inline-block;width:9px;height:9px;background:${EMAIL_STEEL_BLUE};border-radius:2px;margin-right:6px;"></span>Canning</span>
    <span style="display:inline-block;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${EMAIL_MUTED};"><span style="display:inline-block;width:9px;height:9px;background:${EMAIL_PLUM};border-radius:2px;margin-right:6px;"></span>Kegging</span>
  </div>
  ${emailImgTag(weekStrip.dataUrl, weekStrip.width, 'This week on the board — brew, transfer, canning, and kegging hL per day')}

  ${h2('Weekly totals')}
  <table role="presentation" width="964" cellpadding="0" cellspacing="1" bgcolor="${EMAIL_LINE}" style="border:1px solid ${EMAIL_LINE};">
    <tr>
      ${statCell('Brewing', fmt(brewed) + ' hL')}
      ${statCell('Transferring', fmt(transferred) + ' hL')}
      ${statCell('Canning', fmt(cartons) + ' cartons')}
    </tr>
    <tr>
      ${statCell('Kegging', fmt(kegs) + ' kegs')}
      ${statCell('Maintenance days', maintDays.length)}
      ${statCell('Grain deliveries', grainCount)}
    </tr>
  </table>

  <div style="margin-top:14px;">
    ${heaviest ? `<p style="font-size:13px;margin:0 0 4px;color:${EMAIL_TEXT};"><strong>Heaviest day:</strong> ${DAY_LABELS[heaviest.dayName]} (${fmt(heaviest.totalVolumeHL)} hL)</p>` : ''}
    ${lightest ? `<p style="font-size:13px;margin:0;color:${EMAIL_TEXT};"><strong>Lightest day:</strong> ${DAY_LABELS[lightest.dayName]} (${fmt(lightest.totalVolumeHL)} hL)</p>` : ''}
  </div>

  ${h2('Volume by SKU This Week')}
  <table role="presentation" width="966" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    ${pieRows.join('')}
  </table>

  <p style="font-size:11px;color:${EMAIL_FAINT};margin-top:26px;">Brew Board — derived from the Live Brewery Board.</p>
</div>`;
}

async function exportToGmail() {
  if (currentWeekIndex === null) return;
  const week = DATA.weeks[currentWeekIndex];
  const btn = document.getElementById('exportGmailBtn');
  const icon = document.getElementById('exportIcon');

  btn.disabled = true;

  let html;
  try {
    const logoPng = await logoReady;
    html = buildEmailHtml(week, logoPng);
  } catch (err) {
    console.error('Report build failed:', err);
    btn.disabled = false;
    alert("Couldn't build the report in this browser.");
    return;
  }

  const plainFallback = `Brew Board — ${weekLabel(week)}\n\n(This report is best viewed as pasted rich text — plain-text clients won't show the charts.)`;
  let copied = false;

  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainFallback], { type: 'text/plain' }),
        }),
      ]);
      copied = true;
    } catch (err) {
      console.warn('Clipboard HTML write failed, falling back to a manual-copy window:', err);
    }
  }

  if (copied) {
    icon.innerHTML = CHECK_ICON_SVG;
    btn.title = 'Copied!';
  } else {
    // Fallback: some browsers (older Firefox/Safari) don't support writing
    // HTML to the clipboard. Open the rendered report in its own tab so it
    // can be selected and copied by hand instead.
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(`<!doctype html><html><head><title>Brew Board — ${weekLabel(week)}</title></head><body style="margin:0;padding:24px;background:${EMAIL_VOID};">
        <p style="font-family:${FONT_BODY};font-size:13px;color:${EMAIL_MUTED};margin-bottom:16px;">Your browser can't copy this straight to the clipboard — select all (Ctrl/Cmd+A) and copy (Ctrl/Cmd+C) from this page, then paste into your email.</p>
        ${html}</body></html>`);
      w.document.close();
    } else {
      btn.disabled = false;
      alert("Couldn't copy the report and couldn't open a fallback tab (pop-up blocked?). Try allowing pop-ups for this site.");
      return;
    }
  }

  setTimeout(() => {
    icon.innerHTML = ARROW_ICON_SVG;
    btn.title = 'Copy email report to clipboard';
    btn.disabled = false;
  }, 2500);
}

init();
