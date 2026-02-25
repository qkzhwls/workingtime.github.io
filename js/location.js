import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'location_map_3f';

// 1. 데이터 로드 및 렌더링
async function loadAndRender() {
    try {
        const querySnapshot = await getDocs(collection(db, LOC_COLLECTION));
        const data = [];
        querySnapshot.forEach(docSnap => {
            data.push({ id: docSnap.id, ...docSnap.data() });
        });
        renderMap(data);
        renderList(data);
    } catch (error) {
        console.error("데이터 로딩 실패:", error);
    }
}

// 2. 도면 뷰 렌더링
function renderMap(data) {
    const container = document.getElementById('location-map');
    if (!container) return;
    container.innerHTML = '';
    
    data.forEach(loc => {
        const box = document.createElement('div');
        box.className = 'loc-box';
        box.style.gridRow = loc.row;
        box.style.gridColumn = loc.col;
        box.innerHTML = `
            <div class="loc-id" style="font-weight:bold; color:#333;">${loc.id}</div>
            <div class="loc-code" style="font-size:12px; color:#666;">${loc.code || '-'}</div>
        `;
        container.appendChild(box);
    });
}

// 3. 리스트 뷰 렌더링
function renderList(data) {
    const tbody = document.getElementById('location-list-body');
    if (!tbody) return;
    tbody.innerHTML = data.map(loc => `
        <tr>
            <td><strong>${loc.id}</strong></td>
            <td>${loc.code || '-'}</td>
            <td>${loc.row}행, ${loc.col}열</td>
            <td><button class="btn-del" style="color:red; cursor:pointer; border:none; background:none;" onclick="deleteLoc('${loc.id}')">삭제</button></td>
        </tr>
    `).join('');
}

// 4. SheetJS를 이용한 파일 분석 및 업로드 (xls, xlsx, html 기반 xls 통합 대응)
const fileInput = document.getElementById('excel-upload');
if (fileInput) {
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function(event) {
            try {
                const data = new Uint8Array(event.target.result);
                // @ts-ignore - XLSX는 html 파일에 로드되어 있음
                const workbook = XLSX.read(data, { type: 'array' });
                
                // 첫 번째 시트 가져오기
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // 2차원 배열 형태로 변환 (빈 칸은 null 처리)
                // @ts-ignore
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
                
                if (rows && rows.length > 0) {
                    await processLocationData(rows);
                } else {
                    alert("파일에서 데이터를 찾을 수 없습니다.");
                }
            } catch (error) {
                console.error("파일 분석 중 오류 발생:", error);
                alert("파일을 읽는 중 오류가 발생했습니다. 지원하지 않는 형식이거나 파일이 손상되었을 수 있습니다.");
            }
        };
        // SheetJS는 ArrayBuffer로 읽는 것을 권장
        reader.readAsArrayBuffer(file);
    });
}

// 5. 로케이션 데이터 가공 및 DB 저장
async function processLocationData(rows) {
    if (!confirm("기존 도면 데이터를 지우고 새로 업로드하시겠습니까?")) return;
    
    const batch = writeBatch(db);
    let count = 0;

    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            const val = rows[r][c]?.toString().trim();
            
            // '★★'가 포함된 셀을 로케이션 이름으로 인식
            if (val && val.includes('★★')) {
                const locId = val;
                let productCode = '';
                
                // 엑셀 구조 분석: '★★-02' 바로 아래 칸이나 그 오른쪽 칸에 '상품코드' 혹은 실제 코드가 있을 수 있음.
                if (rows[r + 1]) {
                    const cellBelow = rows[r + 1][c]?.toString().trim();
                    const cellBelowRight = rows[r + 1][c + 1]?.toString().trim();
                    
                    // 1. 바로 아래 칸이 '상품코드'라는 글자고, 그 오른쪽 칸에 실제 코드가 있는 경우
                    if (cellBelow === '상품코드' && cellBelowRight) {
                        productCode = cellBelowRight;
                    } 
                    // 2. 바로 아래 칸에 '상품코드'라는 글자 없이 바로 코드가 있거나 같이 들어있는 경우
                    else if (cellBelow && cellBelow !== '상품코드' && cellBelow !== '#N/A') {
                        productCode = cellBelow.replace('상품코드', '').trim();
                    }
                }
                
                const docRef = doc(db, LOC_COLLECTION, locId);
                batch.set(docRef, {
                    row: r + 1,
                    col: c + 1,
                    code: productCode,
                    updatedAt: new Date()
                });
                count++;
            }
        }
    }

    await batch.commit();
    alert(`${count}개의 로케이션이 성공적으로 등록되었습니다!`);
    
    // 입력 칸 비우기 (같은 파일 재업로드 가능하도록)
    document.getElementById('excel-upload').value = '';
    
    loadAndRender();
}

// 전역 삭제 함수
window.deleteLoc = async (id) => {
    if(confirm(`${id} 로케이션을 삭제하시겠습니까?`)) {
        await deleteDoc(doc(db, LOC_COLLECTION, id));
        loadAndRender();
    }
};

window.onload = loadAndRender;
