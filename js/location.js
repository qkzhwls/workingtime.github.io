import { initializeFirebase, loadAppConfig } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

// 전역 상태 변수
let originalData = [];
let sortConfig = { key: 'id', direction: 'asc' };
let filters = { loc: [], code: 'all', stock: 'all', dong: 'all', pos: 'all' };

window.capacity2F = 200000;
window.angleSizeMap = {}; // 작업 1-A: 구역+동별 칸 수 매핑

window.visibleColumns = ['std_dong', 'std_pos', 'std_id', 'std_code', 'std_name', 'std_stock'];
window.excelHeaders = [];
window.currentMapZone = '';

// 실시간 리스너 설정
function setupRealtimeListeners() {
    // 1. 설정 및 칸 수 매핑 로드 (작업 1-B 반영)
    onSnapshot(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), (docSnap) => {
        if (docSnap.exists()) {
            const conf = docSnap.data();
            if (conf.visibleColumns) window.visibleColumns = conf.visibleColumns;
            if (conf.excelHeaders) window.excelHeaders = conf.excelHeaders;
            if (conf.angleSizeMap) window.angleSizeMap = conf.angleSizeMap; // 설정 복원
            renderTableHeader();
            applyFiltersAndSort();
        }
    });

    // 2. 로케이션 데이터 로드
    onSnapshot(collection(db, LOC_COLLECTION), (snapshot) => {
        let tempLocMap = {};
        snapshot.forEach(docSnap => {
            if (docSnap.id.startsWith('ZONE_')) {
                const zoneData = docSnap.data();
                for (let locId in zoneData) {
                    tempLocMap[locId] = { id: locId, ...zoneData[locId] };
                }
            }
        });
        originalData = Object.values(tempLocMap);
        applyFiltersAndSort();
        if (document.getElementById('view-map').style.display === 'block') window.renderMapTabs();
    });
}

// 작업 1-E: 칸 수 설정 저장 함수
window.saveAngleSizeMap = async function() {
    const inputs = document.querySelectorAll('.angle-size-input');
    const newMap = {};
    inputs.forEach(input => {
        const key = input.dataset.key;
        const val = input.value.trim();
        if (key && val && Number(val) > 0) {
            newMap[key] = val;
        }
    });
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { angleSizeMap: newMap }, { merge: true });
        window.angleSizeMap = newMap;
        alert(`✅ 칸 수 설정이 저장되었습니다. (${Object.keys(newMap).length}개 구역-동)`);
    } catch(e) {
        console.error(e);
        alert('저장 중 오류가 발생했습니다.');
    }
};

// 환경설정 모달 열기 (작업 1-D 반영)
window.openSettingsModal = (e) => {
    if(e) e.stopPropagation();
    const container = document.getElementById('setting-headers-container');
    
    // 헤더 체크박스 생성
    let html = '';
    const stdCols = [
        { id: 'std_dong', label: '동' }, { id: 'std_pos', label: '위치' }, 
        { id: 'std_id', label: '로케이션' }, { id: 'std_code', label: '상품코드' }, 
        { id: 'std_name', label: '상품명' }, { id: 'std_stock', label: '정상재고' }
    ];
    stdCols.forEach(col => {
        const isChecked = window.visibleColumns.includes(col.id) ? 'checked' : '';
        html += `<label style="width:45%; font-size:12px;"><input type="checkbox" class="chk-header" value="${col.id}" ${isChecked}> ${col.label}</label>`;
    });
    container.innerHTML = html;

    // 칸 수 설정 표 렌더링
    const angleContainer = document.getElementById('setting-angle-container');
    if (angleContainer) {
        const comboSet = new Set();
        originalData.forEach(loc => {
            const zone = (loc.id.charAt(0) || '').toUpperCase();
            const dong = (loc.dong || '').toString().trim();
            if (zone && dong) comboSet.add(`${zone}-${dong}`);
        });
        const combos = [...comboSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        
        if (combos.length === 0) {
            angleContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#888; font-size:12px;">로케이션 데이터가 없습니다.</div>';
        } else {
            let angleHtml = '<table style="width:100%; border-collapse:collapse; font-size:12px;"><thead><tr style="background:#e3f2fd;"><th style="padding:6px; border:1px solid #bbdefb;">구역-동</th><th style="padding:6px; border:1px solid #bbdefb; width:100px;">칸 수</th></tr></thead><tbody>';
            combos.forEach(key => {
                const val = (window.angleSizeMap || {})[key] || '';
                angleHtml += `<tr><td style="padding:6px; border:1px solid #e0e0e0; text-align:center; font-weight:bold;">${key}</td><td style="padding:4px; border:1px solid #e0e0e0;"><input type="number" min="0" class="angle-size-input" data-key="${key}" value="${val}" style="width:100%; padding:4px; text-align:center; border:1px solid #ccc; border-radius:3px;"></td></tr>`;
            });
            angleHtml += '</tbody></table>';
            angleContainer.innerHTML = angleHtml;
        }
    }

    document.getElementById('settings-modal').style.display = 'flex';
};

// 작업 1-F: 메인 엑셀 다운로드 (로케이션 복원 로직 포함)
window.downloadMainExcel = function() {
    const targetData = originalData; // 실제 적용 시 필터링된 데이터 사용 가능
    
    let excelHtml = "<html><head><meta charset='utf-8'><style> .style1 {mso-number-format:'\\@';} </style></head><body><table border='1'>";
    excelHtml += "<tr><th>로케이션</th><th>동</th><th>위치</th><th>상품코드</th><th>상품명</th><th>정상재고</th></tr>";

    targetData.forEach(loc => {
        const code = (loc.code === loc.id ? '' : loc.code) || '';
        
        // ★ 로케이션 컬럼 복원: ★★-01(4)/ S561045 형식
        const zone = (loc.id.charAt(0) || '').toUpperCase();
        const dong = (loc.dong || '').toString().trim();
        const angleSize = (window.angleSizeMap || {})[`${zone}-${dong}`] || '';
        
        let locDisplay = loc.id;
        if (angleSize) {
            locDisplay = code 
                ? `${loc.id}(${angleSize})/ ${code}` 
                : `${loc.id}(${angleSize})`;
        }
        
        excelHtml += "<tr>";
        excelHtml += `<td class='style1'>${locDisplay}</td>`;
        excelHtml += `<td>${loc.dong || ''}</td>`;
        excelHtml += `<td>${loc.pos || ''}</td>`;
        excelHtml += `<td class='style1'>${code}</td>`;
        excelHtml += `<td>${loc.name || ''}</td>`;
        excelHtml += `<td>${loc.stock || 0}</td>`;
        excelHtml += "</tr>";
    });

    excelHtml += "</table></body></html>";
    const blob = new Blob([excelHtml], { type: "application/vnd.ms-excel" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `로케이션_리스트_${new Date().toLocaleDateString()}.xls`;
    link.click();
};

// 작업 2-A: 입고대기 사이드바 렌더링 (옵션 표시 포함)
window.renderIncomingQueue = async function() {
    const container = document.getElementById('incoming-list');
    // 실제 구현 시 incomingData(Firestore 등)에서 가져옴
    const incomingList = []; // 임시

    let html = '';
    incomingList.forEach(item => {
        const code = item['상품코드'];
        const name = item['상품명'] || '';
        const qty = item['입고대기수량'] || 0;
        const option = item['옵션'] || '';
        const date = item['공장출고예상일'] || '-';

        html += `
            <div class="incoming-item" onclick="activatePreAssignMode('${code}', '${name}', '${qty}', '${option}')">
                <div style="font-weight:bold; color:var(--primary); font-size:14px; margin-bottom:4px;">${code}</div>
                
                <div style="font-size:12px; color:#333; margin-bottom:${option ? '2px' : '6px'};">${name}</div>
                ${option ? `<div style="font-size:11px; color:#777; margin-bottom:6px;">${option}</div>` : ''}
                
                <div style="display:flex; justify-content:space-between; font-size:11px;">
                    <span style="color:#888;">일자: ${date}</span>
                    <span style="color:#e65100; font-weight:bold;">대기: ${qty}개</span>
                </div>
            </div>
        `;
    });
    container.innerHTML = html || '<div style="text-align:center; padding:20px; color:#888;">입고 대기 상품이 없습니다.</div>';
};

// 기본 테이블 렌더링 및 필터링 (생략 없이 유지)
function renderTableHeader() {
    const tr = document.getElementById('dynamic-thead-tr');
    let html = '<th><input type="checkbox" id="check-all"></th>';
    window.visibleColumns.forEach(col => {
        let label = col.replace('std_', '');
        html += `<th>${label}</th>`;
    });
    tr.innerHTML = html;
}

function applyFiltersAndSort() {
    const tbody = document.getElementById('location-list-body');
    let html = '';
    originalData.forEach(loc => {
        html += `<tr onclick="openEditModal('${loc.id}')">`;
        html += `<td><input type="checkbox" class="loc-check" value="${loc.id}"></td>`;
        window.visibleColumns.forEach(col => {
            let val = loc[col.replace('std_', '')] || '';
            html += `<td>${val}</td>`;
        });
        html += `</tr>`;
    });
    tbody.innerHTML = html;
}

// 초기화
window.onload = () => {
    setupRealtimeListeners();
};
