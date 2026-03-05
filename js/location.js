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

window.sheetUrlOrder = ''; 
window.sheetUrlBuy = ''; 

window.visibleColumns = ['std_dong', 'std_pos', 'std_id', 'std_code', 'std_name', 'std_option', 'std_stock'];
window.excelHeaders = []; 

window.isPreAssignMode = false;
window.selectedPreAssignItem = null;

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
        if(document.getElementById('incoming-sidebar').classList.contains('open')) window.renderIncomingQueue();
        applyFiltersAndSort();
    }, (error) => console.error("입고예정데이터 오류:", error));
}

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
                if (conf.sheetUrlOrder) window.sheetUrlOrder = conf.sheetUrlOrder;
                if (conf.sheetUrlBuy) window.sheetUrlBuy = conf.sheetUrlBuy;
                if (conf.sheetUrl && !conf.sheetUrlOrder) window.sheetUrlOrder = conf.sheetUrl;
                if (conf.visibleColumns) window.visibleColumns = conf.visibleColumns;
                if (conf.excelHeaders) window.excelHeaders = conf.excelHeaders;
                return;
            }
            originalData.push({ id: docSnap.id, ...docSnap.data() });
        });
        
        renderTableHeader(); 
        applyFiltersAndSort(); 
        if(document.getElementById('incoming-sidebar').classList.contains('open')) window.renderIncomingQueue();
        
        const pop = document.getElementById('usage-popup');
        if (pop && pop.style.display === 'block') window.calculateAndRenderUsage();
    }, (error) => { console.error("A창고 오류:", error); });
}

window.onload = () => {
    setupRealtimeListenerA();
    setupRealtimeListenerB();
};

function renderTableHeader() {
    const theadTr = document.getElementById('dynamic-thead-tr');
    const popupContainer = document.getElementById('dynamic-popups');
    if (!theadTr || !popupContainer) return;

    let html = `<th class="checkbox-cell"><input type="checkbox" id="check-all" class="loc-check" onclick="toggleAllCheckboxes(this)"></th>`;
    let popupHtml = '';
    
    window.visibleColumns.forEach(col => {
        if (col === 'std_dong') { html += createTh('dong', '동', 80, true); popupHtml += `<div id="pop-dong" class="filter-popup"></div>`; }
        else if (col === 'std_pos') { html += createTh('pos', '위치', 80, true); popupHtml += `<div id="pop-pos" class="filter-popup"></div>`; }
        else if (col === 'std_id') { html += createTh('id', '로케이션', 150, true); popupHtml += `<div id="pop-id" class="filter-popup"></div>`; }
        else if (col === 'std_code') { html += createTh('code', '상품코드', 150, true); popupHtml += `<div id="pop-code" class="filter-popup"></div>`; }
        else if (col === 'std_name') { html += createTh('name', '상품명', 'auto', true); popupHtml += `<div id="pop-name" class="filter-popup"></div>`; }
        else if (col === 'std_option') { html += createTh('option', '옵션', 180, true); popupHtml += `<div id="pop-option" class="filter-popup"></div>`; }
        else if (col === 'std_stock') { html += createTh('stock', '정상재고', 130, true); popupHtml += `<div id="pop-stock" class="filter-popup"></div>`; }
        else if (col.startsWith('cus_')) {
            const label = col.replace('cus_', '');
            html += createTh(col, label, 120, false); 
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

window.openSettingsModal = (e) => {
    if(e) e.stopPropagation();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    
    const container = document.getElementById('setting-headers-container');
    let html = '';
    
    const stdCols = [
        { id: 'std_dong', label: '동' }, { id: 'std_pos', label: '위치' }, { id: 'std_id', label: '로케이션(ID)' },
        { id: 'std_code', label: '상품코드' }, { id: 'std_name', label: '상품명' }, { id: 'std_option', label: '옵션' }, { id: 'std_stock', label: '정상재고' }
    ];
    
    stdCols.forEach(col => {
        const isChecked = window.visibleColumns.includes(col.id) ? 'checked' : '';
        html += `<label style="display:flex; align-items:center; gap:5px; width: 45%;"><input type="checkbox" class="chk-header" value="${col.id}" ${isChecked}> ${col.label}</label>`;
    });
    
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
            return !hasContent && !d.preAssigned; 
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
    document.getElementById('modal-sheet-url-order').value = window.sheetUrlOrder || '';
    document.getElementById('modal-sheet-url-buy').value = window.sheetUrlBuy || '';
    document.getElementById('sheet-modal').style.display = 'flex';
};

window.saveSheetUrl = async () => {
    const urlOrder = document.getElementById('modal-sheet-url-order').value.trim();
    const urlBuy = document.getElementById('modal-sheet-url-buy').value.trim();
    
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { sheetUrlOrder: urlOrder, sheetUrlBuy: urlBuy }, { merge: true });
        window.sheetUrlOrder = urlOrder;
        window.sheetUrlBuy = urlBuy;
        alert("✅ 구글시트 링크가 안전하게 저장되었습니다.");
        if (typeof window.closeSheetModal === 'function') window.closeSheetModal();
    } catch(e) { console.error("링크 저장 실패:", e); alert("오류가 발생했습니다."); }
};

const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');

function formatExcelDate(excelDate) {
    if (!excelDate || excelDate.toString().trim() === "") return '';
    if (typeof excelDate === 'string' && (excelDate.includes('-') || excelDate.includes('.'))) return excelDate;
    
    const num = parseFloat(excelDate);
    if (isNaN(num)) return excelDate;
    
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

window.syncIncomingData = async () => {
    if (!window.sheetUrlOrder && !window.sheetUrlBuy) return alert("구글시트 링크가 설정되지 않았습니다.\n[⚙️ 구글시트 링크 설정] 에서 링크를 저장해주세요.");
    window.showLoading("🔄 원본 시트에서 데이터를 분석하여 가져오는 중입니다...");
    
    try {
        let combinedData = [];

        const fetchAndParse = async (url, sourceName) => {
            if (!url) return [];
            
            let textData = "";
            try {
                const res1 = await fetch(url);
                if (!res1.ok) throw new Error("1차 다이렉트 연결 실패");
                textData = await res1.text(); 
            } catch (e1) {
                try {
                    const res2 = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
                    if (!res2.ok) throw new Error("2차 프록시 실패");
                    textData = await res2.text();
                } catch (e2) {
                    const res3 = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
                    if (!res3.ok) throw new Error("3차 프록시 실패");
                    textData = await res3.text();
                }
            }

            const workbook = XLSX.read(textData, { type: 'string' });
            const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
            
            let headerRowIndex = -1;
            let pureHeaders = [];
            
            for (let i = 0; i < Math.min(20, rawData.length); i++) {
                const row = rawData[i];
                const cleanRow = row.map(h => cleanKey(h));
                if (cleanRow.includes('어드민상품코드') || cleanRow.includes('상품코드')) {
                    headerRowIndex = i;
                    pureHeaders = cleanRow; 
                    break;
                }
            }

            if (headerRowIndex === -1) return []; 

            const parsedList = [];
            for (let i = headerRowIndex + 1; i < rawData.length; i++) {
                let rowObj = {};
                let isEmpty = true;
                for (let j = 0; j < pureHeaders.length; j++) {
                    const key = pureHeaders[j];
                    if (key) {
                        rowObj[key] = rawData[i][j];
                        if (rawData[i][j] !== "" && rawData[i][j] !== undefined) isEmpty = false;
                    }
                }
                if (!isEmpty) {
                    rowObj.source = sourceName; 
                    parsedList.push(rowObj);
                }
            }
            return parsedList;
        };

        const [orderData, buyData] = await Promise.all([
            fetchAndParse(window.sheetUrlOrder, '제작'),
            fetchAndParse(window.sheetUrlBuy, '사입')
        ]);

        combinedData = [...orderData, ...buyData];

        const finalJson = combinedData.map(row => {
            let code = row['어드민상품코드'] || row['상품코드'] || '';
            let name = row['상품명'] || row['공급처상품명'] || '';
            
            let rawQty = row['총미입고수량본사입고기준'];
            if (rawQty === undefined || rawQty === "") rawQty = row['최종미입고수량추가입고예정'];
            if (rawQty === undefined || rawQty === "") rawQty = row['미입고수량'];
            let qty = Number(rawQty) || 0;
            
            let rawDate = "";
            if (row.source === '제작') {
                rawDate = row['공장출고예상일자'] || row['공장출고예상일'] || row['출고예상일'];
            } else if (row.source === '사입') {
                rawDate = row['검수창고도착일'];
            }
            
            let date = formatExcelDate(rawDate);

            return {
                '상품코드': code,
                '상품명': name,
                '옵션': row['옵션'] || '',
                '입고대기수량': qty,
                '공장출고예상일': date,
                'source': row.source || '기타',
                ...row
            };
        }).filter(row => row['상품코드'] && row['상품코드'].toString().trim() !== '' && Number(row['입고대기수량']) > 0 && row['공장출고예상일'] && row['공장출고예상일'].toString().trim() !== '');

        if (finalJson.length > 0) {
            await updateDatabaseB(finalJson, 'IncomingData', null, true);
            window.hideLoading();
            alert(`✅ 입고 대기 상품 연동 완료!\n(오더리스트 ${orderData.length}건, 사입리스트 ${buyData.length}건)`);
        } else { 
            window.hideLoading(); 
            alert("입고 대기(수량 1개 이상) 상품이 없거나 데이터를 찾지 못했습니다."); 
        }
    } catch (error) { 
        window.hideLoading(); 
        alert(`🚨 연결 실패!\n데이터를 가져오지 못했습니다.\n(${error.message})`); 
        console.error("데이터 동기화 실패:", error);
    }
};

window.saveCapacity2F = async function() {
    const input = document.getElementById('input-cap-2f');
    if (!input) return;
    const newVal = parseInt(input.value.replace(/,/g, ''), 10);
    if (isNaN(num)) return alert("올바른 수량을 입력해주세요.");
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
        let todayReservedCount = 0;
        let preAssignedCount = 0; 
        
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        locations.forEach(loc => {
            const isUsed = (loc.code && loc.code.trim() !== '' && loc.code !== loc.id) || (loc.name && loc.name.trim() !== '');
            if (isUsed) used++;
            if ((loc.assignedAt && loc.assignedAt >= todayStart) || (loc.reserved && loc.reservedAt >= todayStart)) {
                todayReservedCount++;
            }
            if (loc.preAssigned) preAssignedCount++;
            const zone = loc.id.charAt(0).toUpperCase();
            if (!zoneStats[zone]) { zoneStats[zone] = { total: 0, used: 0 }; }
            zoneStats[zone].total++;
            if (isUsed) zoneStats[zone].used++;
        });

        const usageRate = ((used / total) * 100).toFixed(1);
        
        html += `
            <div style="display:flex; justify-content: space-around; background: #eef1ff; padding: 10px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #c5cae9;">
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#555; font-weight:bold;">당일지정수량(예약)</div>
                    <div style="font-size:18px; color:var(--primary); font-weight:900;">${todayReservedCount}</div>
                </div>
                <div style="width:1px; background:#ccc;"></div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#555; font-weight:bold;">선지정수량(준비중)</div>
                    <div style="font-size:18px; color:#e65100; font-weight:900;">${preAssignedCount}</div>
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
    const locPop = document.getElementById('pop-id');
    if (!locPop) return;
    let prefixSet = new Set(originalData.map(d => d.id.charAt(0))); prefixSet.add('★');
    const prefixes = [...prefixSet].sort((a, b) => (a === '★' ? -1 : (b === '★' ? 1 : a.localeCompare(b))));
    let locHtml = getSortButtonsHtml('id');
    const isAllSelected = filters.loc.length === 0;
    locHtml += `<div class="filter-option ${isAllSelected ? 'selected' : ''}" onclick="toggleLocFilter('all')">${isAllSelected ? '✔️ ' : ''}전체보기</div>`;
    prefixes.forEach(p => { const isSelected = filters.loc.includes(p); locHtml += `<div class="filter-option ${isSelected ? 'selected' : ''}" onclick="toggleLocFilter('${p}')">${isSelected ? '✔️ ' : ''}${p} 구역</div>`; });
    locPop.innerHTML = locHtml;
}

function updateFilterButtonStates() {
    const btnId = document.getElementById('btn-filter-id');
    if (btnId) {
        if (filters.loc.length === 0) btnId.classList.remove('active');
        else btnId.classList.add('active');
    }
    
    ['code', 'dong', 'pos', 'stock'].forEach(type => {
        const btn = document.getElementById('btn-filter-' + type);
        if (btn) {
            if (filters[type] === 'all') btn.classList.remove('active');
            else btn.classList.add('active');
        }
    });
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

    updateFilterButtonStates(); 
}

window.executeSort = (key, direction) => { sortConfig = { key: key, direction: direction }; setupFilterPopups(); applyFiltersAndSort(); if (typeof window.closeAllPopups === 'function') window.closeAllPopups(); };
window.toggleLocFilter = (val) => { 
    if (val === 'all') filters.loc = []; 
    else { 
        if (filters.loc.includes(val)) filters.loc = filters.loc.filter(v => v !== val); 
        else filters.loc.push(val); 
    } 
    setupFilterPopups(); 
    applyFiltersAndSort(); 
};
window.setFilter = (type, value) => { 
    filters[type] = value; 
    setupFilterPopups(); 
    applyFiltersAndSort(); 
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups(); 
};

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

window.handleRowClick = async function(event, locId) {
    if (event.target.tagName === 'INPUT') return;
    
    if (window.isPreAssignMode && window.selectedPreAssignItem) {
        const loc = originalData.find(d => d.id === locId);
        if (!loc) return;
        const hasContent = (loc.code && loc.code !== loc.id && loc.code.trim() !== "") || (loc.name && loc.name.trim() !== "");
        
        if (loc.preAssigned) { 
            if (loc.preAssignedCode === window.selectedPreAssignItem.code) {
                if (confirm(`이미 '${loc.preAssignedCode}' 상품으로 선지정된 자리입니다.\n지정을 해제(취소)하시겠습니까?`)) {
                    await setDoc(doc(db, LOC_COLLECTION, locId), {
                        preAssigned: false, preAssignedCode: '', preAssignedName: '', preAssignedQty: '',
                        code: '', name: '', option: '', stock: '0' 
                    }, { merge: true });
                    showToast(`[${locId}] 선지정 취소 완료`);
                    window.cancelPreAssignMode();
                    return;
                } else return;
            }
            if (!confirm(`이미 다른 상품(${loc.preAssignedCode})이 선지정된 자리입니다.\n기존 선지정을 무시하고 덮어쓰시겠습니까?`)) return; 
        } else {
            if (hasContent) { alert("🚨 이미 물건이 들어있는 자리입니다. 텅 빈 빈칸을 선택해주세요."); return; }
        }
        
        try {
            await setDoc(doc(db, LOC_COLLECTION, locId), {
                preAssigned: true,
                preAssignedCode: window.selectedPreAssignItem.code,
                preAssignedName: window.selectedPreAssignItem.name,
                preAssignedQty: window.selectedPreAssignItem.qty,
                code: window.selectedPreAssignItem.code,
                name: window.selectedPreAssignItem.name,
                option: window.selectedPreAssignItem.option || '',
                stock: window.selectedPreAssignItem.qty.toString(), 
                updatedAt: new Date()
            }, { merge: true });
            showToast(`[${locId}] 자리에 선지정 락(Lock)이 완료되었습니다!`);
            window.cancelPreAssignMode(); 
        } catch(e) { console.error(e); alert("선지정 저장 오류"); }
        return;
    }
    openEditModal(locId);
};

function renderTable(data) {
    const tbody = document.getElementById('location-list-body');
    if (!tbody) return;
    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    const checkedIds = new Set(Array.from(checkedBoxes).map(cb => cb.value));
    let html = ''; 
    data.forEach(loc => {
        let isReserved = loc.reserved === true;
        let isPreAssigned = loc.preAssigned === true;
        let rowStyle = ''; let badgeHtml = '';
        
        if (isReserved) {
            rowStyle = 'background-color: #fffde7;';
            let reserverName = loc.reservedBy || '누군가';
            badgeHtml = `<br><span class="badge-reserved">🔒 ${reserverName} 작업중</span>`;
        } else if (isPreAssigned) { 
            rowStyle = 'background-color: #ffe0b2;'; 
        }
        
        if (isPreAssigned) badgeHtml += `<br><span class="badge-incoming" style="background-color:#e65100; color:white; padding:2px 4px; border-radius:3px; font-size:11px;">📦 입고선지정: ${loc.preAssignedQty}개 대기중</span>`;
        
        let isChecked = checkedIds.has(loc.id) ? 'checked' : '';
        html += `<tr onclick="handleRowClick(event, '${loc.id}')" style="${rowStyle}">`;
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
}

const fileInputCombined = document.getElementById('excel-upload-combined');
if (fileInputCombined) {
    fileInputCombined.addEventListener('change', async function(e) {
        const files = e.target.files; if (files.length === 0) return;
        window.showLoading('데이터(직진/주차별)를 분석 및 동기화 중입니다...');
        try {
            let zikjinCount = 0; let weeklyCount = 0;
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
                if (isWeekly) weeklyCount++; else zikjinCount++;
                await updateDatabaseB(json, collectionName, null, true);
            }
            window.hideLoading();
            alert(`✅ 완료!\n(인식: 직진배송 ${zikjinCount}개 / 주차별 ${weeklyCount}개)`);
        } catch(error) { window.hideLoading(); alert('동기화 중 오류가 발생했습니다.'); console.error(error); } finally { fileInputCombined.value = ''; }
    });
}

const fileInputA = document.getElementById('excel-upload-a');
if (fileInputA) {
    fileInputA.addEventListener('change', function(e) {
        const file = e.target.files[0]; if (!file) return;
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
        let batch = writeBatch(db2); let updateCount = 0; let batchCount = 0;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            let code = (row['어드민상품코드'] || row['상품코드'])?.toString().trim();
            if (!code) continue;
            const docRef = doc(db2, collectionName, code);
            batch.set(docRef, { ...row, updatedAt: new Date() }, { merge: true });
            updateCount++; batchCount++;
            if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db2); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        if (!silent) alert(`✅ [${label}] 업데이트 완료!\n총 ${updateCount}건이 반영되었습니다.`);
    } catch (error) { console.error(`${label} 실패:`, error); if (!silent) alert(`${label} 중 오류가 발생했습니다.`); throw error; } finally { if(inputElement && !silent) inputElement.value = ''; if (!silent) window.hideLoading(); }
}

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
        const validLocIds = new Set(originalData.map(d => d.id));
        for (let i = 0; i < totalRows; i++) {
            const row = rows[i]; const rawLoc = row['로케이션']?.toString().trim();
            if (rawLoc) {
                let cleanLocId = ''; let extractedCode = '';
                if (rawLoc.includes('(')) {
                    cleanLocId = rawLoc.split('(')[0].trim();
                    const afterParen = rawLoc.substring(rawLoc.indexOf('('));
                    const sIndex = afterParen.indexOf('S');
                    if (sIndex !== -1) extractedCode = afterParen.substring(sIndex).trim();
                } else { cleanLocId = rawLoc; }
                if (cleanLocId && validLocIds.has(cleanLocId)) {
                    const finalCode = extractedCode || row['상품코드']?.toString().trim() || '';
                    const docRef = doc(db, LOC_COLLECTION, cleanLocId);
                    let updateData = { reserved: false, reservedAt: 0, reservedBy: '', updatedAt: new Date(), rawData: row };
                    if (finalCode && finalCode.trim() !== '') {
                        updateData.preAssigned = false;
                        updateData.preAssignedCode = '';
                        updateData.preAssignedName = '';
                        updateData.preAssignedQty = '';
                    }
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
        if (batchCount > 0) await batch.commit();
        alert(`✅ 완료! 총 ${updateCount}개의 로케이션 정보가 갱신되었습니다.`);
    } catch (error) { console.error("실패:", error); alert("업데이트 중 오류가 발생했습니다."); } finally { document.getElementById('excel-upload-a').value = ''; window.hideLoading(); }
}

window.copyLocationToClipboard = async (event, locId) => {
    event.stopPropagation(); 
    
    if (window.isPreAssignMode) {
        window.handleRowClick(event, locId);
        return;
    }
    
    try {
        const docRef = doc(db, LOC_COLLECTION, locId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            const data = snap.data(); const now = new Date().getTime();
            const isReserved = data.reserved === true; const reserverName = data.reservedBy || '다른 작업자';
            
            if (isReserved && reserverName === currentUserName) {
                if (confirm(`[${locId}] 내가 예약한 자리입니다.\n해제하시겠습니까?`)) {
                    await setDoc(docRef, { reserved: false, reservedAt: 0, reservedBy: '', assignedAt: 0 }, { merge: true });
                    showToast(`[${locId}] 해제 완료`);
                } else { navigator.clipboard.writeText(locId); showToast(`[${locId}] 복사 완료!`); }
                return;
            }
            
            if (isReserved) {
                if (confirm(`[${locId}]은 현재 [${reserverName}]님이 사용 중입니다.\n강제로 예약을 가져오시겠습니까?`)) {
                    await setDoc(docRef, { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName }, { merge: true });
                    navigator.clipboard.writeText(locId); showToast(`[${locId}] 강제 복사 완료!`);
                }
                return; 
            }
            
            if (data.preAssigned) { 
                if (confirm(`📦 [${locId}]는 입고예정(${data.preAssignedCode}) 선지정 구역입니다.\n선지정을 해제(취소)하시겠습니까?`)) {
                    await setDoc(docRef, { preAssigned: false, preAssignedCode: '', preAssignedName: '', preAssignedQty: '', code: '', name: '', option: '', stock: '0' }, { merge: true });
                    showToast(`[${locId}] 선지정 해제 완료!`);
                    return; 
                } else {
                    if (!confirm(`무시하고 일반 작업을 위해 예약(🔒)하시겠습니까?`)) return;
                }
            }
            
            await setDoc(docRef, { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName }, { merge: true });
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

window.addSingleLocationFromSetting = async () => {
    const inputObj = document.getElementById('setting-new-loc'); const newId = inputObj.value.trim().toUpperCase();
    if (!newId) return alert("로케이션 번호를 입력하세요.");
    try {
        const docRef = doc(db, LOC_COLLECTION, newId); const docSnap = await getDoc(docRef);
        if (docSnap.exists()) return alert(`이미 존재합니다.`);
        await setDoc(docRef, { dong: '', pos: '', code: '', name: '', option: '', stock: '0', reserved: false, reservedAt: 0, assignedAt: 0, reservedBy: '', updatedAt: new Date(), rawData: {} });
        inputObj.value = ''; alert(`✅ 추가 완료`); 
    } catch (error) { console.error(error); }
};

window.deleteSelectedLocations = async () => {
    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    if (checkedBoxes.length === 0) return alert("삭제할 대상을 선택하세요.");
    if (!confirm(`정말 삭제하시겠습니까?`)) return;
    try {
        let batch = writeBatch(db); let batchCount = 0;
        for (let i = 0; i < checkedBoxes.length; i++) {
            batch.delete(doc(db, LOC_COLLECTION, checkedBoxes[i].value));
            batchCount++;
            if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        alert(`🗑️ 삭제 완료`); 
    } catch (error) { console.error(error); }
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
    const unassignBtn = document.getElementById('btn-modal-unassign');
    unassignBtn.style.display = targetData.preAssigned ? 'inline-block' : 'none';
    document.getElementById('edit-modal').style.display = 'flex';
};

window.saveManualEdit = async () => {
    const id = document.getElementById('modal-id').value;
    const updateData = {
        dong: document.getElementById('modal-dong').value.trim(), pos: document.getElementById('modal-pos').value.trim(), code: document.getElementById('modal-code').value.trim(),
        name: document.getElementById('modal-name').value.trim(), option: document.getElementById('modal-option').value.trim(), stock: document.getElementById('modal-stock').value.trim(),
        reserved: false, reservedAt: 0, reservedBy: '', updatedAt: new Date()
    };
    try { await setDoc(doc(db, LOC_COLLECTION, id), updateData, { merge: true }); document.getElementById('edit-modal').style.display = 'none'; } 
    catch (error) { console.error(error); }
};

window.cancelPreAssignment = async () => {
    const id = document.getElementById('modal-id').value;
    if(!confirm(`[${id}] 선지정을 취소하시겠습니까?`)) return;
    try {
        await setDoc(doc(db, LOC_COLLECTION, id), { preAssigned: false, preAssignedCode: '', preAssignedName: '', preAssignedQty: '', code: '', name: '', option: '', stock: '0' }, { merge: true });
        document.getElementById('edit-modal').style.display = 'none';
        showToast("취소되었습니다.");
    } catch (error) { console.error(error); }
};

window.renderIncomingQueue = function() {
    const container = document.getElementById('incoming-list');
    if(!container) return;
    const filterSource = document.getElementById('filter-source')?.value || 'all';
    const sortType = document.getElementById('sort-incoming')?.value || 'qty-desc';

    let existingLocMap = {}; 
    originalData.forEach(loc => {
        if(loc.preAssigned && loc.preAssignedCode) existingLocMap[loc.preAssignedCode] = true;
        if(loc.code && loc.code !== loc.id) existingLocMap[loc.code] = true;
    });

    let list = [];
    for(let code in incomingData) { list.push(incomingData[code]); }

    list = list.filter(item => {
        if(filterSource !== 'all' && item.source !== filterSource) return false;
        if(existingLocMap[item['상품코드']]) return false; 
        
        if(!item['공장출고예상일'] || item['공장출고예상일'].toString().trim() === '') return false;
        
        return true;
    });

    list.sort((a, b) => {
        if(sortType === 'qty-desc') return Number(b['입고대기수량'] || 0) - Number(a['입고대기수량'] || 0);
        else if(sortType === 'date-asc') {
            let dA = a['공장출고예상일'] || '9999-99-99'; let dB = b['공장출고예상일'] || '9999-99-99';
            return dA.localeCompare(dB);
        }
        return 0;
    });

    let html = '';
    list.forEach(item => {
        let code = item['상품코드']; let qty = item['입고대기수량'] || 0;
        let name = item['상품명'] || ''; let date = item['공장출고예상일'] || '-';
        let src = item.source || '-';
        let option = item['옵션'] || '';
        html += `
            <div class="incoming-item" onclick="activatePreAssignMode('${code}', '${name.replace(/'/g, "\\'")}', '${qty}', '${option.replace(/'/g, "\\'")}')">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <div style="font-weight:bold; color:var(--primary); font-size:14px;">${code}</div>
                    <span style="font-size:10px; background:${src==='제작'?'#e3f2fd':'#fbe9e7'}; color:${src==='제작'?'#1976d2':'#d84315'}; padding:2px 5px; border-radius:3px; font-weight:bold;">${src}</span>
                </div>
                <div style="font-size:12px; color:#333; margin-bottom:6px;">${name}</div>
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
                    <span style="color:#555;">${src==='제작'?'출고일':'도착일'}: <b style="color:#d32f2f;">${date}</b></span>
                    <span style="color:#e65100; font-weight:bold; font-size:12px;">대기: ${qty}개</span>
                </div>
            </div>
        `;
    });
    container.innerHTML = html || '<div style="text-align:center; padding:30px; color:#888;">지정이 필요한 상품이 없습니다.</div>';
};

window.activatePreAssignMode = function(code, name, qty, option = '') {
    window.isPreAssignMode = true;
    window.selectedPreAssignItem = { code, name, qty, option };
    document.getElementById('pre-assign-banner-text').innerText = `${code} (${name})`;
    document.getElementById('pre-assign-banner').style.display = 'flex';
    if (window.innerWidth < 1100) document.getElementById('incoming-sidebar').classList.remove('open');
};

window.cancelPreAssignMode = function() {
    window.isPreAssignMode = false;
    window.selectedPreAssignItem = null;
    document.getElementById('pre-assign-banner').style.display = 'none';
};

window.addEventListener('keydown', function(e) { if (e.key === 'F5' || (e.ctrlKey && (e.key === 'r' || e.key === 'R'))) { e.preventDefault(); alert("🚨 실시간 동기화 중입니다."); } });
window.addEventListener('beforeunload', function(e) { e.preventDefault(); e.returnValue = ''; });
