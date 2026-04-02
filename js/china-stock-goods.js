// === js/china-stock-goods.js ===
// 중국제작 미발계산기 Ver 1.8

import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, writeBatch, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const CHINA_COLLECTION = 'ChinaStockGoods';
const CONFIG_DOC = 'CONFIG';

// =========================================================
// 전역 상태
// =========================================================
let orderDataOriginal = [];
let orderDataBuy = [];// === js/china-stock-goods.js ===
// 중국제작 미발계산기 Ver 1.8.1

import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, writeBatch, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const CHINA_COLLECTION = 'ChinaStockGoods';
const CONFIG_DOC = 'CONFIG';

// =========================================================
// 전역 상태
// =========================================================
let orderDataOriginal = [];
let orderDataBuy = [];
let stockLogData = {};
let tableData = [];
let filteredData = [];
let editedCells = {};
let sortConfig = { key: '', direction: 'asc' };
let csvUrlOrder = '';
let csvUrlBuy = '';
let savedDates = []; 
let saveTimeout = null;

// =========================================================
// 유틸리티 & 헬퍼
// =========================================================
const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

function getProductName(row) {
    return row['상품명'] || row['공급처상품명'] || '';
}

function formatExcelDate(excelDate) {
    if (!excelDate || excelDate.toString().trim() === '') return '';
    if (typeof excelDate === 'string' && (excelDate.includes('-') || excelDate.includes('.'))) return excelDate;
    const num = parseFloat(excelDate);
    if (isNaN(num)) return excelDate;
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
    const el = document.getElementById('loading-text');
    if (el) el.innerText = text;
    document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }

function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

function getCapacityByLocation(locStr) {
    if (!locStr) return 0;
    const ch = locStr.toString().trim().toUpperCase().charAt(0);
    const map = { 'A':20,'B':20,'C':20,'D':20,'E':40,'F':40,'G':40,'H':15,'I':15,'Z':15,'L':15,'O':15,'P':15,'Q':15,'R':15,'S':15,'T':15 };
    if (locStr.includes('★')) return 90;
    return map[ch] || 0;
}

function closeAllMenus() {
    document.querySelectorAll('.upload-menu').forEach(m => m.style.display = 'none');
    document.getElementById('date-dropdown-popup').style.display = 'none';
}

// =========================================================
// [수정 1] extractShipDates 함수 (드롭다운 & 태그 방식)
// =========================================================
function extractShipDates() {
    const checklistContainer = document.getElementById('date-checklist-container');
    if (!checklistContainer) return;

    const dateMap = {};
    const dateColsOrig = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qtyColsOrig  = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const dateColsBuy = ['1차패킹리스트출고일','2차패킹리스트출고일'];
    const qtyColsBuy  = ['1차패킹리스트출고수량','2차패킹리스트출고수량'];

    const process = (rows, dCols, qCols) => {
        rows.forEach(row => {
            dCols.forEach((dc, idx) => {
                const normalized = normalizeDate(row[dc]);
                if (!normalized || normalized.length < 10) return;
                if (!dateMap[normalized]) dateMap[normalized] = { qty: 0, skus: new Set() };
                dateMap[normalized].qty += (parseInt(row[qCols[idx]]) || 0);
                dateMap[normalized].skus.add(row['상품코드'] || row['어드민상품코드']);
            });
        });
    };

    process(orderDataOriginal, dateColsOrig, qtyColsOrig);
    process(orderDataBuy, dateColsBuy, qtyColsBuy);

    const sortedDates = Object.entries(dateMap).sort((a, b) => b[0].localeCompare(a[0]));

    if (sortedDates.length === 0) {
        checklistContainer.innerHTML = '<div style="color:#888; font-size:12px; padding:10px;">데이터가 없습니다.</div>';
        return;
    }

    let html = '';
    sortedDates.forEach(([date, info]) => {
        const isChecked = savedDates.includes(date) ? 'checked' : '';
        html += `
            <label class="date-item">
                <input type="checkbox" class="date-check" value="${date}" ${isChecked}>
                <span>${date} (${info.skus.size}종 / ${info.qty.toLocaleString()}장)</span>
            </label>
        `;
    });
    checklistContainer.innerHTML = html;

    // 체크박스 이벤트 바인딩
    checklistContainer.querySelectorAll('.date-check').forEach(ck => {
        ck.addEventListener('change', () => {
            updateSavedDatesFromCheckboxes();
            renderSelectedTags();
        });
    });

    renderSelectedTags();
}

function updateSavedDatesFromCheckboxes() {
    const checks = document.querySelectorAll('.date-check:checked');
    savedDates = Array.from(checks).map(c => c.value);
    const btn = document.getElementById('btn-date-dropdown');
    if (savedDates.length > 0) btn.innerText = `▼ ${savedDates.length}개 선택됨`;
    else btn.innerText = `▼ 출고일 선택`;
}

function renderSelectedTags() {
    const container = document.getElementById('date-tags-container');
    if (!container) return;

    if (savedDates.length === 0) {
        container.innerHTML = '<span class="no-selection-text">선택된 출고일 없음</span>';
        return;
    }

    // 날짜 역순 정렬해서 태그 표시
    const sorted = [...savedDates].sort((a, b) => b.localeCompare(a));
    let html = '';
    sorted.forEach(date => {
        html += `
            <div class="date-tag">
                ${date} <span class="remove-btn" data-date="${date}">✕</span>
            </div>
        `;
    });
    container.innerHTML = html;

    // 태그 삭제 버튼 이벤트
    container.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const date = btn.dataset.date;
            savedDates = savedDates.filter(d => d !== date);
            
            // 체크박스 상태도 동기화
            const ck = document.querySelector(`.date-check[value="${date}"]`);
            if (ck) ck.checked = false;
            
            updateSavedDatesFromCheckboxes();
            renderSelectedTags();
        });
    });
}

// =========================================================
// Firebase 로드/저장
// =========================================================
async function loadConfig() {
    try {
        const snap = await getDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC));
        if (snap.exists()) {
            const cfg = snap.data();
            csvUrlOrder = cfg.csvUrlOrder || '';
            csvUrlBuy = cfg.csvUrlBuy || '';
            savedDates = cfg.savedDates || [];
        }
    } catch (e) { console.error('설정 로드 실패:', e); }
}

async function saveConfig() {
    try {
        await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { csvUrlOrder, csvUrlBuy, savedDates, updatedAt: new Date() }, { merge: true });
    } catch (e) { console.error('설정 저장 실패:', e); }
}

async function loadEditedCells() {
    try {
        const snap = await getDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'));
        if (snap.exists()) editedCells = snap.data().cells || {};
    } catch (e) { console.error('편집 데이터 로드 실패:', e); }
}

async function saveEditedCells() {
    try {
        await setDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'), { cells: editedCells, updatedAt: new Date() });
    } catch (e) { console.error('편집 데이터 저장 실패:', e); }
}

async function loadStockLogFromFirebase() {
    try {
        stockLogData = {};
        const snap = await getDocs(collection(db, CHINA_COLLECTION + '_StockLog'));
        snap.forEach(d => {
            const data = d.data();
            if (data.dataStr) {
                JSON.parse(data.dataStr).forEach(row => {
                    const code = (row['상품코드'] || '').toString().trim();
                    if (code) stockLogData[code] = row;
                });
            }
        });
    } catch (e) { console.error('미발재고로그 로드 실패:', e); }
}

async function saveChunkedData(rows, subCollection, onProgress) {
    const collName = CHINA_COLLECTION + '_' + subCollection;
    try {
        const existing = await getDocs(collection(db, collName));
        if (existing.size > 0) {
            for (const d of existing.docs) { await deleteDoc(d.ref); }
        }
        const CHUNK_SIZE = 500;
        const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            const chunkIdx = Math.floor(i / CHUNK_SIZE);
            let b = writeBatch(db);
            b.set(doc(db, collName, `CHUNK_${chunkIdx}`), { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            await b.commit();
            if (onProgress) onProgress(`💾 ${subCollection} 저장 중... ${chunkIdx + 1}/${totalChunks}`);
            await sleep(150);
        }
    } catch (e) { throw e; }
}

// =========================================================
// CSV fetch + 파싱
// =========================================================
async function fetchCSV(url) {
    let textData = '';
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('연결 실패');
        textData = await res.text();
    } catch (e) {
        const res2 = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
        textData = await res2.text();
    }
    const wb = XLSX.read(textData, { type: 'string' });
    const rawData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    let headerIdx = -1, headers = [];
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
        const cleaned = rawData[i].map(h => cleanKey(h));
        if (cleaned.includes('어드민상품코드') || cleaned.includes('상품코드')) { headerIdx = i; headers = cleaned; break; }
    }
    if (headerIdx === -1) return [];
    const result = [];
    for (let i = headerIdx + 1; i < rawData.length; i++) {
        let obj = {}, empty = true;
        for (let j = 0; j < headers.length; j++) {
            if (headers[j]) { obj[headers[j]] = rawData[i][j]; if (rawData[i][j] !== '' && rawData[i][j] !== undefined) empty = false; }
        }
        if (!empty) result.push(obj);
    }
    return result;
}

// =========================================================
// [수정 2] 동기화 로직 및 호출 시점
// =========================================================
async function syncOrderData(silent = false) {
    if (!csvUrlOrder && !csvUrlBuy) { if(!silent) alert('링크를 먼저 설정하세요.'); return; }
    if(!silent) showLoading('🔄 오더리스트 동기화 중...');
    try {
        const [dataOrder, dataBuy] = await Promise.all([fetchCSV(csvUrlOrder), fetchCSV(csvUrlBuy)]);
        orderDataOriginal = dataOrder;
        orderDataBuy = dataBuy;
        extractShipDates(); 
        if(!silent) { hideLoading(); showToast('✅ 동기화 완료'); }
    } catch (e) { if(!silent) { hideLoading(); alert('실패: ' + e.message); } }
}

function handleStockLogUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    showLoading('📂 미발재고로그 저장 중...');
    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const ab = new Uint8Array(evt.target.result.split('').map(c => c.charCodeAt(0))).buffer;
            const wb = XLSX.read(ab, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).filter(r => r['상품코드']);
            stockLogData = {}; rows.forEach(row => { const code = (row['상품코드'] || '').toString().trim(); if (code) stockLogData[code] = row; });
            await saveChunkedData(rows, 'StockLog', (msg) => showLoading(msg));
            hideLoading(); showToast('✅ 저장 완료');
            if (tableData.length > 0) applyDates();
        } catch (err) { hideLoading(); alert('실패'); }
        e.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
}

// =========================================================
// [수정 3] applyDates 및 clearDates 수정
// =========================================================
function applyDates() {
    const inputDates = savedDates; 
    if (inputDates.length === 0) { alert('출고일을 선택해주세요.'); return; }
    saveConfig();
    const dateColsOrig = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qtyColsOrig  = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const dateColsBuy = ['1차패킹리스트출고일','2차패킹리스트출고일'];
    const qtyColsBuy  = ['1차패킹리스트출고수량','2차패킹리스트출고수량'];
    let resultMap = {};
    const match = (rows, dCols, qCols) => {
        rows.forEach(row => {
            const code = (row['어드민상품코드'] || row['상품코드'] || '').toString().trim();
            if (!code) return;
            let matched = false, totalQty = 0;
            dCols.forEach((dc, idx) => {
                const rd = normalizeDate(row[dc] || '');
                if (rd && inputDates.includes(rd)) { matched = true; totalQty += (parseInt(row[qtyColsOrig[idx] || qCols[idx]]) || 0); }
            });
            if (matched) {
                if (!resultMap[code]) resultMap[code] = { code, name: getProductName(row), option: row['옵션']||'', arrivalQty: 0, bigoY: row['비고']||'' };
                resultMap[code].arrivalQty += totalQty;
            }
        });
    };
    match(orderDataOriginal, dateColsOrig, qtyColsOrig);
    match(orderDataBuy, dateColsBuy, qtyColsBuy);
    tableData = Object.values(resultMap).map(item => {
        const log = stockLogData[item.code] || {};
        const edited = editedCells[item.code] || {};
        return {
            code: item.code, name: item.name, option: item.option, arrivalQty: item.arrivalQty,
            mibalQty: parseInt(log['부족수량']) || 0, totalStock: parseInt(log['정상재고']) || 0,
            location: (log['로케이션'] || '').toString().split('/')[0].trim(),
            capacity: getCapacityByLocation(log['로케이션']),
            confirmed: edited.confirmed || '', shortage: edited.shortage || '',
            directShip: item.bigoY || edited.directShip || '', memo: edited.memo || ''
        };
    }).filter(d => d.arrivalQty > 0);
    filteredData = [...tableData]; renderTable(); updateSummary(); showToast('✅ 매칭 완료');
}

function clearDates() {
    savedDates = []; 
    document.querySelectorAll('.date-check').forEach(btn => btn.checked = false);
    updateSavedDatesFromCheckboxes();
    renderSelectedTags();
    tableData = []; filteredData = []; renderTable(); updateSummary(); saveConfig(); showToast('🔄 초기화 완료');
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!filteredData || filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" style="text-align:center; padding:50px; color:#888;">출고일을 선택하고 [적용] 버튼을 누르세요.</td></tr>';
        return;
    }
    let html = '';
    filteredData.forEach((row, idx) => {
        html += `<tr><td>${idx + 1}</td><td class="code-cell" data-code="${row.code}">${row.code}</td><td style="text-align:left;">${row.name}</td><td>${row.option}</td><td style="font-weight:bold;">${row.arrivalQty.toLocaleString()}</td><td style="color:${row.mibalQty > 0 ? '#d32f2f' : '#333'}; font-weight:bold;">${row.mibalQty.toLocaleString()}</td><td>${row.totalStock.toLocaleString()}</td><td>${row.location}</td><td class="capacity-auto">${row.capacity || '-'}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="confirmed">${row.confirmed}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="shortage">${row.shortage}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="directShip">${row.directShip}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="memo">${row.memo}</td></tr>`;
    });
    tbody.innerHTML = html;
}

function updateSummary() {
    document.getElementById('sum-sku').textContent = filteredData.length.toLocaleString();
    document.getElementById('sum-arrival').textContent = filteredData.reduce((s, d) => s + (d.arrivalQty || 0), 0).toLocaleString();
    document.getElementById('sum-mibal').textContent = filteredData.reduce((s, d) => s + (d.mibalQty || 0), 0).toLocaleString();
}

function applySearch() {
    const keyword = (document.getElementById('search-input')?.value || '').trim().toUpperCase();
    filteredData = keyword ? tableData.filter(d => d.code.toUpperCase().includes(keyword) || d.name.toUpperCase().includes(keyword) || d.option.toUpperCase().includes(keyword)) : [...tableData];
    renderTable(); updateSummary();
}

function sortTable(key) {
    if (sortConfig.key === key) sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    else { sortConfig.key = key; sortConfig.direction = 'asc'; }
    filteredData.sort((a, b) => {
        let va = a[key], vb = b[key];
        if (typeof va === 'number' && typeof vb === 'number') return sortConfig.direction === 'asc' ? va - vb : vb - va;
        return sortConfig.direction === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    renderTable();
}

function onCellEdit(el) {
    const code = el.dataset.code; const field = el.dataset.field; const value = el.textContent.trim();
    if (!editedCells[code]) editedCells[code] = {}; editedCells[code][field] = value;
    clearTimeout(saveTimeout); saveTimeout = setTimeout(() => { saveEditedCells(); showToast('💾 자동 저장됨'); }, 1000);
}

// =========================================================
// 이벤트 리스너 바인딩 (드롭다운 & 팝업 제어 추가)
// =========================================================
function setupEventListeners() {
    // 메인 도구 메뉴
    document.getElementById('btn-toggle-menu')?.addEventListener('click', (e) => {
        e.stopPropagation(); 
        const menu = document.getElementById('main-tools-menu');
        if (menu) menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
        document.getElementById('date-dropdown-popup').style.display = 'none';
    });

    // 드롭다운 토글
    document.getElementById('btn-date-dropdown')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const popup = document.getElementById('date-dropdown-popup');
        const isVisible = popup.style.display === 'block';
        popup.style.display = isVisible ? 'none' : 'block';
        document.getElementById('main-tools-menu').style.display = 'none';
    });

    // 팝업 내부 클릭 시 닫힘 방지
    document.getElementById('date-dropdown-popup')?.addEventListener('click', (e) => e.stopPropagation());

    // 전체 클릭 시 팝업 닫기
    document.addEventListener('click', () => closeAllMenus());

    // 팝업 내 전체 선택/해제
    document.getElementById('btn-date-all')?.addEventListener('click', () => {
        document.querySelectorAll('.date-check').forEach(ck => ck.checked = true);
        updateSavedDatesFromCheckboxes();
        renderSelectedTags();
    });
    document.getElementById('btn-date-none')?.addEventListener('click', () => {
        document.querySelectorAll('.date-check').forEach(ck => ck.checked = false);
        updateSavedDatesFromCheckboxes();
        renderSelectedTags();
    });

    document.getElementById('btn-sync-order')?.addEventListener('click', () => { closeAllMenus(); syncOrderData(); });
    
    document.getElementById('btn-open-sheet-settings')?.addEventListener('click', () => { 
        closeAllMenus();
        document.getElementById('modal-csv-order').value = csvUrlOrder;
        document.getElementById('modal-csv-buy').value = csvUrlBuy;
        document.getElementById('sheet-settings-modal').style.display = 'flex';
    });
    
    document.getElementById('btn-sheet-save')?.addEventListener('click', async () => {
        csvUrlOrder = document.getElementById('modal-csv-order').value.trim();
        csvUrlBuy = document.getElementById('modal-csv-buy').value.trim();
        await saveConfig(); document.getElementById('sheet-settings-modal').style.display = 'none';
        showToast('저장 완료'); syncOrderData();
    });
    
    document.getElementById('btn-sheet-cancel')?.addEventListener('click', () => document.getElementById('sheet-settings-modal').style.display = 'none');
    document.getElementById('upload-stock-log')?.addEventListener('change', handleStockLogUpload);
    document.getElementById('btn-date-apply')?.addEventListener('click', applyDates);
    document.getElementById('btn-date-clear')?.addEventListener('click', clearDates);
    document.getElementById('search-input')?.addEventListener('input', applySearch);
    document.querySelectorAll('.th-sortable').forEach(th => th.addEventListener('click', () => sortTable(th.dataset.sort)));
    
    document.getElementById('table-body')?.addEventListener('focusout', (e) => {
        if (e.target.classList.contains('editable-cell')) onCellEdit(e.target);
    });
    
    document.getElementById('btn-excel-download')?.addEventListener('click', () => {
        if (!filteredData.length) return;
        const headers = ['상품코드','수량']; let html = '<table><tr><th>상품코드</th><th>수량</th></tr>';
        filteredData.forEach(r => html += `<tr><td>${r.code}</td><td>${r.arrivalQty}</td></tr>`);
        html += '</table>';
        const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '미발계산기.xls'; a.click();
    });
}

async function init() {
    setupEventListeners();
    showLoading('📦 데이터 로드 중...');
    await loadConfig();
    await Promise.all([loadEditedCells(), loadStockLogFromFirebase(), syncOrderData(true)]);
    
    // 초기화 시 드롭다운 텍스트 업데이트
    const btn = document.getElementById('btn-date-dropdown');
    if (savedDates.length > 0) btn.innerText = `▼ ${savedDates.length}개 선택됨`;

    hideLoading();
    if (savedDates.length > 0 && tableData.length === 0) applyDates();
}
init();
let stockLogData = {};
let tableData = [];
let filteredData = [];
let editedCells = {};
let sortConfig = { key: '', direction: 'asc' };
let csvUrlOrder = '';
let csvUrlBuy = '';
let savedDates = []; // 선택된 날짜 목록 (Firebase 연동)
let saveTimeout = null;

// =========================================================
// 유틸리티 & 헬퍼
// =========================================================
const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

function getProductName(row) {
    return row['상품명'] || row['공급처상품명'] || '';
}

function formatExcelDate(excelDate) {
    if (!excelDate || excelDate.toString().trim() === '') return '';
    if (typeof excelDate === 'string' && (excelDate.includes('-') || excelDate.includes('.'))) return excelDate;
    const num = parseFloat(excelDate);
    if (isNaN(num)) return excelDate;
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
    const el = document.getElementById('loading-text');
    if (el) el.innerText = text;
    document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }

function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

function getCapacityByLocation(locStr) {
    if (!locStr) return 0;
    const ch = locStr.toString().trim().toUpperCase().charAt(0);
    const map = { 'A':20,'B':20,'C':20,'D':20,'E':40,'F':40,'G':40,'H':15,'I':15,'Z':15,'L':15,'O':15,'P':15,'Q':15,'R':15,'S':15,'T':15 };
    if (locStr.includes('★')) return 90;
    return map[ch] || 0;
}

function closeAllMenus() {
    document.querySelectorAll('.upload-menu').forEach(m => m.style.display = 'none');
}

// =========================================================
// [수정/추가 1] extractShipDates 함수 추가
// =========================================================
function extractShipDates() {
    const container = document.getElementById('date-buttons-container');
    if (!container) return;

    const dateMap = {}; // { 'YYYY-MM-DD': { qty: 0, skus: Set } }
    const dateColsOrig = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qtyColsOrig  = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const dateColsBuy = ['1차패킹리스트출고일','2차패킹리스트출고일'];
    const qtyColsBuy  = ['1차패킹리스트출고수량','2차패킹리스트출고수량'];

    const process = (rows, dCols, qCols) => {
        rows.forEach(row => {
            dCols.forEach((dc, idx) => {
                const normalized = normalizeDate(row[dc]);
                if (!normalized || normalized.length < 10) return;
                if (!dateMap[normalized]) dateMap[normalized] = { qty: 0, skus: new Set() };
                dateMap[normalized].qty += (parseInt(row[qCols[idx]]) || 0);
                dateMap[normalized].skus.add(row['상품코드'] || row['어드민상품코드']);
            });
        });
    };

    process(orderDataOriginal, dateColsOrig, qtyColsOrig);
    process(orderDataBuy, dateColsBuy, qtyColsBuy);

    const sortedDates = Object.entries(dateMap).sort((a, b) => b[0].localeCompare(a[0]));

    if (sortedDates.length === 0) {
        container.innerHTML = '<span style="color:#888; font-size:12px;">오더리스트를 먼저 동기화하세요.</span>';
        return;
    }

    let html = '';
    sortedDates.forEach(([date, info]) => {
        const isSelected = savedDates.includes(date) ? 'selected' : '';
        html += `<button class="date-chip-btn ${isSelected}" data-date="${date}">${date} (${info.skus.size}종 / ${info.qty.toLocaleString()}장)</button>`;
    });
    container.innerHTML = html;

    container.querySelectorAll('.date-chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('selected');
            const date = btn.dataset.date;
            if (btn.classList.contains('selected')) {
                if (!savedDates.includes(date)) savedDates.push(date);
            } else {
                savedDates = savedDates.filter(d => d !== date);
            }
        });
    });
}

// =========================================================
// Firebase 로드/저장
// =========================================================
async function loadConfig() {
    try {
        const snap = await getDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC));
        if (snap.exists()) {
            const cfg = snap.data();
            csvUrlOrder = cfg.csvUrlOrder || '';
            csvUrlBuy = cfg.csvUrlBuy || '';
            savedDates = cfg.savedDates || [];
        }
    } catch (e) { console.error('설정 로드 실패:', e); }
}

async function saveConfig() {
    try {
        await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { csvUrlOrder, csvUrlBuy, savedDates, updatedAt: new Date() }, { merge: true });
    } catch (e) { console.error('설정 저장 실패:', e); }
}

async function loadEditedCells() {
    try {
        const snap = await getDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'));
        if (snap.exists()) editedCells = snap.data().cells || {};
    } catch (e) { console.error('편집 데이터 로드 실패:', e); }
}

async function saveEditedCells() {
    try {
        await setDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'), { cells: editedCells, updatedAt: new Date() });
    } catch (e) { console.error('편집 데이터 저장 실패:', e); }
}

async function loadStockLogFromFirebase() {
    try {
        stockLogData = {};
        const snap = await getDocs(collection(db, CHINA_COLLECTION + '_StockLog'));
        snap.forEach(d => {
            const data = d.data();
            if (data.dataStr) {
                JSON.parse(data.dataStr).forEach(row => {
                    const code = (row['상품코드'] || '').toString().trim();
                    if (code) stockLogData[code] = row;
                });
            }
        });
    } catch (e) { console.error('미발재고로그 로드 실패:', e); }
}

async function saveChunkedData(rows, subCollection, onProgress) {
    const collName = CHINA_COLLECTION + '_' + subCollection;
    try {
        const existing = await getDocs(collection(db, collName));
        if (existing.size > 0) {
            for (const d of existing.docs) { await deleteDoc(d.ref); }
        }
        const CHUNK_SIZE = 500;
        const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            const chunkIdx = Math.floor(i / CHUNK_SIZE);
            let b = writeBatch(db);
            b.set(doc(db, collName, `CHUNK_${chunkIdx}`), { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            await b.commit();
            if (onProgress) onProgress(`💾 ${subCollection} 저장 중... ${chunkIdx + 1}/${totalChunks}`);
            await sleep(150);
        }
    } catch (e) { throw e; }
}

// =========================================================
// CSV fetch + 파싱
// =========================================================
async function fetchCSV(url) {
    let textData = '';
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('연결 실패');
        textData = await res.text();
    } catch (e) {
        const res2 = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
        textData = await res2.text();
    }
    const wb = XLSX.read(textData, { type: 'string' });
    const rawData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    let headerIdx = -1, headers = [];
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
        const cleaned = rawData[i].map(h => cleanKey(h));
        if (cleaned.includes('어드민상품코드') || cleaned.includes('상품코드')) { headerIdx = i; headers = cleaned; break; }
    }
    if (headerIdx === -1) return [];
    const result = [];
    for (let i = headerIdx + 1; i < rawData.length; i++) {
        let obj = {}, empty = true;
        for (let j = 0; j < headers.length; j++) {
            if (headers[j]) { obj[headers[j]] = rawData[i][j]; if (rawData[i][j] !== '' && rawData[i][j] !== undefined) empty = false; }
        }
        if (!empty) result.push(obj);
    }
    return result;
}

// =========================================================
// [수정 2] 동기화 로직 및 호출 시점
// =========================================================
async function syncOrderData(silent = false) {
    if (!csvUrlOrder && !csvUrlBuy) { if(!silent) alert('링크를 먼저 설정하세요.'); return; }
    if(!silent) showLoading('🔄 오더리스트 동기화 중...');
    try {
        const [dataOrder, dataBuy] = await Promise.all([fetchCSV(csvUrlOrder), fetchCSV(csvUrlBuy)]);
        orderDataOriginal = dataOrder;
        orderDataBuy = dataBuy;
        extractShipDates(); // 버튼 추출
        if(!silent) { hideLoading(); showToast('✅ 동기화 완료'); }
    } catch (e) { if(!silent) { hideLoading(); alert('실패: ' + e.message); } }
}

function handleStockLogUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    showLoading('📂 미발재고로그 저장 중...');
    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const ab = new Uint8Array(evt.target.result.split('').map(c => c.charCodeAt(0))).buffer;
            const wb = XLSX.read(ab, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).filter(r => r['상품코드']);
            stockLogData = {}; rows.forEach(row => { const code = (row['상품코드'] || '').toString().trim(); if (code) stockLogData[code] = row; });
            await saveChunkedData(rows, 'StockLog', (msg) => showLoading(msg));
            hideLoading(); showToast('✅ 저장 완료');
            if (tableData.length > 0) applyDates();
        } catch (err) { hideLoading(); alert('실패'); }
        e.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
}

// =========================================================
// [수정 3] applyDates 및 clearDates 수정
// =========================================================
function applyDates() {
    const inputDates = savedDates; 
    if (inputDates.length === 0) { alert('출고일 버튼을 선택해주세요.'); return; }
    saveConfig();
    const dateColsOrig = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qtyColsOrig  = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const dateColsBuy = ['1차패킹리스트출고일','2차패킹리스트출고일'];
    const qtyColsBuy  = ['1차패킹리스트출고수량','2차패킹리스트출고수량'];
    let resultMap = {};
    const match = (rows, dCols, qCols) => {
        rows.forEach(row => {
            const code = (row['어드민상품코드'] || row['상품코드'] || '').toString().trim();
            if (!code) return;
            let matched = false, totalQty = 0;
            dCols.forEach((dc, idx) => {
                const rd = normalizeDate(row[dc] || '');
                if (rd && inputDates.includes(rd)) { matched = true; totalQty += (parseInt(row[qtyColsOrig[idx] || qCols[idx]]) || 0); }
            });
            if (matched) {
                if (!resultMap[code]) resultMap[code] = { code, name: getProductName(row), option: row['옵션']||'', arrivalQty: 0, bigoY: row['비고']||'' };
                resultMap[code].arrivalQty += totalQty;
            }
        });
    };
    match(orderDataOriginal, dateColsOrig, qtyColsOrig);
    match(orderDataBuy, dateColsBuy, qtyColsBuy);
    tableData = Object.values(resultMap).map(item => {
        const log = stockLogData[item.code] || {};
        const edited = editedCells[item.code] || {};
        return {
            code: item.code, name: item.name, option: item.option, arrivalQty: item.arrivalQty,
            mibalQty: parseInt(log['부족수량']) || 0, totalStock: parseInt(log['정상재고']) || 0,
            location: (log['로케이션'] || '').toString().split('/')[0].trim(),
            capacity: getCapacityByLocation(log['로케이션']),
            confirmed: edited.confirmed || '', shortage: edited.shortage || '',
            directShip: item.bigoY || edited.directShip || '', memo: edited.memo || ''
        };
    }).filter(d => d.arrivalQty > 0);
    filteredData = [...tableData]; renderTable(); updateSummary(); showToast('✅ 매칭 완료');
}

function clearDates() {
    savedDates = []; document.querySelectorAll('.date-chip-btn').forEach(btn => btn.classList.remove('selected'));
    tableData = []; filteredData = []; renderTable(); updateSummary(); saveConfig(); showToast('🔄 초기화 완료');
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!filteredData || filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" style="text-align:center; padding:50px; color:#888;">출고일을 선택하고 [적용] 버튼을 누르세요.</td></tr>';
        return;
    }
    let html = '';
    filteredData.forEach((row, idx) => {
        html += `<tr><td>${idx + 1}</td><td class="code-cell" data-code="${row.code}">${row.code}</td><td style="text-align:left;">${row.name}</td><td>${row.option}</td><td style="font-weight:bold;">${row.arrivalQty.toLocaleString()}</td><td style="color:${row.mibalQty > 0 ? '#d32f2f' : '#333'}; font-weight:bold;">${row.mibalQty.toLocaleString()}</td><td>${row.totalStock.toLocaleString()}</td><td>${row.location}</td><td class="capacity-auto">${row.capacity || '-'}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="confirmed">${row.confirmed}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="shortage">${row.shortage}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="directShip">${row.directShip}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="memo">${row.memo}</td></tr>`;
    });
    tbody.innerHTML = html;
}

function updateSummary() {
    document.getElementById('sum-sku').textContent = filteredData.length.toLocaleString();
    document.getElementById('sum-arrival').textContent = filteredData.reduce((s, d) => s + (d.arrivalQty || 0), 0).toLocaleString();
    document.getElementById('sum-mibal').textContent = filteredData.reduce((s, d) => s + (d.mibalQty || 0), 0).toLocaleString();
}

function applySearch() {
    const keyword = (document.getElementById('search-input')?.value || '').trim().toUpperCase();
    filteredData = keyword ? tableData.filter(d => d.code.toUpperCase().includes(keyword) || d.name.toUpperCase().includes(keyword) || d.option.toUpperCase().includes(keyword)) : [...tableData];
    renderTable(); updateSummary();
}

function sortTable(key) {
    if (sortConfig.key === key) sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    else { sortConfig.key = key; sortConfig.direction = 'asc'; }
    filteredData.sort((a, b) => {
        let va = a[key], vb = b[key];
        if (typeof va === 'number' && typeof vb === 'number') return sortConfig.direction === 'asc' ? va - vb : vb - va;
        return sortConfig.direction === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    renderTable();
}

function onCellEdit(el) {
    const code = el.dataset.code; const field = el.dataset.field; const value = el.textContent.trim();
    if (!editedCells[code]) editedCells[code] = {}; editedCells[code][field] = value;
    clearTimeout(saveTimeout); saveTimeout = setTimeout(() => { saveEditedCells(); showToast('💾 자동 저장됨'); }, 1000);
}

function setupEventListeners() {
    document.getElementById('btn-toggle-menu')?.addEventListener('click', (e) => {
        e.stopPropagation(); const menu = document.getElementById('main-tools-menu');
        if (menu) menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
    });
    document.addEventListener('click', () => closeAllMenus());
    document.getElementById('btn-sync-order')?.addEventListener('click', () => { closeAllMenus(); syncOrderData(); });
    document.getElementById('btn-open-sheet-settings')?.addEventListener('click', () => { closeAllMenus();
        document.getElementById('modal-csv-order').value = csvUrlOrder;
        document.getElementById('modal-csv-buy').value = csvUrlBuy;
        document.getElementById('sheet-settings-modal').style.display = 'flex';
    });
    document.getElementById('btn-sheet-save')?.addEventListener('click', async () => {
        csvUrlOrder = document.getElementById('modal-csv-order').value.trim();
        csvUrlBuy = document.getElementById('modal-csv-buy').value.trim();
        await saveConfig(); document.getElementById('sheet-settings-modal').style.display = 'none';
        showToast('저장 완료'); syncOrderData();
    });
    document.getElementById('btn-sheet-cancel')?.addEventListener('click', () => document.getElementById('sheet-settings-modal').style.display = 'none');
    document.getElementById('upload-stock-log')?.addEventListener('change', handleStockLogUpload);
    document.getElementById('btn-date-apply')?.addEventListener('click', applyDates);
    document.getElementById('btn-date-clear')?.addEventListener('click', clearDates);
    document.getElementById('search-input')?.addEventListener('input', applySearch);
    document.querySelectorAll('.th-sortable').forEach(th => th.addEventListener('click', () => sortTable(th.dataset.sort)));
    document.getElementById('table-body')?.addEventListener('focusout', (e) => {
        if (e.target.classList.contains('editable-cell')) onCellEdit(e.target);
    });
    document.getElementById('btn-excel-download')?.addEventListener('click', () => {
        if (!filteredData.length) return;
        const headers = ['상품코드','수량']; let html = '<table><tr><th>상품코드</th><th>수량</th></tr>';
        filteredData.forEach(r => html += `<tr><td>${r.code}</td><td>${r.arrivalQty}</td></tr>`);
        html += '</table>';
        const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '미발계산기.xls'; a.click();
    });
}

async function init() {
    setupEventListeners();
    showLoading('📦 데이터 로드 중...');
    await loadConfig();
    await Promise.all([loadEditedCells(), loadStockLogFromFirebase(), syncOrderData(true)]);
    hideLoading();
    if (savedDates.length > 0 && tableData.length === 0) applyDates();
}
init();
