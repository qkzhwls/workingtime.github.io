import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

let originalData = []; 
let sortConfig = { key: 'id', direction: 'asc' }; 
let filters = { loc: 'all', code: 'all', stock: 'all' };

async function loadAndRender() {
    try {
        const querySnapshot = await getDocs(collection(db, LOC_COLLECTION));
        document.getElementById('firebase-guide').style.display = 'none';

        originalData = [];
        querySnapshot.forEach(docSnap => {
            originalData.push({ id: docSnap.id, ...docSnap.data() });
        });

        setupFilterPopups();
        applyFiltersAndSort();
    } catch (error) {
        console.error("로딩 실패:", error);
    }
}

// 정렬 버튼 HTML 템플릿 생성 함수
function getSortButtonsHtml(key) {
    return `
        <div class="filter-option" onclick="executeSort('${key}', 'asc')">⬆️ 오름차순 정렬</div>
        <div class="filter-option" onclick="executeSort('${key}', 'desc')">⬇️ 내림차순 정렬</div>
        <div class="filter-divider"></div>
    `;
}

function setupFilterPopups() {
    const locPop = document.getElementById('pop-loc');
    const codePop = document.getElementById('pop-code');
    const namePop = document.getElementById('pop-name');
    const optionPop = document.getElementById('pop-option');
    const stockPop = document.getElementById('pop-stock');

    // 1. 로케이션 (정렬 + 필터)
    let prefixSet = new Set(originalData.map(d => d.id.charAt(0)));
    prefixSet.add('★');
    const prefixes = [...prefixSet].sort((a, b) => (a === '★' ? -1 : (b === '★' ? 1 : a.localeCompare(b))));

    let locHtml = getSortButtonsHtml('id');
    locHtml += '<div class="filter-option" onclick="setFilter(\'loc\', \'all\')">전체보기</div>';
    prefixes.forEach(p => {
        locHtml += `<div class="filter-option" onclick="setFilter('loc', '${p}')">${p} 구역</div>`;
    });
    if(locPop) locPop.innerHTML = locHtml;

    // 2. 상품코드 (정렬 + 필터)
    let codeHtml = getSortButtonsHtml('code');
    codeHtml += '<div class="filter-option" onclick="setFilter(\'code\', \'all\')">전체보기</div>';
    codeHtml += '<div class="filter-option" onclick="setFilter(\'code\', \'empty\')">빈칸</div>';
    codeHtml += '<div class="filter-option" onclick="setFilter(\'code\', \'not-empty\')">내용있음</div>';
    if(codePop) codePop.innerHTML = codeHtml;

    // 3. 상품명 (정렬 전용)
    if(namePop) namePop.innerHTML = getSortButtonsHtml('name');

    // 4. 옵션 (정렬 전용)
    if(optionPop) optionPop.innerHTML = getSortButtonsHtml('option');

    // 5. 정상재고 (정렬 + 필터)
    const stocks = [...new Set(originalData.map(d => (d.stock || '0').toString()))].sort((a, b) => Number(a) - Number(b));
    let stockHtml = getSortButtonsHtml('stock');
    stockHtml += '<div class="filter-option" onclick="setFilter(\'stock\', \'all\')">전체보기</div>';
    stocks.forEach(s => {
        stockHtml += `<div class="filter-option" onclick="setFilter('stock', '${s}')">${s}</div>`;
    });
    if(stockPop) stockPop.innerHTML = stockHtml;
}

// 정렬 실행 함수
window.executeSort = (key, direction) => {
    sortConfig = { key: key, direction: direction };
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') {
        window.closeAllPopups();
    }
};

// 필터 실행 함수
window.setFilter = (type, value) => {
    filters[type] = value;
    
    // 버튼 활성화 색상 변경
    const btnId = `btn-filter-${type}`;
    const btn = document.getElementById(btnId);
    if (btn) {
        if (value === 'all') btn.classList.remove('active');
        else btn.classList.add('active');
    }

    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') {
        window.closeAllPopups();
    }
};

function applyFiltersAndSort() {
    let filtered = originalData.filter(item => {
        if (filters.loc !== 'all' && item.id.charAt(0) !== filters.loc) return false;
        
        const hasCode = item.code && item.code !== item.id && item.code.trim() !== "";
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

    let html = '';
    data.forEach(loc => {
        let displayCode = (loc.code === loc.id) ? '' : (loc.code || '');
        html += `
            <tr>
                <td style="font-weight:bold; font-size:15px;">${loc.id}</td>
                <td style="color:#3d5afe; font-weight:bold;">${displayCode}</td>
                <td style="text-align:left;">${loc.name || ''}</td>
                <td style="text-align:left; font-size:12px;">${loc.option || ''}</td>
                <td>${loc.stock || '0'}</td>
                <td><button class="btn-del" onclick="deleteLoc('${loc.id}')">삭제</button></td>
            </tr>
        `;
    });
    tbody.innerHTML = html || '<tr><td colspan="6" style="padding:50px;">데이터가 없습니다.</td></tr>';
}

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
    if (!confirm(`${rows.length}개 데이터를 동기화하시겠습니까?`)) return;
    const tbody = document.getElementById('location-list-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="padding:50px; font-weight:bold; color:#3d5afe;">데이터 동기화 중...</td></tr>';
    try {
        let batch = writeBatch(db);
        let count = 0;
        let batchCount = 0;
        for (const row of rows) {
            const locId = row['로케이션']?.toString().trim();
            if (!locId) continue;
            const locMatch = locId.match(/([A-Z]-\d-\d{3}|★★-\d{2})/);
            if (locMatch) {
                const cleanLocId = locMatch[1];
                const docRef = doc(db, LOC_COLLECTION, cleanLocId);
                batch.set(docRef, {
                    code: row['상품코드']?.toString().trim() || '',
                    name: row['상품명']?.toString().trim() || '',
                    option: row['옵션']?.toString().trim() || '',
                    stock: row['정상재고']?.toString().trim() || '0',
                    updatedAt: new Date()
                }, { merge: true });
                count++;
                batchCount++;
                if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
            }
        }
        if (batchCount > 0) await batch.commit();
        alert(`✅ 완료! ${count}개 정보가 업데이트되었습니다.`);
        loadAndRender();
    } catch (error) {
        console.error("실패:", error);
        loadAndRender();
    }
}

window.deleteLoc = async (id) => {
    if(confirm(`${id}를 삭제하시겠습니까?`)) { await deleteDoc(doc(db, LOC_COLLECTION, id)); loadAndRender(); }
};

window.resetAllFiltersAndSort = () => {
    filters = { loc: 'all', code: 'all', stock: 'all' };
    sortConfig = { key: 'id', direction: 'asc' };
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    applyFiltersAndSort();
};

window.onload = loadAndRender;
