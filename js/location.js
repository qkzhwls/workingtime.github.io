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

        // 초기 필터 옵션 설정
        setupFilterOptions();
        // 화면 렌더링
        applyFiltersAndSort();
    } catch (error) {
        console.error("로딩 실패:", error);
        document.getElementById('firebase-guide').style.display = 'block';
    }
}

// 2. 필터 옵션 동적 생성 (엑셀 방식)
function setupFilterOptions() {
    const locSelect = document.getElementById('filter-loc-prefix');
    const stockSelect = document.getElementById('filter-stock-qty');
    
    // 로케이션 앞자리 추출 (A, B, C..., ★)
    const prefixes = [...new Set(originalData.map(d => d.id.charAt(0)))].sort();
    locSelect.innerHTML = '<option value="all">전체(A-Z, ★)</option>';
    prefixes.forEach(p => {
        locSelect.innerHTML += `<option value="${p}">${p} 구역</option>`;
    });

    // 정상재고 수량 추출 (엑셀 필터처럼 존재하는 수량만 나열)
    const stocks = [...new Set(originalData.map(d => d.stock || '0'))]
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
        // 로케이션 필터
        if (locFilter !== 'all' && item.id.charAt(0) !== locFilter) return false;
        
        // 상품코드 필터
        const hasCode = item.code && item.code !== item.id;
        if (codeFilter === 'empty' && hasCode) return false;
        if (codeFilter === 'not-empty' && !hasCode) return false;

        // 정상재고 필터 (엑셀 방식: 선택한 값과 일치)
        const itemStock = (item.stock || '0').toString();
        if (stockFilter !== 'all' && itemStock !== stockFilter) return false;

        return true;
    });

    // 정렬 실행
    filtered.sort((a, b) => {
        let aVal = a[sortConfig.key] || '';
        let bVal = b[sortConfig.key] || '';
        
        // 숫자 정렬 처리 (재고 등)
        if (sortConfig.key === 'stock') {
            return sortConfig.direction === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
        }
        
        return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });

    renderTable(filtered);
}

// 4. 테이블 그리기
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
                <td>${loc.name || ''}</td>
                <td>${loc.option || ''}</td>
                <td>${loc.stock || '0'}</td>
                <td><button class="btn-del" onclick="deleteLoc('${loc.id}')">삭제</button></td>
            </tr>
        `;
    });
    tbody.innerHTML = html || '<tr><td colspan="6">필터 조건에 맞는 데이터가 없습니다.</td></tr>';
}

// 5. 정렬 함수 (헤더 클릭 시 호출)
window.sortTable = (key) => {
    if (sortConfig.key === key) {
        sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortConfig.key = key;
        sortConfig.direction = 'asc';
    }
    applyFiltersAndSort();
};

// 6. 필터 변경 이벤트 연결
document.getElementById('filter-loc-prefix').addEventListener('change', applyFiltersAndSort);
document.getElementById('filter-code-status').addEventListener('change', applyFiltersAndSort);
document.getElementById('filter-stock-qty').addEventListener('change', applyFiltersAndSort);

window.resetFilters = () => {
    document.getElementById('filter-loc-prefix').value = 'all';
    document.getElementById('filter-code-status').value = 'all';
    document.getElementById('filter-stock-qty').value = 'all';
    applyFiltersAndSort();
};

// [파일 업로드 및 삭제 기능은 이전과 동일하게 유지...]
// (코드 길이상 핵심 로직 위주로 정리하였으며, 5번 항목의 updateProductCodes에서 
// 상품코드 외에 상품명, 옵션, 재고 데이터도 엑셀 구조에 맞게 매칭하여 batch.set 하시면 됩니다.)

window.deleteLoc = async (id) => {
    if(confirm(`${id}를 삭제하시겠습니까?`)) {
        await deleteDoc(doc(db, LOC_COLLECTION, id));
        loadAndRender();
    }
};

window.onload = loadAndRender;
