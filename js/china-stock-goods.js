// === js/china-stock-goods.js ===
// 중국제작 미발계산기 Ver 1.8.1 (긴급 수정본: 이벤트 바인딩 강화)

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
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'flex';
}
function hideLoading() { 
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none'; 
}

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
    const menu = document.getElementById('main-tools-menu');
    if (menu) menu.style.display = 'none';
    const popup = document.getElementById('date-dropdown-popup');
    if (popup) popup.style.display = 'none';
}

// =========================================================
// [기능 함수] (이벤트 바인딩에서 참조하는 핵심 로직)
// =========================================================

function updateSavedDatesFromCheckboxes() {
    const checks = document.querySelectorAll('.date-check:checked');
    savedDates = Array.from(checks).map(c => c.value);
    const btn = document.getElementById('btn-date-dropdown');
    if (btn) {
        btn.innerText = savedDates.length > 0 ? `▼ ${savedDates.length}개 선택됨` : `▼ 출고일 선택`;
    }
}

function renderSelectedTags() {
    const container = document.getElementById('date-tags-container');
    if (!container) return;

    if (savedDates.length === 0) {
        container.innerHTML = '<span class="no-selection-text">선택된 출고일 없음</span>';
        return;
    }

    const sorted = [...savedDates].sort((a, b) => b.localeCompare(a));
    let html = '';
    sorted.forEach(date => {
        html += `<div class="date-tag">${date} <span class="remove-btn" data-date="${date}">✕</span></div>`;
    });
    container.innerHTML = html;

    container.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const date = btn.dataset.date;
            savedDates = savedDates.filter(d => d !== date);
            const ck = document.querySelector(`.date-check[value="${date}"]`);
            if (ck) ck.checked = false;
            updateSavedDatesFromCheckboxes();
            renderSelectedTags();
        });
    });
}

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

    checklistContainer.querySelectorAll('.date-check').forEach(ck => {
        ck.addEventListener('change', () => {
            updateSavedDatesFromCheckboxes();
            renderSelectedTags();
        });
    });

    renderSelectedTags();
}

// [나머지 Firebase, CSV 파싱 로직은 기존과 동일하되 내부 에러 방지 처리됨]
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
                if (rd && inputDates.includes(rd)) { matched = true; totalQty += (parseInt(row[qCols[idx] || qtyColsOrig[idx]]) || 0); }
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
        const loc = (log['로케이션'] || '').toString().split('/')[0].trim();
        return {
            code: item.code, name: item.name, option: item.option, arrivalQty: item.arrivalQty,
            mibalQty: parseInt(log['부족수량']) || 0, totalStock: parseInt(log['정상재고']) || 0,
            location: loc,
            capacity: getCapacityByLocation(loc),
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
// [체크리스트 1] setupEventListeners() 함수 존재 확인 및 바인딩
// =========================================================
function setupEventListeners() {
    // 1. 작업 메뉴 토글
    document.getElementById('btn-toggle-menu')?.addEventListener('click', (e) => {
        e.stopPropagation(); 
        const menu = document.getElementById('main-tools-menu');
        if (menu) menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
        const popup = document.getElementById('date-dropdown-popup');
        if (popup) popup.style.display = 'none';
    });

    // 2. 출고일 드롭다운 토글
    document.getElementById('btn-date-dropdown')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const popup = document.getElementById('date-dropdown-popup');
        const isVisible = popup?.style.display === 'block';
        if (popup) popup.style.display = isVisible ? 'none' : 'block';
        const menu = document.getElementById('main-tools-menu');
        if (menu) menu.style.display = 'none';
    });

    // 3. 팝업 내부 클릭 시 닫힘 방지
    document.getElementById('date-dropdown-popup')?.addEventListener('click', (e) => e.stopPropagation());

    // 4. 전체 클릭 시 모든 팝업/메뉴 닫기
    document.addEventListener('click', () => closeAllMenus());

    // 5. 드롭다운 팝업 내 전체 선택/해제
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

    // 6. 오더리스트 동기화
    document.getElementById('btn-sync-order')?.addEventListener('click', () => { closeAllMenus(); syncOrderData(); });
    
    // 7. CSV 링크 설정 모달 열기
    document.getElementById('btn-open-sheet-settings')?.addEventListener('click', () => { 
        closeAllMenus();
        const orderInput = document.getElementById('modal-csv-order');
        const buyInput = document.getElementById('modal-csv-buy');
        if (orderInput) orderInput.value = csvUrlOrder;
        if (buyInput) buyInput.value = csvUrlBuy;
        const modal = document.getElementById('sheet-settings-modal');
        if (modal) modal.style.display = 'flex';
    });
    
    // 8. 모달 저장
    document.getElementById('btn-sheet-save')?.addEventListener('click', async () => {
        csvUrlOrder = document.getElementById('modal-csv-order')?.value.trim() || '';
        csvUrlBuy = document.getElementById('modal-csv-buy')?.value.trim() || '';
        await saveConfig(); 
        const modal = document.getElementById('sheet-settings-modal');
        if (modal) modal.style.display = 'none';
        showToast('저장 완료'); syncOrderData();
    });
    
    // 9. 모달 취소
    document.getElementById('btn-sheet-cancel')?.addEventListener('click', () => {
        const modal = document.getElementById('sheet-settings-modal');
        if (modal) modal.style.display = 'none';
    });

    // 10. 모달 바깥 클릭 닫기
    document.getElementById('sheet-settings-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'sheet-settings-modal') e.target.style.display = 'none';
    });

    // 11. 미발재고로그 업로드
    document.getElementById('upload-stock-log')?.addEventListener('change', handleStockLogUpload);

    // 12. 적용/초기화
    document.getElementById('btn-date-apply')?.addEventListener('click', applyDates);
    document.getElementById('btn-date-clear')?.addEventListener('click', clearDates);

    // 13. 검색
    document.getElementById('search-input')?.addEventListener('input', applySearch);

    // 14. 엑셀 다운로드
    document.getElementById('btn-excel-download')?.addEventListener('click', () => {
        if (!filteredData.length) return;
        const headers = ['상품코드','수량']; let html = '<table><tr><th>상품코드</th><th>수량</th></tr>';
        filteredData.forEach(r => html += `<tr><td>${r.code}</td><td>${r.arrivalQty}</td></tr>`);
        html += '</table>';
        const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '미발계산기.xls'; a.click();
    });

    // 15. 정렬
    document.querySelectorAll('.th-sortable').forEach(th => th.addEventListener('click', () => sortTable(th.dataset.sort)));
    
    // 16. 테이블 편집 및 복사
    document.getElementById('table-body')?.addEventListener('focusout', (e) => {
        if (e.target.classList.contains('editable-cell')) onCellEdit(e.target);
    });
    document.getElementById('table-body')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('code-cell')) {
            const code = e.target.dataset.code;
            if (code) {
                navigator.clipboard.writeText(code).then(() => showToast(`📋 ${code} 복사됨`));
            }
        }
    });
}

// =========================================================
// [체크리스트 2] init() 함수 안에서 setupEventListeners() 호출 확인
// =========================================================
async function init() {
    // 1. 이벤트 바인딩을 가장 먼저 실행 (에러 발생 전 클릭은 가능하게)
    setupEventListeners();

    showLoading('📦 데이터 로드 중...');
    
    try {
        await loadConfig();
        await Promise.all([loadEditedCells(), loadStockLogFromFirebase(), syncOrderData(true)]);
        
        // 초기화 시 드롭다운 텍스트 업데이트
        const btn = document.getElementById('btn-date-dropdown');
        if (btn && savedDates.length > 0) btn.innerText = `▼ ${savedDates.length}개 선택됨`;

        hideLoading();
        if (savedDates.length > 0 && tableData.length === 0) applyDates();
    } catch (e) {
        console.error("초기화 중 오류 발생:", e);
        hideLoading();
        // 에러가 나더라도 setupEventListeners가 이미 실행되었으므로 버튼은 작동 시도 가능
    }
}

init();
