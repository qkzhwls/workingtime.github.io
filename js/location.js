import { initializeFirebase, loadAppConfig } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

// 전역 변수
let originalData = [];
window.capacity2F = 200000;
window.angleSizeMap = {}; // 작업 1-A: 칸 수 설정 맵

// 실시간 리스너 (설정 정보)
function setupConfigListener() {
    onSnapshot(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), (docSnap) => {
        if (docSnap.exists()) {
            const conf = docSnap.data();
            if (conf.angleSizeMap) window.angleSizeMap = conf.angleSizeMap; // 작업 1-B: 설정 복원
            // ... 기타 설정 로드
        }
    });
}

// 환경설정 모달 열기
window.openSettingsModal = (e) => {
    if(e) e.stopPropagation();
    const container = document.getElementById('setting-headers-container');
    // ... 헤더 체크박스 렌더링 코드 ...

    // 작업 1-D: 구역+동 칸 수 표 렌더링
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
            angleContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#888; font-size:12px;">데이터가 없습니다.</div>';
        } else {
            let angleHtml = '<table style="width:100%; border-collapse:collapse; font-size:13px;"><thead><tr style="background:#e3f2fd;"><th style="padding:6px; border:1px solid #bbdefb;">구역-동</th><th style="padding:6px; border:1px solid #bbdefb; width:120px;">칸 수</th></tr></thead><tbody>';
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

// 작업 1-E: 칸 수 설정 저장 함수
window.saveAngleSizeMap = async function() {
    const inputs = document.querySelectorAll('.angle-size-input');
    const newMap = {};
    inputs.forEach(input => {
        const key = input.dataset.key;
        const val = input.value.trim();
        if (key && val && Number(val) > 0) newMap[key] = val;
    });
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { angleSizeMap: newMap }, { merge: true });
        window.angleSizeMap = newMap;
        alert(`✅ 칸 수 설정이 저장되었습니다. (${Object.keys(newMap).length}개)`);
    } catch(e) { console.error(e); alert('저장 실패'); }
};

// 작업 1-F: 엑셀 다운로드 시 로케이션 복원
window.downloadMainExcel = function() {
    const targetData = originalData; // 실제로는 필터링된 데이터
    // ... 엑셀 헤더 생성 코드 ...
    
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

        // 이후 row 생성 시 loc.id 대신 locDisplay 사용
        // row += `<td>${locDisplay}</td>...`;
    });
};

// 작업 2-A: 입고대기 사이드바 옵션 표시
window.renderIncomingQueue = function() {
    const container = document.getElementById('incoming-list');
    // ... 리스트 가공 코드 ...
    
    let html = '';
    list.forEach(item => {
        let code = item['상품코드'];
        let name = item['상품명'] || '';
        let qty = item['입고대기수량'] || 0;
        let option = item['옵션'] || '';
        
        html += `
            <div class="incoming-item" onclick="activatePreAssignMode('${code}', '${name}', '${qty}', '${option}')">
                <div style="font-weight:bold; color:var(--primary);">${code}</div>
                
                <div style="font-size:12px; color:#333; margin-bottom:${option ? '2px' : '6px'};">${name}</div>
                ${option ? `<div style="font-size:11px; color:#777; margin-bottom:6px;">${option}</div>` : ''}
                
                <div style="font-size:11px; color:#e65100; font-weight:bold;">대기: ${qty}개</div>
            </div>
        `;
    });
    container.innerHTML = html;
};

// ... 기타 초기화 및 유틸리티 함수 유지 ...
