// js/location.js
import { initializeFirebase } from './config.js';
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();

// 엑셀 시트 1의 위치 데이터를 시뮬레이션한 샘플 데이터 구조
// (실제로는 CSV 파싱 라이브러리를 써서 이 데이터를 자동 생성하게 됩니다.)
async function drawMap() {
    const mapContainer = document.getElementById('location-map');
    
    // 엑셀에서 추출할 로케이션 정보 (예시)
    // 실제 구현 시에는 CSV를 읽어서 이 배열을 만듭니다.
    const locations = [
        { id: '★★-01', row: 4, col: 1, code: 'S555575', stock: 100 },
        { id: '★★-02', row: 1, col: 6, code: 'S560168', stock: 100 },
        { id: '★★-03', row: 1, col: 11, code: 'S561414', stock: 100 },
        // ... 여기에 엑셀의 모든 로케이션이 들어갑니다.
    ];

    mapContainer.innerHTML = '';

    // 로케이션 박스 생성
    locations.forEach(loc => {
        const div = document.createElement('div');
        div.className = 'loc-box';
        // 엑셀의 좌표(Row/Col)를 그리드 위치로 지정
        div.style.gridRow = loc.row;
        div.style.gridColumn = loc.col;
        
        div.innerHTML = `
            <div class="loc-id">${loc.id}</div>
            <div class="loc-code">${loc.code}</div>
            <div class="loc-stock">재고: ${loc.stock}</div>
        `;
        
        div.onclick = () => alert(`${loc.id} 수정을 시작합니다.`);
        mapContainer.appendChild(div);
    });
}

window.onload = drawMap;
