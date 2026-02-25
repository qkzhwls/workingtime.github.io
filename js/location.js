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
            <div class="loc-id">${loc.id}</div>
            <div class="loc-code">${loc.code || '-'}</div>
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
            <td><button class="btn-del" onclick="deleteLoc('${loc.id}')">삭제</button></td>
        </tr>
    `).join('');
}

// 4. 파일 분석 및 업로드 (HTML XLS 및 CSV 통합 대응)
const fileInput = document.getElementById('excel-upload');
if (fileInput) {
    fileInput.addEventListener('change', async function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function(event) {
            const content = event.target.result;
            let rows = [];

            if (content.includes('<table') || content.includes('<html')) {
                // 💡 HTML 기반 XLS 파일 분석 로직
                const parser = new DOMParser();
                const docHTML = parser.parseFromString(content, 'text/html');
                const trs = docHTML.querySelectorAll('tr');
                trs.forEach(tr => {
                    const rowData = [];
                    tr.querySelectorAll('td').forEach(td => rowData.push(td.innerText.trim()));
                    rows.push(rowData);
                });
            } else {
                // 일반 CSV 파일 분석 (PapaParse 활용)
                // @ts-ignore
                const result = Papa.parse(content);
                rows = result.data;
            }

            if (rows.length > 0) {
                await processLocationData(rows);
            }
        };
        reader.readAsText(file, 'euc-kr'); // 한글 깨짐 방지를 위해 euc-kr 시도
    });
}

// 5. 로케이션 데이터 가공 및 DB 저장
async function processLocationData(rows) {
    if (!confirm("기존 데이터를 초기화하고 새로 업로드하시겠습니까?")) return;
    
    const batch = writeBatch(db); // 대량 저장을 위해 배치 사용
    let count = 0;

    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            const val = rows[r][c]?.toString().trim();
            
            // '★★'가 포함된 셀을 로케이션 이름으로 인식
            if (val && val.includes('★★')) {
                const locId = val;
                // 상품코드는 엑셀 구조상 바로 아래 행(r+1)에 위치함
                let productCode = '';
                if (rows[r + 1] && rows[r + 1][c]) {
                    productCode = rows[r + 1][c].replace('상품코드', '').trim();
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
    loadAndRender();
}

// 전역 함수 등록
window.deleteLoc = async (id) => {
    if(confirm(`${id}를 삭제하시겠습니까?`)) {
        await deleteDoc(doc(db, LOC_COLLECTION, id));
        loadAndRender();
    }
};

window.onload = loadAndRender;
