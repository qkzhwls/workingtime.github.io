// === js/inspection-logic.js ===
// 설명: 검수 이력 조회, 저장, 리스트 관리, 수정/삭제(상세/전체), 스캔, 엑셀, 이미지 처리 등 핵심 로직

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { updateDailyData } from './app-data.js'; 
import { showToast, getCurrentTime, getTodayDateString } from './utils.js';
import { 
    doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, increment, serverTimestamp, collection, getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderInspectionHistoryTable, renderInspectionLogTable } from './ui-history-inspection.js';

// 로컬 상태 변수
let todayInspectionList = [];
let html5QrCode = null;
let currentImageBase64 = null;
let currentProductLogs = []; 
let currentTodoIndex = -1;

// ✅ [신규] 수정 모드 추적용 변수 ( -1이면 신규, 0 이상이면 수정 )
let editingLogIndex = -1; 

// ✅ [신규] 수정 상태 초기화 헬퍼 함수
const resetEditingState = () => {
    editingLogIndex = -1;
    const btn = document.getElementById('insp-save-next-btn');
    if (btn) {
        // 버튼을 원래 상태(녹색, 저장)로 복구
        btn.innerHTML = `<span>검수 완료 및 저장</span><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0 1 18 0Z" /></svg>`;
        btn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        btn.classList.add('bg-green-600', 'hover:bg-green-700');
    }
    clearImageState();
};

// 검수 세션 초기화 함수 (업무 시작 시 호출)
export const initializeInspectionSession = async () => {
    // 1. 내부 상태 초기화
    todayInspectionList = [];
    currentTodoIndex = -1;
    currentImageBase64 = null;
    resetEditingState(); // ✅ 수정 상태 초기화 추가
    
    // 2. 입력 폼 UI 초기화
    if (DOM.inspProductNameInput) DOM.inspProductNameInput.value = '';
    if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = '';
    if (DOM.inspNotesInput) DOM.inspNotesInput.value = '';
    if (DOM.inspCheckThickness) DOM.inspCheckThickness.value = '';
    
    // 입고 일자 필드 초기화 (잠금 상태로 복구)
    if (DOM.inspInboundDateInput) {
        DOM.inspInboundDateInput.value = '';
        DOM.inspInboundDateInput.readOnly = true;
        DOM.inspInboundDateInput.classList.add('bg-gray-100');
        DOM.inspInboundDateInput.classList.remove('bg-white');
    }

    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';
    
    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = ""); 
    
    if (DOM.inspImagePreviewBox) DOM.inspImagePreviewBox.classList.add('hidden');
    if (DOM.inspImageInput) DOM.inspImageInput.value = '';

    // 3. 섹션 숨김
    if (DOM.inspHistoryReport) DOM.inspHistoryReport.classList.add('hidden');
    if (DOM.inspCurrentInputArea) DOM.inspCurrentInputArea.classList.add('hidden');
    if (DOM.inspAlertBox) DOM.inspAlertBox.classList.add('hidden');
    
    // 4. "오늘 검수 완료 목록" UI 초기화
    renderTodayInspectionList();

    // 5. 완료된 엑셀 리스트 자동 삭제 확인
    const list = State.appState.inspectionList || [];
    if (list.length > 0) {
        const isAllCompleted = list.every(item => item.status === '완료');
        
        if (isAllCompleted) {
            State.appState.inspectionList = [];
            await updateDailyData({ inspectionList: [] });
            renderTodoList();
            showToast("이전 검수 리스트가 모두 완료되어 초기화되었습니다.");
        } else {
            renderTodoList();
        }
    } else {
        renderTodoList();
    }
};

// 엑셀 리스트 전체 삭제 (초기화)
export const deleteInspectionList = async () => {
    const list = State.appState.inspectionList || [];
    if (list.length === 0) {
        showToast("삭제할 리스트가 없습니다.", true);
        return;
    }

    if (!confirm("현재 검수 대기 리스트를 모두 삭제하시겠습니까?\n(검수 완료된 이력 데이터는 유지됩니다)")) {
        return;
    }

    try {
        await updateDailyData({ inspectionList: [] });
        State.appState.inspectionList = [];
        renderTodoList();
        
        DOM.inspProductNameInput.value = '';
        if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = '';
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';
        
        currentTodoIndex = -1;
        resetEditingState(); // ✅ 수정 상태 초기화 추가

        showToast("검수 리스트가 초기화되었습니다.");
    } catch (e) {
        console.error("Error deleting list:", e);
        showToast("리스트 삭제 중 오류가 발생했습니다.", true);
    }
};

// 이력(History)에서 특정 날짜의 검수 리스트 삭제
export const deleteHistoryInspectionList = async (dateKey) => {
    if (!dateKey) return false;

    if (!confirm(`${dateKey}일자의 입고 리스트를 삭제하시겠습니까?\n(이미 완료된 검수 이력 데이터는 삭제되지 않습니다)`)) {
        return false;
    }

    const todayKey = getTodayDateString();
    
    try {
        const dayData = State.allHistoryData.find(d => d.id === dateKey);
        if (dayData) {
            dayData.inspectionList = []; 
        }

        if (dateKey === todayKey) {
            State.appState.inspectionList = [];
            await updateDailyData({ inspectionList: [] });
        } else {
            const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
            await updateDoc(docRef, { inspectionList: [] });
        }

        showToast(`${dateKey} 리스트가 삭제되었습니다.`);
        return true;

    } catch (e) {
        console.error("Error deleting history list:", e);
        showToast("리스트 삭제 중 오류가 발생했습니다.", true);
        return false;
    }
};

// ======================================================
// 1. 엑셀 리스트 업로드 및 처리
// ======================================================
export const handleExcelUpload = (file) => {
    // 1. 패킹출고일(입고일) 추출
    let packingDate = getTodayDateString(); // 기본값: 오늘
    
    const parentMatch = file.name.match(/\((\d{6})\)/);
    const fullDateMatch = file.name.match(/20(\d{2})(\d{2})(\d{2})/);
    const shortDateMatch = file.name.match(/(\d{2})(\d{2})(\d{2})/);

    if (parentMatch) {
        const y = parentMatch[1].substring(0, 2);
        const m = parentMatch[1].substring(2, 4);
        const d = parentMatch[1].substring(4, 6);
        packingDate = `20${y}-${m}-${d}`;
    } else if (fullDateMatch) {
        packingDate = `20${fullDateMatch[1]}-${fullDateMatch[2]}-${fullDateMatch[3]}`;
    } else if (shortDateMatch) {
        packingDate = `20${shortDateMatch[1]}-${shortDateMatch[2]}-${shortDateMatch[3]}`;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // --- [Helper] 매칭 키 정제 함수 ---
            const getCleanKey = (name, option) => {
                const cleanName = String(name || '').replace(/\(매칭금지-제작샘플\)/g, '').replace(/\s/g, '').trim().toLowerCase();
                const cleanOption = String(option || '').replace(/촬샘-/g, '').replace(/\s/g, '').trim().toLowerCase();
                return cleanName + cleanOption;
            };

            // --- [Step 1] 시트 2 읽기 (샘플 위치 정보) ---
            const sampleMap = new Map(); // Key: 정제된(상품명+옵션), Value: 로케이션(G열)
            
            if (workbook.SheetNames.length > 1) {
                const sheet2Name = workbook.SheetNames[1];
                const sheet2 = workbook.Sheets[sheet2Name];
                const json2 = XLSX.utils.sheet_to_json(sheet2, { header: 1 });
                
                // 시트2 데이터 파싱
                for (let i = 1; i < json2.length; i++) {
                    const row = json2[i];
                    if (row) {
                        const name = row[1]; 
                        const option = row[2];
                        const location = String(row[6] || '').trim(); // G열
                        
                        if (name && location) {
                            const key = getCleanKey(name, option);
                            sampleMap.set(key, location);
                        }
                    }
                }
            }

            // --- [Step 2] 시트 1 읽기 (검수 리스트) ---
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            const processedList = [];
            const uniqueKeyMap = new Map(); 

            if (jsonData.length > 1) {
                for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (row && row.length > 1) { 
                        const code = String(row[0] || '').trim();
                        const name = String(row[1] || '').trim();
                        const option = String(row[2] || '').trim(); // C열
                        const qty = Number(row[3]) || 0;
                        const thickness = String(row[4] || '');
                        const supplierName = String(row[5] || '').trim(); // F열
                        const location = String(row[6] || '').trim(); // G열 (검수 로케이션)
                        
                        if (code || name) {
                            // 1. 중복 제거용 키 생성
                            let color = option.replace(/\[|\]/g, '').split('-')[0].trim();
                            if (!color) color = 'N/A';
                            
                            const keyColor = color.replace(/\s/g, '').toLowerCase();
                            const keySupplierName = supplierName.replace(/\s/g, '').toLowerCase();
                            const uniqueKey = `${keySupplierName}::${keyColor}`; 

                            // 2. 시트2와 매칭 확인 (샘플 위치 확인)
                            let sampleLocation = null;
                            const matchKey = getCleanKey(name, option);
                            
                            if (sampleMap.has(matchKey)) {
                                sampleLocation = sampleMap.get(matchKey);
                            }

                            if (!uniqueKeyMap.has(uniqueKey)) {
                                uniqueKeyMap.set(uniqueKey, true); 
                                
                                processedList.push({
                                    code, name, option, qty, thickness, supplierName, location,
                                    sampleLocation: sampleLocation, // 시트2에서 매칭된 위치
                                    status: '대기',
                                    inboundDate: packingDate,
                                    packingDate: packingDate
                                });
                            }
                        }
                    }
                }
            }

            if (processedList.length > 0) {
                await updateDailyData({ inspectionList: processedList });
                State.appState.inspectionList = processedList;
                
                showToast(`${processedList.length}개의 리스트가 업로드되었습니다. (패킹일: ${packingDate})`);
                renderTodoList(); 
                
                // 업로드 후 자동으로 리스트 팝업창 열기
                openInspectionListWindow();

            } else {
                showToast("유효한 데이터가 엑셀에 없습니다.", true);
            }

        } catch (err) {
            console.error("Excel parse error:", err);
            showToast("엑셀 파일 처리 중 오류가 발생했습니다.", true);
        }
    };
    reader.readAsArrayBuffer(file);
};

// 리스트 팝업창을 인앱 모달로 띄우는 함수
export const openInspectionListWindow = () => {
    const list = State.appState.inspectionList || [];
    if (list.length === 0) {
        showToast("리스트 데이터가 없습니다.", true);
        return;
    }

    // 패킹출고일 가져오기
    const packingDate = list[0].packingDate || getTodayDateString();
    
    // 기존 모달이 있다면 제거 (중복 방지)
    const existingModal = document.getElementById('dynamic-inspection-list-modal');
    if (existingModal) existingModal.remove();

    // 모달 컨테이너 생성
    const modal = document.createElement('div');
    modal.id = 'dynamic-inspection-list-modal';
    modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-90 flex items-center justify-center z-[200] p-2';

    // 테이블 행 생성
    const rowsHtml = list.map((item, idx) => {
        const isCompleted = item.status === '완료';
        // 완료된 항목은 배경색과 텍스트 색상을 흐리게
        const trClass = isCompleted 
            ? 'bg-gray-100 text-gray-400' 
            : 'bg-white hover:bg-blue-50 cursor-pointer border-b border-gray-100';
        
        const statusBadge = isCompleted 
            ? '<span class="text-green-600 font-bold text-xs">완료</span>' 
            : '<span class="text-gray-500 text-xs">대기</span>';
        
        // 클릭 시 해당 아이템 선택 기능 연결 (완료된 것도 수정 위해 클릭 가능하도록 변경)
        const onClickAttr = `data-index="${idx}"`;

        // 정보 표시 (로케이션, 샘플위치)
        const locInfo = item.location ? `<div class="text-xs font-bold text-indigo-600">📦 ${item.location}</div>` : '';
        const sampleInfo = item.sampleLocation ? `<div class="text-xs font-bold text-red-600 mt-0.5">📌 샘플: ${item.sampleLocation}</div>` : '';

        return `
            <tr class="${trClass} transition" ${onClickAttr}>
                <td class="px-2 py-3 align-top w-16 text-center">
                    ${locInfo}
                    ${sampleInfo}
                </td>
                <td class="px-2 py-3 align-top">
                    <div class="text-base font-medium text-gray-800 leading-tight">${item.name}</div>
                    <div class="text-sm text-gray-500 mt-1">${item.option || '-'}</div>
                    <div class="text-xs text-gray-400 mt-0.5 font-mono">${item.code || ''}</div>
                </td>
                <td class="px-2 py-3 align-top text-center w-12">
                    <div class="text-base font-bold text-gray-700">${item.qty}</div>
                </td>
                <td class="px-2 py-3 align-top text-center w-12">
                    ${statusBadge}
                </td>
            </tr>
        `;
    }).join('');

    // 모달 내부 HTML 구성
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden animate-fade-in-up">
            <div class="p-4 bg-indigo-600 text-white flex justify-between items-center shadow-md shrink-0">
                <div>
                    <h2 class="text-lg font-bold flex items-center gap-2">
                        📋 검수 대기 리스트
                        <span class="bg-white text-indigo-600 text-xs px-2 py-0.5 rounded-full font-extrabold">${list.length}</span>
                    </h2>
                    <p class="text-xs text-indigo-200 mt-1">📅 패킹출고일: <span class="font-bold text-white">${packingDate}</span></p>
                </div>
                <button id="close-dynamic-modal-btn" class="text-white hover:text-gray-200 bg-white/20 hover:bg-white/30 rounded-full p-2 transition">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div class="flex-grow overflow-y-auto overflow-x-auto bg-gray-50 p-2">
                <table class="w-full text-left border-collapse min-w-[350px]">
                    <thead class="bg-gray-200 text-gray-600 text-xs uppercase sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th class="px-2 py-2 text-center w-16">위치</th>
                            <th class="px-2 py-2">상품 정보</th>
                            <th class="px-2 py-2 text-center w-12">수량</th>
                            <th class="px-2 py-2 text-center w-12">상태</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200 bg-white">
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>

            <div class="p-3 bg-gray-100 text-center border-t border-gray-200 text-xs text-gray-500 shrink-0">
                항목을 클릭하면 입력창에 자동 선택됩니다. (좌우로 스크롤하여 전체 내용 확인 가능)
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 이벤트 리스너 연결
    document.getElementById('close-dynamic-modal-btn').addEventListener('click', () => {
        modal.remove();
    });

    modal.querySelector('tbody').addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-index]');
        if (tr) {
            const index = parseInt(tr.dataset.index, 10);
            selectTodoItem(index);
            modal.remove();
        }
    });
};

export const renderTodoList = () => {
    const list = State.appState.inspectionList || [];

    if (!DOM.inspTodoListArea || !DOM.inspTodoListBody) return;
    
    if (list.length > 0) {
        DOM.inspTodoListArea.classList.remove('hidden');
    } else {
        DOM.inspTodoListArea.classList.add('hidden');
        return;
    }

    DOM.inspTodoListBody.innerHTML = '';
    list.forEach((item, idx) => {
        const tr = document.createElement('tr');
        const isCompleted = item.status === '완료';
        tr.className = `transition border-b last:border-0 cursor-pointer ${isCompleted ? 'bg-gray-50 hover:bg-gray-100' : 'hover:bg-blue-50'}`;
        
        const statusColor = isCompleted ? 'text-green-600 font-bold' : 'text-gray-400';
        
        const locationInfo = item.location ? `<span class="text-indigo-600 font-bold bg-indigo-50 px-1 rounded">📦 ${item.location}</span>` : '';
        const sampleInfo = item.sampleLocation ? `<span class="text-red-600 font-bold bg-red-50 px-1 rounded ml-1">📌 샘플: ${item.sampleLocation}</span>` : '';
        const dateInfo = item.packingDate ? `<span class="text-gray-500 ml-1">📅 ${item.packingDate.slice(2)}</span>` : '';
        
        tr.innerHTML = `
            <td class="px-3 py-2 font-mono text-gray-600 text-xs align-top">${item.code}</td>
            <td class="px-3 py-2 font-medium text-gray-800 align-top">
                <div class="truncate max-w-[150px]" title="${item.name}">${item.name}</div>
                <div class="text-[10px] mt-0.5 flex flex-wrap gap-1">
                    ${locationInfo}
                    ${sampleInfo}
                    ${dateInfo}
                </div>
            </td>
            <td class="px-3 py-2 text-gray-500 text-xs align-top">${item.option}</td>
            <td class="px-3 py-2 text-right text-xs ${statusColor} align-top">${item.status}</td>
        `;
        
        tr.addEventListener('click', () => {
            selectTodoItem(idx);
        });
        DOM.inspTodoListBody.appendChild(tr);
    });
};

// ✅ [수정] 리스트 아이템 선택 시 로직 (완료된 건은 수정 모드로 진입)
export const selectTodoItem = async (index) => {
    const item = State.appState.inspectionList[index];
    if (!item) return;

    currentTodoIndex = index; 

    // 기본 정보 채우기
    DOM.inspProductNameInput.value = item.name; 
    
    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${item.option || '-'}`;
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${item.code || '-'}`;
    
    let supplierText = `공급처: ${item.supplierName || '-'}`;
    if (item.location) supplierText += ` / 📦 Loc: ${item.location}`;
    if (item.sampleLocation) supplierText += ` / 📌 샘플: ${item.sampleLocation}`; 
    if (item.packingDate) supplierText += ` / 📅 패킹: ${item.packingDate}`;
    
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = supplierText; 
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${item.thickness || '-'}`;

    // 이력 조회 호출 (비동기)
    await searchProductHistory(); 

    // ✅ 만약 완료된 항목이면, 검수 기록을 불러와서 폼에 채우고 수정 모드로 전환
    if (item.status === '완료') {
        await loadCompletedInspectionData(item);
    } else {
        // 대기 상태면 입력 폼 리셋 및 신규 모드
        resetEditingState();
        if (DOM.inspInboundDateInput) DOM.inspInboundDateInput.value = item.inboundDate || getTodayDateString();
        if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = item.qty > 0 ? item.qty : '';
        DOM.inspNotesInput.value = '';
    }
    
    showToast(`'${item.name}' 선택됨`);
};

// 윈도우 객체에 바인딩
window.selectInspectionTodoItem = selectTodoItem;

// ✅ [신규] 완료된 항목의 데이터를 Firestore에서 불러와 폼에 채우는 함수
const loadCompletedInspectionData = async (item) => {
    try {
        const docRef = doc(State.db, 'product_history', item.name);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const logs = data.logs || [];
            
            // 리스트의 정보(입고일)와 일치하는 가장 최근 로그를 찾음
            // (동일 상품이 오늘 여러 번 있을 수 있으므로 뒤에서부터 탐색)
            const targetLogIndex = logs.map((log, idx) => ({ ...log, originalIndex: idx }))
                                     .reverse()
                                     .findIndex(log => log.inboundDate === item.inboundDate);

            if (targetLogIndex !== -1) {
                // 원래 인덱스로 변환 (reverse 했으므로)
                const realIndex = logs.length - 1 - targetLogIndex;
                const log = logs[realIndex];

                // 1. 입력 필드 채우기
                if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = log.inboundQty || 0;
                if (DOM.inspNotesInput) DOM.inspNotesInput.value = log.note || '';
                if (DOM.inspInboundDateInput) DOM.inspInboundDateInput.value = log.inboundDate || '';

                // 2. 체크리스트 채우기
                const cl = log.checklist || {};
                const setSelect = (dom, val) => { if (dom) dom.value = val || (dom.options[0]?.value || ''); };

                if (DOM.inspCheckThickness) DOM.inspCheckThickness.value = cl.thickness || '';
                setSelect(DOM.inspCheckFabric, cl.fabric);
                setSelect(DOM.inspCheckColor, cl.color);
                setSelect(DOM.inspCheckDistortion, cl.distortion);
                setSelect(DOM.inspCheckUnraveling, cl.unraveling);
                setSelect(DOM.inspCheckFinishing, cl.finishing);
                setSelect(DOM.inspCheckZipper, cl.zipper);
                setSelect(DOM.inspCheckButton, cl.button);
                setSelect(DOM.inspCheckLining, cl.lining);
                setSelect(DOM.inspCheckPilling, cl.pilling);
                setSelect(DOM.inspCheckDye, cl.dye);

                // 3. 이미지 미리보기
                if (log.image) {
                    currentImageBase64 = log.image;
                    if (DOM.inspImagePreviewBox) {
                        DOM.inspImagePreviewBox.classList.remove('hidden');
                        if (DOM.inspImagePreviewImg) DOM.inspImagePreviewImg.src = log.image;
                    }
                } else {
                    clearImageState();
                }

                // 4. 수정 모드 설정 (버튼 스타일 변경)
                editingLogIndex = realIndex;
                const btn = document.getElementById('insp-save-next-btn');
                if (btn) {
                    btn.innerHTML = `<span>수정 저장</span><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>`;
                    btn.classList.remove('bg-green-600', 'hover:bg-green-700');
                    btn.classList.add('bg-blue-600', 'hover:bg-blue-700');
                }
                
                showToast("이전 검수 기록을 불러왔습니다. 수정 가능합니다.");
                return;
            }
        }
        showToast("이전 상세 기록을 찾을 수 없습니다. (새로 입력하세요)", true);
        resetEditingState();

    } catch (e) {
        console.error("Error loading completed item details:", e);
        resetEditingState();
    }
};

export const toggleScanner = () => {
    if (DOM.inspScannerContainer.classList.contains('hidden')) {
        DOM.inspScannerContainer.classList.remove('hidden');
        startScanner();
    } else {
        stopScanner();
        DOM.inspScannerContainer.classList.add('hidden');
    }
};

const startScanner = () => {
    if (html5QrCode) return; 

    html5QrCode = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    
    html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess)
    .catch(err => {
        console.error("Error starting scanner", err);
        showToast("카메라를 시작할 수 없습니다. (권한/HTTPS 확인)", true);
        DOM.inspScannerContainer.classList.add('hidden');
    });
};

const stopScanner = () => {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            html5QrCode = null;
        }).catch(err => console.error("Failed to stop scanner", err));
    }
};

const onScanSuccess = (decodedText, decodedResult) => {
    console.log(`Scan result: ${decodedText}`);
    showToast(`바코드 인식: ${decodedText}`);
    stopScanner(); 
    DOM.inspScannerContainer.classList.add('hidden');

    DOM.inspProductNameInput.value = decodedText;
    searchProductHistory();
};

export const handleImageSelect = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            currentImageBase64 = canvas.toDataURL('image/jpeg', 0.7); 
            if (DOM.inspImagePreviewBox) {
                DOM.inspImagePreviewBox.classList.remove('hidden');
                DOM.inspImagePreviewImg.src = currentImageBase64;
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

export const clearImageState = () => {
    currentImageBase64 = null;
    if (DOM.inspImagePreviewBox) DOM.inspImagePreviewBox.classList.add('hidden');
    if (DOM.inspImageInput) DOM.inspImageInput.value = '';
};

export const searchProductHistory = async () => {
    let searchTerm = DOM.inspProductNameInput.value.trim();
    if (!searchTerm) {
        showToast('상품명 또는 상품코드를 입력해주세요.', true);
        return;
    }

    const list = State.appState.inspectionList || [];
    let matchedIndex = -1;

    if (currentTodoIndex >= 0 && list[currentTodoIndex] && list[currentTodoIndex].name === searchTerm) {
        matchedIndex = currentTodoIndex;
    } else {
        matchedIndex = list.findIndex(item => 
            (item.code && item.code.trim() === searchTerm) || 
            (item.name && item.name.trim() === searchTerm)
        );
    }

    let targetProductName = searchTerm;

    if (matchedIndex > -1) {
        const matchedItem = list[matchedIndex];
        targetProductName = matchedItem.name;
        currentTodoIndex = matchedIndex; 

        DOM.inspProductNameInput.value = targetProductName;
        
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${matchedItem.option || '-'}`;
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${matchedItem.code || '-'}`;
        
        let supplierText = `공급처: ${matchedItem.supplierName || '-'}`;
        if (matchedItem.location) supplierText += ` / 📦 Loc: ${matchedItem.location}`;
        if (matchedItem.sampleLocation) supplierText += ` / 📌 샘플: ${matchedItem.sampleLocation}`;
        if (matchedItem.packingDate) supplierText += ` / 📅 패킹: ${matchedItem.packingDate}`;
        
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = supplierText; 
        
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${matchedItem.thickness || '-'}`;
        
        if (DOM.inspInboundDateInput) {
            DOM.inspInboundDateInput.value = matchedItem.inboundDate || getTodayDateString();
            DOM.inspInboundDateInput.readOnly = true;
            DOM.inspInboundDateInput.classList.add('bg-gray-100');
            DOM.inspInboundDateInput.classList.remove('bg-white');
        }
        
        // 🚨 완료된 항목이면 loadCompletedItemDetails가 상세 내용을 채울 것이므로 여기서는 수량 덮어쓰기 안 함
        if (matchedItem.status !== '완료' && DOM.inspInboundQtyInput) {
             DOM.inspInboundQtyInput.value = matchedItem.qty > 0 ? matchedItem.qty : '';
        }

    } else {
        // 매칭되는 항목이 없으면 일반 모드
        currentTodoIndex = -1; 
        resetEditingState(); // 신규 입력이므로 수정 모드 해제
        
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';

        if (DOM.inspInboundDateInput) {
            DOM.inspInboundDateInput.readOnly = false;
            DOM.inspInboundDateInput.classList.remove('bg-gray-100');
            DOM.inspInboundDateInput.classList.add('bg-white');
            if (!DOM.inspInboundDateInput.value) {
                DOM.inspInboundDateInput.value = getTodayDateString();
            }
        }
        if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = '';
    }

    DOM.inspHistoryReport.classList.remove('hidden');
    DOM.inspCurrentInputArea.classList.remove('hidden');
    DOM.inspAlertBox.classList.add('hidden');
    DOM.inspReportTitle.textContent = targetProductName;
    
    // 신규 모드일 경우에만 체크리스트 초기화 (수정 모드일 땐 데이터 로드됨)
    if (editingLogIndex === -1) {
        const selects = document.querySelectorAll('#insp-current-input-area select');
        selects.forEach(sel => sel.value = ""); 
    }

    try {
        const docRef = doc(State.db, 'product_history', targetProductName);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            DOM.inspReportCount.textContent = data.totalInbound || 0;
            DOM.inspReportDate.textContent = data.lastInspectionDate || '-';

            let specialIssues = [];
            
            if (data.logs && data.logs.length > 0) {
                specialIssues = data.logs
                    .filter(log => {
                        const hasDefects = log.status === '불량' || (log.defects && log.defects.length > 0);
                        const hasNote = log.note && log.note.trim() !== '';
                        return hasDefects || hasNote;
                    })
                    .map(log => {
                        const date = log.date || log.inboundDate || '날짜미상';
                        const defectStr = (log.defects && log.defects.length > 0) ? log.defects.join(', ') : '';
                        const noteStr = log.note ? `[메모: ${log.note}]` : '';
                        const content = [defectStr, noteStr].filter(Boolean).join(' ');
                        return `${date}: ${content}`;
                    });
            } 
            else if (data.defectSummary && data.defectSummary.length > 0) {
                specialIssues = data.defectSummary;
            }

            if (specialIssues.length > 0) {
                DOM.inspAlertBox.classList.remove('hidden');
                const recentIssues = specialIssues.slice(-5).reverse();
                DOM.inspAlertMsg.textContent = `최근 특이사항: ${recentIssues[0]}`;
                
                // 알림은 신규 검수일 때만 띄움
                if (editingLogIndex === -1) {
                    setTimeout(() => {
                        alert(`🚨 [특이사항 알림] 🚨\n\n이 상품은 ${specialIssues.length}건의 특이사항(불량/메모) 기록이 있습니다.\n검수 시 아래 내용을 확인해주세요.\n\n[최근 기록]\n- ${recentIssues.join('\n- ')}`);
                    }, 200);
                }
            }
        } else {
            DOM.inspReportCount.textContent = '0 (신규)';
            if (editingLogIndex === -1) showToast('신규 상품입니다.');
        }
    } catch (e) {
        console.error("Error searching product history:", e);
        showToast("이력 조회 중 오류가 발생했습니다.", true);
    }
};

export const saveInspectionAndNext = async () => {
    const productName = DOM.inspProductNameInput.value.trim();
    if (!productName) {
        showToast('상품 조회를 먼저 진행해주세요.', true);
        return;
    }

    const checklist = {
        thickness: DOM.inspCheckThickness.value,
        fabric: DOM.inspCheckFabric.value,
        color: DOM.inspCheckColor.value,
        distortion: DOM.inspCheckDistortion.value,
        unraveling: DOM.inspCheckUnraveling.value,
        finishing: DOM.inspCheckFinishing.value,
        zipper: DOM.inspCheckZipper.value,
        button: DOM.inspCheckButton.value,
        lining: DOM.inspCheckLining.value,
        pilling: DOM.inspCheckPilling.value,
        dye: DOM.inspCheckDye.value
    };

    if (checklist.thickness === '' || Object.values(checklist).some(v => v === "" || v === null)) {
        alert("⚠️ 모든 품질 체크리스트 항목을 확인하고 선택해주세요.");
        return;
    }

    const inboundDate = DOM.inspInboundDateInput.value.trim() || getTodayDateString();
    const inboundQty = DOM.inspInboundQtyInput.value.trim();
    const note = DOM.inspNotesInput.value.trim();

    let currentItem = null;
    if (currentTodoIndex >= 0 && State.appState.inspectionList[currentTodoIndex]) {
        currentItem = State.appState.inspectionList[currentTodoIndex];
    }

    const defectsFound = [];
    const NORMAL_VALUES = ['정상', '양호', '동일', '없음', '해당없음'];
    
    const labelMap = {
        fabric: '원단', color: '컬러', distortion: '뒤틀림',
        unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추',
        lining: '안감', pilling: '보풀', dye: '이염'
    };

    Object.entries(checklist).forEach(([key, value]) => {
        if (key === 'thickness') return;
        if (!NORMAL_VALUES.includes(value)) {
            defectsFound.push(`${labelMap[key] || key}(${value})`);
        }
    });

    const status = defectsFound.length > 0 ? '불량' : '정상';
    const today = getTodayDateString();
    const nowTime = getCurrentTime();

    const inspectionRecord = {
        date: today,
        time: nowTime,
        inspector: State.appState.currentUser || 'Unknown',
        inboundDate: inboundDate, 
        inboundQty: Number(inboundQty) || 0,
        
        option: currentItem ? currentItem.option : '-',
        code: currentItem ? currentItem.code : '-',
        supplierName: currentItem ? currentItem.supplierName : '-', 
        
        location: currentItem ? currentItem.location : '-',
        packingDate: currentItem ? currentItem.packingDate : '-',

        checklist,
        defects: defectsFound,
        note,
        status,
        image: currentImageBase64 || null
    };

    const btn = document.getElementById('insp-save-next-btn');
    if(btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

    try {
        const docRef = doc(State.db, 'product_history', productName);
        
        // ✅ [수정] 수정 모드인지 확인
        if (editingLogIndex !== -1) {
            // 1. 기존 문서를 읽어서 로그 배열 전체를 수정
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                const logs = data.logs || [];
                
                // 수정할 인덱스 유효성 확인
                if (editingLogIndex >= 0 && editingLogIndex < logs.length) {
                    // 기존 로그 정보 유지하면서 내용 업데이트
                    // (작성일/시간은 업데이트 시점으로 변경)
                    logs[editingLogIndex] = {
                        ...logs[editingLogIndex],
                        ...inspectionRecord
                    };
                    
                    // 불량 요약 업데이트
                    const newDefectSummary = logs
                        .filter(l => l.defects && l.defects.length > 0)
                        .map(l => `${l.date}: ${l.defects.join(', ')}`);

                    await updateDoc(docRef, { 
                        logs: logs,
                        defectSummary: newDefectSummary,
                        updatedAt: serverTimestamp()
                    });
                    
                    showToast(`'${productName}' 검수 기록이 수정되었습니다.`);
                }
            }
        } else {
            // 2. 신규 저장 (기존 로직)
            const updates = {
                lastInspectionDate: today,
                totalInbound: increment(1),
                logs: arrayUnion(inspectionRecord),
                updatedAt: serverTimestamp()
            };

            if (currentItem) {
                updates.lastCode = currentItem.code;
                updates.lastOption = currentItem.option;
                updates.lastSupplierName = currentItem.supplierName; 
            }

            if (defectsFound.length > 0) {
                const defectSummaryStr = `${today}: ${defectsFound.join(', ')}`;
                updates.defectSummary = arrayUnion(defectSummaryStr);
            }

            await setDoc(docRef, updates, { merge: true });
            
            // 오늘 검수 리스트에 추가 (UI용) - 신규일 때만
            todayInspectionList.unshift({
                productName,
                inboundDate,
                status,
                defects: defectsFound,
                note,
                time: nowTime
            });
            showToast(`'${productName}' 저장 완료!`);
        }

        // 리스트 상태 업데이트 ('완료' 처리)
        const list = [...State.appState.inspectionList];
        if (currentTodoIndex >= 0 && list[currentTodoIndex]) {
            list[currentTodoIndex].status = '완료';
            await updateDailyData({ inspectionList: list });
        }

        renderTodayInspectionList();
        
        // 폼 리셋 및 다음 단계
        resetInspectionForm(true);
        resetEditingState();
        
        // 신규 입력이었다면 다음 항목으로 자동 이동
        if (editingLogIndex === -1 && currentTodoIndex >= 0 && currentTodoIndex < list.length - 1) {
            selectTodoItem(currentTodoIndex + 1);
        } else {
            // 마지막이거나 수정 모드였으면 완료 후 대기
            if (editingLogIndex === -1) {
                showToast("리스트의 마지막 상품입니다.");
                DOM.inspHistoryReport.classList.add('hidden');
                DOM.inspCurrentInputArea.classList.add('hidden');
                currentTodoIndex = -1;
            }
        }

    } catch (e) {
        console.error("Error saving inspection:", e);
        showToast("저장 중 오류가 발생했습니다.", true);
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = `<span>검수 완료 및 저장</span>`; }
    }
};

const resetInspectionForm = (clearProductName = false) => {
    if (clearProductName) DOM.inspProductNameInput.value = '';
    DOM.inspInboundQtyInput.value = '';
    DOM.inspNotesInput.value = '';
    
    if (DOM.inspCheckThickness) DOM.inspCheckThickness.value = '';

    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';
    
    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = ""); 
};

// 금일 목록 렌더링
export const renderTodayInspectionList = () => {
    if (!DOM.inspTodayListBody) return;
    DOM.inspTodayCount.textContent = todayInspectionList.length;
    DOM.inspTodayListBody.innerHTML = '';

    if (todayInspectionList.length === 0) {
        DOM.inspTodayListBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-400 text-xs">아직 검수된 상품이 없습니다.</td></tr>';
        return;
    }

    todayInspectionList.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'bg-white border-b hover:bg-gray-50';
        
        const statusBadge = item.status === '정상' 
            ? `<span class="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-bold">정상</span>`
            : `<span class="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs font-bold">불량</span>`;

        let detailText = item.note || '';
        if (item.defects.length > 0) {
            detailText = `<span class="text-red-600 font-bold">${item.defects.join(', ')}</span> ` + detailText;
        }
        if (!detailText) detailText = '<span class="text-gray-300">-</span>';

        tr.innerHTML = `
            <td class="px-4 py-2 font-medium text-gray-900">${item.productName}</td>
            <td class="px-4 py-2 text-gray-600 text-xs">${item.inboundDate || '-'}</td>
            <td class="px-4 py-2 text-sm">${statusBadge} <span class="ml-1 text-xs">${detailText}</span></td>
            <td class="px-4 py-2 text-right text-gray-500 text-xs font-mono">${item.time}</td>
        `;
        DOM.inspTodayListBody.appendChild(tr);
    });
};

export const clearTodayList = () => {
    todayInspectionList = [];
    renderTodayInspectionList();
};

// 전체 검수 이력 조회
export const loadAllInspectionHistory = async () => {
    const container = DOM.inspectionHistoryViewContainer;
    if (!container) return;
    
    container.innerHTML = '<div class="text-center text-gray-500 py-10 flex flex-col items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>검수 이력을 불러오는 중입니다...</div>';

    try {
        const colRef = collection(State.db, 'product_history');
        const snapshot = await getDocs(colRef);
        
        const historyData = [];
        snapshot.forEach(doc => {
            historyData.push({
                id: doc.id, 
                ...doc.data()
            });
        });

        renderInspectionHistoryTable(historyData);
    } catch (e) {
        console.error("Error loading all inspection history:", e);
        container.innerHTML = '<div class="text-center text-red-500 py-10">데이터를 불러오는 중 오류가 발생했습니다.</div>';
        showToast("검수 이력 로딩 실패", true);
    }
};

// 상품별 상세 로그 조회
export const loadInspectionLogs = async (productName) => {
    if (!productName) return;
    
    if (DOM.inspectionLogManagerModal) DOM.inspectionLogManagerModal.classList.remove('hidden');
    if (DOM.inspectionLogProductName) DOM.inspectionLogProductName.textContent = productName;
    if (DOM.inspectionLogTableBody) DOM.inspectionLogTableBody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-500">로딩 중...</td></tr>';

    try {
        const docRef = doc(State.db, 'product_history', productName);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            currentProductLogs = data.logs || [];
            renderInspectionLogTable(currentProductLogs, productName);
        } else {
            currentProductLogs = [];
            renderInspectionLogTable([], productName);
        }
    } catch (e) {
        console.error("Error loading inspection logs:", e);
        showToast("상세 이력을 불러오는 중 오류가 발생했습니다.", true);
    }
};

export const prepareEditInspectionLog = (productName, index) => {
    const log = currentProductLogs[index];
    if (!log) return;

    if (DOM.editInspProductName) DOM.editInspProductName.value = productName;
    if (DOM.editInspDateTime) DOM.editInspDateTime.value = `${log.date} ${log.time}`;
    
    if (DOM.editInspPackingNo) DOM.editInspPackingNo.value = log.inboundDate || log.packingNo || '';
    
    if (DOM.editInspInboundQty) DOM.editInspInboundQty.value = log.inboundQty || 0;
    if (DOM.editInspNotes) DOM.editInspNotes.value = log.note || '';
    if (DOM.editInspLogIndex) DOM.editInspLogIndex.value = index;
    
    if (DOM.editInspSupplierName) DOM.editInspSupplierName.value = log.supplierName || '';

    const checklist = log.checklist || {};
    const setSelect = (dom, val) => { if (dom) dom.value = val || (dom.options[0]?.value || ''); };
    
    if (DOM.editInspCheckThickness) DOM.editInspCheckThickness.value = checklist.thickness || ''; 
    
    setSelect(DOM.editInspCheckFabric, checklist.fabric);
    setSelect(DOM.editInspCheckColor, checklist.color);
    setSelect(DOM.editInspCheckDistortion, checklist.distortion);
    setSelect(DOM.editInspCheckUnraveling, checklist.unraveling);
    setSelect(DOM.editInspCheckFinishing, checklist.finishing);
    setSelect(DOM.editInspCheckZipper, checklist.zipper);
    setSelect(DOM.editInspCheckButton, checklist.button);
    setSelect(DOM.editInspCheckLining, checklist.lining);
    setSelect(DOM.editInspCheckPilling, checklist.pilling);
    setSelect(DOM.editInspCheckDye, checklist.dye);

    if (DOM.inspectionLogEditorModal) DOM.inspectionLogEditorModal.classList.remove('hidden');
};

export const updateInspectionLog = async () => {
    const productName = DOM.editInspProductName.value;
    const index = parseInt(DOM.editInspLogIndex.value, 10);
    
    if (!productName || isNaN(index) || !currentProductLogs[index]) return;

    const checklist = {
        thickness: DOM.editInspCheckThickness.value,
        fabric: DOM.editInspCheckFabric.value,
        color: DOM.editInspCheckColor.value,
        distortion: DOM.editInspCheckDistortion.value,
        unraveling: DOM.editInspCheckUnraveling.value,
        finishing: DOM.editInspCheckFinishing.value,
        zipper: DOM.editInspCheckZipper.value,
        button: DOM.editInspCheckButton.value,
        lining: DOM.editInspCheckLining.value,
        pilling: DOM.editInspCheckPilling.value,
        dye: DOM.editInspCheckDye.value
    };

    const defectsFound = [];
    const NORMAL_VALUES = ['정상', '양호', '동일', '없음', '해당없음'];
    const labelMap = {
        fabric: '원단', color: '컬러', distortion: '뒤틀림',
        unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추',
        lining: '안감', pilling: '보풀', dye: '이염'
    };
    Object.entries(checklist).forEach(([key, value]) => {
        if (key === 'thickness') return;
        if (!NORMAL_VALUES.includes(value)) {
            defectsFound.push(`${labelMap[key] || key}(${value})`);
        }
    });

    const updatedLog = {
        ...currentProductLogs[index], 
        inboundDate: DOM.editInspPackingNo.value, 
        inboundQty: Number(DOM.editInspInboundQty.value) || 0,
        supplierName: DOM.editInspSupplierName.value, 
        checklist: checklist,
        defects: defectsFound,
        note: DOM.editInspNotes.value,
        status: defectsFound.length > 0 ? '불량' : '정상'
    };

    currentProductLogs[index] = updatedLog;

    try {
        const docRef = doc(State.db, 'product_history', productName);
        const newDefectSummary = currentProductLogs
            .filter(l => l.defects && l.defects.length > 0)
            .map(l => `${l.date}: ${l.defects.join(', ')}`);

        const updates = {
            logs: currentProductLogs,
            defectSummary: newDefectSummary,
        };
        
        if (index === currentProductLogs.length - 1) {
            updates.lastSupplierName = updatedLog.supplierName;
            updates.lastCode = updatedLog.code;
            updates.lastOption = updatedLog.option;
        }
        
        await updateDoc(docRef, updates);

        showToast("기록이 수정되었습니다.");
        DOM.inspectionLogEditorModal.classList.add('hidden');
        renderInspectionLogTable(currentProductLogs, productName);

    } catch (e) {
        console.error("Error updating log:", e);
        showToast("수정 중 오류가 발생했습니다.", true);
    }
};

export const deleteInspectionLog = async () => {
    const productName = DOM.editInspProductName.value;
    const index = parseInt(DOM.editInspLogIndex.value, 10);

    if (!productName || isNaN(index)) return;
    if (!confirm("정말 이 상세 기록을 삭제하시겠습니까?")) return;

    currentProductLogs.splice(index, 1);

    try {
        const docRef = doc(State.db, 'product_history', productName);
        const newDefectSummary = currentProductLogs
            .filter(l => l.defects && l.defects.length > 0)
            .map(l => `${l.date}: ${l.defects.join(', ')}`);
        
        const updates = {
            logs: currentProductLogs,
            defectSummary: newDefectSummary,
            totalInbound: increment(-1) 
        };
        
        if (currentProductLogs.length > 0) {
            const lastLog = currentProductLogs[currentProductLogs.length - 1];
            updates.lastSupplierName = lastLog.supplierName || '-'; 
            updates.lastCode = lastLog.code || '-';
            updates.lastOption = lastLog.option || '-';
        } else {
            updates.lastSupplierName = '-';
            updates.lastCode = '-';
            updates.lastOption = '-';
        }

        await updateDoc(docRef, updates);

        showToast("기록이 삭제되었습니다.");
        DOM.inspectionLogEditorModal.classList.add('hidden');
        renderInspectionLogTable(currentProductLogs, productName);

    } catch (e) {
        console.error("Error deleting log:", e);
        showToast("삭제 중 오류가 발생했습니다.", true);
    }
};

export const deleteProductHistory = async (productName) => {
    if (!productName) return false;
    if (!confirm(`정말 '${productName}' 상품의 모든 검수 이력을 삭제하시겠습니까?\n(이 작업은 복구할 수 없습니다)`)) return false;

    try {
        const docRef = doc(State.db, 'product_history', productName);
        await deleteDoc(docRef);
        showToast(`'${productName}' 상품 및 이력이 모두 삭제되었습니다.`);
        return true; 
    } catch (e) {
        console.error("Error deleting product:", e);
        showToast("상품 삭제 중 오류가 발생했습니다.", true);
        return false;
    }
};