import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'location_map_3f';

// 1. 데이터 불러오기 및 화면 그리기
async function loadAndRender() {
    const querySnapshot = await getDocs(collection(db, LOC_COLLECTION));
    const data = [];
    querySnapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() }));

    renderMap(data);
    renderList(data);
}

// 2. 도면 그리기 (Map View)
function renderMap(data) {
    const container = document.getElementById('location-map');
    container.innerHTML = '';
    data.forEach(loc => {
        const box = document.createElement('div');
        box.className = 'loc-box';
        box.style.gridRow = loc.row;
        box.style.gridColumn = loc.col;
        box.innerHTML = `<div class="loc-id">${loc.id}</div><div class="loc-code">${loc.code || '-'}</div>`;
        box.onclick = () => editLocation(loc);
        container.appendChild(box);
    });
}

// 3. 리스트 그리기 (List View)
function renderList(data) {
    const tbody = document.getElementById('location-list-body');
    tbody.innerHTML = data.map(loc => `
        <tr>
            <td><strong>${loc.id}</strong></td>
            <td>${loc.code || '-'}</td>
            <td>${loc.row}행, ${loc.col}열</td>
            <td><button class="btn-del" onclick="deleteLoc('${loc.id}')">삭제</button></td>
        </tr>
    `).join('');
}

// 4. CSV 파일 업로드 처리
document.getElementById('excel-upload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    Papa.parse(file, {
        complete: async function(results) {
            if(!confirm("기존 도면 데이터를 지우고 새로 업로드하시겠습니까?")) return;
            
            const rows = results.data;
            // 엑셀 시트 형태의 데이터를 분석하여 로케이션 정보 추출 로직 (★★-01 패턴 찾기)
            for (let r = 0; r < rows.length; r++) {
                for (let c = 0; c < rows[r].length; c++) {
                    const val = rows[r][c]?.trim();
                    if (val && val.includes('★★')) {
                        await setDoc(doc(db, LOC_COLLECTION, val), {
                            row: r + 1, col: c + 1,
                            code: rows[r+1] ? rows[r+1][c] : '' // 바로 아래 행을 상품코드로 인식
                        });
                    }
                }
            }
            alert("업로드가 완료되었습니다!");
            loadAndRender();
        }
    });
});

// 삭제 함수 (전역 등록)
window.deleteLoc = async (id) => {
    if(confirm(`${id} 로케이션을 삭제하시겠습니까?`)) {
        await deleteDoc(doc(db, LOC_COLLECTION, id));
        loadAndRender();
    }
};

window.onload = loadAndRender;
