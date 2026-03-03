import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, writeBatch, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// config.js에서 db(A창고), db2(B창고) 모두 가져오기
const { db, auth, db2 } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

let originalData = []; 
let zikjinData = {}; // B창고 - 직진배송 데이터
let weeklyData = {}; // B창고 - 주차별 데이터
let sortConfig = { key: 'id', direction: 'asc' }; 
let filters = { loc: [], code: 'all', stock: 'all', dong: 'all', pos: 'all' };

let currentUserName = "비로그인 작업자";
window.currentUsageTab = '3F';
window.capacity2F = 200000;

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserName = user.displayName || user.email.split('@')[0];
    }
});

const RESERVE_EXPIRE_MS = 1800000; 

// [신규] B창고(직진배송/주차별) 실시간 수신 리스너
function setupRealtimeListenerB() {
    if (!db2) return;
    
    // 직진배송 데이터 구독
    onSnapshot(collection(db2, 'ZikjinData'), (snapshot) => {
        zikjinData = {};
        snapshot.forEach(docSnap => { zikjinData[docSnap.id] = docSnap.data(); });
        applyFiltersAndSort();
    }, (error) => console.error("직진배송 동기화 오류:", error));

    // 주차별 데이터 구독
    onSnapshot(collection(db2, 'WeeklyData'), (snapshot) => {
        weeklyData = {};
        snapshot.forEach(docSnap => { weeklyData[docSnap.id] = docSnap.data(); });
        applyFiltersAndSort();
    }, (error) => console.error("주차별데이터 동기화 오류:", error));
}

// A창고(로케이션) 실시간 수신 리스너
function setupRealtimeListenerA() {
    const q = collection(db, LOC_COLLECTION);
    
    onSnapshot(q, (snapshot) => {
        document.getElementById('firebase-guide').style.display = 'none';
        
        originalData = [];
        snapshot.forEach(docSnap => {
            if (docSnap.id === 'INFO_USAGE_STATS') return;
            if (docSnap.id === 'INFO_CONFIG') {
                if (docSnap.data().capacity2F) window.capacity2F = docSnap.data().capacity2F;
                return;
            }
            originalData.push({ id: docSnap.id, ...docSnap.data() });
        });

        setupFilterPopups();
        applyFiltersAndSort();
        
        const pop = document.getElementById('usage-popup');
        if (pop && pop.style.display === 'block') {
            window.calculateAndRenderUsage();
        }
    }, (error) => {
        console.error("A창고 실시간 동기화 오류:", error);
    });
}

// 창고 2개 동시 구독 시작
window.onload = () => {
    setupRealtimeListenerA();
    setupRealtimeListenerB();
};

window.saveCapacity2F = async function() {
    const input = document.getElementById('input-cap-2f');
    if (!input) return;
    
    const newVal = parseInt(input.value.replace(/,/g, ''), 10);
    if (isNaN(newVal) || newVal <= 0) return alert("올바른 수량을 입력해주세요.");
    
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { capacity2F: newVal }, { merge: true });
        alert(`2층 기준 수량이 ${newVal.toLocaleString()}장으로 변경되었습니다.`);
    } catch(e) {
        console.error("수량 변경 실패:", e);
        alert("수량 변경 중 오류가 발생했습니다.");
    }
};

window.switchUsageTab = function(tab) {
    window.currentUsageTab = tab;
    window.calculateAndRenderUsage();
};

window.applyUsageFilter = function(zone, state) {
    filters = { loc: [], code: 'all', stock: 'all', dong: 'all', pos: 'all' };
    if (zone !== 'all') filters.loc = [zone];
    if (state === 'used') filters.code = 'not-empty';
    else if (state === 'empty') filters.code = 'empty';
    
    setupFilterPopups();
    
    ['loc', 'code', 'dong', 'pos', 'stock'].forEach(id => {
        const btn = document.getElementById('btn-filter-' + id);
        if (btn) {
            if (id === 'loc') {
                if (filters.loc.length === 0) btn.classList.remove('active');
                else btn.classList.add('active');
            } else {
                if (filters[id] === 'all') btn.classList.remove('active');
                else btn.classList.add('active');
            }
        }
    });
    
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
};

window.calculateAndRenderUsage = function() {
    const popup = document.getElementById('usage-popup');
    if (!popup) return;

    let html = `
        <div style="display:flex; gap:10px; margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;">
            <button onclick="switchUsageTab('3F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; background:${window.currentUsageTab === '3F' ? 'var(--primary)' : '#eee'}; color:${window.currentUsageTab === '3F' ? 'white' : '#555'}">3층 로케이션</button>
            <button onclick="switchUsageTab('2F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; background:${window.currentUsageTab === '2F' ? 'var(--primary)' : '#eee'}; color:${window.currentUsageTab === '2F' ? 'white' : '#555'}">2층 창고재고</button>
        </div>
    `;

    if (window.currentUsageTab === '3F') {
        const locations = originalData.filter(d => d.id.charAt(0).toUpperCase() !== 'K');
        let total = locations.length;
        if (total === 0) {
            html += '<div style="padding: 10px;">데이터가 없습니다.</div>';
            popup.innerHTML = html;
            return;
        }

        let used = 0;
        let zoneStats = {};

        locations.forEach(loc => {
            const isUsed = (loc.code && loc.code.trim() !== '' && loc.code !== loc.id) || (loc.name && loc.name.trim() !== '');
            if (isUsed) used++;

            const zone = loc.id.charAt(0).toUpperCase();
            if (!zoneStats[zone]) { zoneStats[zone] = { total: 0, used: 0 }; }
            zoneStats[zone].total++;
            if (isUsed) zoneStats[zone].used++;
        });

        const usageRate = ((used / total) * 100).toFixed(1);

        html += `
            <div style="font-size:15px; font-weight:bold; margin-bottom:5px; color:var(--primary); text-align:center;">
                📊 3층 전체 사용률: ${usageRate}%
            </div>
            <div style="font-size:11px; color:#888; text-align:center; margin-bottom:10px;">※ 표의 숫자를 클릭하면 기존 필터를 해제하고 해당 구역만 보여줍니다.</div>
            <table class="usage-table" style="width:100%;">
                <thead>
                    <tr><th>구역명</th><th>총 칸수</th><th>사용중</th><th>빈칸</th><th>사용률</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="font-weight:bold; color:#d32f2f;">전체 합계</td>
                        <td style="font-weight:bold;">${total}</td>
                        <td style="font-weight:bold; color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'used')">${used}</td>
                        <td style="font-weight:bold; color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'empty')">${total - used}</td>
                        <td style="font-weight:bold; color:#d32f2f;">${usageRate}%</td>
                    </tr>
        `;

        const zones = Object.keys(zoneStats).sort((a,b) => (a==='★'?-1:(b==='★'?1:a.localeCompare(b))));
        zones.forEach(z => {
            const zTotal = zoneStats[z].total;
            const zUsed = zoneStats[z].used;
            const zEmpty = zTotal - zUsed;
            const zRate = ((zUsed / zTotal) * 100).toFixed(1);

            html += `
                <tr>
                    <td><strong>${z}</strong> 구역</td>
                    <td>${zTotal}</td>
                    <td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${z}', 'used')">${zUsed}</td>
                    <td style="color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${z}', 'empty')">${zEmpty}</td>
                    <td>${zRate}%</td>
                </tr>
            `;
        });
        html += `</tbody></table>`;
        
    } else {
        let sum2F = 0;
        originalData.forEach(loc => { sum2F += Number(loc.stock2f || 0); });
        let rate2F = ((sum2F / window.capacity2F) * 100).toFixed(1);

        html += `
            <div style="font-size:15px; font-weight:bold; margin-bottom:15px; color:var(--primary); text-align:center;">
                🏢 2층 전체 창고 사용률: ${rate2F}%
            </div>
            <table class="usage-table" style="width:100%;">
                <tr>
                    <th style="background:#eef1ff; width: 40%;">총 적재가능수량</th>
                    <td style="text-align: right;">
                        <input type="number" id="input-cap-2f" value="${window.capacity2F}" style="width:80px; padding:3px; text-align:right; font-size:13px; font-weight:bold;"> 장
                        <button onclick="saveCapacity2F()" style="padding:4px 8px; margin-left:5px; font-size:11px; background:var(--primary); color:white; border:none; border-radius:3px; cursor:pointer;">기준변경</button>
                    </td>
                </tr>
                <tr>
                    <th style="background:#eef1ff;">현재 적재수량</th>
                    <td style="font-weight:bold; color:var(--primary); text-align: right;">${sum2F.toLocaleString()} 장</td>
                </tr>
                <tr>
                    <th style="background:#eef1ff;">남은 수량</th>
                    <td style="font-weight:bold; color:#ff5252; text-align: right;">${(window.capacity2F - sum2F).toLocaleString()} 장</td>
                </tr>
            </table>
            <div style="margin-top:15px; font-size:11px; color:#888; text-align:center;">※ 엑셀 파일의 '2층창고재고' 열을 기준으로 자동 합산됩니다.</div>
        `;
    }
    popup.innerHTML = html;
};

window.toggleUsagePopup = function(e) {
    e.stopPropagation();
    const pop = document.getElementById('usage-popup');
    const isVisible = pop.style.display === 'block';
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    if (!isVisible) {
        pop.style.display = 'block';
        window.calculateAndRenderUsage();
    }
};

function getSortButtonsHtml(key) {
    const isAsc = sortConfig.key === key && sortConfig.direction === 'asc';
    const isDesc = sortConfig.key === key && sortConfig.direction === 'desc';
    return `
        <div class="filter-option ${isAsc ? 'selected' : ''}" onclick="executeSort('${key}', 'asc')">${isAsc ? '✔️ ' : ''}⬆️ 오름차순 정렬</div>
        <div class="filter-option ${isDesc ? 'selected' : ''}" onclick="executeSort('${key}', 'desc')">${isDesc ? '✔️ ' : ''}⬇️ 내림차순 정렬</div>
        <div class="filter-divider"></div>
    `;
}

function updateLocPopupUI() {
    const locPop = document.getElementById('pop-loc');
    if (!locPop) return;

    let prefixSet = new Set(originalData.map(d => d.id.charAt(0)));
    prefixSet.add('★');
    const prefixes = [...prefixSet].sort((a, b) => (a === '★' ? -1 : (b === '★' ? 1 : a.localeCompare(b))));

    let locHtml = getSortButtonsHtml('id');
    const isAllSelected = filters.loc.length === 0;
    locHtml += `<div class="filter-option ${isAllSelected ? 'selected' : ''}" onclick="toggleLocFilter('all')">${isAllSelected ? '✔️ ' : ''}전체보기</div>`;
    
    prefixes.forEach(p => {
        const isSelected = filters.loc.includes(p);
        locHtml += `<div class="filter-option ${isSelected ? 'selected' : ''}" onclick="toggleLocFilter('${p}')">${isSelected ? '✔️ ' : ''}${p} 구역</div>`;
    });
    locPop.innerHTML = locHtml;
}

function setupFilterPopups() {
    const codePop = document.getElementById('pop-code');
    const namePop = document.getElementById('pop-name');
    const optionPop = document.getElementById('pop-option');
    const stockPop = document.getElementById('pop-stock');
    const dongPop = document.getElementById('pop-dong');
    const posPop = document.getElementById('pop-pos');

    updateLocPopupUI();

    let codeHtml = getSortButtonsHtml('code');
    codeHtml += `<div class="filter-option ${filters.code === 'all' ? 'selected' : ''}" onclick="setFilter('code', 'all')">${filters.code === 'all' ? '✔️ ' : ''}전체보기</div>`;
    codeHtml += `<div class="filter-option ${filters.code === 'empty' ? 'selected' : ''}" onclick="setFilter('code', 'empty')">${filters.code === 'empty' ? '✔️ ' : ''}빈칸</div>`;
    codeHtml += `<div class="filter-option ${filters.code === 'not-empty' ? 'selected' : ''}" onclick="setFilter('code', 'not-empty')">${filters.code === 'not-empty' ? '✔️ ' : ''}내용있음</div>`;
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
    stocks.forEach(s => {
        stockHtml += `<div class="filter-option ${filters.stock === s ? 'selected' : ''}" onclick="setFilter('stock', '${s}')">${filters.stock === s ? '✔️ ' : ''}${s}</div>`;
    });
    if(stockPop) stockPop.innerHTML = stockHtml;
}

window.executeSort = (key, direction) => {
    sortConfig = { key: key, direction: direction };
    setupFilterPopups(); 
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
};

window.toggleLocFilter = (val) => {
    if (val === 'all') filters.loc = [];
    else {
        if (filters.loc.includes(val)) filters.loc = filters.loc.filter(v => v !== val);
        else filters.loc.push(val);
    }
    setupFilterPopups(); 
    const btn = document.getElementById('btn-filter-loc');
    if (btn) {
        if (filters.loc.length === 0) btn.classList.remove('active');
        else btn.classList.add('active');
    }
    applyFiltersAndSort();
};

window.setFilter = (type, value) => {
    filters[type] = value;
    setupFilterPopups(); 
    const btnId = `btn-filter-${type}`;
    const btn = document.getElementById(btnId);
    if (btn) {
        if (value === 'all') btn.classList.remove('active');
        else btn.classList.add('active');
    }
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

        const itemStock = (item.stock || '0').toString();
        if (filters.stock !== 'all' && itemStock !== filters.stock) return false;

        return true;
    });

    filtered.sort((a, b) => {
        let aVal = a[sortConfig.key] || '';
        let bVal = b[sortConfig.key] || '';
        if (sortConfig.key === 'stock') {
            return sortConfig.direction === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
        }
        return sortConfig.direction === 'asc' ? aVal.toString().localeCompare(bVal.toString()) : bVal.toString().localeCompare(aVal.toString());
    });

    renderTable(filtered);
}

function renderTable(data) {
    const tbody = document.getElementById('location-list-body');
    if (!tbody) return;

    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    const checkedIds = new Set(Array.from(checkedBoxes).map(cb => cb.value));

    let html = '';
    const now = new Date().getTime();

    data.forEach(loc => {
        let displayCode = (loc.code === loc.id) ? '' : (loc.code || '');
        let isReserved = loc.reserved === true && (now - (loc.reservedAt || 0) <= RESERVE_EXPIRE_MS);
        let rowStyle = isReserved ? 'background-color: #fffde7;' : '';
        let reserverName = loc.reservedBy || '누군가';
        let badgeHtml = isReserved ? `<br><span class="badge-reserved">🔒 ${reserverName} 작업중</span>` : '';
        let isChecked = checkedIds.has(loc.id) ? 'checked' : '';

        html += `
            <tr onclick="if(event.target.tagName !== 'INPUT') openEditModal('${loc.id}')" style="${rowStyle}">
                <td onclick="event.stopPropagation()">
                    <input type="checkbox" class="loc-check" value="${loc.id}" ${isChecked}>
                </td>
                <td style="color:#666;">${loc.dong || ''}</td>
                <td style="color:#666;">${loc.pos || ''}</td>
                <td class="loc-copy-cell" onclick="copyLocationToClipboard(event, '${loc.id}')" title="클릭하여 복사 및 예약">
                    ${loc.id} ${badgeHtml}
                </td>
                <td style="color:#3d5afe; font-weight:bold;">${displayCode}</td>
                <td style="text-align:left;">${loc.name || ''}</td>
                <td style="text-align:left; font-size:12px;">${loc.option || ''}</td>
                <td style="font-weight:bold;">${loc.stock || '0'}</td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html || '<tr><td colspan="8" style="padding:50px;">데이터가 없습니다.</td></tr>';

    const checkAllBtn = document.getElementById('check-all');
    const allCheckboxes = document.querySelectorAll('.loc-check');
    if (checkAllBtn && allCheckboxes.length > 0) {
        checkAllBtn.checked = document.querySelectorAll('.loc-check:checked').length === allCheckboxes.length;
    }
}

// ==========================================
// [신규] B창고: 직진배송 엑셀 업로드 처리
// ==========================================
const fileInputZikjin = document.getElementById('excel-upload-b-zikjin');
if (fileInputZikjin) {
    fileInputZikjin.addEventListener('change', function(e) {
        handleExcelUpload(e.target.files[0], 'ZikjinData', document.getElementById('excel-upload-b-zikjin'));
    });
}

// ==========================================
// [신규] B창고: 주차별 엑셀 업로드 처리
// ==========================================
const fileInputWeekly = document.getElementById('excel-upload-b-weekly');
if (fileInputWeekly) {
    fileInputWeekly.addEventListener('change', function(e) {
        handleExcelUpload(e.target.files[0], 'WeeklyData', document.getElementById('excel-upload-b-weekly'));
    });
}

// 공통 B창고 업로드 함수
async function handleExcelUpload(file, collectionName, inputElement) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        if (json.length > 0) updateDatabaseB(json, collectionName, inputElement);
    };
    reader.readAsArrayBuffer(file);
}

// B창고 데이터 덮어쓰기 로직
async function updateDatabaseB(rows, collectionName, inputElement) {
    const tbody = document.getElementById('location-list-body');
    const label = collectionName === 'ZikjinData' ? '직진배송' : '주차별';
    
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="padding:50px; font-weight:bold; color:#d32f2f;">${label} 데이터를 갱신 중입니다. 잠시만 기다려주세요...</td></tr>`;
    await new Promise(resolve => setTimeout(resolve, 50));

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
        
        alert(`✅ B창고 [${label}] 업데이트 완료!\n총 ${updateCount}건의 데이터가 반영되었습니다.`);
        if(inputElement) inputElement.value = ''; 
        
    } catch (error) {
        console.error(`${label} 업데이트 실패:`, error);
        alert(`${label} 업데이트 중 오류가 발생했습니다.`);
        if(inputElement) inputElement.value = ''; 
    }
}


// ==========================================
// 기존 A창고(로케이션) 엑셀 업로드 및 처리
// ==========================================
const fileInputA = document.getElementById('excel-upload-a');
if (fileInputA) {
    fileInputA.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            
            const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            
            if (json.length > 0) {
                updateDatabaseA(json);
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

async function updateDatabaseA(rows) {
    const totalRows = rows.length;
    
    const tbody = document.getElementById('location-list-body');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" style="padding:50px; font-weight:bold; color:#3d5afe;">A창고 데이터를 검증 및 동기화 중입니다...</td></tr>`;
    }
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        let batch = writeBatch(db); let updateCount = 0; let batchCount = 0;
        let notFoundLocs = new Set(); 
        const validLocIds = new Set(originalData.map(d => d.id));

        const hasDongColumn = ('동' in rows[0] || 'dong' in rows[0]);
        const hasPosColumn = ('위치' in rows[0] || 'pos' in rows[0]);
        const hasNameColumn = ('상품명' in rows[0]);
        const hasStockColumn = ('정상재고' in rows[0]);
        const hasOptionColumn = ('옵션' in rows[0]);
        const hasStock2fColumn = ('2층창고재고' in rows[0]);

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

                        let updateData = { 
                            reserved: false, reservedAt: 0, reservedBy: '', 
                            updatedAt: new Date()
                        };

                        if (finalCode) updateData.code = finalCode;
                        if (hasNameColumn) updateData.name = row['상품명']?.toString().trim() || '';
                        if (hasOptionColumn) updateData.option = row['옵션']?.toString().trim() || '';
                        if (hasStockColumn) updateData.stock = row['정상재고']?.toString().trim() || '0';
                        if (hasDongColumn) updateData.dong = row['동']?.toString().trim() || row['dong']?.toString().trim() || '';
                        if (hasPosColumn) updateData.pos = row['위치']?.toString().trim() || row['pos']?.toString().trim() || '';
                        if (hasStock2fColumn) updateData.stock2f = row['2층창고재고']?.toString().trim() || '0';

                        batch.set(docRef, updateData, { merge: true });

                        updateCount++; batchCount++;
                        if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
                    }
                }
            }
        }
        
        if (batchCount > 0) await batch.commit();
        
        let resultMessage = `✅ 완료! 총 ${updateCount}개의 로케이션 정보가 갱신되었습니다.`;
        if (notFoundLocs.size > 0) {
            const notFoundArray = Array.from(notFoundLocs);
            resultMessage += `\n\n⚠️ 다음 ${notFoundLocs.size}개의 로케이션은 시스템에 존재하지 않아 제외되었습니다:\n[${notFoundArray.join(', ')}]`;
        }
        
        alert(resultMessage);
        document.getElementById('excel-upload-a').value = ''; 
        
    } catch (error) {
        console.error("실패:", error);
        alert("업데이트 중 오류가 발생했습니다.");
        document.getElementById('excel-upload-a').value = ''; 
    }
}

// 부가 기능 (예약 복사, 모달 등 유지)
window.copyLocationToClipboard = async (event, locId) => {
    event.stopPropagation(); 
    try {
        const docRef = doc(db, LOC_COLLECTION, locId);
        const snap = await getDoc(docRef);
        
        if (snap.exists()) {
            const data = snap.data();
            const now = new Date().getTime();
            
            const isReserved = data.reserved === true;
            const reservedTime = data.reservedAt || 0;
            const reserverName = data.reservedBy || '다른 작업자';
            const isExpired = (now - reservedTime) > RESERVE_EXPIRE_MS;

            if (isReserved && !isExpired && reserverName === currentUserName) {
                if (confirm(`[${locId}] 내가 예약한 자리입니다.\n예약을 해제(취소)하시겠습니까?`)) {
                    await setDoc(docRef, { reserved: false, reservedAt: 0, reservedBy: '' }, { merge: true });
                    showToast(`[${locId}] 예약 해제 완료`);
                } else {
                    navigator.clipboard.writeText(locId);
                    showToast(`[${locId}] 내 예약 복사 완료!`);
                }
                return;
            }

            if (isReserved && !isExpired) {
                const rTime = new Date(reservedTime);
                const timeStr = `${rTime.getHours()}:${String(rTime.getMinutes()).padStart(2, '0')}`;

                if (confirm(`[${locId}] 로케이션은 현재 [${reserverName}]님이 ${timeStr}부터 사용(예약) 중입니다.\n강제로 예약을 뺏어오시겠습니까?`)) {
                    await setDoc(docRef, { reserved: true, reservedAt: now, reservedBy: currentUserName }, { merge: true });
                    navigator.clipboard.writeText(locId);
                    showToast(`[${locId}] 예약을 뺏어와 복사했습니다.`);
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
    if(toast) {
        toast.innerText = message;
        toast.classList.add("show");
        setTimeout(() => { toast.classList.remove("show"); }, 1500);
    }
}

window.toggleAllCheckboxes = (source) => {
    const checkboxes = document.querySelectorAll('.loc-check');
    checkboxes.forEach(cb => cb.checked = source.checked);
};

window.addSingleLocation = async () => {
    const inputObj = document.getElementById('new-loc-id');
    const newId = inputObj.value.trim().toUpperCase();
    if (!newId) return alert("추가할 로케이션 번호를 입력해주세요.");

    try {
        const docRef = doc(db, LOC_COLLECTION, newId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) return alert(`[${newId}] 로케이션은 이미 존재합니다.`);

        await setDoc(docRef, {
            dong: '', pos: '', code: '', name: '', option: '', stock: '0', 
            reserved: false, reservedAt: 0, reservedBy: '', updatedAt: new Date()
        });
        inputObj.value = ''; alert(`✅ [${newId}] 로케이션 추가 완료`); 
    } catch (error) { console.error("추가 실패:", error); }
};

window.deleteSelectedLocations = async () => {
    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    if (checkedBoxes.length === 0) return alert("삭제할 로케이션을 선택해주세요.");
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
        dong: document.getElementById('modal-dong').value.trim(),
        pos: document.getElementById('modal-pos').value.trim(),
        code: document.getElementById('modal-code').value.trim(),
        name: document.getElementById('modal-name').value.trim(),
        option: document.getElementById('modal-option').value.trim(),
        stock: document.getElementById('modal-stock').value.trim(),
        reserved: false, reservedAt: 0, reservedBy: '', 
        updatedAt: new Date()
    };

    try {
        await setDoc(doc(db, LOC_COLLECTION, id), updateData, { merge: true });
        document.getElementById('edit-modal').style.display = 'none'; 
    } catch (error) { console.error("수정 실패:", error); }
};

window.addEventListener('keydown', function(e) {
    if (e.key === 'F5' || (e.ctrlKey && (e.key === 'r' || e.key === 'R'))) {
        e.preventDefault(); 
        alert("🚨 실시간 동기화 모드 작동 중입니다.\n과도한 요금 발생을 막기 위해 새로고침을 차단했습니다.");
    }
});

window.addEventListener('beforeunload', function(e) {
    e.preventDefault();
    e.returnValue = ''; 
});
