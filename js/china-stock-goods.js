// === js/china-stock-goods.js ===
// 중국제작 미발계산기 Ver 2.1 (최종 통합본)

import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, writeBatch, deleteDoc, onSnapshot, query } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const CHINA_COLLECTION = 'ChinaStockGoods';
const CONFIG_DOC = 'CONFIG';

// 전역 상태
let orderDataOriginal = [];
let orderDataBuy = [];
let stockLogData = {};
let tableData = [];
let filteredData = [];
let editedCells = {};
let inboundMap = {}; // 앱 수신 실시간 합산 데이터
let sortConfig = { key: '', direction: 'asc' };
let csvUrlOrder = '';
let csvUrlBuy = '';
let savedDates = []; 
let saveTimeout = null;

// 유틸리티
const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
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
function getCapacityByLocation(locStr) {
    if (!locStr) return 0;
    const ch = locStr.toString().trim().toUpperCase().charAt(0);
    const map = { 'A':20,'B':20,'C':20,'D':20,'E':40,'F':40,'G':40,'H':15,'I':15,'Z':15,'L':15,'O':15,'P':15,'Q':15,'R':15,'S':15,'T':15 };
    return locStr.includes('★') ? 90 : (map[ch] || 0);
}
function closeAllMenus() {
    const menu = document.getElementById('main-tools-menu'); if (menu) menu.style.display = 'none';
    const popup = document.getElementById('date-dropdown-popup'); if (popup) popup.style.display = 'none';
}

// ---------------------------------------------------------
// [Ver 2.0] 입고 히스토리 실시간 수신
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
        if (tableData.length > 0) {
            applyDates(); // 데이터 갱신 시 테이블 재계산 및 렌더링
        }
    });
}

// ---------------------------------------------------------
// [Ver 2.1] 입고 이력 초기화
// ---------------------------------------------------------
async function clearInboundHistory() {
    if (!confirm("입고 이력을 초기화하시겠습니까?\n(앱에서 전송된 모든 입고 기록이 삭제됩니다.)")) return;
    showLoading('🗑️ 입고 이력 삭제 중...');
    try {
        const snap = await getDocs(collection(db, 'ChinaStockGoods_InboundHistory'));
        const batch = writeBatch(db);
        snap.forEach(d => batch.delete(d.ref));
        await batch.commit();
        inboundMap = {};
        applyDates();
        hideLoading();
        showToast('✅ 입고 이력 초기화 완료');
    } catch (e) { hideLoading(); alert('삭제 실패'); }
}

// 출고일 및 매칭 (기존 로직 유지)
function extractShipDates() {
    const checklistContainer = document.getElementById('date-checklist-container');
    if (!checklistContainer) return;
    const dateMap = {};
    const dCols = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qCols = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const iQCols = ['1차실입고수량','2차실입고수량','3차실입고수량','4차실입고수량','5차실입고수량','6차실입고수량'];
    const iACols = ['1차실입고금액','2차실입고금액','3차실입고금액','4차실입고금액','5차실입고금액','6차실입고금액'];
    
    const process = (rows) => {
        rows.forEach(row => {
            dCols.forEach((dc, idx) => {
                if (hasValue(row[iQCols[idx]]) || hasValue(row[iACols[idx]])) return;
                const norm = normalizeDate(row[dc]);
                if (!norm || norm.length < 10) return;
                if (!dateMap[norm]) dateMap[norm] = { qty: 0, skus: new Set() };
                dateMap[norm].qty += (parseInt(row[qCols[idx]]) || 0);
                dateMap[norm].skus.add(row['상품코드'] || row['어드민상품코드']);
            });
        });
    };
    process(orderDataOriginal); process(orderDataBuy);
    const sorted = Object.entries(dateMap).sort((a, b) => b[0].localeCompare(a[0]));
    if (sorted.length === 0) { checklistContainer.innerHTML = '미입고 데이터 없음'; return; }
    let html = '';
    sorted.forEach(([date, info]) => {
        const isChecked = savedDates.includes(date) ? 'checked' : '';
        html += `<label class="date-item"><input type="checkbox" class="date-check" value="${date}" ${isChecked}><span>${date} (${info.skus.size}종 / ${info.qty.toLocaleString()}장)</span></label>`;
    });
    checklistContainer.innerHTML = html;
    checklistContainer.querySelectorAll('.date-check').forEach(ck => { ck.addEventListener('change', () => { updateSavedDatesFromCheckboxes(); renderSelectedTags(); }); });
}

function updateSavedDatesFromCheckboxes() {
    savedDates = Array.from(document.querySelectorAll('.date-check:checked')).map(c => c.value);
    const btn = document.getElementById('btn-date-dropdown');
    btn.innerText = savedDates.length > 0 ? `▼ ${savedDates.length}개 선택됨` : `▼ 출고일 선택`;
}

function renderSelectedTags() {
    const container = document.getElementById('date-tags-container');
    if (savedDates.length === 0) { container.innerHTML = '선택된 출고일 없음'; return; }
    let html = '';
    [...savedDates].sort((a,b)=>b.localeCompare(a)).forEach(d => {
        html += `<div class="date-tag">${d} <span class="remove-btn" data-date="${d}">✕</span></div>`;
    });
    container.innerHTML = html;
    container.querySelectorAll('.remove-btn').forEach(b => b.addEventListener('click', () => {
        const d = b.dataset.date; savedDates = savedDates.filter(x => x !== d);
        const ck = document.querySelector(`.date-check[value="${d}"]`); if(ck) ck.checked = false;
        updateSavedDatesFromCheckboxes(); renderSelectedTags();
    }));
}

// 데이터 매칭 및 렌더링
function applyDates() {
    if (savedDates.length === 0) return;
    saveConfig();
    const dCols = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qCols = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const iQCols = ['1차실입고수량','2차실입고수량','3차실입고수량','4차실입고수량','5차실입고수량','6차실입고수량'];
    const iACols = ['1차실입고금액','2차실입고금액','3차실입고금액','4차실입고금액','5차실입고금액','6차실입고금액'];
    
    let resultMap = {};
    const match = (rows) => {
        rows.forEach(row => {
            const code = (row['어드민상품코드'] || row['상품코드'] || '').toString().trim(); if (!code) return;
            let matched = false, totalQty = 0;
            dCols.forEach((dc, idx) => {
                if (hasValue(row[iQCols[idx]]) || hasValue(row[iACols[idx]])) return;
                const rd = normalizeDate(row[dc]);
                if (rd && savedDates.includes(rd)) { matched = true; totalQty += (parseInt(row[qCols[idx]]) || 0); }
            });
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
        return {
            code: item.code, name: item.name, option: item.option, arrivalQty: item.arrivalQty,
            mibalQty: parseInt(log['부족수량']) || 0, totalStock: parseInt(log['정상재고']) || 0,
            location: loc, capacity: getCapacityByLocation(loc),
            confirmed: inboundMap[item.code] || ed.confirmed || '', 
            shortage: ed.shortage || '', directShip: item.bigoY || ed.directShip || '', memo: ed.memo || ''
        };
    }).filter(d => d.arrivalQty > 0);
    filteredData = [...tableData]; renderTable(); updateSummary();
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!filteredData.length) { tbody.innerHTML = '출고일을 선택하세요.'; return; }
    let html = '';
    filteredData.forEach((row, idx) => {
        const isFromApp = inboundMap[row.code] !== undefined;
        const confirmStyle = isFromApp ? 'color: #1976d2; font-weight: 900;' : '';
        html += `<tr><td>${idx+1}</td><td class="code-cell" data-code="${row.code}">${row.code}</td><td>${row.name}</td><td>${row.option}</td><td>${row.arrivalQty}</td><td>${row.mibalQty}</td><td>${row.totalStock}</td><td>${row.location}</td><td>${row.capacity}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="confirmed" style="${confirmStyle}">${row.confirmed}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="shortage">${row.shortage}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="directShip">${row.directShip}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="memo">${row.memo}</td></tr>`;
    });
    tbody.innerHTML = html;
}

function updateSummary() {
    document.getElementById('sum-sku').textContent = filteredData.length;
    document.getElementById('sum-arrival').textContent = filteredData.reduce((s,d)=>s+d.arrivalQty,0);
}

// ---------------------------------------------------------
// 초기화 및 기본 로직
// ---------------------------------------------------------
async function loadConfig() { const snap = await getDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC)); if (snap.exists()) { const c = snap.data(); csvUrlOrder = c.csvUrlOrder || ''; csvUrlBuy = c.csvUrlBuy || ''; savedDates = c.savedDates || []; } }
async function saveConfig() { await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { csvUrlOrder, csvUrlBuy, savedDates, updatedAt: new Date() }, { merge: true }); }
async function loadEditedCells() { const snap = await getDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS')); if (snap.exists()) editedCells = snap.data().cells || {}; }
async function saveEditedCells() { await setDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'), { cells: editedCells }); }
async function loadStockLogFromFirebase() { const snap = await getDocs(collection(db, CHINA_COLLECTION + '_StockLog')); snap.forEach(d => { if(d.data().dataStr) JSON.parse(d.data().dataStr).forEach(r => { const c = (r['상품코드']||'').trim(); if(c) stockLogData[c] = r; }); }); }

async function fetchCSV(url) {
    if(!url) return [];
    let text = '';
    try { const res = await fetch(url); text = await res.text(); }
    catch(e) { const res2 = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`); text = await res2.text(); }
    const wb = XLSX.read(text, { type: 'string' });
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    let hIdx = -1, headers = [];
    for(let i=0; i<Math.min(20, raw.length); i++) {
        const cl = raw[i].map(h => cleanKey(h));
        if(cl.includes('상품코드')) { hIdx = i; headers = cl; break; }
    }
    const res = [];
    for(let i=hIdx+1; i<raw.length; i++) {
        let obj = {}, e = true;
        for(let j=0; j<headers.length; j++) { if(headers[j]) { obj[headers[j]] = raw[i][j]; if(raw[i][j]!=='') e=false; } }
        if(!e) res.push(obj);
    }
    return res;
}

async function syncOrderData(silent = false) {
    if(!silent) showLoading('🔄 동기화 중...');
    orderDataOriginal = await fetchCSV(csvUrlOrder); orderDataBuy = await fetchCSV(csvUrlBuy);
    extractShipDates();
    if(!silent) { hideLoading(); showToast('✅ 완료'); }
}

function setupEventListeners() {
    document.getElementById('btn-toggle-menu')?.addEventListener('click', (e) => { e.stopPropagation(); const m = document.getElementById('main-tools-menu'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; });
    document.getElementById('btn-date-dropdown')?.addEventListener('click', (e) => { e.stopPropagation(); const p = document.getElementById('date-dropdown-popup'); p.style.display = p.style.display === 'block' ? 'none' : 'block'; });
    document.addEventListener('click', () => closeAllMenus());
    document.getElementById('btn-date-apply')?.addEventListener('click', applyDates);
    document.getElementById('btn-clear-inbound')?.addEventListener('click', clearInboundHistory);
    document.getElementById('btn-upload-scandb')?.addEventListener('click', () => uploadScanDB());
    document.getElementById('btn-sync-order')?.addEventListener('click', () => syncOrderData());
    document.getElementById('search-input')?.addEventListener('input', () => {
        const k = document.getElementById('search-input').value.trim().toUpperCase();
        filteredData = k ? tableData.filter(d => d.code.includes(k) || d.name.includes(k)) : [...tableData];
        renderTable(); updateSummary();
    });
}

async function init() {
    setupEventListeners();
    loadInboundHistory();
    try {
        await loadConfig();
        await Promise.all([loadEditedCells(), loadStockLogFromFirebase(), syncOrderData(true)]);
        updateSavedDatesFromCheckboxes(); renderSelectedTags();
        if(savedDates.length > 0) applyDates();
    } catch(e) { console.error(e); }
}
init();
