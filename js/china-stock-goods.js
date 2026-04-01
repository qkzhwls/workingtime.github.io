// === js/china-stock-goods.js ===
// 중국제작 미발계산기 Ver 1.4.8

import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, writeBatch, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
// 유틸리티
// =========================================================
const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');

// 엑셀에서 복사된 '1,000' 형태의 콤마를 제거하고 완벽하게 숫자로 변환하는 함수
const parseExcelNum = (val) => parseInt((val || '0').toString().replace(/,/g, '').trim()) || 0;

function getProductName(row) {
    return row['상품명'] || row['공급처상품명'] || '';
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

// 엑셀 날짜를 "O월 O일출고" 형태로 변환
function formatToKoreanDate(raw) {
    if (!raw) return '';
    let d = String(raw).trim();
    if (!isNaN(d) && Number(d) > 30000) {
        const date = new Date((Number(d) - 25569) * 86400 * 1000);
        return `${date.getMonth() + 1}월${date.getDate()}일출고`;
    }
    let parts = d.split(/[-./]/);
    let m, day;
    if (parts.length === 3) { m = parseInt(parts[1], 10); day = parseInt(parts[2], 10); } 
    else if (parts.length === 2) { m = parseInt(parts[0], 10); day = parseInt(parts[1], 10); }
    if (m && day && !isNaN(m) && !isNaN(day)) return `${m}월${day}일출고`;
    return `${d}출고`;
}

// =========================================================
// 드롭다운 날짜/수량 동적 생성
// =========================================================
function populateDynamicDates() {
    const dateMap = {};
    const dateColsOrig = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qtyColsOrig  = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const dateColsBuy = ['1차패킹리스트출고일','2차패킹리스트출고일'];
    const qtyColsBuy  = ['1차패킹리스트출고수량','2차패킹리스트출고수량'];

    const processRow = (row, dCols, qCols) => {
        dCols.forEach((dc, idx) => {
            const rawDate = (row[dc] || '').toString().trim();
            if(rawDate) {
                const qty = parseInt(row[qCols[idx]]) || 0;
                if(!dateMap[rawDate]) dateMap[rawDate] = 0;
                dateMap[rawDate] += qty;
            }
        });
    };

    orderDataOriginal.forEach(row => processRow(row, dateColsOrig, qtyColsOrig));
    orderDataBuy.forEach(row => processRow(row, dateColsBuy, qtyColsBuy));

    const sortedDates = Object.keys(dateMap).sort();

    for(let i = 1; i <= 8; i++) {
        const selectEl = document.getElementById(`date-${i}`);
        if(selectEl) {
            const currentVal = savedDates[i-1] || selectEl.value;
            let html = '<option value="">선택</option>';
            sortedDates.forEach(d => {
                html += `<option value="${d}">${formatToKoreanDate(d)} (${dateMap[d].toLocaleString()})</option>`;
            });
            selectEl.innerHTML = html;
            if(sortedDates.includes(currentVal)) selectEl.value = currentVal;
            else selectEl.value = '';
        }
    }
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

async function loadOrderDataFromFirebase() {
    try {
        orderDataOriginal = [];
        const snapO = await getDocs(collection(db, CHINA_COLLECTION + '_Order'));
        snapO.forEach(d => { const data = d.data(); if (data.dataStr) orderDataOriginal.push(...JSON.parse(data.dataStr)); });

        orderDataBuy = [];
        const snapB = await getDocs(collection(db, CHINA_COLLECTION + '_Buy'));
        snapB.forEach(d => { const data = d.data(); if (data.dataStr) orderDataBuy.push(...JSON.parse(data.dataStr)); });
    } catch (e) { console.error('오더 데이터 로드 실패:', e); }
}

async function loadStockLogFromFirebase() {
    try {
        stockLogData = {};
        const snap = await getDocs(collection(db, CHINA_COLLECTION + '_StockLog'));
        snap.forEach(d => {
            const data = d.data();
            if (data.dataStr) {
                JSON.parse(data.dataStr).forEach(row => {
                    const code = (row['상품코드'] || row['어드민상품코드'] || '').toString().trim();
                    if (code) stockLogData[code] = row;
                });
            }
        });
    } catch (e) { console.error('미발재고로그 로드 실패:', e); }
}

async function saveChunkedData(rows, subCollection) {
    const collName = CHINA_COLLECTION + '_' + subCollection;
    try {
        const existing = await getDocs(collection(db, collName));
        if (existing.size > 0) {
            showLoading(`🗑️ 기존 ${subCollection} 데이터 삭제 중... (${existing.size}건)`);
            let delCount = 0;
            for (const docSnap of existing.docs) {
                await deleteDoc(docSnap.ref);
                delCount++;
                if (delCount % 50 === 0) showLoading(`🗑️ 기존 데이터 삭제 중... (${delCount}/${existing.size})`);
            }
        }

        const CHUNK_SIZE = 30;
        let chunkCount = 0;
        const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);

        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            await setDoc(doc(db, collName, `CHUNK_${chunkCount}`), { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            chunkCount++;
            if (chunkCount % 10 === 0 || chunkCount === totalChunks) {
                const pct = Math.round((chunkCount / totalChunks) * 100);
                showLoading(`💾 ${subCollection} 저장 중... ${chunkCount}/${totalChunks} (${pct}%)`);
            }
        }
        return chunkCount;
    } catch (e) { console.error(`${subCollection} 저장 실패:`, e); throw e; }
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
// 오더리스트 시트 동기화
// =========================================================
async function syncOrderData() {
    if (!csvUrlOrder && !csvUrlBuy) {
        alert('CSV 시트 링크가 설정되지 않았습니다.\n[작업 메뉴 > CSV 시트 링크 설정]에서 링크를 먼저 저장하세요.');
        return;
    }
    showLoading('🔄 오더리스트를 시트에서 가져오는 중...');
    try {
        let cO = 0, cB = 0;
        if (csvUrlOrder) {
            showLoading('🔄 오더리스트(원본) 다운로드 중...');
            const d = await fetchCSV(csvUrlOrder);
            orderDataOriginal = d;
            showLoading(`💾 오더리스트(원본) ${d.length}건 저장 시작...`);
            await saveChunkedData(d, 'Order');
            cO = d.length;
        }
        if (csvUrlBuy) {
            showLoading('🔄 오더리스트(사입) 다운로드 중...');
            const d = await fetchCSV(csvUrlBuy);
            orderDataBuy = d;
            showLoading(`💾 오더리스트(사입) ${d.length}건 저장 시작...`);
            await saveChunkedData(d, 'Buy');
            cB = d.length;
        }
        
        populateDynamicDates();
        
        hideLoading();
        alert(`✅ 오더리스트 동기화 완료!\n원본: ${cO}건 / 사입: ${cB}건`);
    } catch (e) {
        hideLoading();
        alert('🚨 동기화 실패: ' + e.message);
        console.error('동기화 에러 상세:', e);
    }
}

// =========================================================
// ★ 미발재고로그 붙여넣기 기능 (Ver 1.4.8 최신화 + 갱신 버그 완벽 수정)
// =========================================================
function openPasteModal() {
    document.getElementById('paste-textarea').value = '';
    document.getElementById('paste-modal').style.display = 'flex';
}
function closePasteModal() {
    document.getElementById('paste-modal').style.display = 'none';
}
async function processPastedData() {
    const text = document.getElementById('paste-textarea').value.trim();
    if (!text) {
        alert('붙여넣은 데이터가 없습니다.');
        return;
    }

    closePasteModal();
    showLoading('📂 미발재고로그 분석 중...');

    try {
        const lines = text.split(/\r?\n/);
        let headerIdx = -1;
        let headers = [];

        // 엑셀 헤더의 모든 공백(스페이스바)과 따옴표를 완벽히 제거하여 인식률 100% 보장
        for(let i=0; i<lines.length; i++) {
            const cols = lines[i].split('\t').map(c => c.replace(/^"|"$/g, '').replace(/\s+/g, ''));
            if (cols.includes('상품코드') || cols.includes('어드민상품코드')) {
                headerIdx = i;
                headers = cols;
                break;
            }
        }

        if (headerIdx === -1) {
            throw new Error('데이터에서 "상품코드" 열을 찾을 수 없습니다.\n엑셀에서 표 형태(제목줄 포함)로 드래그하여 복사했는지 확인해주세요.');
        }

        let rows = [];
        for (let i = headerIdx + 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue; 
            
            const cells = line.split('\t');
            let obj = {};
            
            cells.forEach((cell, idx) => {
                if (headers[idx]) {
                    obj[headers[idx]] = cell.replace(/^"|"$/g, '').trim();
                }
            });

            if (obj['상품코드'] || obj['어드민상품코드']) {
                rows.push(obj);
            }
        }

        stockLogData = {};
        rows.forEach(row => {
            const code = (row['상품코드'] || row['어드민상품코드'] || '').toString().trim();
            if (code) stockLogData[code] = row;
        });

        showLoading(`💾 미발재고로그 ${rows.length}건 저장 시작...`);
        await saveChunkedData(rows, 'StockLog');
        
        hideLoading();
        document.getElementById('paste-textarea').value = ''; 
        
        // ★ 핵심: 데이터 저장 완료 후 '표 강제 최신화'
        let hasDateSelected = false;
        for (let i = 1; i <= 8; i++) {
            if (document.getElementById(`date-${i}`)?.value) {
                hasDateSelected = true;
                break;
            }
        }

        if (hasDateSelected) {
            // 출고일이 하나라도 선택되어 있으면 즉시 전체 매칭하여 최신화
            applyDates(); 
            showToast(`✅ 미발재고로그 ${rows.length}건 실시간 반영 완료`);
        } else {
            // 출고일이 아예 선택되지 않은 상태라면 표를 그릴 수 없으므로 알림
            alert(`✅ 미발재고로그 ${rows.length}건이 시스템에 저장되었습니다.\n\n상단의 📦 [출고일]을 선택하고 [적용] 버튼을 누르시면\n방금 넣은 최신 데이터가 표에 나타납니다.`);
        }

    } catch (err) {
        hideLoading();
        alert('🚨 데이터 파싱 실패: ' + err.message);
        console.error(err);
    }
}

// =========================================================
// 출고일 적용 → 테이블 생성
// =========================================================
function applyDates() {
    const inputUnits = [];
    for (let i = 1; i <= 8; i++) {
        const val = document.getElementById(`date-${i}`)?.value;
        if (val) inputUnits.push(val.toString().trim());
    }
    if (inputUnits.length === 0) { alert('출고일을 1개 이상 선택해주세요.'); return; }

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
            const cellValue = (row[dc] || '').toString().trim();
            if (cellValue && inputUnits.includes(cellValue)) { 
                matched = true; 
                totalQty += (parseInt(row[qtyColsOrig[idx]]) || 0); 
            }
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
            const cellValue = (row[dc] || '').toString().trim();
            if (cellValue && inputUnits.includes(cellValue)) { 
                matched = true; 
                totalQty += (parseInt(row[qtyColsBuy[idx]]) || 0); 
            }
        });
        if (matched) {
            if (!resultMap[code]) resultMap[code] = { code, name: getProductName(row), option: row['옵션']||'', arrivalQty: 0, bigoY: '' };
            resultMap[code].arrivalQty += totalQty;
        }
    });

    tableData = Object.values(resultMap).map(item => {
        const log = stockLogData[item.code] || {};
        
        // 헤더명이 조금씩 달라도 유연하게 찾고 콤마 제거
        const loc = (log['로케이션'] || log['위치'] || '').toString().split('/')[0].trim();
        const tStockStr = log['정상재고'] || log['총재고'] || log['재고'];
        const mibalStr = log['부족수량'] || log['미발수량'];
        
        const edited = editedCells[item.code] || {};
        
        return {
            code: item.code, name: item.name, option: item.option,
            arrivalQty: item.arrivalQty,
            mibalQty: parseExcelNum(mibalStr),
            totalStock: parseExcelNum(tStockStr),
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
    showToast(`✅ ${tableData.length}개 상품 데이터 최신화 완료`);
}

function clearDates() {
    for (let i = 1; i <= 8; i++) { const el = document.getElementById(`date-${i}`); if (el) el.value = ''; }
    tableData = []; filteredData = [];
    renderTable(); updateSummary(); saveConfig();
}

// =========================================================
// 테이블 렌더링
// =========================================================
function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!filteredData || filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" style="text-align:center; padding:50px; color:#888;">데이터를 동기화한 후 출고일을 선택하세요.</td></tr>';
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

function updateSummary() {
    document.getElementById('sum-sku').textContent = filteredData.length.toLocaleString();
    document.getElementById('sum-arrival').textContent = filteredData.reduce((s, d) => s + (d.arrivalQty || 0), 0).toLocaleString();
    document.getElementById('sum-mibal').textContent = filteredData.reduce((s, d) => s + (d.mibalQty || 0), 0).toLocaleString();
}

// =========================================================
// 셀 편집 → 자동 저장
// =========================================================
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

// =========================================================
// 검색 & 정렬
// =========================================================
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

// =========================================================
// 엑셀 다운로드 & 전체 초기화
// =========================================================
function downloadExcel() {
    if (!filteredData || filteredData.length === 0) { alert('다운로드할 데이터가 없습니다.'); return; }
    
    // 다운로드할 헤더 지정 (상품코드, 수량만)
    const headers = ['상품코드', '수량'];
    
    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style>td{mso-number-format:"\\@";}.header{font-weight:bold;background:#FFE0B2;text-align:center;border:1px solid #ccc;padding:6px;}.cell{border:1px solid #ddd;padding:4px 8px;text-align:center;}.num{mso-number-format:"0";text-align:right;}</style><table>`;
    html += `<tr>${headers.map(h=>`<td class="header">${h}</td>`).join('')}</tr>`;
    
    filteredData.forEach(r => {
        html += `<tr><td class="cell">${r.code}</td><td class="num">${r.arrivalQty}</td></tr>`;
    });
    
    html += '</table></html>';
    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `미발계산기_${new Date().toISOString().slice(0,10)}.xls`;
    a.click();
    showToast('📥 엑셀 다운로드 완료');
}

async function clearAllData() {
    if (!confirm('정말로 모든 데이터를 초기화하시겠습니까?\n(오더리스트, 미발재고로그, 편집 내용 모두 삭제)')) return;
    showLoading('🗑️ 데이터 초기화 중...');
    try {
        for (const sub of ['Order','Buy','StockLog']) {
            const snap = await getDocs(collection(db, CHINA_COLLECTION+'_'+sub));
            if (snap.size > 0) {
                let count = 0;
                for (const docSnap of snap.docs) {
                    await deleteDoc(docSnap.ref);
                    count++;
                    if (count % 50 === 0) showLoading(`🗑️ ${sub} 삭제 중... (${count}/${snap.size})`);
                }
            }
        }
        await setDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'), { cells: {}, updatedAt: new Date() });
        orderDataOriginal=[]; orderDataBuy=[]; stockLogData={}; tableData=[]; filteredData=[]; editedCells={};
        
        populateDynamicDates();
        renderTable(); updateSummary(); hideLoading();
        alert('✅ 전체 초기화 완료');
    } catch (e) { hideLoading(); alert('🚨 초기화 실패: ' + e.message); }
}

// =========================================================
// 시트 설정 모달
// =========================================================
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
    showToast('✅ CSV 링크 저장 완료');
}

// =========================================================
// ★ 모바일 앱 연동 (Firebase 실시간 통신 브릿지)
// =========================================================
function listenToAppRequests() {
    onSnapshot(doc(db, 'ChinaStockGoods', 'APP_REQUEST'), async (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        
        if (!data.reqId || data.status === 'PROCESSED') return;

        // 1. 바코드 스캔 요청
        if (data.action === 'SCAN') {
            const item = tableData.find(d => d.code === data.barcode);
            let responseObj = { found: false };

            if (item) {
                responseObj = {
                    found: true,
                    product_name: item.name || '',
                    location: item.location || '미지정',
                    remain: item.mibalQty || 0,
                    options: [{ qty: item.arrivalQty || 0, dest: "도착(패킹)수량" }]
                };
            }

            await setDoc(doc(db, 'ChinaStockGoods', 'APP_RESPONSE'), {
                reqId: data.reqId,
                jsonData: JSON.stringify(responseObj)
            });
            await setDoc(doc(db, 'ChinaStockGoods', 'APP_REQUEST'), { status: 'PROCESSED' }, { merge: true });
        }

        // 2. 입고 데이터 일괄 저장 요청
        else if (data.action === 'SAVE_BATCH') {
            const items = JSON.parse(data.payload || '[]');
            let successCount = 0;

            items.forEach(reqItem => {
                const target = tableData.find(d => d.code === reqItem.barcode);
                if (target) {
                    if (!editedCells[target.code]) editedCells[target.code] = {};
                    
                    let currentQty = parseInt(editedCells[target.code]['confirmed'] || 0);
                    let newQty = currentQty + parseInt(reqItem.qty);
                    
                    editedCells[target.code]['confirmed'] = newQty.toString();
                    target.confirmed = newQty.toString();
                    successCount++;
                }
            });

            if (successCount > 0) {
                await saveEditedCells(); 
                renderTable(); 
                showToast(`📱 앱에서 ${successCount}건 입고 데이터 처리 완료!`);
            }

            await setDoc(doc(db, 'ChinaStockGoods', 'APP_RESPONSE'), {
                reqId: data.reqId,
                jsonData: JSON.stringify({ processed: successCount })
            });
            await setDoc(doc(db, 'ChinaStockGoods', 'APP_REQUEST'), { status: 'PROCESSED' }, { merge: true });
        }
    });
}

// =========================================================
// ★ 이벤트 바인딩
// =========================================================
function setupEventListeners() {
    document.getElementById('btn-toggle-menu')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = document.getElementById('main-tools-menu');
        const isVisible = menu.style.display === 'block';
        closeAllMenus();
        if (!isVisible) menu.style.display = 'block';
    });
    
    document.getElementById('main-tools-menu')?.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => closeAllMenus());
    document.getElementById('btn-sync-order')?.addEventListener('click', () => { closeAllMenus(); syncOrderData(); });
    document.getElementById('btn-open-sheet-settings')?.addEventListener('click', () => { closeAllMenus(); openSheetSettingsModal(); });
    document.getElementById('btn-clear-all')?.addEventListener('click', () => { closeAllMenus(); clearAllData(); });
    
    // 붙여넣기 모달 관련 이벤트
    document.getElementById('btn-open-paste-modal')?.addEventListener('click', () => { closeAllMenus(); openPasteModal(); });
    document.getElementById('btn-paste-cancel')?.addEventListener('click', closePasteModal);
    document.getElementById('btn-paste-apply')?.addEventListener('click', processPastedData);
    document.getElementById('paste-modal')?.addEventListener('click', (e) => { if (e.target.id === 'paste-modal') closePasteModal(); });
    document.querySelector('#paste-modal .modal-content')?.addEventListener('click', (e) => e.stopPropagation());

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
    document.getElementById('table-body')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('code-cell')) {
            const code = e.target.dataset.code;
            if (code) navigator.clipboard.writeText(code).then(() => showToast(`📋 ${code} 복사됨`));
        }
    });
    
    document.getElementById('btn-sheet-cancel')?.addEventListener('click', closeSheetSettingsModal);
    document.getElementById('btn-sheet-save')?.addEventListener('click', saveSheetSettings);
    document.getElementById('sheet-settings-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'sheet-settings-modal') closeSheetSettingsModal();
    });
    document.querySelector('#sheet-settings-modal .modal-content')?.addEventListener('click', (e) => e.stopPropagation());
}

// =========================================================
// 초기화
// =========================================================
async function init() {
    setupEventListeners();
    showLoading('📦 데이터 불러오는 중...');

    await loadConfig();
    await loadEditedCells();
    await loadOrderDataFromFirebase();
    await loadStockLogFromFirebase();

    populateDynamicDates();

    hideLoading();

    const hasDate = savedDates.some(d => d && d.trim());
    if (hasDate && (orderDataOriginal.length > 0 || orderDataBuy.length > 0)) {
        applyDates();
    }

    listenToAppRequests();

    console.log('🏭 중국제작 미발계산기 Ver 1.4.8 초기화 완료');
}

init();
