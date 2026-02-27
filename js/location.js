import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

let originalData = []; 
let sortConfig = { key: 'id', direction: 'asc' }; 
let filters = { loc: [], code: 'all', stock: 'all' };

async function loadAndRender() {
    try {
        const querySnapshot = await getDocs(collection(db, LOC_COLLECTION));
        originalData = [];
        querySnapshot.forEach(docSnap => {
            originalData.push({ id: docSnap.id, ...docSnap.data() });
        });
        const checkAllBtn = document.getElementById('check-all');
        if(checkAllBtn) checkAllBtn.checked = false;
        setupFilterPopups();
        applyFiltersAndSort();
    } catch (error) { console.error("로딩 실패:", error); }
}

// 필터 및 정렬 UI 관련 로직 (기존과 동일)
function getSortButtonsHtml(key) {
    return `<div class="filter-option" onclick="executeSort('${key}', 'asc')">⬆️ 오름차순 정렬</div>
            <div class="filter-option" onclick="executeSort('${key}', 'desc')">⬇️ 내림차순 정렬</div><div class="filter-divider"></div>`;
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
    updateLocPopupUI();
    const codePop = document.getElementById('pop-code');
    let codeHtml = getSortButtonsHtml('code');
    codeHtml += `<div class="filter-option" onclick="setFilter('code', 'all')">전체보기</div>
                 <div class="filter-option" onclick="setFilter('code', 'empty')">빈칸</div>
                 <div class="filter-option" onclick="setFilter('code', 'not-empty')">내용있음</div>`;
    if(codePop) codePop.innerHTML = codeHtml;
    if(document.getElementById('pop-name')) document.getElementById('pop-name').innerHTML = getSortButtonsHtml('name');
    if(document.getElementById('pop-option')) document.getElementById('pop-option').innerHTML = getSortButtonsHtml('option');
    const stocks = [...new Set(originalData.map(d => (d.stock || '0').toString()))].sort((a, b) => Number(a) - Number(b));
    let stockHtml = getSortButtonsHtml('stock');
    stockHtml += `<div class="filter-option" onclick="setFilter('stock', 'all')">전체보기</div>`;
    stocks.forEach(s => { stockHtml += `<div class="filter-option" onclick="setFilter('stock', '${s}')">${s}</div>`; });
    if(document.getElementById('pop-stock')) document.getElementById('pop-stock').innerHTML = stockHtml;
}

window.executeSort = (key, direction) => { sortConfig = { key, direction }; applyFiltersAndSort(); window.closeAllPopups(); };
window.toggleLocFilter = (val) => {
    if (val === 'all') filters.loc = [];
    else { if (filters.loc.includes(val)) filters.loc = filters.loc.filter(v => v !== val); else filters.loc.push(val); }
    updateLocPopupUI();
    const btn = document.getElementById('btn-filter-loc');
    if (btn) filters.loc.length === 0 ? btn.classList.remove('active') : btn.classList.add('active');
    applyFiltersAndSort();
};
window.setFilter = (type, value) => {
    filters[type] = value;
    const btn = document.getElementById(`btn-filter-${type}`);
    if (btn) value === 'all' ? btn.classList.remove('active') : btn.classList.add('active');
    applyFiltersAndSort(); window.closeAllPopups();
};

function applyFiltersAndSort() {
    let filtered = originalData.filter(item => {
        if (filters.loc.length > 0 && !filters.loc.includes(item.id.charAt(0))) return false;
        const hasCode = item.code && item.code !== item.id && item.code.trim() !== "";
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

function renderTable(data) {
    const tbody = document.getElementById('location-list-body');
    if (!tbody) return;
    let html = '';
    data.forEach(loc => {
        let displayCode = (loc.code === loc.id) ? '' : (loc.code || '');
        html += `<tr onclick="if(event.target.tagName !== 'INPUT') openEditModal('${loc.id}')">
            <td onclick="event.stopPropagation()"><input type="checkbox" class="loc-check" value="${loc.id}"></td>
            <td style="font-weight:bold;">${loc.id}</td><td style="color:#3d5afe; font-weight:bold;">${displayCode}</td>
            <td style="text-align:left;">${loc.name || ''}</td><td style="text-align:left;">${loc.option || ''}</td><td>${loc.stock || '0'}</td></tr>`;
    });
    tbody.innerHTML = html || '<tr><td colspan="6" style="padding:50px;">데이터가 없습니다.</td></tr>';
}

window.toggleAllCheckboxes = (source) => document.querySelectorAll('.loc-check').forEach(cb => cb.checked = source.checked);

window.addSingleLocation = async () => {
    const inputObj = document.getElementById('new-loc-id');
    const newId = inputObj.value.trim().toUpperCase();
    if (!newId) return alert("입력해주세요.");
    try {
        await setDoc(doc(db, LOC_COLLECTION, newId), { code: '', name: '', option: '', stock: '0', updatedAt: new Date() }, { merge: true });
        inputObj.value = ''; alert(`✅ [${newId}] 추가 완료`); loadAndRender();
    } catch (e) { alert("오류 발생"); }
};

window.deleteSelectedLocations = async () => {
    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    if (checkedBoxes.length === 0) return alert("선택해주세요.");
    if (!confirm("삭제하시겠습니까?")) return;
    try {
        let batch = writeBatch(db); let batchCount = 0;
        for (let cb of checkedBoxes) {
            batch.delete(doc(db, LOC_COLLECTION, cb.value));
            if (++batchCount >= 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        alert("삭제 완료"); loadAndRender();
    } catch (e) { alert("오류 발생"); }
};

window.openEditModal = (id) => {
    const target = originalData.find(d => d.id === id);
    if (!target) return;
    document.getElementById('modal-id').value = target.id;
    document.getElementById('modal-code').value = target.code || '';
    document.getElementById('modal-name').value = target.name || '';
    document.getElementById('modal-option').value = target.option || '';
    document.getElementById('modal-stock').value = target.stock || '0';
    document.getElementById('edit-modal').style.display = 'flex';
};

window.saveManualEdit = async () => {
    const id = document.getElementById('modal-id').value;
    const updateData = {
        code: document.getElementById('modal-code').value.trim(),
        name: document.getElementById('modal-name').value.trim(),
        option: document.getElementById('modal-option').value.trim(),
        stock: document.getElementById('modal-stock').value.trim(),
        updatedAt: new Date()
    };
    try {
        await setDoc(doc(db, LOC_COLLECTION, id), updateData, { merge: true });
        document.getElementById('edit-modal').style.display = 'none'; loadAndRender();
    } catch (e) { alert("오류 발생"); }
};

// 엑셀 업로드 (사전검증 제거 버전: 가장 빠른 속도)
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
            if (json.length > 0) updateDatabase(json);
        };
        reader.readAsArrayBuffer(file);
    });
}

async function updateDatabase(rows) {
    const tbody = document.getElementById('location-list-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="padding:50px; font-weight:bold; color:#3d5afe;">초고속 동기화 진행 중...</td></tr>';
    
    // UI 업데이트를 위해 아주 짧게 대기
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        let batch = writeBatch(db);
        let updateCount = 0;
        let batchCount = 0;
        
        for (const row of rows) {
            const rawLoc = row['로케이션']?.toString().trim();
            if (!rawLoc) continue;

            let cleanLocId = '';
            let extractedCode = '';

            // 규칙: ( 앞은 로케이션, 뒤의 S부터는 상품코드
            if (rawLoc.includes('(')) {
                cleanLocId = rawLoc.split('(')[0].trim();
                const afterParen = rawLoc.substring(rawLoc.indexOf('('));
                const sIndex = afterParen.indexOf('S');
                if (sIndex !== -1) extractedCode = afterParen.substring(sIndex).trim();
            } else { cleanLocId = rawLoc; }

            if (!cleanLocId) continue;

            // 사전검증 없이 무조건 덮어쓰기 (없으면 새로 생성됨)
            const finalCode = extractedCode || row['상품코드']?.toString().trim() || '';
            const docRef = doc(db, LOC_COLLECTION, cleanLocId);

            batch.set(docRef, {
                code: finalCode,
                name: row['상품명']?.toString().trim() || '',
                option: row['옵션']?.toString().trim() || '',
                stock: row['정상재고']?.toString().trim() || '0',
                updatedAt: new Date()
            }, { merge: true });

            updateCount++;
            if (++batchCount >= 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
        }
        
        if (batchCount > 0) await batch.commit();
        alert(`✅ 완료! 총 ${updateCount}개의 데이터가 즉시 반영되었습니다.`);
        document.getElementById('excel-upload').value = '';
        loadAndRender();
        
    } catch (error) {
        console.error("실패:", error);
        alert("오류가 발생했습니다.");
        loadAndRender();
    }
}

window.onload = loadAndRender;
