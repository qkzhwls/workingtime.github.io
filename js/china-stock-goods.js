// === js/china-stock-goods.js ===
// 중국제작 미발계산기 Ver 8.75 (당일입고지정 목록을 비축창고(FLOOR2)에 들어가는 상품만으로 필터)

import { initializeFirebase } from './config.js?v=7.9';
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteField, collection, getDocs, writeBatch, deleteDoc, onSnapshot, query } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const CHINA_COLLECTION = 'ChinaStockGoods';
const CONFIG_DOC = 'CONFIG';
// [Ver 8.15] 위치 데이터 자동 샤딩: 상품코드 해시로 N개 문서에 분산 (문서당 1MiB 한도 자동 회피)
const NUM_LOC_SHARDS = 8;
function locShardId(code) { let h = 0; const s = String(code || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return 'LOC_SHARD_' + (h % NUM_LOC_SHARDS); }

// 전역 상태
let orderDataOriginal = [];
let orderDataBuy = [];
let stockLogData = {};
let tableData = [];
let filteredData = [];
let editedCells = {};
let inboundMap = {}; 
let sortConfig = { key: '', direction: 'asc' };
let csvUrlOrder = '';
let csvUrlBuy = '';
let savedDates = [];       // 활성(현재 모드)의 출고일 선택
let savedDatesMibal = [];  // [Ver 8.10] 미발계산기 모드 출고일 선택
let savedDatesLoc = [];    // [Ver 8.10] 위치지정모드 출고일 선택 (모드별 분리)
let graceDays = 1; // [Ver 8.6] 본사도착 유예: 본사도착일 + graceDays 까지 목록/표/스캐너에 유지
let newLocPosition = 'back'; // [Ver 8.38] 기존재고: 스캐너가 새로 찍은 위치를 기존값 앞(front)/뒤(back)에 붙일지
let arrivalByShip = {}; // [Ver 8.28] 패킹리스트출고일 → 본사도착일(들) : 기준=출고일, 도착일은 있으면 표시/유예에만 사용
let saveTimeout = null;

// 유틸리티
const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
// [Ver 6.6] 위치 열 선택: known 배열의 '우선순위 순서'대로 찾음 (파일 열 순서 아님).
//   예) 옵션추가항목1을 옵션보다 우선. 못 찾으면 상품코드가 아닌 첫 비어있지 않은 열.
function pickLocationColumn(headers, codeIdx, known) {
    for (const name of known) { const idx = headers.indexOf(name); if (idx >= 0 && idx !== codeIdx) return idx; }
    return headers.findIndex((h, i) => i !== codeIdx && h);
}
const hasValue = (v) => v !== '' && v !== undefined && v !== null && v !== 0 && v !== '0';

function getProductName(row) { return row['상품명'] || row['공급처상품명'] || ''; }
function formatExcelDate(excelDate) {
    if (!excelDate || excelDate.toString().trim() === '') return '';
    if (typeof excelDate === 'string' && (excelDate.includes('-') || excelDate.includes('.'))) return excelDate;
    const num = parseFloat(excelDate);
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function normalizeDate(dateStr) {
    if (!dateStr) return '';
    let s = dateStr.toString().trim();
    if (/^\d{4,5}(\.\d+)?$/.test(s)) s = formatExcelDate(parseFloat(s));
    s = s.replace(/\./g, '-').replace(/\//g, '-');
    const parts = s.split('-');
    if (parts.length === 3) {
        let [y, m, d] = parts;
        if (y.length === 2) y = '20' + y;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return s;
}
// [Ver 8.6] 본사도착 유예: (본사도착일 + graceDays) 가 '오늘' 이후(포함)면 아직 유예 안 지남 → 유지
function withinGrace(arrivalDateStr) {
    if (!arrivalDateStr || arrivalDateStr.length < 10) return false;
    const d = new Date(arrivalDateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    d.setDate(d.getDate() + (parseInt(graceDays) || 0));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return d.getTime() >= today.getTime();
}

function showLoading(text) {
    const el = document.getElementById('loading-text'); if (el) el.innerText = text;
    document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }
function showToast(msg) {
    const t = document.getElementById('toast'); if (!t) return;
    t.innerText = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}
// [Ver 5.2] 파일 저장: 지원 브라우저(크롬/엣지)면 저장 대화상자를 '바탕화면'에서 열어 한 번에 저장,
//   미지원(사파리/모바일)이면 기본 다운로드 폴더로 저장
async function downloadToDesktop(filename, blob) {
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                startIn: 'desktop',
                types: [{ description: 'Excel', accept: { 'application/vnd.ms-excel': ['.xls'] } }]
            });
            const w = await handle.createWritable();
            await w.write(blob); await w.close();
            showToast('✅ 저장 완료');
            return;
        } catch (e) {
            if (e && e.name === 'AbortError') return; // 사용자가 취소
            // 그 외 오류 → 기본 다운로드로 폴백
        }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
let zoneCapacity = {}; // [Ver 5.4] 구역(로케이션 앞 한 글자)별 적재량 일괄값 (Firebase 저장)
// [Ver 6.4] 구역 키: ★ 로케이션(★-001, ★★-001 등)은 별 개수와 무관하게 모두 '★' 구역으로 묶음, 그 외는 첫 글자
function zoneKey(locStr) {
    const s = (locStr || '').toString().trim().toUpperCase();
    if (!s) return '';
    return s.includes('★') ? '★' : s.charAt(0);
}
function getCapacityByLocation(locStr) {
    if (!locStr) return 0;
    const ch = zoneKey(locStr);
    if (zoneCapacity[ch] !== undefined && zoneCapacity[ch] !== '') return parseInt(zoneCapacity[ch]) || 0; // 설정값 우선(★ 포함)
    if (ch === '★') return 90; // ★ 구역 기본값(미설정 시) — 기존 동작 유지
    const map = { 'A':20,'B':20,'C':20,'D':20,'E':40,'F':40,'G':40,'H':15,'I':15,'Z':15,'L':15,'O':15,'P':15,'Q':15,'R':15,'S':15,'T':15 };
    return map[ch] || 0;
}

// ---------------------------------------------------------
// [Ver 4.7] 미발수량 공식 (설정에서 편집 가능, Firebase 저장)
//  - 변수: 총재고, 적재량, 부족수량, 직진배송
//  - 잘못된 수식이면 기본 공식으로 폴백 (앱이 깨지지 않음)
// ---------------------------------------------------------
// [Ver 8.25] 기본공식 = 오더리스트 시트와 동일한 3조건 (헤더명: 총재고=F, 적재량=H, 도착수량=D, 부족수량=J, 직진배송=K)
const DEFAULT_MIBAL_FORMULA = '총재고===0 ? 적재량 : (도착수량+총재고<=적재량 ? 도착수량 : (부족수량+직진배송>총재고 ? 부족수량+직진배송-총재고 : 0))';
let mibalFormula = DEFAULT_MIBAL_FORMULA;
let mibalFn = null;
let mibalVars = []; // [Ver 7.5] 미발 공식에 추가로 쓸 재고로그 헤더(변수)
const MIBAL_FIXED_VARS = ['총재고', '적재량', '부족수량', '직진배송'];
// [Ver 8.17] 재고로그 헤더가 아닌 계산값 변수(오더 데이터에서 산출). 변수추가 목록에 노출하고 eval 시 log에 주입
const MIBAL_COMPUTED_VARS = ['도착수량'];

function defaultMibal(총재고, 적재량, 부족수량, 직진배송) {
    return (총재고 === 0) ? 적재량 : ((부족수량 + 직진배송 > 총재고) ? (부족수량 + 직진배송 - 총재고) : 0);
}
function toNum(v) { if (v == null) return 0; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }

// 수식 문자열을 함수로 컴파일 (실패 시 null). 기본 4변수 + 추가 변수(mibalVars) 지원.
function compileMibalFormula(expr) {
    try {
        const fn = new Function(...MIBAL_FIXED_VARS, ...mibalVars, 'return (' + expr + ');');
        const t = fn(0, 20, 0, 0, ...mibalVars.map(() => 0));
        if (typeof t !== 'number' || isNaN(t)) return null;
        return fn;
    } catch (e) { return null; }
}

// 실제 계산 (오류 시 기본 공식 폴백 + 0 이상 정수). log = 해당 상품 재고로그 행(추가 변수값 조회용)
function evalMibal(총재고, 적재량, 부족수량, 직진배송, log) {
    let v;
    const extras = mibalVars.map(h => toNum((log || {})[h]));
    try { if (mibalFn) v = mibalFn(총재고, 적재량, 부족수량, 직진배송, ...extras); } catch (e) { v = undefined; }
    if (typeof v !== 'number' || isNaN(v)) v = defaultMibal(총재고, 적재량, 부족수량, 직진배송);
    v = Math.round(v);
    return v < 0 ? 0 : v;
}
mibalFn = compileMibalFormula(mibalFormula);

// ---------------------------------------------------------
// UI 제어 함수 (모달 및 메뉴)
// ---------------------------------------------------------
function closeAllMenus() {
    if (typeof closeColumnFilter === 'function') closeColumnFilter(); // [Ver 8.52] 열 필터 팝업도 닫기
    const menu = document.getElementById('main-tools-menu'); if (menu) menu.style.display = 'none';
    const dl = document.getElementById('download-menu'); if (dl) dl.style.display = 'none'; // [Ver 5.9] 다운로드 드롭다운
    const popup = document.getElementById('date-dropdown-popup');
    if (popup && popup.style.display === 'block') {
        popup.style.display = 'none';
        onDatePopupClosed(); // [Ver 3.1] 팝업이 닫히는 시점에 변경된 선택을 한 번만 적용
    }
}

// [Ver 6.2→7.1] 위치 이동 내역(기존재고) — 위치지정모드 '기존재고지정' 서브뷰에 인라인 표시
function lmAtMs(at) { try { if (at == null) return 0; if (typeof at === 'number') return at; return at.toDate ? at.toDate().getTime() : 0; } catch (e) { return 0; } }
function lmFmtAt(at) {
    try {
        const d = (typeof at === 'number') ? new Date(at) : (at && at.toDate ? at.toDate() : null);
        if (!d) return '';
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch (e) { return ''; }
}
// [Ver 7.3] 위치 다중값 표시 — 기준값(base)에 없는 '새로 추가된 자리'는 초록 강조
function locPartsArr(s) { return (s || '').toString().split(',').map(x => x.trim()).filter(Boolean); }
function locHasNew(location, base) { const b = new Set(locPartsArr(base)); return locPartsArr(location).some(p => !b.has(p)); }
function renderLocList(location, base) {
    const b = new Set(locPartsArr(base));
    const parts = locPartsArr(location);
    if (!parts.length) return '';
    return parts.map(p => b.has(p)
        ? `<span style="color:#555;">${p}</span>`
        : `<span style="background:#c8e6c9; color:#1b5e20; font-weight:bold; padding:0 5px; border-radius:3px;">${p}</span>`
    ).join(', ');
}
// [Ver 8.39] 다운로드 시 새 자리(base에 없던)를 맨앞/맨뒤로 재배치 (기존자리 순서는 유지)
function orderLocForDownload(location, base, pos) {
    const b = new Set(locPartsArr(base));
    const parts = locPartsArr(location);
    const baseParts = parts.filter(p => b.has(p));
    const newParts = parts.filter(p => !b.has(p));
    const ordered = (pos === 'front') ? [...newParts, ...baseParts] : [...baseParts, ...newParts];
    return ordered.join(',');
}
// [Ver 8.58] 콤마 다중 위치 병합 (중복 제거, 순서 유지) — 당일입고 다운로드에서 기존 옵션추가항목1 + 새 위치 합칠 때 사용
function mergeCsvLocs(a, b) {
    const seen = new Set(); const out = [];
    [...locPartsArr(a), ...locPartsArr(b)].forEach(p => { if (!seen.has(p)) { seen.add(p); out.push(p); } });
    return out.join(',');
}
// [Ver 8.31] 추가위치: base(기존자리)에 없던 '새로 추가된 자리'만 표시
function renderNewLocOnly(location, base) {
    const b = new Set(locPartsArr(base));
    const news = locPartsArr(location).filter(p => !b.has(p));
    if (!news.length) return '';
    return news.map(p => `<span style="background:#c8e6c9; color:#1b5e20; font-weight:bold; padding:0 5px; border-radius:3px;">${p}</span>`).join(', ');
}
// [Ver 8.12] 기존재고 중 '스캐너로 전송된 상품'(worker=Scanner_Web)만 표시 — 새 자리 없어도 전송 확인 가능
function lmExistingRows() {
    const kw = (document.getElementById('lm-search')?.value || '').trim().toUpperCase();
    let rows = Object.entries(locationAssignMap)
        .map(([code, v]) => ({ code, location: v.location || '', base: v.base || '', sub: v.sub || '', at: v.at, worker: v.worker || '' }))
        .filter(r => r.sub === 'existing' && r.worker === 'Scanner_Web');
    if (kw) rows = rows.filter(r => r.code.toUpperCase().includes(kw) || r.location.toUpperCase().includes(kw));
    rows.sort((a, b) => lmAtMs(b.at) - lmAtMs(a.at));
    return rows;
}
const LM_RENDER_CAP = 300; // [Ver 6.7] 표시 상한(렌더 성능/가독성). 다운로드는 전체 포함.
function renderLocMoveTable() {
    const tb = document.getElementById('lm-tbody'); if (!tb) return;
    const rows = lmExistingRows();
    const cEl = document.getElementById('lm-count'); if (cEl) cEl.textContent = `전송된 상품 ${rows.length}건`;
    const moreEl = document.getElementById('lm-more');
    if (!rows.length) { tb.innerHTML = '<tr><td colspan="4" style="padding:24px; color:#888;">전송된 기존재고가 없습니다.<br><span style="font-size:11px;">(기존재고 업로드 후 스캐너 \'기존재고\' 모드로 위치를 찍어 전송하면 여기 표시됩니다)</span></td></tr>'; if (moreEl) moreEl.textContent = ''; return; }
    const shown = rows.slice(0, LM_RENDER_CAP);
    tb.innerHTML = shown.map(r => {
        const noBase = !r.base; // 시드 파일에 없던 상품(기준 위치 없음)
        const badge = noBase ? '<div style="margin-top:3px;"><span title="업로드 파일에 없던 상품 — 기존 위치를 몰라 스캔한 자리만 반영됩니다. ERP 업로드 시 기존값이 덮어써질 수 있어요." style="background:#fff3e0; color:#e65100; border:1px solid #ffcc80; border-radius:4px; padding:0 4px; font-size:10px; font-weight:bold; white-space:nowrap;">⚠️ 파일에 없던 상품</span></div>' : '';
        return `<tr style="border-bottom:1px solid #eee;${noBase ? ' background:#fffdf5;' : ''}"><td style="padding:7px 6px; font-weight:bold; white-space:nowrap;">${r.code}${badge}</td><td style="padding:7px 6px; text-align:left;">${renderLocList(r.location, r.base)}</td><td style="padding:7px 6px; color:#888; white-space:nowrap;">${lmFmtAt(r.at)}</td><td style="padding:7px 6px; white-space:nowrap;"><span class="lm-edit" data-code="${r.code}" title="수정" style="cursor:pointer; margin-right:10px; font-size:15px;">✏️</span><span class="lm-del" data-code="${r.code}" title="삭제" style="cursor:pointer; font-size:15px;">🗑️</span></td></tr>`;
    }).join('');
    tb.querySelectorAll('.lm-edit').forEach(b => b.onclick = () => startEditLocMoveRow(b.dataset.code, b.closest('tr')));
    tb.querySelectorAll('.lm-del').forEach(b => b.onclick = () => deleteLocMoveRow(b.dataset.code));
    const flagged = rows.filter(r => !r.base).length;
    const notes = [];
    if (flagged) notes.push(`<b style="color:#e65100;">⚠️ 파일에 없던 상품 ${flagged}건 포함</b>`);
    if (rows.length > LM_RENDER_CAP) notes.push(`상위 ${LM_RENDER_CAP}건만 표시 · 전체 ${rows.length}건 (검색으로 좁히기)`);
    if (moreEl) moreEl.innerHTML = notes.join(' · ');
}
// [Ver 7.7] 기존재고 목록 행 삭제 — 해당 상품의 위치기록 제거(목록/다운로드에서 제외)
async function deleteLocMoveRow(code) {
    if (!confirm(`'${code}' 위치 기록을 삭제할까요?\n(이 상품은 목록·다운로드에서 제외됩니다. 되돌릴 수 없습니다)`)) return;
    showLoading('🗑️ 삭제 중...');
    try {
        await updateDoc(doc(db, CHINA_COLLECTION, locShardId(code)), { [`map.${code}`]: deleteField() });
        delete locationAssignMap[code];
        renderLocMoveTable();
        if (filteredData.length > 0) renderTable();
        hideLoading(); showToast('✅ 삭제됨');
    } catch (e) { hideLoading(); alert('삭제 실패: ' + e.message); }
}
// [Ver 7.8] 기존재고 목록 행 인라인 수정 — 위치 칸을 입력창으로 바꿔 편집(Enter 저장 / Esc 취소)
function startEditLocMoveRow(code, tr) {
    const v = locationAssignMap[code]; if (!v || !tr) return;
    const tds = tr.querySelectorAll('td');
    const locTd = tds[1], actTd = tds[3];
    if (!locTd || !actTd) return;
    const cur = (v.location || '').replace(/"/g, '&quot;');
    locTd.innerHTML = `<input type="text" class="lm-edit-input" value="${cur}" placeholder="예: 비축-211,비축-210 (비우면 삭제)" style="width:100%; padding:5px 6px; border:1px solid #7b1fa2; border-radius:4px; font-size:12px; box-sizing:border-box;">`;
    actTd.innerHTML = `<span class="lm-save" title="저장" style="cursor:pointer; margin-right:10px; font-size:15px;">✅</span><span class="lm-cancel" title="취소" style="cursor:pointer; font-size:15px;">✖️</span>`;
    const input = locTd.querySelector('.lm-edit-input');
    input.focus(); input.select();
    const save = () => saveEditLocMoveRow(code, input.value);
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') { renderLocMoveTable(); } };
    actTd.querySelector('.lm-save').onclick = save;
    actTd.querySelector('.lm-cancel').onclick = () => renderLocMoveTable();
}
async function saveEditLocMoveRow(code, raw) {
    const v = locationAssignMap[code]; if (!v) return;
    const norm = (raw || '').split(',').map(x => x.trim()).filter(Boolean).join(','); // 비우면 삭제, base(기준값)는 유지
    showLoading('💾 저장 중...');
    try {
        if (!norm) {
            await updateDoc(doc(db, CHINA_COLLECTION, locShardId(code)), { [`map.${code}`]: deleteField() });
            delete locationAssignMap[code];
        } else {
            await setDoc(doc(db, CHINA_COLLECTION, locShardId(code)), { map: { [code]: { location: norm, at: Date.now() } } }, { merge: true });
            locationAssignMap[code] = { ...v, location: norm };
        }
        renderLocMoveTable();
        if (filteredData.length > 0) renderTable();
        hideLoading(); showToast('✅ 수정됨');
    } catch (e) { hideLoading(); alert('수정 실패: ' + e.message); }
}
// [Ver 8.45] 비축창고 엑셀저장 — 스캐너가 fullauto 방식(스캔 단위 all-or-nothing)으로 누적한 floor2 값을 그대로 사용
async function downloadFloor2() {
    closeAllMenus();
    let map = {};
    try { const s = await getDoc(doc(db, CHINA_COLLECTION, 'FLOOR2_STOCK')); map = (s.exists() && s.data().map) ? s.data().map : {}; }
    catch (e) { alert('비축창고 데이터 불러오기 실패: ' + e.message); return; }
    const rows = [];
    Object.entries(map).forEach(([code, v]) => {
        const spare = parseInt(v && v.floor2) || 0;
        if (spare > 0) rows.push([code, spare]);
    });
    if (!rows.length) { alert('비축창고로 입고된 데이터가 없습니다.\n(입고 스캔 시 미발수량을 넘긴 초과분이 비축창고로 잡힙니다)'); return; }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const aoa = [['상품코드', '작업수량'], ...rows]; // [Ver 8.49] 헤더명 '비축창고재고' → '작업수량'
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '비축창고재고');
    const wbout = XLSX.write(wb, { bookType: 'biff8', type: 'array' });
    await downloadToDesktop('비축창고재고.xls', new Blob([wbout], { type: 'application/vnd.ms-excel' }));
}
// [Ver 6.2] 기존재고 위치값 다운로드 — 헤더 '상품코드', '옵션추가항목1' (입고용/미발확인용과 동일한 진짜 .xls)
async function downloadLocMove() {
    const rows = lmExistingRows().filter(r => r.location);
    if (!rows.length) { alert('새로 추가된 위치가 없습니다.\n(기존재고 업로드 후 스캐너 "기존재고" 모드로 새 자리를 지정하세요)'); return; }
    // [Ver 8.59] '파일에 없던 상품' 판정: 기존값(seed) 없음 OR db(오더리스트)에 없음 — 당일입고와 동일 기준
    const orderCodes = new Set();
    [orderDataOriginal, orderDataBuy].forEach(rr => (rr || []).forEach(x => { const c = (x['어드민상품코드'] || x['상품코드'] || '').toString().trim(); if (c) orderCodes.add(c); }));
    const isMissing = r => !r.base || !orderCodes.has(r.code);
    const flagged = rows.filter(isMissing).length;
    if (flagged && !confirm(`⚠️ 오더리스트 또는 기존값에 없던 상품 ${flagged}건이 포함되어 있습니다.\n이 상품들은 기존 옵션추가항목1 없이 '스캔한 자리만' 내보내질 수 있어, 이지어드민의 기존값을 덮어쓸 수 있습니다.\n\n그래도 전체 다운로드할까요?`)) return;
    // [Ver 8.2] 파일에 없던 상품이 있으면 '비고' 열로 별도 표시 (없으면 기존 2열 그대로)
    const hasFlag = flagged > 0;
    const aoa = [hasFlag ? ['상품코드', '옵션추가항목1', '비고'] : ['상품코드', '옵션추가항목1']];
    rows.forEach(r => {
        const row = [r.code, orderLocForDownload(r.location, r.base, newLocPosition)]; // [Ver 8.39] 새 자리를 맨앞/맨뒤로 재배치
        if (hasFlag) row.push(isMissing(r) ? '파일에 없던 상품' : '');
        aoa.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'worksheet');
    const wbout = XLSX.write(wb, { bookType: 'biff8', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.ms-excel' });
    await downloadToDesktop('기존재고_위치값.xls', blob);
}
// [Ver 6.9] 당일입고 위치값 다운로드 (현재 표의 상품 + 앱 지정 위치 → 헤더 상품코드/옵션추가항목1, 진짜 .xls)
async function downloadDayLoc() {
    if (!filteredData.length) return;
    const todayRows = filteredData.filter(r => { const a = locationAssignMap[r.code]; return a && a.location && (a.sub || '') === 'today'; });
    if (!todayRows.length) { alert('당일 입고분으로 위치가 지정된 상품이 없습니다.\n(스캐너 위치모드 "당일 입고분"으로 지정 후 이용하세요)'); return; }
    // [Ver 8.59] db(오더리스트)에 없던 상품(강제추가분) → '비고'에 '파일에 없던 상품' 표시 (있을 때만 열 추가)
    const flagged = todayRows.filter(r => r.unregisteredLoc).length;
    if (flagged && !confirm(`⚠️ 파일(오더리스트)에 없던 상품 ${flagged}건이 포함되어 있습니다.\n이 상품들은 기존 옵션추가항목1 없이 '스캔한 자리만' 내보내져, 이지어드민의 기존값을 덮어쓸 수 있습니다.\n\n그래도 전체 다운로드할까요?`)) return;
    const hasFlag = flagged > 0;
    const aoa = [hasFlag ? ['상품코드', '옵션추가항목1', '비고'] : ['상품코드', '옵션추가항목1']];
    todayRows.forEach(r => {
        const a = locationAssignMap[r.code];
        // [Ver 8.58] 기존 옵션추가항목1(재고로그 값) + 새로 지정한 위치를 병합 (기존값 유실 방지) — 새 자리는 설정에 따라 앞/뒤 배치
        const existing = (stockLogData[r.code] && stockLogData[r.code]['옵션추가항목1']) || '';
        const full = mergeCsvLocs(existing, a.location);
        const row = [r.code, orderLocForDownload(full, existing, newLocPosition)];
        if (hasFlag) row.push(r.unregisteredLoc ? '파일에 없던 상품' : '');
        aoa.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'worksheet');
    const wbout = XLSX.write(wb, { bookType: 'biff8', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.ms-excel' });
    await downloadToDesktop('위치값.xls', blob);
}
// [Ver 6.3] 기존재고 이동 내역만 초기화 (당일입고 위치확인은 유지 — Firebase 누적 방지)
async function resetLocMove() {
    const cnt = Object.values(locationAssignMap).filter(v => (v.sub || '') === 'existing').length;
    if (!cnt) { alert('초기화할 기존재고 내역이 없습니다.'); return; }
    if (!confirm(`기존재고 위치 이동 내역 ${cnt}건을 삭제할까요?\n(당일입고 위치확인은 유지됩니다. 되돌릴 수 없습니다.)`)) return;
    showLoading('🗑️ 기존재고 내역 삭제 중...');
    try {
        // [Ver 8.15] 샤드별로 sub=existing 제외한 맵으로 교체(샤드당 1회 쓰기)
        const byShard = {};
        for (let i = 0; i < NUM_LOC_SHARDS; i++) byShard['LOC_SHARD_' + i] = {};
        Object.entries(locationAssignMap).forEach(([c, v]) => {
            if ((v.sub || '') !== 'existing') byShard[locShardId(c)][c] = { location: v.location || '', base: v.base || '', sub: v.sub || '', worker: v.worker || '', at: v.at || Date.now() };
        });
        for (const sid in byShard) await setDoc(doc(db, CHINA_COLLECTION, sid), { map: byShard[sid], updatedAt: new Date() });
        Object.keys(locationAssignMap).forEach(k => { if ((locationAssignMap[k].sub || '') === 'existing') delete locationAssignMap[k]; });
        renderLocMoveTable();
        if (filteredData.length > 0) renderTable();
        hideLoading();
        showToast('✅ 기존재고 내역 초기화 완료');
    } catch (e) {
        hideLoading();
        console.error('기존재고 내역 삭제 실패:', e);
        alert('삭제 중 오류가 발생했습니다. 콘솔을 확인하세요.');
    }
}

function openSheetSettingsModal() {
    closeAllMenus();
    document.getElementById('modal-csv-order').value = csvUrlOrder;
    document.getElementById('modal-csv-buy').value = csvUrlBuy;
    document.getElementById('sheet-settings-modal').style.display = 'flex';
}

function closeSheetSettingsModal() {
    document.getElementById('sheet-settings-modal').style.display = 'none';
}

// ---------------------------------------------------------
// [Ver 5.1] 미발수량 규칙 설정 모달 (예시 / 규칙 조립 / 직접 입력 3모드)
// ---------------------------------------------------------
let formulaMode = 'builder';

function openMibalFormulaModal() {
    closeAllMenus();
    renderMibalVars(); // [Ver 7.5] 규칙 변수(재고로그 헤더) 목록/선택지 갱신
    // [Ver 8.21] 저장된 수식을 조립 행으로 펼쳐서 지금 적용된 규칙을 그대로 보여줌(파싱 실패 시 기존 행 유지)
    const parsed = parseRuleFormula(mibalFormula);
    if (parsed && parsed.rows.length) { ruleRows2 = parsed.rows; ruleElse = parsed.elseVal; }
    ruleDraftTokens = []; // [Ver 8.22] 작업대 초기화
    formulaMode = 'builder';
    renderRuleRows();
    document.getElementById('mibal-formula-modal').style.display = 'flex';
}
function closeMibalFormulaModal() {
    document.getElementById('mibal-formula-modal').style.display = 'none';
}

// 공통: 규칙(수식) 검증 → Firebase 저장 → 표 즉시 재계산
async function applyAndSaveFormula(expr, okMsg) {
    if (!expr || !compileMibalFormula(expr)) { alert('규칙이 올바르지 않습니다. 다시 확인해 주세요.'); return; }
    mibalFormula = expr;
    mibalFn = compileMibalFormula(expr);
    try {
        await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { mibalFormula, updatedAt: new Date() }, { merge: true });
        closeMibalFormulaModal();
        showToast(okMsg || '✅ 미발수량 규칙 저장됨');
        if (savedDates.length > 0) applyDates();
    } catch (e) { alert('저장 실패: ' + e.message); }
}

// ===== 미발 규칙 변수(재고로그 헤더) 관리 [Ver 7.5] =====
function isValidVarName(h) { try { new Function(h, 'return 0'); return true; } catch (e) { return false; } }
function sanitizeMibalVars(arr) {
    return Array.isArray(arr) ? arr.filter(h => typeof h === 'string' && h && isValidVarName(h) && !MIBAL_FIXED_VARS.includes(h)) : [];
}
function renderMibalVars() {
    const list = document.getElementById('mibal-vars-list');
    if (list) {
        list.innerHTML = mibalVars.length
            ? mibalVars.map(h => `<span style="display:inline-flex; align-items:center; gap:5px; background:#7b1fa2; color:#fff; padding:3px 9px; border-radius:12px; font-size:12px; font-weight:bold;">${h}<span class="mibal-var-del" data-h="${h}" style="cursor:pointer; font-weight:900;">✕</span></span>`).join('')
            : '<span style="font-size:11px; color:#999;">추가된 변수 없음</span>';
        list.querySelectorAll('.mibal-var-del').forEach(x => x.onclick = () => removeMibalVar(x.dataset.h));
    }
    const sel = document.getElementById('mibal-var-select');
    if (sel) {
        const exclude = ['상품코드', '상품명', '옵션', ...MIBAL_FIXED_VARS, ...mibalVars];
        // [Ver 8.17] 계산값 변수(도착수량 등)를 목록 맨 앞에 노출 + 재고로그 헤더
        const computedAvail = MIBAL_COMPUTED_VARS.filter(f => !mibalVars.includes(f));
        const avail = [...computedAvail, ...logFieldKeys().filter(f => !exclude.includes(f) && isValidVarName(f))];
        sel.innerHTML = avail.length
            ? '<option value="">헤더 선택…</option>' + avail.map(f => `<option value="${f}">${f}</option>`).join('')
            : '<option value="">추가 가능한 헤더 없음 (미발재고로그 업로드 필요)</option>';
    }
}
function addMibalVar() {
    const sel = document.getElementById('mibal-var-select');
    const h = sel && sel.value;
    if (!h) return;
    if (mibalVars.includes(h) || MIBAL_FIXED_VARS.includes(h)) { alert('이미 있는 변수이거나 기본 변수와 이름이 같습니다: ' + h); return; }
    if (!isValidVarName(h)) { alert('변수로 쓸 수 없는 헤더입니다(공백/특수문자/숫자로 시작 등): ' + h); return; }
    mibalVars.push(h);
    renderMibalVars();
    saveMibalVars();
}
function removeMibalVar(h) {
    if (mibalFormula.includes(h) && !confirm(`'${h}' 변수가 현재 규칙에 쓰이는 것 같습니다.\n삭제하면 규칙이 기본 계산으로 돌아갈 수 있습니다. 계속할까요?`)) return;
    mibalVars = mibalVars.filter(v => v !== h);
    renderMibalVars();
    saveMibalVars();
}
async function saveMibalVars() {
    mibalFn = compileMibalFormula(mibalFormula); // 변수 목록 변경 → 재컴파일(인자 수 반영)
    try { await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { mibalVars, updatedAt: new Date() }, { merge: true }); } catch (e) { }
    if (formulaMode === 'builder') renderRuleRows(); // 조립모드 드롭다운 갱신
    if (savedDates.length > 0) applyDates();
}
// [Ver 8.19] 규칙 조립을 자유 입력으로 — 좌변/우변/결과값에 식을 직접 쓸 수 있고, 아래 값들은 자동완성 제안으로 제공
function ruleExprSuggestions() {
    const vars = [...RULE_VARS, ...mibalVars];                        // 기본 4변수 + 추가한 변수(도착수량 등)
    const compounds = ['적재량-총재고', '부족수량+직진배송-총재고', '적재량-부족수량', 'Math.max(적재량-총재고,0)', 'Math.max(부족수량+직진배송-총재고,0)'];
    return [...new Set(['0', ...vars, ...compounds])];
}

// ===== ① 예시 모드 =====
let exampleRows = [
    { s:0, c:20, sh:0, d:0, want:'' },
    { s:5, c:20, sh:0, d:0, want:'' },
    { s:10, c:20, sh:8, d:5, want:'' }
];
function buildExampleRows() {
    const tb = document.getElementById('ex-tbody');
    if (!tb) return;
    const cell = (i,k,v) => `<td><input type="number" class="exi" data-i="${i}" data-k="${k}" value="${v}" style="width:46px; padding:3px;"></td>`;
    tb.innerHTML = exampleRows.map((r,i) => `<tr>
        ${cell(i,'s',r.s)}${cell(i,'c',r.c)}${cell(i,'sh',r.sh)}${cell(i,'d',r.d)}
        <td><input type="number" class="exi" data-i="${i}" data-k="want" value="${r.want}" placeholder="?" style="width:56px; padding:3px; background:#fff3e0; font-weight:bold;"></td>
        <td id="ex-cur-${i}" style="color:#888; font-weight:bold;">-</td>
        <td><button class="exdel" data-i="${i}" style="border:none; background:none; color:#d32f2f; cursor:pointer; font-size:14px;">✕</button></td>
    </tr>`).join('');
    tb.querySelectorAll('input.exi').forEach(inp => inp.oninput = () => {
        const i = +inp.dataset.i, k = inp.dataset.k;
        exampleRows[i][k] = (k === 'want') ? inp.value : (parseInt(inp.value) || 0);
        if (k !== 'want') updateExampleCurrent();
    });
    tb.querySelectorAll('button.exdel').forEach(b => b.onclick = () => { exampleRows.splice(+b.dataset.i, 1); buildExampleRows(); });
    updateExampleCurrent();
}
function updateExampleCurrent() {
    // '지금 결과' = 현재 저장된 규칙(mibalFn)이 내는 값
    exampleRows.forEach((r,i) => {
        const td = document.getElementById('ex-cur-' + i);
        if (td) td.textContent = evalMibal(r.s, r.c, r.sh, r.d, {});
    });
}
function copyExamples() {
    const lines = exampleRows.map(r => `총재고 ${r.s}, 적재량 ${r.c}, 부족 ${r.sh}, 직진 ${r.d} → 미발수량 ${r.want || '?'}`);
    const text = '[미발수량 예시]\n' + lines.join('\n');
    navigator.clipboard.writeText(text).then(() => showToast('📋 예시 복사됨 (Claude에게 붙여넣으세요)'), () => showToast('복사 실패'));
}
// 예시 → 수식 자동 생성 후 바로 적용
const MIBAL_SUBEXPRS = [
    '0', '적재량', '총재고', '부족수량', '직진배송',
    '부족수량+직진배송', '적재량+부족수량', '적재량+직진배송',
    '적재량-총재고', '부족수량-총재고', '직진배송-총재고', '부족수량+직진배송-총재고',
    'Math.max(적재량-총재고,0)', 'Math.max(부족수량+직진배송-총재고,0)', 'Math.max(부족수량-총재고,0)', 'Math.max(적재량-부족수량,0)'
];
function matchExprAll(expr, pts) {
    const fn = compileMibalFormula(expr);
    if (!fn) return false;
    return pts.every(p => { let v = Math.round(fn(p.s, p.c, p.sh, p.d)); if (v < 0) v = 0; return v === p.y; });
}
function synthMibalFormula(pts) {
    for (const e of MIBAL_SUBEXPRS) if (matchExprAll(e, pts)) return e;
    const g0 = pts.filter(p => p.s === 0), g1 = pts.filter(p => p.s !== 0);
    if (g0.length && g1.length) {
        let A = null, B = null;
        for (const e of MIBAL_SUBEXPRS) if (matchExprAll(e, g0)) { A = e; break; }
        for (const e of MIBAL_SUBEXPRS) if (matchExprAll(e, g1)) { B = e; break; }
        if (A && B) { const f = `총재고===0 ? (${A}) : (${B})`; if (matchExprAll(f, pts)) return f; }
    }
    return null;
}
function applyFromExamples() {
    const pts = exampleRows
        .filter(r => r.want !== '' && r.want !== null && r.want !== undefined && !isNaN(parseInt(r.want)))
        .map(r => ({ s: r.s, c: r.c, sh: r.sh, d: r.d, y: parseInt(r.want) }));
    if (pts.length < 1) { alert('먼저 [원하는 미발수량] 칸을 채워주세요.'); return; }
    const f = synthMibalFormula(pts);
    if (!f) {
        alert('입력한 예시만으로는 규칙을 자동으로 만들지 못했어요.\n\n· 상황이 다른 예시를 더 넣어보세요 (재고 0일 때 / 있을 때 등)\n· 그래도 안 되면 [📋 예시 복사] 후 Claude에게 요청하세요.');
        return;
    }
    const coversBoth = pts.some(p => p.s === 0) && pts.some(p => p.s !== 0);
    applyAndSaveFormula(f, '✨ 예시로 규칙 적용됨' + (coversBoth ? '' : ' (일부 상황 예시 부족)'));
}

// ===== ② 규칙 조립 모드 =====
const RULE_VARS = ['총재고','적재량','부족수량','직진배송']; // [Ver 8.18] 좌측 변수는 기본 4개만 (부족수량+직진배송 합성 제거)
const RULE_OPS = [['=','==='],['≠','!=='],['>','>'],['≥','>='],['<','<'],['≤','<=']];
let ruleRows2 = [
    { L:'총재고', op:'===', R:'0', result:'적재량' },
    { L:'부족수량', op:'>', R:'총재고', result:'부족수량+직진배송-총재고' } // [Ver 8.18] 좌측 변수 기본 4개 정책에 맞춰 단일변수 사용
];
let ruleElse = '0';
function ruleSelect(cls, i, options, selected) {
    const opts = options.map(o => {
        const label = Array.isArray(o) ? o[0] : o, val = Array.isArray(o) ? o[1] : o;
        return `<option value="${val}" ${val === selected ? 'selected' : ''}>${label}</option>`;
    }).join('');
    return `<select class="${cls}" data-i="${i}" style="padding:5px; border:1px solid #ccc; border-radius:4px; font-size:12px;">${opts}</select>`;
}
// [Ver 8.19] 자유 입력 필드(자동완성 제안 datalist 연결). 변수/식을 직접 타이핑 가능
function ruleEscAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function ruleField(cls, i, value) {
    return `<input class="rule-fld ${cls}" data-i="${i}" list="rule-expr-list" value="${ruleEscAttr(value)}" spellcheck="false" placeholder="값/식" style="width:132px; padding:5px; border:1px solid #ccc; border-radius:4px; font-size:12px; font-family:monospace;">`;
}
// [Ver 8.20] 변수 드래그&드롭 / 클릭 삽입 대상이 되는 마지막 포커스 필드
let lastRuleField = null;
let ruleFocusDelegated = false;
function ensureRuleFocusDelegate() {
    if (ruleFocusDelegated) return;
    document.addEventListener('focusin', (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains('rule-fld')) lastRuleField = t;
    });
    ruleFocusDelegated = true;
}
function insertRuleToken(token, target) {
    const el = target || lastRuleField;
    if (!el || !document.body.contains(el)) { showToast('먼저 넣을 칸을 클릭하세요'); return; }
    const s = (typeof el.selectionStart === 'number') ? el.selectionStart : el.value.length;
    const e = (typeof el.selectionEnd === 'number') ? el.selectionEnd : el.value.length;
    el.value = el.value.slice(0, s) + token + el.value.slice(e);
    const pos = s + token.length;
    el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) {}
    lastRuleField = el;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}
function backspaceRuleField() {
    const el = lastRuleField;
    if (!el || !document.body.contains(el)) { showToast('먼저 넣을 칸을 클릭하세요'); return; }
    let s = (typeof el.selectionStart === 'number') ? el.selectionStart : el.value.length;
    let e = (typeof el.selectionEnd === 'number') ? el.selectionEnd : el.value.length;
    if (s === e && s > 0) s = s - 1;           // 선택 없으면 커서 앞 한 글자 삭제
    el.value = el.value.slice(0, s) + el.value.slice(e);
    el.focus(); try { el.setSelectionRange(s, s); } catch (_) {}
    lastRuleField = el;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}
// ===== [Ver 8.22] 드롭존 작업대: 토큰을 순서대로 쌓아 하나의 조건을 만든 뒤 위에 추가 =====
let ruleDraftTokens = []; // 예: ['도착수량','+','총재고','<=','적재량','→','도착수량']
const RULE_TOKEN_LABEL = { '===':'=', '!==':'≠', '>=':'≥', '<=':'≤', '>':'>', '<':'<', '*':'×', '/':'÷', '→':'→ =' };
function ruleTokLabel(t) { return RULE_TOKEN_LABEL[t] || t; }
// [Ver 8.20→8.22] 변수/사칙연산/비교·결과 팔레트 렌더 — 드롭존으로 끌어다 놓거나 클릭하면 작업대에 쌓임
function renderRulePalette() {
    const box = document.getElementById('rule-palette');
    if (!box) return;
    const chip = (tok, label, bg, fg, bd) =>
        `<span class="rule-tok" draggable="true" data-token="${ruleEscAttr(tok)}" title="드롭존으로 끌어다 놓거나 클릭" style="cursor:grab; user-select:none; background:${bg}; color:${fg}; border:1px solid ${bd}; padding:4px 10px; border-radius:12px; font-size:12px; font-weight:bold;">${label}</span>`;
    const vars = [...RULE_VARS, ...mibalVars].map(v => chip(v, v, '#ede7f6', '#4527a0', '#b39ddb')).join('');
    // [Ver 8.24] 숫자는 0~9 키패드로 입력(여러 자리 가능)
    const numBtn = `<span id="rule-numpad-open" title="숫자 키패드 열기" style="cursor:pointer; user-select:none; background:#eceff1; color:#37474f; border:1px solid #b0bec5; padding:4px 12px; border-radius:12px; font-size:12px; font-weight:bold;">🔢 숫자 입력</span>`;
    const arith = [['+','+'],['-','−'],['*','×'],['/','÷'],['(','('],[')',')']].map(([t,l]) => chip(t, l, '#fff3e0', '#e65100', '#ffcc80')).join('');
    const cmp = [['===','='],['!==','≠'],['>','&gt;'],['>=','≥'],['<','&lt;'],['<=','≤']].map(([t,l]) => chip(t, l, '#e3f2fd', '#0d47a1', '#90caf9')).join('');
    const sep = chip('→', '→ 결과(미발수량 =)', '#e8f5e9', '#1b5e20', '#a5d6a7');
    box.innerHTML =
        `<div style="font-size:11px; color:#777; margin-bottom:6px;">🧩 아래를 <b>드롭존으로 끌어다 놓거나 클릭</b>하면 순서대로 식이 쌓입니다</div>
         <div style="margin-bottom:5px;"><span style="font-size:10px; color:#999;">변수 · 숫자</span><div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:2px;">${vars} ${numBtn}</div></div>
         <div style="margin-bottom:5px;"><span style="font-size:10px; color:#999;">사칙연산 · 괄호</span><div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:2px;">${arith}</div></div>
         <div><span style="font-size:10px; color:#999;">비교(부등호) · 결과구분</span><div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:2px;">${cmp} ${sep}</div></div>`;
    box.querySelectorAll('.rule-tok').forEach(el => {
        el.addEventListener('click', () => addDraftToken(el.dataset.token));
        el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.dataset.token); e.dataTransfer.effectAllowed = 'copy'; });
    });
    const npOpen = document.getElementById('rule-numpad-open');
    if (npOpen) npOpen.addEventListener('click', openRuleNumpad);
}
// [Ver 8.24] 숫자 키패드 팝업 (0~9, 여러 자리 입력 후 작업대에 한 토큰으로 추가)
let numpadValue = '';
function openRuleNumpad() {
    numpadValue = '';
    let pad = document.getElementById('rule-numpad');
    if (!pad) {
        pad = document.createElement('div');
        pad.id = 'rule-numpad';
        pad.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:10050; display:flex; justify-content:center; align-items:center;';
        document.body.appendChild(pad);
    }
    pad.style.display = 'flex';
    renderRuleNumpad();
}
function closeRuleNumpad() { const p = document.getElementById('rule-numpad'); if (p) p.style.display = 'none'; }
function renderRuleNumpad() {
    const pad = document.getElementById('rule-numpad');
    if (!pad) return;
    const keys = ['1','2','3','4','5','6','7','8','9','⌫','0','확인'];
    pad.innerHTML =
        `<div id="numpad-card" style="background:#fff; border-radius:14px; padding:18px; width:250px; box-shadow:0 10px 34px rgba(0,0,0,.3);">
            <div style="font-size:12px; color:#666; font-weight:bold; margin-bottom:6px;">숫자 입력 후 [확인]</div>
            <div style="border:2px solid #1976d2; border-radius:8px; padding:10px 12px; font-size:28px; font-weight:900; text-align:right; min-height:32px; margin-bottom:12px;">${numpadValue || '0'}</div>
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:7px;">
              ${keys.map(k => `<button type="button" class="np-key" data-k="${k}" style="height:50px; font-size:20px; font-weight:800; border:1px solid #ddd; border-radius:9px; background:${k === '확인' ? '#1976d2' : (k === '⌫' ? '#fff3e0' : '#fafafa')}; color:${k === '확인' ? '#fff' : '#333'}; cursor:pointer;">${k}</button>`).join('')}
            </div>
            <button type="button" id="numpad-cancel" style="width:100%; margin-top:9px; height:42px; border:1px solid #ccc; border-radius:9px; background:#fff; color:#555; cursor:pointer; font-weight:bold;">취소</button>
         </div>`;
    pad.onclick = closeRuleNumpad;
    document.getElementById('numpad-card').onclick = e => e.stopPropagation();
    pad.querySelectorAll('.np-key').forEach(b => b.onclick = () => numpadKey(b.dataset.k));
    document.getElementById('numpad-cancel').onclick = closeRuleNumpad;
}
function numpadKey(k) {
    if (k === '⌫') { numpadValue = numpadValue.slice(0, -1); renderRuleNumpad(); return; }
    if (k === '확인') { addDraftToken(numpadValue || '0'); closeRuleNumpad(); return; }
    numpadValue = (numpadValue === '0') ? k : (numpadValue + k); // 앞자리 0 방지
    if (numpadValue.length > 9) numpadValue = numpadValue.slice(0, 9);
    renderRuleNumpad();
}
function addDraftToken(tok) { if (!tok) return; ruleDraftTokens.push(tok); renderRuleDraft(); }
function ruleDraftSplit() {
    const sep = ruleDraftTokens.indexOf('→');
    if (sep === -1) return { cond: ruleDraftTokens.slice(), res: [] };
    return { cond: ruleDraftTokens.slice(0, sep), res: ruleDraftTokens.slice(sep + 1) };
}
// [Ver 8.24] 파란 작업대 패널 = 내가 만든 규칙 목록 + 그 외 + 지금 조립 중 + 버튼 (한 곳에 통합, 가시성 강화)
function renderRuleDraft() {
    const zone = document.getElementById('rule-add-zone');
    if (!zone) return;
    // (A) 내가 만든 규칙 목록
    const condLines = ruleRows2.map((r, i) => `
      <div style="display:flex; align-items:center; gap:8px; background:#fff; border:1px solid #dfe6ee; padding:9px 10px; border-radius:8px; margin-bottom:6px; font-size:13px;">
        <span style="background:#1976d2; color:#fff; border-radius:11px; padding:2px 9px; font-size:11px; font-weight:bold; flex:none;">${i + 1}</span>
        <span style="flex:1; line-height:1.55; text-align:left;"><b>만약</b> <span style="color:#4527a0; font-weight:bold;">${ruleEscAttr(r.L)} ${ruleTokLabel(r.op)} ${ruleEscAttr(r.R)}</span> <b>이면 → 미발수량 =</b> <span style="color:#e65100; font-weight:bold;">${ruleEscAttr(r.result)}</span></span>
        <button class="rl-del" data-i="${i}" title="이 조건 삭제" style="border:none; background:none; color:#d32f2f; cursor:pointer; font-size:17px; flex:none;">✕</button>
      </div>`).join('');
    const emptyMsg = ruleRows2.length ? '' : '<div style="color:#90a4ae; font-size:12px; padding:6px 2px; text-align:left;">아직 만든 조건이 없어요. 아래에서 식을 만들어 <b>[조건 넣기]</b> 하세요.</div>';
    const elseLine = `
      <div style="display:flex; align-items:center; gap:8px; background:#eceff1; padding:9px 10px; border-radius:8px; font-size:13px; text-align:left;">
        <span style="color:#546e7a; font-weight:bold; flex:none;">그 외</span><span style="flex:1;">위 조건에 다 안 맞으면 <b>→ 미발수량 =</b> <b style="color:#333;">${ruleEscAttr(ruleElse)}</b></span>
      </div>`;
    // (B) 지금 조립 중
    const { cond, res } = ruleDraftSplit();
    const condStr = cond.map(ruleTokLabel).join(' ');
    const resStr = res.map(ruleTokLabel).join(' ');
    const draftBody = ruleDraftTokens.length === 0
        ? '<span style="color:#9aa7b4; font-weight:normal;">여기(또는 위 팔레트)에서 <b>변수·부등호·숫자</b>를 끌어다 놓거나 클릭하세요.<br>예) 총재고 <b>=</b> 0 <b>→결과</b> 적재량</span>'
        : `<b>만약</b> <span style="color:#4527a0;">${condStr || '…'}</span> <b>이면 → 미발수량 =</b> <span style="color:#e65100;">${resStr || '…'}</span>`;
    zone.innerHTML =
        `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
            <span style="font-weight:bold; font-size:12px; color:#37474f;">🧾 내가 만든 규칙 <span style="color:#90a4ae; font-weight:normal;">(위에서부터 순서대로 적용)</span></span>
            <button type="button" id="load-default-rule" title="기본공식(시트 3조건) 내용 보기 · 불러오기" style="padding:5px 10px; background:#eef4ff; color:#1565c0; border:1px solid #90caf9; border-radius:6px; cursor:pointer; font-size:11px; font-weight:bold; white-space:nowrap;">📋 기본공식 보기·불러오기</button>
         </div>
         ${condLines}${emptyMsg}${elseLine}
         <div style="border-top:2px dashed #90caf9; margin:12px 0 10px;"></div>
         <div style="font-weight:bold; font-size:12px; color:#1565c0; margin-bottom:6px; text-align:left;">🛠 지금 조립 중 <span style="color:#90a4ae; font-weight:normal;">(팔레트를 끌어다 놓거나 클릭)</span></div>
         <div style="background:#fffdf3; border:1px solid #ffe082; border-radius:8px; padding:13px; font-size:15px; font-weight:bold; line-height:1.7; min-height:28px; text-align:left;">${draftBody}</div>
         <div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap; margin-top:10px;">
            <button type="button" id="draft-commit" style="padding:9px 18px; background:#1976d2; color:#fff; border:none; border-radius:7px; font-weight:bold; cursor:pointer; font-size:14px;">✔ 조건 넣기</button>
            <button type="button" id="draft-else" style="padding:9px 12px; background:#fff; color:#455a64; border:1px solid #90a4ae; border-radius:7px; cursor:pointer; font-size:13px; font-weight:bold;">그 외(기본값)으로</button>
            <button type="button" id="draft-back" style="padding:9px 12px; background:#fff; color:#555; border:1px solid #bbb; border-radius:7px; cursor:pointer; font-size:13px;">⌫ 마지막 빼기</button>
            <button type="button" id="draft-clear" style="padding:9px 12px; background:#fff; color:#c62828; border:1px solid #ef9a9a; border-radius:7px; cursor:pointer; font-size:13px;">✕ 비우기</button>
         </div>`;
    zone.querySelectorAll('.rl-del').forEach(b => b.onclick = () => { ruleRows2.splice(+b.dataset.i, 1); renderRuleRows(); });
    const ld = document.getElementById('load-default-rule');
    if (ld) ld.onclick = loadDefaultRuleFormula;
    document.getElementById('draft-commit').onclick = commitRuleDraft;
    document.getElementById('draft-else').onclick = setRuleDraftAsElse;
    document.getElementById('draft-back').onclick = () => { ruleDraftTokens.pop(); renderRuleDraft(); };
    document.getElementById('draft-clear').onclick = () => { ruleDraftTokens = []; renderRuleDraft(); };
}
// [Ver 8.23] 작업대의 식을 '그 외(기본값)' 값으로 설정 (비교기호 없이 값/식만)
function setRuleDraftAsElse() {
    const { cond, res } = ruleDraftSplit();
    const expr = (res.length ? res : cond).join(' ').trim();
    if (!expr) { showToast('그 외 값으로 쓸 변수/숫자를 먼저 끌어다 놓으세요'); return; }
    ruleElse = expr;
    ruleDraftTokens = [];
    renderRuleRows();
    showToast('그 외(기본값) = ' + expr);
}
// [Ver 8.26] 기본공식(사진 시트 3조건)을 내용까지 보여주고, 확인하면 조립 목록으로 불러오기
function loadDefaultRuleFormula() {
    const parsed = parseRuleFormula(DEFAULT_MIBAL_FORMULA);
    const rows = (parsed && parsed.rows) ? parsed.rows : [];
    const elseVal = (parsed && parsed.elseVal) ? parsed.elseVal : '0';
    const lines = rows.map((r, i) => `${i + 1}) 만약 ${r.L} ${ruleTokLabel(r.op)} ${r.R}  →  미발수량 = ${r.result}`);
    const msg = '📋 기본공식 = 오더리스트 시트 E열 수식과 동일\n\n'
        + '[시트 원본]\n=IFERROR(MAX(IFS(F4=0,H4, D4+F4<=H4,D4, J4+K4>F4,J4+K4-F4)),0)\n'
        + '(F=총재고 · H=적재량 · D=도착수량 · J=부족수량 · K=직진배송)\n\n'
        + '[헤더명으로 풀면]\n'
        + lines.join('\n')
        + `\n그 외 → 미발수량 = ${elseVal}\n\n`
        + (ruleRows2.length ? '이 기본공식을 불러올까요? (지금 만든 조건은 사라집니다)' : '이 기본공식을 불러올까요?');
    if (!confirm(msg)) return;
    if (rows.length) { ruleRows2 = rows; ruleElse = elseVal; }
    ruleDraftTokens = [];
    renderRuleRows();
    showToast('기본공식을 불러왔어요. 아래 [✔ 이 규칙 적용]을 눌러 저장하세요.');
}
function commitRuleDraft() {
    const { cond, res } = ruleDraftSplit();
    if (!cond.length) { showToast('먼저 변수·부등호를 끌어다 놓아 조건을 만드세요'); return; }
    const pc = parseRuleCondition(cond.join(' '));
    if (!pc) { showToast('비교기호(= ≠ > ≥ < ≤)를 넣어 "값 비교 값" 형태로 만드세요'); return; }
    ruleRows2.push({ L: pc.L, op: pc.op, R: pc.R, result: res.join(' ') || '0' });
    ruleDraftTokens = [];
    renderRuleRows();
}
// [Ver 8.24] 조건 목록은 파란 작업대 패널 안에서 렌더 → 별도 빨간 블록(#rule-rows) 제거
function renderRuleRows() {
    const box = document.getElementById('rule-rows');
    if (box) box.innerHTML = '';
    renderRulePalette(); // 변수/숫자/사칙연산/비교 팔레트
    renderRuleDraft();   // 파란 작업대(규칙 목록 + 그외 + 조립중 + 버튼)
    updateRuleCheck();
}
function buildRuleFormula() {
    let expr = `(${ruleElse})`;
    for (let i = ruleRows2.length - 1; i >= 0; i--) {
        const r = ruleRows2[i];
        expr = `(${r.L} ${r.op} ${r.R}) ? (${r.result}) : ${expr}`;
    }
    return expr;
}
// [Ver 8.21] 저장된 수식(중첩 삼항)을 조립 행으로 역파싱 — 직접입력 탭 없이도 조립 화면이 실제 규칙을 그대로 보여줌
function topLevelCharIndex(s, target, from) {
    let depth = 0;
    for (let i = (from || 0); i < s.length; i++) {
        const ch = s[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (depth === 0 && ch === target) return i;
    }
    return -1;
}
function stripRuleParens(x) {
    x = (x || '').trim();
    while (x.length >= 2 && x[0] === '(') {
        let depth = 0, matchEnd = -1;
        for (let i = 0; i < x.length; i++) {
            if (x[i] === '(') depth++;
            else if (x[i] === ')') { depth--; if (depth === 0) { matchEnd = i; break; } }
        }
        if (matchEnd === x.length - 1) x = x.slice(1, -1).trim();
        else break;
    }
    return x;
}
function parseRuleCondition(cond) {
    cond = stripRuleParens(cond);
    const ops = ['===', '!==', '>=', '<=', '>', '<']; // 긴 연산자 먼저
    let depth = 0;
    for (let i = 0; i < cond.length; i++) {
        const ch = cond[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (depth === 0) {
            for (const op of ops) {
                if (cond.startsWith(op, i)) {
                    const L = cond.slice(0, i).trim(), R = cond.slice(i + op.length).trim();
                    if (L && R) return { L, op, R };
                    return null;
                }
            }
        }
    }
    return null;
}
function parseRuleFormula(expr) {
    try {
        const rows = [];
        let s = (expr || '').trim();
        for (let g = 0; g < 64; g++) {
            s = stripRuleParens(s);
            const q = topLevelCharIndex(s, '?', 0);
            if (q === -1) return { rows, elseVal: stripRuleParens(s) || '0' };
            const c = topLevelCharIndex(s, ':', q + 1);
            if (c === -1) return null;
            const pc = parseRuleCondition(s.slice(0, q));
            if (!pc) return null;
            rows.push({ L: pc.L, op: pc.op, R: pc.R, result: stripRuleParens(s.slice(q + 1, c)) });
            s = s.slice(c + 1).trim();
        }
        return null;
    } catch (e) { return null; }
}
// [Ver 8.9] 완성된 예시: 임의 값을 자동으로 넣어 내가 만든 규칙의 결과를 보여줌
function updateRuleCheck() {
    const el = document.getElementById('rule-examples'); if (!el) return;
    const fn = compileMibalFormula(buildRuleFormula());
    if (!fn) { el.innerHTML = '<span style="color:#d32f2f;">⚠️ 규칙이 아직 올바르지 않습니다.</span>'; return; }
    // 임의 예시 시나리오 [총재고, 적재량, 부족수량, 직진배송] + 추가변수는 시나리오별 임의값
    const base = [[0, 20, 0, 0], [10, 20, 8, 5], [30, 20, 0, 0], [50, 40, 12, 3]];
    const extraVals = [0, 10, 5, 20];
    const lines = base.map((b, i) => {
        const extras = mibalVars.map(() => extraVals[i % extraVals.length]);
        let out; try { out = Math.round(fn(...b, ...extras)); } catch (e) { out = NaN; }
        if (isNaN(out)) out = 0; if (out < 0) out = 0;
        const parts = [`총재고 ${b[0]}`, `적재량 ${b[1]}`, `부족수량 ${b[2]}`, `직진배송 ${b[3]}`, ...mibalVars.map((v, j) => `${v} ${extras[j]}`)];
        return `${parts.join(' · ')} <b style="color:#e65100;">→ 미발수량 ${out}</b>`;
    });
    el.innerHTML = lines.join('<br>');
}
function applyFromBuilder() { applyAndSaveFormula(buildRuleFormula(), '✔ 규칙 적용됨'); }

// ---------------------------------------------------------
// [Ver 8.4] 출고일 유예 일수 설정 (실입고 표시돼도 출고일+N일까지 목록/표/스캐너 유지)
async function openGraceSetting() {
    closeAllMenus();
    const v = prompt('본사도착 유예 일수\n\n"본사도착일 + 이 일수" 까지는 목록·표·스캐너(입고앱)에\n그대로 남겨서 입고작업을 할 수 있게 합니다.\n\n예) 1 = 본사도착 다음날까지 유지 / 3 = 3일까지 유지', String(graceDays));
    if (v === null) return;
    const n = parseInt(v);
    if (isNaN(n) || n < 0) { alert('0 이상의 숫자를 입력하세요.'); return; }
    graceDays = n;
    try { await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { graceDays, updatedAt: new Date() }, { merge: true }); } catch (e) {}
    extractShipDates();                       // 본사도착일 목록 갱신
    if (savedDates.length > 0) applyDates();  // 표/스캐너 재계산
    showToast(`✅ 본사도착 유예 ${n}일 저장됨`);
}

// [Ver 5.4] 적재량 구역별 일괄 설정 모달
// ---------------------------------------------------------
function openZoneCapModal() {
    closeAllMenus();
    buildZoneCapRows();
    document.getElementById('zone-cap-modal').style.display = 'flex';
}
function closeZoneCapModal() { document.getElementById('zone-cap-modal').style.display = 'none'; }
function buildZoneCapRows() {
    const tb = document.getElementById('zone-cap-tbody');
    if (!tb) return;
    const counts = {};
    tableData.forEach(d => { const ch = zoneKey(d.location); if (ch) counts[ch] = (counts[ch] || 0) + 1; });
    const zones = new Set(Object.keys(counts));
    Object.keys(zoneCapacity).forEach(z => zones.add(z));
    const list = [...zones].sort();
    if (!list.length) {
        tb.innerHTML = '<tr><td colspan="3" style="padding:20px; color:#888;">표시할 구역이 없습니다.<br>출고일 선택 + 재고로그 업로드 후 이용하세요.</td></tr>';
        return;
    }
    tb.innerHTML = list.map(z => `<tr>
        <td style="font-weight:800; font-size:15px;">${z === '★' ? '★ <span style="font-size:11px; font-weight:400; color:#888;">(별표 구역, ★·★★ 포함)</span>' : z}</td>
        <td style="color:#888;">${counts[z] || 0}</td>
        <td><input type="number" class="zcap" data-z="${z}" value="${getCapacityByLocation(z)}" style="width:74px; padding:6px; text-align:center;"></td>
    </tr>`).join('');
}
async function saveZoneCap() {
    document.querySelectorAll('.zcap').forEach(inp => {
        const z = inp.dataset.z, v = inp.value.trim();
        if (v === '') delete zoneCapacity[z];
        else zoneCapacity[z] = parseInt(v) || 0;
    });
    try {
        await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { zoneCapacity, updatedAt: new Date() }, { merge: true });
        closeZoneCapModal();
        showToast('✅ 구역별 적재량 저장됨');
        if (savedDates.length > 0) applyDates(); // 표 재계산
    } catch (e) { alert('저장 실패: ' + e.message); }
}

async function saveSheetSettings() {
    csvUrlOrder = document.getElementById('modal-csv-order').value.trim();
    csvUrlBuy = document.getElementById('modal-csv-buy').value.trim();
    await saveConfig();
    closeSheetSettingsModal();
    showToast('✅ CSV 링크 저장 완료');
    syncOrderData();
}

// ---------------------------------------------------------
// 데이터 통신 로직 (Firebase & CSV)
// ---------------------------------------------------------
function loadInboundHistory() {
    const q = query(collection(db, 'ChinaStockGoods_InboundHistory'));
    onSnapshot(q, (snapshot) => {
        inboundMap = {}; 
        snapshot.forEach((doc) => {
            const data = doc.data();
            const code = data.barcode;
            const qty = parseInt(data.qty) || 0;
            if (code) inboundMap[code] = (inboundMap[code] || 0) + qty;
        });
        if (tableData.length > 0) applyDates({ skipSync: true });
    });
}

// [Ver 5.6] 앱(스캐너)이 지정한 위치 실시간 구독 → '위치확인' 열용 (상품코드 → 위치)
let locationAssignMap = {};
// [Ver 7.9] 읽기 절감: 위치 데이터(2천건+)는 위치지정모드에 처음 들어갈 때만 1회 구독
let locHistSubscribed = false;
function ensureLocationHistory() { if (!locHistSubscribed) { locHistSubscribed = true; loadLocationHistory(); } }
// [Ver 8.15] 위치 데이터를 N개 샤드 문서(LOC_SHARD_i.map)에 자동 분산 저장 → 읽기 절감 + 크기 한도 자동 회피
let locShardCache = {}; // shardId → map
function rebuildLocationAssignMap() {
    locationAssignMap = {};
    for (const sid in locShardCache) {
        const map = locShardCache[sid] || {};
        for (const code in map) {
            const v = map[code] || {};
            locationAssignMap[code] = { location: v.location || '', at: v.at, sub: v.sub || '', worker: v.worker || '', base: (v.base !== undefined ? v.base : (v.location || '')) };
        }
    }
    // [Ver 8.56] 위치지정 당일입고: 미등록(강제추가) 위치행도 실시간 반영 + locCheck 갱신
    if (viewMode === 'location' && savedDates.length > 0) { appendUnregisteredLocation(); applyFilters(); }
    else if (filteredData.length > 0) renderTable(); // '위치확인' 열 실시간 갱신
    if (viewMode === 'location' && locSubView === 'existing' && !document.querySelector('.lm-edit-input')) renderLocMoveTable(); // 기존재고 인라인 목록 실시간 갱신(편집 중이면 건너뜀)
}
function loadLocationHistory() {
    for (let i = 0; i < NUM_LOC_SHARDS; i++) {
        const sid = 'LOC_SHARD_' + i;
        onSnapshot(doc(db, CHINA_COLLECTION, sid), (snap) => {
            locShardCache[sid] = (snap.exists() && snap.data() && snap.data().map) ? snap.data().map : {};
            rebuildLocationAssignMap();
        });
    }
}

// [Ver 8.75] 비축창고(FLOOR2_STOCK) 상시 구독 — 당일입고지정 목록을 '비축에 실제 들어가는 상품'으로 필터
//   floor2Map[code] = 비축 수량(>0). '비축창고 엑셀저장' 다운로드와 동일한 데이터.
let floor2Map = {};
let floor2Subscribed = false;
function ensureFloor2() { if (!floor2Subscribed) { floor2Subscribed = true; loadFloor2(); } }
function loadFloor2() {
    onSnapshot(doc(db, CHINA_COLLECTION, 'FLOOR2_STOCK'), (snap) => {
        const map = (snap.exists() && snap.data() && snap.data().map) ? snap.data().map : {};
        floor2Map = {};
        for (const code in map) { const q = parseInt(map[code] && map[code].floor2) || 0; if (q > 0) floor2Map[code] = q; }
        if (viewMode === 'location' && locSubView === 'today') applyFilters(); // 당일입고지정 목록 실시간 갱신
    });
}

async function syncOrderData(silent = false) {
    if (!csvUrlOrder && !csvUrlBuy) return;
    if(!silent) showLoading('🔄 오더리스트 동기화 중...');
    try {
        const [dataOrder, dataBuy] = await Promise.all([fetchCSV(csvUrlOrder), fetchCSV(csvUrlBuy)]);
        orderDataOriginal = dataOrder; orderDataBuy = dataBuy;
        extractShipDates(); 
        if(!silent) { hideLoading(); showToast('✅ 동기화 완료'); }
    } catch (e) { if(!silent) hideLoading(); }
}

async function fetchCSV(url) {
    if(!url) return [];
    let textData = '';
    try { const res = await fetch(url); textData = await res.text(); }
    catch (e) { const res2 = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`); textData = await res2.text(); }
    const wb = XLSX.read(textData, { type: 'string' });
    const rawData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    let headerIdx = -1, headers = [];
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
        const cl = rawData[i].map(h => cleanKey(h));
        // ★ 상품코드 또는 어드민상품코드 둘 다 인식
        if (cl.includes('상품코드') || cl.includes('어드민상품코드')) { 
            headerIdx = i; 
            headers = cl; 
            break; 
        }
    }
    const result = [];
    for (let i = headerIdx + 1; i < rawData.length; i++) {
        let obj = {}, empty = true;
        for (let j = 0; j < headers.length; j++) { if (headers[j]) { obj[headers[j]] = rawData[i][j]; if (rawData[i][j] !== '') empty = false; } }
        if (!empty) result.push(obj);
    }
    return result;
}

// ---------------------------------------------------------
// [복구] 청크 압축 저장 (방식 A: 기존 데이터 삭제 후 최신본만 저장)
//  - rows를 200개씩 묶어 'CHUNK_n' 문서의 dataStr 필드에 JSON으로 저장
//  - loadStockLogFromFirebase()가 동일한 dataStr 구조를 읽어 복원함
// ---------------------------------------------------------
async function saveChunkedData(rows, collectionSuffix, onProgress) {
    const collectionName = CHINA_COLLECTION + '_' + collectionSuffix;

    // 1. 기존 문서 전체 삭제 → '다음 업로드 전까지 최신 1개'만 유지
    if (onProgress) onProgress('🗑️ 기존 데이터 정리 중...');
    const existing = await getDocs(collection(db, collectionName));
    if (existing.size > 0) {
        const delBatch = writeBatch(db);
        existing.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
    }

    // 2. 상품코드 있는 행만 추려 200개씩 청크로 압축 저장
    const validRows = rows.filter(r => (r['상품코드'] || '').toString().trim());
    const CHUNK_SIZE = 200;
    const batch = writeBatch(db);
    let chunkCount = 0;
    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
        const chunk = validRows.slice(i, i + CHUNK_SIZE);
        const docRef = doc(db, collectionName, `CHUNK_${chunkCount}`);
        batch.set(docRef, { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
        chunkCount++;
        if (onProgress) onProgress(`💾 저장 중... (${Math.min(i + CHUNK_SIZE, validRows.length)}/${validRows.length})`);
    }
    if (chunkCount > 0) await batch.commit();
}

function handleStockLogUpload(e) {
    const file = e.target.files[0]; 
    if (!file) return;
    showLoading('📂 미발재고로그 처리 중...');
    
    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const text = evt.target.result;
            let rows = [];
            
            if (text.includes('<table') || text.includes('<TABLE')) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/html');
                const table = doc.querySelector('table');
                
                if (table) {
                    const trs = table.querySelectorAll('tr');
                    let headers = [];
                    trs.forEach((tr, rowIndex) => {
                        const tds = tr.querySelectorAll('th, td');
                        if (rowIndex === 0) {
                            tds.forEach(td => headers.push(cleanKey(td.innerText)));
                        } else {
                            let obj = {};
                            let empty = true;
                            tds.forEach((td, colIndex) => {
                                if (headers[colIndex]) {
                                    const val = td.innerText.trim();
                                    obj[headers[colIndex]] = val;
                                    if (val) empty = false;
                                }
                            });
                            if (!empty && obj['상품코드']) rows.push(obj);
                        }
                    });
                }
            } else {
                const wb = XLSX.read(text, { type: 'binary' });
                rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).filter(r => r['상품코드']);
            }

            stockLogData = {}; 
            rows.forEach(row => { 
                const code = (row['상품코드'] || '').toString().trim(); 
                if (code) stockLogData[code] = row; 
            });
            
            await saveChunkedData(rows, 'StockLog', (msg) => showLoading(msg));
            // [Ver 8.3] 바코드 ≠ 상품코드 매핑 저장 → 스캐너가 바코드로 찍어도 상품코드로 변환
            const bcMap = {};
            rows.forEach(row => {
                const c = (row['상품코드'] || '').toString().trim().toUpperCase();
                const bc = (row['바코드'] || '').toString().trim().toUpperCase();
                if (c && bc && bc !== c) bcMap[bc] = c;
            });
            try { await setDoc(doc(db, CHINA_COLLECTION, 'BARCODE_MAP'), { map: bcMap, count: Object.keys(bcMap).length, updatedAt: new Date() }); } catch (e) {}
            hideLoading();
            showToast(`✅ 미발재고 저장 완료 (바코드≠상품코드 ${Object.keys(bcMap).length}건 매핑)`);
            if (tableData.length > 0) applyDates();
            
        } catch (err) { 
            hideLoading(); 
            alert('파일 처리 실패: ' + err.message); 
        }
        e.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
}

// [Ver 5.8] 위치 매핑 업로드 → Firebase(LOCATION_MAP) 저장 (하드코딩 대체, 코딩 없이 변경)
//  - 파일: 상품코드 열 + 위치 열(로케이션/옵션/옵션추가항목1/위치 등) → {상품코드: 위치}
async function handleLocationMapUpload(e) {
    const file = e.target.files[0]; if (!file) return;
    showLoading('📍 위치 매핑 처리 중...');
    try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
        let hi = -1, headers = [];
        for (let i = 0; i < Math.min(20, rows.length); i++) {
            const cl = rows[i].map(h => cleanKey(h));
            if (cl.includes('상품코드')) { hi = i; headers = cl; break; }
        }
        if (hi < 0) { hideLoading(); alert('상품코드 열을 찾지 못했습니다.'); e.target.value = ''; return; }
        const codeIdx = headers.indexOf('상품코드');
        // 위치 열: 알려진 이름 우선, 없으면 상품코드가 아닌 첫 열
        const locIdx = pickLocationColumn(headers, codeIdx, ['로케이션','위치','옵션추가항목1','옵션']);
        if (locIdx < 0) { hideLoading(); alert('위치 열을 찾지 못했습니다.'); e.target.value = ''; return; }
        const map = {};
        for (let i = hi + 1; i < rows.length; i++) {
            const code = (rows[i][codeIdx] || '').toString().trim().toUpperCase();
            const loc = (rows[i][locIdx] || '').toString().trim();
            if (code) map[code] = loc;
        }
        const cnt = Object.keys(map).length;
        if (!cnt) { hideLoading(); alert('유효한 행이 없습니다.'); e.target.value = ''; return; }
        // [Ver 8.62] 전체 교체 대신 기존 매핑에 병합(같은 상품코드는 덮어씀) — 관리 모달의 수동 편집분 보존
        await loadLocationMapDoc();
        Object.assign(locationMapData, map);
        await saveLocationMapDoc();
        hideLoading();
        renderLocationMapList();
        showToast(`✅ 위치 매핑 ${cnt}건 반영 (총 ${Object.keys(locationMapData).length}건) — 스캐너에 즉시 반영`);
    } catch (err) { hideLoading(); alert('위치 매핑 처리 실패: ' + err.message); }
    e.target.value = '';
}

// [Ver 8.62] 위치매핑 관리 모달: LOCATION_MAP(상품코드→스캐너 고정 위치) 조회/추가/수정/삭제
let locationMapData = {};
async function loadLocationMapDoc() {
    try { const s = await getDoc(doc(db, CHINA_COLLECTION, 'LOCATION_MAP')); locationMapData = (s.exists() && s.data().map) ? s.data().map : {}; } catch (e) { locationMapData = {}; }
}
async function saveLocationMapDoc() {
    try { await setDoc(doc(db, CHINA_COLLECTION, 'LOCATION_MAP'), { map: locationMapData, count: Object.keys(locationMapData).length, updatedAt: new Date() }); } catch (e) { alert('저장 실패: ' + e.message); }
}
async function openLocationMapModal() {
    closeAllMenus();
    showLoading('📍 위치매핑 불러오는 중...');
    await loadLocationMapDoc();
    hideLoading();
    renderLocationMapList();
    document.getElementById('location-map-modal').style.display = 'flex';
}
function closeLocationMapModal() { document.getElementById('location-map-modal').style.display = 'none'; }
function renderLocationMapList() {
    const tb = document.getElementById('locmap-tbody'); if (!tb) return;
    const kw = (document.getElementById('locmap-search')?.value || '').trim().toUpperCase();
    let entries = Object.entries(locationMapData);
    if (kw) entries = entries.filter(([c, l]) => c.includes(kw) || String(l || '').toUpperCase().includes(kw));
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    const total = Object.keys(locationMapData).length;
    const cntEl = document.getElementById('locmap-count'); if (cntEl) cntEl.textContent = `총 ${total}건` + (kw ? ` · 검색 ${entries.length}건` : '');
    tb.innerHTML = entries.length
        ? entries.map(([c, l]) => `<tr style="border-bottom:1px solid #eee;"><td style="padding:7px 6px; font-weight:bold; white-space:nowrap;">${escBa(c)}</td><td style="padding:7px 6px; color:#7b1fa2; font-weight:bold;">${escBa(l)}</td><td style="padding:7px 6px; white-space:nowrap;"><span class="locmap-edit" data-c="${escBa(c)}" title="수정" style="cursor:pointer; font-size:15px; margin-right:8px;">✏️</span><span class="locmap-del" data-c="${escBa(c)}" title="삭제" style="cursor:pointer; font-size:15px;">🗑️</span></td></tr>`).join('')
        : '<tr><td colspan="3" style="padding:22px; color:#999;">등록된 위치매핑이 없습니다. 파일 업로드 또는 위에서 직접 추가하세요.</td></tr>';
    tb.querySelectorAll('.locmap-del').forEach(x => x.onclick = async () => { if (confirm(`[${x.dataset.c}] 매핑을 삭제할까요?`)) { delete locationMapData[x.dataset.c]; await saveLocationMapDoc(); renderLocationMapList(); showToast('🗑️ 삭제됨 — 스캐너 즉시 반영'); } });
    tb.querySelectorAll('.locmap-edit').forEach(x => x.onclick = async () => {
        const code = x.dataset.c;
        const nv = prompt(`[${code}] 새 위치값`, locationMapData[code] || '');
        if (nv === null) return;
        locationMapData[code] = nv.trim();
        await saveLocationMapDoc(); renderLocationMapList(); showToast('✏️ 수정됨 — 스캐너 즉시 반영');
    });
}
async function addLocationMapManual() {
    const cEl = document.getElementById('locmap-code'), lEl = document.getElementById('locmap-loc');
    const c = (cEl.value || '').trim().toUpperCase(); const l = (lEl.value || '').trim();
    if (!c || !l) { alert('상품코드와 위치를 모두 입력하세요.'); return; }
    const exists = locationMapData[c] !== undefined;
    locationMapData[c] = l;
    await saveLocationMapDoc();
    cEl.value = ''; lEl.value = ''; cEl.focus();
    renderLocationMapList();
    showToast(exists ? '✏️ 기존 상품코드 위치 변경됨 — 스캐너 즉시 반영' : '✅ 위치매핑 추가됨 — 스캐너 즉시 반영');
}
async function downloadLocationMap() {
    const entries = Object.entries(locationMapData).sort((a, b) => a[0].localeCompare(b[0]));
    if (!entries.length) { alert('내려받을 위치매핑이 없습니다.'); return; }
    const aoa = [['상품코드', '위치']];
    entries.forEach(([c, l]) => aoa.push([c, l]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'worksheet');
    const wbout = XLSX.write(wb, { bookType: 'biff8', type: 'array' });
    await downloadToDesktop('위치매핑.xls', new Blob([wbout], { type: 'application/vnd.ms-excel' }));
}

// ---------------------------------------------------------
// [Ver 8.32] 오류바코드매칭: 스캔 바코드 → 상품코드 수동 별칭 (BARCODE_ALIAS 문서, 미발로그 자동맵과 별개로 보존)
let barcodeAlias = {};
function escBa(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
async function loadBarcodeAlias() {
    try { const s = await getDoc(doc(db, CHINA_COLLECTION, 'BARCODE_ALIAS')); barcodeAlias = (s.exists() && s.data().map) ? s.data().map : {}; } catch (e) { barcodeAlias = {}; }
}
async function saveBarcodeAlias() {
    try { await setDoc(doc(db, CHINA_COLLECTION, 'BARCODE_ALIAS'), { map: barcodeAlias, count: Object.keys(barcodeAlias).length, updatedAt: new Date() }); } catch (e) { alert('저장 실패: ' + e.message); }
}
async function openBarcodeAliasModal() {
    closeAllMenus();
    await loadBarcodeAlias();
    renderBarcodeAliasList();
    document.getElementById('barcode-alias-modal').style.display = 'flex';
}
function closeBarcodeAliasModal() { document.getElementById('barcode-alias-modal').style.display = 'none'; }
function renderBarcodeAliasList() {
    const tb = document.getElementById('ba-tbody'); if (!tb) return;
    const kw = (document.getElementById('ba-search')?.value || '').trim().toUpperCase();
    let entries = Object.entries(barcodeAlias);
    if (kw) entries = entries.filter(([b, c]) => b.includes(kw) || String(c || '').toUpperCase().includes(kw));
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    const total = Object.keys(barcodeAlias).length;
    const cnt = document.getElementById('ba-count'); if (cnt) cnt.textContent = `총 ${total}건` + (kw ? ` · 검색 ${entries.length}건` : '');
    tb.innerHTML = entries.length
        ? entries.map(([b, c]) => `<tr style="border-bottom:1px solid #eee;"><td style="padding:7px 6px; font-weight:bold; white-space:nowrap;">${escBa(b)}</td><td style="padding:7px 6px; color:#1565c0; font-weight:bold;">${escBa(c)}</td><td style="padding:7px 6px;"><span class="ba-del" data-b="${escBa(b)}" title="삭제" style="cursor:pointer; font-size:15px;">🗑️</span></td></tr>`).join('')
        : '<tr><td colspan="3" style="padding:22px; color:#999;">등록된 매칭이 없습니다. 파일 업로드 또는 위에서 직접 추가하세요.</td></tr>';
    tb.querySelectorAll('.ba-del').forEach(x => x.onclick = async () => { delete barcodeAlias[x.dataset.b]; await saveBarcodeAlias(); renderBarcodeAliasList(); });
}
async function addBarcodeAliasManual() {
    const bEl = document.getElementById('ba-barcode'), cEl = document.getElementById('ba-code');
    const b = (bEl.value || '').trim().toUpperCase(); const c = (cEl.value || '').trim().toUpperCase();
    if (!b || !c) { alert('바코드와 상품코드를 모두 입력하세요.'); return; }
    barcodeAlias[b] = c;
    await saveBarcodeAlias();
    bEl.value = ''; cEl.value = ''; bEl.focus();
    renderBarcodeAliasList();
    showToast('✅ 매칭 추가됨 — 스캐너 즉시 반영');
}
// [Ver 8.32] 시트 행 읽기: xlsx/xls는 array, 헤더 못 찾으면 UTF-8 텍스트(csv/html)로 재시도
async function readSheetRowsAOA(file, need) {
    const buf = await file.arrayBuffer();
    const hasHdr = (rs) => (rs || []).slice(0, 20).some(r => { const cl = (r || []).map(cleanKey); return need.every(n => cl.includes(n)); });
    let rows = [];
    try { const wb = XLSX.read(new Uint8Array(buf), { type: 'array' }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }); } catch (e) {}
    if (!hasHdr(rows)) {
        try { const t = new TextDecoder('utf-8').decode(buf); const wb2 = XLSX.read(t, { type: 'string' }); const r2 = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1, defval: '' }); if (hasHdr(r2)) rows = r2; } catch (e) {}
    }
    return rows;
}
async function downloadBarcodeAlias() {
    const entries = Object.entries(barcodeAlias).sort((a, b) => a[0].localeCompare(b[0]));
    if (!entries.length) { alert('내려받을 매칭이 없습니다.'); return; }
    const aoa = [['바코드', '상품코드']];
    entries.forEach(([b, c]) => aoa.push([b, c]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'worksheet');
    const wbout = XLSX.write(wb, { bookType: 'biff8', type: 'array' });
    await downloadToDesktop('오류바코드매칭.xls', new Blob([wbout], { type: 'application/vnd.ms-excel' }));
}
async function handleBarcodeAliasUpload(e) {
    const file = e.target.files[0]; if (!file) return;
    showLoading('📂 오류바코드 매칭 처리 중...');
    try {
        const rows = await readSheetRowsAOA(file, ['바코드', '상품코드']);
        let hi = -1, headers = [];
        for (let i = 0; i < Math.min(20, rows.length); i++) {
            const cl = rows[i].map(h => cleanKey(h));
            if (cl.includes('바코드') && cl.includes('상품코드')) { hi = i; headers = cl; break; }
        }
        if (hi < 0) { hideLoading(); alert('바코드/상품코드 두 열을 찾지 못했습니다.'); e.target.value = ''; return; }
        const bIdx = headers.indexOf('바코드'), cIdx = headers.indexOf('상품코드');
        let added = 0;
        for (let i = hi + 1; i < rows.length; i++) {
            const b = (rows[i][bIdx] || '').toString().trim().toUpperCase();
            const c = (rows[i][cIdx] || '').toString().trim().toUpperCase();
            if (b && c) { barcodeAlias[b] = c; added++; }
        }
        if (!added) { hideLoading(); alert('유효한 행이 없습니다.'); e.target.value = ''; return; }
        await saveBarcodeAlias();
        hideLoading();
        renderBarcodeAliasList();
        showToast(`✅ ${added}건 반영 (총 ${Object.keys(barcodeAlias).length}건) — 스캐너 즉시 반영`);
    } catch (err) { hideLoading(); alert('처리 실패: ' + err.message); }
    e.target.value = '';
}

// [Ver 6.5] 기존재고 옵션추가항목1(현재 위치값) 시드 업로드 → LocationHistory(sub=existing)에 세팅
//  - 파일: 상품코드 + 옵션추가항목1(콤마 다중 위치) → 스캐너가 이 값 뒤에 새 자리를 append 함
//  - 해당 상품의 기존재고 위치값을 파일 값으로 '덮어쓰기'(ERP 기준값 재세팅). 스캔 전에 먼저 올리세요.
function normLocList(s) {
    return (s || '').toString().split(',').map(x => x.trim()).filter(Boolean).join(',');
}
async function handleExistingLocUpload(e) {
    const file = e.target.files[0]; if (!file) return;
    showLoading('📥 기존재고 위치값 처리 중...');
    try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
        let hi = -1, headers = [];
        for (let i = 0; i < Math.min(20, rows.length); i++) {
            const cl = rows[i].map(h => cleanKey(h));
            if (cl.includes('상품코드')) { hi = i; headers = cl; break; }
        }
        if (hi < 0) { hideLoading(); alert('상품코드 열을 찾지 못했습니다.'); e.target.value = ''; return; }
        const codeIdx = headers.indexOf('상품코드');
        const locIdx = pickLocationColumn(headers, codeIdx, ['옵션추가항목1', '로케이션', '위치', '옵션']);
        if (locIdx < 0) { hideLoading(); alert('옵션추가항목1(위치) 열을 찾지 못했습니다.'); e.target.value = ''; return; }
        const entries = [];
        for (let i = hi + 1; i < rows.length; i++) {
            const code = (rows[i][codeIdx] || '').toString().trim().toUpperCase();
            const loc = normLocList(rows[i][locIdx]);
            if (code && loc) entries.push([code, loc]);
        }
        if (!entries.length) { hideLoading(); alert('유효한 (상품코드+위치) 행이 없습니다.'); e.target.value = ''; return; }
        // [Ver 8.15] 샤드별로 나눠 병합 저장(샤드당 1회 쓰기)
        const now = Date.now();
        const byShard = {};
        entries.forEach(([code, loc]) => { const sid = locShardId(code); (byShard[sid] = byShard[sid] || {})[code] = { location: loc, base: loc, sub: 'existing', at: now, worker: 'Seed_Upload' }; });
        for (const sid in byShard) await setDoc(doc(db, CHINA_COLLECTION, sid), { map: byShard[sid], updatedAt: new Date() }, { merge: true });
        hideLoading();
        showToast(`✅ 기존재고 위치값 세팅 완료 (${entries.length}건) — 스캐너가 이 값 뒤에 새 자리를 추가합니다`);
    } catch (err) { hideLoading(); alert('기존재고 위치값 처리 실패: ' + err.message); }
    e.target.value = '';
}

// [Ver 2.8] 스캔DB 동기화 공용 코어
//  - 도착수량은 (도착예정 - 이미 입고된 수량)으로 차감해 업로드
//    → 자동 동기화가 여러 번 돌아도 앱에서 처리한 입고 차감분이 유지됨
async function syncScanDBCore() {
    const SCAN_DB_COLL = 'ChinaStockGoods_ScanDB';
    const existing = await getDocs(collection(db, SCAN_DB_COLL));
    if (existing.size > 0) {
        const delBatch = writeBatch(db);
        existing.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
    }
    const CHUNK_SIZE = 500;
    const syncRows = tableData.filter(d => !d.unregistered); // [Ver 8.52] 미등록 입고분은 스캔DB에서 제외(오더 상품만)
    for (let i = 0; i < syncRows.length; i += CHUNK_SIZE) {
        const batch = writeBatch(db);
        const chunk = syncRows.slice(i, i + CHUNK_SIZE);
        chunk.forEach(item => {
            const docRef = doc(db, SCAN_DB_COLL, item.code);
            batch.set(docRef, {
                code: item.code, name: item.name, option: item.option,
                arrivalQty: Math.max(item.arrivalQty - (inboundMap[item.code] || 0), 0),
                mibalQty: Math.max(item.mibalQty - (inboundMap[item.code] || 0), 0), // [Ver 8.48] 미발도 입고분만큼 차감 (도착수량과 동일 방식) — 재동기화 시에도 유지
                totalStock: item.totalStock, location: item.location,
                capacity: item.capacity, updatedAt: new Date()
            });
        });
        await batch.commit();
    }
}

// [Ver 2.8] 자동 동기화 스케줄러 (연속 호출 병합 + 동시 실행 방지)
let scanDbSyncTimer = null;
let scanDbSyncing = false;
let scanDbSyncPending = false;

function scheduleScanDBSync() {
    if (!tableData || tableData.length === 0) return;
    clearTimeout(scanDbSyncTimer);
    scanDbSyncTimer = setTimeout(runScanDBSync, 1500);
}

async function runScanDBSync() {
    if (scanDbSyncing) { scanDbSyncPending = true; return; }
    scanDbSyncing = true;
    try {
        await syncScanDBCore();
        showToast('🔄 앱용 스캔DB 자동 동기화 완료');
    } catch (e) { console.error('스캔DB 자동 동기화 실패:', e); }
    scanDbSyncing = false;
    if (scanDbSyncPending) { scanDbSyncPending = false; scheduleScanDBSync(); }
}

// [Ver 7.4] 컬렉션 전체 삭제 (배치 한도 500 회피 위해 400씩 청크)
async function deleteAllDocs(collName) {
    const snap = await getDocs(collection(db, collName));
    for (let i = 0; i < snap.docs.length; i += 400) {
        const b = writeBatch(db);
        snap.docs.slice(i, i + 400).forEach(d => b.delete(d.ref));
        await b.commit();
    }
}
// [Ver 7.4] 전체 초기화 — 현재 모드의 데이터만 초기화 (미발 ↔ 위치 서로 영향 없음)
async function clearAllData() {
    if (viewMode === 'location') { await clearLocationData(); return; }
    if (!confirm("미발계산기 데이터를 초기화할까요?\n(수동편집·미발재고로그·앱 입고이력·비축창고 누적 삭제 / 위치 데이터는 유지)")) return;
    showLoading('🗑️ 미발계산기 초기화 중...');
    try {
        await deleteDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'));
        await deleteAllDocs(CHINA_COLLECTION + '_StockLog');
        await deleteAllDocs('ChinaStockGoods_InboundHistory');
        await setDoc(doc(db, CHINA_COLLECTION, 'FLOOR2_STOCK'), { map: {}, updatedAt: new Date() }); // [Ver 8.44] 비축창고 누적도 함께 초기화
        await setDoc(doc(db, CHINA_COLLECTION, 'FORCE_ALLOW'), { map: {}, updatedAt: new Date() }); // [Ver 8.50] 스캐너 강제전송 허용목록도 함께 초기화
        orderDataOriginal = [];
        orderDataBuy = [];
        stockLogData = {};
        editedCells = {};
        inboundMap = {};
        tableData = [];
        filteredData = [];
        columnFilters = {}; // [Ver 8.52] 열 필터도 초기화
        document.getElementById('date-checklist-container').innerHTML = ''; // [Ver 8.46] 체크박스 먼저 비우기 (아래 updateSavedDatesFromCheckboxes가 옛 체크값을 다시 읽어 선택을 되살리는 것 방지)
        savedDates = [];
        updateSavedDatesFromCheckboxes(); // 이제 체크된 항목 없음 → savedDates=[] 유지 + 모드별 저장소/버튼 라벨 갱신
        renderSelectedTags();
        renderTable();
        updateSummary();
        await saveConfig(); // 선택 출고일 비운 상태 저장
        await syncOrderData(true); // [Ver 4.4] 초기화 후 출고일 목록 다시 로드 (빈 화면 방지)
        hideLoading();
        showToast('✅ 미발계산기 초기화 완료 (비축창고 포함 · 위치 데이터는 유지)');
    } catch (e) {
        hideLoading();
        alert('초기화 실패: ' + e.message);
    }
}
// [Ver 7.4] 위치 데이터만 초기화 (당일·기존재고 위치 지정 전체 / 미발 데이터는 유지)
async function clearLocationData() {
    if (!confirm("위치 데이터를 초기화할까요?\n(당일·기존재고 위치 지정 전체 삭제 / 미발 데이터는 유지)")) return;
    showLoading('🗑️ 위치 데이터 초기화 중...');
    try {
        for (let i = 0; i < NUM_LOC_SHARDS; i++) await setDoc(doc(db, CHINA_COLLECTION, 'LOC_SHARD_' + i), { map: {}, updatedAt: new Date() }); // [Ver 8.15] 모든 샤드 비우기
        locShardCache = {}; locationAssignMap = {};
        if (filteredData.length > 0) renderTable(); // 위치확인 열 갱신
        renderLocMoveTable(); // 기존재고 목록 갱신
        hideLoading();
        showToast('✅ 위치 데이터 초기화 완료 (미발 데이터는 유지)');
    } catch (e) {
        hideLoading();
        alert('초기화 실패: ' + e.message);
    }
}

// ---------------------------------------------------------
// 비즈니스 로직 (매칭 및 렌더링)
// ---------------------------------------------------------
// [Ver 8.28] 날짜 표시: 기준=출고일. 도착일 없으면 '8.11 출고', 있으면 '8.11 출고 → 8.19 입고'
function fmtMD(d) { const p = (d || '').split('-'); return p.length === 3 ? `${+p[1]}.${+p[2]}` : d; }
function dateDisplayLabel(ship) {
    const arrivals = (arrivalByShip[ship] || []).filter(Boolean);
    const arrTxt = arrivals.length ? ' → ' + arrivals.map(fmtMD).join(',') + ' 입고' : '';
    return `${fmtMD(ship)} 출고${arrTxt}`;
}
function extractShipDates() {
    const checklistContainer = document.getElementById('date-checklist-container');
    if (!checklistContainer) return;
    const dateMap = {};
    const oCols = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일']; // [Ver 8.28] 기준=출고일
    const dCols = ['1차본사도착일','2차본사도착일','3차본사도착일','4차본사도착일','5차본사도착일','6차본사도착일']; // 도착일(있으면 표시/유예)
    const qCols = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];

    const process = (rows) => {
        rows.forEach(row => {
            for (let idx = 0; idx < oCols.length; idx++) {
                const ship = normalizeDate(row[oCols[idx]]);
                if (!ship || ship.length < 10) continue;   // [Ver 8.28] 출고일 없음 → 제외
                const arr = normalizeDate(row[dCols[idx]]);
                if (arr && arr.length >= 10 && !withinGrace(arr)) continue; // 도착일+유예 지남 → 제외
                if (!dateMap[ship]) dateMap[ship] = { qty: 0, skus: new Set(), arrivals: new Set() };
                dateMap[ship].qty += (parseInt(row[qCols[idx]]) || 0);
                dateMap[ship].skus.add(row['상품코드'] || row['어드민상품코드']);
                if (arr && arr.length >= 10) dateMap[ship].arrivals.add(arr);
            }
        });
    };
    process(orderDataOriginal); process(orderDataBuy);
    arrivalByShip = {};
    Object.entries(dateMap).forEach(([ship, info]) => { arrivalByShip[ship] = [...info.arrivals].sort(); });
    const sorted = Object.entries(dateMap).sort((a, b) => b[0].localeCompare(a[0]));
    if (sorted.length === 0) { checklistContainer.innerHTML = '출고 데이터 없음'; return; }
    let html = '';
    sorted.forEach(([date, info]) => {
        const isChecked = savedDates.includes(date) ? 'checked' : '';
        html += `<label class="date-item"><input type="checkbox" class="date-check" value="${date}" ${isChecked}><span>${dateDisplayLabel(date)} (${info.skus.size}종 / ${info.qty.toLocaleString()}장)</span></label>`;
    });
    checklistContainer.innerHTML = html;
    // [Ver 3.1] 팝업 안에서는 선택만 반영(태그 갱신), 적용은 팝업이 닫힐 때
    checklistContainer.querySelectorAll('.date-check').forEach(ck => { ck.addEventListener('change', () => { updateSavedDatesFromCheckboxes(); renderSelectedTags(); }); });
}

// [Ver 8.10] 현재 모드의 출고일 선택을 모드별 저장소에 반영
function persistActiveDates() { if (viewMode === 'location') savedDatesLoc = [...savedDates]; else savedDatesMibal = [...savedDates]; }
// [Ver 8.10] 모드 전환 시 해당 모드의 출고일 선택으로 날짜 UI/표 갱신
function refreshDatesUI() {
    extractShipDates();      // 체크리스트(선택상태 반영)
    renderSelectedTags();    // 선택 태그
    const btn = document.getElementById('btn-date-dropdown');
    if (btn) btn.innerText = savedDates.length > 0 ? `▼ ${savedDates.length}개 선택됨` : `▼ 출고일 선택`;
    if (savedDates.length > 0) applyDates();
    else { tableData = []; filteredData = []; renderTable(); updateSummary(); }
}
function updateSavedDatesFromCheckboxes() {
    savedDates = Array.from(document.querySelectorAll('.date-check:checked')).map(c => c.value);
    persistActiveDates(); // [Ver 8.10] 모드별 저장소 동기화
    const btn = document.getElementById('btn-date-dropdown');
    btn.innerText = savedDates.length > 0 ? `▼ ${savedDates.length}개 선택됨` : `▼ 출고일 선택`;
}

function renderSelectedTags() {
    const container = document.getElementById('date-tags-container');
    if (savedDates.length === 0) { container.innerHTML = '선택된 출고일 없음'; return; }
    let html = '';
    [...savedDates].sort((a,b)=>b.localeCompare(a)).forEach(d => {
        html += `<div class="date-tag">${dateDisplayLabel(d)} <span class="remove-btn" data-date="${d}">✕</span></div>`;
    });
    container.innerHTML = html;
    container.querySelectorAll('.remove-btn').forEach(b => b.addEventListener('click', () => {
        const d = b.dataset.date; savedDates = savedDates.filter(x => x !== d);
        const ck = document.querySelector(`.date-check[value="${d}"]`); if(ck) ck.checked = false;
        updateSavedDatesFromCheckboxes(); renderSelectedTags(); autoApplyDates();
    }));
}

// [Ver 3.1] 출고일 팝업이 열려있는 동안은 적용을 미루고, 닫힐 때 한 번만 적용
let dateSelectionSnapshot = null; // 팝업 열 때의 선택 상태 (null = 팝업 닫힘)

function snapshotDateSelection() {
    dateSelectionSnapshot = JSON.stringify([...savedDates].sort());
}

function onDatePopupClosed() {
    const now = JSON.stringify([...savedDates].sort());
    if (dateSelectionSnapshot !== null && now !== dateSelectionSnapshot) autoApplyDates();
    dateSelectionSnapshot = null;
}

// [Ver 2.9] 출고일 선택/해제 시 적용 (전체 해제 시 표 비우기 포함)
function autoApplyDates() {
    // 팝업 열림 상태에서 직접 적용된 경우(태그 ✕ 등) 닫힐 때 중복 적용 방지
    if (dateSelectionSnapshot !== null) snapshotDateSelection();
    if (savedDates.length === 0) {
        tableData = []; filteredData = [];
        renderTable(); updateSummary();
        saveConfig();
        return;
    }
    applyDates();
}

function applyDates(opts) {
    if (savedDates.length === 0) return;
    saveConfig();
    const oCols = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일']; // [Ver 8.28] 기준=출고일
    const dCols = ['1차본사도착일','2차본사도착일','3차본사도착일','4차본사도착일','5차본사도착일','6차본사도착일']; // 도착일(있으면 유예)
    const qCols = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];

    let resultMap = {};
    const match = (rows) => {
        rows.forEach(row => {
            const code = (row['어드민상품코드'] || row['상품코드'] || '').toString().trim(); if (!code) return;
            let matched = false, totalQty = 0;
            for (let idx = 0; idx < oCols.length; idx++) {
                const ship = normalizeDate(row[oCols[idx]]);
                if (!ship || ship.length < 10) continue;   // [Ver 8.28] 출고일 없음 → 제외
                const arr = normalizeDate(row[dCols[idx]]);
                if (arr && arr.length >= 10 && !withinGrace(arr)) continue; // 도착일+유예 지남 → 제외
                if (savedDates.includes(ship)) { matched = true; totalQty += (parseInt(row[qCols[idx]]) || 0); }
            }
            if (matched) {
                if (!resultMap[code]) resultMap[code] = { code, name: getProductName(row), option: row['옵션']||'', arrivalQty: 0, bigoY: row['비고']||'' };
                resultMap[code].arrivalQty += totalQty;
            }
        });
    };
    match(orderDataOriginal); match(orderDataBuy);
    
    tableData = Object.values(resultMap).map(item => {
        const log = stockLogData[item.code] || {}; const ed = editedCells[item.code] || {};
        const loc = (log['로케이션'] || '').split('/')[0].trim();
        const totalStock = parseInt(log['정상재고']) || 0;   // 총재고
        // [Ver 5.4] 적재량: 개별 수정값 > 구역별/기본값
        const capacity = (ed.capacity !== undefined && ed.capacity !== '') ? (parseInt(ed.capacity) || 0) : getCapacityByLocation(loc);
        // [Ver 5.3] 부족수량 = 미발재고로그의 '부족수량' 값 (수동 편집이 있으면 그 값 우선)
        const logShort = (log['부족수량'] !== undefined && log['부족수량'] !== null && log['부족수량'] !== '') ? String(log['부족수량']).trim() : '';
        const shortageVal = (ed.shortage !== undefined) ? ed.shortage : logShort; // 부족수량(열)
        const directShipVal = ed.directShip || '';            // 직진배송(열)
        // [Ver 4.7] 미발수량 = 설정된 공식으로 계산 (변수: 총재고/적재량/부족수량/직진배송)
        const _short = parseInt(shortageVal) || 0;            // 부족수량
        const _direct = parseInt(directShipVal) || 0;         // 직진배송수량
        const mibalQty = evalMibal(totalStock, capacity, _short, _direct, { ...log, 도착수량: item.arrivalQty }); // [Ver 8.17] 도착수량 변수 주입
        return {
            code: item.code, name: item.name, option: item.option, arrivalQty: item.arrivalQty,
            mibalQty, totalStock,
            location: loc, capacity,
            confirmed: inboundMap[item.code] || ed.confirmed || '', 
            shortage: shortageVal, directShip: directShipVal, memo: item.bigoY || ed.memo || ''
        };
    }).filter(d => d.arrivalQty > 0);
    appendUnregisteredInbound(); // [Ver 8.52] 오더리스트에 없는데 강제전송된 입고분도 표에 추가
    appendUnregisteredLocation(); // [Ver 8.56] 위치지정 당일입고 강제추가분도 표에 추가
    applyFilters(); // [Ver 8.52] 검색어/열필터 유지하며 렌더 (기존 filteredData=[...tableData]+renderTable+updateSummary 대체)
    // [Ver 2.8] 표 갱신 시 앱용 스캔DB 자동 동기화
    // (앱 입고 이벤트로 인한 갱신은 앱이 이미 차감했으므로 skipSync로 생략)
    if (viewMode !== 'location' && !(opts && opts.skipSync)) scheduleScanDBSync(); // [Ver 8.10] ScanDB는 미발계산기 선택 기준으로만 동기화
}

// [Ver 8.52] 미등록 입고분: 오더리스트(CSV)에 없는데 스캐너에서 강제전송(입고)된 상품을 표에 추가
//   - 이미 표에 있거나(선택 출고일 상품) 오더리스트에 있는 코드는 제외 → '진짜 미등록'만
//   - 도착/미발 0, 입고확인=입고수량, 비고=미등록, unregistered 플래그(배경강조 + ScanDB동기화 제외)
function appendUnregisteredInbound() {
    if (viewMode === 'location') return;
    const orderCodes = new Set();
    [orderDataOriginal, orderDataBuy].forEach(rows => (rows || []).forEach(r => { const c = (r['어드민상품코드'] || r['상품코드'] || '').toString().trim(); if (c) orderCodes.add(c); }));
    const inTable = new Set(tableData.map(d => d.code));
    Object.keys(inboundMap).forEach(code => {
        const qty = inboundMap[code]; if (!qty) return;
        if (inTable.has(code) || orderCodes.has(code)) return; // 표에 있거나 오더리스트에 있으면 미등록 아님
        const log = stockLogData[code] || {};
        const loc = (log['로케이션'] || '').split('/')[0].trim() || '미지정';
        tableData.push({ code, name: log['상품명'] || '', option: '', arrivalQty: 0, mibalQty: 0, totalStock: parseInt(log['정상재고']) || 0, location: loc, capacity: getCapacityByLocation(loc), confirmed: qty, shortage: '', directShip: '', memo: '미등록', unregistered: true });
    });
}

// [Ver 8.56] 위치지정 당일입고: 오더리스트에 없는데 강제추가로 위치 지정된 상품도 표에 추가 (없으면 웹 당일입고 표/다운로드에서 안 보임)
function appendUnregisteredLocation() {
    if (viewMode !== 'location') return;
    tableData = tableData.filter(d => !d.unregisteredLoc); // 실시간 갱신: 기존 미등록 위치행 제거 후 재계산
    const orderCodes = new Set();
    [orderDataOriginal, orderDataBuy].forEach(rows => (rows || []).forEach(r => { const c = (r['어드민상품코드'] || r['상품코드'] || '').toString().trim(); if (c) orderCodes.add(c); }));
    const inTable = new Set(tableData.map(d => d.code));
    Object.entries(locationAssignMap).forEach(([code, v]) => {
        if ((v.sub || '') !== 'today' || !v.location) return;    // 당일입고로 지정된 것만
        if (inTable.has(code) || orderCodes.has(code)) return;   // 오더리스트/표에 있으면 미등록 아님
        const log = stockLogData[code] || {};
        tableData.push({ code, name: log['상품명'] || '', option: '', arrivalQty: 0, mibalQty: 0, totalStock: 0, location: (log['로케이션'] || '').split('/')[0].trim() || '', capacity: 0, confirmed: '', shortage: '', directShip: '', memo: '미등록', unregistered: true, unregisteredLoc: true });
    });
}

// [Ver 5.4] 셀 편집 시 해당 상품 한 줄만 미발수량 재계산 + 화면 갱신
function recomputeRow(code) {
    const row = tableData.find(d => d.code === code);
    if (!row) return;
    const ed = editedCells[code] || {};
    const loc = row.location;
    const cap = (ed.capacity !== undefined && ed.capacity !== '') ? (parseInt(ed.capacity) || 0) : getCapacityByLocation(loc);
    const short = parseInt((ed.shortage !== undefined) ? ed.shortage : row.shortage) || 0;
    const direct = parseInt((ed.directShip !== undefined) ? ed.directShip : row.directShip) || 0;
    row.capacity = cap;
    if (ed.shortage !== undefined) row.shortage = ed.shortage;
    if (ed.directShip !== undefined) row.directShip = ed.directShip;
    row.mibalQty = evalMibal(row.totalStock, cap, short, direct, { ...(stockLogData[code] || {}), 도착수량: row.arrivalQty }); // [Ver 8.17] 도착수량 변수 주입
    renderTable(); updateSummary();
    scheduleScanDBSync(); // 편집 결과를 앱 스캔DB에도 반영
}

// ---------------------------------------------------------
// [Ver 5.5] 표 열(헤더) 구성 - 순서 변경 + 재고로그 필드 열 추가
// ---------------------------------------------------------
const DEFAULT_COLUMNS = ['no','code','name','option','arrivalQty','mibalQty','totalStock','location','capacity','confirmed','shortage','directShip','memo'];
const BUILTIN_COLS = {
    no:        { label:'No', width:'40px' },
    code:      { label:'상품코드', sort:'code', code:true, width:'100px' },
    name:      { label:'상품명', sort:'name', width:'150px' },
    option:    { label:'옵션명', width:'110px' },
    arrivalQty:{ label:'도착수량', sort:'arrivalQty', width:'75px' },
    mibalQty:  { label:'미발수량', sort:'mibalQty', width:'75px' },
    totalStock:{ label:'총재고', sort:'totalStock', width:'65px' },
    location:  { label:'로케이션', width:'110px' },
    capacity:  { label:'적재량', edit:'capacity', width:'60px' },
    confirmed: { label:'입고확인', edit:'confirmed', width:'70px' },
    shortage:  { label:'부족수량', edit:'shortage', width:'70px' },
    directShip:{ label:'직진배송', edit:'directShip', width:'75px' },
    memo:      { label:'비고', edit:'memo' },
    locCheck:  { label:'추가위치', width:'110px' }   // [Ver 8.31] 새로 추가된 자리만 표시
};
let columnConfig = null; // null = 기본 순서, 아니면 열 key 배열
let locationColumnConfig = null; // [Ver 8.53] 위치지정모드(당일입고) 열 설정 (미발과 별도)
// [Ver 7.0] 미발계산기 열: locCheck(위치확인)는 위치지정모드 전용이므로 미발 열에서 제외
function getColumns() { const base = (Array.isArray(columnConfig) && columnConfig.length) ? columnConfig : DEFAULT_COLUMNS; return base.filter(k => k !== 'locCheck'); }
// [Ver 6.8] 보기 모드: 미발계산기(mibal) / 위치지정모드(location)
let viewMode = localStorage.getItem('csgViewMode') || 'mibal';
// [Ver 7.1] 위치지정모드 서브뷰: 당일입고지정(today) / 기존재고지정(existing)
let locSubView = localStorage.getItem('csgLocSub') || 'today';
const LOCATION_COLUMNS = ['no', 'code', 'name', 'option', 'location', 'log:옵션추가항목1', 'locCheck']; // [Ver 8.30] 당일입고 기본 열 (미발재고로그의 옵션추가항목1 헤더값 표시)
// [Ver 8.53] 위치지정모드 열도 설정 가능 (저장값 없으면 기본 LOCATION_COLUMNS)
function getLocationColumns() { return (Array.isArray(locationColumnConfig) && locationColumnConfig.length) ? locationColumnConfig : LOCATION_COLUMNS; }
function getActiveColumns() { return viewMode === 'location' ? getLocationColumns() : getColumns(); }
function applyViewMode() {
    document.body.dataset.view = viewMode;
    const label = document.getElementById('app-title-label');
    const title = document.getElementById('app-title');
    if (label) label.textContent = viewMode === 'location' ? '📍 중국제작 위치지정모드' : '🏭 중국제작 미발계산기';
    if (title) title.style.color = viewMode === 'location' ? '#6a1b9a' : '#333';
    const clr = document.getElementById('btn-date-clear'); // [Ver 7.4] 모드별 초기화 라벨
    if (clr) clr.textContent = viewMode === 'location' ? '🗑️ 위치 초기화' : '🗑️ 미발 초기화';
    if (viewMode === 'location') { ensureLocationHistory(); ensureFloor2(); applyLocSub(); } else renderTable();
}
function applyLocSub() {
    document.body.dataset.locsub = locSubView;
    document.querySelectorAll('.loc-subtab').forEach(b => {
        const on = b.dataset.sub === locSubView;
        b.style.background = on ? '#5e35b1' : '#fff';
        b.style.color = on ? '#fff' : '#5e35b1';
        b.style.boxShadow = on ? 'none' : 'inset 0 0 0 1px #b39ddb';
    });
    if (locSubView === 'existing') { renderLocMoveTable(); renderNewLocPosToggle(); } // 기존재고 인라인 목록
    else applyFilters(); // 당일입고 상품표(위치확인 열) — [Ver 8.75] 비축 대상 필터 재적용
}
// [Ver 8.38] 새 위치 앞/뒤 토글 (기존재고지정) → CONFIG.newLocPosition 저장, 스캐너가 병합 순서로 사용
function renderNewLocPosToggle() {
    const c = document.getElementById('chk-newloc-front');
    if (c) c.checked = (newLocPosition === 'front');
}
async function setNewLocPosition(pos) {
    newLocPosition = (pos === 'front') ? 'front' : 'back';
    renderNewLocPosToggle();
    try { await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { newLocPosition, updatedAt: new Date() }, { merge: true }); } catch (e) {}
    showToast(`🆕 다운로드 시 새 자리가 기존값 ${newLocPosition === 'front' ? '맨앞' : '맨뒤'}에 놓입니다`);
}
function setLocSubView(s) {
    locSubView = (s === 'existing') ? 'existing' : 'today';
    localStorage.setItem('csgLocSub', locSubView);
    applyLocSub();
}
// [Ver 7.2] 파일 다운로드 메뉴의 '옵션추가항목1 다운로드' — 현재 서브뷰에 맞춰 당일/기존재고 다운로드
function openModeSelect() { document.getElementById('mode-select-modal').style.display = 'flex'; }
function closeModeSelect() { document.getElementById('mode-select-modal').style.display = 'none'; }
function setViewMode(m) {
    persistActiveDates();                       // [Ver 8.10] 현재 모드 출고일 저장 (viewMode 아직 이전값)
    viewMode = (m === 'location') ? 'location' : 'mibal';
    columnFilters = {}; // [Ver 8.52] 모드 전환 시 열 필터 초기화
    localStorage.setItem('csgViewMode', viewMode);
    savedDates = (viewMode === 'location') ? [...savedDatesLoc] : [...savedDatesMibal]; // 새 모드 출고일 로드
    closeModeSelect();
    applyViewMode();
    refreshDatesUI();                           // 날짜 UI/표를 새 모드 선택으로 갱신
}
function colLabel(key) {
    if (BUILTIN_COLS[key]) return BUILTIN_COLS[key].label;
    if (key.startsWith('log:')) return key.slice(4);
    return key;
}
function colValue(key, row, idx) {
    if (key === 'no') return idx + 1;
    if (key === 'locCheck') { // [Ver 8.31] 추가위치: 앱이 '당일 입고분'으로 지정한 자리 중 새로 추가된 것만 표시
        const a = locationAssignMap[row.code];
        const news = (a && a.location && (a.sub || '') === 'today') ? renderNewLocOnly(a.location, a.base) : '';
        return news || '<span style="color:#d32f2f; font-weight:bold;">⚠️ 미지정</span>';
    }
    if (BUILTIN_COLS[key]) return (row[key] !== undefined && row[key] !== null) ? row[key] : '';
    if (key.startsWith('log:')) { const log = stockLogData[row.code] || {}; const v = log[key.slice(4)]; return (v !== undefined && v !== null) ? v : ''; }
    return '';
}
function logFieldKeys() {
    for (const c in stockLogData) { return Object.keys(stockLogData[c]); }
    return [];
}
function renderTableHeader(cols) {
    const tr = document.querySelector('.list-table thead tr');
    if (!tr) return;
    tr.innerHTML = cols.map(key => {
        const def = BUILTIN_COLS[key] || {};
        const w = def.width ? `width:${def.width};` : '';
        const canFilter = key !== 'no' && key !== 'locCheck'; // [Ver 8.52] No/추가위치 제외 전부 필터 가능
        const funnel = canFilter ? `<span class="col-filter${columnFilters[key] ? ' active' : ''}" data-key="${key}" title="필터">▾</span>` : '';
        const sortCls = def.sort ? ' th-sortable' : '';
        const sortData = def.sort ? ` data-sort="${def.sort}"` : '';
        return `<th class="th-cell${sortCls}"${sortData} style="${w}"><span class="th-label">${colLabel(key)}</span>${funnel}</th>`;
    }).join('');
    tr.querySelectorAll('.th-sortable').forEach(th => th.addEventListener('click', () => sortTable(th.dataset.sort)));
    tr.querySelectorAll('.col-filter').forEach(f => f.addEventListener('click', (e) => { e.stopPropagation(); openColumnFilter(f.dataset.key, f); })); // [Ver 8.52] 필터 팝업
}
function renderTable() {
    const cols = getActiveColumns();
    renderTableHeader(cols);
    const tbody = document.getElementById('table-body');
    if (!filteredData.length) { tbody.innerHTML = `<tr><td colspan="${cols.length}" style="text-align:center; padding:50px; color:#888;">출고일을 선택하세요.</td></tr>`; return; }
    let html = '';
    filteredData.forEach((row, idx) => {
        const isFromApp = inboundMap[row.code] !== undefined;
        let tds = '';
        cols.forEach(key => {
            const def = BUILTIN_COLS[key] || {};
            const val = colValue(key, row, idx);
            if (def.edit) {
                let style = key === 'capacity' ? 'background:#e3f2fd;' : '';
                let extra = '';
                if (key === 'confirmed') {
                    // [Ver 8.55] 입고확인 누적과 도착수량 비교 → 과입고(빨강)/부족(노랑) 강조 (미입력은 표시 안 함)
                    const conf = parseInt(row.confirmed);
                    const arr = parseInt(row.arrivalQty) || 0;
                    if (!isNaN(conf) && conf > arr) { style += 'background:#ffcdd2; color:#b71c1c; font-weight:900;'; extra = ' title="입고확인 > 도착수량 (과입고) — 입고 수량 확인 필요"'; }
                    else if (!isNaN(conf) && conf > 0 && conf < arr) { style += 'background:#fff59d; color:#6d4c00; font-weight:900;'; extra = ' title="입고확인 < 도착수량 (부족) — 입고 수량 확인 필요"'; }
                    else if (isFromApp) style += 'color:#1976d2; font-weight:900;';
                }
                tds += `<td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="${def.edit}" style="${style}"${extra}>${val}</td>`;
            } else if (def.code) {
                tds += `<td class="code-cell" data-code="${row.code}">${val}</td>`;
            } else {
                tds += `<td>${val}</td>`;
            }
        });
        html += `<tr${row.unregistered ? ' style="background:#fff3e0;"' : ''}>${tds}</tr>`; // [Ver 8.52] 미등록 입고분 강조
    });
    tbody.innerHTML = html;
}

// [Ver 5.5] 열 설정 모달
let colEditList = [];
function openColumnModal() {
    closeAllMenus();
    colEditList = viewMode === 'location' ? [...getLocationColumns()] : [...getColumns()]; // [Ver 8.53] 모드별 열 로드
    const title = document.getElementById('column-modal-title');
    if (title) title.textContent = viewMode === 'location' ? '🔧 표 열(헤더) 설정 — 위치지정(당일입고)' : '🔧 표 열(헤더) 설정 — 미발계산기';
    renderColumnEditor();
    document.getElementById('column-modal').style.display = 'flex';
}
function closeColumnModal() { document.getElementById('column-modal').style.display = 'none'; }
function renderColumnEditor() {
    const box = document.getElementById('column-list');
    if (!box) return;
    const bs = 'border:1px solid #ccc; background:#fff; border-radius:4px; cursor:pointer; width:26px; height:26px; font-weight:bold;';
    box.innerHTML = colEditList.map((key,i) => `
        <div style="display:flex; align-items:center; gap:6px; background:#f5f5f5; padding:6px 8px; border-radius:5px; margin-bottom:5px; font-size:13px;">
            <span style="flex:1; font-weight:bold;">${colLabel(key)}${key.startsWith('log:') ? ' <span style="color:#1976d2; font-size:11px;">(로그)</span>' : ''}</span>
            <button class="col-up" data-i="${i}" ${i===0?'disabled':''} style="${bs}">↑</button>
            <button class="col-down" data-i="${i}" ${i===colEditList.length-1?'disabled':''} style="${bs}">↓</button>
            <button class="col-del" data-i="${i}" style="${bs} color:#d32f2f;">✕</button>
        </div>`).join('');
    const sel = document.getElementById('column-add-select');
    const avail = [];
    // [Ver 8.53] locCheck(추가위치)는 위치지정모드에서만 추가 가능
    Object.keys(BUILTIN_COLS).forEach(k => { if (colEditList.includes(k)) return; if (k === 'locCheck' && viewMode !== 'location') return; avail.push([k, colLabel(k)]); });
    logFieldKeys().forEach(f => { const k = 'log:' + f; if (!colEditList.includes(k)) avail.push([k, f + ' (로그)']); });
    sel.innerHTML = avail.length ? avail.map(([k,l]) => `<option value="${k}">${l}</option>`).join('') : '<option value="">추가할 열 없음</option>';
    box.querySelectorAll('.col-up').forEach(b => b.onclick = () => { const i=+b.dataset.i; if(i>0){ [colEditList[i-1],colEditList[i]]=[colEditList[i],colEditList[i-1]]; renderColumnEditor(); } });
    box.querySelectorAll('.col-down').forEach(b => b.onclick = () => { const i=+b.dataset.i; if(i<colEditList.length-1){ [colEditList[i+1],colEditList[i]]=[colEditList[i],colEditList[i+1]]; renderColumnEditor(); } });
    box.querySelectorAll('.col-del').forEach(b => b.onclick = () => { colEditList.splice(+b.dataset.i,1); renderColumnEditor(); });
}
function addColumnFromSelect() { const v = document.getElementById('column-add-select').value; if (v && !colEditList.includes(v)) { colEditList.push(v); renderColumnEditor(); } }
function resetColumns() { colEditList = viewMode === 'location' ? [...LOCATION_COLUMNS] : [...DEFAULT_COLUMNS]; renderColumnEditor(); } // [Ver 8.53] 모드별 기본값
async function saveColumns() {
    if (!colEditList.length) { alert('열이 하나도 없습니다.'); return; }
    const payload = { updatedAt: new Date() };
    if (viewMode === 'location') { locationColumnConfig = [...colEditList]; payload.locationColumnConfig = locationColumnConfig; } // [Ver 8.53] 위치모드 열은 별도 저장
    else { columnConfig = [...colEditList]; payload.columnConfig = columnConfig; }
    try {
        await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), payload, { merge: true });
        closeColumnModal(); showToast('✅ 열 설정 저장됨'); renderTable();
    } catch (e) { alert('저장 실패: ' + e.message); }
}

function updateSummary() {
    document.getElementById('sum-sku').textContent = filteredData.length;
    document.getElementById('sum-arrival').textContent = filteredData.reduce((s,d)=>s+d.arrivalQty,0);
    // [Ver 8.29] 총 미발수량 카드 = 부족수량 열의 합
    document.getElementById('sum-mibal').textContent = filteredData.reduce((s,d)=>s+(parseInt(d.shortage)||0),0);
}

// ---------------------------------------------------------
// [Ver 8.52] 헤더 열별 필터(엑셀식) + 검색/정렬 공용화
// ---------------------------------------------------------
let columnFilters = {}; // 열key -> 허용값 Set (없으면 필터 없음)
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function filterValueOf(row, key) {
    if (key === 'no' || key === 'locCheck') return '';
    if (key.startsWith('log:')) { const log = stockLogData[row.code] || {}; const v = log[key.slice(4)]; return (v === undefined || v === null) ? '' : String(v); }
    const v = row[key];
    return (v === undefined || v === null) ? '' : String(v);
}
function sortComparator() {
    const key = sortConfig.key, dir = sortConfig.direction;
    return (a, b) => {
        let va = a[key], vb = b[key];
        if (typeof va === 'number' && typeof vb === 'number') return dir === 'asc' ? va - vb : vb - va;
        return dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    };
}
// 검색어 + 열필터를 함께 적용하고 현재 정렬을 유지
function applyFilters() {
    const k = (document.getElementById('search-input')?.value || '').trim().toUpperCase();
    filteredData = tableData.filter(d => {
        if (k && !(String(d.code).toUpperCase().includes(k) || String(d.name || '').toUpperCase().includes(k))) return false;
        for (const key in columnFilters) { const set = columnFilters[key]; if (set && !set.has(filterValueOf(d, key))) return false; }
        return true;
    });
    // [Ver 8.75] 당일입고지정: 비축창고(FLOOR2_STOCK)에 실제 들어가는 상품만 (미발계산기 목록과 분리) — 강제추가분은 유지
    if (viewMode === 'location' && locSubView === 'today') {
        filteredData = filteredData.filter(d => d.unregisteredLoc || (floor2Map[d.code] || 0) > 0);
    }
    if (sortConfig.key) filteredData.sort(sortComparator());
    renderTable(); updateSummary();
}
function applySearch() { applyFilters(); }

function sortTable(key) {
    if (sortConfig.key === key) sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    else { sortConfig.key = key; sortConfig.direction = 'asc'; }
    filteredData.sort(sortComparator());
    renderTable();
}

function closeColumnFilter() { const p = document.getElementById('col-filter-pop'); if (p) p.remove(); }
function openColumnFilter(key, anchorEl) {
    closeColumnFilter();
    const values = [...new Set(tableData.map(r => filterValueOf(r, key)))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    const cur = columnFilters[key]; // Set | undefined
    const pop = document.createElement('div');
    pop.id = 'col-filter-pop'; pop.className = 'col-filter-pop';
    pop.innerHTML =
        '<input type="text" id="cfp-search" placeholder="값 검색..." class="cfp-search">' +
        '<label class="cfp-item cfp-allrow"><input type="checkbox" id="cfp-all"> <b>전체</b></label>' +
        '<div class="cfp-list" id="cfp-list"></div>' +
        '<div class="cfp-btns"><button id="cfp-clear">필터해제</button><button id="cfp-cancel">취소</button><button id="cfp-apply" class="primary">적용</button></div>';
    document.body.appendChild(pop);
    pop.addEventListener('click', e => e.stopPropagation());
    const rect = anchorEl.getBoundingClientRect();
    pop.style.top = Math.min(rect.bottom + 4, window.innerHeight - 330) + 'px';
    pop.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - 244)) + 'px';
    const cbs = () => Array.from(document.querySelectorAll('#cfp-list .cfp-cb'));
    const syncAll = () => { const list = cbs(); const all = document.getElementById('cfp-all'); if (all) all.checked = list.length > 0 && list.every(c => c.checked); };
    document.getElementById('cfp-list').innerHTML = values.map((v, i) => {
        const label = v === '' ? '(빈값)' : v;
        const checked = (!cur || cur.has(v)) ? 'checked' : '';
        return `<label class="cfp-item" data-label="${escapeHtml(String(label).toLowerCase())}"><input type="checkbox" class="cfp-cb" data-i="${i}" ${checked}> ${escapeHtml(label)}</label>`;
    }).join('') || '<div style="padding:8px;color:#888;font-size:12px;">값 없음</div>';
    syncAll();
    document.getElementById('cfp-search').addEventListener('input', e => {
        const f = e.target.value.toLowerCase();
        document.querySelectorAll('#cfp-list .cfp-item').forEach(el => { el.style.display = (!f || (el.dataset.label || '').includes(f)) ? '' : 'none'; });
    });
    document.getElementById('cfp-all').addEventListener('change', e => { cbs().forEach(c => c.checked = e.target.checked); });
    document.getElementById('cfp-list').addEventListener('change', e => { if (e.target.classList.contains('cfp-cb')) syncAll(); });
    document.getElementById('cfp-cancel').onclick = () => closeColumnFilter();
    document.getElementById('cfp-clear').onclick = () => { delete columnFilters[key]; closeColumnFilter(); applyFilters(); };
    document.getElementById('cfp-apply').onclick = () => {
        const checkedVals = new Set(cbs().filter(c => c.checked).map(c => values[+c.dataset.i]));
        if (checkedVals.size >= values.length) delete columnFilters[key]; // 전부 선택이면 필터 없음
        else columnFilters[key] = checkedVals;
        closeColumnFilter(); applyFilters();
    };
}

// ---------------------------------------------------------
// 스캐너 앱 연동 (입고앱실행 / 설치 안내)
//  - scan.html은 같은 저장소의 config.js를 쓰므로 서버가 자동으로 일치함
//    → 관리자 페이지에서는 config.js만 바꾸면 자동으로 관리자 서버로 연결됨
// ---------------------------------------------------------
const INSTALL_PAGE = new URL('app-install.html', location.href).href;

// [Ver 3.4] 입고앱실행 = 웹 스캐너 페이지 열기 (아이폰/안드로이드 공용, 설치 불필요) — 모바일 게이트에서 사용
function openInScannerApp() {
    closeAllMenus();
    window.open(new URL('scan.html', location.href).href, '_blank');
}

// ---------------------------------------------------------
// [Ver 8.34] 미발전송: 출고일별(패킹) 미발수량 스냅샷 누적 → MIBAL_HISTORY 단일 문서
//   record 키 "출고일|전송날짜" : {출고일, 입고일, 미발수량, 전송날짜}
//   평균상승률 = 패킹별 (입고일시점미발 - 출고시점미발)/출고시점미발 의 평균 (화면 계산, 저장 안 함)
// ---------------------------------------------------------
let mibalHistory = {};
function todayISO() { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
async function loadMibalHistory() {
    try { const s = await getDoc(doc(db, CHINA_COLLECTION, 'MIBAL_HISTORY')); mibalHistory = (s.exists() && s.data().map) ? s.data().map : {}; } catch (e) { mibalHistory = {}; }
}
function computeAvgRise() {
    const byShip = {};
    Object.values(mibalHistory).forEach(r => { if (r && r.출고일) (byShip[r.출고일] = byShip[r.출고일] || []).push(r); });
    const rates = [];
    Object.values(byShip).forEach(recs => {
        recs.sort((a, b) => String(a.전송날짜).localeCompare(String(b.전송날짜)));
        const 입고일 = (recs.find(r => r.입고일) || {}).입고일 || ''; // [Ver 8.54] 여러 전송 중 입고일이 채워진 것 우선 (초기 전송 때 입고일 미확정이면 빈 값이라 옛 코드는 계속 '미정'으로 굳음)
        const before = recs.find(r => !입고일 || String(r.전송날짜) < 입고일);       // 출고(입고 전) 시점
        const arr = 입고일 ? recs.find(r => String(r.전송날짜) >= 입고일) : null;      // 입고일 시점
        if (!before || !arr) return;
        const a = parseInt(before.미발수량) || 0, b = parseInt(arr.미발수량) || 0;
        if (a <= 0) return;
        const rate = (b - a) / a;
        if (rate >= 0.01 && rate <= 1.00) rates.push(rate); // [Ver 8.37] 시트 AVERAGEIFS(1~100%)와 동일: 이상치 제외
    });
    return rates.length ? { avg: rates.reduce((s, x) => s + x, 0) / rates.length, n: rates.length } : null;
}
function renderAvgRise() {
    const el = document.getElementById('avg-rise'); if (!el) return;
    const r = computeAvgRise();
    el.textContent = r ? `평균상승률 ${r.avg >= 0 ? '+' : ''}${Math.round(r.avg * 100)}% (${r.n}건)` : '평균상승률 –';
}
// [Ver 8.36] 누적 데이터 → 패킹(출고일)별 예측 행 생성
function buildPredictionRows() {
    const byShip = {};
    Object.values(mibalHistory).forEach(r => { if (r && r.출고일) (byShip[r.출고일] = byShip[r.출고일] || []).push(r); });
    const avg = computeAvgRise();
    const useRate = avg ? avg.avg : 0.4; // 데이터 없으면 기본 40%
    const rows = [];
    Object.keys(byShip).forEach(출고일 => {
        const recs = byShip[출고일].slice().sort((a, b) => String(a.전송날짜).localeCompare(String(b.전송날짜)));
        const 입고일 = (recs.find(r => r.입고일) || {}).입고일 || ''; // [Ver 8.54] 여러 전송 중 입고일이 채워진 것 우선 (초기 전송 때 입고일 미확정이면 빈 값이라 옛 코드는 계속 '미정'으로 굳음)
        const before = recs.find(r => !입고일 || String(r.전송날짜) < 입고일) || recs[0];
        const 출고미발 = parseInt(before.미발수량) || 0;
        const arrRec = 입고일 ? recs.find(r => String(r.전송날짜) >= 입고일) : null;
        const 입고미발 = arrRec ? (parseInt(arrRec.미발수량) || 0) : null;
        const 상승률 = (입고미발 !== null && 출고미발 > 0) ? (입고미발 - 출고미발) / 출고미발 : null;
        const 예상미발 = Math.round(출고미발 * (1 + useRate));
        const 예측편차 = (입고미발 !== null) ? (입고미발 - 예상미발) : null;
        rows.push({ 출고일, 입고일, 출고미발, 입고미발, 상승률, 예상미발, 예측편차 });
    });
    rows.sort((a, b) => String(b.출고일).localeCompare(String(a.출고일)));
    return { rows, useRate, avg };
}
async function openMibalPredictModal() {
    closeAllMenus();
    await loadMibalHistory();
    renderAvgRise();
    renderMibalPredict();
    document.getElementById('mibal-predict-modal').style.display = 'flex';
}
function closeMibalPredictModal() { document.getElementById('mibal-predict-modal').style.display = 'none'; }
function renderMibalPredict() {
    const { rows, useRate, avg } = buildPredictionRows();
    const sum = document.getElementById('mp-summary');
    if (sum) sum.innerHTML = `평균상승률 <b style="color:#4527a0;">${avg ? (avg.avg >= 0 ? '+' : '') + Math.round(avg.avg * 100) + '% (' + avg.n + '건, 1~100%만)' : '– (데이터 부족, 기본 40% 적용)'}</b> · 예측 배율 <b>×${(1 + useRate).toFixed(2)}</b> · 누적 패킹 <b>${rows.length}건</b>`;
    const kw = (document.getElementById('mp-search')?.value || '').trim();
    const view = kw ? rows.filter(r => (fmtMD(r.출고일).includes(kw) || fmtMD(r.입고일).includes(kw) || r.출고일.includes(kw) || (r.입고일 || '').includes(kw))) : rows;
    const tb = document.getElementById('mp-tbody'); if (!tb) return;
    const pct = v => (v === null) ? '–' : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
    const dev = v => (v === null) ? '<span style="color:#999;">진행중</span>' : `<span style="color:${v > 0 ? '#c62828' : (v < 0 ? '#1565c0' : '#333')}; font-weight:bold;">${v > 0 ? '+' : ''}${v}</span>`;
    tb.innerHTML = view.length ? view.map(r => `
        <tr style="border-bottom:1px solid #eee;">
            <td style="padding:7px 6px; font-weight:bold;">${fmtMD(r.출고일)}</td>
            <td style="padding:7px 6px;">${r.입고일 ? fmtMD(r.입고일) : '<span style="color:#999;">미정</span>'}</td>
            <td style="padding:7px 6px;">${r.출고미발}</td>
            <td style="padding:7px 6px; font-weight:bold;">${r.입고미발 === null ? '<span style="color:#999;">진행중</span>' : r.입고미발}</td>
            <td style="padding:7px 6px; color:#e65100; font-weight:bold;">${pct(r.상승률)}</td>
            <td style="padding:7px 6px; color:#5e35b1; font-weight:bold;">${r.예상미발}</td>
            <td style="padding:7px 6px;">${dev(r.예측편차)}</td>
        </tr>`).join('') : '<tr><td colspan="7" style="padding:22px; color:#999;">전송된 미발 데이터가 없습니다. 미발전송을 눌러 쌓으세요.</td></tr>';
}
async function downloadMibalPredict() {
    const { rows } = buildPredictionRows();
    if (!rows.length) { alert('내려받을 데이터가 없습니다.'); return; }
    const aoa = [['출고일', '입고일', '출고미발', '입고미발', '상승률', '예상미발', '예측편차']];
    rows.forEach(r => aoa.push([r.출고일, r.입고일 || '', r.출고미발, (r.입고미발 === null ? '' : r.입고미발), (r.상승률 === null ? '' : Math.round(r.상승률 * 100) + '%'), r.예상미발, (r.예측편차 === null ? '' : r.예측편차)]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'worksheet');
    const wbout = XLSX.write(wb, { bookType: 'biff8', type: 'array' });
    await downloadToDesktop('미발예측데이터.xls', new Blob([wbout], { type: 'application/vnd.ms-excel' }));
}
async function sendMibal() {
    if (viewMode === 'location') { alert('미발전송은 미발계산기 모드에서 사용하세요.'); return; }
    if (!savedDates.length) { alert('출고일을 하나 이상 선택하세요.'); return; }
    if (!filteredData.length) { alert('표에 데이터가 없습니다. 출고일을 확인하세요.'); return; }
    const 미발수량 = filteredData.reduce((s, d) => s + (parseInt(d.shortage) || 0), 0);
    const 전송날짜 = todayISO();
    // [Ver 8.35] 선택된 출고일마다 동일 미발수량으로 각각 기록 (같은날 여러 출고일 입고 대응, 제한 없음)
    const dupes = savedDates.filter(o => mibalHistory[`${o}|${전송날짜}`]);
    if (dupes.length && !confirm(`오늘(${전송날짜}) 이미 전송한 출고일 ${dupes.length}건이 있습니다.\n미발수량 ${미발수량}(으)로 덮어쓸까요?`)) return;
    const update = {};
    savedDates.forEach(출고일 => {
        const 입고일 = (arrivalByShip[출고일] && arrivalByShip[출고일][0]) || '';
        const key = `${출고일}|${전송날짜}`;
        const rec = { 출고일, 입고일, 미발수량, 전송날짜 };
        mibalHistory[key] = rec; update[key] = rec;
    });
    try {
        await setDoc(doc(db, CHINA_COLLECTION, 'MIBAL_HISTORY'), { map: update, updatedAt: new Date() }, { merge: true });
        renderAvgRise();
        showToast(`📤 미발전송 완료 · 출고일 ${savedDates.length}건 · 미발 ${미발수량}`);
    } catch (e) { alert('전송 실패: ' + e.message); }
}

// [Ver 8.11] 모바일 접속 시: 페이지 대신 '입고앱 실행하시겠습니까?' 안내 → 바로 스캐너 열기
function setupMobileGate() {
    const isMobile = /Android|iPhone|iPod|Mobile|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const gate = document.getElementById('mobile-gate');
    if (!isMobile || !gate) return;
    gate.style.display = 'flex';
    document.getElementById('mg-open-scan')?.addEventListener('click', () => { location.href = new URL('scan.html', location.href).href; });
    document.getElementById('mg-open-web')?.addEventListener('click', () => { gate.style.display = 'none'; });
}

// ---------------------------------------------------------
// [Ver 3.3] 버전 체크
//  - version.json이 배포의 기준 버전 (web: 페이지, app: 스캐너 앱)
//  - 웹: 열려있는 탭이 구버전이면 새로고침 배너 표시
//  - 앱: 최신 앱 버전을 APP_META 문서로 게시 → 앱이 시작 시 확인해 업데이트 유도
// ---------------------------------------------------------
const WEB_VERSION = '8.75';
let lastVersionCheck = 0;

async function fetchVersionInfo() {
    try {
        const res = await fetch(new URL('version.json', location.href).href + '?_=' + Date.now(), { cache: 'no-store' }); // [Ver 8.47] ?_=시각으로 CDN(Fastly) 캐시 우회 — no-store만으로는 max-age=600 CDN 캐시를 못 뚫어 배너가 최대 10분 지연/누락됨
        return await res.json();
    } catch (e) { return null; }
}

function showUpdateBanner(newVer) {
    if (document.getElementById('update-banner')) return;
    const div = document.createElement('div');
    div.id = 'update-banner';
    div.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:#e65100;color:#fff;z-index:999998;padding:12px;text-align:center;font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    div.textContent = `🔄 새 버전(Ver ${newVer})이 배포되었습니다. `;
    const btn = document.createElement('button');
    btn.textContent = '지금 새로고침';
    btn.style.cssText = 'margin-left:10px;padding:6px 16px;border:none;border-radius:5px;background:#fff;color:#e65100;font-weight:bold;cursor:pointer;';
    btn.onclick = () => location.reload();
    div.appendChild(btn);
    document.body.appendChild(div);
}

async function checkVersion(publishAppMeta = false) {
    const now = Date.now();
    if (now - lastVersionCheck < 60000) return; // 최소 1분 간격
    lastVersionCheck = now;
    const info = await fetchVersionInfo();
    if (!info) return;
    if (info.web && info.web !== WEB_VERSION) showUpdateBanner(info.web);
    if (publishAppMeta && info.app) {
        try {
            await setDoc(doc(db, CHINA_COLLECTION, 'APP_META'), {
                latestVersion: info.app,
                installUrl: INSTALL_PAGE,
                updatedAt: new Date()
            }, { merge: true });
        } catch (e) { console.error('APP_META 게시 실패:', e); }
    }
}

// ---------------------------------------------------------
// Firebase 설정 로직
// ---------------------------------------------------------
async function loadConfig() { const snap = await getDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC)); if (snap.exists()) { const c = snap.data(); csvUrlOrder = c.csvUrlOrder || ''; csvUrlBuy = c.csvUrlBuy || ''; savedDatesMibal = Array.isArray(c.savedDatesMibal) ? c.savedDatesMibal : (Array.isArray(c.savedDates) ? c.savedDates : []); savedDatesLoc = Array.isArray(c.savedDatesLoc) ? c.savedDatesLoc : []; savedDates = (viewMode === 'location') ? [...savedDatesLoc] : [...savedDatesMibal]; mibalFormula = c.mibalFormula || DEFAULT_MIBAL_FORMULA; mibalVars = sanitizeMibalVars(c.mibalVars); MIBAL_COMPUTED_VARS.forEach(v => { if (!mibalVars.includes(v)) mibalVars.push(v); }); /* [Ver 8.25] 도착수량 등 계산변수는 기본공식에 쓰이므로 항상 포함 */ mibalFn = compileMibalFormula(mibalFormula) || compileMibalFormula(DEFAULT_MIBAL_FORMULA); zoneCapacity = c.zoneCapacity || {}; columnConfig = Array.isArray(c.columnConfig) ? c.columnConfig : null; locationColumnConfig = Array.isArray(c.locationColumnConfig) ? c.locationColumnConfig : null; graceDays = (c.graceDays !== undefined && c.graceDays !== null) ? (parseInt(c.graceDays) || 0) : 1; newLocPosition = (c.newLocPosition === 'front') ? 'front' : 'back'; } }
async function saveConfig() { persistActiveDates(); await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { csvUrlOrder, csvUrlBuy, savedDatesMibal, savedDatesLoc, updatedAt: new Date() }, { merge: true }); }
async function loadEditedCells() { const snap = await getDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS')); if (snap.exists()) editedCells = snap.data().cells || {}; }
async function saveEditedCells() { await setDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'), { cells: editedCells }); }
async function loadStockLogFromFirebase() { const snap = await getDocs(collection(db, CHINA_COLLECTION + '_StockLog')); snap.forEach(d => { if(d.data().dataStr) JSON.parse(d.data().dataStr).forEach(r => { const c = (r['상품코드']||'').trim(); if(c) stockLogData[c] = r; }); }); }

// ---------------------------------------------------------
// 이벤트 바인딩 (체크리스트 기반 완전 복원)
// ---------------------------------------------------------
function setupEventListeners() {
    // 1. #btn-toggle-menu (환경설정 토글)
    document.getElementById('btn-toggle-menu')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const dl = document.getElementById('download-menu'); if (dl) dl.style.display = 'none';
        const m = document.getElementById('main-tools-menu');
        m.style.display = m.style.display === 'block' ? 'none' : 'block';
    });

    // 2. #main-tools-menu (메뉴 내부 클릭 전파 방지)
    document.getElementById('main-tools-menu')?.addEventListener('click', (e) => e.stopPropagation());

    // 1-2. [Ver 5.9] #btn-toggle-download (작업 메뉴 = 다운로드 드롭다운)
    document.getElementById('btn-toggle-download')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = document.getElementById('main-tools-menu'); if (menu) menu.style.display = 'none';
        const m = document.getElementById('download-menu');
        m.style.display = m.style.display === 'block' ? 'none' : 'block';
    });
    document.getElementById('download-menu')?.addEventListener('click', (e) => e.stopPropagation());

    // 3. document click (메뉴 닫기)
    document.addEventListener('click', () => closeAllMenus());

    // 5. #btn-open-sheet-settings (CSV 링크 설정 모달 열기)
    document.getElementById('btn-open-sheet-settings')?.addEventListener('click', () => openSheetSettingsModal());


    // 7. #upload-stock-log (미발재고로그 업로드)
    document.getElementById('upload-stock-log')?.addEventListener('change', (e) => handleStockLogUpload(e));
    // 7-2. #upload-location-map (위치 매핑 업로드 - Ver 5.8)
    document.getElementById('upload-location-map')?.addEventListener('change', (e) => handleLocationMapUpload(e));
    // [Ver 8.32] 오류바코드매칭
    document.getElementById('btn-open-barcode-alias')?.addEventListener('click', () => openBarcodeAliasModal());
    document.getElementById('btn-barcode-alias-close')?.addEventListener('click', () => closeBarcodeAliasModal());
    document.getElementById('barcode-alias-modal')?.addEventListener('click', (e) => { if (e.target.id === 'barcode-alias-modal') closeBarcodeAliasModal(); });
    document.getElementById('upload-barcode-alias')?.addEventListener('change', (e) => handleBarcodeAliasUpload(e));
    document.getElementById('btn-barcode-alias-download')?.addEventListener('click', () => downloadBarcodeAlias());
    document.getElementById('btn-ba-add')?.addEventListener('click', () => addBarcodeAliasManual());
    document.getElementById('ba-search')?.addEventListener('input', () => renderBarcodeAliasList());
    document.getElementById('ba-barcode')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('ba-code')?.focus(); });
    document.getElementById('ba-code')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBarcodeAliasManual(); });
    document.getElementById('btn-barcode-alias-clear')?.addEventListener('click', async () => { if (Object.keys(barcodeAlias).length && confirm('오류바코드매칭을 전부 삭제할까요? (되돌릴 수 없습니다)')) { barcodeAlias = {}; await saveBarcodeAlias(); renderBarcodeAliasList(); showToast('🗑️ 전체 삭제됨'); } });
    // [Ver 8.62] 위치매핑 관리 모달
    document.getElementById('btn-open-location-map')?.addEventListener('click', () => openLocationMapModal());
    document.getElementById('btn-location-map-close')?.addEventListener('click', () => closeLocationMapModal());
    document.getElementById('location-map-modal')?.addEventListener('click', (e) => { if (e.target.id === 'location-map-modal') closeLocationMapModal(); });
    document.getElementById('btn-locmap-download')?.addEventListener('click', () => downloadLocationMap());
    document.getElementById('btn-locmap-add')?.addEventListener('click', () => addLocationMapManual());
    document.getElementById('locmap-search')?.addEventListener('input', () => renderLocationMapList());
    document.getElementById('locmap-code')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('locmap-loc')?.focus(); });
    document.getElementById('locmap-loc')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addLocationMapManual(); });
    document.getElementById('btn-locmap-clear')?.addEventListener('click', async () => { if (Object.keys(locationMapData).length && confirm('위치매핑을 전부 삭제할까요? (되돌릴 수 없습니다)')) { locationMapData = {}; await saveLocationMapDoc(); renderLocationMapList(); showToast('🗑️ 전체 삭제됨'); } });
    // 7-3. #upload-existing-loc (기존재고 옵션추가항목1 시드 업로드 - Ver 6.5)
    document.getElementById('upload-existing-loc')?.addEventListener('change', (e) => handleExistingLocUpload(e));


    // 9. #btn-date-clear (전체 초기화 - 입고이력/전체데이터 초기화 통합, Ver 4.4)
    document.getElementById('btn-date-clear')?.addEventListener('click', clearAllData);

    // 10. #btn-excel-download (입고용파일다운로드: 상품코드 + 수량)
    document.getElementById('btn-excel-download')?.addEventListener('click', async () => {
        if (!filteredData.length) return;
        let html = '<table><tr><th>상품코드</th><th>수량</th></tr>';
        filteredData.forEach(r => html += `<tr><td>${r.code}</td><td>${r.arrivalQty}</td></tr>`);
        html += '</table>';
        const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel' });
        await downloadToDesktop('입고용파일.xls', blob);
    });

    // 10-2. #btn-mibal-download (미발확인파일다운로드: 상품코드 1열, 진짜 .xls 바이너리)
    //  - 이지어드민 업로드용. HTML 위장(.xls)이 아니라 SheetJS로 실제 BIFF8(OLE2) 파일 생성
    //  - 통합 문서1.xls 와 동일 형식(시트명 worksheet, 헤더 '상품코드')
    document.getElementById('btn-mibal-download')?.addEventListener('click', async () => {
        if (!filteredData.length) return;
        const aoa = [['상품코드']];
        filteredData.forEach(r => aoa.push([r.code]));
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'worksheet');
        const wbout = XLSX.write(wb, { bookType: 'biff8', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.ms-excel' });
        await downloadToDesktop('미발확인파일.xls', blob);
    });
    // [Ver 8.42] 비축창고 엑셀저장 (초기화는 미발 초기화 시 함께 - Ver 8.44)
    document.getElementById('btn-floor2-download')?.addEventListener('click', () => downloadFloor2());

    // 10-3. [Ver 8.16] 옵션추가항목1 다운로드는 서브뷰별 인라인 버튼으로 분리 (당일=btn-loc-download-today, 기존=btn-locmove-download)

    // [Ver 6.8→7.1] 모드 선택 (제목 클릭) + 위치지정모드 서브탭(당일/기존) + 당일 다운로드
    document.getElementById('app-title')?.addEventListener('click', openModeSelect);
    document.getElementById('btn-mode-close')?.addEventListener('click', closeModeSelect);
    document.getElementById('mode-select-modal')?.addEventListener('click', (e) => { if (e.target.id === 'mode-select-modal') closeModeSelect(); });
    document.querySelectorAll('.mode-card').forEach(c => c.addEventListener('click', () => setViewMode(c.dataset.mode)));
    document.querySelectorAll('.loc-subtab').forEach(b => b.addEventListener('click', () => setLocSubView(b.dataset.sub)));
    document.getElementById('btn-loc-download-today')?.addEventListener('click', () => downloadDayLoc());
    applyViewMode(); // 저장된 모드 초기 적용

    // 11. #search-input (검색)
    document.getElementById('search-input')?.addEventListener('input', applySearch);

    // 12. .th-sortable (정렬) → [Ver 5.5] 헤더가 동적 생성되어 renderTableHeader에서 바인딩

    // 13. #table-body focusout (셀 편집)
    document.getElementById('table-body')?.addEventListener('focusout', (e) => { 
        if (e.target.classList.contains('editable-cell')) {
            const code = e.target.dataset.code; const field = e.target.dataset.field; const value = e.target.textContent.trim();
            if (!editedCells[code]) editedCells[code] = {}; editedCells[code][field] = value;
            clearTimeout(saveTimeout); saveTimeout = setTimeout(() => { saveEditedCells(); showToast('💾 자동 저장됨'); }, 1000);
            // [Ver 5.4] 미발수량에 영향 주는 값(적재량/부족수량/직진배송)은 즉시 재계산
            if (['capacity','shortage','directShip'].includes(field)) recomputeRow(code);
        }
    });

    // 14. #table-body click (코드 복사)
    document.getElementById('table-body')?.addEventListener('click', (e) => { 
        if (e.target.classList.contains('code-cell')) {
            const code = e.target.dataset.code; 
            if (code) navigator.clipboard.writeText(code).then(() => showToast(`📋 ${code} 복사됨`));
        }
    });

    // 15. #btn-sheet-cancel (모달 취소)
    document.getElementById('btn-sheet-cancel')?.addEventListener('click', () => closeSheetSettingsModal());

    // 16. #btn-sheet-save (모달 저장)
    document.getElementById('btn-sheet-save')?.addEventListener('click', () => saveSheetSettings());

    // 17. #sheet-settings-modal (모달 바깥 클릭 닫기)
    document.getElementById('sheet-settings-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'sheet-settings-modal') closeSheetSettingsModal();
    });

    // 18. #sheet-settings-modal .modal-content (전파 방지)
    document.querySelector('#sheet-settings-modal .modal-content')?.addEventListener('click', (e) => e.stopPropagation());

    // [Ver 5.1] 미발수량 규칙 설정 모달 (예시 / 규칙 조립 / 직접 입력)
    document.getElementById('btn-open-mibal-formula')?.addEventListener('click', () => openMibalFormulaModal());
    document.getElementById('btn-mibal-cancel')?.addEventListener('click', () => closeMibalFormulaModal());
    // 예시 모드
    document.getElementById('btn-ex-add')?.addEventListener('click', () => { exampleRows.push({ s:0, c:20, sh:0, d:0, want:'' }); buildExampleRows(); });
    document.getElementById('btn-ex-copy')?.addEventListener('click', () => copyExamples());
    document.getElementById('btn-example-apply')?.addEventListener('click', () => applyFromExamples());
    // [Ver 7.5] 규칙 변수(재고로그 헤더) 추가
    document.getElementById('btn-mibal-var-add')?.addEventListener('click', () => addMibalVar());
    // 규칙 조립 모드 — [Ver 8.22] 드롭존은 작업대: 끌어다 놓은 토큰을 순서대로 쌓아 하나의 조건을 만듦
    const addZone = document.getElementById('rule-add-zone');
    if (addZone) {
        addZone.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; addZone.style.background = '#e3f2fd'; addZone.style.borderColor = '#1976d2'; });
        addZone.addEventListener('dragleave', () => { addZone.style.background = '#f5faff'; addZone.style.borderColor = '#90caf9'; });
        addZone.addEventListener('drop', e => {
            e.preventDefault(); addZone.style.background = '#f5faff'; addZone.style.borderColor = '#90caf9';
            addDraftToken(e.dataTransfer.getData('text/plain'));
        });
    }
    document.getElementById('btn-builder-apply')?.addEventListener('click', () => applyFromBuilder());
    document.getElementById('mibal-formula-modal')?.addEventListener('click', (e) => { if (e.target.id === 'mibal-formula-modal') closeMibalFormulaModal(); });
    document.querySelector('#mibal-formula-modal .modal-content')?.addEventListener('click', (e) => e.stopPropagation());

    // [Ver 5.4] 적재량 구역별 일괄 설정 모달
    document.getElementById('btn-open-grace')?.addEventListener('click', () => openGraceSetting()); // [Ver 8.6] 본사도착 유예
    document.getElementById('btn-open-zone-cap')?.addEventListener('click', () => openZoneCapModal());
    document.getElementById('btn-zone-cancel')?.addEventListener('click', () => closeZoneCapModal());
    document.getElementById('btn-zone-save')?.addEventListener('click', () => saveZoneCap());
    document.getElementById('zone-cap-modal')?.addEventListener('click', (e) => { if (e.target.id === 'zone-cap-modal') closeZoneCapModal(); });
    document.querySelector('#zone-cap-modal .modal-content')?.addEventListener('click', (e) => e.stopPropagation());

    // [Ver 5.5] 표 열(헤더) 설정 모달
    document.getElementById('btn-open-column')?.addEventListener('click', () => openColumnModal());
    document.getElementById('btn-open-column-loc')?.addEventListener('click', () => openColumnModal()); // [Ver 8.53] 위치지정모드 열 설정
    document.getElementById('btn-column-cancel')?.addEventListener('click', () => closeColumnModal());
    document.getElementById('btn-column-save')?.addEventListener('click', () => saveColumns());
    document.getElementById('btn-column-reset')?.addEventListener('click', () => resetColumns());
    document.getElementById('btn-column-add')?.addEventListener('click', () => addColumnFromSelect());
    document.getElementById('column-modal')?.addEventListener('click', (e) => { if (e.target.id === 'column-modal') closeColumnModal(); });
    document.querySelector('#column-modal .modal-content')?.addEventListener('click', (e) => e.stopPropagation());

    // [Ver 6.1→7.1] 기존재고지정 인라인 패널 (다운로드/초기화/검색)
    document.getElementById('btn-locmove-download')?.addEventListener('click', () => downloadLocMove());
    document.getElementById('btn-locmove-reset')?.addEventListener('click', () => resetLocMove());
    document.getElementById('chk-newloc-front')?.addEventListener('change', (e) => setNewLocPosition(e.target.checked ? 'front' : 'back')); // [Ver 8.40]
    document.getElementById('lm-search')?.addEventListener('input', () => renderLocMoveTable());



    // 21. 출고일 드롭다운 관련 바인딩
    document.getElementById('btn-date-dropdown')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = document.getElementById('date-dropdown-popup');
        if (p.style.display === 'block') {
            p.style.display = 'none';
            onDatePopupClosed(); // [Ver 3.1] 버튼으로 닫아도 적용
        } else {
            snapshotDateSelection(); // 열 때의 선택 상태 기억
            p.style.display = 'block';
        }
    });
    // [Ver 3.1] 팝업 내부 클릭이 문서 클릭(메뉴 닫기)으로 전파되지 않게 차단
    document.getElementById('date-dropdown-popup')?.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('btn-date-all')?.addEventListener('click', () => {
        document.querySelectorAll('.date-check').forEach(ck => ck.checked = true);
        updateSavedDatesFromCheckboxes(); renderSelectedTags();
    });
    document.getElementById('btn-date-none')?.addEventListener('click', () => {
        document.querySelectorAll('.date-check').forEach(ck => ck.checked = false);
        updateSavedDatesFromCheckboxes(); renderSelectedTags();
    });

    // 22. 스캐너 앱 연동 (입고앱실행 / 설치 안내)
    document.getElementById('btn-mibal-send')?.addEventListener('click', () => sendMibal()); // [Ver 8.34]
    // [Ver 8.36] 미발예측
    document.getElementById('btn-mibal-predict')?.addEventListener('click', () => openMibalPredictModal());
    document.getElementById('btn-mibal-predict-close')?.addEventListener('click', () => closeMibalPredictModal());
    document.getElementById('mibal-predict-modal')?.addEventListener('click', (e) => { if (e.target.id === 'mibal-predict-modal') closeMibalPredictModal(); });
    document.getElementById('mp-search')?.addEventListener('input', () => renderMibalPredict());
    document.getElementById('btn-mp-download')?.addEventListener('click', () => downloadMibalPredict());

    // ========= 바인딩 체크리스트 =========
    // 1. #btn-toggle-menu [OK]
    // 2. #main-tools-menu [OK]
    // 3. document click [OK]
    // 5. #btn-open-sheet-settings [OK]
    // 7. #upload-stock-log [OK]
    // 9. #btn-date-clear [OK] → 전체 초기화(clearAllData)로 통합
    // 10. #btn-excel-download [OK]
    // 11. #search-input [OK]
    // 12. .th-sortable [OK]
    // 13. #table-body focusout [OK]
    // 14. #table-body click [OK]
    // 15. #btn-sheet-cancel [OK]
    // 16. #btn-sheet-save [OK]
    // 17. #sheet-settings-modal [OK]
    // 18. #sheet-settings-modal .modal-content [OK]
    // 21. 출고일 드롭다운 관련 [OK]
    // =====================================
}

async function init() {
    setupMobileGate(); // [Ver 8.11] 모바일이면 입고앱 실행 안내 먼저
    setupEventListeners();
    loadInboundHistory();
    // [Ver 7.9] 위치 구독은 위치지정모드 진입 시에만(setupEventListeners의 applyViewMode → ensureLocationHistory) → 미발 접속은 위치 2천건 읽기 0
    // [Ver 3.3] 버전 체크: 로드 시 1회(앱 최신버전 게시 포함) + 10분 간격 + 창 복귀 시
    checkVersion(true);
    setInterval(() => checkVersion(false), 10 * 60 * 1000);
    window.addEventListener('focus', () => checkVersion(false));
    try {
        await loadConfig();
        renderTable(); // [Ver 5.5] 저장된 열 순서로 헤더 먼저 반영
        await Promise.all([loadEditedCells(), loadStockLogFromFirebase(), syncOrderData(true), loadMibalHistory()]);
        renderAvgRise(); // [Ver 8.34] 평균상승률 표시
        renderNewLocPosToggle(); // [Ver 8.38] 새 위치 앞/뒤 토글 상태 반영
        if(savedDates.length > 0) {
            updateSavedDatesFromCheckboxes(); 
            renderSelectedTags();
            applyDates();
        }
    } catch(e) { console.error(e); }
}
init();

// 전역 스코프 노출
window.handleStockLogUpload = handleStockLogUpload;
