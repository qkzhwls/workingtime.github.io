import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const { db } = initializeFirebase();
const auth = getAuth();
const LOC_COLLECTION = 'Locations';

let originalData = []; 
let sortConfig = { key: 'id', direction: 'asc' }; 
let filters = { loc: [], code: 'all', stock: 'all', dong: 'all', pos: 'all' };

let currentUserName = "비로그인 작업자";

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserName = user.displayName || user.email.split('@')[0];
    }
});

const RESERVE_EXPIRE_MS = 1800000; 

// [신규] 팝업의 숫자를 클릭했을 때 메인 화면 필터를 적용하는 함수
window.applyUsageFilter = function(zone, state) {
    // 1. 구역(loc) 필터 설정
    if (zone === 'all') {
        filters.loc = [];
    } else {
        filters.loc = [zone];
    }
    
    // 2. 사용/빈칸(code) 필터 설정
    if (state === 'used') {
        filters.code = 'not-empty';
    } else if (state === 'empty') {
        filters.code = 'empty';
    } else {
        filters.code = 'all';
    }
    
    // 3. UI 버튼 불 들어오게 업데이트
    updateLocPopupUI();
    const btnLoc = document.getElementById('btn-filter-loc');
    if (btnLoc) {
        if (filters.loc.length === 0) btnLoc.classList.remove('active');
        else btnLoc.classList.add('active');
    }
    
    const btnCode = document.getElementById('btn-filter-code');
    if (btnCode) {
        if (filters.code === 'all') btnCode.classList.remove('active');
        else btnCode.classList.add('active');
    }
    
    // 4. 화면에 실제 적용하고 팝업 닫기
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
};

window.calculateAndRenderUsage = function() {
    const popup = document.getElementById('usage-popup');
    if (!popup) return;

    // [변경점] K구역 데이터는 계산에서 완전 제외
    const locations = originalData.filter(d => {
        if (d.id === 'INFO_USAGE_STATS') return false;
        if (d.id.charAt(0).toUpperCase() === 'K') return false;
        return true;
    });
    
    let total = locations.length;
    if (total === 0) {
        popup.innerHTML = '<div style="padding: 10px;">데이터가 없습니다.</div>';
        return;
    }

    let used = 0;
    let zoneStats = {};

    locations.forEach(loc => {
        const isUsed = (loc.code && loc.code.trim() !== '' && loc.code !== loc.id) || (loc.name && loc.name.trim() !== '');
        if (isUsed) used++;

        const zone = loc.id.charAt(0).toUpperCase();
        if (!zoneStats[zone]) {
            zoneStats[zone] = { total: 0, used: 0 };
        }
        zoneStats[zone].total++;
        if (isUsed) zoneStats[zone].used++;
    });

    const usageRate = ((used / total) * 100).toFixed(1);

    // [변경점] 사용중, 빈칸 숫자에 클릭 이벤트 추가
    let html = `
        <div style="font-size:15px; font-weight:bold; margin-bottom:5px; color:var(--primary); text-align:center;">
            📊 전체 창고 사용률: ${usageRate}%
        </div>
        <div style="font-size:11px; color:#888; text-align:center; margin-bottom:10px;">※ 표의 숫자를 클릭하면 해당 구역으로 필터링됩니다.</div>
        <table class="usage-table" style="width:100%;">
            <thead>
                <tr>
                    <th>구역명</th>
                    <th>총 칸수</th>
                    <th>사용중</th>
                    <th>빈칸</th>
                    <th>사용률</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="font-weight:bold; color:#d32f2f;">전체 합계</td>
                    <td style="font-weight:bold;">${total}</td>
                    <td style="font-weight:bold; color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'used')" title="전체 사용중 보기">${used}</td>
                    <td style="font-weight:bold; color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'empty')" title="전체 빈칸 보기">${total - used}</td>
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
                <td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${z}', 'used')" title="${z}구역 사용중 보기">${zUsed}</td>
                <td style="color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${z}', 'empty')" title="${z}구역 빈칸 보기">${zEmpty}</td>
                <td>${zRate}%</td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    popup.innerHTML = html;
};

window.toggleUsagePopup = function(e) {
    e.stopPropagation();
    const pop = document.getElementById('usage-popup');
    const isVisible = pop.style.display === 'block';
    
    if (typeof window.closeAllPopups === 'function') {
        window.closeAllPopups();
    }
    
    if (!isVisible) {
        pop.style.display = 'block';
        window.calculateAndRenderUsage();
    }
};

function setupRealtimeListener() {
    const q = collection(db, LOC_COLLECTION);
    
    onSnapshot(q, (snapshot) => {
        document.getElementById('firebase-guide').style.display = 'none';
        
        originalData = [];
        snapshot.forEach(docSnap => {
            if (docSnap.id === 'INFO_USAGE_STATS') return;
            originalData.push({ id: docSnap.id, ...docSnap.data() });
        });

        setupFilterPopups();
        applyFiltersAndSort();
        
        const pop = document.getElementById('usage-popup');
        if (pop && pop.style.display === 'block') {
            window.calculateAndRenderUsage();
        }
    }, (error) => {
        console.error("실시간 동기화 오류:", error);
    });
}

function getSortButtonsHtml(key) {
    return `
        <div class="filter-option" onclick="executeSort('${key}', 'asc')">⬆️ 오름차순 정렬</div>
        <div class="filter-option" onclick="executeSort('${key}', 'desc')">⬇️ 내림차순 정렬</div>
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
    locHtml += `<div class="filter-option ${isAllSelected ? 'selected' : ''}" onclick="toggleLocFilter('all')">
        ${isAllSelected ? '✔️ ' : ''}전체보기
    </div>`;
    
    prefixes.forEach(p => {
        const isSelected = filters.loc.includes(p);
        locHtml += `<div class="filter-option ${isSelected ? 'selected' : ''}" onclick="toggleLocFilter('${p}')">
            ${isSelected ? '✔️ ' : ''}${p} 구역
        </div>`;
    });
    locPop.innerHTML = locHtml;
}

function setupFilterPopups() {
    const codePop = document.getElementById('pop-code');
    const namePop = document.getElementById('pop-name');
    const optionPop = document.getElementById('pop-option');
    const stockPop = document.getElementById('pop-stock');

    updateLocPopupUI();

    let codeHtml = getSortButtonsHtml('code');
    codeHtml += '<div class="filter-option" onclick="setFilter(\'code\', \'all\')">전체보기</div>';
    codeHtml += '<div class="filter-option" onclick="setFilter(\'code\', \'empty\')">빈칸</div>';
    codeHtml += '<div class="filter-option" onclick="setFilter(\'code\', \'not-empty\')">내용있음</div>';
    if(codePop) codePop.innerHTML = codeHtml;

    if(namePop) namePop.innerHTML = getSortButtonsHtml('name');
    if(optionPop) optionPop.innerHTML = getSortButtonsHtml('option');

    const dongs = [...new Set(originalData.map(d => (d.dong || '').toString()))].filter(Boolean).sort();
    let dongHtml = getSortButtonsHtml('dong') + `<div class="filter-option" onclick="setFilter('dong', 'all')">전체보기</div>`;
    dongs.forEach(d => { dongHtml += `<div class="filter-option" onclick="setFilter('dong', '${d}')">${d}</div>`; });
    if(document.getElementById('pop-dong')) document.getElementById('pop-dong').innerHTML = dongHtml;

    const poses = [...new Set(originalData.map(d => (d.pos || '').toString()))].filter(Boolean).sort();
    let posHtml = getSortButtonsHtml('pos') + `<div class="filter-option" onclick="setFilter('pos', 'all')">전체보기</div>`;
    poses.forEach(p => { posHtml += `<div class="filter-option" onclick="setFilter('pos', '${p}')">${p}</div>`; });
    if(document.getElementById('pop-pos')) document.getElementById('pop-pos').innerHTML = posHtml;

    const stocks = [...new Set(originalData.map(d => (d.stock || '0').toString()))].sort((a, b) => Number(a) - Number(b));
    let stockHtml = getSortButtonsHtml('stock');
    stockHtml += `<div class="filter-option" onclick="setFilter(\'stock\', \'all\')">전체보기</div>`;
    stocks.forEach(s => {
        stockHtml += `<div class="filter-option" onclick="setFilter('stock', '${s}')">${s}</div>`;
    });
    if(stockPop) stockPop.innerHTML = stockHtml;
}

window.executeSort = (key, direction) => {
    sortConfig = { key: key, direction: direction };
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
};

window.toggleLocFilter = (val) => {
    if (val === 'all') filters.loc = [];
    else {
        if (filters.loc.includes(val)) filters.loc = filters.loc.filter(v => v !== val);
        else filters.loc.push(val);
    }
    updateLocPopupUI();
    const btn = document.getElementById('btn-filter-loc');
    if (btn) {
        if (filters.loc.length === 0) btn.classList.remove('active');
        else btn.classList.add('active');
    }
    applyFiltersAndSort();
};

window.setFilter = (type, value) => {
    filters[type] = value;
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
        
        // [변경점] 사용률 계산 기준과 동일하게 상품코드나 상품명 둘 중 하나라도 있으면 '내용있음'으로 통일
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
                <td>${loc.stock || '0'}</td>
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
            
            navigator.clipboard.writeText(locId).then(() => {
                showToast(`[${locId}] 복사 및 예약 완료!`);
            }).catch(err => {
                alert('복사 기능을 지원하지 않는 브라우저입니다.');
            });
        }
    } catch (error) {
        console.error('복사/예약 실패:', error);
        alert('예약 처리 중 오류가 발생했습니다. (파이어베이스 한도 초과 등)');
    }
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

        inputObj.value = ''; 
        alert(`✅ [${newId}] 로케이션 추가 완료`); 
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

const fileInput = document.getElementById('excel-upload');
if (fileInput) {
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            
            const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            
            if (json.length > 0) {
                updateDatabase(json);
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

async function updateDatabase(rows) {
    const totalRows = rows.length;
    
    const tbody = document.getElementById('location-list-body');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" style="padding:50px; font-weight:bold; color:#3d5afe;">데이터 검증 및 동기화 중입니다... 잠시만 기다려주세요.</td></tr>`;
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
        document.getElementById('excel-upload').value = ''; 
        
    } catch (error) {
        console.error("실패:", error);
        alert("업데이트 중 오류가 발생했습니다.");
        document.getElementById('excel-upload').value = ''; 
    }
}

window.onload = setupRealtimeListener;

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
