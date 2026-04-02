// === js/china-stock-goods.js ===
// 중국제작 미발계산기 Ver 2.0 (실시간 앱 입고 수신 통합본)

import { initializeFirebase } from './config.js';
// [수정 5] onSnapshot, query, collection 추가
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
let inboundMap = {}; // [Ver 2.0 추가] 앱에서 들어온 상품별 입고 합산 데이터
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
// [Ver 2.0 신규] ① loadInboundHistory() 추가 (실시간 구독)
// ---------------------------------------------------------
function loadInboundHistory() {
    const q = query(collection(db, 'ChinaStockGoods_InboundHistory'));
    
    // onSnapshot으로 실시간 구독 시작
    onSnapshot(q, (snapshot) => {
        inboundMap = {}; // 수신 시마다 맵 초기화 후 재합산
        
        snapshot.forEach((doc) => {
            const data = doc.data();
            const code = data.barcode;
            const qty = parseInt(data.qty) || 0;
            
            if (code) {
                inboundMap[code] = (inboundMap[code] || 0) + qty;
            }
        });

        console.log("실시간 입고 데이터 수신됨:", inboundMap);
        
        // 현재 테이블 데이터가 존재한다면 렌더링만 다시 호출 (UI 실시간 업데이트)
        if (tableData.length > 0) {
            renderTable();
            updateSummary();
        }
    }, (error) => {
        console.error("InboundHistory 구독 에러:", error);
    });
}

// ---------------------------------------------------------
// 출고일 관련 로직 (기존 유지)
// ---------------------------------------------------------
function extractShipDates() {
    const checklistContainer = document.getElementById('date-checklist-container');
    if (!checklistContainer) return;
    const dateMap = {};
    const dateColsOrig = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qtyColsOrig  = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const inQtyColsOrig = ['1차실입고수량','2차실입고수량','3차실입고수량','4차실입고수량','5차실입고수량','6차실입고수량'];
    const inAmtColsOrig = ['1차실입고금액','2차실입고금액','3차실입고금액','4차실입고금액','5차실입고금액','6차실입고금액'];
    const process = (rows, dCols, qCols, iQCols, iACols) => {
        rows.forEach(row => {
            dCols.forEach((dc, idx) => {
                if (hasValue(row[iQCols[idx]]) || hasValue(row[iACols[idx]])) return;
                const normalized = normalizeDate(row[dc]);
                if (!normalized || normalized.length < 10) return;
                if (!dateMap[normalized]) dateMap[normalized] = { qty: 0, skus: new Set() };
                dateMap[normalized].qty += (parseInt(row[qCols[idx]]) || 0);
                dateMap[normalized].skus.add(row['상품코드'] || row['어드민상품코드']);
            });
        });
    };
    process(orderDataOriginal, dateColsOrig, qtyColsOrig, inQtyColsOrig, inAmtColsOrig);
    process(orderDataBuy, ['1차패킹리스트출고일','2차패킹리스트출고일'], ['1차패킹리스트출고수량','2차패킹리스트출고수량'], ['1차실입고수량','2차실입고수량'], ['1차실입고금액','2차실입고금액']);
    const sortedDates = Object.entries(dateMap).sort((a, b) => b[0].localeCompare(a[0]));
    if (sortedDates.length === 0) { checklistContainer.innerHTML = '<div style="color:#888; padding:10px;">미입고 데이터 없음</div>'; return; }
    let html = '';
    sortedDates.forEach(([date, info]) => {
        const isChecked = savedDates.includes(date) ? 'checked' : '';
        html += `<label class="date-item"><input type="checkbox" class="date-check" value="${date}" ${isChecked}><span>${date} (${info.skus.size}종 / ${info.qty.toLocaleString()}장)</span></label>`;
    });
    checklistContainer.innerHTML = html;
    checklistContainer.querySelectorAll('.date-check').forEach(ck => { ck.addEventListener('change', () => { updateSavedDatesFromCheckboxes(); renderSelectedTags(); }); });
    renderSelectedTags();
}

function updateSavedDatesFromCheckboxes() {
    const checks = document.querySelectorAll('.date-check:checked');
    savedDates = Array.from(checks).map(c => c.value);
    const btn = document.getElementById('btn-date-dropdown');
    if (btn) btn.innerText = savedDates.length > 0 ? `▼ ${savedDates.length}개 선택됨` : `▼ 출고일 선택`;
}

function renderSelectedTags() {
    const container = document.getElementById('date-tags-container'); if (!container) return;
    if (savedDates.length === 0) { container.innerHTML = '<span class="no-selection-text">선택된 출고일 없음</span>'; return; }
    const sorted = [...savedDates].sort((a, b) => b.localeCompare(a));
    let html = '';
    sorted.forEach(date => { html += `<div class="date-tag">${date} <span class="remove-btn" data-date="${date}">✕</span></div>`; });
    container.innerHTML = html;
    container.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const date = btn.dataset.date;
            savedDates = savedDates.filter(d => d !== date);
            const ck = document.querySelector(`.date-check[value="${date}"]`); if (ck) ck.checked = false;
            updateSavedDatesFromCheckboxes(); renderSelectedTags();
        });
    });
}

// Firebase 로직
async function loadConfig() { try { const snap = await getDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC)); if (snap.exists()) { const cfg = snap.data(); csvUrlOrder = cfg.csvUrlOrder || ''; csvUrlBuy = cfg.csvUrlBuy || ''; savedDates = cfg.savedDates || []; } } catch (e) {} }
async function saveConfig() { try { await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { csvUrlOrder, csvUrlBuy, savedDates, updatedAt: new Date() }, { merge: true }); } catch (e) {} }
async function loadEditedCells() { try { const snap = await getDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS')); if (snap.exists()) editedCells = snap.data().cells || {}; } catch (e) {} }
async function saveEditedCells() { try { await setDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'), { cells: editedCells, updatedAt: new Date() }); } catch (e) {} }
async function loadStockLogFromFirebase() { try { stockLogData = {}; const snap = await getDocs(collection(db, CHINA_COLLECTION + '_StockLog')); snap.forEach(d => { const data = d.data(); if (data.dataStr) { JSON.parse(data.dataStr).forEach(row => { const code = (row['상품코드'] || '').toString().trim(); if (code) stockLogData[code] = row; }); } }); } catch (e) {} }

async function saveChunkedData(rows, subCollection, onProgress) {
    const collName = CHINA_COLLECTION + '_' + subCollection;
    try {
        const existing = await getDocs(collection(db, collName));
        if (existing.size > 0) { for (const d of existing.docs) { await deleteDoc(d.ref); } }
        const CHUNK_SIZE = 500;
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);
            batch.set(doc(db, collName, `CHUNK_${Math.floor(i/CHUNK_SIZE)}`), { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            await batch.commit();
            if (onProgress) onProgress(`💾 ${subCollection} 저장 중...`);
            await sleep(150);
        }
    } catch (e) { throw e; }
}

async function fetchCSV(url) {
    let textData = '';
    try { const res = await fetch(url); textData = await res.text(); }
    catch (e) { const res2 = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`); textData = await res2.text(); }
    const wb = XLSX.read(textData, { type: 'string' });
    const rawData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    let headerIdx = -1, headers = [];
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
        const cl = rawData[i].map(h => cleanKey(h));
        if (cl.includes('어드민상품코드') || cl.includes('상품코드')) { headerIdx = i; headers = cl; break; }
    }
    const result = [];
    for (let i = headerIdx + 1; i < rawData.length; i++) {
        let obj = {}, empty = true;
        for (let j = 0; j < headers.length; j++) { if (headers[j]) { obj[headers[j]] = rawData[i][j]; if (rawData[i][j] !== '') empty = false; } }
        if (!empty) result.push(obj);
    }
    return result;
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

function handleStockLogUpload(e) {
    const file = e.target.files[0]; if (!file) return;
    showLoading('📂 미발재고로그 저장 중...');
    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const wb = XLSX.read(evt.target.result, { type: 'binary' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).filter(r => r['상품코드']);
            stockLogData = {}; rows.forEach(row => { const code = (row['상품코드'] || '').toString().trim(); if (code) stockLogData[code] = row; });
            await saveChunkedData(rows, 'StockLog', (msg) => showLoading(msg));
            hideLoading(); showToast('✅ 저장 완료');
            if (tableData.length > 0) applyDates();
        } catch (err) { hideLoading(); }
        e.target.value = '';
    };
    reader.readAsBinaryString(file);
}

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
// [수정 2] applyDates() - inboundMap 데이터 매칭 로직 추가
// ---------------------------------------------------------
function applyDates() {
    const inputDates = savedDates; if (inputDates.length === 0) { alert('출고일을 선택하세요.'); return; }
    saveConfig();
    const dateColsOrig = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qtyColsOrig  = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const inQtyColsOrig = ['1차실입고수량','2차실입고수량','3차실입고수량','4차실입고수량','5차실입고수량','6차실입고수량'];
    const inAmtColsOrig = ['1차실입고금액','2차실입고금액','3차실입고금액','4차실입고금액','5차실입고금액','6차실입고금액'];
    let resultMap = {};
    const match = (rows, dCols, qCols, iQCols, iACols) => {
        rows.forEach(row => {
            const code = (row['어드민상품코드'] || row['상품코드'] || '').toString().trim(); if (!code) return;
            let matched = false, totalQty = 0;
            dCols.forEach((dc, idx) => {
                if (hasValue(row[iQCols[idx]]) || hasValue(row[iACols[idx]])) return;
                const rd = normalizeDate(row[dc] || '');
                if (rd && inputDates.includes(rd)) { matched = true; totalQty += (parseInt(row[qCols[idx]]) || 0); }
            });
            if (matched) {
                if (!resultMap[code]) resultMap[code] = { code, name: getProductName(row), option: row['옵션']||'', arrivalQty: 0, bigoY: row['비고']||'' };
                resultMap[code].arrivalQty += totalQty;
            }
        });
    };
    match(orderDataOriginal, dateColsOrig, qtyColsOrig, inQtyColsOrig, inAmtColsOrig);
    match(orderDataBuy, ['1차패킹리스트출고일','2차패킹리스트출고일'], ['1차패킹리스트출고수량','2차패킹리스트출고수량'], ['1차실입고수량','2차실입고수량'], ['1차실입고금액','2차실입고금액']);
    
    tableData = Object.values(resultMap).map(item => {
        const log = stockLogData[item.code] || {}; 
        const edited = editedCells[item.code] || {}; 
        const loc = (log['로케이션'] || '').toString().split('/')[0].trim();
        
        // [Ver 2.0] 앱 수신값이 있으면 우선 사용, 없으면 수동 편집값 사용
        const confirmedVal = inboundMap[item.code] || edited.confirmed || '';

        return {
            code: item.code, name: item.name, option: item.option, arrivalQty: item.arrivalQty,
            mibalQty: parseInt(log['부족수량']) || 0, totalStock: parseInt(log['정상재고']) || 0,
            location: loc, capacity: getCapacityByLocation(loc),
            confirmed: confirmedVal, 
            shortage: edited.shortage || '', 
            directShip: item.bigoY || edited.directShip || '', 
            memo: edited.memo || ''
        };
    }).filter(d => d.arrivalQty > 0);
    filteredData = [...tableData]; renderTable(); updateSummary(); showToast('✅ 매칭 완료');
}

function clearDates() {
    savedDates = []; document.querySelectorAll('.date-check').forEach(btn => btn.checked = false);
    updateSavedDatesFromCheckboxes(); renderSelectedTags();
    tableData = []; filteredData = []; renderTable(); updateSummary(); saveConfig(); showToast('🔄 초기화 완료');
}

// ---------------------------------------------------------
// [수정 3] renderTable() - 입고확인 칸 스타일 구분 로직 추가
// ---------------------------------------------------------
function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!filteredData.length) { tbody.innerHTML = '<tr><td colspan="13" style="text-align:center; padding:50px; color:#888;">출고일을 선택하세요.</td></tr>'; return; }
    let html = '';
    
    filteredData.forEach((row, idx) => {
        // [Ver 2.0] 앱에서 들어온 값(inboundMap)인 경우 파란색 스타일 적용
        const isFromApp = inboundMap[row.code] !== undefined;
        const confirmStyle = isFromApp ? 'color: #1976d2; font-weight: 900;' : '';
        const displayConfirmed = row.confirmed || '';

        html += `<tr>
            <td>${idx + 1}</td>
            <td class="code-cell" data-code="${row.code}">${row.code}</td>
            <td style="text-align:left;">${row.name}</td>
            <td>${row.option}</td>
            <td style="font-weight:bold;">${row.arrivalQty.toLocaleString()}</td>
            <td style="color:${row.mibalQty > 0 ? '#d32f2f' : '#333'}; font-weight:bold;">${row.mibalQty.toLocaleString()}</td>
            <td>${row.totalStock.toLocaleString()}</td>
            <td>${row.location}</td>
            <td class="capacity-auto">${row.capacity || '-'}</td>
            <td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="confirmed" style="${confirmStyle}">${displayConfirmed}</td>
            <td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="shortage">${row.shortage}</td>
            <td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="directShip">${row.directShip}</td>
            <td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="memo">${row.memo}</td>
        </tr>`;
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

function setupEventListeners() {
    document.getElementById('btn-toggle-menu')?.addEventListener('click', (e) => {
        e.stopPropagation(); const menu = document.getElementById('main-tools-menu');
        if (menu) menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
        const popup = document.getElementById('date-dropdown-popup'); if (popup) popup.style.display = 'none';
    });
    document.getElementById('btn-date-dropdown')?.addEventListener('click', (e) => {
        e.stopPropagation(); const popup = document.getElementById('date-dropdown-popup');
        const isVisible = popup?.style.display === 'block'; if (popup) popup.style.display = isVisible ? 'none' : 'block';
        const menu = document.getElementById('main-tools-menu'); if (menu) menu.style.display = 'none';
    });
    document.getElementById('date-dropdown-popup')?.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => closeAllMenus());
    document.getElementById('btn-date-all')?.addEventListener('click', () => { document.querySelectorAll('.date-check').forEach(ck => ck.checked = true); updateSavedDatesFromCheckboxes(); renderSelectedTags(); });
    document.getElementById('btn-date-none')?.addEventListener('click', () => { document.querySelectorAll('.date-check').forEach(ck => ck.checked = false); updateSavedDatesFromCheckboxes(); renderSelectedTags(); });
    document.getElementById('btn-sync-order')?.addEventListener('click', () => { closeAllMenus(); syncOrderData(); });
    document.getElementById('btn-open-sheet-settings')?.addEventListener('click', () => { 
        closeAllMenus(); document.getElementById('modal-csv-order').value = csvUrlOrder; document.getElementById('modal-csv-buy').value = csvUrlBuy;
        const modal = document.getElementById('sheet-settings-modal'); if (modal) modal.style.display = 'flex';
    });
    document.getElementById('btn-sheet-save')?.addEventListener('click', async () => {
        csvUrlOrder = document.getElementById('modal-csv-order')?.value.trim() || ''; csvUrlBuy = document.getElementById('modal-csv-buy')?.value.trim() || '';
        await saveConfig(); document.getElementById('sheet-settings-modal').style.display = 'none'; showToast('저장 완료'); syncOrderData();
    });
    document.getElementById('btn-sheet-cancel')?.addEventListener('click', () => { document.getElementById('sheet-settings-modal').style.display = 'none'; });
    document.getElementById('upload-stock-log')?.addEventListener('change', handleStockLogUpload);
    document.getElementById('btn-date-apply')?.addEventListener('click', applyDates);
    document.getElementById('btn-date-clear')?.addEventListener('click', clearDates);
    document.getElementById('btn-upload-scandb')?.addEventListener('click', uploadScanDB);
    document.getElementById('search-input')?.addEventListener('input', applySearch);
    document.getElementById('btn-excel-download')?.addEventListener('click', () => {
        if (!filteredData.length) return;
        const headers = ['상품코드','수량']; let html = '<table><tr><th>상품코드</th><th>수량</th></tr>';
        filteredData.forEach(r => html += `<tr><td>${r.code}</td><td>${r.arrivalQty}</td></tr>`);
        html += '</table>';
        const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '미발계산기.xls'; a.click();
    });
    document.querySelectorAll('.th-sortable').forEach(th => th.addEventListener('click', () => sortTable(th.dataset.sort)));
    document.getElementById('table-body')?.addEventListener('focusout', (e) => { if (e.target.classList.contains('editable-cell')) {
        const code = e.target.dataset.code; const field = e.target.dataset.field; const value = e.target.textContent.trim();
        if (!editedCells[code]) editedCells[code] = {}; editedCells[code][field] = value;
        clearTimeout(saveTimeout); saveTimeout = setTimeout(() => { saveEditedCells(); showToast('💾 자동 저장됨'); }, 1000);
    }});
    document.getElementById('table-body')?.addEventListener('click', (e) => { if (e.target.classList.contains('code-cell')) { const code = e.target.dataset.code; if (code) navigator.clipboard.writeText(code).then(() => showToast(`📋 ${code} 복사됨`)); } });
}

// ---------------------------------------------------------
// [수정 4] init() - loadInboundHistory() 호출 추가
// ---------------------------------------------------------
async function init() {
    setupEventListeners(); showLoading('📦 데이터 로드 중...');
    
    // Ver 2.0: 실시간 수신 대기 시작 (await 하지 않음)
    loadInboundHistory();

    try {
        await loadConfig(); 
        await Promise.all([
            loadEditedCells(), 
            loadStockLogFromFirebase(), 
            syncOrderData(true)
        ]);
        const btn = document.getElementById('btn-date-dropdown'); if (btn && savedDates.length > 0) btn.innerText = `▼ ${savedDates.length}개 선택됨`;
        hideLoading(); 
        if (savedDates.length > 0 && tableData.length === 0) applyDates();
    } catch (e) { console.error(e); hideLoading(); }
}
init();
