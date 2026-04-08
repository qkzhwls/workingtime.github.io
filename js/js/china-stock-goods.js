// === js/china-stock-goods.js ===
// 중국제작 미발계산기 Ver 2.3 (누락 함수 복구 및 이벤트 바인딩 완전체)

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
let inboundMap = {}; 
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

// ---------------------------------------------------------
// UI 제어 함수 (모달 및 메뉴)
// ---------------------------------------------------------
function closeAllMenus() {
    const menu = document.getElementById('main-tools-menu'); if (menu) menu.style.display = 'none';
    const popup = document.getElementById('date-dropdown-popup'); if (popup) popup.style.display = 'none';
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
        if (tableData.length > 0) applyDates();
    });
}

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
        if (cl.includes('상품코드')) { headerIdx = i; headers = cl; break; }
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
// [복구] 1. 미발재고로그 업로드 (DOMParser 사용)
// ---------------------------------------------------------
function handleStockLogUpload(e) {
    const file = e.target.files[0]; 
    if (!file) return;
    showLoading('📂 미발재고로그 처리 중...');
    
    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const text = evt.target.result;
            let rows = [];
            
            // HTML 테이블 형식인지 확인 (DOMParser 적용)
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
                // 일반 Excel, CSV 처리
                const wb = XLSX.read(text, { type: 'binary' });
                rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).filter(r => r['상품코드']);
            }

            stockLogData = {}; 
            rows.forEach(row => { 
                const code = (row['상품코드'] || '').toString().trim(); 
                if (code) stockLogData[code] = row; 
            });
            
            await saveChunkedData(rows, 'StockLog', (msg) => showLoading(msg));
            hideLoading(); 
            showToast('✅ 미발재고 저장 완료');
            if (tableData.length > 0) applyDates();
            
        } catch (err) { 
            hideLoading(); 
            alert('파일 처리 실패: ' + err.message); 
        }
        e.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
}

// ---------------------------------------------------------
// [복구] 2. 스캔DB 업로드
// ---------------------------------------------------------
async function uploadScanDB() {
    if (!tableData || tableData.length === 0) { alert('업로드할 데이터가 없습니다.'); return; }
    if (!confirm(`현재 ${tableData.length}건의 데이터를 앱용 스캔DB로 업로드하시겠습니까?`)) return;
    showLoading('🚀 앱용 스캔DB 업로드 중...');
    const SCAN_DB_COLL = 'ChinaStockGoods_ScanDB';
    try {
        const existing = await getDocs(collection(db, SCAN_DB_COLL));
        if (existing.size > 0) {
            const delBatch = writeBatch(db);
            existing.docs.forEach(d => delBatch.delete(d.ref));
            await delBatch.commit();
        }
        const CHUNK_SIZE = 500;
        for (let i = 0; i < tableData.length; i += CHUNK_SIZE) {
            const batch = writeBatch(db);
            const chunk = tableData.slice(i, i + CHUNK_SIZE);
            chunk.forEach(item => {
                const docRef = doc(db, SCAN_DB_COLL, item.code);
                batch.set(docRef, {
                    code: item.code, name: item.name, option: item.option,
                    arrivalQty: item.arrivalQty, mibalQty: item.mibalQty,
                    totalStock: item.totalStock, location: item.location,
                    capacity: item.capacity, updatedAt: new Date()
                });
            });
            await batch.commit();
        }
        hideLoading(); showToast(`✅ 스캔DB 업로드 완료 (${tableData.length}건)`);
    } catch (e) { hideLoading(); alert('업로드 실패: ' + e.message); }
}

// ---------------------------------------------------------
// [복구] 3. 전체 데이터 초기화 (#btn-clear-all)
// ---------------------------------------------------------
async function clearAllData() {
    if (!confirm("모든 데이터를 초기화하시겠습니까?\n(수동편집, 미발재고로그, 앱 입고이력이 모두 삭제됩니다.)")) return;
    showLoading('🗑️ 전체 데이터 초기화 중...');
    try {
        // 1. EDITED_CELLS 삭제
        await deleteDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'));
        
        // 2. StockLog 청크 삭제
        const stockSnap = await getDocs(collection(db, CHINA_COLLECTION + '_StockLog'));
        if (stockSnap.size > 0) {
            const b1 = writeBatch(db);
            stockSnap.forEach(d => b1.delete(d.ref));
            await b1.commit();
        }
        
        // 3. InboundHistory 삭제
        const inboundSnap = await getDocs(collection(db, 'ChinaStockGoods_InboundHistory'));
        if (inboundSnap.size > 0) {
            const b2 = writeBatch(db);
            inboundSnap.forEach(d => b2.delete(d.ref));
            await b2.commit();
        }

        // 변수 초기화
        orderDataOriginal = [];
        orderDataBuy = [];
        stockLogData = {};
        editedCells = {};
        inboundMap = {};
        tableData = [];
        filteredData = [];
        savedDates = [];
        
        updateSavedDatesFromCheckboxes();
        renderSelectedTags();
        renderTable();
        updateSummary();
        document.getElementById('date-checklist-container').innerHTML = '';
        
        hideLoading();
        showToast('✅ 전체 초기화 완료');
    } catch (e) {
        hideLoading();
        alert('초기화 실패: ' + e.message);
    }
}

// ---------------------------------------------------------
// [복구] 4. 출고일 초기화 (clearDates)
// ---------------------------------------------------------
function clearDates() {
    savedDates = []; 
    document.querySelectorAll('.date-check').forEach(btn => btn.checked = false);
    updateSavedDatesFromCheckboxes(); 
    renderSelectedTags();
    tableData = []; 
    filteredData = []; 
    renderTable(); 
    updateSummary(); 
    saveConfig(); 
    showToast('🔄 초기화 완료');
}

// ---------------------------------------------------------
// 비즈니스 로직 (매칭 및 렌더링)
// ---------------------------------------------------------
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
    if (!filteredData.length) { tbody.innerHTML = '<tr><td colspan="13" style="text-align:center; padding:50px; color:#888;">출고일을 선택하세요.</td></tr>'; return; }
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

function applySearch() {
    const k = document.getElementById('search-input')?.value.trim().toUpperCase();
    filteredData = k ? tableData.filter(d => d.code.includes(k) || d.name.includes(k)) : [...tableData];
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

// ---------------------------------------------------------
// Firebase 설정 로직
// ---------------------------------------------------------
async function loadConfig() { const snap = await getDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC)); if (snap.exists()) { const c = snap.data(); csvUrlOrder = c.csvUrlOrder || ''; csvUrlBuy = c.csvUrlBuy || ''; savedDates = c.savedDates || []; } }
async function saveConfig() { await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { csvUrlOrder, csvUrlBuy, savedDates, updatedAt: new Date() }, { merge: true }); }
async function loadEditedCells() { const snap = await getDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS')); if (snap.exists()) editedCells = snap.data().cells || {}; }
async function saveEditedCells() { await setDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'), { cells: editedCells }); }
async function loadStockLogFromFirebase() { const snap = await getDocs(collection(db, CHINA_COLLECTION + '_StockLog')); snap.forEach(d => { if(d.data().dataStr) JSON.parse(d.data().dataStr).forEach(r => { const c = (r['상품코드']||'').trim(); if(c) stockLogData[c] = r; }); }); }

// ---------------------------------------------------------
// 이벤트 바인딩 (체크리스트 기반 완전 복원)
// ---------------------------------------------------------
function setupEventListeners() {
    // 1. #btn-toggle-menu (작업 메뉴 토글)
    document.getElementById('btn-toggle-menu')?.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        const m = document.getElementById('main-tools-menu'); 
        m.style.display = m.style.display === 'block' ? 'none' : 'block'; 
    });

    // 2. #main-tools-menu (메뉴 내부 클릭 전파 방지)
    document.getElementById('main-tools-menu')?.addEventListener('click', (e) => e.stopPropagation());

    // 3. document click (메뉴 닫기)
    document.addEventListener('click', () => closeAllMenus());

    // 4. #btn-sync-order (오더리스트 동기화)
    document.getElementById('btn-sync-order')?.addEventListener('click', () => { closeAllMenus(); syncOrderData(); });

    // 5. #btn-open-sheet-settings (CSV 링크 설정 모달 열기)
    document.getElementById('btn-open-sheet-settings')?.addEventListener('click', () => openSheetSettingsModal());

    // 6. #btn-clear-all (전체 초기화) - [복구 완료]
    document.getElementById('btn-clear-all')?.addEventListener('click', () => { closeAllMenus(); clearAllData(); });

    // 7. #upload-stock-log (미발재고로그 업로드)
    document.getElementById('upload-stock-log')?.addEventListener('change', (e) => handleStockLogUpload(e));

    // 8. #btn-date-apply (적용)
    document.getElementById('btn-date-apply')?.addEventListener('click', applyDates);

    // 9. #btn-date-clear (초기화) - [복구 완료]
    document.getElementById('btn-date-clear')?.addEventListener('click', clearDates);

    // 10. #btn-excel-download (엑셀 다운로드)
    document.getElementById('btn-excel-download')?.addEventListener('click', () => {
        if (!filteredData.length) return;
        const headers = ['상품코드','수량']; let html = '<table><tr><th>상품코드</th><th>수량</th></tr>';
        filteredData.forEach(r => html += `<tr><td>${r.code}</td><td>${r.arrivalQty}</td></tr>`);
        html += '</table>';
        const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '미발계산기.xls'; a.click();
    });

    // 11. #search-input (검색)
    document.getElementById('search-input')?.addEventListener('input', applySearch);

    // 12. .th-sortable (정렬)
    document.querySelectorAll('.th-sortable').forEach(th => th.addEventListener('click', () => sortTable(th.dataset.sort)));

    // 13. #table-body focusout (셀 편집)
    document.getElementById('table-body')?.addEventListener('focusout', (e) => { 
        if (e.target.classList.contains('editable-cell')) {
            const code = e.target.dataset.code; const field = e.target.dataset.field; const value = e.target.textContent.trim();
            if (!editedCells[code]) editedCells[code] = {}; editedCells[code][field] = value;
            clearTimeout(saveTimeout); saveTimeout = setTimeout(() => { saveEditedCells(); showToast('💾 자동 저장됨'); }, 1000);
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

    // 19. #btn-upload-scandb (스캔DB 업로드) - [복구 완료]
    document.getElementById('btn-upload-scandb')?.addEventListener('click', () => uploadScanDB());

    // 20. #btn-clear-inbound (입고 이력 초기화)
    document.getElementById('btn-clear-inbound')?.addEventListener('click', () => clearInboundHistory());

    // 21. 출고일 드롭다운 관련 바인딩
    document.getElementById('btn-date-dropdown')?.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        const p = document.getElementById('date-dropdown-popup'); 
        p.style.display = p.style.display === 'block' ? 'none' : 'block'; 
    });
    document.getElementById('btn-date-all')?.addEventListener('click', () => { 
        document.querySelectorAll('.date-check').forEach(ck => ck.checked = true); 
        updateSavedDatesFromCheckboxes(); renderSelectedTags(); 
    });
    document.getElementById('btn-date-none')?.addEventListener('click', () => { 
        document.querySelectorAll('.date-check').forEach(ck => ck.checked = false); 
        updateSavedDatesFromCheckboxes(); renderSelectedTags(); 
    });

    // ========= 바인딩 체크리스트 (Ver 2.3) =========
    // 1. #btn-toggle-menu [OK]
    // 2. #main-tools-menu [OK]
    // 3. document click [OK]
    // 4. #btn-sync-order [OK]
    // 5. #btn-open-sheet-settings [OK]
    // 6. #btn-clear-all [OK] (clearAllData 함수 복원)
    // 7. #upload-stock-log [OK] (handleStockLogUpload 함수 복원)
    // 8. #btn-date-apply [OK]
    // 9. #btn-date-clear [OK] (clearDates 함수 복원)
    // 10. #btn-excel-download [OK]
    // 11. #search-input [OK]
    // 12. .th-sortable [OK]
    // 13. #table-body focusout [OK]
    // 14. #table-body click [OK]
    // 15. #btn-sheet-cancel [OK]
    // 16. #btn-sheet-save [OK]
    // 17. #sheet-settings-modal [OK]
    // 18. #sheet-settings-modal .modal-content [OK]
    // 19. #btn-upload-scandb [OK] (uploadScanDB 함수 복원)
    // 20. #btn-clear-inbound [OK]
    // 21. 출고일 드롭다운 관련 [OK]
    // ===============================================
}

async function init() {
    setupEventListeners();
    loadInboundHistory();
    try {
        await loadConfig();
        await Promise.all([loadEditedCells(), loadStockLogFromFirebase(), syncOrderData(true)]);
        if(savedDates.length > 0) {
            updateSavedDatesFromCheckboxes(); 
            renderSelectedTags();
            applyDates();
        }
    } catch(e) { console.error(e); }
}
init();

// module 스크립트 특성상 전역 스코프에 함수를 노출 (인라인 이벤트 호환용)
window.handleStockLogUpload = handleStockLogUpload;
