import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

let originalData = []; 
let sortConfig = { key: 'id', direction: 'asc' }; 

async function loadAndRender() {
    try {
        const querySnapshot = await getDocs(collection(db, LOC_COLLECTION));
        document.getElementById('firebase-guide').style.display = 'none';

        originalData = [];
        querySnapshot.forEach(docSnap => {
            originalData.push({ id: docSnap.id, ...docSnap.data() });
        });

        setupFilterOptions();
        applyFiltersAndSort();
    } catch (error) {
        console.error("로딩 실패:", error);
        document.getElementById('firebase-guide').style.display = 'block';
    }
}

function setupFilterOptions() {
    const locSelect = document.getElementById('filter-loc-prefix');
    const stockSelect = document.getElementById('filter-stock-qty');
    
    // 로케이션 첫 글자 추출 (★ 강제 포함)
    let prefixSet = new Set(originalData.map(d => d.id.charAt(0)));
    prefixSet.add('★'); 

    const prefixes = [...prefixSet].sort((a, b) => {
        if (a === '★') return -1; // ★을 최상단으로
        if (b === '★') return 1;
        return a.localeCompare(b);
    });

    locSelect.innerHTML = '<option value="all">전체</option>';
    prefixes.forEach(p => {
        const label = (p === '★') ? '★ 구역' : `${p} 구역`;
        locSelect.innerHTML += `<option value="${p}">${label}</option>`;
    });

    const stocks = [...new Set(originalData.map(d => (d.stock || '0').toString()))]
                   .sort((a, b) => Number(a) - Number(b));
    stockSelect.innerHTML = '<option value="all">전체</option>';
    stocks.forEach(s => {
        stockSelect.innerHTML += `<option value="${s}">${s}</option>`;
    });
}

function applyFiltersAndSort() {
    const locFilter = document.getElementById('filter-loc-prefix').value;
    const codeFilter = document.getElementById('filter-code-status').value;
    const stockFilter = document.getElementById('filter-stock-qty').value;

    let filtered = originalData.filter(item => {
        if (locFilter !== 'all' && item.id.charAt(0) !== locFilter) return false;
        
        const hasCode = item.code && item.code !== item.id && item.code.trim() !== "";
        if (codeFilter === 'empty' && hasCode) return false;
        if (codeFilter === 'not-empty' && !hasCode) return false;

        const itemStock = (item.stock || '0').toString();
        if (stockFilter !== 'all' && itemStock !== stockFilter) return false;

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
                <td style="font-weight:bold;">${loc.id}</td>
                <td style="color:#3d5afe; font-weight:bold;">${displayCode}</td>
                <td style="text-align:left;">${loc.name || ''}</td>
                <td style="text-align:left; font-size:13px;">${loc.option || ''}</td>
                <td>${loc.stock || '0'}</td>
                <td><button class="btn-del" onclick="deleteLoc('${loc.id}')">삭제</button></td>
            </tr>
        `;
    });
    tbody.innerHTML = html || '<tr><td colspan="6">데이터가 없습니다.</td></tr>';
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
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const json = XLSX.utils.sheet_to_json(worksheet);

            if (json.length > 0) {
                updateDatabase(json);
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

async function updateDatabase(rows) {
    if (!confirm(`${rows.length}개의 데이터를 동기화하시겠습니까?`)) return;

    const tbody = document.getElementById('location-list-body');
    tbody.innerHTML = '<tr><td colspan="6" style="padding:50px; font-weight:bold; color:#3d5afe;">데이터 분석 및 동기화 중...</td></tr>';

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

                const updateData = {
                    code: row['상품코드']?.toString().trim() || '',
                    name: row['상품명']?.toString().trim() || '',
                    option: row['옵션']?.toString().trim() || '',
                    stock: row['정상재고']?.toString().trim() || '0',
                    updatedAt: new Date()
                };

                batch.set(docRef, updateData, { merge: true });
                count++;
                batchCount++;

                if (batchCount >= 400) {
                    await batch.commit();
                    batch = writeBatch(db);
                    batchCount = 0;
                }
            }
        }

        if (batchCount > 0) await batch.commit();
        alert(`✅ 동기화 완료! 총 ${count}개의 정보가 업데이트되었습니다.`);
        loadAndRender();
    } catch (error) {
        console.error("업데이트 실패:", error);
        alert("오류 발생");
        loadAndRender();
    }
}

window.sortTable = (key) => {
    if (sortConfig.key === key) {
        sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortConfig.key = key;
        sortConfig.direction = 'asc';
    }
    applyFiltersAndSort();
};

window.deleteLoc = async (id) => {
    if(confirm(`${id}를 삭제하시겠습니까?`)) {
        await deleteDoc(doc(db, LOC_COLLECTION, id));
        loadAndRender();
    }
};

window.resetFilters = () => {
    document.getElementById('filter-loc-prefix').value = 'all';
    document.getElementById('filter-code-status').value = 'all';
    document.getElementById('filter-stock-qty').value = 'all';
    applyFiltersAndSort();
};

document.getElementById('filter-loc-prefix').addEventListener('change', applyFiltersAndSort);
document.getElementById('filter-code-status').addEventListener('change', applyFiltersAndSort);
document.getElementById('filter-stock-qty').addEventListener('change', applyFiltersAndSort);

window.onload = loadAndRender;
