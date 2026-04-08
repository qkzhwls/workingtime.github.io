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
            if (conf.excelHeaders) window.excelHeaders = conf.excelHeaders.filter(h => h && !h.includes('<') && !h.includes('>') && !h.includes('='));
            
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
        
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        originalData.forEach(loc => {
            if (loc.codeTag && loc.codeTagAt && loc.codeTagAt < todayStart) {
                loc.codeTag = '';
                loc.codeTagAt = 0;
                const zoneDocId = getZoneDocId(loc.id);
                setDoc(doc(db, LOC_COLLECTION, zoneDocId), { [loc.id]: { codeTag: '', codeTagAt: 0 } }, { merge: true }).catch(() => {});
            }
        });
        
        renderTableHeader(); 
        applyFiltersAndSort(); 
        if(document.getElementById('incoming-sidebar').classList.contains('open')) window.renderIncomingQueue();
        
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

window.downloadMainExcel = function() {
    const checkedIds = VS.checkedIds;
    
    let targetData;
    let fileLabel;
    
    if (checkedIds.size > 0) {
        targetData = originalData.filter(d => checkedIds.has(d.id));
        fileLabel = `로케이션_선택${targetData.length}건`;
    } else if (window.lastFilteredData && window.lastFilteredData.length !== originalData.length) {
        targetData = window.lastFilteredData;
        fileLabel = `로케이션_필터${targetData.length}건`;
    } else {
        targetData = originalData;
        fileLabel = `로케이션_전체${targetData.length}건`;
    }
    
    if (!targetData || targetData.length === 0) {
        alert('다운로드할 데이터가 없습니다.');
        return;
    }
    
    const stdHeaders = ['로케이션', '동', '위치', '상품코드', '상품명', '옵션', '정상재고', '2층창고재고'];
    const cusHeaders = (window.excelHeaders || []).filter(h => h && !h.includes('<') && !h.includes('>') && !h.includes('='));
    const allHeaders = [...stdHeaders, ...cusHeaders];
    
    let headerRow = allHeaders.map(h => `<td class=header>${h}</td>`).join('');
    
    let dataRows = '';
    targetData.forEach(loc => {
        const code = (loc.code === loc.id ? '' : loc.code) || '';
        const stock = loc.stock || '0';
        const stock2f = loc.stock2f || '0';
        
        let row = '';
        row += `<td class='style1'>${loc.id}</td>`;
        row += `<td class='style2'>${loc.dong || ''}</td>`;
        row += `<td class='style2'>${loc.pos || ''}</td>`;
        row += `<td class='style1'>${code}</td>`;
        row += `<td class='style1'>${loc.name || ''}</td>`;
        row += `<td class='style1'>${loc.option || ''}</td>`;
        row += `<td class='style3'>${stock}</td>`;
        row += `<td class='style3'>${stock2f}</td>`;
        
        cusHeaders.forEach(h => {
            const val = (loc.rawData && loc.rawData[h]) ? loc.rawData[h] : '';
            const isNum = !isNaN(val) && val !== '';
            row += `<td class='${isNum ? 'style3' : 'style2'}'>${val}</td>`;
        });
        
        dataRows += `<tr>${row}</tr>\n`;
    });
    
    const htmlContent = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<meta http-equiv='Content-Type' content='text/html; charset=utf-8'>
<head>
<style>
    br {mso-data-placement:same-cell;}
    .header {font:bold 10pt "굴림"; white-space:nowrap; background:#CCFFCC;}
    .style1 {font:9pt "굴림"; white-space:nowrap; mso-number-format:\\@;}
    .style2 {font:9pt "굴림"; white-space:nowrap;}
    .style3 {font:9pt "굴림"; white-space:nowrap; mso-number-format:"0_ ";}
</style>
</head>
<body>
<table border="1" cellspacing="0" cellpadding="2">
<tr>${headerRow}</tr>
${dataRows}
</table>
</body>
</html>`;
    
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date();
    const dateString = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    a.download = `${fileLabel}_${dateString}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

window.openRecommendModal = function() {
    document.getElementById('recommend-modal').style.display = 'flex';
};

window.showRecommendation = function() {
    window.showLoading("💡 우선순위 알고리즘을 분석하여 최적의 로케이션을 매칭 중입니다...");

    setTimeout(() => {
        window.currentRecommendations = [];
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

                if (currentDongsList.includes(targetDong)) break; 

                usedEmptyIndices.add(j);
                let totalStock = 0; let totalStock2f = 0; let itemOption = '';
                
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

                let moveBadge = ''; let moveText = '';
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
                    moveQty: moveQty, currentLocs: item.currentLocs, targetLoc: eLoc.id,
                    name: item.name, option: itemOption, code: item.code, moveDirection: moveText
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
            html += '<tr><td colspan="6" style="padding:40px;">데이터가 부족하거나 추천할 빈 로케이션이 없습니다.</td></tr>';
        }

        tbody.innerHTML = html;
        window.hideLoading();
        document.getElementById('recommend-modal').style.display = 'flex';

    }, 500); 
};

window.downloadRecommendationExcel = function() {
    if (!window.currentRecommendations || window.currentRecommendations.length === 0) {
        alert("다운로드할 추천 데이터가 없습니다.");
        return;
    }

    const excelData = window.currentRecommendations.map(item => ({
        "이동방향": item.moveDirection,
        "이동수량": item.moveQty,
        "현재로케이션": item.currentLocs,
        "변경로케이션": item.targetLoc,
        "상품명": item.name,
        "옵션": item.option,
        "상품코드": item.code
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 15 }, { wch: 40 }, { wch: 25 }, { wch: 15 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "로케이션변경추천");
    
    const today = new Date();
    const dateString = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, `로케이션변경추천리스트_${dateString}.xlsx`);
};

window.current2FList = [];
window.show2FRecommendation = function() { document.getElementById('modal-2f').style.display = 'flex'; };
window.toggle2FCheckAll = function(source) { document.querySelectorAll('.check-2f-item').forEach(cb => cb.checked = source.checked); };

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

    const codeMap = {};
    originalData.forEach(loc => {
        const code = loc.code;
        if (!code || code.trim() === '' || code === loc.id) return;
        if (!codeMap[code]) codeMap[code] = [];
        codeMap[code].push(loc);
    });

    window.current2FList = [];
    for (const code in codeMap) {
        const locs = codeMap[code];
        const firstLoc = locs[0];
        
        const getRawVal = (rd, targetKey) => {
            if (!rd) return '';
            if (rd[targetKey]) return rd[targetKey];
            const norm = targetKey.replace(/[\s\u00A0]/g, '');
            for (const k of Object.keys(rd)) {
                if (k.replace(/[\s\u00A0]/g, '') === norm) return rd[k];
            }
            return '';
        };

        let lastDelivery = '';
        for (const loc of locs) {
            let val = getRawVal(loc.rawData, '마지막배송일') || getRawVal(loc.rawData, '마지막입고일');
            if (val && val > lastDelivery) lastDelivery = val;
        }

        if (lastDelivery && lastDelivery > cutoffStr) continue;

        let totalStock = 0; locs.forEach(l => totalStock += Number(l.stock || 0));
        if (totalStock > stockLimit) continue;

        let extraOpt = '';
        for (const loc of locs) {
            const val = getRawVal(loc.rawData, '옵션추가항목1');
            if (val) { extraOpt = val; break; }
        }

        const locIds = locs.map(l => l.id).join(', ');
        const changeValue = `2F-${code}${extraOpt ? ' ' + extraOpt : ''}`;

        window.current2FList.push({
            code, name: firstLoc.name, option: firstLoc.option, totalStock, lastDelivery: lastDelivery || '기록없음',
            locIds, locs, changeValue, extraOpt
        });
    }

    window.current2FSortAsc = true;
    window.current2FList.sort((a, b) => {
        const aVal = a.lastDelivery === '기록없음' ? '0000-00-00' : a.lastDelivery;
        const bVal = b.lastDelivery === '기록없음' ? '0000-00-00' : b.lastDelivery;
        return aVal.localeCompare(bVal);
    });
    
    window.render2FTable();
};

window.render2FTable = function() {
    const tbody = document.getElementById('2f-tbody');
    let html = '';
    window.current2FList.forEach((item, idx) => {
        const rowBg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
        html += `<tr style="background:${rowBg};">
            <td><input type="checkbox" class="check-2f-item" data-idx="${idx}"></td>
            <td style="font-weight:bold; color:#7b1fa2;">${idx + 1}</td>
            <td style="font-weight:bold; color:#1a237e;">${item.code}</td>
            <td style="text-align:left; font-size:13px;">${item.name}</td>
            <td style="font-size:12px;">${item.option}</td>
            <td style="font-weight:bold;">${item.totalStock}</td>
            <td style="font-size:12px; color:${item.lastDelivery === '기록없음' ? '#ff5252' : '#555'};">${item.lastDelivery}</td>
            <td style="font-size:12px;">${item.locIds}</td>
            <td style="background:#f3e5f5; font-weight:bold; color:#4a148c; font-size:12px;">${item.changeValue}</td>
        </tr>`;
    });
    tbody.innerHTML = html || '<tr><td colspan="9" style="padding:40px;">데이터가 없습니다.</td></tr>';
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
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { visibleColumns: newVisible }, { merge: true });
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
        window.sheetUrlOrder = urlOrder; window.sheetUrlBuy = urlBuy;
        alert("✅ 구글시트 링크가 안전하게 저장되었습니다.");
        window.closeSheetModal();
    } catch(e) { alert("저장 실패"); }
};

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
    if (!window.sheetUrlOrder && !window.sheetUrlBuy) return alert("시트 링크를 설정해주세요.");
    window.showLoading("🔄 연동 중...");
    
    try {
        const fetchAndParse = async (url, sourceName) => {
            if (!url) return [];
            const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
            const textData = await res.text();
            const workbook = XLSX.read(textData, { type: 'string' });
            const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
            return smartParseToJSON(rawData).map(r => ({ ...r, source: sourceName }));
        };

        const [orderData, buyData] = await Promise.all([
            fetchAndParse(window.sheetUrlOrder, '제작'),
            fetchAndParse(window.sheetUrlBuy, '사입')
        ]);

        const finalJson = [...orderData, ...buyData].map(row => {
            let code = row['어드민상품코드'] || row['상품코드'] || '';
            let rawQty = row['총미입고수량본사입고기준'] || row['최종미입고수량추가입고예정'] || row['미입고수량'];
            let date = formatExcelDate(row['공장출고예상일'] || row['검수창고도착일'] || '');
            return {
                '상품코드': code, '상품명': row['상품명'] || row['공급처상품명'] || '',
                '옵션': row['옵션'] || '', '입고대기수량': Number(rawQty) || 0,
                '표시날짜': date, 'source': row.source
            };
        }).filter(r => r['상품코드'] && r['입고대기수량'] > 0 && r['표시날짜']);

        if (finalJson.length > 0) {
            await updateDatabaseB(finalJson, 'IncomingData', null, true);
            window.hideLoading(); alert("✅ 연동 완료");
        } else { window.hideLoading(); alert("데이터 없음"); }
    } catch (e) { window.hideLoading(); alert("연동 실패: " + e.message); }
};

window.calculateAndRenderUsage = function() {
    const popup = document.getElementById('usage-popup');
    if (!popup) return;
    let html = `<div style="display:flex; gap:10px; margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;"><button onclick="switchUsageTab('3F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; background:${window.currentUsageTab === '3F' ? 'var(--primary)' : '#eee'}; color:${window.currentUsageTab === '3F' ? 'white' : '#555'}">3층 로케이션</button><button onclick="switchUsageTab('2F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; background:${window.currentUsageTab === '2F' ? 'var(--primary)' : '#eee'}; color:${window.currentUsageTab === '2F' ? 'white' : '#555'}">2층 창고재고</button></div>`;

    if (window.currentUsageTab === '3F') {
        const locations = originalData.filter(d => d.id.charAt(0).toUpperCase() !== 'K');
        let used = 0; let total = locations.length;
        locations.forEach(loc => { if ((loc.code && loc.code !== loc.id) || loc.name) used++; });
        const rate = ((used / total) * 100).toFixed(1);
        html += `<div style="text-align:center;">📊 3층 사용률: <b>${rate}%</b> (${used}/${total})</div>`;
    } else {
        let sum2F = 0; originalData.forEach(loc => sum2F += Number(loc.stock2f || 0));
        let rate2F = ((sum2F / window.capacity2F) * 100).toFixed(1);
        
        let incomingByDate = {}; let totalIncoming = 0;
        for (let code in incomingData) {
            const item = incomingData[code];
            const date = (item['도착예상일'] || item['표시날짜'] || '').toString().trim();
            const qty = Number(item['입고대기수량'] || 0);
            if (date && qty > 0) { incomingByDate[date] = (incomingByDate[date] || 0) + qty; totalIncoming += qty; }
        }
        const sortedDates = Object.keys(incomingByDate).sort();
        let predictionHtml = ''; let fullDate = ''; let cumTotal = sum2F;
        
        for (const date of sortedDates) {
            cumTotal += incomingByDate[date];
            if (cumTotal >= window.capacity2F) { fullDate = date; break; }
        }
        
        if (sum2F >= window.capacity2F) {
            predictionHtml = `<tr><th style="background:#ffebee;">⚠️ 초과</th><td style="color:red; text-align:right;">${(sum2F - window.capacity2F).toLocaleString()}장 초과</td></tr>`;
        } else if (fullDate) {
            predictionHtml = `<tr><th style="background:#fff3e0;">📅 만재 예측</th><td style="color:orange; text-align:right;">${fullDate}</td></tr>`;
        } else if (sortedDates.length > 0) {
            const d1 = new Date(sortedDates[0]); const d2 = new Date(sortedDates[sortedDates.length - 1]);
            const daySpan = Math.max(1, Math.round((d2 - d1) / (86400000)));
            const dailyAvg = totalIncoming / daySpan;
            if (dailyAvg > 0) {
                const extraDays = Math.ceil((window.capacity2F - (sum2F + totalIncoming)) / dailyAvg);
                const estDate = new Date(d2); estDate.setDate(estDate.getDate() + extraDays);
                predictionHtml = `<tr><th style="background:#e8f5e9;">📅 만재(추정)</th><td style="color:green; text-align:right;">${estDate.toISOString().slice(0, 10)}</td></tr>`;
            }
        }
        html += `<div style="text-align:center;">🏢 2층 적재율: <b>${rate2F}%</b></div><table class="usage-table" style="width:100%; margin-top:10px;">${predictionHtml}</table>`;
    }
    popup.innerHTML = html;
};

// 가상 스크롤 전역 상태
const VS = { data: [], rowHeight: 42, bufferRows: 20, checkedIds: new Set(), scrollHandler: null };

function renderTable(data) {
    VS.data = data;
    const container = document.getElementById('list-container');
    const tbody = document.getElementById('location-list-body');
    if (!tbody || !container) return;
    if (!VS.scrollHandler) {
        VS.scrollHandler = () => { requestAnimationFrame(() => renderVisibleRows()); };
        container.addEventListener('scroll', VS.scrollHandler);
    }
    renderVisibleRows();
}

function renderVisibleRows() {
    const container = document.getElementById('list-container');
    const tbody = document.getElementById('location-list-body');
    if (!tbody || !container) return;
    
    const totalRows = VS.data.length;
    const scrollTop = Math.max(0, container.scrollTop - 45);
    const viewHeight = container.clientHeight;
    
    let startIdx = Math.max(0, Math.floor(scrollTop / VS.rowHeight) - VS.bufferRows);
    let endIdx = Math.min(totalRows, Math.ceil((scrollTop + viewHeight) / VS.rowHeight) + VS.bufferRows);
    
    let html = `<tr style="height:${startIdx * VS.rowHeight}px;"><td colspan="20"></td></tr>`;
    for (let i = startIdx; i < endIdx; i++) {
        const loc = VS.data[i];
        let isChecked = VS.checkedIds.has(loc.id) ? 'checked' : '';
        html += `<tr onclick="handleRowClick(event, '${loc.id}')">
            <td onclick="event.stopPropagation()"><input type="checkbox" class="loc-check" value="${loc.id}" ${isChecked} onchange="window.vsCheckChanged(this)"></td>`;
        window.visibleColumns.forEach(col => {
            if (col === 'std_id') html += `<td class="loc-copy-cell" onclick="copyLocationToClipboard(event, '${loc.id}')">${loc.id}</td>`;
            else if (col === 'std_code') html += `<td style="color:blue;">${loc.code === loc.id ? '' : (loc.code || '')}</td>`;
            else if (col === 'std_name') html += `<td style="text-align:left;">${loc.name || ''}</td>`;
            else if (col === 'std_stock') html += `<td>${loc.stock || '0'}</td>`;
            else if (col.startsWith('cus_')) {
                const key = col.replace('cus_', '');
                html += `<td>${(loc.rawData && loc.rawData[key]) ? loc.rawData[key] : ''}</td>`;
            } else {
                const key = col.replace('std_', '');
                html += `<td>${loc[key] || ''}</td>`;
            }
        });
        html += `</tr>`;
    }
    html += `<tr style="height:${(totalRows - endIdx) * VS.rowHeight}px;"><td colspan="20"></td></tr>`;
    tbody.innerHTML = html;
}

window.vsCheckChanged = (cb) => { if (cb.checked) VS.checkedIds.add(cb.value); else VS.checkedIds.delete(cb.value); };

function smartParseToJSON(rawData) {
    let headerIdx = -1; let headers = [];
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
        const clean = rawData[i].map(h => (h || '').toString().replace(/\s/g, ''));
        if (clean.includes('상품코드') || clean.includes('로케이션')) { headerIdx = i; headers = clean; break; }
    }
    if (headerIdx === -1) return [];
    const list = [];
    for (let i = headerIdx + 1; i < rawData.length; i++) {
        let obj = {}; let empty = true;
        headers.forEach((h, j) => { if (h) { obj[h] = rawData[i][j]; if (obj[h]) empty = false; } });
        if (!empty) list.push(obj);
    }
    return list;
}

async function updateDatabaseA(rows, mode = 'daily') {
    window.showLoading("DB 업데이트 중...");
    try {
        const allKeys = new Set(); rows.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
        const exclude = ['동', '위치', '상품코드', '로케이션', '상품명', '옵션', '정상재고', '2층창고재고'];
        const customHeaders = [...allKeys].filter(k => !exclude.includes(k) && !k.includes('<'));
        
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { excelHeaders: customHeaders }, { merge: true });
        
        let batch = writeBatch(db); let count = 0;
        const zoneUpdates = {};
        
        rows.forEach(row => {
            const locId = row['로케이션']?.toString().trim();
            if (locId) {
                const zoneId = getZoneDocId(locId);
                if (!zoneUpdates[zoneId]) zoneUpdates[zoneId] = {};
                zoneUpdates[zoneId][locId] = {
                    code: row['상품코드'] || '', name: row['상품명'] || '', option: row['옵션'] || '',
                    stock: row['정상재고']?.toString() || '0', stock2f: row['2층창고재고']?.toString() || '0',
                    rawDataStr: JSON.stringify(row), updatedAt: new Date()
                };
            }
        });

        for (let zid in zoneUpdates) {
            batch.set(doc(db, LOC_COLLECTION, zid), zoneUpdates[zid], { merge: true });
            if (++count % 200 === 0) { await batch.commit(); batch = writeBatch(db); }
        }
        await batch.commit();
        alert("✅ 업데이트 완료");
    } catch (e) { alert("실패: " + e.message); }
    window.hideLoading();
}

async function updateDatabaseB(rows, coll, input, silent) {
    const querySnapshot = await getDocs(collection(db, coll));
    let delBatch = writeBatch(db); querySnapshot.docs.forEach(d => delBatch.delete(d.ref));
    await delBatch.commit();
    
    let batch = writeBatch(db);
    for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        batch.set(doc(db, coll, `CHUNK_${i/200}`), { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
    }
    await batch.commit();
    if (!silent) alert("✅ 저장 완료");
}

function applyFiltersAndSort() {
    let filtered = originalData.filter(item => {
        if (filters.loc.length > 0 && !filters.loc.includes(item.id.charAt(0))) return false;
        if (filters.dong !== 'all' && (item.dong || '').toString() !== filters.dong) return false;
        if (filters.code === 'empty' && (item.code && item.code !== item.id)) return false;
        if (filters.code === 'not-empty' && (!item.code || item.code === item.id)) return false;
        return true;
    });
    filtered.sort((a, b) => {
        let aVal = a[sortConfig.key] || ''; let bVal = b[sortConfig.key] || '';
        return sortConfig.direction === 'asc' ? aVal.toString().localeCompare(bVal.toString()) : bVal.toString().localeCompare(aVal.toString());
    });
    window.lastFilteredData = filtered;
    renderTable(filtered);
}

// 초기화 호출
window.universalExcelReader = (file) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const raw = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
            resolve(smartParseToJSON(raw));
        };
        reader.readAsArrayBuffer(file);
    });
};

const fileInputA = document.getElementById('excel-upload-a');
if (fileInputA) fileInputA.addEventListener('change', async (e) => {
    const json = await window.universalExcelReader(e.target.files[0]);
    if(json.length) await updateDatabaseA(json);
    e.target.value = '';
});

// 기타 팝업/모달 닫기 기능들은 HTML 인라인 및 소스 참조
