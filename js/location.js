import { initializeFirebase, loadAppConfig } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

// --- 전역 변수 (보존) ---
let originalData = [];
let incomingData = {}; 
let excelHeaders = [];
let visibleColumns = ['std_dong', 'std_pos', 'std_id', 'std_code', 'std_name', 'std_stock'];
let capacity2F = 200000;
let currentUserName = "작업자";

// --- 가상 스크롤 엔진 VS (보존) ---
const VS = {
    container: null,
    itemHeight: 45,
    visibleCount: 30,
    // ... (기존 가상스크롤 로직 100% 보존)
};

/* [기능 함수들: setupRealtimeListenerA, loadAppConfig 등 2,000줄 이상 보존] */

// 📌 작업 1-B: window.downloadMainExcel - 로케이션 컬럼 복원 (Ver 3.49)
window.downloadMainExcel = function() {
    const targetData = originalData; 
    const cusHeaders = excelHeaders.filter(h => visibleColumns.includes('cus_' + h));
    
    let dataRows = '';
    targetData.forEach(loc => {
        const code = (loc.code === loc.id ? '' : loc.code) || '';
        const stock = loc.stock || '0';
        const stock2f = loc.stock2f || '0';
        
        // ★ 로케이션 컬럼 복원: ★★-01(4)/ S561045 형식 (수정됨)
        const angleSize = (loc.angleSize || '').toString().trim();
        let locDisplay = loc.id;
        if (angleSize) {
            locDisplay = code 
                ? `${loc.id}(${angleSize})/ ${code}` 
                : `${loc.id}(${angleSize})`;
        }
        
        let row = '';
        row += `<td class='style1'>${locDisplay}</td>`;
        row += `<td class='style2'>${loc.dong || ''}</td>`;
        row += `<td class='style2'>${loc.pos || ''}</td>`;
        row += `<td class='style1'>${code}</td>`;
        row += `<td class='style1'>${loc.name || ''}</td>`;
        row += `<td class='style1'>${loc.option || ''}</td>`;
        row += `<td class='style3'>${stock}</td>`;
        row += `<td class='style3'>${stock2f}</td>`;
        
        cusHeaders.forEach(h => {
            const val = (loc.rawData && loc.rawData[h]) ? loc.rawData[h] : '';
            const isNum = !isNaN(val) && val !== '';
            row += `<td class='${isNum ? 'style3' : 'style2'}'>${val}</td>`;
        });
        
        dataRows += `<tr>${row}</tr>\n`;
    });
    
    // ... (Blob 생성 및 다운로드 로직 보존)
};

// 📌 작업 1-A: updateDatabaseA - permanent 모드에서 칸수 필드 처리 (Ver 3.49)
async function updateDatabaseA(rows, mode = 'daily') {
    // ... (로케이션 맵 구성 등 기존 로직 보존)
    for (let row of rows) {
        // ... (ID 추출 로직 보존)
        if (mode === 'permanent') {
            updateData.dong = ('동' in row || 'dong' in row) ? (row['동'] || row['dong'] || '').toString().trim() : (existingData.dong || '');
            updateData.pos = ('위치' in row || 'pos' in row) ? (row['위치'] || row['pos'] || '').toString().trim() : (existingData.pos || '');
            updateData.code = existingData.code || '';
            updateData.name = existingData.name || '';
            updateData.option = existingData.option || '';
            updateData.stock = existingData.stock || '0';
            updateData.stock2f = existingData.stock2f || '0';
            
            // ★ 칸수 필드 추가 (수정됨)
            if ('칸수' in row || 'angleSize' in row) {
                const rawAngle = (row['칸수'] || row['angleSize'] || '').toString().trim();
                updateData.angleSize = rawAngle;
            } else {
                updateData.angleSize = existingData.angleSize || '';
            }
        } else {
            // mode === 'daily' 로직 (보존)
            updateData.code = row['상품코드']?.toString().trim() || '';
            // ...
        }
    }
    // ... (Batch Commit 로직 보존)
}

// 📌 작업 2: renderIncomingQueue - 입고대기 사이드바 옵션 표시 (Ver 3.49)
window.renderIncomingQueue = function() {
    const container = document.getElementById('incoming-list');
    if(!container) return;

    let list = Object.values(incomingData);
    let html = '';

    list.forEach(item => {
        let code = item['상품코드'];
        let name = item['상품명'] || '';
        let qty = item['입고대기수량'] || 0;
        let option = item['옵션'] || '';
        let date = item['공장출고예상일'] || '-';
        let src = item.source || '제작';

        html += `
            <div class="incoming-item" onclick="activatePreAssignMode('${code}', '${name.replace(/'/g, "\\'")}', '${qty}', '${option.replace(/'/g, "\\'")}')">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <div style="font-weight:bold; color:var(--primary); font-size:14px;">${code}</div>
                    <span style="font-size:10px; background:${src==='제작'?'#e3f2fd':'#fbe9e7'}; color:${src==='제작'?'#1976d2':'#d84315'}; padding:2px 5px; border-radius:3px; font-weight:bold;">${src}</span>
                </div>
                <div style="font-size:12px; color:#333; margin-bottom:${option ? '2px' : '6px'};">${name}</div>
                ${option ? `<div style="font-size:11px; color:#777; margin-bottom:6px;">${option}</div>` : ''}
                
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
                    <span style="color:#555;">${src==='제작'?'출고일':'도착일'}: <b style="color:#d32f2f;">${date}</b></span>
                    <span style="color:#e65100; font-weight:bold; font-size:12px;">대기: ${qty}개</span>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
};

/* [유틸리티 함수 및 이벤트 리스너 500여 줄 보존] */
