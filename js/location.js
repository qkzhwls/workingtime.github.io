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

        const tbody = document.getElementById('location-list-body');
        
        if (data.length === 0) {
            if (tbody) {
                tbody.innerHTML = '<tr><td style="text-align:center; padding: 50px; color:#666; font-size:16px;">등록된 데이터가 없습니다.<br>상단의 파일 선택을 통해 마스터 데이터를 업로드해 주세요.</td></tr>';
            }
            return;
        }

        renderList(data);
    } catch (error) {
        console.error("데이터 로딩 실패:", error);
    }
}

// 2. 리스트 뷰 렌더링 (7000 x 1 단일 열 구조)
function renderList(data) {
    const tbody = document.getElementById('location-list-body');
    if (!tbody) return;
    
    // 로케이션 아이디 순으로 정렬
    data.sort((a, b) => a.id.localeCompare(b.id));

    let html = '';
    // 번호(순번)를 붙여서 7000개가 나열됨을 직관적으로 보여줌
    data.forEach((loc, index) => {
        html += `
            <tr>
                <td>
                    <div class="single-cell-content">
                        <div class="loc-info">
                            <span class="loc-num">${index + 1}.</span>
                            <span class="loc-name">${loc.id}</span>
                            <span class="loc-code">${loc.code || '<span style="color:#ccc; font-weight:normal;">(상품 없음)</span>'}</span>
                        </div>
                        <button class="btn-del" onclick="deleteLoc('${loc.id}')">삭제</button>
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

// 3. 파일 업로드 및 인코딩 자동 감지 로직
const fileInput = document.getElementById('excel-upload');
if (fileInput) {
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function(event) {
            let content = event.target.result;
            
            // UTF-8로 읽었을 때 한글이나 기호가 깨졌다면 EUC-KR로 다시 읽기
            if (content.includes('')) {
                const reader2 = new FileReader();
                reader2.onload = async function(e2) {
                    await processText(e2.target.result);
                };
                reader2.readAsText(file, 'euc-kr');
            } else {
                await processText(content);
            }
        };
        reader.readAsText(file, 'utf-8');
    });
}

// 4. 텍스트 분석
async function processText(content) {
    let rows = [];

    if (content.includes('<table') || content.includes('<html') || content.includes('<TR')) {
        const parser = new DOMParser();
        const docHTML = parser.parseFromString(content, 'text/html');
        const trs = docHTML.querySelectorAll('tr');
        
        trs.forEach(tr => {
            const rowData = [];
            tr.querySelectorAll('td, th').forEach(td => rowData.push(td.innerText.trim()));
            rows.push(rowData);
        });
    } else {
        rows = content.split('\n').map(row => row.split(',').map(cell => cell.trim().replace(/^"|"$/g, '')));
    }

    if (rows && rows.length > 0) {
        await buildMasterList(rows);
    } else {
        alert("파일에서 데이터를 찾을 수 없습니다.");
    }
}

// 5. 대용량 데이터 추출 및 쪼개기 저장
async function buildMasterList(rows) {
    if (!confirm("업로드한 파일의 전체 로케이션을 시스템에 등록하시겠습니까?\n데이터가 많을 경우 약간의 시간이 소요될 수 있습니다.")) return;
    
    const tbody = document.getElementById('location-list-body');
    if(tbody) {
        tbody.innerHTML = '<tr><td style="text-align:center; padding: 50px; color:#3d5afe; font-size:18px; font-weight:bold;">🔥 수천 개의 데이터를 분석하고 저장하는 중입니다...<br>잠시만 기다려주세요!</td></tr>';
    }
    
    let batch = writeBatch(db);
    let count = 0;
    let batchCount = 0;

    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            const val = rows[r][c]?.toString().trim();
            
            if (val && (val.includes('★★') || /^[A-Z]-\d+/.test(val))) {
                const locId = val;
                let productCode = '';
                
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
                batch.set(docRef, {
                    row: r + 1,
                    col: c + 1,
                    code: productCode,
                    updatedAt: new Date()
                });
                
                count++;
                batchCount++;
                
                if (batchCount >= 400) {
                    await batch.commit();
                    batch = writeBatch(db); 
                    batchCount = 0;
                }
            }
        }
    }

    if (batchCount > 0) {
        await batch.commit();
    }

    alert(`✅ 데이터 리스트 등록 완료!\n총 ${count}개의 로케이션이 시스템에 반영되었습니다.`);
    
    document.getElementById('excel-upload').value = '';
    loadAndRender(); 
}

// 개별 삭제 로직 (전역 설정)
window.deleteLoc = async (id) => {
    if(confirm(`${id} 로케이션 데이터를 영구적으로 삭제하시겠습니까?`)) {
        await deleteDoc(doc(db, LOC_COLLECTION, id));
        loadAndRender();
    }
};

window.onload = loadAndRender;
