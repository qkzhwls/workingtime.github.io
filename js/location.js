import { initializeFirebase, loadAppConfig } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

let originalData = [];
let incomingData = {}; 
let currentUserName = "작업자";

// 📌 작업 1-B: downloadMainExcel 함수의 로케이션 컬럼 복원
window.downloadMainExcel = function() {
    const targetData = originalData; // 필터링된 데이터 연동 필요 시 수정
    
    let excelHtml = "<html><head><meta charset='utf-8'><style>.style1{mso-number-format:'\\@';}.style2{text-align:center;}</style></head><body><table border='1'>";
    excelHtml += "<tr><th>로케이션</th><th>동</th><th>위치</th><th>상품코드</th><th>상품명</th><th>옵션</th><th>정상재고</th></tr>";

    targetData.forEach(loc => {
        const code = (loc.code === loc.id ? '' : loc.code) || '';
        const stock = loc.stock || '0';
        
        // ★ 로케이션 컬럼 복원: ★★-01(4)/ S561045 형식
        const angleSize = (loc.angleSize || '').toString().trim();
        let locDisplay = loc.id;
        if (angleSize) {
            locDisplay = code 
                ? `${loc.id}(${angleSize})/ ${code}` 
                : `${loc.id}(${angleSize})`;
        }
        
        excelHtml += "<tr>";
        excelHtml += `<td class='style1'>${locDisplay}</td>`;
        excelHtml += `<td class='style2'>${loc.dong || ''}</td>`;
        excelHtml += `<td class='style2'>${loc.pos || ''}</td>`;
        excelHtml += `<td class='style1'>${code}</td>`;
        excelHtml += `<td>${loc.name || ''}</td>`;
        excelHtml += `<td>${loc.option || ''}</td>`;
        excelHtml += `<td>${stock}</td>`;
        excelHtml += "</tr>";
    });

    excelHtml += "</table></body></html>";
    const blob = new Blob([excelHtml], { type: "application/vnd.ms-excel" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `로케이션전체리스트_${new Date().toLocaleDateString()}.xls`;
    link.click();
};

// 📌 작업 1-A: updateDatabaseA 함수의 permanent 모드에서 칸수 처리
async function updateDatabaseA(rows, mode = 'daily') {
    try {
        let existingLocMap = {};
        originalData.forEach(d => { existingLocMap[d.id] = d; });
        
        let batch = writeBatch(db);
        let updateCount = 0;
        let zoneUpdates = {};

        for (let row of rows) {
            const rawLoc = row['로케이션']?.toString().trim();
            if (!rawLoc) continue;

            let cleanLocId = rawLoc.includes('(') ? rawLoc.split('(')[0].trim() : rawLoc;
            if (!existingLocMap[cleanLocId]) continue;

            const zoneDocId = 'ZONE_' + cleanLocId.substring(0, 6);
            if (!zoneUpdates[zoneDocId]) zoneUpdates[zoneDocId] = {};
            
            const existingData = existingLocMap[cleanLocId] || {};
            let updateData = { ...existingData };

            if (mode === 'permanent') {
                updateData.dong = ('동' in row || 'dong' in row) ? (row['동'] || row['dong'] || '').toString().trim() : (existingData.dong || '');
                updateData.pos = ('위치' in row || 'pos' in row) ? (row['위치'] || row['pos'] || '').toString().trim() : (existingData.pos || '');
                updateData.code = existingData.code || '';
                updateData.name = existingData.name || '';
                updateData.option = existingData.option || '';
                updateData.stock = existingData.stock || '0';
                updateData.stock2f = existingData.stock2f || '0';
                
                // ★ 칸수 필드 추가 (엑셀에 칸수 컬럼이 있으면 저장, 없으면 기존 값 유지)
                if ('칸수' in row || 'angleSize' in row) {
                    const rawAngle = (row['칸수'] || row['angleSize'] || '').toString().trim();
                    updateData.angleSize = rawAngle;
                } else {
                    updateData.angleSize = existingData.angleSize || '';
                }
            } else {
                // 일일 최신화 로직 (생략)
                updateData.code = row['상품코드']?.toString().trim() || '';
                updateData.name = row['상품명']?.toString().trim() || '';
                updateData.stock = row['정상재고']?.toString().trim() || '0';
            }

            zoneUpdates[zoneDocId][cleanLocId] = updateData;
            updateCount++;
        }

        for (let zoneId in zoneUpdates) {
            batch.set(doc(db, LOC_COLLECTION, zoneId), zoneUpdates[zoneId], { merge: true });
        }
        await batch.commit();
        alert(`✅ ${updateCount}건 처리 완료!`);
    } catch (e) { console.error(e); alert("오류 발생"); }
}

// 📌 작업 2-A: 입고대기 사이드바 카드에 옵션 표시 추가
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
    container.innerHTML = html || '<div style="text-align:center; padding:30px; color:#888;">데이터가 없습니다.</div>';
};

// 데이터 로드 리스너
onSnapshot(collection(db, LOC_COLLECTION), (snapshot) => {
    let tempLocMap = {};
    snapshot.forEach(docSnap => {
        if(docSnap.id.startsWith('ZONE_')) {
            const data = docSnap.data();
            for(let id in data) { tempLocMap[id] = { id, ...data[id] }; }
        }
    });
    originalData = Object.values(tempLocMap);
    renderTable(originalData);
});

function renderTable(data) {
    const tbody = document.getElementById('location-list-body');
    let html = '';
    data.forEach(loc => {
        html += `<tr><td><input type="checkbox" value="${loc.id}"></td><td>${loc.id}</td><td>${loc.dong||''}</td><td>${loc.pos||''}</td><td>${loc.code||''}</td><td>${loc.name||''}</td><td>${loc.stock||0}</td></tr>`;
    });
    tbody.innerHTML = html;
}

// 엑셀 업로드 이벤트 바인딩
document.getElementById('excel-upload-permanent')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (ev) => {
        const wb = XLSX.read(ev.target.result, {type:'binary'});
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        updateDatabaseA(rows, 'permanent');
    };
    reader.readAsBinaryString(file);
});

// 기타 유틸리티 함수 (showRecommendation, toggleIncomingSidebar 등 기존 코드 유지)
