import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

let originalData = []; 
let sortConfig = { key: 'id', direction: 'asc' }; 
let filters = { loc: [], code: 'all', stock: 'all', dong: 'all', pos: 'all' };

async function loadAndRender() {
    try {
        const querySnapshot = await getDocs(collection(db, LOC_COLLECTION));
        document.getElementById('firebase-guide').style.display = 'none';

        originalData = [];
        querySnapshot.forEach(docSnap => {
            originalData.push({ id: docSnap.id, ...docSnap.data() });
        });

        const checkAllBtn = document.getElementById('check-all');
        if(checkAllBtn) checkAllBtn.checked = false;

        setupFilterPopups();
        applyFiltersAndSort();
    } catch (error) {
        console.error("로딩 실패:", error);
    }
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

    // 동 필터
    const dongs = [...new Set(originalData.map(d => (d.dong || '').toString()))].filter(Boolean).sort();
    let dongHtml = getSortButtonsHtml('dong') + `<div class="filter-option" onclick="setFilter('dong', 'all')">전체보기</div>`;
    dongs.forEach(d => { dongHtml += `<div class="filter-option" onclick="setFilter('dong', '${d}')">${d}</div>`; });
    if(document.getElementById('pop-dong')) document.getElementById('pop-dong').innerHTML = dongHtml;

    // 위치 필터
    const poses = [...new Set(originalData.map(d => (d.pos || '').toString()))].filter(Boolean).sort();
    let posHtml = getSortButtonsHtml('pos') + `<div class="filter-option" onclick="setFilter('pos', 'all')">전체보기</div>`;
    poses.forEach(p => { posHtml += `<div class="filter-option" onclick="setFilter('pos', '${p}')">${p}</div>`; });
    if(document.getElementById('pop-pos')) document.getElementById('pop-pos').innerHTML = posHtml;

    // 정상재고 필터
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
    if (typeof window.closeAllPopups === 'function') {
        window.closeAllPopups();
    }
};

window.toggleLocFilter = (val) => {
    if (val === 'all') {
        filters.loc = [];
    } else {
        if (filters.loc.includes(val)) {
            filters.loc = filters.loc.filter(v => v !== val);
        } else {
            filters.loc.push(val);
        }
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
    if (typeof window.closeAllPopups === 'function') {
        window.closeAllPopups();
    }
};

function applyFiltersAndSort() {
    let filtered = originalData.filter(item => {
        if (filters.loc.length > 0 && !filters.loc.includes(item.id.charAt(0))) return false;
        if (filters.dong !== 'all' && (item.dong || '').toString() !== filters.dong) return false;
        if (filters.pos !== 'all' && (item.pos || '').toString() !== filters.pos) return false;
        
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
            <tr onclick="if(event.target.tagName !== 'INPUT') openEditModal('${loc.id}')">
                <td onclick="event.stopPropagation()">
                    <input type="checkbox" class="loc-check" value="${loc.id}">
                </td>
                <td style="color:#666;">${loc.dong || ''}</td>
                <td style="color:#666;">${loc.pos || ''}</td>
                <td class="loc-copy-cell" onclick="copyLocationToClipboard(event, '${loc.id}')" title="클릭하여 복사">${loc.id}</td>
                <td style="color:#3d5afe; font-weight:bold;">${displayCode}</td>
                <td style="text-align:left;">${loc.name || ''}</td>
                <td style="text-align:left; font-size:12px;">${loc.option || ''}</td>
                <td>${loc.stock || '0'}</td>
            </tr>
        `;
    });
    tbody.innerHTML = html || '<tr><td colspan="8" style="padding:50px;">데이터가 없습니다.</td></tr>';
}

// 클립보드 복사 함수 및 토스트 알림 제어
window.copyLocationToClipboard = (event, text) => {
    event.stopPropagation(); // 행 클릭으로 인한 모달 오픈 방지
    navigator.clipboard.writeText(text).then(() => {
        showToast(`[${text}] 복사 완료!`);
    }).catch(err => {
        console.error('복사 실패:', err);
        alert('복사 기능을 지원하지 않는 브라우저입니다.');
    });
};

function showToast(message) {
    const toast = document.getElementById("toast");
    if(toast) {
        toast.innerText = message;
        toast.classList.add("show");
        setTimeout(() => {
            toast.classList.remove("show");
        }, 1500);
    }
}

window.toggleAllCheckboxes = (source) => {
    const checkboxes = document.querySelectorAll('.loc-check');
    checkboxes.forEach(cb => cb.checked = source.checked);
};

window.addSingleLocation = async () => {
    const inputObj = document.getElementById('new-loc-id');
    const newId = inputObj.value.trim().toUpperCase();

    if (!newId) {
        alert("추가할 로케이션 번호를 입력해주세요. (예: A-1-001)");
        inputObj.focus();
        return;
    }

    try {
        const docRef = doc(db, LOC_COLLECTION, newId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            alert(`[${newId}] 로케이션은 이미 존재합니다.`);
            inputObj.focus();
            return;
        }

        await setDoc(docRef, {
            dong: '',
            pos: '',
            code: '',
            name: '',
            option: '',
            stock: '0',
            updatedAt: new Date()
        });

        inputObj.value = '';
        alert(`✅ [${newId}] 로케이션이 성공적으로 추가되었습니다.`);
        loadAndRender();
    } catch (error) {
        console.error("추가 실패:", error);
        alert("로케이션 추가 중 오류가 발생했습니다.");
    }
};

window.deleteSelectedLocations = async () => {
    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    if (checkedBoxes.length === 0) {
        alert("삭제할 로케이션을 체크박스에서 선택해주세요.");
        return;
    }

    if (!confirm(`선택한 ${checkedBoxes.length}개의 로케이션을 정말로 일괄 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
        return;
    }

    try {
        let batch = writeBatch(db);
        let batchCount = 0;
        let totalDeleted = 0;

        for (let i = 0; i < checkedBoxes.length; i++) {
            const locId = checkedBoxes[i].value;
            batch.delete(doc(db, LOC_COLLECTION, locId));
            
            batchCount++;
            totalDeleted++;

            if (batchCount >= 400) {
                await batch.commit();
                batch = writeBatch(db);
                batchCount = 0;
            }
        }

        if (batchCount > 0) {
            await batch.commit();
        }

        alert(`🗑️ 총 ${totalDeleted}개의 로케이션이 정상적으로 삭제되었습니다.`);
        loadAndRender();
    } catch (error) {
        console.error("삭제 실패:", error);
        alert("일괄 삭제 처리 중 오류가 발생했습니다.");
    }
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
        updatedAt: new Date()
    };

    try {
        await setDoc(doc(db, LOC_COLLECTION, id), updateData, { merge: true });
        document.getElementById('edit-modal').style.display = 'none';
        loadAndRender(); 
    } catch (error) {
        console.error("수정 실패:", error);
        alert("정보 수정 중 오류가 발생했습니다.");
    }
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
            if (json.length > 0) updateDatabase(json);
        };
        reader.readAsArrayBuffer(file);
    });
}

async function updateDatabase(rows) {
    const totalRows = rows.length;
    if (totalRows === 0) return;

    const tbody = document.getElementById('location-list-body');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" style="padding:50px; font-weight:bold; color:#3d5afe; font-size:16px;">데이터 검증 및 동기화 중입니다... 잠시만 기다려주세요.</td></tr>`;
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        let batch = writeBatch(db);
        let updateCount = 0;
        let batchCount = 0;
        
        let notFoundLocs = new Set(); 
        const validLocIds = new Set(originalData.map(d => d.id));

        for (let i = 0; i < totalRows; i++) {
            const row = rows[i];
            const rawLoc = row['로케이션']?.toString().trim();
            
            if (rawLoc) {
                let cleanLocId = '';
                let extractedCode = '';

                if (rawLoc.includes('(')) {
                    cleanLocId = rawLoc.split('(')[0].trim();
                    const afterParen = rawLoc.substring(rawLoc.indexOf('('));
                    const sIndex = afterParen.indexOf('S');
                    if (sIndex !== -1) {
                        extractedCode = afterParen.substring(sIndex).trim();
                    }
                } else {
                    cleanLocId = rawLoc;
                }

                if (cleanLocId) {
                    if (!validLocIds.has(cleanLocId)) {
                        notFoundLocs.add(cleanLocId); 
                    } else {
                        const finalCode = extractedCode || row['상품코드']?.toString().trim() || '';
                        const docRef = doc(db, LOC_COLLECTION, cleanLocId);

                        batch.set(docRef, {
                            dong: row['동']?.toString().trim() || row['dong']?.toString().trim() || '',
                            pos: row['위치']?.toString().trim() || row['pos']?.toString().trim() || '',
                            code: finalCode,
                            name: row['상품명']?.toString().trim() || '',
                            option: row['옵션']?.toString().trim() || '',
                            stock: row['정상재고']?.toString().trim() || '0',
                            updatedAt: new Date()
                        }, { merge: true });

                        updateCount++;
                        batchCount++;
                        
                        if (batchCount >= 400) { 
                            await batch.commit(); 
                            batch = writeBatch(db); 
                            batchCount = 0; 
                        }
                    }
                }
            }
        }
        
        if (batchCount > 0) await batch.commit();
        
        let resultMessage = `✅ 완료! 총 ${updateCount}개의 로케이션이 정상적으로 갱신되었습니다.`;
        
        if (notFoundLocs.size > 0) {
            const notFoundArray = Array.from(notFoundLocs);
            resultMessage += `\n\n⚠️ 다음 ${notFoundLocs.size}개의 로케이션은 시스템에 존재하지 않아 제외되었습니다:\n[${notFoundArray.join(', ')}]\n\n※ 먼저 화면에서 빈 로케이션을 추가해주세요.`;
        }
        
        alert(resultMessage);
        
        document.getElementById('excel-upload').value = '';
        loadAndRender();
        
    } catch (error) {
        console.error("실패:", error);
        alert("업데이트 중 오류가 발생했습니다.");
        document.getElementById('excel-upload').value = '';
        loadAndRender();
    }
}

window.onload = loadAndRender;
