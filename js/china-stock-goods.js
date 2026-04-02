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
let orderDataBuy = [];
let stockLogData = {};
let tableData = [];
let filteredData = [];
let editedCells = {};
let sortConfig = { key: '', direction: 'asc' };
let csvUrlOrder = '';
let csvUrlBuy = '';
let savedDates = []; // 선택된 날짜 목록 (Firebase 저장용)
let availableDates = []; // CSV에서 추출된 전체 날짜 정보 [{date, totalQty, skuCount}]
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
    document.querySelectorAll('.upload-menu').forEach(m => m.style.display = 'none');
}

// =========================================================
// 1. 출고일 목록 추출 로직
// =========================================================
function extractAvailableDates() {
    const dateMap = {}; // { '2026-03-27': { qty: 0, skus: Set } }
    
    const dateColsOrig = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qtyColsOrig  = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const dateColsBuy = ['1차패킹리스트출고일','2차패킹리스트출고일'];
    const qtyColsBuy  = ['1차패킹리스트출고수량','2차패킹리스트출고수량'];

    const processRows = (rows, dCols, qCols) => {
        rows.forEach(row => {
            dCols.forEach((dc, idx) => {
                const rawDate = row[dc];
                if (!rawDate) return;
                const normalized = normalizeDate(rawDate);
                if (!normalized || normalized.length < 10) return;
                
                const qty = parseInt(row[qCols[idx]]) || 0;
                if (!dateMap[normalized]) {
                    dateMap[normalized] = { qty: 0, skus: new Set() };
                }
                dateMap[normalized].qty += qty;
                dateMap[normalized].skus.add(row['상품코드'] || row['어드민상품코드']);
            });
        });
    };

    processRows(orderDataOriginal, dateColsOrig, qtyColsOrig);
    processRows(orderDataBuy, dateColsBuy, qtyColsBuy);

    // 객체를 배열로 변환 후 날짜 내림차순 정렬
    availableDates = Object.entries(dateMap).map(([date, info]) => ({
        date,
        totalQty: info.qty,
        skuCount: info.skus.size
    })).sort((a, b) => b.date.localeCompare(a.date));

    renderDateButtons();
}

function renderDateButtons() {
    const container = document.getElementById('date-list-container');
    if (!container) return;

    if (availableDates.length === 0) {
        container.innerHTML = '<span style="color:#888; font-size:13px;">오더리스트를 먼저 동기화하세요.</span>';
        return;
    }

    let html = '';
    availableDates.forEach(item => {
        const isSelected = savedDates.includes(item.date);
        const activeClass = isSelected ? 'selected' : '';
        const shortDate = item.date.split('-').slice(1).join('.'); // 03.27 형식
        
        html += `
            <button class="date-toggle-btn ${activeClass}" data-date="${item.date}">
                ${shortDate}출고 <br>
                <small>${item.skuCount}박스 (${item.totalQty.toLocaleString()}장)</small>
            </button>
        `;
    });
    container.innerHTML = html;

    // 버튼 이벤트 바인딩
    container.querySelectorAll('.date-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const date = btn.dataset.date;
            if (savedDates.includes(date)) {
                savedDates = savedDates.filter(d => d !== date);
                btn.classList.remove('selected');
            } else {
                savedDates.push(date);
                btn.classList.add('selected');
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
            savedDates = cfg.savedDates || []; // Firebase에서 선택된 날짜 복원
        }
    } catch (e) { console.error('설정 로드 실패:', e); }
}

async function saveConfig() {
    try {
        await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { 
            csvUrlOrder, 
            csvUrlBuy, 
            savedDates, // 현재 선택된 버튼 목록 저장
            updatedAt: new Date() 
        }, { merge: true });
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
            if (onProgress) onProgress(`🗑️ 기존 ${subCollection} 삭제 중...`);
            for (const d of existing.docs) {
                await deleteDoc(d.ref);
            }
        }

        const CHUNK_SIZE = 500; 
        const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);
        const batchTasks = [];

        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            const chunkIdx = Math.floor(i / CHUNK_SIZE);
            
            batchTasks.push(async () => {
                let retryCount = 0;
                while (retryCount < 3) {
                    try {
                        let b = writeBatch(db);
                        b.set(doc(db, collName, `CHUNK_${chunkIdx}`), { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
                        await b.commit();
                        if (onProgress) onProgress(`💾 ${subCollection} 저장 중... ${chunkIdx + 1}/${totalChunks}`);
                        return;
                    } catch (err) {
                        retryCount++;
                        if (retryCount >= 3) throw err;
                        await sleep(1000 * retryCount);
                    }
                }
            });
        }
        // 동시 실행 제어 (concurrency 2)
        let idx = 0;
        const workers = Array.from({ length: 2 }, async () => {
            while (idx < batchTasks.length) {
                const task = batchTasks[idx++];
                await task();
                await sleep(150);
            }
        });
        await Promise.all(workers);
        return totalChunks;
    } catch (e) { throw e; }
}

// =========================================================
// CSV fetch + 파싱
// =========================================================
async function fetchCSV(url) {
    let textData = '';
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('직접 연결 실패');
        textData = await res.text();
    } catch (e1) {
        try {
            const res2 = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
            if (!res2.ok) throw new Error('프록시1 실패');
            textData = await res2.text();
        } catch (e2) {
            const res3 = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
            if (!res3.ok) throw new Error('모든 프록시 실패');
            textData = await res3.text();
        }
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
// 동기화 로직 (메모리 로드)
// =========================================================
async function syncOrderData(silent = false) {
    if (!csvUrlOrder && !csvUrlBuy) {
        if(!silent) alert('CSV 시트 링크가 설정되지 않았습니다.');
        return;
    }
    if(!silent) showLoading('🔄 오더리스트 실시간 동기화 중...');
    
    try {
        const downloadTasks = [];
        if (csvUrlOrder) downloadTasks.push(fetchCSV(csvUrlOrder));
        else downloadTasks.push(Promise.resolve([]));
        
        if (csvUrlBuy) downloadTasks.push(fetchCSV(csvUrlBuy));
        else downloadTasks.push(Promise.resolve([]));

        const [dataOrder, dataBuy] = await Promise.all(downloadTasks);
        orderDataOriginal = dataOrder;
        orderDataBuy = dataBuy;

        // 동기화 완료 후 출고일 목록 추출
        extractAvailableDates();

        if(!silent) {
            hideLoading();
            showToast(`✅ 동기화 완료 (원본:${dataOrder.length} / 사입:${dataBuy.length})`);
        }
    } catch (e) {
        if(!silent) {
            hideLoading();
            alert('🚨 동기화 실패: ' + e.message);
        }
    }
}

// =========================================================
// 미발재고로그 업로드
// =========================================================
function handleStockLogUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    showLoading('📂 미발재고로그 분석 및 Firebase 저장 중...');

    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const text = evt.target.result;
            let rows = [];
            const ab = new Uint8Array(text.split('').map(c => c.charCodeAt(0))).buffer;
            const wb = XLSX.read(ab, { type: 'array' });
            rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).filter(r => r['상품코드']);

            stockLogData = {};
            rows.forEach(row => {
                const code = (row['상품코드'] || '').toString().trim();
                if (code) stockLogData[code] = row;
            });

            await saveChunkedData(rows, 'StockLog', (msg) => showLoading(msg));
            hideLoading();
            showToast(`✅ 미발재고로그 ${rows.length}건 저장 완료`);
            if (tableData.length > 0) applyDates();
        } catch (err) {
            hideLoading();
            alert('🚨 실패: ' + err.message);
        }
        e.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
}

// =========================================================
// 모달 제어 함수
// =========================================================
function openSheetSettingsModal() {
    const inputOrder = document.getElementById('modal-csv-order');
    const inputBuy = document.getElementById('modal-csv-buy');
    if (inputOrder) inputOrder.value = csvUrlOrder || '';
    if (inputBuy) inputBuy.value = csvUrlBuy || '';

    const modal = document.getElementById('sheet-settings-modal');
    if (modal) modal.style.display = 'flex';
}

function closeSheetSettingsModal() {
    const modal = document.getElementById('sheet-settings-modal');
    if (modal) modal.style.display = 'none';
}

async function saveSheetSettings() {
    csvUrlOrder = document.getElementById('modal-csv-order')?.value.trim() || '';
    csvUrlBuy = document.getElementById('modal-csv-buy')?.value.trim() || '';
    
    await saveConfig();
    closeSheetSettingsModal();
    showToast('✅ 설정 저장 완료');
    syncOrderData();
}

// =========================================================
// 출고일 적용 및 테이블 렌더링 (Ver 1.8 핵심 변경)
// =========================================================
function applyDates() {
    // 1. 선택된 버튼(savedDates) 기반으로 필터링
    if (savedDates.length === 0) { 
        alert('출고일 버튼을 1개 이상 선택해주세요.'); 
        return; 
    }

    saveConfig(); // 선택 상태 저장

    const dateColsOrig = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qtyColsOrig  = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const dateColsBuy = ['1차패킹리스트출고일','2차패킹리스트출고일'];
    const qtyColsBuy  = ['1차패킹리스트출고수량','2차패킹리스트출고수량'];

    let resultMap = {};

    const matchRows = (rows, dCols, qCols) => {
        rows.forEach(row => {
            const code = (row['어드민상품코드'] || row['상품코드'] || '').toString().trim();
            if (!code) return;
            
            let matched = false, totalQty = 0;
            dCols.forEach((dc, idx) => {
                const rd = normalizeDate(row[dc] || '');
                if (rd && savedDates.includes(rd)) { 
                    matched = true; 
                    totalQty += (parseInt(row[qCols[idx]]) || 0); 
                }
            });

            if (matched) {
                if (!resultMap[code]) {
                    resultMap[code] = { 
                        code, 
                        name: getProductName(row), 
                        option: row['옵션']||'', 
                        arrivalQty: 0, 
                        bigoY: row['비고']||'' 
                    };
                }
                resultMap[code].arrivalQty += totalQty;
            }
        });
    };

    matchRows(orderDataOriginal, dateColsOrig, qtyColsOrig);
    matchRows(orderDataBuy, dateColsBuy, qtyColsBuy);

    tableData = Object.values(resultMap).map(item => {
        const log = stockLogData[item.code] || {};
        const loc = (log['로케이션'] || '').toString().split('/')[0].trim();
        const edited = editedCells[item.code] || {};
        return {
            code: item.code, name: item.name, option: item.option,
            arrivalQty: item.arrivalQty,
            mibalQty: parseInt(log['부족수량']) || 0,
            totalStock: parseInt(log['정상재고']) || 0,
            location: loc,
            capacity: getCapacityByLocation(loc),
            confirmed: edited.confirmed || '',
            shortage: edited.shortage || '',
            directShip: item.bigoY || edited.directShip || '',
            memo: edited.memo || ''
        };
    }).filter(d => d.arrivalQty > 0);

    filteredData = [...tableData];
    renderTable();
    updateSummary();
    showToast(`✅ ${tableData.length}개 상품 매칭 완료`);
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!filteredData || filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" style="text-align:center; padding:50px; color:#888;">출고일을 선택하고 [적용] 버튼을 누르세요.</td></tr>';
        return;
    }
    let html = '';
    filteredData.forEach((row, idx) => {
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
            <td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="confirmed">${row.confirmed}</td>
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
    if (!keyword) { filteredData = [...tableData]; }
    else { filteredData = tableData.filter(d => d.code.toUpperCase().includes(keyword) || d.name.toUpperCase().includes(keyword) || d.option.toUpperCase().includes(keyword)); }
    renderTable();
    updateSummary();
}

function sortTable(key) {
    if (sortConfig.key === key) sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    else { sortConfig.key = key; sortConfig.direction = 'asc'; }
    filteredData.sort((a, b) => {
        let va = a[key], vb = b[key];
        if (typeof va === 'number' && typeof vb === 'number') return sortConfig.direction === 'asc' ? va - vb : vb - va;
        va = (va || '').toString(); vb = (vb || '').toString();
        return sortConfig.direction === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    renderTable();
}

function onCellEdit(el) {
    const code = el.dataset.code;
    const field = el.dataset.field;
    const value = el.textContent.trim();
    if (!editedCells[code]) editedCells[code] = {};
    editedCells[code][field] = value;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { saveEditedCells(); showToast('💾 자동 저장됨'); }, 1000);
}

// =========================================================
// 이벤트 리스너 바인딩
// =========================================================
function setupEventListeners() {
    document.getElementById('btn-toggle-menu')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = document.getElementById('main-tools-menu');
        if (menu) menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
    });
    document.addEventListener('click', () => closeAllMenus());
    document.getElementById('btn-sync-order')?.addEventListener('click', () => { closeAllMenus(); syncOrderData(); });
    document.getElementById('btn-open-sheet-settings')?.addEventListener('click', () => { closeAllMenus(); openSheetSettingsModal(); });
    document.getElementById('upload-stock-log')?.addEventListener('change', handleStockLogUpload);
    document.getElementById('btn-date-apply')?.addEventListener('click', applyDates);
    
    // 초기화 버튼 (버튼식)
    document.getElementById('btn-date-clear')?.addEventListener('click', () => {
        savedDates = [];
        tableData = [];
        filteredData = [];
        renderDateButtons();
        renderTable();
        updateSummary();
        saveConfig();
        showToast('🔄 선택이 해제되었습니다.');
    });

    document.getElementById('search-input')?.addEventListener('input', applySearch);
    document.querySelectorAll('.th-sortable').forEach(th => {
        th.addEventListener('click', () => sortTable(th.dataset.sort));
    });
    document.getElementById('table-body')?.addEventListener('focusout', (e) => {
        if (e.target.classList.contains('editable-cell')) onCellEdit(e.target);
    });
    document.getElementById('btn-sheet-save')?.addEventListener('click', saveSheetSettings);
    document.getElementById('btn-sheet-cancel')?.addEventListener('click', closeSheetSettingsModal);

    // 전체 초기화 (DB 데이터 삭제)
    document.getElementById('btn-clear-all')?.addEventListener('click', async () => {
        closeAllMenus();
        if (!confirm('미발재고로그와 모든 편집 내용을 초기화하시겠습니까?')) return;
        showLoading('🗑️ 초기화 중...');
        try {
            const snap = await getDocs(collection(db, CHINA_COLLECTION + '_StockLog'));
            for (const docSnap of snap.docs) { await deleteDoc(docSnap.ref); }
            await setDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'), { cells: {}, updatedAt: new Date() });
            stockLogData={}; tableData=[]; filteredData=[]; editedCells={};
            renderTable(); updateSummary(); hideLoading();
            alert('✅ 초기화 완료');
        } catch (e) { hideLoading(); alert('🚨 실패: ' + e.message); }
    });
}

// =========================================================
// 초기화
// =========================================================
async function init() {
    const badge = document.querySelector('.version-badge');
    if (badge) badge.innerHTML = '🚀 Ver 1.8';
    
    setupEventListeners();
    showLoading('📦 최신 데이터 동기화 및 로드 중...');

    await loadConfig();
    await Promise.all([
        loadEditedCells(),
        loadStockLogFromFirebase(),
        syncOrderData(true) // 로드 시 CSV fetch -> 날짜 추출까지 수행
    ]);

    hideLoading();
    // 데이터 로드 성공했고 저장된 날짜가 있다면 즉시 테이블 생성
    if (savedDates.length > 0 && (orderDataOriginal.length > 0 || orderDataBuy.length > 0)) {
        applyDates();
    }
}

init();
