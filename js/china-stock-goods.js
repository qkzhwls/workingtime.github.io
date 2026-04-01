// === js/china-stock-goods.js ===
// 중국제작 미발계산기 Ver 1.7

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
    document.getElementById('loading-text').innerText = text;
    document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }

function showToast(msg) {
    const t = document.getElementById('toast');
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

// 동시 실행 제어 및 지연 추가 (할당량 초과 방지)
async function runConcurrent(tasks, concurrency = 2) {
    const results = [];
    let idx = 0;
    async function worker() {
        while (idx < tasks.length) {
            const i = idx++;
            results[i] = await tasks[i]();
            await sleep(150); // 배치 사이의 미세 지연
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

// =========================================================
// Firebase 로드/저장 (Order/Buy 저장 코드 삭제됨)
// =========================================================
async function loadConfig() {
    try {
        const snap = await getDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC));
        if (snap.exists()) {
            const cfg = snap.data();
            csvUrlOrder = cfg.csvUrlOrder || '';
            csvUrlBuy = cfg.csvUrlBuy || '';
            savedDates = cfg.savedDates || [];
            savedDates.forEach((d, i) => {
                const el = document.getElementById(`date-${i + 1}`);
                if (el && d) el.value = d;
            });
        }
    } catch (e) { console.error('설정 로드 실패:', e); }
}

async function saveConfig() {
    try {
        const dates = [];
        for (let i = 1; i <= 8; i++) dates.push(document.getElementById(`date-${i}`)?.value || '');
        await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { csvUrlOrder, csvUrlBuy, savedDates: dates, updatedAt: new Date() }, { merge: true });
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

// ★ Ver 1.7: StockLog 전용 고성능 저장 (Retry 로직 포함)
async function saveChunkedData(rows, subCollection, onProgress) {
    const collName = CHINA_COLLECTION + '_' + subCollection;
    try {
        const existing = await getDocs(collection(db, collName));
        if (existing.size > 0) {
            if (onProgress) onProgress(`🗑️ 기존 ${subCollection} 삭제 중...`);
            const delDocs = existing.docs;
            // 삭제는 안정성을 위해 순차적으로 처리
            for (const d of delDocs) {
                await deleteDoc(d.ref);
            }
        }

        const CHUNK_SIZE = 500; // 청크 크기 대폭 상향
        const BATCH_LIMIT = 1;  // Quota 안전을 위해 1배치당 1청크
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
                        b.set(doc(db, collName, `CHUNK_${chunkIdx}`), { 
                            dataStr: JSON.stringify(chunk), 
                            updatedAt: new Date() 
                        });
                        await b.commit();
                        if (onProgress) onProgress(`💾 ${subCollection} 저장 중... ${chunkIdx + 1}/${totalChunks}`);
                        return;
                    } catch (err) {
                        retryCount++;
                        if (retryCount >= 3) throw err;
                        await sleep(1000 * retryCount); // 지수 백오프
                    }
                }
            });
        }
        await runConcurrent(batchTasks, 2); // 동시성 2로 제한
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
// ★ Ver 1.7: 오더리스트 시트 동기화 (Firebase 저장 없이 메모리 로드만)
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

        if(!silent) {
            hideLoading();
            showToast(`✅ 동기화 완료 (원본:${dataOrder.length} / 사입:${dataBuy.length})`);
        }
    } catch (e) {
        if(!silent) {
            hideLoading();
            alert('🚨 동기화 실패: ' + e.message);
        }
        console.error('동기화 에러:', e);
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

            if (text.trim().startsWith('<') || text.includes('<table') || text.includes('<html')) {
                const parser = new DOMParser();
                const htmlDoc = parser.parseFromString(text, 'text/html');
                const table = htmlDoc.querySelector('table');
                if (!table) throw new Error('HTML 테이블 오류');
                const trs = table.querySelectorAll('tr');
                let headers = [];
                trs.forEach((tr, idx) => {
                    const cells = tr.querySelectorAll('td, th');
                    const vals = Array.from(cells).map(c => c.textContent.trim());
                    if (idx === 0) headers = vals;
                    else {
                        let obj = {};
                        vals.forEach((v, j) => { if (headers[j]) obj[headers[j]] = v; });
                        if (obj['상품코드']) rows.push(obj);
                    }
                });
            } else {
                const ab = new Uint8Array(text.split('').map(c => c.charCodeAt(0))).buffer;
                const wb = XLSX.read(ab, { type: 'array' });
                rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).filter(r => r['상품코드']);
            }

            stockLogData = {};
            rows.forEach(row => {
                const code = (row['상품코드'] || '').toString().trim();
                if (code) stockLogData[code] = row;
            });

            await saveChunkedData(rows, 'StockLog', (msg) => showLoading(msg));
            hideLoading();
            showToast(`✅ 미발재고로그 ${rows.length}건 저장 완료`);
            if (tableData.length > 0) buildTableFromData();
        } catch (err) {
            hideLoading();
            alert('🚨 실패: ' + err.message);
        }
        e.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
}

// =========================================================
// 출고일 적용 → 테이블 생성 (기존 유지)
// =========================================================
function applyDates() {
    const inputDates = [];
    for (let i = 1; i <= 8; i++) {
        const val = document.getElementById(`date-${i}`)?.value;
        if (val) inputDates.push(normalizeDate(val));
    }
    if (inputDates.length === 0) { alert('출고일을 입력해주세요.'); return; }

    saveConfig();

    const dateColsOrig = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qtyColsOrig  = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const dateColsBuy = ['1차패킹리스트출고일','2차패킹리스트출고일'];
    const qtyColsBuy  = ['1차패킹리스트출고수량','2차패킹리스트출고수량'];

    let resultMap = {};

    orderDataOriginal.forEach(row => {
        const code = (row['어드민상품코드'] || row['상품코드'] || '').toString().trim();
        if (!code) return;
        let matched = false, totalQty = 0;
        dateColsOrig.forEach((dc, idx) => {
            const rd = normalizeDate(row[dc] || '');
            if (rd && inputDates.includes(rd)) { matched = true; totalQty += (parseInt(row[qtyColsOrig[idx]]) || 0); }
        });
        if (matched) {
            if (!resultMap[code]) resultMap[code] = { code, name: getProductName(row), option: row['옵션']||'', arrivalQty: 0, bigoY: row['비고']||'' };
            resultMap[code].arrivalQty += totalQty;
        }
    });

    orderDataBuy.forEach(row => {
        const code = (row['어드민상품코드'] || row['상품코드'] || '').toString().trim();
        if (!code) return;
        let matched = false, totalQty = 0;
        dateColsBuy.forEach((dc, idx) => {
            const rd = normalizeDate(row[dc] || '');
            if (rd && inputDates.includes(rd)) { matched = true; totalQty += (parseInt(row[qtyColsBuy[idx]]) || 0); }
        });
        if (matched) {
            if (!resultMap[code]) resultMap[code] = { code, name: getProductName(row), option: row['옵션']||'', arrivalQty: 0, bigoY: '' };
            resultMap[code].arrivalQty += totalQty;
        }
    });

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

function clearDates() {
    for (let i = 1; i <= 8; i++) { const el = document.getElementById(`date-${i}`); if (el) el.value = ''; }
    tableData = []; filteredData = [];
    renderTable(); updateSummary(); saveConfig();
}

// =========================================================
// 테이블 렌더링 & 검색/정렬 (기존 유지)
// =========================================================
function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!filteredData || filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" style="text-align:center; padding:50px; color:#888;">데이터를 불러온 후 출고일을 선택하세요.</td></tr>';
        return;
    }
    let html = '';
    filteredData.forEach((row, idx) => {
        html += `<tr>
            <td style="color:#888; font-size:12px;">${idx + 1}</td>
            <td class="code-cell" data-code="${row.code}">${row.code}</td>
            <td style="text-align:left; padding-left:10px;">${row.name}</td>
            <td style="font-size:12px;">${row.option}</td>
            <td style="font-weight:bold;">${row.arrivalQty.toLocaleString()}</td>
            <td style="font-weight:bold; color:${row.mibalQty > 0 ? '#d32f2f' : '#333'};">${row.mibalQty.toLocaleString()}</td>
            <td>${row.totalStock.toLocaleString()}</td>
            <td style="font-size:12px;">${row.location}</td>
            <td class="capacity-auto">${row.capacity || '-'}</td>
            <td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="confirmed">${row.confirmed}</td>
            <td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="shortage">${row.shortage}</td>
            <td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="directShip">${row.directShip}</td>
            <td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="memo">${row.memo}</td>
        </tr>`;
    });
    tbody.innerHTML = html;
}

function buildTableFromData() {
    tableData.forEach(item => {
        const log = stockLogData[item.code] || {};
        const loc = (log['로케이션'] || '').toString().split('/')[0].trim();
        item.totalStock = parseInt(log['정상재고']) || 0;
        item.mibalQty = parseInt(log['부족수량']) || 0;
        item.location = loc;
        item.capacity = getCapacityByLocation(loc);
    });
    filteredData = [...tableData];
    applySearch();
    renderTable();
    updateSummary();
}

function updateSummary() {
    document.getElementById('sum-sku').textContent = filteredData.length.toLocaleString();
    document.getElementById('sum-arrival').textContent = filteredData.reduce((s, d) => s + (d.arrivalQty || 0), 0).toLocaleString();
    document.getElementById('sum-mibal').textContent = filteredData.reduce((s, d) => s + (d.mibalQty || 0), 0).toLocaleString();
}

let saveTimeout = null;
function onCellEdit(el) {
    const code = el.dataset.code;
    const field = el.dataset.field;
    const value = el.textContent.trim();
    if (!editedCells[code]) editedCells[code] = {};
    editedCells[code][field] = value;
    const item = tableData.find(d => d.code === code);
    if (item) item[field] = value;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { saveEditedCells(); showToast('💾 자동 저장됨'); }, 1000);
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

function downloadExcel() {
    if (!filteredData || filteredData.length === 0) { alert('데이터가 없습니다.'); return; }
    const headers = ['상품코드','상품명','옵션명','도착수량','미발수량','총재고','로케이션','적재량','입고확인','부족수량','직진배송','비고'];
    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style>td{mso-number-format:"\\@";}.header{font-weight:bold;background:#FFE0B2;text-align:center;border:1px solid #ccc;padding:6px;}.cell{border:1px solid #ddd;padding:4px 8px;text-align:center;}.num{mso-number-format:"0";text-align:right;}</style><table>`;
    html += `<tr>${headers.map(h=>`<td class="header">${h}</td>`).join('')}</tr>`;
    filteredData.forEach(r => {
        html += `<tr><td class="cell">${r.code}</td><td>${r.name}</td><td>${r.option}</td><td class="num">${r.arrivalQty}</td><td class="num">${r.mibalQty}</td><td class="num">${r.totalStock}</td><td>${r.location}</td><td class="num">${r.capacity||''}</td><td>${r.confirmed||''}</td><td>${r.shortage||''}</td><td>${r.directShip||''}</td><td>${r.memo||''}</td></tr>`;
    });
    html += '</table></html>';
    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `미발계산기_${new Date().toISOString().slice(0,10)}.xls`;
    a.click();
}

async function clearAllData() {
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
}

function openSheetSettingsModal() {
    document.getElementById('modal-csv-order').value = csvUrlOrder || '';
    document.getElementById('modal-csv-buy').value = csvUrlBuy || '';
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
    showToast('✅ 저장 완료. 데이터를 동기화합니다.');
    syncOrderData();
}

function setupEventListeners() {
    document.getElementById('btn-toggle-menu')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = document.getElementById('main-tools-menu');
        const isVisible = menu.style.display === 'block';
        closeAllMenus();
        if (!isVisible) menu.style.display = 'block';
    });
    document.addEventListener('click', () => closeAllMenus());
    document.getElementById('btn-sync-order')?.addEventListener('click', () => { closeAllMenus(); syncOrderData(); });
    document.getElementById('btn-open-sheet-settings')?.addEventListener('click', () => { closeAllMenus(); openSheetSettingsModal(); });
    document.getElementById('btn-clear-all')?.addEventListener('click', () => { closeAllMenus(); clearAllData(); });
    document.getElementById('upload-stock-log')?.addEventListener('change', handleStockLogUpload);
    document.getElementById('btn-date-apply')?.addEventListener('click', applyDates);
    document.getElementById('btn-date-clear')?.addEventListener('click', clearDates);
    document.getElementById('btn-excel-download')?.addEventListener('click', downloadExcel);
    document.getElementById('search-input')?.addEventListener('input', applySearch);
    document.querySelectorAll('.th-sortable').forEach(th => {
        th.addEventListener('click', () => sortTable(th.dataset.sort));
    });
    document.getElementById('table-body')?.addEventListener('focusout', (e) => {
        if (e.target.classList.contains('editable-cell')) onCellEdit(e.target);
    });
    document.getElementById('btn-sheet-cancel')?.addEventListener('click', closeSheetSettingsModal);
    document.getElementById('btn-sheet-save')?.addEventListener('click', saveSheetSettings);
}

// =========================================================
// 초기화 (★ Ver 1.7: 로드 시 시트 자동 동기화)
// =========================================================
async function init() {
    setupEventListeners();
    showLoading('📦 최신 데이터 동기화 및 로드 중...');

    await loadConfig();
    await Promise.all([
        loadEditedCells(),
        loadStockLogFromFirebase(),
        syncOrderData(true) // 로드 시 자동으로 CSV 동기화 (알림 없이)
    ]);

    hideLoading();

    const hasDate = savedDates.some(d => d && d.trim());
    if (hasDate && (orderDataOriginal.length > 0 || orderDataBuy.length > 0)) {
        applyDates();
    }

    console.log('🏭 중국제작 미발계산기 Ver 1.7 초기화 완료');
}

init();
