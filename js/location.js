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

        // DB에 도면이 없으면 안내문 표시
        if (data.length === 0) {
            document.getElementById('location-map').innerHTML = 
                '<div style="grid-column: 1 / -1; text-align:center; padding: 50px; color:#666; font-size:16px;">' +
                '등록된 도면이 없습니다.<br>최초 1회 마스터 엑셀 파일을 업로드하여 도면 뼈대를 구축해 주세요.</div>';
            return;
        }

        renderMap(data);
        renderList(data);
    } catch (error) {
        console.error("데이터 로딩 실패:", error);
    }
}

// 2. 도면 뷰 렌더링 (DB에 저장된 고정 좌표 사용)
function renderMap(data) {
    const container = document.getElementById('location-map');
    if (!container) return;
    
    container.innerHTML = '';
    container.style.gridAutoColumns = '70px'; // 엑셀 비율에 맞춘 너비
    container.style.gridAutoRows = '60px'; // 엑셀 비율에 맞춘 높이
    container.style.gap = '2px';
    
    data.forEach(loc => {
        const box = document.createElement('div');
        box.className = 'loc-box';
        // DB에 저장된 고정 좌표로 위치 지정
        box.style.gridRow = loc.row;
        box.style.gridColumn = loc.col;
        
        box.innerHTML = `
            <div class="loc-id" style="font-weight:bold; color:#333; font-size:11px;">${loc.id}</div>
            <div class="loc-code" style="font-size:10px; color:#3d5afe; font-weight:bold; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${loc.code || '비어있음'}
            </div>
        `;
        container.appendChild(box);
    });
}

// 3. 리스트 뷰 렌더링
function renderList(data) {
    const tbody = document.getElementById('location-list-body');
    if (!tbody) return;
    
    // 로케이션 아이디 순으로 정렬
    data.sort((a, b) => a.id.localeCompare(b.id));

    tbody.innerHTML = data.map(loc => `
        <tr>
            <td><strong>${loc.id}</strong></td>
            <td style="color:#3d5afe; font-weight:bold;">${loc.code || '-'}</td>
            <td>${loc.row}행, ${loc.col}열</td>
            <td><button class="btn-del" style="color:red; cursor:pointer; border:none; background:none;" onclick="deleteLoc('${loc.id}')">삭제</button></td>
        </tr>
    `).join('');
}

// 4. 업로드 파일 처리 (최초 도면 구축)
const fileInput = document.getElementById('excel-upload');
if (fileInput) {
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function(event) {
            try {
                const data = new Uint8Array(event.target.result);
                // @ts-ignore
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                // @ts-ignore
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
                
                if (rows && rows.length > 0) {
                    await buildMasterMap(rows);
                } else {
                    alert("파일에서 데이터를 찾을 수 없습니다.");
                }
            } catch (error) {
                console.error("파일 분석 중 오류 발생:", error);
                alert("파일을 읽는 중 오류가 발생했습니다.");
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

// 5. ⭐️ 핵심: 도면 뼈대 DB 저장 로직 ⭐️
async function buildMasterMap(rows) {
    if (!confirm("업로드한 파일을 기준으로 도면 뼈대를 (재)구축하시겠습니까?\n기존에 저장된 도면 좌표가 모두 업데이트됩니다.")) return;
    
    const batch = writeBatch(db);
    let count = 0;

    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            const val = rows[r][c]?.toString().trim();
            
            // ★★ 기호 또는 Z-801 등 로케이션 기호 찾기
            if (val && (val.includes('★★') || /^[A-Z]-\d{2,}/.test(val))) {
                const locId = val;
                let productCode = '';
                
                // 최초 1회 상품코드도 같이 가져오기
                if (rows[r + 1]) {
                    const cellBelow = rows[r + 1][c]?.toString().trim() || '';
                    const cellBelowRight = rows[r + 1][c + 1]?.toString().trim() || '';
                    
                    if (cellBelow === '상품코드' && cellBelowRight) {
                        productCode = cellBelowRight;
                    } else if (cellBelow && cellBelow !== '상품코드' && !cellBelow.includes('#N/A') && !cellBelow.includes('지정옵션') && !cellBelow.includes('입고대기') && !cellBelow.includes('현재고')) {
                        productCode = cellBelow.replace('상품코드', '').trim();
                    }
                }
                
                const docRef = doc(db, LOC_COLLECTION, locId);
                // 엑셀의 좌표(row, col)를 DB에 영구 저장!
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
    alert(`도면 구축 완료!\n총 ${count}개의 로케이션이 DB에 영구 저장되었습니다.`);
    
    document.getElementById('excel-upload').value = '';
    loadAndRender(); // DB에서 다시 불러와서 그리기
}

window.deleteLoc = async (id) => {
    if(confirm(`${id} 로케이션을 삭제하시겠습니까?`)) {
        await deleteDoc(doc(db, LOC_COLLECTION, id));
        loadAndRender();
    }
};

window.onload = loadAndRender;
