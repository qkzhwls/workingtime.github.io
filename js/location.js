// js/location.js

import { initializeFirebase } from './config.js';
// DB 연동은 잠시 꺼둡니다 (테스트용)
// import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const LOC_COLLECTION = 'location_map_3f';

// 1. 초기 화면 (테스트 모드 안내)
function initPreviewMode() {
    const container = document.getElementById('location-map');
    if (container) {
        container.innerHTML = '<div style="grid-column: 1 / -1; text-align:center; padding: 50px; color:#666;">엑셀 파일을 업로드하면 이곳에 도면이 미리보기로 나타납니다. (현재는 테스트 모드라 DB에 저장되지 않습니다.)</div>';
    }
    
    // 리스트 뷰는 임시 비활성화
    const tbody = document.getElementById('location-list-body');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">도면 미리보기 테스트 중입니다.</td></tr>';
    }
}

// 2. 도면 뷰 렌더링 (엑셀 좌표 1:1 매칭)
function renderPreviewMap(data) {
    const container = document.getElementById('location-map');
    if (!container) return;
    
    container.innerHTML = '';
    
    // 엑셀 칸 크기에 맞춰 그리드 간격 조정 (너무 넓어지지 않게)
    container.style.gridAutoColumns = '70px'; // 박스 너비
    container.style.gridAutoRows = '60px'; // 박스 높기
    container.style.gap = '2px';
    
    let count = 0;

    data.forEach(loc => {
        const box = document.createElement('div');
        box.className = 'loc-box';
        // ⭐️ 엑셀의 행(row)과 열(col)을 화면 좌표로 그대로 사용!
        box.style.gridRow = loc.row;
        box.style.gridColumn = loc.col;
        
        box.innerHTML = `
            <div class="loc-id" style="font-weight:bold; color:#333; font-size:11px;">${loc.id}</div>
            <div class="loc-code" style="font-size:10px; color:#3d5afe; font-weight:bold; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${loc.code || ''}
            </div>
        `;
        container.appendChild(box);
        count++;
    });
    
    alert(`도면 배치 완료!\n총 ${count}개의 로케이션이 엑셀과 동일한 위치에 배치되었습니다.\n눈으로 확인해 보세요.`);
}

// 3. SheetJS를 이용한 파일 분석
const fileInput = document.getElementById('excel-upload');
if (fileInput) {
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function(event) {
            try {
                const data = new Uint8Array(event.target.result);
                // SheetJS로 엑셀/CSV 완벽 해독
                // @ts-ignore
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                // 빈 칸도 좌표를 유지하기 위해 null로 채워서 배열화
                // @ts-ignore
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
                
                if (rows && rows.length > 0) {
                    processPreviewData(rows);
                } else {
                    alert("파일에서 데이터를 찾을 수 없습니다.");
                }
            } catch (error) {
                console.error("파일 분석 중 오류 발생:", error);
                alert("파일을 읽는 중 오류가 발생했습니다.");
            }
        };
        // SheetJS는 ArrayBuffer로 읽는 것을 권장
        reader.readAsArrayBuffer(file);
    });
}

// 4. 미리보기용 데이터 추출 로직
function processPreviewData(rows) {
    const previewData = [];
    
    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            const val = rows[r][c]?.toString().trim();
            
            // ★★ 기호가 포함되어 있거나, Z-801, G-101 같은 알파벳-숫자 조합 기호 찾기
            if (val && (val.includes('★★') || /^[A-Z]-\d{2,}/.test(val))) {
                const locId = val;
                let productCode = '';
                
                // 바로 아래 칸에서 상품코드 확인 (미리보기용)
                if (rows[r + 1]) {
                    const cellBelow = rows[r + 1][c]?.toString().trim() || '';
                    const cellBelowRight = rows[r + 1][c + 1]?.toString().trim() || '';
                    
                    if (cellBelow === '상품코드' && cellBelowRight) {
                        productCode = cellBelowRight;
                    } else if (cellBelow && cellBelow !== '상품코드' && !cellBelow.includes('#N/A') && !cellBelow.includes('지정옵션') && !cellBelow.includes('입고대기') && !cellBelow.includes('현재고')) {
                        // 불필요한 엑셀 수식/옵션 글자는 제외하고 상품코드만 추출
                        productCode = cellBelow.replace('상품코드', '').trim();
                    }
                }
                
                previewData.push({
                    id: locId,
                    row: r + 1, // 엑셀의 실제 행 번호
                    col: c + 1, // 엑셀의 실제 열 번호
                    code: productCode
                });
            }
        }
    }
    
    // 추출한 데이터를 화면에 뿌리기
    renderPreviewMap(previewData);
    
    // 재업로드를 위해 인풋 비우기
    document.getElementById('excel-upload').value = '';
}

window.onload = initPreviewMode;
