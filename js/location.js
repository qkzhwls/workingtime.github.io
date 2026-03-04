import { initializeFirebase, loadAppConfig } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, writeBatch, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const { db, auth, db2 } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

let originalData = []; 
let zikjinData = {}; 
let weeklyData = {}; 
let incomingData = {}; 
let sortConfig = { key: 'id', direction: 'asc' }; 
let filters = { loc: [], code: 'all', stock: 'all', dong: 'all', pos: 'all' };

const RESERVE_EXPIRE_MS = Infinity; 

let currentUserName = "비로그인 작업자";
let appConfig = null;
window.currentUsageTab = '3F';
window.capacity2F = 200000;
window.sheetUrl = ''; 

// [신규] 동적 컬럼 관리를 위한 변수 선언
window.visibleColumns = ['std_dong', 'std_pos', 'std_id', 'std_code', 'std_name', 'std_option', 'std_stock'];
window.excelHeaders = []; 

loadAppConfig(db).then(config => {
    appConfig = config;
    if (auth.currentUser) updateCurrentUserName(auth.currentUser);
});

function updateCurrentUserName(user) {
    if (!user) return;
    let email = user.email || "";
    let name = user.displayName || email.split('@')[0];
    if (appConfig && appConfig.memberEmails) {
        for (let key in appConfig.memberEmails) {
            if (appConfig.memberEmails[key] === email) { name = key; break; }
        }
    }
    currentUserName = name;
}

onAuthStateChanged(auth, (user) => {
    if (user) updateCurrentUserName(user);
    else currentUserName = "비로그인 작업자";
});

window.showLoading = function(text) {
    const loadingText = document.getElementById('loading-text');
    if(loadingText) loadingText.innerText = text;
    document.getElementById('loading-overlay').style.display = 'flex';
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
};

window.hideLoading = function() {
    document.getElementById('loading-overlay').style.display = 'none';
};

// B창고 데이터 리스너
function setupRealtimeListenerB() {
    if (!db2) return;
    onSnapshot(collection(db2, 'ZikjinData'), (snapshot) => {
        zikjinData = {};
        snapshot.forEach(docSnap => { zikjinData[docSnap.id] = docSnap.data(); });
        applyFiltersAndSort();
    }, (error) => console.error("직진배송 오류:", error));

    onSnapshot(collection(db2, 'WeeklyData'), (snapshot) => {
        weeklyData = {};
        snapshot.forEach(docSnap => { weeklyData[docSnap.id] = docSnap.data(); });
        applyFiltersAndSort();
    }, (error) => console.error("주차별데이터 오류:", error));
    
    onSnapshot(collection(db2, 'IncomingData'), (snapshot) => {
        incomingData = {};
        snapshot.forEach(docSnap => { incomingData[docSnap.id] = docSnap.data(); });
        applyFiltersAndSort();
    }, (error) => console.error("입고예정데이터 오류:", error));
}

// A창고 데이터 리스너
function setupRealtimeListenerA() {
    const q = collection(db, LOC_COLLECTION);
    onSnapshot(q, (snapshot) => {
        document.getElementById('firebase-guide').style.display = 'none';
        originalData = [];
        snapshot.forEach(docSnap => {
            if (docSnap.id === 'INFO_USAGE_STATS') return;
            if (docSnap.id === 'INFO_CONFIG') {
                const conf = docSnap.data();
                if (conf.capacity2F) window.capacity2F = conf.capacity2F;
                if (conf.sheetUrl) window.sheetUrl = conf.sheetUrl;
                // [신규] 동적 헤더 설정 동기화
                if (conf.visibleColumns) window.visibleColumns = conf.visibleColumns;
                if (conf.excelHeaders) window.excelHeaders = conf.excelHeaders;
                return;
            }
            originalData.push({ id: docSnap.id, ...docSnap.data() });
        });
        
        renderTableHeader(); // 테이블 헤더 동적 생성
        applyFiltersAndSort(); // 리스트 출력
        
        const pop = document.getElementById('usage-popup');
        if (pop && pop.style.display === 'block') window.calculateAndRenderUsage();
    }, (error) => { console.error("A창고 오류:", error); });
}

window.onload = () => {
    setupRealtimeListenerA();
    setupRealtimeListenerB();
};

// [신규] 동적 테이블 헤더 생성 로직
function renderTableHeader() {
    const theadTr = document.getElementById('dynamic-thead-tr');
    const popupContainer = document.getElementById('dynamic-popups');
    if (!theadTr || !popupContainer) return;

    let html = `<th class="checkbox-cell"><input type="checkbox" id="check-all" class="loc-check" onclick="toggleAllCheckboxes(this)"></th>`;
    let popupHtml = '';
    
    // 표준 컬럼 필터는 기존 팝업 div를 재활용
    window.visibleColumns.forEach(col => {
        if (col === 'std_dong') { html += createTh('dong', '동', 80, true); popupHtml += `<div id="pop-dong" class="filter-popup"></div>`; }
        else if (col === 'std_pos') { html += createTh('pos', '위치', 80, true); popupHtml += `<div id="pop-pos" class="filter-popup"></div>`; }
        else if (col === 'std_id') { html += createTh('id', '로케이션', 150, true); popupHtml += `<div id="pop-loc" class="filter-popup"></div>`; }
        else if (col === 'std_code') { html += createTh('code', '상품코드', 150, true); popupHtml += `<div id="pop-code" class="filter-popup"></div>`; }
        else if (col === 'std_name') { html += createTh('name', '상품명', 'auto', true); popupHtml += `<div id="pop-name" class="filter-popup"></div>`; }
        else if (col === 'std_option') { html += createTh('option', '옵션', 180, true); popupHtml += `<div id="pop-option" class="filter-popup"></div>`; }
        else if (col === 'std_stock') { html += createTh('stock', '정상재고', 130, true); popupHtml += `<div id="pop-stock" class="filter-popup"></div>`; }
        else if (col.startsWith('cus_')) {
            const label = col.replace('cus_', '');
            html += createTh(col, label, 120, false); // 커스텀 열은 필터 미지원(단순표시)
        }
    });
    
    theadTr.innerHTML = html;
    popupContainer.innerHTML = popupHtml;
    
    document.querySelectorAll('.filter-popup').forEach(p => { p.addEventListener('click', function(e) { e.stopPropagation(); }); });
    setupFilterPopups();
}

function createTh(key, label, width, hasFilter) {
    let widthStyle = width === 'auto' ? '' : `style="width: ${width}px;"`;
    let filterHtml = hasFilter ? `<span class="filter-btn" id="btn-filter-${key}" onclick="toggleFilterPopup(event, 'pop-${key}')">▼</span>` : '';
    return `<th ${widthStyle}><div class="th-content"><span class="title-text">${label}</span>${filterHtml}</div></th>`;
}


// [신규] 환경설정 모달 제어 로직 (헤더 선택)
window.openSettingsModal = (e) => {
    if(e) e.stopPropagation();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    
    const container = document.getElementById('setting-headers-container');
    let html = '';
    
    // 1. 고정 표준 컬럼
    const stdCols = [
        { id: 'std_dong', label: '동' }, { id: 'std_pos', label: '위치' }, { id: 'std_id', label: '로케이션(ID)' },
        { id: 'std_code', label: '상품코드' }, { id: 'std_name', label: '상품명' }, { id: 'std_option', label: '옵션' }, { id: 'std_stock', label: '정상재고' }
    ];
    
    stdCols.forEach(col => {
        const isChecked = window.visibleColumns.includes(col.id) ? 'checked' : '';
        html += `<label style="display:flex; align-items:center; gap:5px; width: 45%;"><input type="checkbox" class="chk-header" value="${col.id}" ${isChecked}> ${col.label}</label>`;
    });
    
    // 2. 엑셀 파일에서 읽어온 커스텀 컬럼
    window.excelHeaders.forEach(header => {
        const colId = 'cus_' + header;
        const isChecked = window.visibleColumns.includes(colId) ? 'checked' : '';
        html += `<label style="display:flex; align-items:center; gap:5px; width: 45%; color:#e65100;"><input type="checkbox" class="chk-header" value="${colId}" ${isChecked}> ${header}</label>`;
    });

    container.innerHTML = html;
    document.getElementById('settings-modal').style.display = 'flex';
};

window.saveHeaderSettings = async () => {
    const checkboxes = document.querySelectorAll('.chk-header:checked');
    const newVisible = Array.from(checkboxes).map(cb => cb.value);
    
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { visibleColumns: newVisible }, { merge: true });
        window.visibleColumns = newVisible;
        document.getElementById('settings-modal').style.display = 'none';
        renderTableHeader(); 
        applyFiltersAndSort(); 
        showToast("✅ 화면 헤더 설정이 저장되었습니다.");
    } catch(e) { console.error(e); alert("저장 실패"); }
};


// 💡 스마트 로케이션 추천 (핵심 알고리즘)
window.showRecommendation = function() {
    window.showLoading("💡 상품 점수를 계산하고 최적의 로케이션을 매칭 중입니다...");

    setTimeout(() => {
        const allCodes = new Set([...Object.keys(zikjinData), ...Object.keys(weeklyData)]);
        let scoredItems = [];

        allCodes.forEach(code => {
            let zItem = zikjinData[code] || {};
            let wItem = weeklyData[code] || {};
            let name = zItem['상품명'] || wItem['상품명'] || '알 수 없음';
            
            let score = 0;
            let zQty = Number(zItem['수량'] || 0); 
            let wQty = Number(wItem['기간배송수량'] || wItem['기간발주수량'] || 0); 
            
            score += (zQty * 10);
            score += (wQty * 2);

            let dates = Object.keys(wItem).filter(k => /^20\d{6}$/.test(k)).sort();
            if (dates.length >= 6) {
                let recent3 = dates.slice(-3).reduce((sum, d) => sum + Number(wItem[d] || 0), 0);
                let prev3 = dates.slice(-6, -3).reduce((sum, d) => sum + Number(wItem[d] || 0), 0);
                if (recent3 > prev3) score *= 1.2;
            }

            if (score > 0) {
                let currentLocs = originalData.filter(d => d.code === code).map(d => d.id).join(', ');
                if (!currentLocs) currentLocs = '신규배치 (없음)';
                scoredItems.push({ code, name, score, currentLocs });
            }
        });

        scoredItems.sort((a, b) => b.score - a.score);

        let emptyLocs = originalData.filter(d => {
            const hasContent = (d.code && d.code !== d.id && d.code.trim() !== "") || (d.name && d.name.trim() !== "");
            return !hasContent;
        });

        const posPriority = { '2': 1, '3': 2, '4': 3, '1': 4, '5': 5 };
        const getPosRank = (p) => posPriority[p?.toString().trim()] || 99;

        emptyLocs.sort((a, b) => {
            let dongA = a.dong || '';
            let dongB = b.dong || '';
            if (dongA !== dongB) return dongA.localeCompare(dongB); 
            let posRankA = getPosRank(a.pos);
            let posRankB = getPosRank(b.pos);
            if (posRankA !== posRankB) return posRankA - posRankB; 
            return a.id.localeCompare(b.id); 
        });

        const tbody = document.getElementById('recommend-tbody');
        let html = '';
        let matchCount = Math.min(scoredItems.length, emptyLocs.length);
        
        if (matchCount === 0) {
            html = '<tr><td colspan="5" style="padding:40px;">데이터가 부족하거나 추천할 빈 로케이션이 없습니다.</td></tr>';
        } else {
            for (let i = 0; i < matchCount; i++) {
                let item = scoredItems[i];
                let eLoc = emptyLocs[i];
                html += `
                    <tr>
                        <td style="color:var(--primary); font-weight:bold; border-left:none;">${i+1}위 <br><span style="font-size:11px; color:#888;">(${item.score.toFixed(1)}점)</span></td>
                        <td style="font-weight:bold; color:#333;">${item.code}</td>
                        <td style="text-align:left; font-size:13px;">${item.name}</td>
                        <td style="color:#888;">${item.currentLocs}</td>
                        <td style="color:#2e7d32; font-weight:bold; background:#f1f8e9; border-right:none;">${eLoc.id} <br><span style="font-size:11px; color:#555;">(${eLoc.dong}동 ${eLoc.pos}위치)</span></td>
                    </tr>
                `;
            }
        }

        tbody.innerHTML = html;
        window.hideLoading();
        document.getElementById('recommend-modal').style.display = 'flex';

    }, 500); 
};


window.openSheetModal = (e) => {
    if(e) e.stopPropagation();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    document.getElementById('modal-sheet-url').value = window.sheetUrl || '';
    document.getElementById('sheet-modal').style.display = 'flex';
};

window.saveSheetUrl = async () => {
    const url = document.getElementById('modal-sheet-url').value.trim();
    if (!url.includes('docs.google.com/spreadsheets') || !url.includes('output=csv')) {
        alert("올바른 구글시트 CSV 링크가 아닙니다.\n[웹에 게시] 기능을 통해 생성된 CSV 링크를 확인해주세요.");
        return;
    }
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { sheetUrl: url }, { merge: true });
        window.sheetUrl = url;
        alert("✅ 구글시트 링크가 안전하게 저장되었습니다.");
        if (typeof window.closeSheetModal === 'function') window.closeSheetModal();
    } catch(e) { console.error("링크 저장 실패:", e); alert("오류가 발생했습니다."); }
};

window.syncIncomingData = async () => {
    if (!window.sheetUrl) return alert("구글시트 링크가 설정되지 않았습니다.\n[⚙️ 구글시트 링크 설정] 에서 링크를 저장해주세요.");
    window.showLoading("🔄 입고예정 데이터를 구글시트에서 가져오고 있습니다...");
    try {
        const proxyUrl = 'https://corsproxy.io/?'; 
        const response = await fetch(proxyUrl + encodeURIComponent(window.sheetUrl));
        if (!response.ok) throw new Error("응답 오류");
        const arrayBuffer = await response.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        if (json.length > 0) updateDatabaseB(json, 'IncomingData', null);
        else { window.hideLoading(); alert("시트에 데이터가 없습니다."); }
    } catch (error) { window.hideLoading(); alert("연결 실패. 방화벽이나 링크 설정을 확인하세요."); }
};

window.saveCapacity2F = async function() {
    const input = document.getElementById('input-cap-2f');
    if (!input) return;
    const newVal = parseInt(input.value.replace(/,/g, ''), 10);
    if (isNaN(newVal) || newVal <= 0) return alert("올바른 수량을 입력해주세요.");
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { capacity2F: newVal }, { merge: true });
        alert(`2층 기준 수량이 ${newVal.toLocaleString()}장으로 변경되었습니다.`);
    } catch(e) { console.error(e); alert("오류가 발생했습니다."); }
};

window.switchUsageTab = function(tab) { window.currentUsageTab = tab; window.calculateAndRenderUsage(); };
window.applyUsageFilter = function(zone, state) {
    filters = { loc: [], code: 'all', stock: 'all', dong: 'all', pos: 'all' };
    if (zone !== 'all') filters.loc = [zone];
    if (state === 'used') filters.code = 'not-empty'; else if (state === 'empty') filters.code = 'empty';
    setupFilterPopups();
    ['loc', 'code', 'dong', 'pos', 'stock'].forEach(id => {
        const btn = document.getElementById('btn-filter-' + id);
        if (btn) { if (filters[id] === 'all' && (id!=='loc' || filters.loc.length===0)) btn.classList.remove('active'); else btn.classList.add('active'); }
    });
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
};

window.calculateAndRenderUsage = function() {
    const popup = document.getElementById('usage-popup');
    if (!popup) return;
    let html = `<div style="display:flex; gap:10px; margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;"><button onclick="switchUsageTab('3F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; background:${window.currentUsageTab === '3F' ? 'var(--primary)' : '#eee'}; color:${window.currentUsageTab === '3F' ? 'white' : '#555'}">3층 로케이션</button><button onclick="switchUsageTab('2F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; background:${window.currentUsageTab === '2F' ? 'var(--primary)' : '#eee'}; color:${window.currentUsageTab === '2F' ? 'white' : '#555'}">2층 창고재고</button></div>`;

    if (window.currentUsageTab === '3F') {
        const locations = originalData.filter(d => d.id.charAt(0).toUpperCase() !== 'K');
        let total = locations.length;
        if (total === 0) { popup.innerHTML = html + '<div style="padding: 10px;">데이터가 없습니다.</div>'; return; }
        
        let used = 0; let zoneStats = {};
        
        // [신규] 당일지정수량 로직 (오늘 00시 00분부터의 예약만 카운트)
        let todayReservedCount = 0;
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        locations.forEach(loc => {
            const isUsed = (loc.code && loc.code.trim() !== '' && loc.code !== loc.id) || (loc.name && loc.name.trim() !== '');
            if (isUsed) used++;
            
            if (loc.reserved && loc.reservedAt >= todayStart) todayReservedCount++;

            const zone = loc.id.charAt(0).toUpperCase();
            if (!zoneStats[zone]) { zoneStats[zone] = { total: 0, used: 0 }; }
            zoneStats[zone].total++;
            if (isUsed) zoneStats[zone].used++;
        });

        const usageRate = ((used / total) * 100).toFixed(1);
        
        // [신규] 상단 당일지정/선지정 수량 패널 추가
        html += `
            <div style="display:flex; justify-content: space-around; background: #eef1ff; padding: 10px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #c5cae9;">
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#555; font-weight:bold;">당일지정수량(예약)</div>
                    <div style="font-size:18px; color:var(--primary); font-weight:900;">${todayReservedCount}</div>
                </div>
                <div style="width:1px; background:#ccc;"></div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#555; font-weight:bold;">선지정수량(준비중)</div>
                    <div style="font-size:18px; color:#ff9800; font-weight:900;">0</div>
                </div>
            </div>
            <div style="font-size:15px; font-weight:bold; margin-bottom:5px; color:var(--primary); text-align:center;">📊 3층 전체 사용률: ${usageRate}%</div>
            <div style="font-size:11px; color:#888; text-align:center; margin-bottom:10px;">※ 숫자를 클릭하면 해당 구역만 보여줍니다.</div>
            <table class="usage-table" style="width:100%;"><thead><tr><th>구역명</th><th>총 칸수</th><th>사용중</th><th>빈칸</th><th>사용률</th></tr></thead><tbody><tr><td style="font-weight:bold; color:#d32f2f;">전체 합계</td><td style="font-weight:bold;">${total}</td><td style="font-weight:bold; color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'used')">${used}</td><td style="font-weight:bold; color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'empty')">${total - used}</td><td style="font-weight:bold; color:#d32f2f;">${usageRate}%</td></tr>`;

        const zones = Object.keys(zoneStats).sort((a,b) => (a==='★'?-1:(b==='★'?1:a.localeCompare(b))));
        zones.forEach(z => {
            const zTotal = zoneStats[z].total; const zUsed = zoneStats[z].used; const zEmpty = zTotal - zUsed; const zRate = ((zUsed / zTotal) * 100).toFixed(1);
            html += `<tr><td><strong>${z}</strong> 구역</td><td>${zTotal}</td><td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${z}', 'used')">${zUsed}</td><td style="color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${z}', 'empty')">${zEmpty}</td><td>${zRate}%</td></tr>`;
        });
        html += `</tbody></table>`;
    } else {
        let sum2F = 0; originalData.forEach(loc => { sum2F += Number(loc.stock2f || 0); });
        let rate2F = ((sum2F / window.capacity2F) * 100).toFixed(1);
        html += `<div style="font-size:15px; font-weight:bold; margin-bottom:15px; color:var(--primary); text-align:center;">🏢 2층 전체 창고 사용률: ${rate2F}%</div><table class="usage-table" style="width:100%;"><tr><th style="background:#eef1ff; width: 40%;">총 적재가능수량</th><td style="text-align: right;"><input type="number" id="input-cap-2f" value="${window.capacity2F}" style="width:80px; padding:3px; text-align:right; font-size:13px; font-weight:bold;"> 장 <button onclick="saveCapacity2F()" style="padding:4px 8px; margin-left:5px; font-size:11px; background:var(--primary); color:white; border:none; border-radius:3px; cursor:pointer;">기준변경</button></td></tr><tr><th style="background:#eef1ff;">현재 적재수량</th><td style="font-weight:bold; color:var(--primary); text-align: right;">${sum2F.toLocaleString()} 장</td></tr><tr><th style="background:#eef1ff;">남은 수량</th><td style="font-weight:bold; color:#ff5252; text-align: right;">${(window.capacity2F - sum2F).toLocaleString()} 장</td></tr></table>`;
    }
    popup.innerHTML = html;
};

window.toggleUsagePopup = function(e) {
    e.stopPropagation();
    const pop = document.getElementById('usage-popup');
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    if (pop.style.display !== 'block') { pop.style.display = 'block'; window.calculateAndRenderUsage(); }
};

function getSortButtonsHtml(key) {
    const isAsc = sortConfig.key === key && sortConfig.direction === 'asc';
    const isDesc = sortConfig.key === key && sortConfig.direction === 'desc';
    return `<div class="filter-option ${isAsc ? 'selected' : ''}" onclick="executeSort('${key}', 'asc')">${isAsc ? '✔️ ' : ''}⬆️ 오름차순 정렬</div><div class="filter-option ${isDesc ? 'selected' : ''}" onclick="executeSort('${key}', 'desc')">${isDesc ? '✔️ ' : ''}⬇️ 내림차순 정렬</div><div class="filter-divider"></div>`;
}

function updateLocPopupUI() {
    const locPop = document.getElementById('pop-loc');
    if (!locPop) return;
    let prefixSet = new Set(originalData.map(d => d.id.charAt(0))); prefixSet.add('★');
    const prefixes = [...prefixSet].sort((a, b) => (a === '★' ? -1 : (b === '★' ? 1 : a.localeCompare(b))));
    let locHtml = getSortButtonsHtml('id');
    const isAllSelected = filters.loc.length === 0;
    locHtml += `<div class="filter-option ${isAllSelected ? 'selected' : ''}" onclick="toggleLocFilter('all')">${isAllSelected ? '✔️ ' : ''}전체보기</div>`;
    prefixes.forEach(p => { const isSelected = filters.loc.includes(p); locHtml += `<div class="filter-option ${isSelected ? 'selected' : ''}" onclick="toggleLocFilter('${p}')">${isSelected ? '✔️ ' : ''}${p} 구역</div>`; });
    locPop.innerHTML = locHtml;
}

function setupFilterPopups() {
    const codePop = document.getElementById('pop-code'); const namePop = document.getElementById('pop-name');
    const optionPop = document.getElementById('pop-option'); const stockPop = document.getElementById('pop-stock');
    const dongPop = document.getElementById('pop-dong'); const posPop = document.getElementById('pop-pos');

    updateLocPopupUI();

    let codeHtml = getSortButtonsHtml('code') + `<div class="filter-option ${filters.code === 'all' ? 'selected' : ''}" onclick="setFilter('code', 'all')">${filters.code === 'all' ? '✔️ ' : ''}전체보기</div><div class="filter-option ${filters.code === 'empty' ? 'selected' : ''}" onclick="setFilter('code', 'empty')">${filters.code === 'empty' ? '✔️ ' : ''}빈칸</div><div class="filter-option ${filters.code === 'not-empty' ? 'selected' : ''}" onclick="setFilter('code', 'not-empty')">${filters.code === 'not-empty' ? '✔️ ' : ''}내용있음</div>`;
    if(codePop) codePop.innerHTML = codeHtml;
    if(namePop) namePop.innerHTML = getSortButtonsHtml('name');
    if(optionPop) optionPop.innerHTML = getSortButtonsHtml('option');

    const dongs = [...new Set(originalData.map(d => (d.dong || '').toString()))].filter(Boolean).sort();
    let dongHtml = getSortButtonsHtml('dong') + `<div class="filter-option ${filters.dong === 'all' ? 'selected' : ''}" onclick="setFilter('dong', 'all')">${filters.dong === 'all' ? '✔️ ' : ''}전체보기</div>`;
    dongs.forEach(d => { dongHtml += `<div class="filter-option ${filters.dong === d ? 'selected' : ''}" onclick="setFilter('dong', '${d}')">${filters.dong === d ? '✔️ ' : ''}${d}</div>`; });
    if(dongPop) dongPop.innerHTML = dongHtml;

    const poses = [...new Set(originalData.map(d => (d.pos || '').toString()))].filter(Boolean).sort();
    let posHtml = getSortButtonsHtml('pos') + `<div class="filter-option ${filters.pos === 'all' ? 'selected' : ''}" onclick="setFilter('pos', 'all')">${filters.pos === 'all' ? '✔️ ' : ''}전체보기</div>`;
    poses.forEach(p => { posHtml += `<div class="filter-option ${filters.pos === p ? 'selected' : ''}" onclick="setFilter('pos', '${p}')">${filters.pos === p ? '✔️ ' : ''}${p}</div>`; });
    if(posPop) posPop.innerHTML = posHtml;

    const stocks = [...new Set(originalData.map(d => (d.stock || '0').toString()))].sort((a, b) => Number(a) - Number(b));
    let stockHtml = getSortButtonsHtml('stock') + `<div class="filter-option ${filters.stock === 'all' ? 'selected' : ''}" onclick="setFilter('stock', 'all')">${filters.stock === 'all' ? '✔️ ' : ''}전체보기</div>`;
    stocks.forEach(s => { stockHtml += `<div class="filter-option ${filters.stock === s ? 'selected' : ''}" onclick="setFilter('stock', '${s}')">${filters.stock === s ? '✔️ ' : ''}${s}</div>`; });
    if(stockPop) stockPop.innerHTML = stockHtml;
}

window.executeSort = (key, direction) => { sortConfig = { key: key, direction: direction }; setupFilterPopups(); applyFiltersAndSort(); if (typeof window.closeAllPopups === 'function') window.closeAllPopups(); };
window.toggleLocFilter = (val) => { if (val === 'all') filters.loc = []; else { if (filters.loc.includes(val)) filters.loc = filters.loc.filter(v => v !== val); else filters.loc.push(val); } setupFilterPopups(); const btn = document.getElementById('btn-filter-loc'); if (btn) { if (filters.loc.length === 0) btn.classList.remove('active'); else btn.classList.add('active'); } applyFiltersAndSort(); };
window.setFilter = (type, value) => { filters[type] = value; setupFilterPopups(); const btnId = `btn-filter-${type}`; const btn = document.getElementById(btnId); if (btn) { if (value === 'all') btn.classList.remove('active'); else btn.classList.add('active'); } applyFiltersAndSort(); if (typeof window.closeAllPopups === 'function') window.closeAllPopups(); };

function applyFiltersAndSort() {
    let filtered = originalData.filter(item => {
        if (filters.loc.length > 0 && !filters.loc.includes(item.id.charAt(0))) return false;
        if (filters.dong !== 'all' && (item.dong || '').toString() !== filters.dong) return false;
        if (filters.pos !== 'all' && (item.pos || '').toString() !== filters.pos) return false;
        const hasCode = (item.code && item.code !== item.id && item.code.trim() !== "") || (item.name && item.name.trim() !== "");
        if (filters.code === 'empty' && hasCode) return false;
        if (filters.code === 'not-empty' && !hasCode) return false;
        if (filters.stock !== 'all' && (item.stock || '0').toString() !== filters.stock) return false;
        return true;
    });

    filtered.sort((a, b) => {
        let aVal = a[sortConfig.key] || ''; let bVal = b[sortConfig.key] || '';
        if (sortConfig.key === 'stock') return sortConfig.direction === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
        return sortConfig.direction === 'asc' ? aVal.toString().localeCompare(bVal.toString()) : bVal.toString().localeCompare(aVal.toString());
    });
    renderTable(filtered);
}

// [신규] 동적 헤더에 맞춰 내용(td) 렌더링
function renderTable(data) {
    const tbody = document.getElementById('location-list-body');
    if (!tbody) return;

    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    const checkedIds = new Set(Array.from(checkedBoxes).map(cb => cb.value));

    let html = ''; const now = new Date().getTime();

    data.forEach(loc => {
        let isReserved = loc.reserved === true;
        let rowStyle = isReserved ? 'background-color: #fffde7;' : '';
        let reserverName = loc.reservedBy || '누군가';
        let badgeHtml = isReserved ? `<br><span class="badge-reserved">🔒 ${reserverName} 작업중</span>` : '';
        let isChecked = checkedIds.has(loc.id) ? 'checked' : '';

        html += `<tr onclick="if(event.target.tagName !== 'INPUT') openEditModal('${loc.id}')" style="${rowStyle}">`;
        html += `<td onclick="event.stopPropagation()"><input type="checkbox" class="loc-check" value="${loc.id}" ${isChecked}></td>`;
        
        window.visibleColumns.forEach(col => {
            if (col === 'std_dong') html += `<td style="color:#666;">${loc.dong || ''}</td>`;
            else if (col === 'std_pos') html += `<td style="color:#666;">${loc.pos || ''}</td>`;
            else if (col === 'std_id') html += `<td class="loc-copy-cell" onclick="copyLocationToClipboard(event, '${loc.id}')" title="클릭하여 복사 및 예약">${loc.id} ${badgeHtml}</td>`;
            else if (col === 'std_code') html += `<td style="color:#3d5afe; font-weight:bold;">${loc.code === loc.id ? '' : (loc.code || '')}</td>`;
            else if (col === 'std_name') html += `<td style="text-align:left;">${loc.name || ''}</td>`;
            else if (col === 'std_option') html += `<td style="text-align:left; font-size:12px;">${loc.option || ''}</td>`;
            else if (col === 'std_stock') html += `<td style="font-weight:bold;">${loc.stock || '0'}</td>`;
            else if (col.startsWith('cus_')) {
                const key = col.replace('cus_', '');
                let val = (loc.rawData && loc.rawData[key]) ? loc.rawData[key] : '';
                html += `<td>${val}</td>`;
            }
        });
        html += `</tr>`;
    });
    
    tbody.innerHTML = html || '<tr><td colspan="10" style="padding:50px;">데이터가 없습니다.</td></tr>';
    const checkAllBtn = document.getElementById('check-all');
    const allCheckboxes = document.querySelectorAll('.loc-check');
    if (checkAllBtn && allCheckboxes.length > 0) checkAllBtn.checked = document.querySelectorAll('.loc-check:checked').length === allCheckboxes.length;
}


const fileInputCombined = document.getElementById('excel-upload-combined');
if (fileInputCombined) {
    fileInputCombined.addEventListener('change', async function(e) {
        const files = e.target.files;
        if (files.length === 0) return;

        window.showLoading('데이터(직진/주차별)를 분석 및 동기화 중입니다...');

        try {
            let zikjinCount = 0;
            let weeklyCount = 0;

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(new Uint8Array(e.target.result));
                    reader.onerror = e => reject(e);
                    reader.readAsArrayBuffer(file);
                });

                const workbook = XLSX.read(data, {type: 'array'});
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

                if (json.length === 0) continue;

                const headers = Object.keys(json[0]);
                const isWeekly = headers.includes('기간발주수량') || headers.includes('기간배송수량');
                const collectionName = isWeekly ? 'WeeklyData' : 'ZikjinData';

                if (isWeekly) weeklyCount++;
                else zikjinCount++;

                await updateDatabaseB(json, collectionName, null, true);
            }

            window.hideLoading();
            alert(`✅ 선택하신 데이터의 동기화가 완료되었습니다!\n(인식된 파일: 직진배송 ${zikjinCount}개 / 주차별 ${weeklyCount}개)`);
        } catch(error) {
            window.hideLoading();
            alert('데이터 동기화 중 오류가 발생했습니다.');
            console.error(error);
        } finally {
            fileInputCombined.value = '';
        }
    });
}

const fileInputA = document.getElementById('excel-upload-a');
if (fileInputA) {
    fileInputA.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        window.showLoading('로케이션을 최신화 중입니다...');
        setTimeout(() => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
                if (json.length > 0) updateDatabaseA(json);
                else { window.hideLoading(); alert("데이터가 없습니다."); }
            };
            reader.readAsArrayBuffer(file);
        }, 50);
    });
}

async function updateDatabaseB(rows, collectionName, inputElement, silent = false) {
    let label = '데이터';
    if (collectionName === 'ZikjinData') label = '직진배송';
    if (collectionName === 'WeeklyData') label = '주차별';
    if (collectionName === 'IncomingData') label = '입고예정';
    
    try {
        const querySnapshot = await getDocs(collection(db2, collectionName));
        const docsArray = querySnapshot.docs;
        for (let i = 0; i < docsArray.length; i += 400) {
            const delBatch = writeBatch(db2);
            docsArray.slice(i, i + 400).forEach(d => delBatch.delete(d.ref));
            await delBatch.commit();
        }

        let batch = writeBatch(db2); 
        let updateCount = 0; let batchCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const code = row['상품코드']?.toString().trim();
            if (!code) continue;

            const docRef = doc(db2, collectionName, code);
            batch.set(docRef, { ...row, updatedAt: new Date() }, { merge: true });

            updateCount++; batchCount++;
            if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db2); batchCount = 0; }
        }
        
        if (batchCount > 0) await batch.commit();
        if (!silent) alert(`✅ [${label}] 업데이트 완료!\n총 ${updateCount}건의 데이터가 반영되었습니다.`);
    } catch (error) {
        console.error(`${label} 업데이트 실패:`, error);
        if (!silent) alert(`${label} 업데이트 중 오류가 발생했습니다.`);
        throw error;
    } finally {
        if(inputElement && !silent) inputElement.value = ''; 
        if (!silent) window.hideLoading();
    }
}

// [수정] 엑셀 추가 헤더를 감지하여 저장하고 데이터를 통째로(rawData) 저장하는 로직
async function updateDatabaseA(rows) {
    const totalRows = rows.length;
    try {
        const allHeaders = Object.keys(rows[0]);
        const exclude = ['동', 'dong', '위치', 'pos', '상품코드', '로케이션', '상품명', '옵션', '정상재고', '2층창고재고'];
        const customHeaders = allHeaders.filter(h => !exclude.includes(h));
        
        const newHeaders = [...new Set([...window.excelHeaders, ...customHeaders])];
        if (newHeaders.length > window.excelHeaders.length) {
            await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { excelHeaders: newHeaders }, { merge: true });
            window.excelHeaders = newHeaders;
        }

        let batch = writeBatch(db); let updateCount = 0; let batchCount = 0;
        let notFoundLocs = new Set(); 
        const validLocIds = new Set(originalData.map(d => d.id));

        for (let i = 0; i < totalRows; i++) {
            const row = rows[i];
            const rawLoc = row['로케이션']?.toString().trim();
            
            if (rawLoc) {
                let cleanLocId = ''; let extractedCode = '';
                if (rawLoc.includes('(')) {
                    cleanLocId = rawLoc.split('(')[0].trim();
                    const afterParen = rawLoc.substring(rawLoc.indexOf('('));
                    const sIndex = afterParen.indexOf('S');
                    if (sIndex !== -1) extractedCode = afterParen.substring(sIndex).trim();
                } else { cleanLocId = rawLoc; }

                if (cleanLocId) {
                    if (!validLocIds.has(cleanLocId)) {
                        notFoundLocs.add(cleanLocId); 
                    } else {
                        const finalCode = extractedCode || row['상품코드']?.toString().trim() || '';
                        const docRef = doc(db, LOC_COLLECTION, cleanLocId);

                        let updateData = { reserved: false, reservedAt: 0, reservedBy: '', updatedAt: new Date(), rawData: row };
                        if (finalCode) updateData.code = finalCode;
                        updateData.name = row['상품명']?.toString().trim() || '';
                        updateData.option = row['옵션']?.toString().trim() || '';
                        updateData.stock = row['정상재고']?.toString().trim() || '0';
                        updateData.dong = row['동']?.toString().trim() || row['dong']?.toString().trim() || '';
                        updateData.pos = row['위치']?.toString().trim() || row['pos']?.toString().trim() || '';
                        updateData.stock2f = row['2층창고재고']?.toString().trim() || '0';

                        batch.set(docRef, updateData, { merge: true });

                        updateCount++; batchCount++;
                        if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
                    }
                }
            }
        }
        if (batchCount > 0) await batch.commit();
        
        let resultMessage = `✅ 완료! 총 ${updateCount}개의 로케이션 정보가 갱신되었습니다.`;
        if (notFoundLocs.size > 0) resultMessage += `\n\n⚠️ 다음 ${notFoundLocs.size}개의 로케이션은 시스템에 존재하지 않아 제외되었습니다:\n[${Array.from(notFoundLocs).join(', ')}]`;
        alert(resultMessage);
        
    } catch (error) { console.error("실패:", error); alert("업데이트 중 오류가 발생했습니다."); } 
    finally { document.getElementById('excel-upload-a').value = ''; window.hideLoading(); }
}

window.copyLocationToClipboard = async (event, locId) => {
    event.stopPropagation(); 
    try {
        const docRef = doc(db, LOC_COLLECTION, locId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            const data = snap.data(); const now = new Date().getTime();
            const isReserved = data.reserved === true; const reserverName = data.reservedBy || '다른 작업자';

            if (isReserved && reserverName === currentUserName) {
                if (confirm(`[${locId}] 내가 예약한 자리입니다.\n예약을 해제(취소)하시겠습니까?`)) {
                    await setDoc(docRef, { reserved: false, reservedAt: 0, reservedBy: '' }, { merge: true });
                    showToast(`[${locId}] 예약 해제 완료`);
                } else { navigator.clipboard.writeText(locId); showToast(`[${locId}] 내 예약 복사 완료!`); }
                return;
            }

            if (isReserved) {
                const rTime = new Date(data.reservedAt || 0);
                const timeStr = `${rTime.getHours()}:${String(rTime.getMinutes()).padStart(2, '0')}`;
                if (confirm(`[${locId}] 로케이션은 현재 [${reserverName}]님이 ${timeStr}부터 사용(예약) 중입니다.\n강제로 예약을 뺏어오시겠습니까?`)) {
                    await setDoc(docRef, { reserved: true, reservedAt: now, reservedBy: currentUserName }, { merge: true });
                    navigator.clipboard.writeText(locId); showToast(`[${locId}] 예약을 뺏어와 복사했습니다.`);
                }
                return; 
            }

            await setDoc(docRef, { reserved: true, reservedAt: now, reservedBy: currentUserName }, { merge: true });
            navigator.clipboard.writeText(locId).then(() => { showToast(`[${locId}] 복사 및 예약 완료!`); });
        }
    } catch (error) { alert('예약 처리 오류'); }
};

function showToast(message) {
    const toast = document.getElementById("toast");
    if(toast) { toast.innerText = message; toast.classList.add("show"); setTimeout(() => { toast.classList.remove("show"); }, 1500); }
}

window.toggleAllCheckboxes = (source) => {
    document.querySelectorAll('.loc-check').forEach(cb => cb.checked = source.checked);
};

// [신규] 환경설정 내부 로케이션 추가
window.addSingleLocationFromSetting = async () => {
    const inputObj = document.getElementById('setting-new-loc'); const newId = inputObj.value.trim().toUpperCase();
    if (!newId) return alert("추가할 로케이션 번호를 입력해주세요.");
    try {
        const docRef = doc(db, LOC_COLLECTION, newId); const docSnap = await getDoc(docRef);
        if (docSnap.exists()) return alert(`[${newId}] 로케이션은 이미 존재합니다.`);
        await setDoc(docRef, { dong: '', pos: '', code: '', name: '', option: '', stock: '0', reserved: false, reservedAt: 0, reservedBy: '', updatedAt: new Date(), rawData: {} });
        inputObj.value = ''; alert(`✅ [${newId}] 로케이션 추가 완료`); 
    } catch (error) { console.error("추가 실패:", error); }
};

window.deleteSelectedLocations = async () => {
    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    if (checkedBoxes.length === 0) return alert("바깥의 메인 데이터 리스트 화면에서 삭제할 로케이션 체크박스를 먼저 선택해주세요.");
    if (!confirm(`선택한 ${checkedBoxes.length}개의 로케이션을 정말 삭제하시겠습니까?`)) return;

    try {
        let batch = writeBatch(db); let batchCount = 0; let totalDeleted = 0;
        for (let i = 0; i < checkedBoxes.length; i++) {
            batch.delete(doc(db, LOC_COLLECTION, checkedBoxes[i].value));
            batchCount++; totalDeleted++;
            if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        alert(`🗑️ 총 ${totalDeleted}개 로케이션 삭제 완료`); 
    } catch (error) { console.error("삭제 실패:", error); alert("삭제 중 오류가 발생했습니다."); }
};

window.openEditModal = (id) => {
    const targetData = originalData.find(d => d.id === id);
    if (!targetData) return;
    document.getElementById('modal-id').value = targetData.id;
    document.getElementById('modal-dong').value = targetData.dong || '';
    document.getElementById('modal-pos').value = targetData.pos || '';
    document.getElementById('modal-code').value = targetData.code || '';
    document.getElementById('modal-name').value = targetData.name || '';
    document.getElementById('modal-option').value = targetData.option || '';
    document.getElementById('modal-stock').value = targetData.stock || '0';
    document.getElementById('edit-modal').style.display = 'flex';
};

window.saveManualEdit = async () => {
    const id = document.getElementById('modal-id').value;
    const updateData = {
        dong: document.getElementById('modal-dong').value.trim(), pos: document.getElementById('modal-pos').value.trim(), code: document.getElementById('modal-code').value.trim(),
        name: document.getElementById('modal-name').value.trim(), option: document.getElementById('modal-option').value.trim(), stock: document.getElementById('modal-stock').value.trim(),
        reserved: false, reservedAt: 0, reservedBy: '', updatedAt: new Date()
    };
    try {
        await setDoc(doc(db, LOC_COLLECTION, id), updateData, { merge: true });
        document.getElementById('edit-modal').style.display = 'none'; 
    } catch (error) { console.error("수정 실패:", error); }
};

window.addEventListener('keydown', function(e) { if (e.key === 'F5' || (e.ctrlKey && (e.key === 'r' || e.key === 'R'))) { e.preventDefault(); alert("🚨 실시간 동기화 모드 작동 중입니다.\n과도한 요금 발생을 막기 위해 새로고침을 차단했습니다."); } });
window.addEventListener('beforeunload', function(e) { e.preventDefault(); e.returnValue = ''; });
