import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

// 1. 데이터 로드 및 에러 감지 (기존 Locations 캐비닛에서 가져오기)
async function loadAndRender() {
    try {
        const querySnapshot = await getDocs(collection(db, LOC_COLLECTION));
        
        document.getElementById('firebase-guide').style.display = 'none';

        const data = [];
        querySnapshot.forEach(docSnap => {
            data.push({ id: docSnap.id, ...docSnap.data() });
        });

        const tbody = document.getElementById('location-list-body');
        
        if (data.length === 0) {
            if (tbody) {
                tbody.innerHTML = '<tr><td style="text-align:center; padding: 50px; color:#666; font-size:16px;">DB에 등록된 로케이션 뼈대가 없습니다.</td></tr>';
            }
            return;
        }

        renderList(data);
    } catch (error) {
        console.error("데이터 로딩 실패:", error);
        
        if (error.code === 'permission-denied' || (error.message && error.message.includes('permission'))) {
            document.getElementById('firebase-guide').style.display = 'block';
            
            const tbody = document.getElementById('location-list-body');
            if (tbody) {
                tbody.innerHTML = '<tr><td style="text-align:center; padding: 50px; color:#ff5252; font-weight:bold; font-size:16px;">보안 규칙 설정이 필요합니다.<br>상단의 안내문을 확인해 주세요.</td></tr>';
            }
        }
    }
}

// 2. 리스트 뷰 렌더링
function renderList(data) {
    const tbody = document.getElementById('location-list-body');
    if (!tbody) return;
    
    data.sort((a, b) => a.id.localeCompare(b.id));

    let html = '';
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

// 3. 파일 업로드 로직
const fileInput = document.getElementById('excel-upload');
if (fileInput) {
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function(event) {
            let content = event.target.result;
            
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
        await updateProductCodes(rows);
    } else {
        alert("파일에서 데이터를 찾을 수 없습니다.");
    }
}

// 5. 알맹이(상품코드)만 추출하여 기존 DB 문서에 업데이트 (정규식 필터링 적용)
async function updateProductCodes(rows) {
    if (!confirm("업로드한 파일의 데이터로 상품코드를 최신화하시겠습니까?\n(기존 로케이션 뼈대에 상품코드만 덮어씌워집니다.)")) return;
    
    const tbody = document.getElementById('location-list-body');
    if(tbody) {
        tbody.innerHTML = '<tr><td style="text-align:center; padding: 50px; color:#3d5afe; font-size:18px; font-weight:bold;">🔥 상품코드를 동기화하고 있습니다...<br>잠시만 기다려주세요!</td></tr>';
    }
    
    try {
        let batch = writeBatch(db);
        let count = 0;
        let batchCount = 0;

        for (let r = 0; r < rows.length; r++) {
            for (let c = 0; c < rows[r].length; c++) {
                const val = rows[r][c]?.toString().trim();
                
                if (!val) continue;

                // 정규식 1: 로케이션 번호만 완벽하게 추출 (예: A-1-002 또는 ★★-01)
                // 괄호, 슬래시 등 불필요한 문자가 섞여 있어도 이 패턴만 오려냅니다.
                const locMatch = val.match(/([A-Z]-\d-\d{3}|★★-\d{2})/);
                
                if (locMatch) {
                    const locId = locMatch[1]; // 오려낸 깔끔한 로케이션 이름
                    let productCode = '';
                    
                    // 정규식 2: 현재 칸 안에 S+숫자6자리가 같이 있는지 검사 (예: A-1-002(4)/ S441820)
                    const prodMatchInSameCell = val.match(/S\d{6}/);
                    
                    if (prodMatchInSameCell) {
                        productCode = prodMatchInSameCell[0]; // S+6자리 숫자만 추출
                    } 
                    // 현재 칸에 없다면 아래 칸이나 아래-오른쪽 칸에서 S+숫자6자리 검사
                    else if (rows[r + 1]) {
                        const cellBelow = rows[r + 1][c]?.toString().trim() || '';
                        const cellBelowRight = rows[r + 1][c + 1]?.toString().trim() || '';
                        
                        const matchBelow = cellBelow.match(/S\d{6}/);
                        const matchBelowRight = cellBelowRight.match(/S\d{6}/);

                        if (matchBelow) {
                            productCode = matchBelow[0];
                        } else if (matchBelowRight) {
                            productCode = matchBelowRight[0];
                        }
                    }
                    
                    // 추출한 상품코드가 있을 때만 업데이트 반영
                    if (productCode) {
                        const docRef = doc(db, LOC_COLLECTION, locId);
                        batch.set(docRef, {
                            code: productCode,
                            updatedAt: new Date()
                        }, { merge: true });
                        
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
        }

        if (batchCount > 0) {
            await batch.commit();
        }

        alert(`✅ 동기화 완료!\n총 ${count}개의 로케이션에 상품코드가 업데이트되었습니다.`);
        document.getElementById('excel-upload').value = '';
        loadAndRender(); 
    } catch (error) {
        console.error("데이터 저장 실패:", error);
        if (error.code === 'permission-denied' || (error.message && error.message.includes('permission'))) {
            alert("보안 규칙 오류로 인해 저장이 차단되었습니다. 상단의 안내문을 확인해 주세요.");
            loadAndRender();
        } else {
            alert("저장 중 오류가 발생했습니다: " + error.message);
        }
    }
}

// 6. 개별 삭제 로직
window.deleteLoc = async (id) => {
    if(confirm(`${id} 로케이션 자체를 DB에서 완전히 삭제하시겠습니까?`)) {
        try {
            await deleteDoc(doc(db, LOC_COLLECTION, id));
            loadAndRender();
        } catch (error) {
            if (error.code === 'permission-denied') {
                alert("권한이 없어 삭제할 수 없습니다.");
            }
        }
    }
};

window.onload = loadAndRender;
