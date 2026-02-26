import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

let originalData = []; // DB 원본 데이터
let sortConfig = { key: 'id', direction: 'asc' }; // 정렬 설정

// 1. 데이터 로드
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

// 2. 필터 옵션 동적 생성
function setupFilterOptions() {
    const locSelect = document.getElementById('filter-loc-prefix');
    const stockSelect = document.getElementById('filter-stock-qty');
    
    const prefixes = [...new Set(originalData.map(d => d.id.charAt(0)))].sort();
    locSelect.innerHTML = '<option value="all">전체(A-Z, ★)</option>';
    prefixes.forEach(p => {
        locSelect.innerHTML += `<option value="${p}">${p} 구역</option>`;
    });

    const stocks = [...new Set(originalData.map(d => (d.stock || '0').toString()))]
                   .sort((a, b) => Number(a) - Number(b));
    stockSelect.innerHTML = '<option value="all">전체</option>';
    stocks.forEach(s => {
        stockSelect.innerHTML += `<option value="${s}">${s}</option>`;
    });
}

// 3. 필터 및 정렬 적용
function applyFiltersAndSort() {
    const locFilter = document.getElementById('filter-loc-prefix').value;
    const codeFilter = document.getElementById('filter-code-status').value;
    const stockFilter = document.getElementById('filter-stock-qty').value;

    let filtered = originalData.filter(item => {
        if (locFilter !== 'all' && item.id.charAt(0) !== locFilter) return false;
        
        const hasCode = item.code && item.code !== item.id;
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

// 4. 테이블 렌더링
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
                <td>${loc.option || ''}</td>
                <td>${loc.stock || '0'}</td>
                <td><button class="btn-del" onclick="deleteLoc('${loc.id}')">삭제</button></td>
            </tr>
        `;
    });
    tbody.innerHTML = html || '<tr><td colspan="6">데이터가 없습니다.</td></tr>';
}

// 5. 파일 업로드 및 데이터 매칭 (제공해주신 헤더 기준)
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

// 6. DB 업데이트 로직 (Batch 사용)
async function updateDatabase(rows) {
    if (!confirm(`${rows.length}개의 데이터를 동기화하시겠습니까?`)) return;

    const tbody = document.getElementById('location-list-body');
    tbody.innerHTML = '<tr><td colspan="6" style="padding:50px; font-weight:bold; color:#3d5afe;">데이터 분석 및 동기화 중...</td></tr>';

    try {
        let batch = writeBatch(db);
        let count = 0;
        let batchCount = 0;

        for (const row of rows) {
            // 엑셀 헤더명과 정확히 매칭 (로케이션이 없는 행은 건너뜀)
            const locId = row['로케이션']?.toString().trim();
            if (!locId) continue;

            // 로케이션 이름 정규화 (A-1-001 또는 ★★-01 형태만 추출)
            const locMatch = locId.match(/([A-Z]-\d-\d{3}|★★-\d{2})/);
            if (locMatch) {
                const cleanLocId = locMatch[1];
                const docRef = doc(db, LOC_COLLECTION, cleanLocId);

                // 업로드할 데이터 구성
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
        alert(`✅ 동기화 완료! 총 ${count}개의 로케이션 정보가 업데이트되었습니다.`);
        loadAndRender();
    } catch (error) {
        console.error("업데이트 실패:", error);
        alert("저장 중 오류가 발생했습니다.");
        loadAndRender();
    }
}

// 정렬 및 삭제 전역 함수
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

// 필터 이벤트 바인딩
document.getElementById('filter-loc-prefix').addEventListener('change', applyFiltersAndSort);
document.getElementById('filter-code-status').addEventListener('change', applyFiltersAndSort);
document.getElementById('filter-stock-qty').addEventListener('change', applyFiltersAndSort);

window.onload = loadAndRender;
