// === js/sheets-dashboard.js ===
// 📊 업무 시트 대시보드 — 여러 비공개 구글 시트(첫 탭)를 Apps Script Web App으로 읽어
// 요약/정리해서 보여주는 별도 페이지. 설정은 Firestore 단일 문서에 저장(동기화).

import { initializeFirebase } from './config.js?v=202610021122';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { resolvePeriodRange, inDateRange } from './lib/calc.js?v=202610021122';
import { showConfirm, escapeHtml as esc } from './utils.js?v=202610021122';

const { db, auth } = initializeFirebase();
const CONFIG_REF = doc(db, 'artifacts', 'team-work-logger-v2', 'config', 'sheetDashboard');
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분 (수동 새로고침으로 즉시 갱신 가능)

let config = { scriptUrl: '', sheets: [] };

// 한 번에 한 시트만 보여준다. 마지막으로 보던 탭은 기기별로 기억한다.
const ACTIVE_KEY = 'sheetDashboardActiveTab';
let activeSheetId = localStorage.getItem(ACTIVE_KEY) || '';
const loadedSheets = new Set();   // 탭을 처음 열 때만 불러온다(불필요한 호출 방지)

const $ = (id) => document.getElementById(id);
const uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function extractSheetId(url) {
    if (!url) return '';
    const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : String(url).trim();
}

// ───────── 인증 게이트 ─────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        $('auth-gate').classList.remove('hidden');
        $('main').classList.add('hidden');
        return;
    }
    $('auth-gate').classList.add('hidden');
    $('main').classList.remove('hidden');
    await loadConfig();
    renderAll();
    loadFxRate().then(rerenderKpiCards); // 환율 로드되면 ₩ 반영해 KPI 다시 렌더
});

// ───────── 설정 로드/저장 (Firestore) ─────────
async function loadConfig() {
    try {
        const snap = await getDoc(CONFIG_REF);
        if (snap.exists()) {
            const d = snap.data();
            config = { scriptUrl: d.scriptUrl || '', sheets: Array.isArray(d.sheets) ? d.sheets : [] };
        }
    } catch (e) { console.warn('설정 로드 실패:', e); }
}
async function saveConfig() {
    // 실패를 삼키면 화면만 바뀌고 새로고침하면 되돌아가 '수정이 안 되는' 것처럼 보인다.
    // 호출한 쪽에서 사용자에게 알리도록 그대로 던진다.
    await setDoc(CONFIG_REF, config);
}

// ───────── 가져올 영역(A1 범위) ─────────
// 'A1:H200' · 'B:F'(열만) · 'A5:'(5행부터) · '3:100'(행만) 형태를 받는다.
// 범위의 첫 줄이 머리글이 된다.
function parseA1Range(range) {
    const s = String(range || '').trim().toUpperCase().replace(/\s/g, '');
    if (!s) return null;
    const m = s.match(/^([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/);
    if (!m || (!m[1] && !m[2])) return null;
    const colNum = (c) => { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
    const [, c1, r1, c2, r2] = m;
    const hasEnd = s.includes(':');
    return {
        col0: c1 ? colNum(c1) : 0,
        col1: hasEnd ? (c2 ? colNum(c2) : Infinity) : (c1 ? colNum(c1) : Infinity),
        row0: r1 ? Number(r1) - 1 : 0,
        row1: hasEnd ? (r2 ? Number(r2) - 1 : Infinity) : (r1 ? Number(r1) - 1 : Infinity)
    };
}

/** 받아온 표를 지정한 범위로 자른다.
 *  Apps Script가 이미 잘라서 준 경우(json.appliedRange)는 그대로 쓴다. */
function applyRange(data, range) {
    const r = parseA1Range(range);
    if (!r) return data;
    // headers 는 시트 1행, rows 는 2행부터다 → A1 행 번호와 맞추려면 다시 이어 붙인다.
    const grid = [data.headers || [], ...(data.rows || [])];
    const cut = grid
        .slice(r.row0, r.row1 === Infinity ? undefined : r.row1 + 1)
        .map(row => (row || []).slice(r.col0, r.col1 === Infinity ? undefined : r.col1 + 1));
    if (!cut.length) return { ...data, headers: [], rows: [] };
    return { ...data, headers: cut[0], rows: cut.slice(1) };
}

// ───────── Apps Script fetch (+ localStorage 캐시) ─────────
async function fetchSheet(sheetId, force, opts = {}) {
    if (!config.scriptUrl) throw new Error('Apps Script URL이 설정되지 않았습니다. (⚙️ 설정)');
    const tab = (opts.tabName || '').trim();
    const range = (opts.range || '').trim();
    // 캐시는 '등록한 시트 항목(localId)' 단위로 둔다.
    // 같은 스프레드시트를 탭만 달리해 두 번 등록해도 서로의 데이터를 물려받지 않는다.
    const cacheKey = 'sheetdash_' + (opts.localId || sheetId) + '|' + tab + '|' + range;
    if (!force) {
        try {
            const c = JSON.parse(localStorage.getItem(cacheKey) || 'null');
            if (c && Date.now() - c.at < CACHE_TTL_MS && c.data) return c.data;
        } catch (_) {}
    }
    let url = config.scriptUrl + (config.scriptUrl.includes('?') ? '&' : '?') + 'id=' + encodeURIComponent(sheetId);
    // Apps Script가 tab/range를 지원하면 서버에서 잘라 보내 준다(전송량 절감).
    // 지원하지 않는 예전 스크립트는 이 값을 무시하므로, 아래에서 받아온 표를 직접 자른다.
    if (tab) url += '&tab=' + encodeURIComponent(tab);
    if (range) url += '&range=' + encodeURIComponent(range);

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    let json = await res.json();
    if (!json.ok) throw new Error(json.error || '읽기 실패');

    if (range && !json.appliedRange) json = applyRange(json, range);
    json.requestedTab = tab;

    try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data: json })); } catch (_) {}
    return json;
}

// ───────── 숫자 컬럼 감지 + 합계 ─────────
const parseNum = (v) => {
    if (typeof v === 'number') return v;
    let s = String(v == null ? '' : v).trim();
    if (!s || s === '-' || s.includes('#')) return null; // 빈칸, "$ -", #REF! 등
    const n = Number(s.replace(/[,\s$₩원]/g, ''));
    return isNaN(n) ? null : n;
};
const getTodayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
function numericColumns(headers, rows) {
    return headers.map((h, ci) => {
        let n = 0, ok = 0;
        rows.forEach(r => {
            const v = r[ci];
            if (v === '' || v == null) return;
            n++;
            if (parseNum(v) !== null) ok++;
        });
        return n >= 2 && ok / n >= 0.8; // 비어있지 않은 값의 80%+가 숫자면 숫자 컬럼
    });
}

// ───────── 주문/결제 장부 KPI (헤더명 자동 매핑) ─────────
const norm = (h) => String(h == null ? '' : h).replace(/[\s\n]/g, '');
const periodState = {}; // localId -> 'today'|'week'|'month'|'year'|'custom'
const periodRange = {}; // localId -> { from, to }  (custom 기간 조회용)

/** 시트마다 정해 둔 보기 방식 — 'kpi'(오더·결제 화면)로 직접 지정한 시트만 특별 화면이다.
 *  예전에는 머리글을 보고 자동 판별했는데, 서로 다른 스프레드시트라도 양식이 같으면
 *  모두 같은 화면으로 잡혀서(금액관리 ↔ 패킹·송금관리) 구분이 되지 않았다.
 *  그래서 특별 화면은 '켠 시트만' 쓰도록 바꿨다. 나머지는 전부 시트 그대로 표로 본다. */
const VIEW_BADGE = {
    table: { text: '기본 표',  cls: 'bg-slate-100 text-slate-500' },
    kpi:   { text: '금액관리', cls: 'bg-indigo-100 text-indigo-700' }
};

function viewModeOf(cfg) {
    return (cfg && cfg.viewMode === 'kpi') ? 'kpi' : 'table';
}

// ───────── 금액 칸 서식 ─────────
// 머리글이 금액을 뜻하는 칸만 통화로 보여준다.
// '송금일'처럼 날짜인 칸이 걸리지 않도록 '송금액'을 통째로 본다.
const MONEY_WORDS = ['금액', '수수료', '합계', '송금액', '잔액', '단가', '원가', '총액', '비용', '매출', '가격', '결제'];
const isMoneyHeader = (h) => {
    const t = norm(h);
    if (!t) return false;
    if (t.includes('일') && !t.includes('금액')) return false;   // 송금일·마감일 등 날짜 칸 제외
    return MONEY_WORDS.some(w => t.includes(w));
};
const moneyFormatOf = (cfg) => (cfg && cfg.moneyFormat === 'usd') ? 'usd' : 'none';
const USD_FMT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** KPI 화면에 쓸 열 위치. 'kpi'로 지정한 시트에서만 찾는다. */
function orderColsFor(cfg, headers) {
    if (viewModeOf(cfg) !== 'kpi') return null;
    return detectOrderCols(headers);
}

function detectOrderCols(headers) {
    const find = (pred) => { const i = (headers || []).findIndex(h => pred(norm(h))); return i < 0 ? null : i; };
    const idx = {
        date:    find(h => h.includes('일자') || h.includes('날짜')),
        reorder: find(h => h.includes('오더(리오더)')) ?? find(h => h.includes('리오더') && !h.includes('계약금')),
        newp:    find(h => h.includes('오더(신상)')) ?? find(h => h.includes('신상') && h.includes('오더') && !h.includes('계약금')),
        pay:     find(h => h.includes('결제') || h.includes('송금')),
        ship:    find(h => h.includes('출고예정금액') && h.includes('패킹')) ?? find(h => h.includes('출고예정금액')),
        unship:  find(h => h.includes('미출고') && h.includes('잔액')),
        pack:    (() => { const i = (headers||[]).findIndex(h => norm(h) === '패킹잔액'); return i < 0 ? find(h => h.includes('패킹잔액') && !h.includes('총')) : i; })()
    };
    const ok = idx.date != null && (idx.reorder != null || idx.newp != null || idx.pay != null);
    return ok ? idx : null;
}

// 기간 선택 드롭다운 옵션 (그룹별 전·현·후)
const PERIOD_GROUPS = [
    ['일', [['day:-1', '어제'], ['day:0', '오늘'], ['day:1', '내일']]],
    ['주', [['week:-1', '지난주'], ['week:0', '이번주'], ['week:1', '다음주']]],
    ['월', [['month:-1', '지난달'], ['month:0', '이번달'], ['month:1', '다음달']]],
    ['년', [['year:-1', '작년'], ['year:0', '올해'], ['year:1', '내년']]],
];
const periodLabelOf = (period) => {
    for (const [, items] of PERIOD_GROUPS) {
        const hit = items.find(([v]) => v === period);
        if (hit) return hit[1];
    }
    return '';
};

const fmtMoney = (n) => '$' + Math.round(n || 0).toLocaleString();
const fmtKrw = (n) => '₩' + Math.round(n || 0).toLocaleString();

// ───────── 환율 (USD→KRW, 자동, 6시간 캐시) ─────────
let usdKrw = null, fxUpdated = '';
async function loadFxRate() {
    const KEY = 'usdkrw_fx_v1', TTL = 6 * 60 * 60 * 1000;
    try {
        const c = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (c && Date.now() - c.at < TTL && c.rate) { usdKrw = c.rate; fxUpdated = c.upd || ''; return; }
    } catch (_) {}
    // 1차: open.er-api.com (무키/CORS)
    try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
        const j = await r.json();
        if (j && j.rates && j.rates.KRW) {
            usdKrw = j.rates.KRW;
            fxUpdated = j.time_last_update_unix ? (() => { const d = new Date(j.time_last_update_unix * 1000); return `${d.getMonth() + 1}/${d.getDate()}`; })() : '';
            try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rate: usdKrw, upd: fxUpdated })); } catch (_) {}
            return;
        }
    } catch (_) {}
    // 2차: jsdelivr currency-api
    try {
        const r = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', { cache: 'no-store' });
        const j = await r.json();
        if (j && j.usd && j.usd.krw) {
            usdKrw = j.usd.krw; fxUpdated = j.date ? j.date.slice(5).replace('-', '/') : '';
            try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rate: usdKrw, upd: fxUpdated })); } catch (_) {}
        }
    } catch (_) {}
}
// 환율 로드 후 KPI 카드들 다시 렌더(₩ 반영)
function rerenderKpiCards() {
    config.sheets.forEach(cfg => {
        const d = cardData[cfg.localId];
        if (!d) return;
        const ix = orderColsFor(cfg, d.headers);
        if (ix) renderKpi(cfg, d, ix);
    });
}

// 선택 기간의 '날짜별 내역' 테이블 HTML (오더/결제/출고예정/미출고/패킹)
function buildDateBreakdown(rows, idx, inPeriod) {
    const dOf = (r) => String(r[idx.date] == null ? '' : r[idx.date]).slice(0, 10);
    const cols = [];
    if (idx.reorder != null || idx.newp != null) cols.push(['order', '오더', 'text-indigo-700']);
    if (idx.pay != null)    cols.push(['pay', '결제', 'text-emerald-700']);
    if (idx.ship != null)   cols.push(['ship', '출고예정', 'text-amber-700']);
    if (idx.unship != null) cols.push(['unship', '미출고', 'text-rose-600']);
    if (idx.pack != null)   cols.push(['pack', '패킹', 'text-slate-600']);

    const byDate = new Map();
    rows.forEach(r => {
        const d = dOf(r);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !inPeriod(r[idx.date])) return;
        const o = byDate.get(d) || { order: 0, pay: 0, ship: 0, unship: null, pack: null };
        if (idx.reorder != null) o.order += parseNum(r[idx.reorder]) || 0;
        if (idx.newp != null)    o.order += parseNum(r[idx.newp]) || 0;
        if (idx.pay != null)     o.pay   += parseNum(r[idx.pay]) || 0;
        if (idx.ship != null)    o.ship  += parseNum(r[idx.ship]) || 0;
        if (idx.unship != null)  { const v = parseNum(r[idx.unship]); if (v != null) o.unship = v; } // 잔액=스냅샷(마지막값)
        if (idx.pack != null)    { const v = parseNum(r[idx.pack]); if (v != null) o.pack = v; }
        byDate.set(d, o);
    });
    const dates = [...byDate.keys()].sort(); // 날짜 오름차순 (오래된 → 최신)
    if (dates.length === 0) return `<div class="p-4 text-center text-slate-400 text-sm">선택한 기간에 데이터가 없습니다.</div>`;

    const tot = { order: 0, pay: 0, ship: 0 };
    dates.forEach(d => { const o = byDate.get(d); tot.order += o.order; tot.pay += o.pay; tot.ship += o.ship; });

    const th = `<th class="px-2 py-1.5 text-left whitespace-nowrap">날짜</th>` +
        cols.map(([, l]) => `<th class="px-2 py-1.5 text-right whitespace-nowrap">${l}</th>`).join('');
    const trs = dates.map(d => {
        const o = byDate.get(d);
        const tds = cols.map(([k, , tone]) => {
            const v = o[k];
            return `<td class="num ${tone}">${v == null ? '<span class="text-slate-300">-</span>' : fmtMoney(v)}</td>`;
        }).join('');
        return `<tr><td class="font-bold text-slate-700 whitespace-nowrap">${esc(d)}</td>${tds}</tr>`;
    }).join('');
    const totTds = cols.map(([k, , tone]) =>
        (k === 'order' || k === 'pay' || k === 'ship')
            ? `<td class="num font-extrabold ${tone}">${fmtMoney(tot[k])}</td>`
            : `<td class="num text-slate-300">-</td>`
    ).join('');
    const totRow = `<tr style="background:#f1f5f9;"><td class="font-extrabold text-slate-600">합계</td>${totTds}</tr>`;

    return `<table class="data-table"><thead><tr>${th}</tr></thead><tbody>${trs}${totRow}</tbody></table>`;
}

function renderKpi(cfg, data, idx) {
    const body = $('body-' + cfg.localId);
    if ($('search-' + cfg.localId)) $('search-' + cfg.localId).style.display = 'none';
    const today = getTodayStr();
    const period = periodState[cfg.localId] || 'month:0';
    const rows = data.rows || [];
    const dOf = (r) => String(r[idx.date] == null ? '' : r[idx.date]).slice(0, 10);

    // 기간(custom) 기본 범위: 미설정 시 데이터의 최소~최대 날짜
    if (period === 'custom') {
        const c = periodRange[cfg.localId] || {};
        if (!c.from || !c.to) {
            const ds = rows.map(dOf).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
            periodRange[cfg.localId] = {
                from: c.from || ds[0] || (today.slice(0, 7) + '-01'),
                to:   c.to   || ds[ds.length - 1] || today
            };
        }
    }
    const range = period === 'custom' ? (periodRange[cfg.localId] || {}) : resolvePeriodRange(period, today);
    const inPeriod = (dStr) => inDateRange(dStr, range.from, range.to);

    const sumPeriod = (ci) => ci == null ? 0 : rows.reduce((a, r) => inPeriod(r[idx.date]) ? a + (parseNum(r[ci]) || 0) : a, 0);
    const reorder = sumPeriod(idx.reorder), newp = sumPeriod(idx.newp), pay = sumPeriod(idx.pay);
    const orderTotal = reorder + newp;

    // 현재 상태: 오늘 행(없으면 오늘 이하 최신 행)
    let cur = rows.find(r => dOf(r) === today);
    if (!cur) { const past = rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(dOf(r)) && dOf(r) <= today); cur = past[past.length - 1]; }
    const unship = cur && idx.unship != null ? (parseNum(cur[idx.unship]) || 0) : 0;
    const pack = cur && idx.pack != null ? (parseNum(cur[idx.pack]) || 0) : 0;
    const shipFuture = idx.ship == null ? 0 : rows.reduce((a, r) => { const d = dOf(r); return (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today) ? a + (parseNum(r[idx.ship]) || 0) : a; }, 0);

    // 기간 드롭다운 (일/주/월/년 그룹별 전·현·후 + 기간 지정)
    const optsHtml = PERIOD_GROUPS.map(([grp, items]) =>
        `<optgroup label="${grp}">` +
        items.map(([v, l]) => `<option value="${v}"${period === v ? ' selected' : ''}>${l}</option>`).join('') +
        `</optgroup>`
    ).join('') + `<option value="custom"${period === 'custom' ? ' selected' : ''}>기간 지정…</option>`;
    const pSelect = `<select data-period-sel="${cfg.localId}" class="text-xs font-bold border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-700 cursor-pointer">${optsHtml}</select>`;
    const rangeUI = `<span class="${period === 'custom' ? 'inline-flex' : 'hidden'} items-center gap-1 ml-1">
        <input type="date" data-range="${cfg.localId}:from" value="${range.from || ''}" class="text-xs border border-slate-300 rounded-md px-2 py-1">
        <span class="text-slate-400 text-xs">~</span>
        <input type="date" data-range="${cfg.localId}:to" value="${range.to || ''}" class="text-xs border border-slate-300 rounded-md px-2 py-1">
    </span>`;
    const rangeStr = range.from ? (range.from === range.to ? esc(range.from) : `${esc(range.from)} ~ ${esc(range.to || '')}`) : '';
    const periodLabel = period === 'custom'
        ? rangeStr
        : `${periodLabelOf(period)}${rangeStr ? ` · ${rangeStr}` : ''}`;

    const fxLine = (usd) => usdKrw ? `<div class="text-[12px] font-bold text-slate-500 mt-0.5">${fmtKrw(usd * usdKrw)}</div>` : '';
    const kcard = (label, usd, note, tone) => `<div class="rounded-xl border border-slate-200 p-3.5 bg-white"><div class="text-[11px] font-bold text-slate-400 mb-1">${label}</div><div class="text-xl font-extrabold ${tone || 'text-slate-800'}">${fmtMoney(usd)}</div>${fxLine(usd)}${note ? `<div class="text-[11px] text-slate-400 mt-0.5">${note}</div>` : ''}</div>`;
    const fxCap = usdKrw
        ? `<span class="text-[11px] text-slate-400 ml-auto">💱 1 USD ≈ ₩${Math.round(usdKrw).toLocaleString()}${fxUpdated ? ` · ${esc(fxUpdated)} 기준` : ''}</span>`
        : `<span class="text-[11px] text-slate-300 ml-auto">환율 불러오는 중…</span>`;

    const breakdownHtml = buildDateBreakdown(rows, idx, inPeriod);

    body.style.maxHeight = 'none';
    body.innerHTML = `
        <div class="p-4 space-y-4">
            <div class="flex items-center gap-1.5 flex-wrap"><span class="text-[11px] text-slate-400 mr-1">기간:</span>${pSelect}${rangeUI}${fxCap}</div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                ${kcard('오더 총합', orderTotal, '리오더 + 신상', 'text-indigo-700')}
                ${kcard('오더 (리오더)', reorder, '', 'text-slate-800')}
                ${kcard('오더 (신상)', newp, '', 'text-slate-800')}
                ${kcard('결제 (송금)', pay, '', 'text-emerald-700')}
            </div>
            <div class="text-[11px] font-bold text-slate-400 pt-1">현재 상태${cur ? ` · 기준일 ${esc(dOf(cur))}` : ''}</div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                ${kcard('출고 예정금액 (오늘 및 이후)', shipFuture, '', 'text-amber-700')}
                ${kcard('미출고 잔액', unship, '', 'text-rose-700')}
                ${kcard('패킹 잔액', pack, '', 'text-slate-800')}
            </div>
            <div class="pt-1">
                <div class="text-xs font-bold text-slate-500 mb-1.5">📅 날짜별 내역${periodLabel ? ` · ${periodLabel}` : ''}</div>
                <div class="overflow-auto border border-slate-200 rounded-lg" style="max-height:45vh;">${breakdownHtml}</div>
            </div>
            <details class="pt-1">
                <summary class="text-xs font-bold text-slate-500 cursor-pointer select-none">📋 원본 데이터 보기 (최근순)</summary>
                <div class="mt-2 overflow-auto border border-slate-200 rounded-lg" style="max-height:50vh;" id="rawtbl-${cfg.localId}"></div>
            </details>
        </div>`;
    renderRawTable(data, $('rawtbl-' + cfg.localId), idx.date);
}

function renderRawTable(data, mount, dateIdx) {
    if (!mount) return;
    const headers = data.headers || [], rows = data.rows || [];
    const isNum = numericColumns(headers, rows);
    // 날짜 컬럼 기준 최근 200행 (날짜 내림차순)
    let list = rows.slice();
    if (dateIdx != null) list = list.filter(r => String(r[dateIdx] || '').trim()).sort((a, b) => String(b[dateIdx]).localeCompare(String(a[dateIdx])));
    list = list.slice(0, 200);
    let html = '<table class="data-table"><thead><tr>';
    headers.forEach(h => { html += `<th>${esc(String(h).replace(/\n/g, ' '))}</th>`; });
    html += '</tr></thead><tbody>';
    list.forEach(r => { html += '<tr>' + headers.map((h, i) => `<td class="${isNum[i] ? 'num' : ''}">${esc(r[i])}</td>`).join('') + '</tr>'; });
    html += '</tbody></table>';
    mount.innerHTML = html;
}

// ───────── 렌더 ─────────
function renderAll() {
    const container = $('sheets-container');
    container.innerHTML = '';
    loadedSheets.clear();
    $('no-config').classList.toggle('hidden', !(config.sheets.length === 0));

    // 지워졌거나 아직 정한 적 없는 탭이면 첫 시트로
    if (!config.sheets.some(s => s.localId === activeSheetId)) {
        activeSheetId = config.sheets.length ? config.sheets[0].localId : '';
    }
    renderTabs();

    config.sheets.forEach(cfg => {
        const card = document.createElement('section');
        card.className = 'bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden';
        card.id = 'card-' + cfg.localId;
        card.innerHTML = `
            <div class="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                <div class="font-bold text-slate-800 flex items-center gap-2">📄 ${esc(cfg.name || '시트')}
                    <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        VIEW_BADGE[viewModeOf(cfg)].cls}" title="보기 방식">${VIEW_BADGE[viewModeOf(cfg)].text}</span>
                    ${moneyFormatOf(cfg) === 'usd'
                        ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700" title="금액 칸을 달러로 표시">$</span>' : ''}
                    ${(cfg.tabName || cfg.range)
                        ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">${
                            esc([cfg.tabName, cfg.range].filter(Boolean).join(' · '))}</span>` : ''}
                    <span class="text-[10px] text-slate-300 font-mono" title="스프레드시트 ID: ${esc(cfg.sheetId || '')}">${
                        esc(String(cfg.sheetId || '').slice(0, 6))}…</span>
                    <span id="cnt-${cfg.localId}" class="text-[11px] font-bold text-slate-400"></span>
                </div>
                <div class="flex items-center gap-1.5">
                    <input id="search-${cfg.localId}" type="text" placeholder="검색…" class="text-xs px-2 py-1.5 border border-slate-200 rounded-md w-32 focus:w-44 transition-all">
                    <button data-cols="${cfg.localId}" class="text-xs px-2 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600" title="컬럼 선택">🧩 컬럼</button>
                    <button data-edit="${cfg.localId}" class="text-xs px-2 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600" title="편집">✏️</button>
                    <button data-refresh="${cfg.localId}" class="text-xs px-2 py-1.5 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700" title="새로고침">🔄</button>
                </div>
            </div>
            <div id="warn-${cfg.localId}" class="hidden"></div>
            <div id="body-${cfg.localId}" class="overflow-auto" style="max-height:calc(100vh - 256px); min-height:220px;">
                <div class="p-6 text-center text-slate-400 text-sm">불러오는 중…</div>
            </div>`;
        card.classList.toggle('hidden', cfg.localId !== activeSheetId);
        container.appendChild(card);
    });

    // 보이는 탭만 불러온다. 나머지는 그 탭을 눌렀을 때.
    const active = config.sheets.find(s => s.localId === activeSheetId);
    if (active) { loadedSheets.add(active.localId); loadCard(active, false); }
}

/** 시트 탭 줄 */
function renderTabs() {
    const bar = $('sheet-tabs');
    if (!bar) return;
    bar.classList.toggle('hidden', config.sheets.length === 0);
    bar.innerHTML = config.sheets.map(cfg =>
        `<button type="button" class="sheet-tab ${cfg.localId === activeSheetId ? 'active' : ''}"
                 data-tab="${esc(cfg.localId)}">${esc(cfg.name || '시트')}</button>`).join('');
}

/** 보이는 카드의 표 영역이 화면 아래까지 꽉 차도록 높이를 맞춘다.
 *  머리글 줄이 접히는 좁은 화면에서도 어긋나지 않게, 고정값 대신 실제 위치를 잰다. */
function fitCardHeight() {
    const body = $('body-' + activeSheetId);
    if (!body) return;
    const top = body.getBoundingClientRect().top;
    const h = Math.max(220, Math.round(window.innerHeight - top - 16));
    body.style.maxHeight = h + 'px';
}

// 요약 칩 줄 수는 글꼴이 늦게 로드되면 한 번 더 바뀐다 → 잠시 뒤 다시 맞춘다.
let fitTimer = null;
function scheduleFit() {
    fitCardHeight();
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitCardHeight, 120);
}
window.addEventListener('resize', fitCardHeight);

/** 탭 전환 — 해당 카드만 보이고, 처음 여는 탭이면 그때 불러온다. */
function activateSheet(localId) {
    if (!config.sheets.some(s => s.localId === localId)) return;
    activeSheetId = localId;
    try { localStorage.setItem(ACTIVE_KEY, localId); } catch (_) {}
    renderTabs();
    config.sheets.forEach(cfg => {
        const card = $('card-' + cfg.localId);
        if (card) card.classList.toggle('hidden', cfg.localId !== localId);
    });
    if (!loadedSheets.has(localId)) {
        loadedSheets.add(localId);
        const cfg = config.sheets.find(s => s.localId === localId);
        if (cfg) loadCard(cfg, false);
    }
    scheduleFit();
}

$('sheet-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) activateSheet(t.dataset.tab);
});

async function loadCard(cfg, force) {
    const body = $('body-' + cfg.localId);
    const cnt = $('cnt-' + cfg.localId);
    if (!body) return;
    try {
        body.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">불러오는 중…</div>`;
        const data = await fetchSheet(cfg.sheetId, force, { localId: cfg.localId, tabName: cfg.tabName, range: cfg.range });
        cardData[cfg.localId] = data;
        const orderIdx = orderColsFor(cfg, data.headers);
        if (orderIdx) renderKpi(cfg, data, orderIdx);
        else renderSheetTable(cfg, data);

        // 탭을 지정했는데 다른 탭 내용이 왔다면(= Apps Script가 tab 값을 무시) 알려 준다.
        // 이걸 알리지 않으면 같은 스프레드시트의 두 시트가 똑같은 내용으로 보인다.
        // 표 영역이 아니라 전용 자리에 두어, 컬럼을 다시 골라도 경고가 사라지지 않게 한다.
        const warnEl = $('warn-' + cfg.localId);
        const wantTab = (cfg.tabName || '').trim();
        const gotTab = String(data.sheetName || '').trim();
        const msgs = [];
        if (wantTab && gotTab && norm(gotTab) !== norm(wantTab)) {
            msgs.push(`⚠️ 지정한 탭 <b>${esc(wantTab)}</b> 대신 <b>${esc(gotTab)}</b> 탭 내용이 왔습니다.
                       Apps Script가 <code>tab</code> 값을 받아 처리하도록 고쳐야 탭 선택이 적용됩니다.`);
        }
        if (viewModeOf(cfg) === 'kpi' && !orderIdx) {
            msgs.push(`⚠️ 금액관리 화면으로 설정했지만 필요한 열(일자 · 오더 · 결제)을 찾지 못해 표로 보여줍니다.`);
        }
        if (warnEl) {
            warnEl.classList.toggle('hidden', msgs.length === 0);
            warnEl.innerHTML = msgs.length
                ? `<div class="mx-4 mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 leading-relaxed">
                       ${msgs.join('<br>')}
                   </div>` : '';
        }
        const ts = data.ts ? new Date(data.ts) : new Date();
        if (cnt) cnt.textContent = `· ${data.rows.length}행 · ${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')} 갱신`;
    } catch (e) {
        const w = $('warn-' + cfg.localId);
        if (w) { w.innerHTML = ''; w.classList.add('hidden'); }
        body.innerHTML = `<div class="p-6 text-center text-red-500 text-sm">⚠️ ${esc(e.message)}</div>`;
    }
    scheduleFit();
}

const cardData = {}; // localId -> {headers, rows, sheetName}

// 표만 그린다. 예전에는 위에 '총 n행 · 컬럼별 합계' 칩 줄을 붙였는데,
// 컬럼이 많으면 여러 줄로 늘어져 표를 가렸고 날짜 같은 컬럼까지 합계가 잡혔다.
// 행 수는 카드 제목 옆(cnt-*)에 이미 나온다.
function renderSheetTable(cfg, data) {
    const { headers, rows } = data;
    const hidden = new Set(cfg.hiddenCols || []);
    const visIdx = headers.map((h, i) => i).filter(i => !hidden.has(headers[i]));
    const isNum = numericColumns(headers, rows);
    // 금액 칸은 통화로 보여준다(설정한 시트만). 숫자가 아닌 값은 그대로 둔다.
    const asMoney = moneyFormatOf(cfg) === 'usd';
    const isMoney = headers.map((h, i) => asMoney && isNum[i] && isMoneyHeader(h));
    const cellText = (v, i) => {
        if (!isMoney[i]) return esc(v);
        const n = parseNum(v);
        return n === null ? esc(v) : USD_FMT.format(n);
    };

    // 검색 필터
    const q = ($('search-' + cfg.localId)?.value || '').trim().toLowerCase();
    const filtered = q ? rows.filter(r => visIdx.some(i => String(r[i] == null ? '' : r[i]).toLowerCase().includes(q))) : rows;

    // 표
    const body = $('body-' + cfg.localId);
    if (!filtered.length) { body.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">표시할 데이터가 없습니다.</div>`; return; }
    let html = '<table class="data-table"><thead><tr>';
    visIdx.forEach(i => { html += `<th>${esc(headers[i] || '')}</th>`; });
    html += '</tr></thead><tbody>';
    const MAX = 500; // 과도한 렌더 방지
    filtered.slice(0, MAX).forEach(r => {
        html += '<tr>';
        visIdx.forEach(i => { html += `<td class="${isNum[i] ? 'num' : ''}">${cellText(r[i], i)}</td>`; });
        html += '</tr>';
    });
    html += '</tbody></table>';
    if (filtered.length > MAX) html += `<div class="p-2 text-center text-[11px] text-slate-400">상위 ${MAX}행만 표시 (검색으로 좁혀보세요)</div>`;
    body.innerHTML = html;
}

// ───────── 이벤트 ─────────
$('sheets-container').addEventListener('click', (e) => {
    const c = e.target.closest('[data-cols]'); const ed = e.target.closest('[data-edit]'); const rf = e.target.closest('[data-refresh]');
    if (c) openColsModal(c.dataset.cols);
    else if (ed) openSheetModal(ed.dataset.edit);
    else if (rf) { const id = rf.dataset.refresh; const cfg = config.sheets.find(s => s.localId === id); if (cfg) loadCard(cfg, true); }
});
$('sheets-container').addEventListener('input', (e) => {
    const s = e.target.closest('[id^="search-"]');
    if (s) { const id = s.id.replace('search-', ''); const cfg = config.sheets.find(x => x.localId === id);
        if (cfg && cardData[id] && !orderColsFor(cfg, cardData[id].headers)) renderSheetTable(cfg, cardData[id]); }
});
// 기간 드롭다운/날짜 입력 변경 → 해당 시트만 다시 렌더
$('sheets-container').addEventListener('change', (e) => {
    const rerender = (id) => {
        const cfg = config.sheets.find(s => s.localId === id);
        const d = cardData[id];
        const ix = d && orderColsFor(cfg, d.headers);
        if (cfg && ix) renderKpi(cfg, d, ix);
    };
    const sel = e.target.closest('[data-period-sel]');
    if (sel) { periodState[sel.dataset.periodSel] = sel.value; rerender(sel.dataset.periodSel); return; }

    const ri = e.target.closest('[data-range]');
    if (ri) {
        const [id, which] = ri.dataset.range.split(':');
        periodRange[id] = periodRange[id] || {};
        periodRange[id][which] = ri.value;
        periodState[id] = 'custom';
        rerender(id);
    }
});

// 이미 열어 본 시트만 다시 부른다. 아직 안 연 탭은 그 탭을 누를 때 불러온다.
$('btn-refresh-all').onclick = () => config.sheets
    .filter(cfg => loadedSheets.has(cfg.localId))
    .forEach(cfg => loadCard(cfg, true));

// 창 닫기 — 별도 창/탭으로 열린 경우 닫고, 브라우저가 막으면 메인으로 복귀
$('btn-close').onclick = () => {
    window.close();
    setTimeout(() => { window.location.href = 'index.html'; }, 200);
};

// 설정 모달
$('btn-settings').onclick = () => { $('inp-script-url').value = config.scriptUrl || ''; show('settings-modal'); };
$('btn-save-settings').onclick = async () => { config.scriptUrl = $('inp-script-url').value.trim(); await saveConfig(); hide('settings-modal'); renderAll(); };

// 시트 추가/편집 모달
$('btn-add').onclick = () => openSheetModal(null);
// 화면(HTML)과 스크립트 버전이 어긋나 입력칸이 없을 수 있다.
// 그때 예외로 죽으면 '저장이 안 되는' 것처럼 보이므로, 없으면 건너뛰고 알려 준다.
const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
const getVal = (id, fallback = '') => { const el = $(id); return el ? el.value : fallback; };

function openSheetModal(localId) {
    const cfg = localId ? config.sheets.find(s => s.localId === localId) : null;
    $('sheet-modal-title').textContent = cfg ? '✏️ 시트 편집' : '➕ 시트 추가';
    setVal('inp-sheet-localid', cfg ? cfg.localId : '');
    setVal('inp-sheet-name', cfg ? cfg.name : '');
    setVal('inp-sheet-url', cfg ? cfg.sheetId : '');
    setVal('inp-sheet-tab', cfg ? (cfg.tabName || '') : '');
    setVal('inp-sheet-range', cfg ? (cfg.range || '') : '');
    setVal('inp-sheet-view', cfg ? viewModeOf(cfg) : 'table');   // 새 시트는 '기본 표'로 시작
    setVal('inp-sheet-money', cfg ? moneyFormatOf(cfg) : 'none');
    if (!$('inp-sheet-view')) {
        alert('화면이 예전 버전으로 남아 있습니다.\n\n브라우저를 강력 새로고침(Ctrl+Shift+R) 한 뒤 다시 시도해주세요.');
    }
    $('btn-delete-sheet').classList.toggle('hidden', !cfg);
    show('sheet-modal');
}
$('btn-save-sheet').onclick = async () => {
  try {
    const name = getVal('inp-sheet-name').trim();
    const sheetId = extractSheetId(getVal('inp-sheet-url'));
    if (!name || !sheetId) { alert('이름과 시트 URL을 입력하세요.'); return; }
    const tabName = getVal('inp-sheet-tab').trim();
    const range = getVal('inp-sheet-range').trim();
    const viewMode = getVal('inp-sheet-view', 'table');
    const moneyFormat = getVal('inp-sheet-money', 'none');
    if (range && !parseA1Range(range)) {
        alert('범위 형식을 확인해주세요.\n\n예) A1:H200 · B:F · A5: · 3:100');
        return;
    }

    const localId = getVal('inp-sheet-localid');
    if (localId) {
        const cfg = config.sheets.find(s => s.localId === localId);
        if (!cfg) { alert('수정할 시트를 찾지 못했습니다. 창을 닫고 다시 시도해주세요.'); return; }
        cfg.name = name; cfg.sheetId = sheetId; cfg.tabName = tabName; cfg.range = range; cfg.viewMode = viewMode; cfg.moneyFormat = moneyFormat;
        // 설정이 바뀌었으니 예전에 받아 둔 내용은 버린다(옛 화면이 남지 않도록).
        delete cardData[localId];
        loadedSheets.delete(localId);
    } else {
        const newId = uid();
        config.sheets.push({ localId: newId, name, sheetId, tabName, range, viewMode, moneyFormat, hiddenCols: [] });
        activeSheetId = newId;   // 새로 추가한 시트를 바로 보여준다
    }
    await saveConfig();
    hide('sheet-modal');
    renderAll();
  } catch (e) {
    console.error('시트 설정 저장 실패:', e);
    alert('시트 설정을 저장하지 못했습니다.\n\n' + (e && e.message ? e.message : e));
  }
};
$('btn-delete-sheet').onclick = async () => {
    const localId = $('inp-sheet-localid').value;
    if (!localId) return;
    if (!await showConfirm('이 시트를 대시보드에서 삭제할까요?', { title: '시트 삭제', okText: '삭제', danger: true })) return;
    config.sheets = config.sheets.filter(s => s.localId !== localId);
    await saveConfig(); hide('sheet-modal'); renderAll();
};

// 컬럼 선택 모달
function openColsModal(localId) {
    const cfg = config.sheets.find(s => s.localId === localId);
    const data = cardData[localId];
    if (!cfg || !data) { alert('먼저 데이터가 로드되어야 합니다.'); return; }
    $('inp-cols-localid').value = localId;
    const hidden = new Set(cfg.hiddenCols || []);
    $('cols-list').innerHTML = data.headers.map(h => `
        <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" value="${esc(h)}" ${hidden.has(h) ? '' : 'checked'} class="w-4 h-4">
            <span>${esc(h || '(빈 헤더)')}</span>
        </label>`).join('');
    show('cols-modal');
}
$('btn-save-cols').onclick = async () => {
    const localId = $('inp-cols-localid').value;
    const cfg = config.sheets.find(s => s.localId === localId);
    if (!cfg) return;
    const checks = [...$('cols-list').querySelectorAll('input[type=checkbox]')];
    cfg.hiddenCols = checks.filter(c => !c.checked).map(c => c.value);
    await saveConfig(); hide('cols-modal');
    // 이 시트의 보기 방식(KPI / 표)을 그대로 유지한 채 다시 그린다.
    // 예전에는 무조건 표로 그려서, 컬럼을 한 번 체크했다 풀면 화면이 바뀌어 보였다.
    const d = cardData[localId];
    if (d) {
        const ix = orderColsFor(cfg, d.headers);
        if (ix) renderKpi(cfg, d, ix); else renderSheetTable(cfg, d);
    }
};

// 모달 공용 닫기
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('.fixed').classList.add('hidden'));
document.querySelectorAll('.fixed').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }));
