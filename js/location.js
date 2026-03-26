import { initializeFirebase, loadAppConfig } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, writeBatch, getDocs, query, where, documentId, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const { db, auth } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

let originalData = []; 
let zikjinData = {}; 
let weeklyData = {}; 
let incomingData = {}; 
let sortConfig = { key: 'id', direction: 'asc' }; 
let filters = { loc: [], code: 'all', stock: 'all', dong: 'all', pos: 'all', reserved: 'all', preassigned: 'all' };

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

window.currentRecommendations = [];

window.recommendRatios = { zikjin: 50, weekly: 30, trend: 20 };
window.recommendPriorities = {
    zones: { 0: ['★'], 1: ['A','B','C','D','E','F','G','H','I'], 2: ['Z'], 3: ['L','M','N','O','P','Q','R','S','T'] },
    dongs: ['1', '2', '3', '4', '5', '6'],
    poses: ['2', '3', '4', '1', '5']
};

const getZoneDocId = (locId) => {
    if (!locId) return 'ZONE_ETC';
    const clean = locId.toString().trim().toUpperCase();
    const prefix = clean.length >= 6 ? clean.substring(0, 6) : clean;
    return 'ZONE_' + prefix;
};

const injectPuzzleStyle = () => {
    if(document.getElementById('puzzle-style')) return;
    const style = document.createElement('style');
    style.id = 'puzzle-style';
    style.innerHTML = `
        .puzzle-container { display: flex; flex-direction: column; gap: 6px; }
        .puzzle-row { display: flex; align-items: stretch; gap: 8px; }
        .puzzle-label { width: 70px; background: #e0e0e0; font-weight: bold; font-size: 12px; color: #333; display: flex; align-items: center; justify-content: center; border-radius: 6px; text-align: center; }
        .puzzle-drop-area { flex: 1; min-height: 42px; border: 2px dashed #bbb; border-radius: 6px; padding: 6px; display: flex; flex-wrap: wrap; gap: 5px; background: #fafafa; transition: 0.2s; }
        .puzzle-drop-area.dragover { background: #eef1ff; border-color: var(--primary); }
        .puzzle-block, .puzzle-sort-block { width: 28px; height: 28px; background: white; border: 2px solid #666; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; cursor: grab; box-shadow: 0 2px 4px rgba(0,0,0,0.1); user-select: none; transition: transform 0.1s; }
        .puzzle-sort-block { width: 34px; border-color: var(--primary); color: var(--primary); }
        .puzzle-block:active, .puzzle-sort-block:active { cursor: grabbing; transform: scale(1.1); }
        .puzzle-block.dragging, .puzzle-sort-block.dragging { opacity: 0.4; border: 2px dashed #999; }
        .sort-container { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; background: #f0f4ff; border-radius: 6px; border: 1px solid #c5cae9; min-height: 46px; align-items: center; }
        .section-toggle { background: #f1f1f1; padding: 10px 15px; border-radius: 6px; font-weight: bold; color: #333; display: flex; justify-content: space-between; cursor: pointer; border: 1px solid #ddd; transition: background 0.2s; }
        .section-toggle:hover { background: #e8e8e8; }
        .section-content { display: none; padding: 15px 5px 5px 5px; animation: slideDown 0.2s ease-out; }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
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
    onSnapshot(collection(db, 'ZikjinData'), (snapshot) => {
        zikjinData = {};
        snapshot.forEach(docSnap => { 
            let data = docSnap.data();
            if(data.dataStr) {
                try {
                    let chunk = JSON.parse(data.dataStr);
                    chunk.forEach(row => {
                        let code = (row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['품목코드'] || row['바코드'] || row['상품번호']);
                        if(code) zikjinData[code] = row;
                    });
                } catch(e){}
            }
        });
        applyFiltersAndSort();
    }, (error) => console.error("직진배송 오류:", error));

    onSnapshot(collection(db, 'WeeklyData'), (snapshot) => {
        weeklyData = {};
        snapshot.forEach(docSnap => { 
            let data = docSnap.data();
            if(data.dataStr) {
                try {
                    let chunk = JSON.parse(data.dataStr);
                    chunk.forEach(row => {
                        let code = (row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['품목코드'] || row['바코드'] || row['상품번호']);
                        if(code) weeklyData[code] = row;
                    });
                } catch(e){}
            }
        });
        applyFiltersAndSort();
    }, (error) => console.error("주차별데이터 오류:", error));
    
    onSnapshot(collection(db, 'IncomingData'), (snapshot) => {
        incomingData = {};
        snapshot.forEach(docSnap => { 
            let data = docSnap.data();
            if(data.dataStr) {
                try {
                    let chunk = JSON.parse(data.dataStr);
                    chunk.forEach(row => {
                        let code = (row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['품목코드'] || row['바코드'] || row['상품번호']);
                        if(code) incomingData[code] = row;
                    });
                } catch(e){}
            }
        });
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
            
            if (conf.recommendRatios) {
                let r = conf.recommendRatios;
                if ((r.zikjin + r.weekly + r.trend) === 100) window.recommendRatios = r;
            }
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
        
        let tempLocMap = {}; 
        
        snapshot.forEach(docSnap => {
            const zoneData = docSnap.data();
            for (let locId in zoneData) {
                if (typeof zoneData[locId] === 'object' && zoneData[locId] !== null) {
                    let locObj = { id: locId, ...zoneData[locId] };
                    
                    if (locObj.rawDataStr) {
                        try { locObj.rawData = JSON.parse(locObj.rawDataStr); } catch(e) { locObj.rawData = {}; }
                    } else if (!locObj.rawData) {
                        locObj.rawData = {};
                    }
                    
                    tempLocMap[locId] = locObj; 
                }
            }
        });
        
        originalData = Object.values(tempLocMap);
        
        // ★ codeTag 자정 초기화 체크
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        originalData.forEach(loc => {
            if (loc.codeTag && loc.codeTagAt && loc.codeTagAt < todayStart) {
                loc.codeTag = '';
                loc.codeTagAt = 0;
                // DB에서도 초기화 (비동기, 화면 렌더링 차단 안 함)
                const zoneDocId = getZoneDocId(loc.id);
                setDoc(doc(db, LOC_COLLECTION, zoneDocId), { [loc.id]: { codeTag: '', codeTagAt: 0 } }, { merge: true }).catch(() => {});
            }
        });
        
        renderTableHeader(); 
        applyFiltersAndSort(); 
        if(document.getElementById('incoming-sidebar').classList.contains('open')) window.renderIncomingQueue();
        
        // 도면 탭이 열려있으면 자동 재렌더링
        if (document.getElementById('view-map') && document.getElementById('view-map').style.display !== 'none') {
            window.renderMap();
        }
        
        const pop = document.getElementById('usage-popup');
        if (pop && pop.style.display === 'block') window.calculateAndRenderUsage();
    }, (error) => { console.error("A창고 오류:", error); });
}

window.onload = () => {
    injectPuzzleStyle();
    setupRealtimeListenerA();
    setupRealtimeListenerB();
};

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

window.handleSortDragOver = (e) => {
    e.preventDefault();
    const container = e.currentTarget;
    const dragging = document.querySelector('.puzzle-sort-block.dragging');
    if(!dragging) return;
    const afterElement = getDragAfterElement(container, e.clientX);
    if (afterElement == null) {
        container.appendChild(dragging);
    } else {
        container.insertBefore(dragging, afterElement);
    }
};
window.getDragAfterElement = (container, x) => {
    const draggableElements = [...container.querySelectorAll('.puzzle-sort-block:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
};

window.toggleSection = function(id, iconId) {
    const el = document.getElementById(id);
    const icon = document.getElementById(iconId);
    if(el.style.display === 'block') {
        el.style.display = 'none';
        icon.innerText = '▼';
    } else {
        el.style.display = 'block';
        icon.innerText = '▲';
    }
};

window.toggleUsageDetails = function() {
    const content = document.getElementById('usage-details-content');
    const btn = document.getElementById('usage-details-btn');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        btn.innerText = '간략히보기 ▲';
    } else {
        content.style.display = 'none';
        btn.innerText = '자세히보기 ▼';
    }
};

function updateExcludePreview() {
    const input = document.getElementById('exclude-combos-input');
    const preview = document.getElementById('exclude-combos-preview');
    if (!input || !preview) return;
    const combos = input.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (combos.length === 0) { preview.innerHTML = '<span style="font-size:11px; color:#999;">제외 항목 없음</span>'; return; }
    preview.innerHTML = combos.map(c => `<span style="display:inline-block; background:#ff5252; color:white; padding:3px 8px; border-radius:4px; font-size:12px; font-weight:bold;">❌ ${c}</span>`).join('');
}

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
                    <h2 style="margin:0; color:var(--primary); font-size:20px;">⚙️ 추천 알고리즘 설정</h2>
                    <button onclick="document.getElementById('ratio-settings-modal').style.display='none'" style="background:none; border:none; font-size:24px; cursor:pointer;">×</button>
                </div>

                <div style="background:#fcfcfc; border:1px solid #ddd; border-radius:8px; padding:15px; margin-bottom:15px;">
                    <h4 style="margin:0 0 10px 0; color:#333;">📊 점수 반영 비율 (총합 100%)</h4>
                    <div style="display:flex; justify-content:space-around; align-items:center; gap:5px;">
                        <label style="display:flex; flex-direction:column; align-items:center; font-size:12px; font-weight:bold;">
                            직진배송
                            <div style="margin-top:5px; display:flex; align-items:center;">
                                <input type="number" id="mod-ratio-zikjin" style="width:50px; text-align:right; padding:6px; border:1px solid #ccc; border-radius:4px; font-weight:bold;">
                                <span style="margin-left:4px; color:#555;">%</span>
                            </div>
                        </label>
                        <span style="font-size:20px; color:#aaa; margin-top:15px;">+</span>
                        <label style="display:flex; flex-direction:column; align-items:center; font-size:12px; font-weight:bold;">
                            주차별
                            <div style="margin-top:5px; display:flex; align-items:center;">
                                <input type="number" id="mod-ratio-weekly" style="width:50px; text-align:right; padding:6px; border:1px solid #ccc; border-radius:4px; font-weight:bold;">
                                <span style="margin-left:4px; color:#555;">%</span>
                            </div>
                        </label>
                        <span style="font-size:20px; color:#aaa; margin-top:15px;">+</span>
                        <label style="display:flex; flex-direction:column; align-items:center; font-size:12px; font-weight:bold;">
                            상승세
                            <div style="margin-top:5px; display:flex; align-items:center;">
                                <input type="number" id="mod-ratio-trend" style="width:50px; text-align:right; padding:6px; border:1px solid #ccc; border-radius:4px; font-weight:bold;">
                                <span style="margin-left:4px; color:#555;">%</span>
                            </div>
                        </label>
                    </div>
                </div>

                <div style="margin-bottom:10px;">
                    <div class="section-toggle" onclick="toggleSection('sec-zone', 'icon-zone')">
                        <span>🧩 구역(알파벳) 우선순위 배치</span>
                        <span id="icon-zone">▼</span>
                    </div>
                    <div id="sec-zone" class="section-content">
                        <p style="margin:0 0 10px 0; font-size:11px; color:#666;">※ 마우스로 알파벳 조각을 끌어서 원하는 순위 칸에 놓으세요.</p>
                        <div class="puzzle-container">
                            <div class="puzzle-row"><div class="puzzle-label" style="background:#ffd54f;">0순위</div><div class="puzzle-drop-area" id="pz-0" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div></div>
                            <div class="puzzle-row"><div class="puzzle-label" style="background:#81c784;">1순위</div><div class="puzzle-drop-area" id="pz-1" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div></div>
                            <div class="puzzle-row"><div class="puzzle-label" style="background:#64b5f6;">2순위</div><div class="puzzle-drop-area" id="pz-2" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div></div>
                            <div class="puzzle-row"><div class="puzzle-label" style="background:#ba68c8; color:white;">3순위</div><div class="puzzle-drop-area" id="pz-3" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div></div>
                            <div class="puzzle-row" style="margin-top:5px;"><div class="puzzle-label" style="background:#eee; border:1px solid #ccc;">미지정<br>(후순위)</div><div class="puzzle-drop-area" id="pz-none" style="background:#f0f0f0; border-color:#ccc;" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div></div>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom:20px;">
                    <div class="section-toggle" onclick="toggleSection('sec-dongpos', 'icon-dongpos')">
                        <span>🏢 동 / 위치 우선순위 줄세우기</span>
                        <span id="icon-dongpos">▼</span>
                    </div>
                    <div id="sec-dongpos" class="section-content">
                        <p style="margin:0 0 10px 0; font-size:11px; color:#666;">※ 마우스로 블록을 잡고 좌우로 끌어서 순서를 맞춰주세요. (왼쪽이 1순위)</p>
                        
                        <div style="font-size:13px; font-weight:bold; margin-bottom:5px; color:var(--primary);">▶ 동 우선순위</div>
                        <div class="sort-container" id="sort-dongs" ondragover="handleSortDragOver(event)"></div>

                        <div style="font-size:13px; font-weight:bold; margin-top:15px; margin-bottom:5px; color:var(--primary);">▶ 위치 우선순위</div>
                        <div class="sort-container" id="sort-poses" ondragover="handleSortDragOver(event)"></div>
                    </div>
                </div>

                <div style="margin-bottom:20px;">
                    <div class="section-toggle" onclick="toggleSection('sec-exclude', 'icon-exclude')">
                        <span>❌ 추천 제외 구역 설정</span>
                        <span id="icon-exclude">▼</span>
                    </div>
                    <div id="sec-exclude" class="section-content">
                        <p style="margin:0 0 10px 0; font-size:11px; color:#666;">※ 구역+동 조합을 입력하면 해당 조합의 로케이션이 추천에서 제외됩니다.<br>예시: Z-1, A-3, ★-2 (쉼표로 구분)</p>
                        <input type="text" id="exclude-combos-input" placeholder="예: Z-1, A-3, ★-2" style="width:100%; padding:10px; border:2px solid #ef9a9a; border-radius:6px; font-size:14px; background:#ffebee; box-sizing:border-box;">
                        <div id="exclude-combos-preview" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:5px;"></div>
                    </div>
                </div>
                
                <div style="display:flex; justify-content:center;">
                    <button onclick="saveMasterSettingsModal()" style="width:100%; padding:12px; font-size:16px; border:none; background:var(--primary); color:white; border-radius:6px; cursor:pointer; font-weight:bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">💾 변경사항 저장 및 즉시 재계산</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // ★ 제외 조합 입력 시 프리뷰 업데이트
        document.getElementById('exclude-combos-input').addEventListener('input', updateExcludePreview);
    }
    
    document.getElementById('mod-ratio-zikjin').value = window.recommendRatios.zikjin;
    document.getElementById('mod-ratio-weekly').value = window.recommendRatios.weekly;
    document.getElementById('mod-ratio-trend').value = window.recommendRatios.trend;
    
    const allAlphabets = ['★', 'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
    const priZones = window.recommendPriorities.zones || {0:[], 1:[], 2:[], 3:[]};
    for(let i=0; i<=3; i++) document.getElementById(`pz-${i}`).innerHTML = '';
    document.getElementById('pz-none').innerHTML = '';

    allAlphabets.forEach(alpha => {
        let placedRank = -1;
        for(let i=0; i<=3; i++) { if(priZones[i] && priZones[i].includes(alpha)) { placedRank = i; break; } }
        
        const block = document.createElement('div');
        block.className = 'puzzle-block';
        block.innerText = alpha;
        block.draggable = true;
        block.ondragstart = window.handleDragStart;
        block.ondragend = window.handleDragEnd;

        if(placedRank !== -1) document.getElementById(`pz-${placedRank}`).appendChild(block);
        else document.getElementById('pz-none').appendChild(block);
    });

    const renderSortBlocks = (containerId, items, defaultItems) => {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        let finalItems = [...new Set([...items, ...defaultItems])]; 
        finalItems.forEach(item => {
            const block = document.createElement('div');
            block.className = 'puzzle-sort-block';
            block.innerText = item;
            block.draggable = true;
            block.ondragstart = window.handleDragStart;
            block.ondragend = window.handleDragEnd;
            container.appendChild(block);
        });
    };

    renderSortBlocks('sort-dongs', window.recommendPriorities.dongs || [], ['1','2','3','4','5','6']);
    renderSortBlocks('sort-poses', window.recommendPriorities.poses || [], ['1','2','3','4','5']);

    // ★ 제외 조합 입력창 로드
    const excludeCombos = window.recommendPriorities.excludeCombos || [];
    document.getElementById('exclude-combos-input').value = excludeCombos.join(', ');
    updateExcludePreview();
    
    modal.style.display = 'flex';
};

window.saveMasterSettingsModal = async function() {
    const z = Number(document.getElementById('mod-ratio-zikjin').value) || 0;
    const w = Number(document.getElementById('mod-ratio-weekly').value) || 0;
    const t = Number(document.getElementById('mod-ratio-trend').value) || 0;
    if (z + w + t !== 100) return alert(`🚨 점수 반영 비율의 합계가 100%가 되어야 합니다.\n(현재 합계: ${z + w + t}%)`);
    
    let newZones = {};
    for(let i=0; i<=3; i++){
        const blocks = document.getElementById(`pz-${i}`).querySelectorAll('.puzzle-block');
        newZones[i] = Array.from(blocks).map(b => b.innerText.trim());
    }

    const newDongs = Array.from(document.getElementById('sort-dongs').querySelectorAll('.puzzle-sort-block')).map(b => b.innerText.trim());
    const newPoses = Array.from(document.getElementById('sort-poses').querySelectorAll('.puzzle-sort-block')).map(b => b.innerText.trim());

    // ★ 제외 조합 수집
    const excludeCombos = document.getElementById('exclude-combos-input').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    const newPriorities = { zones: newZones, dongs: newDongs, poses: newPoses, excludeCombos };

    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { 
            recommendRatios: { zikjin: z, weekly: w, trend: t },
            recommendPriorities: newPriorities
        }, { merge: true });
        
        window.recommendRatios = { zikjin: z, weekly: w, trend: t };
        window.recommendPriorities = newPriorities;
        
        document.getElementById('ratio-settings-modal').style.display = 'none';
        showToast("✅ 마스터 설정이 저장되었습니다.");
        
        const recModal = document.getElementById('recommend-modal');
        if (recModal && recModal.style.display === 'flex') window.showRecommendation();
    } catch(e) { console.error(e); alert("설정 저장 중 오류가 발생했습니다."); }
};

window.showRecommendation = function() {
    window.showLoading("💡 우선순위 알고리즘을 분석하여 최적의 로케이션을 매칭 중입니다...");

    setTimeout(() => {
        window.currentRecommendations = [];
        
        // ★ 로케이션에 실제 존재하는 상품코드만 대상
        const allCodes = new Set(
            originalData
                .filter(d => d.code && d.code.trim() !== '' && d.code !== d.id)
                .map(d => d.code.trim())
        );
        let maxZQty = 0; let maxWQty = 0; let maxTrend = 0;
        let itemDataList = [];

        allCodes.forEach(code => {
            let zItem = zikjinData[code] || {}; let wItem = weeklyData[code] || {};
            let locItem = originalData.find(d => d.code === code);
            let name = (locItem && locItem.name) || zItem['상품명'] || wItem['상품명'] || '알 수 없음';
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

        let emptyLocs = originalData.filter(d => {
            const hasContent = (d.code && d.code !== d.id && d.code.trim() !== "") || (d.name && d.name.trim() !== "");
            if (hasContent || d.preAssigned) return false;
            // ★ 구역+동 조합 제외
            const excludeCombos = window.recommendPriorities.excludeCombos || [];
            if (excludeCombos.length > 0) {
                const prefix = (d.id || '').charAt(0).toUpperCase();
                const dong = (d.dong || '').toString().trim();
                const combo = `${prefix}-${dong}`;
                if (excludeCombos.includes(combo)) return false;
            }
            return true;
        });

        const getZoneRank = (locId) => {
            const prefix = (locId || '').charAt(0).toUpperCase();
            const zones = window.recommendPriorities.zones || {};
            for(let i=0; i<=3; i++) {
                if(zones[i] && zones[i].includes(prefix)) return i;
            }
            return 99; 
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
            let zRankA = getZoneRank(a.id); let zRankB = getZoneRank(b.id);
            if (zRankA !== zRankB) return zRankA - zRankB;
            let dRankA = getDongRank(a.dong); let dRankB = getDongRank(b.dong);
            if (dRankA !== dRankB) return dRankA - dRankB;
            let pRankA = getPosRank(a.pos); let pRankB = getPosRank(b.pos);
            if (pRankA !== pRankB) return pRankA - pRankB;
            return a.id.localeCompare(b.id); 
        });

        const tbody = document.getElementById('recommend-tbody');
        let html = ''; 
        let matchCount = 0;
        let usedEmptyIndices = new Set();
        let displayRank = 1;

        for (let i = 0; i < scoredItems.length; i++) {
            let item = scoredItems[i];
            
            let currentLocsObjs = originalData.filter(d => d.code === item.code);
            let currentDongsList = currentLocsObjs.map(d => (d.dong || '').toString().trim());

            for (let j = 0; j < emptyLocs.length; j++) {
                if (usedEmptyIndices.has(j)) continue;
                
                let eLoc = emptyLocs[j];
                let targetDong = (eLoc.dong || '').toString().trim();

                if (currentDongsList.includes(targetDong)) {
                    break; 
                }

                usedEmptyIndices.add(j);
                
                let totalStock = 0;
                let totalStock2f = 0;
                let itemOption = '';
                
                currentLocsObjs.forEach(d => {
                    totalStock += Number(d.stock || 0);
                    totalStock2f += Number(d.stock2f || 0);
                    if (d.option && !itemOption) itemOption = d.option; 
                });
                
                if (!itemOption || itemOption.trim() === '') {
                    let fallbackOption = '';
                    if (zikjinData[item.code] && zikjinData[item.code]['옵션']) fallbackOption = zikjinData[item.code]['옵션'];
                    else if (weeklyData[item.code] && weeklyData[item.code]['옵션']) fallbackOption = weeklyData[item.code]['옵션'];
                    else if (incomingData[item.code] && incomingData[item.code]['옵션']) fallbackOption = incomingData[item.code]['옵션'];
                    
                    itemOption = fallbackOption;
                }

                let moveQty = totalStock - totalStock2f;
                
                // ✨ [방향 지시등 로직] 우선순위 점수 비교 계산
                let bestCurrentScore = 999999;
                if (currentLocsObjs.length > 0) {
                    currentLocsObjs.forEach(loc => {
                        let z = getZoneRank(loc.id);
                        let d = getDongRank(loc.dong);
                        let p = getPosRank(loc.pos);
                        let score = (z * 10000) + (d * 100) + p;
                        if (score < bestCurrentScore) bestCurrentScore = score;
                    });
                }

                let targetZ = getZoneRank(eLoc.id);
                let targetD = getDongRank(eLoc.dong);
                let targetP = getPosRank(eLoc.pos);
                let targetScore = (targetZ * 10000) + (targetD * 100) + targetP;

                let moveBadge = '';
                let moveText = '';
                if (currentLocsObjs.length === 0) {
                    moveBadge = `<span style="display:inline-block; background:#e3f2fd; color:#1565c0; padding:4px 9px; border-radius:5px; font-size:12px; font-weight:bold; margin-top:5px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">✨ 신규</span>`;
                    moveText = '✨신규';
                } else if (targetScore < bestCurrentScore) {
                    moveBadge = `<span style="display:inline-block; background:#ffebee; color:#b71c1c; padding:4px 9px; border-radius:5px; font-size:12px; font-weight:bold; margin-top:5px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">🔺 전진</span>`;
                    moveText = '🔺전진';
                } else if (targetScore > bestCurrentScore) {
                    moveBadge = `<span style="display:inline-block; background:#eceff1; color:#37474f; padding:4px 9px; border-radius:5px; font-size:12px; font-weight:bold; margin-top:5px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">🔻 후퇴</span>`;
                    moveText = '🔻후퇴';
                } else {
                    moveBadge = `<span style="display:inline-block; background:#f5f5f5; color:#616161; padding:4px 9px; border-radius:5px; font-size:12px; font-weight:bold; margin-top:5px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">➖ 수평</span>`;
                    moveText = '➖수평';
                }
                
                window.currentRecommendations.push({
                    moveQty: moveQty,
                    currentLocs: item.currentLocs,
                    targetLoc: eLoc.id,
                    name: item.name,
                    option: itemOption,
                    code: item.code,
                    moveDirection: moveText // 엑셀용
                });

                const isEven = displayRank % 2 === 0;
                const rowBg = isEven ? '#f9fafb' : '#ffffff';
                const moveQtyDisplay = moveQty > 0 ? `<span style="color:#e65100; font-weight:900; font-size:15px;">${moveQty.toLocaleString()}</span><br><span style="font-size:10px; color:#888;">개</span>` : `<span style="color:#bbb; font-size:12px;">-</span>`;

                html += `
                    <tr style="background:${rowBg};">
                        <td style="color:var(--primary); font-weight:900; font-size:15px; border-left:none; padding:14px 10px;">
                            ${displayRank}위
                            <br><span style="font-size:11px; color:#e65100; font-weight:bold;">${item.score.toFixed(1)}점</span>
                        </td>
                        <td style="font-weight:bold; color:#1a237e; font-size:13px; letter-spacing:0.3px;">${item.code}</td>
                        <td style="text-align:left; font-size:14px; font-weight:bold; color:#212121; padding:14px 12px; line-height:1.5;">${item.name}</td>
                        <td style="text-align:center; padding:14px 8px;">${moveQtyDisplay}</td>
                        <td style="color:#555; font-size:12px; padding:14px 10px;">${item.currentLocs}</td>
                        <td style="background:#f1f8e9; border-right:none; padding:14px 12px; text-align:center;">
                            <span style="color:#1b5e20; font-weight:900; font-size:16px;">${eLoc.id}</span><br>
                            ${moveBadge}<br>
                            <span style="font-size:11px; color:#555; margin-top:3px; display:inline-block;">${eLoc.dong}동 ${eLoc.pos}위치</span>
                        </td>
                    </tr>
                `;
                displayRank++;
                matchCount++;
                break; 
            }
        }

        if (matchCount === 0) {
            html += '<tr><td colspan="6" style="padding:40px;">데이터가 부족하거나 추천할 빈 로케이션이 없습니다.<br>(또는 이미 모든 상품이 최적의 동에 배치되어 있습니다)</td></tr>';
        }

        tbody.innerHTML = html;
        window.hideLoading();
        document.getElementById('recommend-modal').style.display = 'flex';

    }, 500); 
};

// ✨ [엑셀 다운로드 함수]
window.downloadRecommendationExcel = function() {
    if (!window.currentRecommendations || window.currentRecommendations.length === 0) {
        alert("다운로드할 추천 데이터가 없습니다.");
        return;
    }

    const excelData = window.currentRecommendations.map(item => {
        return {
            "이동방향": item.moveDirection,
            "이동수량": item.moveQty,
            "현재로케이션": item.currentLocs,
            "변경로케이션": item.targetLoc,
            "상품명": item.name,
            "옵션": item.option,
            "상품코드": item.code
        };
    });

    const ws = XLSX.utils.json_to_sheet(excelData);
    
    ws['!cols'] = [
        { wch: 12 }, // 이동방향
        { wch: 10 }, // 이동수량
        { wch: 20 }, // 현재로케이션
        { wch: 15 }, // 변경로케이션
        { wch: 40 }, // 상품명
        { wch: 25 }, // 옵션
        { wch: 15 }  // 상품코드
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "로케이션변경추천");
    
    const today = new Date();
    const dateString = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    
    XLSX.writeFile(wb, `로케이션변경추천리스트_${dateString}.xlsx`);
};

// ========================================
// ★ 2F 이동 추천 기능
// ========================================
window.current2FList = [];

window.show2FRecommendation = function() {
    document.getElementById('modal-2f').style.display = 'flex';
};

window.toggle2FCheckAll = function(source) {
    document.querySelectorAll('.check-2f-item').forEach(cb => cb.checked = source.checked);
};

window.calc2FList = function() {
    const periodVal = Number(document.getElementById('2f-period-value').value) || 1;
    const periodUnit = document.getElementById('2f-period-unit').value;
    const stockLimit = Number(document.getElementById('2f-stock-limit').value) || 999999;

    const now = new Date();
    let cutoffDate;
    if (periodUnit === 'week') {
        cutoffDate = new Date(now.getTime() - (periodVal * 7 * 24 * 60 * 60 * 1000));
    } else {
        cutoffDate = new Date(now.getFullYear(), now.getMonth() - periodVal, now.getDate());
    }
    const cutoffStr = cutoffDate.toISOString().slice(0, 10).replace(/-/g, '-');

    // 상품코드별로 그룹핑
    const codeMap = {};
    originalData.forEach(loc => {
        const code = loc.code;
        if (!code || code.trim() === '' || code === loc.id) return;
        if (!codeMap[code]) codeMap[code] = [];
        codeMap[code].push(loc);
    });

    window.current2FList = [];
    const tbody = document.getElementById('2f-tbody');

    for (const code in codeMap) {
        const locs = codeMap[code];
        const firstLoc = locs[0];
        
        // rawData에서 키를 유연하게 찾는 헬퍼
        const getRawVal = (rd, targetKey) => {
            if (!rd) return '';
            if (rd[targetKey]) return rd[targetKey];
            const norm = targetKey.replace(/[\s\u00A0]/g, '');
            for (const k of Object.keys(rd)) {
                if (k.replace(/[\s\u00A0]/g, '') === norm) return rd[k];
            }
            return '';
        };

        // 마지막배송일 찾기 (마지막배송일 우선, 없으면 마지막입고일)
        let lastDelivery = '';
        for (const loc of locs) {
            let val = getRawVal(loc.rawData, '마지막배송일');
            if (!val) val = getRawVal(loc.rawData, '마지막입고일');
            if (val && val > lastDelivery) lastDelivery = val;
        }

        // 마지막배송일이 없으면 대상에 포함 (배송 기록 없음 = 오래된 것)
        // 마지막배송일이 있으면 cutoff 이전인지 확인
        if (lastDelivery && lastDelivery > cutoffStr) continue;

        // 정상재고 합산
        let totalStock = 0;
        locs.forEach(l => totalStock += Number(l.stock || 0));
        if (totalStock > stockLimit) continue;

        // 옵션추가항목1 값 가져오기
        let extraOpt = '';
        for (const loc of locs) {
            const val = getRawVal(loc.rawData, '옵션추가항목1');
            if (val) { extraOpt = val; break; }
        }

        const locIds = locs.map(l => l.id).join(', ');
        const name = firstLoc.name || '';
        const option = firstLoc.option || '';
        
        // 변경값: 2F-코드 옵션추가항목1값
        const changeValue = `2F-${code}${extraOpt ? ' ' + extraOpt : ''}`;

        window.current2FList.push({
            code, name, option, totalStock, lastDelivery: lastDelivery || '기록없음',
            locIds, locs, changeValue, extraOpt
        });
    }

    // 마지막배송일 오래된 순 정렬 (기록없음이 맨 위)
    window.current2FList.sort((a, b) => {
        if (a.lastDelivery === '기록없음' && b.lastDelivery !== '기록없음') return -1;
        if (a.lastDelivery !== '기록없음' && b.lastDelivery === '기록없음') return 1;
        return a.lastDelivery.localeCompare(b.lastDelivery);
    });

    let html = '';
    window.current2FList.forEach((item, idx) => {
        const rowBg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
        html += `
            <tr style="background:${rowBg};">
                <td><input type="checkbox" class="check-2f-item" data-idx="${idx}"></td>
                <td style="font-weight:bold; color:#7b1fa2;">${idx + 1}</td>
                <td style="font-weight:bold; color:#1a237e;">${item.code}</td>
                <td style="text-align:left; font-size:13px;">${item.name}</td>
                <td style="font-size:12px;">${item.option}</td>
                <td style="font-weight:bold;">${item.totalStock}</td>
                <td style="font-size:12px; color:${item.lastDelivery === '기록없음' ? '#ff5252' : '#555'};">${item.lastDelivery}</td>
                <td style="font-size:12px;">${item.locIds}</td>
                <td style="background:#f3e5f5; font-weight:bold; color:#4a148c; font-size:12px;">${item.changeValue}</td>
            </tr>
        `;
    });

    if (window.current2FList.length === 0) {
        html = '<tr><td colspan="9" style="padding:40px; color:#888;">조건에 해당하는 상품이 없습니다.</td></tr>';
    }

    tbody.innerHTML = html;
    document.getElementById('2f-check-all').checked = false;
};

window.download2FExcel = function() {
    if (!window.current2FList || window.current2FList.length === 0) {
        alert("다운로드할 데이터가 없습니다. 먼저 조회해주세요.");
        return;
    }

    // 체크된 항목이 있으면 선택만, 없으면 전체 다운로드
    const checked = document.querySelectorAll('.check-2f-item:checked');
    let targetList;
    let fileLabel;
    if (checked.length > 0) {
        const indices = Array.from(checked).map(cb => Number(cb.dataset.idx));
        targetList = indices.map(i => window.current2FList[i]).filter(Boolean);
        fileLabel = `2F이동추천_선택${targetList.length}건`;
    } else {
        targetList = window.current2FList;
        fileLabel = `2F이동추천_전체${targetList.length}건`;
    }

    const excelData = targetList.map((item, idx) => ({
        "No": idx + 1,
        "상품코드": item.code,
        "상품명": item.name,
        "옵션": item.option,
        "정상재고": item.totalStock,
        "마지막배송일": item.lastDelivery,
        "현재위치": item.locIds,
        "변경값": item.changeValue
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    ws['!cols'] = [
        { wch: 5 }, { wch: 15 }, { wch: 40 }, { wch: 25 },
        { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 30 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "2F이동추천");
    const today = new Date();
    const dateString = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, `${fileLabel}_${dateString}.xlsx`);
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
        else if (col === 'std_stock2f') { html += createTh('stock2f', '2층창고재고', 130, true); popupHtml += `<div id="pop-stock2f" class="filter-popup"></div>`; }
        else if (col.startsWith('cus_')) {
            const label = col.replace('cus_', '');
            html += createTh(col, label, 120, true);
            popupHtml += `<div id="pop-${col}" class="filter-popup"></div>`;
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
        { id: 'std_code', label: '상품코드' }, { id: 'std_name', label: '상품명' }, { id: 'std_option', label: '옵션' }, { id: 'std_stock', label: '정상재고' }, { id: 'std_stock2f', label: '2층창고재고' }
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
    if (!window.sheetUrlOrder && !window.sheetUrlBuy) return alert("구글시트 링크가 설정되지 않았습니다.\n[⚙️ 링크 설정] 에서 시트 링크를 저장해주세요.");
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
    filters = { loc: [], code: 'all', stock: 'all', dong: 'all', pos: 'all', reserved: 'all', preassigned: 'all' };
    if (zone !== 'all') filters.loc = [zone];
    if (state === 'used') filters.code = 'not-empty';
    else if (state === 'empty') filters.code = 'empty';
    else if (state === 'reserved') filters.reserved = 'only';
    else if (state === 'preassigned') filters.preassigned = 'only';
    setupFilterPopups();
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    // 리스트 탭으로 전환
    document.getElementById('view-list').style.display = 'block';
    document.getElementById('view-map').style.display = 'none';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.tab-btn')?.classList.add('active');
    // reserved/preassigned 필터 시 초기화 버튼 표시
    window.showFilterResetBtn();
};

window.calculateAndRenderUsage = function() {
    const popup = document.getElementById('usage-popup');
    if (!popup) return;
    let html = `<div style="display:flex; gap:10px; margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;"><button onclick="switchUsageTab('3F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; background:${window.currentUsageTab === '3F' ? 'var(--primary)' : '#eee'}; color:${window.currentUsageTab === '3F' ? 'white' : '#555'}">3층 로케이션</button><button onclick="switchUsageTab('2F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; background:${window.currentUsageTab === '2F' ? 'var(--primary)' : '#eee'}; color:${window.currentUsageTab === '2F' ? 'white' : '#555'}">2층 창고재고</button></div>`;

    if (window.currentUsageTab === '3F') {
        const locations = originalData.filter(d => d.id.charAt(0).toUpperCase() !== 'K');
        let total = locations.length;
        if (total === 0) { popup.innerHTML = html + '<div style="padding: 10px;">데이터가 없습니다.</div>'; return; }
        
        let used = 0; 
        let zoneStats = {};
        let dongStats = {};
        let posStats = {};
        let todayReservedCount = 0;
        let preAssignedCount = 0; 
        
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        locations.forEach(loc => {
            const isUsed = (loc.code && loc.code.trim() !== '' && loc.code !== loc.id) || (loc.name && loc.name.trim() !== '');
            if (isUsed) used++;
            if (loc.codeTag === '당일지정') todayReservedCount++;
            if (loc.codeTag === '선지정') preAssignedCount++;
            
            const zone = loc.id.charAt(0).toUpperCase();
            if (!zoneStats[zone]) { zoneStats[zone] = { total: 0, used: 0 }; }
            zoneStats[zone].total++;
            if (isUsed) zoneStats[zone].used++;
            
            const dong = (loc.dong || '').toString().trim();
            if (dong) {
                if (!dongStats[dong]) dongStats[dong] = { total: 0, used: 0 };
                dongStats[dong].total++;
                if (isUsed) dongStats[dong].used++;
            }
            
            const pos = (loc.pos || '').toString().trim();
            if (pos) {
                if (!posStats[pos]) posStats[pos] = { total: 0, used: 0 };
                posStats[pos].total++;
                if (isUsed) posStats[pos].used++;
            }
        });

        const usageRate = ((used / total) * 100).toFixed(1);
        
        html += `
            <div style="display:flex; justify-content: space-around; background: #eef1ff; padding: 10px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #c5cae9;">
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#555; font-weight:bold;">당일지정수량</div>
                    <div style="font-size:18px; color:var(--primary); font-weight:900;">${todayReservedCount}</div>
                </div>
                <div style="width:1px; background:#ccc;"></div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#555; font-weight:bold;">선지정수량</div>
                    <div style="font-size:18px; color:#e65100; font-weight:900;">${preAssignedCount}</div>
                </div>
            </div>
            <div style="font-size:16px; font-weight:bold; margin-bottom:5px; color:var(--primary); text-align:center;">📊 3층 전체 사용률: ${usageRate}%</div>
            <div style="font-size:12px; color:#333; text-align:center;">전체 ${total}칸 중 <span style="color:var(--primary); font-weight:bold;">${used}칸 사용</span> / <span style="color:#ff5252; font-weight:bold;">${total - used}칸 빈칸</span></div>
            <div style="text-align:center; margin-top:10px;">
                <span onclick="toggleUsageDetails()" id="usage-details-btn" style="color:var(--primary); font-size:13px; text-decoration:underline; cursor:pointer; font-weight:bold;">자세히보기 ▼</span>
            </div>
        `;
        
        let detailHtml = `<div id="usage-details-content" style="display:none; margin-top:15px; border-top:1px solid #eee; padding-top:15px;">`;
        detailHtml += `<div style="font-size:11px; color:#888; text-align:center; margin-bottom:10px;">※ 숫자를 클릭하면 리스트에 해당 내용만 보입니다.</div>`;
        
        detailHtml += `<div style="font-size:13px; font-weight:bold; margin-bottom:5px; color:var(--primary);">▶ 구역별 사용률</div>`;
        detailHtml += `<table class="usage-table" style="width:100%; margin-bottom:15px;"><thead><tr><th>구역명</th><th>총 칸수</th><th>사용중</th><th>빈칸</th><th>사용률</th></tr></thead><tbody>`;
        const zones = Object.keys(zoneStats).sort((a,b) => (a==='★'?-1:(b==='★'?1:a.localeCompare(b))));
        zones.forEach(z => {
            const zTotal = zoneStats[z].total; const zUsed = zoneStats[z].used; const zEmpty = zTotal - zUsed; const zRate = ((zUsed / zTotal) * 100).toFixed(1);
            detailHtml += `<tr><td><strong>${z}</strong> 구역</td><td>${zTotal}</td><td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${z}', 'used')">${zUsed}</td><td style="color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${z}', 'empty')">${zEmpty}</td><td>${zRate}%</td></tr>`;
        });
        detailHtml += `</tbody></table>`;

        detailHtml += `<div style="font-size:13px; font-weight:bold; margin-bottom:5px; color:var(--primary);">▶ 동별 사용률</div>`;
        detailHtml += `<table class="usage-table" style="width:100%; margin-bottom:15px;"><thead><tr><th>동</th><th>총 칸수</th><th>사용중</th><th>빈칸</th><th>사용률</th></tr></thead><tbody>`;
        const dongs = Object.keys(dongStats).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
        dongs.forEach(d => {
            const dTotal = dongStats[d].total; const dUsed = dongStats[d].used; const dEmpty = dTotal - dUsed; const dRate = ((dUsed / dTotal) * 100).toFixed(1);
            detailHtml += `<tr><td><strong>${d}</strong> 동</td><td>${dTotal}</td><td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="setFilter('dong', '${d}'); applyUsageFilter('all', 'used')">${dUsed}</td><td style="color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="setFilter('dong', '${d}'); applyUsageFilter('all', 'empty')">${dEmpty}</td><td>${dRate}%</td></tr>`;
        });
        detailHtml += `</tbody></table>`;

        detailHtml += `<div style="font-size:13px; font-weight:bold; margin-bottom:5px; color:var(--primary);">▶ 위치별 사용률</div>`;
        detailHtml += `<table class="usage-table" style="width:100%;"><thead><tr><th>위치</th><th>총 칸수</th><th>사용중</th><th>빈칸</th><th>사용률</th></tr></thead><tbody>`;
        const poses = Object.keys(posStats).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
        poses.forEach(p => {
            const pTotal = posStats[p].total; const pUsed = posStats[p].used; const pEmpty = pTotal - pUsed; const pRate = ((pUsed / pTotal) * 100).toFixed(1);
            detailHtml += `<tr><td><strong>${p}</strong> 위치</td><td>${pTotal}</td><td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="setFilter('pos', '${p}'); applyUsageFilter('all', 'used')">${pUsed}</td><td style="color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="setFilter('pos', '${p}'); applyUsageFilter('all', 'empty')">${pEmpty}</td><td>${pRate}%</td></tr>`;
        });
        detailHtml += `</tbody></table>`;
        detailHtml += `</div>`; 

        html += detailHtml;

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
            if (type === 'code') {
                const active = filters.code !== 'all' || filters.reserved === 'only' || filters.preassigned === 'only';
                if (active) btn.classList.add('active'); else btn.classList.remove('active');
            } else {
                if (filters[type] === 'all') btn.classList.remove('active');
                else btn.classList.add('active');
            }
        }
    });

    // 커스텀 헤더 필터 버튼 활성 상태
    window.visibleColumns.forEach(col => {
        if (!col.startsWith('cus_')) return;
        const btn = document.getElementById('btn-filter-' + col);
        if (btn) {
            if (!filters[col] || filters[col] === 'all') btn.classList.remove('active');
            else btn.classList.add('active');
        }
    });
}

function setupFilterPopups() {
    const codePop = document.getElementById('pop-code'); const namePop = document.getElementById('pop-name');
    const optionPop = document.getElementById('pop-option'); const stockPop = document.getElementById('pop-stock');
    const dongPop = document.getElementById('pop-dong'); const posPop = document.getElementById('pop-pos');
    
    updateLocPopupUI();
    
    const isReservedOnly = filters.reserved === 'only';
    const isPreassignedOnly = filters.preassigned === 'only';
    const codeAll = filters.code === 'all' && !isReservedOnly && !isPreassignedOnly;
    let codeHtml = getSortButtonsHtml('code') +
        `<div class="filter-option ${codeAll ? 'selected' : ''}" onclick="setCodeTagFilter('all')">${codeAll ? '✔️ ' : ''}전체보기</div>` +
        `<div class="filter-option ${filters.code === 'empty' ? 'selected' : ''}" onclick="setCodeTagFilter('empty')">${filters.code === 'empty' ? '✔️ ' : ''}빈칸</div>` +
        `<div class="filter-option ${filters.code === 'not-empty' ? 'selected' : ''}" onclick="setCodeTagFilter('not-empty')">${filters.code === 'not-empty' ? '✔️ ' : ''}내용있음</div>` +
        `<div class="filter-divider"></div>` +
        `<div class="filter-option ${isReservedOnly ? 'selected' : ''}" onclick="setCodeTagFilter('당일지정')">${isReservedOnly ? '✔️ ' : ''}📌 당일지정</div>` +
        `<div class="filter-option ${isPreassignedOnly ? 'selected' : ''}" onclick="setCodeTagFilter('선지정')">${isPreassignedOnly ? '✔️ ' : ''}📦 선지정</div>`;
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
    const stock2fPop = document.getElementById('pop-stock2f');
    const stocks2f = [...new Set(originalData.map(d => (d.stock2f || '0').toString()))].sort((a, b) => Number(a) - Number(b));
    let stock2fHtml = getSortButtonsHtml('stock2f') + `<div class="filter-option ${filters.stock2f === 'all' ? 'selected' : ''}" onclick="setFilter('stock2f', 'all')">${filters.stock2f === 'all' ? '✔️ ' : ''}전체보기</div>`;
    stocks2f.forEach(s => { stock2fHtml += `<div class="filter-option ${filters.stock2f === s ? 'selected' : ''}" onclick="setFilter('stock2f', '${s}')">${filters.stock2f === s ? '✔️ ' : ''}${s}</div>`; });
    if(stock2fPop) stock2fPop.innerHTML = stock2fHtml;

    updateFilterButtonStates();

    // 커스텀 헤더 필터 팝업 생성
    window.visibleColumns.forEach(col => {
        if (!col.startsWith('cus_')) return;
        const pop = document.getElementById(`pop-${col}`);
        if (!pop) return;
        const key = col.replace('cus_', '');
        const curVal = filters[col] || 'all';

        // ★ 옵션추가항목1: 빈칸/내용있음 전용 필터
        if (key === '옵션추가항목1') {
            let html = getSortButtonsHtml(col) +
                `<div class="filter-option ${curVal === 'all' ? 'selected' : ''}" onclick="setFilter('${col}', 'all')">${curVal === 'all' ? '✔️ ' : ''}전체보기</div>` +
                `<div class="filter-option ${curVal === 'empty' ? 'selected' : ''}" onclick="setFilter('${col}', 'empty')">${curVal === 'empty' ? '✔️ ' : ''}빈칸</div>` +
                `<div class="filter-option ${curVal === 'not-empty' ? 'selected' : ''}" onclick="setFilter('${col}', 'not-empty')">${curVal === 'not-empty' ? '✔️ ' : ''}내용있음</div>`;
            pop.innerHTML = html;
            return;
        }

        const vals = [...new Set(originalData.map(d => {
            return (d.rawData && d.rawData[key]) ? d.rawData[key].toString().trim() : '';
        }))].filter(Boolean).sort();

        let html = getSortButtonsHtml(col) +
            `<div class="filter-option ${curVal === 'all' ? 'selected' : ''}" onclick="setFilter('${col}', 'all')">${curVal === 'all' ? '✔️ ' : ''}전체보기</div>`;

        // ★ 입고대기: 빈칸 옵션 추가
        if (key === '입고대기') {
            html += `<div class="filter-option ${curVal === 'empty' ? 'selected' : ''}" onclick="setFilter('${col}', 'empty')">${curVal === 'empty' ? '✔️ ' : ''}빈칸</div>`;
        }

        vals.forEach(v => {
            const escaped = v.replace(/'/g, "\\'");
            html += `<div class="filter-option ${curVal === v ? 'selected' : ''}" onclick="setFilter('${col}', '${escaped}')">${curVal === v ? '✔️ ' : ''}${v}</div>`;
        });
        pop.innerHTML = html;
    });
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
    window.showFilterResetBtn();
};
window.setFilter = (type, value) => { 
    filters[type] = value; 
    setupFilterPopups(); 
    applyFiltersAndSort(); 
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    window.showFilterResetBtn();
};
window.setCodeTagFilter = (mode) => {
    if (mode === '당일지정') {
        filters.code = 'all'; filters.reserved = 'only'; filters.preassigned = 'all';
    } else if (mode === '선지정') {
        filters.code = 'all'; filters.reserved = 'all'; filters.preassigned = 'only';
    } else if (mode === 'empty') {
        filters.code = 'empty'; filters.reserved = 'all'; filters.preassigned = 'all';
    } else if (mode === 'not-empty') {
        filters.code = 'not-empty'; filters.reserved = 'all'; filters.preassigned = 'all';
    } else {
        filters.code = 'all'; filters.reserved = 'all'; filters.preassigned = 'all';
    }
    setupFilterPopups();
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    window.showFilterResetBtn();
};

window.showFilterResetBtn = function() {
    // 필터 초기화 버튼 비활성화
    let btn = document.getElementById('filter-reset-btn');
    if (btn) btn.style.display = 'none';
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
        if (filters.stock2f && filters.stock2f !== 'all' && (item.stock2f || '0').toString() !== filters.stock2f) return false;
        if (filters.reserved === 'only' && item.codeTag !== '당일지정') return false;
        if (filters.preassigned === 'only' && item.codeTag !== '선지정') return false;
        // 커스텀 헤더 필터
        for (const col in filters) {
            if (!col.startsWith('cus_') || filters[col] === 'all') continue;
            const key = col.replace('cus_', '');
            const val = (item.rawData && item.rawData[key]) ? item.rawData[key].toString().trim() : '';
            // ★ 빈칸/내용있음 필터 지원
            if (filters[col] === 'empty') { if (val !== '') return false; }
            else if (filters[col] === 'not-empty') { if (val === '') return false; }
            else { if (val !== filters[col]) return false; }
        }
        return true;
    });
    filtered.sort((a, b) => {
        let aVal, bVal;
        if (sortConfig.key.startsWith('cus_')) {
            const key = sortConfig.key.replace('cus_', '');
            aVal = (a.rawData && a.rawData[key]) ? a.rawData[key].toString() : '';
            bVal = (b.rawData && b.rawData[key]) ? b.rawData[key].toString() : '';
        } else {
            aVal = a[sortConfig.key] || ''; bVal = b[sortConfig.key] || '';
        }
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
        
        const zoneDocId = getZoneDocId(locId);

        if (loc.preAssigned) { 
            if (loc.preAssignedCode === window.selectedPreAssignItem.code) {
                if (confirm(`이미 '${loc.preAssignedCode}' 상품으로 선지정된 자리입니다.\n지정을 해제(취소)하시겠습니까?`)) {
                    await setDoc(doc(db, LOC_COLLECTION, zoneDocId), {
                        [locId]: { preAssigned: false, preAssignedCode: '', preAssignedName: '', preAssignedQty: '', preAssignedAt: 0, codeTag: '', codeTagAt: 0, code: '', name: '', option: '', stock: '0', updatedAt: new Date() }
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
                    preAssignedAt: Date.now(),
                    code: window.selectedPreAssignItem.code, name: window.selectedPreAssignItem.name,
                    option: window.selectedPreAssignItem.option || '', stock: window.selectedPreAssignItem.qty.toString(), 
                    reserved: false, reservedBy: '', reservedAt: 0,
                    codeTag: '선지정', codeTagAt: Date.now(),
                    updatedAt: new Date()
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
        let rowStyle = ''; 
        let codeTagHtml = '';
        
        if (loc.codeTag === '당일지정') { 
            rowStyle = 'background-color: #fffde7 !important;';
            codeTagHtml = `<br><span style="color:#1565c0; font-size:10px; font-weight:bold; background:#e3f2fd; padding:1px 5px; border-radius:3px;">📌 당일지정</span>`;
        } else if (loc.codeTag === '선지정') {
            rowStyle = 'background-color: #ffe0b2 !important;';
            codeTagHtml = `<br><span style="color:#e65100; font-size:10px; font-weight:bold; background:#fff3e0; padding:1px 5px; border-radius:3px;">📦 선지정</span>`;
        }
        
        let isChecked = checkedIds.has(loc.id) ? 'checked' : '';
        html += `<tr onclick="handleRowClick(event, '${loc.id}')" style="${rowStyle}">`;
        html += `<td onclick="event.stopPropagation()"><input type="checkbox" class="loc-check" value="${loc.id}" ${isChecked}></td>`;
        window.visibleColumns.forEach(col => {
            if (col === 'std_dong') html += `<td style="color:#666;">${loc.dong || ''}</td>`;
            else if (col === 'std_pos') html += `<td style="color:#666;">${loc.pos || ''}</td>`;
            else if (col === 'std_id') html += `<td class="loc-copy-cell" onclick="copyLocationToClipboard(event, '${loc.id}')" title="클릭하여 복사 및 예약">${loc.id}</td>`;
            else if (col === 'std_code') html += `<td style="color:#3d5afe; font-weight:bold;">${loc.code === loc.id ? '' : (loc.code || '')}${codeTagHtml}</td>`;
            else if (col === 'std_name') html += `<td style="text-align:left;">${loc.name || ''}</td>`;
            else if (col === 'std_option') html += `<td style="text-align:left; font-size:12px;">${loc.option || ''}</td>`;
            else if (col === 'std_stock') html += `<td style="font-weight:bold;">${loc.stock || '0'}</td>`;
            else if (col === 'std_stock2f') html += `<td style="font-weight:bold;">${loc.stock2f || '0'}</td>`;
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

const extractDataFromHTML = function(htmlString) {
    const parser = new DOMParser();
    const cleanHtml = htmlString.replace(/<br\s*[\/]?>/gi, " ");
    const doc = parser.parseFromString(cleanHtml, 'text/html');
    const rows = doc.querySelectorAll('tr');
    
    let rawData = [];
    for (let i = 0; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll('th, td');
        let rowData = [];
        for (let j = 0; j < cells.length; j++) {
            rowData.push(cells[j].innerText.trim());
        }
        if (rowData.length > 0) rawData.push(rowData);
    }
    return rawData;
};

const smartParseToJSON = function(rawData) {
    if (!rawData || rawData.length === 0) return [];

    let headerRowIndex = -1;
    let pureHeaders = [];

    for (let i = 0; i < Math.min(30, rawData.length); i++) {
        const row = rawData[i];
        if (!row || !Array.isArray(row)) continue;
        const cleanRow = row.map(h => (h || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, ''));
        
        if (cleanRow.includes('상품코드') || cleanRow.includes('어드민상품코드') || 
            cleanRow.includes('대표상품코드') || cleanRow.includes('품목코드') || 
            cleanRow.includes('바코드') || cleanRow.includes('로케이션')) {
            headerRowIndex = i;
            pureHeaders = row.map(h => (h || '').toString().replace(/\s+/g, '')); 
            break;
        }
    }

    if (headerRowIndex === -1) {
        headerRowIndex = 0;
        pureHeaders = (rawData[0] || []).map(h => (h || '').toString().replace(/\s+/g, ''));
    } 

    const parsedList = [];
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || !Array.isArray(row)) continue;
        
        let rowObj = {};
        let isEmpty = true;
        
        for (let j = 0; j < pureHeaders.length; j++) {
            const key = pureHeaders[j];
            if (key && key !== '') {
                let val = row[j];
                if (val !== undefined && val !== "") {
                    rowObj[key] = val;
                    isEmpty = false;
                }
            }
        }
        if (!isEmpty) parsedList.push(rowObj);
    }
    return parsedList;
};

const universalExcelReader = (file) => {
    return new Promise((resolve) => {
        const bufferReader = new FileReader();
        bufferReader.onload = (eBuf) => {
            let json = [];
            try {
                const data = new Uint8Array(eBuf.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
                json = smartParseToJSON(rawData);
            } catch(e) {}

            const isValid = json.some(row => row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['로케이션'] || row['품목코드'] || row['바코드']);
            if (json.length > 0 && isValid) {
                return resolve(json);
            }

            const textReader = new FileReader();
            textReader.onload = (eTxt) => {
                let text = eTxt.target.result;
                if (text.includes('<table') || text.includes('<TABLE') || text.includes('<html') || text.includes('<meta')) {
                    try {
                        const rawData = extractDataFromHTML(text); 
                        const utfJson = smartParseToJSON(rawData);
                        const isValidUtf = utfJson.some(row => row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['로케이션'] || row['품목코드'] || row['바코드']);
                        if (utfJson.length > 0 && isValidUtf) {
                            return resolve(utfJson);
                        }
                    } catch(err) {}
                }

                const eucReader = new FileReader();
                eucReader.onload = (eEuc) => {
                    try {
                        let eucText = eEuc.target.result;
                        const rawData = extractDataFromHTML(eucText); 
                        resolve(smartParseToJSON(rawData));
                    } catch(err) {
                        resolve([]);
                    }
                };
                eucReader.readAsText(file, 'euc-kr');
            };
            textReader.readAsText(file, 'utf-8');
        };
        bufferReader.readAsArrayBuffer(file);
    });
};

const fileInputZikjin = document.getElementById('excel-upload-zikjin');
if (fileInputZikjin) {
    fileInputZikjin.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('직진배송 데이터를 분석 중입니다...');
        try {
            const json = await universalExcelReader(file);
            if(json.length > 0) await updateDatabaseB(json, 'ZikjinData', e.target, false);
            else { window.hideLoading(); alert("데이터가 없습니다. (파일 형식 또는 헤더 확인)"); e.target.value=''; }
        } catch(err) { window.hideLoading(); alert("오류 발생"); e.target.value=''; }
    });
}

const fileInputWeekly = document.getElementById('excel-upload-weekly');
if (fileInputWeekly) {
    fileInputWeekly.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('주차별 데이터를 분석 중입니다...');
        try {
            const json = await universalExcelReader(file);
            if(json.length > 0) await updateDatabaseB(json, 'WeeklyData', e.target, false);
            else { window.hideLoading(); alert("데이터가 없습니다. (파일 형식 또는 헤더 확인)"); e.target.value=''; }
        } catch(err) { window.hideLoading(); alert("오류 발생"); e.target.value=''; }
    });
}

const fileInputA = document.getElementById('excel-upload-a');
if (fileInputA) {
    fileInputA.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('일일 재고/상품 데이터를 최신화 중입니다...');
        try {
            const json = await universalExcelReader(file);
            if(json.length > 0) await updateDatabaseA(json, 'daily');
            else { window.hideLoading(); alert("데이터가 없습니다."); }
        } catch(err) { window.hideLoading(); alert("오류 발생"); }
        finally { e.target.value=''; }
    });
}

const fileInputPerm = document.getElementById('excel-upload-permanent');
if (fileInputPerm) {
    fileInputPerm.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('도면(동/위치) 영구 데이터를 덮어쓰기 세팅 중입니다...');
        try {
            const json = await universalExcelReader(file);
            if(json.length > 0) await updateDatabaseA(json, 'permanent');
            else { window.hideLoading(); alert("데이터가 없습니다."); }
        } catch(err) { window.hideLoading(); alert("오류 발생"); }
        finally { e.target.value=''; }
    });
}

async function updateDatabaseB(rows, collectionName, inputElement, silent = false) {
    let label = collectionName === 'ZikjinData' ? '직진배송' : (collectionName === 'WeeklyData' ? '주차별' : '데이터');
    try {
        const querySnapshot = await getDocs(collection(db, collectionName));
        let delBatch = writeBatch(db);
        querySnapshot.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
        
        const validRows = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            let code = (row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['품목코드'] || row['바코드'] || row['상품번호'])?.toString().trim();
            if (code) validRows.push(row); 
        }

        let batch = writeBatch(db); 
        const CHUNK_SIZE = 1500;
        let chunkCount = 0;

        for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
            const chunk = validRows.slice(i, i + CHUNK_SIZE);
            const docRef = doc(db, collectionName, `CHUNK_${chunkCount}`);
            batch.set(docRef, { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            chunkCount++;
        }
        
        if (chunkCount > 0) await batch.commit();
        
        if (!silent) alert(`✅ [${label}] 압축 저장 완료!\n총 ${validRows.length}건이 단 ${chunkCount}번의 쓰기로 반영되었습니다.`);
        
    } catch (error) { 
        console.error(`${label} 실패:`, error); 
        if (!silent) alert(`${label} 중 오류가 발생했습니다.`); 
        throw error; 
    } finally { 
        if(inputElement && !silent) inputElement.value = ''; 
        if (!silent) window.hideLoading(); 
    }
}

async function updateDatabaseA(rows, mode = 'daily') {
    const totalRows = rows.length;
    try {
        // ★ 모든 행의 키를 합쳐서 전체 헤더 추출 (첫 행에 빈 값이면 키가 누락되는 문제 해결)
        const allHeadersSet = new Set();
        rows.forEach(row => { Object.keys(row).forEach(k => allHeadersSet.add(k)); });
        const allHeaders = [...allHeadersSet];
        const excludeRaw = ['동', 'dong', '위치', 'pos', '상품코드', '로케이션', '상품명', '옵션', '정상재고', '2층창고재고'];
        // 공백제거 버전도 제외 목록에 포함
        const exclude = [...new Set([...excludeRaw, ...excludeRaw.map(h => h.replace(/\s+/g, ''))])];
        
        const customHeaders = allHeaders.filter(h => {
            const clean = h.replace(/\s+/g, '');
            return clean !== '' && 
                   !h.toUpperCase().includes('EMPTY') &&
                   !exclude.includes(h) &&
                   !exclude.includes(clean);
        });
        
        const newHeaders = [...new Set([...window.excelHeaders, ...customHeaders])];
        const hasNewHeader = customHeaders.some(h => !window.excelHeaders.includes(h));
        
        // ★ 디버그 로그
        console.log('=== [DEBUG] 최신화 ===');
        console.log('allHeaders:', allHeaders.length, '개 →', allHeaders);
        console.log('customHeaders:', customHeaders.length, '개 →', customHeaders);
        
        if (hasNewHeader) {
            await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { excelHeaders: newHeaders }, { merge: true });
            window.excelHeaders = newHeaders;
        }
        
        let batch = writeBatch(db); 
        let updateCount = 0; 
        let skipCount = 0;
        let zoneUpdates = {};
        
        let existingLocMap = {};
        originalData.forEach(d => { existingLocMap[d.id] = d; });
        
        if (mode === 'daily') {
            originalData.forEach(loc => {
                const zoneDocId = getZoneDocId(loc.id);
                if (!zoneUpdates[zoneDocId]) zoneUpdates[zoneDocId] = {};
                
                zoneUpdates[zoneDocId][loc.id] = {
                    dong: loc.dong || '',
                    pos: loc.pos || '',
                    code: '',
                    name: '',
                    option: '',
                    stock: '0',
                    stock2f: '0',
                    reserved: false,
                    reservedAt: 0,
                    reservedBy: '',
                    assignedAt: 0,
                    updatedAt: new Date(),
                    rawDataStr: '{}',
                    rawData: deleteField(),
                    preAssigned: loc.preAssigned || false,
                    preAssignedCode: loc.preAssignedCode || '',
                    preAssignedName: loc.preAssignedName || '',
                    preAssignedQty: loc.preAssignedQty || '',
                    preAssignedAt: loc.preAssignedAt || 0,
                    codeTag: loc.codeTag || '',
                    codeTagAt: loc.codeTagAt || 0
                };
            });
        }
        
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
                    if (!existingLocMap[cleanLocId]) {
                        skipCount++;
                        continue; 
                    }

                    const zoneDocId = getZoneDocId(cleanLocId);
                    if (!zoneUpdates[zoneDocId]) zoneUpdates[zoneDocId] = {};
                    
                    const finalCode = extractedCode || row['상품코드']?.toString().trim() || '';
                    const existingData = existingLocMap[cleanLocId] || {};
                    
                    let cleanRawData = {};
                    customHeaders.forEach(k => {
                        // 엑셀 파싱 키와 customHeader 키 매칭 (공백/특수문자 무시)
                        const normalizeKey = (s) => (s || '').toString().replace(/[\s\u00A0\u200B\uFEFF]/g, '');
                        const normK = normalizeKey(k);
                        
                        // row에서 직접 매칭 시도
                        let rawVal = row[k];
                        if (rawVal === undefined) rawVal = row[normK];
                        
                        // 그래도 없으면 row의 모든 키를 정규화해서 비교
                        if (rawVal === undefined) {
                            for (const rowKey of Object.keys(row)) {
                                if (normalizeKey(rowKey) === normK) {
                                    rawVal = row[rowKey];
                                    break;
                                }
                            }
                        }
                        
                        if(rawVal !== undefined && rawVal !== null && rawVal.toString().trim() !== "") {
                            const strVal = rawVal.toString().trim();
                            const numVal = parseFloat(strVal);
                            if(!isNaN(numVal) && numVal > 40000 && numVal < 60000 && strVal.includes('.')) {
                                cleanRawData[k] = formatExcelDate(numVal);
                            } else if(!isNaN(numVal) && Number.isInteger(numVal) && numVal > 40000 && numVal < 60000) {
                                cleanRawData[k] = formatExcelDate(numVal);
                            } else {
                                cleanRawData[k] = strVal;
                            }
                        }
                    });

                    let updateData = zoneUpdates[zoneDocId][cleanLocId] || { 
                        dong: existingData.dong || '',
                        pos: existingData.pos || '',
                        reserved: false, 
                        reservedAt: 0, 
                        reservedBy: '',
                        assignedAt: 0,
                        preAssigned: existingData.preAssigned || false,
                        preAssignedCode: existingData.preAssignedCode || '',
                        preAssignedName: existingData.preAssignedName || '',
                        preAssignedQty: existingData.preAssignedQty || '',
                        preAssignedAt: existingData.preAssignedAt || 0,
                        codeTag: existingData.codeTag || '',
                        codeTagAt: existingData.codeTagAt || 0
                    };

                    updateData.updatedAt = new Date();
                    updateData.rawDataStr = JSON.stringify(cleanRawData);
                    updateData.rawData = deleteField();
                    
                    if (mode === 'permanent') {
                        updateData.dong = ('동' in row || 'dong' in row) ? (row['동'] || row['dong'] || '').toString().trim() : (existingData.dong || '');
                        updateData.pos = ('위치' in row || 'pos' in row) ? (row['위치'] || row['pos'] || '').toString().trim() : (existingData.pos || '');
                        updateData.code = existingData.code || '';
                        updateData.name = existingData.name || '';
                        updateData.option = existingData.option || '';
                        updateData.stock = existingData.stock || '0';
                        updateData.stock2f = existingData.stock2f || '0';
                    } else {
                        updateData.code = finalCode || '';
                        updateData.name = row['상품명']?.toString().trim() || '';
                        updateData.option = row['옵션']?.toString().trim() || '';
                        updateData.stock = row['정상재고']?.toString().trim() || '0';
                        updateData.stock2f = row['2층창고재고']?.toString().trim() || '0';
                        
                        if (finalCode && finalCode.trim() !== '') {
                            updateData.preAssigned = false;
                            updateData.preAssignedCode = '';
                            updateData.preAssignedName = '';
                            updateData.preAssignedQty = '';
                            updateData.preAssignedAt = 0;
                        }
                    }
                    
                    zoneUpdates[zoneDocId][cleanLocId] = updateData;
                    updateCount++;
                }
            }
        }
        
        let currentBatchLocCount = 0;
        for (let zoneId in zoneUpdates) {
            const zoneData = zoneUpdates[zoneId];
            
            batch.set(doc(db, LOC_COLLECTION, zoneId), zoneData, { merge: true });
            currentBatchLocCount++;
            
            if (currentBatchLocCount >= 200) { 
                await batch.commit(); 
                batch = writeBatch(db); 
                currentBatchLocCount = 0; 
            }
        }
        if (currentBatchLocCount > 0) {
            await batch.commit();
        }
        
        if (mode === 'permanent') {
            alert(`✅ 완료! ${updateCount}개 로케이션의 랙 구조(동/위치) 영구 세팅이 완료되었습니다.`);
        } else {
            let msg = `✅ 스마트 클린 업데이트 완료!\n과거 유령 재고는 완벽히 비워졌고, 엑셀의 최신 데이터 ${updateCount}건만 정확하게 반영되었습니다.`;
            if(skipCount > 0) msg += `\n(※ 기존 도면에 없는 낯선 로케이션 ${skipCount}건 무시됨)`;
            alert(msg);
        }
        
    } catch (error) { 
        console.error("실패:", error); 
        alert("업데이트 중 오류가 발생했습니다. (콘솔 확인)"); 
    } finally { 
        if(document.getElementById('excel-upload-a')) document.getElementById('excel-upload-a').value = ''; 
        if(document.getElementById('excel-upload-permanent')) document.getElementById('excel-upload-permanent').value = ''; 
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
        const zoneDocId = getZoneDocId(locId);
        const docRef = doc(db, LOC_COLLECTION, zoneDocId);
        const snap = await getDoc(docRef);
        
        if (snap.exists() && snap.data()[locId]) {
            const data = snap.data()[locId]; 
            const now = new Date().getTime();
            const isReserved = data.reserved === true; 
            const reserverName = data.reservedBy || '다른 작업자';
            
            if (isReserved && reserverName === currentUserName) {
                if (confirm(`[${locId}] 내가 예약한 자리입니다.\n해제하시겠습니까?`)) {
                    await setDoc(docRef, { [locId]: { reserved: false, reservedAt: 0, reservedBy: '', assignedAt: 0, codeTag: '', codeTagAt: 0, updatedAt: new Date() } }, { merge: true });
                    showToast(`[${locId}] 해제 완료`);
                } else { navigator.clipboard.writeText(locId); showToast(`[${locId}] 복사 완료!`); }
                return;
            }
            
            if (isReserved) {
                if (confirm(`[${locId}]은 현재 [${reserverName}]님이 사용 중입니다.\n강제로 예약을 가져오시겠습니까?`)) {
                    await setDoc(docRef, { [locId]: { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName, codeTag: '당일지정', codeTagAt: now, updatedAt: new Date() } }, { merge: true });
                    navigator.clipboard.writeText(locId); showToast(`[${locId}] 강제 복사 완료!`);
                }
                return; 
            }
            
            if (data.preAssigned) { 
                // 선지정 자리: 예약(복사)만 진행, codeTag는 선지정 유지
                await setDoc(docRef, { [locId]: { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName, updatedAt: new Date() } }, { merge: true });
                navigator.clipboard.writeText(locId).then(() => { showToast(`[${locId}] 복사 및 예약 완료! (선지정 유지)`); });
                return;
            }
            
            await setDoc(docRef, { [locId]: { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName, codeTag: '당일지정', codeTagAt: now, updatedAt: new Date() } }, { merge: true });
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
        const zoneDocId = getZoneDocId(newId);
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
            const zoneDocId = getZoneDocId(locId);
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
        const zoneDocId = getZoneDocId(id);
        await setDoc(doc(db, LOC_COLLECTION, zoneDocId), { [id]: updateData }, { merge: true }); 
        document.getElementById('edit-modal').style.display = 'none'; 
    } catch (error) { console.error(error); }
};

window.cancelPreAssignment = async () => {
    const id = document.getElementById('modal-id').value;
    if(!confirm(`[${id}] 선지정을 취소하시겠습니까?`)) return;
    try {
        const zoneDocId = getZoneDocId(id);
        await setDoc(doc(db, LOC_COLLECTION, zoneDocId), { [id]: { preAssigned: false, preAssignedCode: '', preAssignedName: '', preAssignedQty: '', preAssignedAt: 0, codeTag: '', codeTagAt: 0, code: '', name: '', option: '', stock: '0', updatedAt: new Date() } }, { merge: true });
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


// =============================
// 🗺️ 도면 보기 (거리뷰)
// =============================
let currentCorridorIdx = 0;
let svCorridorList = [];

window.updateMapCellSize = function(val) {
    document.getElementById('map-cell-size-label').innerText = val + 'px';
    renderCorridor(currentCorridorIdx);
};

window.renderMap = function() {
    const mapBody = document.getElementById('map-body');
    const tabContainer = document.getElementById('map-zone-tabs');

    if (!originalData || originalData.length === 0) {
        mapBody.innerHTML = '<div style="text-align:center;padding:60px;color:#aaa;">⏳ Firebase에서 데이터를 불러오는 중입니다.<br>잠시 후 자동으로 표시됩니다.</div>';
        tabContainer.innerHTML = '';
        return;
    }

    // 구역+동 조합 목록 수집
    // ★구역은 동 없이 단독, 일반구역은 구역+동 조합으로 탭 구성
    svCorridorList = [];

    const zoneSet = new Set();
    originalData.forEach(d => zoneSet.add(d.id.charAt(0).toUpperCase()));
    const zones = [...zoneSet].sort((a, b) => {
        if (a === '★') return -1;
        if (b === '★') return 1;
        return a.localeCompare(b);
    });

    zones.forEach(zone => {
        svCorridorList.push({ zone, label: zone === '★' ? '★★ 구역' : `${zone}구역` });
    });

    // 탭 렌더링
    tabContainer.innerHTML = '';
    svCorridorList.forEach((item, i) => {
        const btn = document.createElement('button');
        btn.id = `sv-tab-${i}`;
        btn.innerText = item.label;
        btn.style.cssText = `padding:6px 14px; border-radius:20px; font-size:13px; font-weight:bold; border:1.5px solid #ccc; background:#f5f5f5; color:#333; cursor:pointer; transition:0.2s;`;
        btn.onclick = () => {
            currentCorridorIdx = i;
            renderCorridor(i);
            document.querySelectorAll('#map-zone-tabs button').forEach(b => {
                b.style.background = '#f5f5f5'; b.style.color = '#333'; b.style.borderColor = '#ccc';
            });
            btn.style.background = '#3d5afe'; btn.style.color = 'white'; btn.style.borderColor = '#3d5afe';
        };
        tabContainer.appendChild(btn);
    });

    currentCorridorIdx = 0;
    if (svCorridorList.length > 0) document.getElementById('sv-tab-0').click();
};

function renderCorridor(idx) {
    const mapBody = document.getElementById('map-body');
    const item = svCorridorList[idx];
    if (!item) return;

    const isStarZone = item.zone === '★';
    const cellSize = document.getElementById('map-cell-size') ? Number(document.getElementById('map-cell-size').value) : 54;

    // 셀 공통 함수
    function hasContent(loc) {
        return loc && ((loc.code && loc.code !== loc.id && loc.code.trim() !== '') || (loc.name && loc.name.trim() !== ''));
    }
    function cellStyle(loc) {
        if (!loc) return 'background:#f0f0f0; border:1px dashed #ddd;';
        if (loc.preAssigned) return 'background:#ffe0b2; border:1.5px solid #fb8c00;';
        if (loc.reserved) return 'background:#fff9c4; border:1.5px solid #f9a825;';
        if (hasContent(loc)) return 'background:#c8e6c9; border:1.5px solid #66bb6a;';
        return 'background:#f0f0f0; border:1px solid #ccc;';
    }
    function cellInner(loc) {
        if (!loc) return '';
        const nameText = hasContent(loc) ? (loc.name || loc.code || '') : '';
        const nameColor = hasContent(loc) ? '#1b5e20' : '#999';
        const idFontSize = Math.max(7, Math.floor(cellSize / 8));
        const nameFontSize = Math.max(10, Math.floor(cellSize / 5));
        const maxChars = Math.max(4, Math.floor((cellSize - 6) / (nameFontSize * 0.55)));
        const displayName = nameText.substring(0, maxChars) || '빈칸';
        return `<div style="font-size:${idFontSize}px;color:#bbb;line-height:1.1;">${loc.id}</div>
                <div style="font-size:${nameFontSize}px;font-weight:bold;color:${nameColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:${cellSize - 4}px;text-align:center;line-height:1.3;">${displayName}</div>`;
    }
    function tooltipHtml(loc) {
        if (!loc) return '';
        const isReserved = loc.reserved === true;
        const isPreAssigned = loc.preAssigned === true;
        let status = '빈칸';
        if (isPreAssigned) status = '📦 선지정';
        else if (isReserved) status = `🔒 예약중 (${loc.reservedBy || ''})`;
        else if (hasContent(loc)) status = '✅ 사용중';
        const tipId = 'tip-' + (loc.id || '').replace(/[^a-zA-Z0-9]/g, '_');
        return `<div id="${tipId}" style="position:fixed;background:white;border:1px solid #ccc;border-radius:8px;padding:10px 12px;
            white-space:nowrap;pointer-events:none;font-size:12px;line-height:1.7;
            box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:99999;display:none;" class="sv-tip">
            <div style="font-weight:bold;color:#3d5afe;">${loc.id}</div>
            <div style="color:#555;">${status}</div>
            ${hasContent(loc) ? `<div style="color:#333;"><b>상품명</b>: ${loc.name || '-'}</div><div style="color:#1976d2;"><b>재고</b>: ${loc.stock || '0'}개</div>` : ''}
            ${isPreAssigned ? `<div style="color:#bf360c;"><b>선지정코드</b>: ${loc.preAssignedCode || '-'}</div>` : ''}
        </div>`;
    }
    function getCell(locs, pos, num) {
        return locs.find(d => {
            const m = d.id.match(/(\d+)$/);
            return (d.pos || '').toString().trim() === pos && m && parseInt(m[1]) === num;
        }) || null;
    }

    function buildRackSection(locs, numsByPos, posLabels, posKey, cellSize) {
        let html = `<div style="padding:8px 8px;display:flex;flex-direction:column;gap:4px;">`;
        posLabels.forEach(pos => {
            const posNums = (numsByPos[pos] && numsByPos[pos][posKey]) || [];
            html += `<div style="display:flex;flex-direction:row;align-items:center;gap:3px;">
                <div style="font-size:10px;font-weight:bold;color:#bbb;min-width:18px;text-align:center;">${pos}</div>`;
            posNums.forEach(num => {
                const loc = getCell(locs, pos, num);
                if (!loc) {
                    html += `<div style="width:${cellSize}px;height:${cellSize + 6}px;${cellStyle(null)}border-radius:4px;"></div>`;
                    return;
                }
                const tid = 'tip-' + (loc.id || '').replace(/[^a-zA-Z0-9]/g, '_');
                html += `<div style="position:relative;"
                    onmouseenter="(function(e){var t=document.getElementById('${tid}');if(!t)return;t.style.display='block';var r=e.currentTarget.getBoundingClientRect();var tw=t.offsetWidth||160;var th=t.offsetHeight||100;var x=r.left+r.width/2-tw/2;var y=r.top-th-8;if(y<8)y=r.bottom+8;if(x+tw>window.innerWidth-8)x=window.innerWidth-tw-8;if(x<8)x=8;t.style.left=x+'px';t.style.top=y+'px';})(event)"
                    onmouseleave="(function(){var t=document.getElementById('${tid}');if(t)t.style.display='none';})()">
                    <div style="width:${cellSize}px;height:${cellSize + 6}px;${cellStyle(loc)}border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;padding:3px;transition:transform 0.1s;"
                        onmouseenter="this.style.transform='scale(1.06)'" onmouseleave="this.style.transform='scale(1)'">
                        ${cellInner(loc)}
                    </div>${tooltipHtml(loc)}</div>`;
            });
            html += '</div>';
        });
        html += '</div>';
        return html;
    }

    let bodyHtml = '';

    if (isStarZone) {
        const allLocs = originalData.filter(d => d.id.charAt(0) === '★')
            .sort((a, b) => parseInt((a.id.match(/\d+$/) || [0])[0]) - parseInt((b.id.match(/\d+$/) || [0])[0]));
        const half = Math.ceil(allLocs.length / 2);
        const topLocs = allLocs.slice(0, half);
        const botLocs = allLocs.slice(half);

        // ★★구역 cellSize는 슬라이더 값 사용

        function starRow(locs) {
            const idFontSize = Math.max(7, Math.floor(cellSize / 8));
            const nameFontSize = Math.max(10, Math.floor(cellSize / 5));
            const maxChars = Math.max(4, Math.floor((cellSize - 6) / (nameFontSize * 0.55)));
            let h = `<div style="padding:8px;display:flex;flex-wrap:wrap;gap:3px;">`;
            locs.forEach(loc => {
                const tid = 'tip-' + (loc.id || '').replace(/[^a-zA-Z0-9]/g, '_');
                const nameText = hasContent(loc) ? (loc.name || loc.code || '') : '';
                const nameColor = hasContent(loc) ? '#1b5e20' : '#999';
                const displayName = nameText.substring(0, maxChars) || '빈칸';
                h += `<div style="position:relative;"
                    onmouseenter="(function(e){var t=document.getElementById('${tid}');if(!t)return;t.style.display='block';var r=e.currentTarget.getBoundingClientRect();var tw=t.offsetWidth||160;var th=t.offsetHeight||100;var x=r.left+r.width/2-tw/2;var y=r.top-th-8;if(y<8)y=r.bottom+8;if(x+tw>window.innerWidth-8)x=window.innerWidth-tw-8;if(x<8)x=8;t.style.left=x+'px';t.style.top=y+'px';})(event)"
                    onmouseleave="(function(){var t=document.getElementById('${tid}');if(t)t.style.display='none';})()">
                    <div style="width:${cellSize}px;height:${cellSize+6}px;${cellStyle(loc)}border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;padding:3px;transition:transform 0.1s;"
                        onmouseenter="this.style.transform='scale(1.06)'" onmouseleave="this.style.transform='scale(1)'">
                        <div style="font-size:${idFontSize}px;color:#bbb;line-height:1.1;">${loc.id}</div>
                        <div style="font-size:${nameFontSize}px;font-weight:bold;color:${nameColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:${cellSize-4}px;text-align:center;line-height:1.3;">${displayName}</div>
                    </div>${tooltipHtml(loc)}</div>`;
            });
            h += '</div>';
            return h;
        }

        bodyHtml = `
            <div style="border:1px solid #ddd;border-radius:10px;overflow:hidden;">
                <div style="background:#f4f4f4;padding:6px 16px;font-size:13px;font-weight:bold;color:#3d5afe;border-bottom:1px solid #ddd;">★★ 구역</div>
                ${starRow(topLocs)}
                <div style="display:flex;align-items:center;justify-content:center;gap:12px;background:#fafafa;padding:7px 16px;border-top:1px solid #eee;border-bottom:1px solid #eee;">
                    <div style="font-size:11px;color:#ccc;letter-spacing:4px;">← ← ←</div>
                    <div style="font-size:11px;color:#bbb;font-weight:bold;">★★ 통로</div>
                    <div style="font-size:11px;color:#ccc;letter-spacing:4px;">→ → →</div>
                </div>
                ${starRow(botLocs)}
            </div>`;
    } else {
        // 일반구역: 동별로 섹션 나눠서 표시
        const dongSet = new Set();
        originalData.forEach(d => {
            if (d.id.charAt(0).toUpperCase() === item.zone && d.dong) {
                dongSet.add((d.dong || '').toString().trim());
            }
        });
        const dongs = [...dongSet].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

        dongs.forEach(dong => {
            const allLocs = originalData.filter(d =>
                d.id.charAt(0).toUpperCase() === item.zone &&
                (d.dong || '').toString().trim() === dong
            );

            const posSet = new Set();
            allLocs.forEach(d => { if (d.pos) posSet.add((d.pos || '').toString().trim()); });
            const posLabels = [...posSet].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
            if (posLabels.length === 0) return;

            const leftNumSet = new Set();
            const rightNumSet = new Set();
            const numsByPos = {};

            posLabels.forEach(pos => {
                const posLocs = allLocs.filter(d => (d.pos || '').toString().trim() === pos);
                const nums = posLocs.map(d => {
                    const m = d.id.match(/(\d+)$/);
                    return m ? parseInt(m[1]) : 0;
                }).filter(n => n > 0).sort((a, b) => a - b);
                const posHalf = Math.ceil(nums.length / 2);
                const leftN = nums.slice(0, posHalf);
                const rightN = nums.slice(posHalf);
                numsByPos[pos] = { left: leftN, right: rightN };
                leftN.forEach(n => leftNumSet.add(n));
                rightN.forEach(n => rightNumSet.add(n));
            });

            const leftNums = [...leftNumSet].sort((a, b) => a - b);
            const rightNums = [...rightNumSet].sort((a, b) => a - b);
            const leftLocs = allLocs.filter(d => { const m = d.id.match(/(\d+)$/); return m && leftNumSet.has(parseInt(m[1])); });
            const rightLocs = allLocs.filter(d => { const m = d.id.match(/(\d+)$/); return m && rightNumSet.has(parseInt(m[1])); });

            // cellSize는 슬라이더 값 사용 (구역별 고정)

            bodyHtml += `
                <div style="border:1px solid #ddd;border-radius:10px;overflow:hidden;margin-bottom:12px;">
                    <div style="background:#f4f4f4;padding:5px 16px;border-bottom:1px solid #ddd;">
                        <div style="font-size:13px;font-weight:bold;color:#3d5afe;">${item.zone}구역 ${dong}동</div>
                    </div>
                    ${buildRackSection(leftLocs, numsByPos, posLabels, 'left', cellSize)}
                    <div style="display:flex;align-items:center;justify-content:center;gap:12px;background:#fafafa;padding:5px 16px;border-top:1px solid #eee;border-bottom:1px solid #eee;">
                        <div style="font-size:11px;color:#ccc;letter-spacing:4px;">← ← ←</div>
                        <div style="font-size:11px;color:#bbb;font-weight:bold;">${dong}동 통로</div>
                        <div style="font-size:11px;color:#ccc;letter-spacing:4px;">→ → →</div>
                    </div>
                    ${buildRackSection(rightLocs, numsByPos, posLabels, 'right', cellSize)}
                </div>`;
        });
    }

    mapBody.innerHTML = `
        <div>
            ${bodyHtml}
            <div style="display:flex;gap:12px;padding:10px 0;flex-wrap:wrap;">
                <span style="font-size:11px;color:#555;display:flex;align-items:center;gap:5px;"><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#c8e6c9;border:1px solid #66bb6a;"></span>상품있음</span>
                <span style="font-size:11px;color:#555;display:flex;align-items:center;gap:5px;"><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#f0f0f0;border:1px solid #ccc;"></span>빈칸</span>
                <span style="font-size:11px;color:#555;display:flex;align-items:center;gap:5px;"><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#fff9c4;border:1px solid #f9a825;"></span>예약중</span>
                <span style="font-size:11px;color:#555;display:flex;align-items:center;gap:5px;"><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#ffe0b2;border:1px solid #fb8c00;"></span>선지정</span>
            </div>
        </div>
    `;
}

window.addEventListener('keydown', function(e) { if (e.key === 'F5' || (e.ctrlKey && (e.key === 'r' || e.key === 'R'))) { e.preventDefault(); alert("🚨 실시간 동기화 중입니다."); } });
window.addEventListener('beforeunload', function(e) { e.preventDefault(); e.returnValue = ''; });
