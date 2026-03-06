import { initializeFirebase, loadAppConfig } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, writeBatch, getDocs, query, where, documentId, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const { db, auth, db2 } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

let originalData = []; 
let zikjinData = {}; 
let weeklyData = {}; 
let incomingData = {}; 
let sortConfig = { key: 'id', direction: 'asc' }; 
let filters = { loc: [], code: 'all', stock: 'all', dong: 'all', pos: 'all' };

const RESERVE_EXPIRE_MS = Infinity; 

let currentUserName = "비로그인 작업자";
let appConfig = null;
window.currentUsageTab = '3F';
window.capacity2F = 200000;

window.sheetUrlOrder = ''; 
window.sheetUrlBuy = ''; 

window.visibleColumns = ['std_dong', 'std_pos', 'std_id', 'std_code', 'std_name', 'std_option', 'std_stock'];
window.excelHeaders = []; 

window.isPreAssignMode = false;
window.selectedPreAssignItem = null;

// ✨ 새로운 100% 만점 기준 기본 비율 세팅
window.recommendRatios = { zikjin: 50, weekly: 30, trend: 20 };

// ✨ 로케이션 기본 우선순위 세팅 (사용자가 알려준 기준 적용)
window.recommendPriorities = {
    zones: [
        ['★'], // 0순위
        ['A','B','C','D','E','F','G','H','I'], // 1순위
        ['Z'], // 2순위
        ['L','M','N','O','P','Q','R','S','T']  // 3순위
    ],
    dongs: ['1', '2', '3', '4', '5', '6'],
    poses: ['2', '3', '4', '1', '5']
};

// 🎨 퍼즐(드래그앤드롭)을 위한 CSS 동적 주입 (HTML 파일 수정 불필요)
const injectPuzzleStyle = () => {
    if(document.getElementById('puzzle-style')) return;
    const style = document.createElement('style');
    style.id = 'puzzle-style';
    style.innerHTML = `
        .puzzle-container { display: flex; flex-direction: column; gap: 6px; }
        .puzzle-row { display: flex; align-items: stretch; gap: 8px; }
        .puzzle-label { width: 70px; background: #e0e0e0; font-weight: bold; font-size: 12px; color: #333; display: flex; align-items: center; justify-content: center; border-radius: 6px; text-align: center; }
        .puzzle-drop-area { flex: 1; min-height: 42px; border: 2px dashed #bbb; border-radius: 6px; padding: 6px; display: flex; flex-wrap: wrap; gap: 5px; background: #fafafa; transition: background 0.2s, border-color 0.2s; }
        .puzzle-drop-area.dragover { background: #eef1ff; border-color: var(--primary); }
        .puzzle-block { width: 28px; height: 28px; background: white; border: 2px solid #666; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; cursor: grab; box-shadow: 0 2px 4px rgba(0,0,0,0.1); user-select: none; transition: transform 0.1s; }
        .puzzle-block:active { cursor: grabbing; transform: scale(1.1); }
        .puzzle-block.dragging { opacity: 0.4; }
    `;
    document.head.appendChild(style);
};

loadAppConfig(db).then(config => {
    appConfig = config;
    if (auth.currentUser) updateCurrentUserName(auth.currentUser);
});

function updateCurrentUserName(user) {
    if (!user) return;
    let email = user.email || "";
    let name = user.displayName || email.split('@')[0];
    if (appConfig && appConfig.memberEmails) {
        for (let key in appConfig.memberEmails) {
            if (appConfig.memberEmails[key] === email) { name = key; break; }
        }
    }
    currentUserName = name;
}

onAuthStateChanged(auth, (user) => {
    if (user) updateCurrentUserName(user);
    else currentUserName = "비로그인 작업자";
});

window.showLoading = function(text) {
    const loadingText = document.getElementById('loading-text');
    if(loadingText) loadingText.innerText = text;
    document.getElementById('loading-overlay').style.display = 'flex';
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
};

window.hideLoading = function() {
    document.getElementById('loading-overlay').style.display = 'none';
};

function setupRealtimeListenerB() {
    if (!db2) return;
    onSnapshot(collection(db2, 'ZikjinData'), (snapshot) => {
        zikjinData = {};
        snapshot.forEach(docSnap => { zikjinData[docSnap.id] = docSnap.data(); });
        applyFiltersAndSort();
    }, (error) => console.error("직진배송 오류:", error));

    onSnapshot(collection(db2, 'WeeklyData'), (snapshot) => {
        weeklyData = {};
        snapshot.forEach(docSnap => { weeklyData[docSnap.id] = docSnap.data(); });
        applyFiltersAndSort();
    }, (error) => console.error("주차별데이터 오류:", error));
    
    onSnapshot(collection(db2, 'IncomingData'), (snapshot) => {
        incomingData = {};
        snapshot.forEach(docSnap => { incomingData[docSnap.id] = docSnap.data(); });
        if(document.getElementById('incoming-sidebar').classList.contains('open')) window.renderIncomingQueue();
        applyFiltersAndSort();
    }, (error) => console.error("입고예정데이터 오류:", error));
}

function setupRealtimeListenerA() {
    onSnapshot(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), (docSnap) => {
        if(docSnap.exists()) {
            const conf = docSnap.data();
            if (conf.capacity2F) window.capacity2F = conf.capacity2F;
            if (conf.sheetUrlOrder) window.sheetUrlOrder = conf.sheetUrlOrder;
            if (conf.sheetUrlBuy) window.sheetUrlBuy = conf.sheetUrlBuy;
            if (conf.sheetUrl && !conf.sheetUrlOrder) window.sheetUrlOrder = conf.sheetUrl;
            if (conf.visibleColumns) window.visibleColumns = conf.visibleColumns;
            if (conf.excelHeaders) window.excelHeaders = conf.excelHeaders;
            
            // 비율 불러오기
            if (conf.recommendRatios) {
                let r = conf.recommendRatios;
                if ((r.zikjin + r.weekly + r.trend) === 100) window.recommendRatios = r;
            }

            // 우선순위 셋팅 불러오기
            if (conf.recommendPriorities) {
                window.recommendPriorities = conf.recommendPriorities;
            }
            
            renderTableHeader(); 
            applyFiltersAndSort();
        }
    });

    const qZones = query(collection(db, LOC_COLLECTION), where(documentId(), ">=", "ZONE_"), where(documentId(), "<=", "ZONE_\uf8ff"));
    onSnapshot(qZones, (snapshot) => {
        document.getElementById('firebase-guide').style.display = 'none';
        originalData = [];
        
        snapshot.forEach(docSnap => {
            const zoneData = docSnap.data();
            for (let locId in zoneData) {
                if (typeof zoneData[locId] === 'object' && zoneData[locId] !== null) {
                    originalData.push({ id: locId, ...zoneData[locId] });
                }
            }
        });
        
        renderTableHeader(); 
        applyFiltersAndSort(); 
        if(document.getElementById('incoming-sidebar').classList.contains('open')) window.renderIncomingQueue();
        
        const pop = document.getElementById('usage-popup');
        if (pop && pop.style.display === 'block') window.calculateAndRenderUsage();
    }, (error) => { console.error("A창고 오류:", error); });
}

window.onload = () => {
    injectPuzzleStyle();
    setupRealtimeListenerA();
    setupRealtimeListenerB();
};

// 🧩 마우스 드래그 앤 드롭 동작 함수 (퍼즐 조각)
window.handleDragStart = (e) => {
    e.target.classList.add('dragging');
    e.dataTransfer.setData('text/plain', e.target.innerText);
    e.dataTransfer.effectAllowed = "move";
};
window.handleDragEnd = (e) => { e.target.classList.remove('dragging'); };
window.handleDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
    e.dataTransfer.dropEffect = "move";
};
window.handleDragLeave = (e) => { e.currentTarget.classList.remove('dragover'); };
window.handleDrop = (e, targetArea) => {
    e.preventDefault();
    targetArea.classList.remove('dragover');
    const draggedText = e.dataTransfer.getData('text/plain');
    const draggedEl = Array.from(document.querySelectorAll('.puzzle-block')).find(el => el.innerText === draggedText && el.classList.contains('dragging'));
    if(draggedEl) targetArea.appendChild(draggedEl);
};

// ✨ [통합] 비율 및 우선순위 마스터 설정창 띄우기
window.openRatioModal = function(e) {
    if(e) e.stopPropagation();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    
    let modal = document.getElementById('ratio-settings-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'ratio-settings-modal';
        modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:none; align-items:center; justify-content:center; z-index:10000;";
        modal.innerHTML = `
            <div style="background:white; padding:25px; border-radius:12px; width:520px; max-height:90vh; overflow-y:auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid var(--primary); padding-bottom:10px; margin-bottom:15px;">
                    <h2 style="margin:0; color:var(--primary); font-size:20px;">⚙️ 로케이션 추천 마스터 설정</h2>
                    <button onclick="document.getElementById('ratio-settings-modal').style.display='none'" style="background:none; border:none; font-size:24px; cursor:pointer;">×</button>
                </div>

                <div style="background:#f9f9f9; border:1px solid #ddd; border-radius:8px; padding:15px; margin-bottom:15px;">
                    <h4 style="margin:0 0 10px 0; color:#333;">📊 점수 반영 비율 (총합 100%)</h4>
                    <div style="display:flex; justify-content:space-between; gap:10px;">
                        <label style="flex:1; display:flex; flex-direction:column; font-size:12px; font-weight:bold;">직진배송 데이터<input type="number" id="mod-ratio-zikjin" style="margin-top:5px; text-align:center; padding:6px; border:1px solid #ccc; border-radius:4px; font-weight:bold;"></label>
                        <span style="align-self:center; font-size:20px; color:#aaa; margin-top:15px;">+</span>
                        <label style="flex:1; display:flex; flex-direction:column; font-size:12px; font-weight:bold;">주차별 배송/발주<input type="number" id="mod-ratio-weekly" style="margin-top:5px; text-align:center; padding:6px; border:1px solid #ccc; border-radius:4px; font-weight:bold;"></label>
                        <span style="align-self:center; font-size:20px; color:#aaa; margin-top:15px;">+</span>
                        <label style="flex:1; display:flex; flex-direction:column; font-size:12px; font-weight:bold;">최근 상승세<input type="number" id="mod-ratio-trend" style="margin-top:5px; text-align:center; padding:6px; border:1px solid #ccc; border-radius:4px; font-weight:bold;"></label>
                    </div>
                </div>

                <div style="background:#fff; border:1px solid #ddd; border-radius:8px; padding:15px; margin-bottom:15px;">
                    <h4 style="margin:0 0 5px 0; color:#333;">🧩 구역(알파벳) 우선순위 배치</h4>
                    <p style="margin:0 0 10px 0; font-size:11px; color:#666;">마우스로 알파벳 조각을 끌어서 원하는 순위 칸에 놓으세요.</p>
                    
                    <div class="puzzle-container">
                        <div class="puzzle-row">
                            <div class="puzzle-label" style="background:#ffd54f;">0순위</div>
                            <div class="puzzle-drop-area" id="pz-0" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div>
                        </div>
                        <div class="puzzle-row">
                            <div class="puzzle-label" style="background:#81c784;">1순위</div>
                            <div class="puzzle-drop-area" id="pz-1" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div>
                        </div>
                        <div class="puzzle-row">
                            <div class="puzzle-label" style="background:#64b5f6;">2순위</div>
                            <div class="puzzle-drop-area" id="pz-2" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div>
                        </div>
                        <div class="puzzle-row">
                            <div class="puzzle-label" style="background:#ba68c8; color:white;">3순위</div>
                            <div class="puzzle-drop-area" id="pz-3" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div>
                        </div>
                        <div class="puzzle-row" style="margin-top:10px;">
                            <div class="puzzle-label" style="background:#eeeeee; border:1px solid #ccc;">미지정<br>(후순위)</div>
                            <div class="puzzle-drop-area" id="pz-none" style="background:#f0f0f0; border-color:#ccc;" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div>
                        </div>
                    </div>
                </div>

                <div style="background:#fff; border:1px solid #ddd; border-radius:8px; padding:15px; margin-bottom:20px;">
                    <h4 style="margin:0 0 10px 0; color:#333;">🏢 동 / 위치 우선순위</h4>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <label style="display:flex; align-items:center; font-size:13px; font-weight:bold;">
                            <span style="width:100px;">동 우선순위:</span>
                            <input type="text" id="mod-pri-dongs" placeholder="예: 1, 2, 3, 4, 5, 6" style="flex:1; padding:6px; border:1px solid #ccc; border-radius:4px;">
                        </label>
                        <label style="display:flex; align-items:center; font-size:13px; font-weight:bold;">
                            <span style="width:100px;">위치 우선순위:</span>
                            <input type="text" id="mod-pri-poses" placeholder="예: 2, 3, 4, 1, 5" style="flex:1; padding:6px; border:1px solid #ccc; border-radius:4px;">
                        </label>
                        <p style="margin:0; font-size:11px; color:#888;">※ 우선순위가 높은 순서대로 쉼표(,)를 사용하여 적어주세요.</p>
                    </div>
                </div>
                
                <div style="display:flex; justify-content:center;">
                    <button onclick="saveMasterSettingsModal()" style="width:100%; padding:12px; font-size:16px; border:none; background:var(--primary); color:white; border-radius:6px; cursor:pointer; font-weight:bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">💾 변경사항 저장 및 즉시 재계산</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // 1. 비율 데이터 바인딩
    document.getElementById('mod-ratio-zikjin').value = window.recommendRatios.zikjin;
    document.getElementById('mod-ratio-weekly').value = window.recommendRatios.weekly;
    document.getElementById('mod-ratio-trend').value = window.recommendRatios.trend;
    
    // 2. 퍼즐 데이터 바인딩
    const allAlphabets = ['★', 'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
    const priZones = window.recommendPriorities.zones || [[], [], [], []];
    
    for(let i=0; i<=3; i++) document.getElementById(`pz-${i}`).innerHTML = '';
    document.getElementById('pz-none').innerHTML = '';

    allAlphabets.forEach(alpha => {
        let placedRank = -1;
        for(let i=0; i<=3; i++) {
            if(priZones[i] && priZones[i].includes(alpha)) { placedRank = i; break; }
        }
        
        const block = document.createElement('div');
        block.className = 'puzzle-block';
        block.innerText = alpha;
        block.draggable = true;
        block.ondragstart = window.handleDragStart;
        block.ondragend = window.handleDragEnd;

        if(placedRank !== -1) {
            document.getElementById(`pz-${placedRank}`).appendChild(block);
        } else {
            document.getElementById('pz-none').appendChild(block);
        }
    });

    // 3. 동/위치 데이터 바인딩
    document.getElementById('mod-pri-dongs').value = (window.recommendPriorities.dongs || []).join(', ');
    document.getElementById('mod-pri-poses').value = (window.recommendPriorities.poses || []).join(', ');
    
    modal.style.display = 'flex';
};

// ✨ 통합 설정(비율+우선순위) 검증 및 파이어베이스 저장
window.saveMasterSettingsModal = async function() {
    // 1. 비율 검증
    const z = Number(document.getElementById('mod-ratio-zikjin').value) || 0;
    const w = Number(document.getElementById('mod-ratio-weekly').value) || 0;
    const t = Number(document.getElementById('mod-ratio-trend').value) || 0;
    if (z + w + t !== 100) return alert(`🚨 점수 반영 비율의 합계가 100%가 되어야 합니다.\n(현재 합계: ${z + w + t}%)`);
    
    // 2. 퍼즐 데이터 읽기
    let newZones = [];
    for(let i=0; i<=3; i++){
        const blocks = document.getElementById(`pz-${i}`).querySelectorAll('.puzzle-block');
        newZones.push(Array.from(blocks).map(b => b.innerText.trim()));
    }

    // 3. 동/위치 데이터 읽기
    const newDongs = document.getElementById('mod-pri-dongs').value.split(',').map(s => s.trim()).filter(s => s !== '');
    const newPoses = document.getElementById('mod-pri-poses').value.split(',').map(s => s.trim()).filter(s => s !== '');

    const newPriorities = { zones: newZones, dongs: newDongs, poses: newPoses };

    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { 
            recommendRatios: { zikjin: z, weekly: w, trend: t },
            recommendPriorities: newPriorities
        }, { merge: true });
        
        window.recommendRatios = { zikjin: z, weekly: w, trend: t };
        window.recommendPriorities = newPriorities;
        
        document.getElementById('ratio-settings-modal').style.display = 'none';
        showToast("✅ 마스터 설정이 저장되었습니다.");
        
        // 추천 리스트가 열려있으면 즉시 알고리즘 재계산
        const recModal = document.getElementById('recommend-modal');
        if (recModal && recModal.style.display === 'flex') {
            window.showRecommendation();
        }
    } catch(e) { console.error(e); alert("설정 저장 중 오류가 발생했습니다."); }
};

// ✨ 로케이션 추천 다중 정렬 코어 로직
window.showRecommendation = function() {
    window.showLoading("💡 우선순위 알고리즘을 분석하여 최적의 로케이션을 매칭 중입니다...");

    setTimeout(() => {
        const allCodes = new Set([...Object.keys(zikjinData), ...Object.keys(weeklyData)]);
        
        let maxZQty = 0; let maxWQty = 0; let maxTrend = 0;
        let itemDataList = [];

        // 데이터 100점 만점 정규화를 위한 최대값 추출
        allCodes.forEach(code => {
            let zItem = zikjinData[code] || {}; let wItem = weeklyData[code] || {};
            let name = zItem['상품명'] || wItem['상품명'] || '알 수 없음';
            let zQty = Number(zItem['수량'] || 0); 
            let wQty = Number(wItem['기간배송수량'] || wItem['기간발주수량'] || 0); 
            let trendVal = 0;
            let dates = Object.keys(wItem).filter(k => /^20\d{6}$/.test(k)).sort();
            if (dates.length >= 6) {
                let recent3 = dates.slice(-3).reduce((sum, d) => sum + Number(wItem[d] || 0), 0);
                let prev3 = dates.slice(-6, -3).reduce((sum, d) => sum + Number(wItem[d] || 0), 0);
                trendVal = Math.max(0, recent3 - prev3); 
            }
            if (zQty > maxZQty) maxZQty = zQty;
            if (wQty > maxWQty) maxWQty = wQty;
            if (trendVal > maxTrend) maxTrend = trendVal;
            itemDataList.push({ code, name, zQty, wQty, trendVal });
        });

        // 1. 추천 상품 점수 계산 (비율 적용)
        let scoredItems = [];
        itemDataList.forEach(item => {
            let zScore = maxZQty > 0 ? (item.zQty / maxZQty) * 100 : 0;
            let wScore = maxWQty > 0 ? (item.wQty / maxWQty) * 100 : 0;
            let tScore = maxTrend > 0 ? (item.trendVal / maxTrend) * 100 : 0;
            let finalScore = (zScore * (window.recommendRatios.zikjin / 100)) + (wScore * (window.recommendRatios.weekly / 100)) + (tScore * (window.recommendRatios.trend / 100));

            if (finalScore > 0) {
                let currentLocs = originalData.filter(d => d.code === item.code).map(d => d.id).join(', ');
                if (!currentLocs) currentLocs = '신규배치 (없음)';
                scoredItems.push({ code: item.code, name: item.name, score: finalScore, currentLocs });
            }
        });

        scoredItems.sort((a, b) => b.score - a.score);

        // 2. 빈 로케이션 완벽 필터링
        let emptyLocs = originalData.filter(d => {
            const hasContent = (d.code && d.code !== d.id && d.code.trim() !== "") || (d.name && d.name.trim() !== "");
            return !hasContent && !d.preAssigned; 
        });

        // 3. 👑 사용자가 설정한 다중 우선순위 정렬 로직
        const getZoneRank = (locId) => {
            const prefix = (locId || '').charAt(0).toUpperCase();
            for(let i=0; i < window.recommendPriorities.zones.length; i++) {
                if(window.recommendPriorities.zones[i].includes(prefix)) return i;
            }
            return 99; // 설정 안 된 구역은 가장 뒤로
        };
        const getDongRank = (dong) => {
            const str = (dong || '').toString().trim();
            const idx = window.recommendPriorities.dongs.indexOf(str);
            return idx !== -1 ? idx : 99;
        };
        const getPosRank = (pos) => {
            const str = (pos || '').toString().trim();
            const idx = window.recommendPriorities.poses.indexOf(str);
            return idx !== -1 ? idx : 99;
        };

        emptyLocs.sort((a, b) => {
            // 1차: 구역 순위 비교
            let zRankA = getZoneRank(a.id);
            let zRankB = getZoneRank(b.id);
            if (zRankA !== zRankB) return zRankA - zRankB;

            // 2차: 동 순위 비교
            let dRankA = getDongRank(a.dong);
            let dRankB = getDongRank(b.dong);
            if (dRankA !== dRankB) return dRankA - dRankB;

            // 3차: 위치 순위 비교
            let pRankA = getPosRank(a.pos);
            let pRankB = getPosRank(b.pos);
            if (pRankA !== pRankB) return pRankA - pRankB;

            // 4차: 모두 같으면 이름순 정렬
            return a.id.localeCompare(b.id); 
        });

        const tbody = document.getElementById('recommend-tbody');
        let html = ''; 
        let matchCount = Math.min(scoredItems.length, emptyLocs.length);
        
        if (matchCount === 0) {
            html += '<tr><td colspan="5" style="padding:40px;">데이터가 부족하거나 추천할 빈 로케이션이 없습니다.</td></tr>';
        } else {
            for (let i = 0; i < matchCount; i++) {
                let item = scoredItems[i];
                let eLoc = emptyLocs[i];
                html += `
                    <tr>
                        <td style="color:var(--primary); font-weight:bold; border-left:none;">${i+1}위 <br><span style="font-size:11px; color:#e65100;">(${item.score.toFixed(1)}점)</span></td>
                        <td style="font-weight:bold; color:#333;">${item.code}</td>
                        <td style="text-align:left; font-size:13px;">${item.name}</td>
                        <td style="color:#888;">${item.currentLocs}</td>
                        <td style="color:#2e7d32; font-weight:bold; background:#f1f8e9; border-right:none;">${eLoc.id} <br><span style="font-size:11px; color:#555;">(${eLoc.dong}동 ${eLoc.pos}위치)</span></td>
                    </tr>
                `;
            }
        }

        tbody.innerHTML = html;
        window.hideLoading();
        document.getElementById('recommend-modal').style.display = 'flex';

    }, 500); 
};

function renderTableHeader() {
    const theadTr = document.getElementById('dynamic-thead-tr');
    const popupContainer = document.getElementById('dynamic-popups');
    if (!theadTr || !popupContainer) return;

    let html = `<th class="checkbox-cell"><input type="checkbox" id="check-all" class="loc-check" onclick="toggleAllCheckboxes(this)"></th>`;
    let popupHtml = '';
    
    window.visibleColumns.forEach(col => {
        if (col === 'std_dong') { html += createTh('dong', '동', 80, true); popupHtml += `<div id="pop-dong" class="filter-popup"></div>`; }
        else if (col === 'std_pos') { html += createTh('pos', '위치', 80, true); popupHtml += `<div id="pop-pos" class="filter-popup"></div>`; }
        else if (col === 'std_id') { html += createTh('id', '로케이션', 150, true); popupHtml += `<div id="pop-id" class="filter-popup"></div>`; }
        else if (col === 'std_code') { html += createTh('code', '상품코드', 150, true); popupHtml += `<div id="pop-code" class="filter-popup"></div>`; }
        else if (col === 'std_name') { html += createTh('name', '상품명', 'auto', true); popupHtml += `<div id="pop-name" class="filter-popup"></div>`; }
        else if (col === 'std_option') { html += createTh('option', '옵션', 180, true); popupHtml += `<div id="pop-option" class="filter-popup"></div>`; }
        else if (col === 'std_stock') { html += createTh('stock', '정상재고', 130, true); popupHtml += `<div id="pop-stock" class="filter-popup"></div>`; }
        else if (col.startsWith('cus_')) {
            const label = col.replace('cus_', '');
            html += createTh(col, label, 120, false); 
        }
    });
    
    theadTr.innerHTML = html;
    popupContainer.innerHTML = popupHtml;
    
    document.querySelectorAll('.filter-popup').forEach(p => { p.addEventListener('click', function(e) { e.stopPropagation(); }); });
    setupFilterPopups();
}

function createTh(key, label, width, hasFilter) {
    let widthStyle = width === 'auto' ? '' : `style="width: ${width}px;"`;
    let filterHtml = hasFilter ? `<span class="filter-btn" id="btn-filter-${key}" onclick="toggleFilterPopup(event, 'pop-${key}')">▼</span>` : '';
    return `<th ${widthStyle}><div class="th-content"><span class="title-text">${label}</span>${filterHtml}</div></th>`;
}

window.openSettingsModal = (e) => {
    if(e) e.stopPropagation();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    
    const container = document.getElementById('setting-headers-container');
    
    let html = '<div style="margin-bottom:15px; font-weight:bold; color:var(--primary);">■ 화면 헤더(컬럼) 설정</div><div style="display:flex; flex-wrap:wrap; gap:5px;">';
    
    const stdCols = [
        { id: 'std_dong', label: '동' }, { id: 'std_pos', label: '위치' }, { id: 'std_id', label: '로케이션(ID)' },
        { id: 'std_code', label: '상품코드' }, { id: 'std_name', label: '상품명' }, { id: 'std_option', label: '옵션' }, { id: 'std_stock', label: '정상재고' }
    ];
    
    stdCols.forEach(col => {
        const isChecked = window.visibleColumns.includes(col.id) ? 'checked' : '';
        html += `<label style="display:flex; align-items:center; gap:5px; width: 45%;"><input type="checkbox" class="chk-header" value="${col.id}" ${isChecked}> ${col.label}</label>`;
    });
    
    window.excelHeaders.forEach(header => {
        const colId = 'cus_' + header;
        const isChecked = window.visibleColumns.includes(colId) ? 'checked' : '';
        html += `<label style="display:flex; align-items:center; gap:5px; width: 45%; color:#e65100;"><input type="checkbox" class="chk-header" value="${colId}" ${isChecked}> ${header}</label>`;
    });

    html += `</div>`;
    container.innerHTML = html;
    document.getElementById('settings-modal').style.display = 'flex';
};

window.saveHeaderSettings = async () => {
    const checkboxes = document.querySelectorAll('.chk-header:checked');
    const newVisible = Array.from(checkboxes).map(cb => cb.value);
    
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { 
            visibleColumns: newVisible
        }, { merge: true });
        
        window.visibleColumns = newVisible;
        document.getElementById('settings-modal').style.display = 'none';
        renderTableHeader(); 
        applyFiltersAndSort(); 
        showToast("✅ 화면 헤더 설정이 저장되었습니다.");
    } catch(e) { console.error(e); alert("저장 실패"); }
};


window.openSheetModal = (e) => {
    if(e) e.stopPropagation();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    document.getElementById('modal-sheet-url-order').value = window.sheetUrlOrder || '';
    document.getElementById('modal-sheet-url-buy').value = window.sheetUrlBuy || '';
    document.getElementById('sheet-modal').style.display = 'flex';
};

window.saveSheetUrl = async () => {
    const urlOrder = document.getElementById('modal-sheet-url-order').value.trim();
    const urlBuy = document.getElementById('modal-sheet-url-buy').value.trim();
    
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { sheetUrlOrder: urlOrder, sheetUrlBuy: urlBuy }, { merge: true });
        window.sheetUrlOrder = urlOrder;
        window.sheetUrlBuy = urlBuy;
        alert("✅ 구글시트 링크가 안전하게 저장되었습니다.");
        if (typeof window.closeSheetModal === 'function') window.closeSheetModal();
    } catch(e) { console.error("링크 저장 실패:", e); alert("오류가 발생했습니다."); }
};

const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');

function formatExcelDate(excelDate) {
    if (!excelDate || excelDate.toString().trim() === "") return '';
    if (typeof excelDate === 'string' && (excelDate.includes('-') || excelDate.includes('.'))) return excelDate;
    
    const num = parseFloat(excelDate);
    if (isNaN(num)) return excelDate;
    
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

window.syncIncomingData = async () => {
    if (!window.sheetUrlOrder && !window.sheetUrlBuy) return alert("구글시트 링크가 설정되지 않았습니다.\n[⚙️ 구글시트 링크 설정] 에서 링크를 저장해주세요.");
    window.showLoading("🔄 원본 시트에서 데이터를 분석하여 가져오는 중입니다...");
    
    try {
        let combinedData = [];

        const fetchAndParse = async (url, sourceName) => {
            if (!url) return [];
            
            let textData = "";
            try {
                const res1 = await fetch(url);
                if (!res1.ok) throw new Error("1차 다이렉트 연결 실패");
                textData = await res1.text(); 
            } catch (e1) {
                try {
                    const res2 = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
                    if (!res2.ok) throw new Error("2차 프록시 실패");
                    textData = await res2.text();
                } catch (e2) {
                    const res3 = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
                    if (!res3.ok) throw new Error("3차 프록시 실패");
                    textData = await res3.text();
                }
            }

            const workbook = XLSX.read(textData, { type: 'string' });
            const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
            
            let headerRowIndex = -1;
            let pureHeaders = [];
            
            for (let i = 0; i < Math.min(20, rawData.length); i++) {
                const row = rawData[i];
                const cleanRow = row.map(h => cleanKey(h));
                if (cleanRow.includes('어드민상품코드') || cleanRow.includes('상품코드')) {
                    headerRowIndex = i;
                    pureHeaders = cleanRow; 
                    break;
                }
            }

            if (headerRowIndex === -1) return []; 

            const parsedList = [];
            for (let i = headerRowIndex + 1; i < rawData.length; i++) {
                let rowObj = {};
                let isEmpty = true;
                for (let j = 0; j < pureHeaders.length; j++) {
                    const key = pureHeaders[j];
                    if (key) {
                        rowObj[key] = rawData[i][j];
                        if (rawData[i][j] !== "" && rawData[i][j] !== undefined) isEmpty = false;
                    }
                }
                if (!isEmpty) {
                    rowObj.source = sourceName; 
                    parsedList.push(rowObj);
                }
            }
            return parsedList;
        };

        const [orderData, buyData] = await Promise.all([
            fetchAndParse(window.sheetUrlOrder, '제작'),
            fetchAndParse(window.sheetUrlBuy, '사입')
        ]);

        combinedData = [...orderData, ...buyData];

        const finalJson = combinedData.map(row => {
            let code = row['어드민상품코드'] || row['상품코드'] || '';
            let name = row['상품명'] || row['공급처상품명'] || '';
            
            let rawQty = row['총미입고수량본사입고기준'];
            if (rawQty === undefined || rawQty === "") rawQty = row['최종미입고수량추가입고예정'];
            if (rawQty === undefined || rawQty === "") rawQty = row['미입고수량'];
            let qty = Number(rawQty) || 0;
            
            let rawDate = "";
            if (row.source === '제작') {
                rawDate = row['공장출고예상일자'] || row['공장출고예상일'] || row['출고예상일'];
            } else if (row.source === '사입') {
                rawDate = row['검수창고도착일'];
            }
            
            let date = formatExcelDate(rawDate);

            return {
                '상품코드': code,
                '상품명': name,
                '옵션': row['옵션'] || '',
                '입고대기수량': qty,
                '공장출고예상일': date,
                'source': row.source || '기타',
                ...row
            };
        }).filter(row => row['상품코드'] && row['상품코드'].toString().trim() !== '' && Number(row['입고대기수량']) > 0 && row['공장출고예상일'] && row['공장출고예상일'].toString().trim() !== '');

        if (finalJson.length > 0) {
            await updateDatabaseB(finalJson, 'IncomingData', null, true);
            window.hideLoading();
            alert(`✅ 입고 대기 상품 연동 완료!\n(오더리스트 ${orderData.length}건, 사입리스트 ${buyData.length}건)`);
        } else { 
            window.hideLoading(); 
            alert("입고 대기(수량 1개 이상) 상품이 없거나 데이터를 찾지 못했습니다."); 
        }
    } catch (error) { 
        window.hideLoading(); 
        alert(`🚨 연결 실패!\n데이터를 가져오지 못했습니다.\n(${error.message})`); 
        console.error("데이터 동기화 실패:", error);
    }
};

window.saveCapacity2F = async function() {
    const input = document.getElementById('input-cap-2f');
    if (!input) return;
    const newVal = parseInt(input.value.replace(/,/g, ''), 10);
    if (isNaN(num)) return alert("올바른 수량을 입력해주세요.");
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { capacity2F: newVal }, { merge: true });
        alert(`2층 기준 수량이 ${newVal.toLocaleString()}장으로 변경되었습니다.`);
    } catch(e) { console.error(e); alert("오류가 발생했습니다."); }
};

window.switchUsageTab = function(tab) { window.currentUsageTab = tab; window.calculateAndRenderUsage(); };

window.applyUsageFilter = function(zone, state) {
    filters = { loc: [], code: 'all', stock: 'all', dong: 'all', pos: 'all' };
    if (zone !== 'all') filters.loc = [zone];
    if (state === 'used') filters.code = 'not-empty'; else if (state === 'empty') filters.code = 'empty';
    setupFilterPopups();
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
};

window.calculateAndRenderUsage = function() {
    const popup = document.getElementById('usage-popup');
    if (!popup) return;
    let html = `<div style="display:flex; gap:10px; margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;"><button onclick="switchUsageTab('3F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; background:${window.currentUsageTab === '3F' ? 'var(--primary)' : '#eee'}; color:${window.currentUsageTab === '3F' ? 'white' : '#555'}">3층 로케이션</button><button onclick="switchUsageTab('2F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; background:${window.currentUsageTab === '2F' ? 'var(--primary)' : '#eee'}; color:${window.currentUsageTab === '2F' ? 'white' : '#555'}">2층 창고재고</button></div>`;

    if (window.currentUsageTab === '3F') {
        const locations = originalData.filter(d => d.id.charAt(0).toUpperCase() !== 'K');
        let total = locations.length;
        if (total === 0) { popup.innerHTML = html + '<div style="padding: 10px;">데이터가 없습니다.</div>'; return; }
        
        let used = 0; let zoneStats = {};
        let todayReservedCount = 0;
        let preAssignedCount = 0; 
        
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        locations.forEach(loc => {
            const isUsed = (loc.code && loc.code.trim() !== '' && loc.code !== loc.id) || (loc.name && loc.name.trim() !== '');
            if (isUsed) used++;
            if ((loc.assignedAt && loc.assignedAt >= todayStart) || (loc.reserved && loc.reservedAt >= todayStart)) {
                todayReservedCount++;
            }
            if (loc.preAssigned) preAssignedCount++;
            const zone = loc.id.charAt(0).toUpperCase();
            if (!zoneStats[zone]) { zoneStats[zone] = { total: 0, used: 0 }; }
            zoneStats[zone].total++;
            if (isUsed) zoneStats[zone].used++;
        });

        const usageRate = ((used / total) * 100).toFixed(1);
        
        html += `
            <div style="display:flex; justify-content: space-around; background: #eef1ff; padding: 10px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #c5cae9;">
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#555; font-weight:bold;">당일지정수량(예약)</div>
                    <div style="font-size:18px; color:var(--primary); font-weight:900;">${todayReservedCount}</div>
                </div>
                <div style="width:1px; background:#ccc;"></div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#555; font-weight:bold;">선지정수량(준비중)</div>
                    <div style="font-size:18px; color:#e65100; font-weight:900;">${preAssignedCount}</div>
                </div>
            </div>
            <div style="font-size:15px; font-weight:bold; margin-bottom:5px; color:var(--primary); text-align:center;">📊 3층 전체 사용률: ${usageRate}%</div>
            <div style="font-size:11px; color:#888; text-align:center; margin-bottom:10px;">※ 숫자를 클릭하면 해당 구역만 보여줍니다.</div>
            <table class="usage-table" style="width:100%;"><thead><tr><th>구역명</th><th>총 칸수</th><th>사용중</th><th>빈칸</th><th>사용률</th></tr></thead><tbody><tr><td style="font-weight:bold; color:#d32f2f;">전체 합계</td><td style="font-weight:bold;">${total}</td><td style="font-weight:bold; color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'used')">${used}</td><td style="font-weight:bold; color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'empty')">${total - used}</td><td style="font-weight:bold; color:#d32f2f;">${usageRate}%</td></tr>`;

        const zones = Object.keys(zoneStats).sort((a,b) => (a==='★'?-1:(b==='★'?1:a.localeCompare(b))));
        zones.forEach(z => {
            const zTotal = zoneStats[z].total; const zUsed = zoneStats[z].used; const zEmpty = zTotal - zUsed; const zRate = ((zUsed / zTotal) * 100).toFixed(1);
            html += `<tr><td><strong>${z}</strong> 구역</td><td>${zTotal}</td><td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${z}', 'used')">${zUsed}</td><td style="color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${z}', 'empty')">${zEmpty}</td><td>${zRate}%</td></tr>`;
        });
        html += `</tbody></table>`;
    } else {
        let sum2F = 0; originalData.forEach(loc => { sum2F += Number(loc.stock2f || 0); });
        let rate2F = ((sum2F / window.capacity2F) * 100).toFixed(1);
        html += `<div style="font-size:15px; font-weight:bold; margin-bottom:15px; color:var(--primary); text-align:center;">🏢 2층 전체 창고 사용률: ${rate2F}%</div><table class="usage-table" style="width:100%;"><tr><th style="background:#eef1ff; width: 40%;">총 적재가능수량</th><td style="text-align: right;"><input type="number" id="input-cap-2f" value="${window.capacity2F}" style="width:80px; padding:3px; text-align:right; font-size:13px; font-weight:bold;"> 장 <button onclick="saveCapacity2F()" style="padding:4px 8px; margin-left:5px; font-size:11px; background:var(--primary); color:white; border:none; border-radius:3px; cursor:pointer;">기준변경</button></td></tr><tr><th style="background:#eef1ff;">현재 적재수량</th><td style="font-weight:bold; color:var(--primary); text-align: right;">${sum2F.toLocaleString()} 장</td></tr><tr><th style="background:#eef1ff;">남은 수량</th><td style="font-weight:bold; color:#ff5252; text-align: right;">${(window.capacity2F - sum2F).toLocaleString()} 장</td></tr></table>`;
    }
    popup.innerHTML = html;
};

window.toggleUsagePopup = function(e) {
    e.stopPropagation();
    const pop = document.getElementById('usage-popup');
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    if (pop.style.display !== 'block') { pop.style.display = 'block'; window.calculateAndRenderUsage(); }
};

function getSortButtonsHtml(key) {
    const isAsc = sortConfig.key === key && sortConfig.direction === 'asc';
    const isDesc = sortConfig.key === key && sortConfig.direction === 'desc';
    return `<div class="filter-option ${isAsc ? 'selected' : ''}" onclick="executeSort('${key}', 'asc')">${isAsc ? '✔️ ' : ''}⬆️ 오름차순 정렬</div><div class="filter-option ${isDesc ? 'selected' : ''}" onclick="executeSort('${key}', 'desc')">${isDesc ? '✔️ ' : ''}⬇️ 내림차순 정렬</div><div class="filter-divider"></div>`;
}

function updateLocPopupUI() {
    const locPop = document.getElementById('pop-id');
    if (!locPop) return;
    let prefixSet = new Set(originalData.map(d => d.id.charAt(0))); prefixSet.add('★');
    const prefixes = [...prefixSet].sort((a, b) => (a === '★' ? -1 : (b === '★' ? 1 : a.localeCompare(b))));
    let locHtml = getSortButtonsHtml('id');
    const isAllSelected = filters.loc.length === 0;
    locHtml += `<div class="filter-option ${isAllSelected ? 'selected' : ''}" onclick="toggleLocFilter('all')">${isAllSelected ? '✔️ ' : ''}전체보기</div>`;
    prefixes.forEach(p => { const isSelected = filters.loc.includes(p); locHtml += `<div class="filter-option ${isSelected ? 'selected' : ''}" onclick="toggleLocFilter('${p}')">${isSelected ? '✔️ ' : ''}${p} 구역</div>`; });
    locPop.innerHTML = locHtml;
}

function updateFilterButtonStates() {
    const btnId = document.getElementById('btn-filter-id');
    if (btnId) {
        if (filters.loc.length === 0) btnId.classList.remove('active');
        else btnId.classList.add('active');
    }
    
    ['code', 'dong', 'pos', 'stock'].forEach(type => {
        const btn = document.getElementById('btn-filter-' + type);
        if (btn) {
            if (filters[type] === 'all') btn.classList.remove('active');
            else btn.classList.add('active');
        }
    });
}

function setupFilterPopups() {
    const codePop = document.getElementById('pop-code'); const namePop = document.getElementById('pop-name');
    const optionPop = document.getElementById('pop-option'); const stockPop = document.getElementById('pop-stock');
    const dongPop = document.getElementById('pop-dong'); const posPop = document.getElementById('pop-pos');
    
    updateLocPopupUI();
    
    let codeHtml = getSortButtonsHtml('code') + `<div class="filter-option ${filters.code === 'all' ? 'selected' : ''}" onclick="setFilter('code', 'all')">${filters.code === 'all' ? '✔️ ' : ''}전체보기</div><div class="filter-option ${filters.code === 'empty' ? 'selected' : ''}" onclick="setFilter('code', 'empty')">${filters.code === 'empty' ? '✔️ ' : ''}빈칸</div><div class="filter-option ${filters.code === 'not-empty' ? 'selected' : ''}" onclick="setFilter('code', 'not-empty')">${filters.code === 'not-empty' ? '✔️ ' : ''}내용있음</div>`;
    if(codePop) codePop.innerHTML = codeHtml;
    if(namePop) namePop.innerHTML = getSortButtonsHtml('name');
    if(optionPop) optionPop.innerHTML = getSortButtonsHtml('option');
    const dongs = [...new Set(originalData.map(d => (d.dong || '').toString()))].filter(Boolean).sort();
    let dongHtml = getSortButtonsHtml('dong') + `<div class="filter-option ${filters.dong === 'all' ? 'selected' : ''}" onclick="setFilter('dong', 'all')">${filters.dong === 'all' ? '✔️ ' : ''}전체보기</div>`;
    dongs.forEach(d => { dongHtml += `<div class="filter-option ${filters.dong === d ? 'selected' : ''}" onclick="setFilter('dong', '${d}')">${filters.dong === d ? '✔️ ' : ''}${d}</div>`; });
    if(dongPop) dongPop.innerHTML = dongHtml;
    const poses = [...new Set(originalData.map(d => (d.pos || '').toString()))].filter(Boolean).sort();
    let posHtml = getSortButtonsHtml('pos') + `<div class="filter-option ${filters.pos === 'all' ? 'selected' : ''}" onclick="setFilter('pos', 'all')">${filters.pos === 'all' ? '✔️ ' : ''}전체보기</div>`;
    poses.forEach(p => { posHtml += `<div class="filter-option ${filters.pos === p ? 'selected' : ''}" onclick="setFilter('pos', '${p}')">${filters.pos === p ? '✔️ ' : ''}${p}</div>`; });
    if(posPop) posPop.innerHTML = posHtml;
    const stocks = [...new Set(originalData.map(d => (d.stock || '0').toString()))].sort((a, b) => Number(a) - Number(b));
    let stockHtml = getSortButtonsHtml('stock') + `<div class="filter-option ${filters.stock === 'all' ? 'selected' : ''}" onclick="setFilter('stock', 'all')">${filters.stock === 'all' ? '✔️ ' : ''}전체보기</div>`;
    stocks.forEach(s => { stockHtml += `<div class="filter-option ${filters.stock === s ? 'selected' : ''}" onclick="setFilter('stock', '${s}')">${filters.stock === s ? '✔️ ' : ''}${s}</div>`; });
    if(stockPop) stockPop.innerHTML = stockHtml;

    updateFilterButtonStates(); 
}

window.executeSort = (key, direction) => { sortConfig = { key: key, direction: direction }; setupFilterPopups(); applyFiltersAndSort(); if (typeof window.closeAllPopups === 'function') window.closeAllPopups(); };
window.toggleLocFilter = (val) => { 
    if (val === 'all') filters.loc = []; 
    else { 
        if (filters.loc.includes(val)) filters.loc = filters.loc.filter(v => v !== val); 
        else filters.loc.push(val); 
    } 
    setupFilterPopups(); 
    applyFiltersAndSort(); 
};
window.setFilter = (type, value) => { 
    filters[type] = value; 
    setupFilterPopups(); 
    applyFiltersAndSort(); 
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups(); 
};

function applyFiltersAndSort() {
    let filtered = originalData.filter(item => {
        if (filters.loc.length > 0 && !filters.loc.includes(item.id.charAt(0))) return false;
        if (filters.dong !== 'all' && (item.dong || '').toString() !== filters.dong) return false;
        if (filters.pos !== 'all' && (item.pos || '').toString() !== filters.pos) return false;
        const hasCode = (item.code && item.code !== item.id && item.code.trim() !== "") || (item.name && item.name.trim() !== "");
        if (filters.code === 'empty' && hasCode) return false;
        if (filters.code === 'not-empty' && !hasCode) return false;
        if (filters.stock !== 'all' && (item.stock || '0').toString() !== filters.stock) return false;
        return true;
    });
    filtered.sort((a, b) => {
        let aVal = a[sortConfig.key] || ''; let bVal = b[sortConfig.key] || '';
        if (sortConfig.key === 'stock') return sortConfig.direction === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
        return sortConfig.direction === 'asc' ? aVal.toString().localeCompare(bVal.toString()) : bVal.toString().localeCompare(aVal.toString());
    });
    renderTable(filtered);
}

window.handleRowClick = async function(event, locId) {
    if (event.target.tagName === 'INPUT') return;
    
    if (window.isPreAssignMode && window.selectedPreAssignItem) {
        const loc = originalData.find(d => d.id === locId);
        if (!loc) return;
        const hasContent = (loc.code && loc.code !== loc.id && loc.code.trim() !== "") || (loc.name && loc.name.trim() !== "");
        
        const zoneDocId = 'ZONE_' + locId.charAt(0).toUpperCase();

        if (loc.preAssigned) { 
            if (loc.preAssignedCode === window.selectedPreAssignItem.code) {
                if (confirm(`이미 '${loc.preAssignedCode}' 상품으로 선지정된 자리입니다.\n지정을 해제(취소)하시겠습니까?`)) {
                    await setDoc(doc(db, LOC_COLLECTION, zoneDocId), {
                        [locId]: { preAssigned: false, preAssignedCode: '', preAssignedName: '', preAssignedQty: '', code: '', name: '', option: '', stock: '0', updatedAt: new Date() }
                    }, { merge: true });
                    showToast(`[${locId}] 선지정 취소 완료`);
                    window.cancelPreAssignMode();
                    return;
                } else return;
            }
            if (!confirm(`이미 다른 상품(${loc.preAssignedCode})이 선지정된 자리입니다.\n기존 선지정을 무시하고 덮어쓰시겠습니까?`)) return; 
        } else {
            if (hasContent) { alert("🚨 이미 물건이 들어있는 자리입니다. 텅 빈 빈칸을 선택해주세요."); return; }
        }
        
        try {
            await setDoc(doc(db, LOC_COLLECTION, zoneDocId), {
                [locId]: {
                    preAssigned: true, preAssignedCode: window.selectedPreAssignItem.code,
                    preAssignedName: window.selectedPreAssignItem.name, preAssignedQty: window.selectedPreAssignItem.qty,
                    code: window.selectedPreAssignItem.code, name: window.selectedPreAssignItem.name,
                    option: window.selectedPreAssignItem.option || '', stock: window.selectedPreAssignItem.qty.toString(), 
                    reserved: false, reservedBy: '', reservedAt: 0, updatedAt: new Date()
                }
            }, { merge: true });
            showToast(`[${locId}] 자리에 선지정 락(Lock)이 완료되었습니다!`);
            window.cancelPreAssignMode(); 
        } catch(e) { console.error(e); alert("선지정 저장 오류"); }
        return;
    }
    openEditModal(locId);
};

function renderTable(data) {
    const tbody = document.getElementById('location-list-body');
    if (!tbody) return;
    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    const checkedIds = new Set(Array.from(checkedBoxes).map(cb => cb.value));
    let html = ''; 
    data.forEach(loc => {
        let isReserved = loc.reserved === true;
        let isPreAssigned = loc.preAssigned === true;
        let rowStyle = ''; 
        let badgeHtml = '';
        
        if (isPreAssigned) { 
            rowStyle = 'background-color: #ffe0b2 !important;'; 
        } else if (isReserved) {
            rowStyle = 'background-color: #fffde7 !important;';
        }
        
        if (isReserved && !isPreAssigned) {
            let reserverName = loc.reservedBy || '누군가';
            badgeHtml += `<br><span class="badge-reserved" style="color:#f57f17; font-size:11px;">🔒 ${reserverName} 작업중</span>`;
        }
        
        if (isPreAssigned) {
            badgeHtml += `<br><span class="badge-incoming" style="background-color:#e65100; color:white; padding:2px 4px; border-radius:3px; font-size:11px; display:inline-block; margin-top:2px;">📦 입고선지정: ${loc.preAssignedQty}개 대기중</span>`;
        }
        
        let isChecked = checkedIds.has(loc.id) ? 'checked' : '';
        html += `<tr onclick="handleRowClick(event, '${loc.id}')" style="${rowStyle}">`;
        html += `<td onclick="event.stopPropagation()"><input type="checkbox" class="loc-check" value="${loc.id}" ${isChecked}></td>`;
        window.visibleColumns.forEach(col => {
            if (col === 'std_dong') html += `<td style="color:#666;">${loc.dong || ''}</td>`;
            else if (col === 'std_pos') html += `<td style="color:#666;">${loc.pos || ''}</td>`;
            else if (col === 'std_id') html += `<td class="loc-copy-cell" onclick="copyLocationToClipboard(event, '${loc.id}')" title="클릭하여 복사 및 예약">${loc.id} ${badgeHtml}</td>`;
            else if (col === 'std_code') html += `<td style="color:#3d5afe; font-weight:bold;">${loc.code === loc.id ? '' : (loc.code || '')}</td>`;
            else if (col === 'std_name') html += `<td style="text-align:left;">${loc.name || ''}</td>`;
            else if (col === 'std_option') html += `<td style="text-align:left; font-size:12px;">${loc.option || ''}</td>`;
            else if (col === 'std_stock') html += `<td style="font-weight:bold;">${loc.stock || '0'}</td>`;
            else if (col.startsWith('cus_')) {
                const key = col.replace('cus_', '');
                let val = (loc.rawData && loc.rawData[key]) ? loc.rawData[key] : '';
                html += `<td>${val}</td>`;
            }
        });
        html += `</tr>`;
    });
    tbody.innerHTML = html || '<tr><td colspan="10" style="padding:50px;">데이터가 없습니다.</td></tr>';
}

const fileInputCombined = document.getElementById('excel-upload-combined');
if (fileInputCombined) {
    fileInputCombined.addEventListener('change', async function(e) {
        const files = e.target.files; if (files.length === 0) return;
        window.showLoading('데이터(직진/주차별)를 분석 및 동기화 중입니다...');
        try {
            let zikjinCount = 0; let weeklyCount = 0;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(new Uint8Array(e.target.result));
                    reader.onerror = e => reject(e);
                    reader.readAsArrayBuffer(file);
                });
                const workbook = XLSX.read(data, {type: 'array'});
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
                if (json.length === 0) continue;
                const headers = Object.keys(json[0]);
                const isWeekly = headers.includes('기간발주수량') || headers.includes('기간배송수량');
                const collectionName = isWeekly ? 'WeeklyData' : 'ZikjinData';
                if (isWeekly) weeklyCount++; else zikjinCount++;
                await updateDatabaseB(json, collectionName, null, true);
            }
            window.hideLoading();
            alert(`✅ 완료!\n(인식: 직진배송 ${zikjinCount}개 / 주차별 ${weeklyCount}개)`);
        } catch(error) { window.hideLoading(); alert('동기화 중 오류가 발생했습니다.'); console.error(error); } finally { fileInputCombined.value = ''; }
    });
}

const fileInputA = document.getElementById('excel-upload-a');
if (fileInputA) {
    fileInputA.addEventListener('change', function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('엑셀을 구역별로 압축 포장하여 동기화 중입니다... (속도 대폭 향상)');
        setTimeout(() => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
                if (json.length > 0) updateDatabaseA(json);
                else { window.hideLoading(); alert("데이터가 없습니다."); }
            };
            reader.readAsArrayBuffer(file);
        }, 50);
    });
}

async function updateDatabaseB(rows, collectionName, inputElement, silent = false) {
    let label = '데이터';
    if (collectionName === 'ZikjinData') label = '직진배송';
    if (collectionName === 'WeeklyData') label = '주차별';
    if (collectionName === 'IncomingData') label = '입고예정';
    try {
        const querySnapshot = await getDocs(collection(db2, collectionName));
        const docsArray = querySnapshot.docs;
        for (let i = 0; i < docsArray.length; i += 400) {
            const delBatch = writeBatch(db2);
            docsArray.slice(i, i + 400).forEach(d => delBatch.delete(d.ref));
            await delBatch.commit();
        }
        let batch = writeBatch(db2); let updateCount = 0; let batchCount = 0;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            let code = (row['어드민상품코드'] || row['상품코드'])?.toString().trim();
            if (!code) continue;
            const docRef = doc(db2, collectionName, code);
            batch.set(docRef, { ...row, updatedAt: new Date() }, { merge: true });
            updateCount++; batchCount++;
            if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db2); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        if (!silent) alert(`✅ [${label}] 업데이트 완료!\n총 ${updateCount}건이 반영되었습니다.`);
    } catch (error) { console.error(`${label} 실패:`, error); if (!silent) alert(`${label} 중 오류가 발생했습니다.`); throw error; } finally { if(inputElement && !silent) inputElement.value = ''; if (!silent) window.hideLoading(); }
}

async function updateDatabaseA(rows) {
    const totalRows = rows.length;
    try {
        const allHeaders = Object.keys(rows[0]);
        const exclude = ['동', 'dong', '위치', 'pos', '상품코드', '로케이션', '상품명', '옵션', '정상재고', '2층창고재고'];
        const customHeaders = allHeaders.filter(h => !exclude.includes(h));
        const newHeaders = [...new Set([...window.excelHeaders, ...customHeaders])];
        if (newHeaders.length > window.excelHeaders.length) {
            await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { excelHeaders: newHeaders }, { merge: true });
            window.excelHeaders = newHeaders;
        }
        
        let batch = writeBatch(db); 
        let updateCount = 0; 
        
        let zoneUpdates = {};
        
        for (let i = 0; i < totalRows; i++) {
            const row = rows[i]; 
            const rawLoc = row['로케이션']?.toString().trim();
            if (rawLoc) {
                let cleanLocId = ''; let extractedCode = '';
                if (rawLoc.includes('(')) {
                    cleanLocId = rawLoc.split('(')[0].trim();
                    const afterParen = rawLoc.substring(rawLoc.indexOf('('));
                    const sIndex = afterParen.indexOf('S');
                    if (sIndex !== -1) extractedCode = afterParen.substring(sIndex).trim();
                } else { cleanLocId = rawLoc; }
                
                if (cleanLocId) { 
                    const prefix = cleanLocId.charAt(0).toUpperCase();
                    const zoneDocId = 'ZONE_' + prefix;
                    
                    if (!zoneUpdates[zoneDocId]) zoneUpdates[zoneDocId] = {};
                    
                    const finalCode = extractedCode || row['상품코드']?.toString().trim() || '';
                    const existingData = originalData.find(d => d.id === cleanLocId) || {};
                    
                    let updateData = { reserved: false, reservedAt: 0, reservedBy: '', updatedAt: new Date(), rawData: row };
                    
                    if (finalCode && finalCode.trim() !== '') {
                        updateData.preAssigned = false;
                        updateData.preAssignedCode = '';
                        updateData.preAssignedName = '';
                        updateData.preAssignedQty = '';
                    }
                    
                    updateData.code = finalCode || '';
                    updateData.name = row['상품명']?.toString().trim() || '';
                    updateData.option = row['옵션']?.toString().trim() || '';
                    updateData.stock = row['정상재고']?.toString().trim() || '0';
                    
                    if ('동' in row || 'dong' in row) updateData.dong = row['동']?.toString().trim() || row['dong']?.toString().trim() || '';
                    else updateData.dong = existingData.dong || '';
                    
                    if ('위치' in row || 'pos' in row) updateData.pos = row['위치']?.toString().trim() || row['pos']?.toString().trim() || '';
                    else updateData.pos = existingData.pos || '';

                    updateData.stock2f = row['2층창고재고']?.toString().trim() || '0';
                    
                    zoneUpdates[zoneDocId][cleanLocId] = updateData;
                    updateCount++;
                }
            }
        }
        
        let batchCount = 0;
        for (let zoneId in zoneUpdates) {
            batch.set(doc(db, LOC_COLLECTION, zoneId), zoneUpdates[zoneId], { merge: true });
            batchCount++;
            if (batchCount >= 400) { 
                await batch.commit(); 
                batch = writeBatch(db); 
                batchCount = 0; 
            }
        }
        if (batchCount > 0) await batch.commit();
        
        alert(`✅ 완료! 구역별 묶음 방식으로 ${updateCount}개의 로케이션이 초고속 갱신되었습니다.`);
    } catch (error) { 
        console.error("실패:", error); 
        alert("업데이트 중 오류가 발생했습니다."); 
    } finally { 
        document.getElementById('excel-upload-a').value = ''; 
        window.hideLoading(); 
    }
}

window.copyLocationToClipboard = async (event, locId) => {
    event.stopPropagation(); 
    
    if (window.isPreAssignMode) {
        window.handleRowClick(event, locId);
        return;
    }
    
    try {
        const zoneDocId = 'ZONE_' + locId.charAt(0).toUpperCase();
        const docRef = doc(db, LOC_COLLECTION, zoneDocId);
        const snap = await getDoc(docRef);
        
        if (snap.exists() && snap.data()[locId]) {
            const data = snap.data()[locId]; 
            const now = new Date().getTime();
            const isReserved = data.reserved === true; 
            const reserverName = data.reservedBy || '다른 작업자';
            
            if (isReserved && reserverName === currentUserName) {
                if (confirm(`[${locId}] 내가 예약한 자리입니다.\n해제하시겠습니까?`)) {
                    await setDoc(docRef, { [locId]: { reserved: false, reservedAt: 0, reservedBy: '', assignedAt: 0, updatedAt: new Date() } }, { merge: true });
                    showToast(`[${locId}] 해제 완료`);
                } else { navigator.clipboard.writeText(locId); showToast(`[${locId}] 복사 완료!`); }
                return;
            }
            
            if (isReserved) {
                if (confirm(`[${locId}]은 현재 [${reserverName}]님이 사용 중입니다.\n강제로 예약을 가져오시겠습니까?`)) {
                    await setDoc(docRef, { [locId]: { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName, updatedAt: new Date() } }, { merge: true });
                    navigator.clipboard.writeText(locId); showToast(`[${locId}] 강제 복사 완료!`);
                }
                return; 
            }
            
            if (data.preAssigned) { 
                if (confirm(`📦 [${locId}]는 입고예정(${data.preAssignedCode}) 선지정 구역입니다.\n선지정을 해제(취소)하시겠습니까?`)) {
                    await setDoc(docRef, { [locId]: { preAssigned: false, preAssignedCode: '', preAssignedName: '', preAssignedQty: '', code: '', name: '', option: '', stock: '0', updatedAt: new Date() } }, { merge: true });
                    showToast(`[${locId}] 선지정 해제 완료!`);
                    return; 
                } else {
                    if (!confirm(`무시하고 일반 작업을 위해 예약(🔒)하시겠습니까?`)) return;
                }
            }
            
            await setDoc(docRef, { [locId]: { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName, updatedAt: new Date() } }, { merge: true });
            navigator.clipboard.writeText(locId).then(() => { showToast(`[${locId}] 복사 및 예약 완료!`); });
        }
    } catch (error) { alert('예약 처리 오류'); }
};

function showToast(message) {
    const toast = document.getElementById("toast");
    if(toast) { toast.innerText = message; toast.classList.add("show"); setTimeout(() => { toast.classList.remove("show"); }, 1500); }
}

window.toggleAllCheckboxes = (source) => {
    document.querySelectorAll('.loc-check').forEach(cb => cb.checked = source.checked);
};

window.addSingleLocationFromSetting = async () => {
    const inputObj = document.getElementById('setting-new-loc'); const newId = inputObj.value.trim().toUpperCase();
    if (!newId) return alert("로케이션 번호를 입력하세요.");
    try {
        const zoneDocId = 'ZONE_' + newId.charAt(0).toUpperCase();
        const docRef = doc(db, LOC_COLLECTION, zoneDocId); 
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data()[newId]) return alert(`이미 존재합니다.`);
        await setDoc(docRef, { [newId]: { dong: '', pos: '', code: '', name: '', option: '', stock: '0', reserved: false, reservedAt: 0, assignedAt: 0, reservedBy: '', updatedAt: new Date(), rawData: {} } }, { merge: true });
        inputObj.value = ''; alert(`✅ 추가 완료`); 
    } catch (error) { console.error(error); }
};

window.deleteSelectedLocations = async () => {
    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    if (checkedBoxes.length === 0) return alert("삭제할 대상을 선택하세요.");
    if (!confirm(`정말 삭제하시겠습니까?`)) return;
    try {
        let batch = writeBatch(db); let batchCount = 0;
        for (let i = 0; i < checkedBoxes.length; i++) {
            const locId = checkedBoxes[i].value;
            const zoneDocId = 'ZONE_' + locId.charAt(0).toUpperCase();
            batch.set(doc(db, LOC_COLLECTION, zoneDocId), { [locId]: deleteField() }, { merge: true });
            batchCount++;
            if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        alert(`🗑️ 삭제 완료`); 
    } catch (error) { console.error(error); }
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
    const unassignBtn = document.getElementById('btn-modal-unassign');
    unassignBtn.style.display = targetData.preAssigned ? 'inline-block' : 'none';
    document.getElementById('edit-modal').style.display = 'flex';
};

window.saveManualEdit = async () => {
    const id = document.getElementById('modal-id').value;
    const updateData = {
        dong: document.getElementById('modal-dong').value.trim(), pos: document.getElementById('modal-pos').value.trim(), code: document.getElementById('modal-code').value.trim(),
        name: document.getElementById('modal-name').value.trim(), option: document.getElementById('modal-option').value.trim(), stock: document.getElementById('modal-stock').value.trim(),
        reserved: false, reservedAt: 0, reservedBy: '', updatedAt: new Date()
    };
    try { 
        const zoneDocId = 'ZONE_' + id.charAt(0).toUpperCase();
        await setDoc(doc(db, LOC_COLLECTION, zoneDocId), { [id]: updateData }, { merge: true }); 
        document.getElementById('edit-modal').style.display = 'none'; 
    } catch (error) { console.error(error); }
};

window.cancelPreAssignment = async () => {
    const id = document.getElementById('modal-id').value;
    if(!confirm(`[${id}] 선지정을 취소하시겠습니까?`)) return;
    try {
        const zoneDocId = 'ZONE_' + id.charAt(0).toUpperCase();
        await setDoc(doc(db, LOC_COLLECTION, zoneDocId), { [id]: { preAssigned: false, preAssignedCode: '', preAssignedName: '', preAssignedQty: '', code: '', name: '', option: '', stock: '0', updatedAt: new Date() } }, { merge: true });
        document.getElementById('edit-modal').style.display = 'none';
        showToast("취소되었습니다.");
    } catch (error) { console.error(error); }
};

window.renderIncomingQueue = function() {
    const container = document.getElementById('incoming-list');
    if(!container) return;
    const filterSource = document.getElementById('filter-source')?.value || 'all';
    const sortType = document.getElementById('sort-incoming')?.value || 'qty-desc';

    let existingLocMap = {}; 
    originalData.forEach(loc => {
        if(loc.preAssigned && loc.preAssignedCode) existingLocMap[loc.preAssignedCode] = true;
        if(loc.code && loc.code !== loc.id) existingLocMap[loc.code] = true;
    });

    let list = [];
    for(let code in incomingData) { list.push(incomingData[code]); }

    list = list.filter(item => {
        if(filterSource !== 'all' && item.source !== filterSource) return false;
        if(existingLocMap[item['상품코드']]) return false; 
        
        if(!item['공장출고예상일'] || item['공장출고예상일'].toString().trim() === '') return false;
        
        return true;
    });

    list.sort((a, b) => {
        if(sortType === 'qty-desc') return Number(b['입고대기수량'] || 0) - Number(a['입고대기수량'] || 0);
        else if(sortType === 'date-asc') {
            let dA = a['공장출고예상일'] || '9999-99-99'; let dB = b['공장출고예상일'] || '9999-99-99';
            return dA.localeCompare(dB);
        }
        return 0;
    });

    let html = '';
    list.forEach(item => {
        let code = item['상품코드']; let qty = item['입고대기수량'] || 0;
        let name = item['상품명'] || ''; let date = item['공장출고예상일'] || '-';
        let src = item.source || '-';
        let option = item['옵션'] || '';
        html += `
            <div class="incoming-item" onclick="activatePreAssignMode('${code}', '${name.replace(/'/g, "\\'")}', '${qty}', '${option.replace(/'/g, "\\'")}')">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <div style="font-weight:bold; color:var(--primary); font-size:14px;">${code}</div>
                    <span style="font-size:10px; background:${src==='제작'?'#e3f2fd':'#fbe9e7'}; color:${src==='제작'?'#1976d2':'#d84315'}; padding:2px 5px; border-radius:3px; font-weight:bold;">${src}</span>
                </div>
                <div style="font-size:12px; color:#333; margin-bottom:6px;">${name}</div>
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
                    <span style="color:#555;">${src==='제작'?'출고일':'도착일'}: <b style="color:#d32f2f;">${date}</b></span>
                    <span style="color:#e65100; font-weight:bold; font-size:12px;">대기: ${qty}개</span>
                </div>
            </div>
        `;
    });
    container.innerHTML = html || '<div style="text-align:center; padding:30px; color:#888;">지정이 필요한 상품이 없습니다.</div>';
};

window.activatePreAssignMode = function(code, name, qty, option = '') {
    window.isPreAssignMode = true;
    window.selectedPreAssignItem = { code, name, qty, option };
    document.getElementById('pre-assign-banner-text').innerText = `${code} (${name})`;
    document.getElementById('pre-assign-banner').style.display = 'flex';
    if (window.innerWidth < 1100) document.getElementById('incoming-sidebar').classList.remove('open');
};

window.cancelPreAssignMode = function() {
    window.isPreAssignMode = false;
    window.selectedPreAssignItem = null;
    document.getElementById('pre-assign-banner').style.display = 'none';
};

window.addEventListener('keydown', function(e) { if (e.key === 'F5' || (e.ctrlKey && (e.key === 'r' || e.key === 'R'))) { e.preventDefault(); alert("🚨 실시간 동기화 중입니다."); } });
window.addEventListener('beforeunload', function(e) { e.preventDefault(); e.returnValue = ''; });
