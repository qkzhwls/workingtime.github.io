// === js/inspection-logic.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { updateDailyData } from './app-data.js'; 
import { showToast, getCurrentTime, getTodayDateString } from './utils.js';
import { doc, getDoc, setDoc, updateDoc, arrayUnion, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 분리된 모듈 가져오기
import { currentImageBase64, clearImageState, setCurrentImageBase64 } from './inspection-media.js';

// 상태 변수
export let todayInspectionList = [];
export let currentTodoIndex = -1;
export let editingLogIndex = -1;

export const getUniqueInboundCount = (logsArray) => {
    const validDates = logsArray.map(l => l.date).filter(d => d && !d.includes('사전등록'));
    return new Set(validDates).size;
};

export const resetEditingState = () => {
    editingLogIndex = -1;
    const btn = document.getElementById('insp-save-next-btn');
    if (btn) {
        btn.innerHTML = `<span>검수 완료 및 저장</span><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0 1 18 0Z" /></svg>`;
        btn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        btn.classList.add('bg-green-600', 'hover:bg-green-700');
    }
    clearImageState();
};

export const initializeInspectionSession = async () => {
    todayInspectionList = [];
    currentTodoIndex = -1;
    setCurrentImageBase64(null);
    resetEditingState(); 
    
    if (DOM.inspProductNameInput) DOM.inspProductNameInput.value = '';
    const qtyInput = document.getElementById('insp-inbound-qty');
    if (qtyInput) qtyInput.value = '';
    
    const sampleQtyInput = document.getElementById('insp-sample-qty');
    if (sampleQtyInput) sampleQtyInput.value = '1';

    const notesInput = document.getElementById('insp-notes');
    if (notesInput) notesInput.value = '';
    const thickInput = document.getElementById('insp-check-thickness');
    if (thickInput) thickInput.value = '';
    
    const packingDateInput = document.getElementById('insp-packing-date');
    if (packingDateInput) packingDateInput.value = '';

    const inboundDateInput = document.getElementById('insp-inbound-date');
    if (inboundDateInput) {
        inboundDateInput.value = getTodayDateString();
    }

    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';
    
    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = ""); 
    
    if (DOM.inspImagePreviewBox) DOM.inspImagePreviewBox.classList.add('hidden');
    if (DOM.inspImageInput) DOM.inspImageInput.value = '';

    if (DOM.inspHistoryReport) DOM.inspHistoryReport.classList.add('hidden');
    if (DOM.inspCurrentInputArea) DOM.inspCurrentInputArea.classList.add('hidden');
    if (DOM.inspAlertBox) DOM.inspAlertBox.classList.add('hidden');
    
    renderTodayInspectionList();

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
        
        if (DOM.inspProductNameInput) DOM.inspProductNameInput.value = '';
        const qtyInput = document.getElementById('insp-inbound-qty');
        if (qtyInput) qtyInput.value = '';
        const sampleQtyInput = document.getElementById('insp-sample-qty');
        if (sampleQtyInput) sampleQtyInput.value = '1';

        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';
        
        currentTodoIndex = -1;
        resetEditingState(); 

        showToast("검수 리스트가 초기화되었습니다.");
    } catch (e) {
        console.error("Error deleting list:", e);
        showToast("리스트 삭제 중 오류가 발생했습니다.", true);
    }
};

export const deleteHistoryInspectionList = async (dateKey) => {
    if (!dateKey) return false;
    if (!confirm(`${dateKey} 출고일자 리스트를 삭제하시겠습니까?\n(이미 완료된 검수 이력 데이터는 삭제되지 않습니다)`)) {
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

export const openInspectionListWindow = () => {
    const list = State.appState.inspectionList || [];
    if (list.length === 0) {
        showToast("리스트 데이터가 없습니다.", true);
        return;
    }

    const packingDate = list[0].packingDate || getTodayDateString();
    const existingModal = document.getElementById('dynamic-inspection-list-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'dynamic-inspection-list-modal';
    modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-90 flex items-center justify-center z-[200] p-2';

    const rowsHtml = list.map((item, idx) => {
        const isCompleted = item.status === '완료';
        const trClass = isCompleted ? 'bg-gray-100 text-gray-400' : 'bg-white hover:bg-blue-50 cursor-pointer border-b border-gray-100';
        const statusBadge = isCompleted ? '<span class="text-green-600 font-bold text-xs">완료</span>' : '<span class="text-gray-500 text-xs">대기</span>';
        const onClickAttr = `data-index="${idx}"`;
        const locInfo = item.location ? `<div class="text-xs font-bold text-indigo-600">📦 ${item.location}</div>` : '';
        const sampleInfo = item.sampleLocation ? `<div class="text-xs font-bold text-red-600 mt-0.5">📌 샘플: ${item.sampleLocation}</div>` : '';

        return `
            <tr class="${trClass} transition" ${onClickAttr}>
                <td class="px-2 py-3 align-top w-16 text-center">${locInfo}${sampleInfo}</td>
                <td class="px-2 py-3 align-top">
                    <div class="text-base font-medium text-gray-800 leading-tight">${item.name}</div>
                    <div class="text-sm text-gray-500 mt-1">${item.option || '-'}</div>
                    <div class="text-xs text-gray-400 mt-0.5 font-mono">${item.code || ''}</div>
                </td>
                <td class="px-2 py-3 align-top text-center w-12"><div class="text-base font-bold text-gray-700">${item.qty}</div></td>
                <td class="px-2 py-3 align-top text-center w-12">${statusBadge}</td>
            </tr>
        `;
    }).join('');

    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden animate-fade-in-up">
            <div class="p-4 bg-indigo-600 text-white flex justify-between items-center shadow-md shrink-0">
                <div>
                    <h2 class="text-lg font-bold flex items-center gap-2">
                        📋 검수 대기 리스트
                        <span class="bg-white text-indigo-600 text-xs px-2 py-0.5 rounded-full font-extrabold">${list.length}</span>
                    </h2>
                    <p class="text-xs text-indigo-200 mt-1">📅 출고일자: <span class="font-bold text-white">${packingDate}</span></p>
                </div>
                <button id="close-dynamic-modal-btn" class="text-white hover:text-gray-200 bg-white/20 hover:bg-white/30 rounded-full p-2 transition">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
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
                    <tbody class="divide-y divide-gray-200 bg-white">${rowsHtml}</tbody>
                </table>
            </div>
            <div class="p-3 bg-gray-100 text-center border-t border-gray-200 text-xs text-gray-500 shrink-0">
                항목을 클릭하면 입력창에 자동 선택됩니다.
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('close-dynamic-modal-btn').addEventListener('click', () => modal.remove());
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
    const todoArea = document.getElementById('insp-todo-list-area');
    const todoBody = document.getElementById('insp-todo-list-body');
    if (!todoArea || !todoBody) return;
    
    if (list.length > 0) {
        todoArea.classList.remove('hidden');
    } else {
        todoArea.classList.add('hidden');
        return;
    }

    todoBody.innerHTML = '';
    list.forEach((item, idx) => {
        const tr = document.createElement('tr');
        const isCompleted = item.status === '완료';
        tr.className = `transition border-b last:border-0 cursor-pointer ${isCompleted ? 'bg-gray-50 hover:bg-gray-100' : 'hover:bg-blue-50'}`;
        
        const statusColor = isCompleted ? 'text-green-600 font-bold' : 'text-gray-400';
        const locationInfo = item.location ? `<span class="text-indigo-600 font-bold bg-indigo-50 px-1 rounded">📦 ${item.location}</span>` : '';
        const sampleInfo = item.sampleLocation ? `<span class="text-red-600 font-bold bg-red-50 px-1 rounded ml-1">📌 샘플: ${item.sampleLocation}</span>` : '';
        const dateInfo = item.packingDate ? `<span class="text-gray-500 ml-1">📅 출고: ${item.packingDate.slice(2)}</span>` : '';
        
        tr.innerHTML = `
            <td class="px-3 py-2 font-mono text-gray-600 text-xs align-top">${item.code}</td>
            <td class="px-3 py-2 font-medium text-gray-800 align-top">
                <div class="truncate max-w-[150px]" title="${item.name}">${item.name}</div>
                <div class="text-[10px] mt-0.5 flex flex-wrap gap-1">
                    ${locationInfo}${sampleInfo}${dateInfo}
                </div>
            </td>
            <td class="px-3 py-2 text-gray-500 text-xs align-top">${item.option}</td>
            <td class="px-3 py-2 text-right text-xs ${statusColor} align-top">${item.status}</td>
        `;
        
        tr.addEventListener('click', () => { selectTodoItem(idx); });
        todoBody.appendChild(tr);
    });
};

export const selectTodoItem = async (index) => {
    const item = State.appState.inspectionList[index];
    if (!item) return;

    currentTodoIndex = index; 

    if (DOM.inspProductNameInput) DOM.inspProductNameInput.value = item.name; 
    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${item.option || '-'}`;
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${item.code || '-'}`;
    
    let supplierText = `공급처: ${item.supplierName || '-'}`;
    if (item.location) supplierText += ` / 📦 Loc: ${item.location}`;
    if (item.sampleLocation) supplierText += ` / 📌 샘플: ${item.sampleLocation}`; 
    if (item.packingDate) supplierText += ` / 📅 출고: ${item.packingDate}`;
    
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = supplierText; 
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${item.thickness || '-'}`;

    await searchProductHistory(); 

    if (item.status === '완료') {
        await loadCompletedInspectionData(item);
    } else {
        resetEditingState();
        
        const packingDateInput = document.getElementById('insp-packing-date');
        if (packingDateInput) packingDateInput.value = item.packingDate || '';

        const inboundDateInput = document.getElementById('insp-inbound-date');
        if (inboundDateInput) {
            inboundDateInput.value = item.inboundDate || getTodayDateString(); 
        }

        const qtyInput = document.getElementById('insp-inbound-qty');
        if (qtyInput) qtyInput.value = item.qty > 0 ? item.qty : '';
        
        const sampleQtyInput = document.getElementById('insp-sample-qty');
        if (sampleQtyInput) sampleQtyInput.value = '1';

        const notesInput = document.getElementById('insp-notes');
        if (notesInput) notesInput.value = '';
    }
    showToast(`'${item.name}' 선택됨`);
};
window.selectInspectionTodoItem = selectTodoItem;

const loadCompletedInspectionData = async (item) => {
    try {
        const docRef = doc(State.db, 'product_history', item.name);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const logs = data.logs || [];
            
            const targetLogIndex = logs.map((log, idx) => ({ ...log, originalIndex: idx }))
                                     .reverse()
                                     .findIndex(log => log.packingDate === item.packingDate);

            if (targetLogIndex !== -1) {
                const realIndex = logs.length - 1 - targetLogIndex;
                const log = logs[realIndex];

                const qtyInput = document.getElementById('insp-inbound-qty');
                if (qtyInput) qtyInput.value = log.inboundQty || 0;
                
                const sampleQtyInput = document.getElementById('insp-sample-qty');
                if (sampleQtyInput) sampleQtyInput.value = log.sampleQty || 1;

                const notesInput = document.getElementById('insp-notes');
                if (notesInput) notesInput.value = log.note || '';

                const packingDateInput = document.getElementById('insp-packing-date');
                if (packingDateInput) packingDateInput.value = log.packingDate || log.inboundDate || ''; 

                const inboundDateInput = document.getElementById('insp-inbound-date');
                if (inboundDateInput) inboundDateInput.value = log.inboundDate || ''; 

                const cl = log.checklist || {};
                const setSelect = (id, val) => { 
                    const el = document.getElementById(id);
                    if (el) el.value = val || (el.options && el.options.length > 0 ? el.options[0].value : ''); 
                };

                const thickEl = document.getElementById('insp-check-thickness');
                if (thickEl) thickEl.value = cl.thickness || '';

                setSelect('insp-check-fabric', cl.fabric);
                setSelect('insp-check-color', cl.color);
                setSelect('insp-check-distortion', cl.distortion);
                setSelect('insp-check-unraveling', cl.unraveling);
                setSelect('insp-check-finishing', cl.finishing);
                setSelect('insp-check-zipper', cl.zipper); 
                setSelect('insp-check-button', cl.button);
                setSelect('insp-check-lining', cl.lining);
                setSelect('insp-check-pilling', cl.pilling);
                setSelect('insp-check-dye', cl.dye);

                if (log.image) {
                    setCurrentImageBase64(log.image);
                    if (DOM.inspImagePreviewBox) {
                        DOM.inspImagePreviewBox.classList.remove('hidden');
                        if (DOM.inspImagePreviewImg) DOM.inspImagePreviewImg.src = log.image;
                    }
                } else {
                    clearImageState();
                }

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

export const searchProductHistory = async () => {
    let searchTerm = DOM.inspProductNameInput ? DOM.inspProductNameInput.value.trim() : document.getElementById('insp-product-name').value.trim();
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

        if(DOM.inspProductNameInput) DOM.inspProductNameInput.value = targetProductName;
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${matchedItem.option || '-'}`;
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${matchedItem.code || '-'}`;
        
        let supplierText = `공급처: ${matchedItem.supplierName || '-'}`;
        if (matchedItem.location) supplierText += ` / 📦 Loc: ${matchedItem.location}`;
        if (matchedItem.sampleLocation) supplierText += ` / 📌 샘플: ${matchedItem.sampleLocation}`;
        if (matchedItem.packingDate) supplierText += ` / 📅 출고: ${matchedItem.packingDate}`;
        
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = supplierText; 
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${matchedItem.thickness || '-'}`;
        
        const packingDateInput = document.getElementById('insp-packing-date');
        if (packingDateInput) packingDateInput.value = matchedItem.packingDate || '';

        const inboundDateInput = document.getElementById('insp-inbound-date');
        if (inboundDateInput) inboundDateInput.value = matchedItem.inboundDate || getTodayDateString();
        
        const qtyInput = document.getElementById('insp-inbound-qty');
        if (matchedItem.status !== '완료' && qtyInput) {
             qtyInput.value = matchedItem.qty > 0 ? matchedItem.qty : '';
        }
    } else {
        currentTodoIndex = -1; 
        resetEditingState(); 
        
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';

        const packingDateInput = document.getElementById('insp-packing-date');
        if (packingDateInput) packingDateInput.value = '';

        const inboundDateInput = document.getElementById('insp-inbound-date');
        if (inboundDateInput) inboundDateInput.value = getTodayDateString();

        const qtyInput = document.getElementById('insp-inbound-qty');
        if (qtyInput) qtyInput.value = '';
    }

    if(DOM.inspHistoryReport) DOM.inspHistoryReport.classList.remove('hidden');
    if(DOM.inspCurrentInputArea) DOM.inspCurrentInputArea.classList.remove('hidden');
    if(DOM.inspAlertBox) DOM.inspAlertBox.classList.add('hidden');
    if(DOM.inspReportTitle) DOM.inspReportTitle.textContent = targetProductName;
    
    if (editingLogIndex === -1) {
        const selects = document.querySelectorAll('#insp-current-input-area select');
        selects.forEach(sel => sel.value = ""); 
    }

    try {
        const docRef = doc(State.db, 'product_history', targetProductName);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            if(DOM.inspReportCount) DOM.inspReportCount.textContent = data.totalInbound || 0;
            if(DOM.inspReportDate) DOM.inspReportDate.textContent = data.lastInspectionDate || '-';

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
                if(DOM.inspAlertBox) DOM.inspAlertBox.classList.remove('hidden');
                const recentIssues = specialIssues.slice(-5).reverse();
                if(DOM.inspAlertMsg) DOM.inspAlertMsg.textContent = `최근 특이사항: ${recentIssues[0]}`;
                
                if (editingLogIndex === -1) {
                    setTimeout(() => {
                        alert(`🚨 [특이사항 알림] 🚨\n\n이 상품은 ${specialIssues.length}건의 특이사항(불량/메모) 기록이 있습니다.\n검수 시 아래 내용을 확인해주세요.\n\n[최근 기록]\n- ${recentIssues.join('\n- ')}`);
                    }, 200);
                }
            }
            
            const newBadge = document.getElementById('insp-new-product-badge');
            if (newBadge) newBadge.classList.add('hidden');

        } else {
            if(DOM.inspReportCount) DOM.inspReportCount.textContent = '0 (신규)';
            
            const newBadge = document.getElementById('insp-new-product-badge');
            if (newBadge) newBadge.classList.remove('hidden');

            if (editingLogIndex === -1) showToast('신규 상품입니다. (최초 입고)');
        }
    } catch (e) {
        console.error("Error searching product history:", e);
        showToast("이력 조회 중 오류가 발생했습니다.", true);
    }
};

export const saveInspectionAndNext = async () => {
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    };

    let productName = DOM.inspProductNameInput ? DOM.inspProductNameInput.value.trim() : getVal('insp-product-name').trim();
    if (!productName) {
        showToast('상품 조회를 먼저 진행해주세요.', true);
        return;
    }
    productName = productName.replace(/\//g, '-'); 

    const checklist = {
        thickness: getVal('insp-check-thickness'),
        fabric: getVal('insp-check-fabric'),
        color: getVal('insp-check-color'),
        distortion: getVal('insp-check-distortion'),
        unraveling: getVal('insp-check-unraveling'),
        finishing: getVal('insp-check-finishing'),
        zipper: getVal('insp-check-zipper'),
        button: getVal('insp-check-button'),
        lining: getVal('insp-check-lining'),
        pilling: getVal('insp-check-pilling'),
        dye: getVal('insp-check-dye')
    };

    if (checklist.thickness === '' || Object.values(checklist).some(v => v === "" || v === null)) {
        alert("⚠️ 모든 품질 체크리스트 항목을 확인하고 선택해주세요.");
        return;
    }

    const inboundDate = getVal('insp-inbound-date') || getTodayDateString();
    const packingDate = getVal('insp-packing-date') || '-';
    const inboundQty = getVal('insp-inbound-qty');
    const sampleQty = getVal('insp-sample-qty') || 1;
    const note = getVal('insp-notes');

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
        packingDate: packingDate, 
        inboundQty: Number(inboundQty) || 0,
        sampleQty: Number(sampleQty) || 1,
        option: currentItem ? currentItem.option : '-',
        code: currentItem ? currentItem.code : '-',
        supplierName: currentItem ? currentItem.supplierName : '-', 
        location: currentItem ? currentItem.location : '-',
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
        const docSnap = await getDoc(docRef);
        let existingLogs = [];
        if (docSnap.exists()) {
            existingLogs = docSnap.data().logs || [];
        }
        
        if (editingLogIndex !== -1) {
            if (docSnap.exists() && editingLogIndex >= 0 && editingLogIndex < existingLogs.length) {
                const oldLog = existingLogs[editingLogIndex];
                const oldSampleQty = Number(oldLog.sampleQty) || 1;
                const newSampleQtyNum = Number(sampleQty) || 1;
                const diff = newSampleQtyNum - oldSampleQty;

                existingLogs[editingLogIndex] = {
                    ...oldLog,
                    ...inspectionRecord
                };
                
                const newDefectSummary = existingLogs
                    .filter(l => l.defects && l.defects.length > 0)
                    .map(l => `${l.date}: ${l.defects.join(', ')}`);

                await updateDoc(docRef, { 
                    logs: existingLogs,
                    defectSummary: newDefectSummary,
                    totalInbound: getUniqueInboundCount(existingLogs),
                    updatedAt: serverTimestamp()
                });

                if (diff !== 0 && oldLog.date === today) {
                    try {
                        const dailyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);
                        await updateDoc(dailyDocRef, {
                            [`taskQuantities.샘플검수`]: increment(diff)
                        });
                        if (!State.appState.taskQuantities) State.appState.taskQuantities = {};
                        State.appState.taskQuantities['샘플검수'] = Math.max(0, (State.appState.taskQuantities['샘플검수'] || 0) + diff);
                    } catch(err) {
                        console.warn("샘플검수 처리량 동기화 실패:", err);
                    }
                }
                showToast(`'${productName}' 검수 기록이 수정되었습니다.`);
            }
        } else {
            const tempLogs = [...existingLogs, inspectionRecord];
            
            const updates = {
                lastInspectionDate: today,
                totalInbound: getUniqueInboundCount(tempLogs),
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
            
            try {
                const dailyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);
                const sampleQtyNum = Number(sampleQty) || 1;
                
                await updateDoc(dailyDocRef, {
                    [`taskQuantities.샘플검수`]: increment(sampleQtyNum)
                });
                
                if (!State.appState.taskQuantities) State.appState.taskQuantities = {};
                State.appState.taskQuantities['샘플검수'] = (State.appState.taskQuantities['샘플검수'] || 0) + sampleQtyNum;
            } catch(err) {
                console.warn("샘플검수 처리량 누적 실패:", err);
            }

            todayInspectionList.unshift({
                productName,
                inboundDate: packingDate !== '-' ? packingDate : inboundDate, 
                status,
                defects: defectsFound,
                note,
                time: nowTime
            });
            showToast(`'${productName}' 저장 완료!`);
        }

        // ✨ 리스트(Todo) 내역에 수량(sampleQty, inboundQty) 정보를 완벽하게 삽입/업데이트 합니다.
        // 1. 과거 히스토리 리스트 업데이트
        for (let i = 0; i < State.allHistoryData.length; i++) {
            const dayData = State.allHistoryData[i];
            if (dayData.inspectionList && dayData.inspectionList.length > 0) {
                let dayUpdated = false;
                dayData.inspectionList.forEach(pastItem => {
                    const isNameMatch = (pastItem.name === productName || pastItem.code === productName);
                    if (editingLogIndex === -1 && isNameMatch && pastItem.status !== '완료') {
                         pastItem.status = '완료';
                         pastItem.sampleQty = Number(sampleQty) || 1;
                         pastItem.inboundQty = Number(inboundQty) || pastItem.qty || 0;
                         pastItem.qty = Number(inboundQty) || pastItem.qty || 0;
                         dayUpdated = true;
                    } else if (editingLogIndex !== -1 && isNameMatch && pastItem.packingDate === packingDate) {
                         pastItem.sampleQty = Number(sampleQty) || 1;
                         pastItem.inboundQty = Number(inboundQty) || pastItem.qty || 0;
                         pastItem.qty = Number(inboundQty) || pastItem.qty || 0;
                         dayUpdated = true;
                    }
                });
                if (dayUpdated) {
                    const pastDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dayData.id);
                    updateDoc(pastDocRef, { inspectionList: dayData.inspectionList }).catch(e => console.error("과거 리스트 갱신 실패", e));
                }
            }
        }

        // 2. 금일 리스트 업데이트
        const list = [...State.appState.inspectionList];
        let isTodayListUpdated = false;
        
        if (editingLogIndex === -1 && currentTodoIndex >= 0 && list[currentTodoIndex]) {
            list[currentTodoIndex].status = '완료';
            list[currentTodoIndex].sampleQty = Number(sampleQty) || 1;
            list[currentTodoIndex].inboundQty = Number(inboundQty) || list[currentTodoIndex].qty || 0;
            list[currentTodoIndex].qty = Number(inboundQty) || list[currentTodoIndex].qty || 0;
            isTodayListUpdated = true;
        } else if (editingLogIndex !== -1) {
            list.forEach(todayItem => {
                const isTarget = (todayItem.name === productName || todayItem.code === productName) && todayItem.packingDate === packingDate;
                if (isTarget) {
                    todayItem.sampleQty = Number(sampleQty) || 1;
                    todayItem.inboundQty = Number(inboundQty) || todayItem.qty || 0;
                    todayItem.qty = Number(inboundQty) || todayItem.qty || 0;
                    isTodayListUpdated = true;
                }
            });
        }
        
        if (isTodayListUpdated) {
            await updateDailyData({ inspectionList: list });
        }

        renderTodayInspectionList();
        resetInspectionForm(true);
        resetEditingState();
        
        if (editingLogIndex === -1 && currentTodoIndex >= 0 && currentTodoIndex < list.length - 1) {
            selectTodoItem(currentTodoIndex + 1);
        } else {
            if (editingLogIndex === -1) {
                showToast("리스트의 마지막 상품입니다.");
                if(DOM.inspHistoryReport) DOM.inspHistoryReport.classList.add('hidden');
                if(DOM.inspCurrentInputArea) DOM.inspCurrentInputArea.classList.add('hidden');
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
    const pNameInput = document.getElementById('insp-product-name');
    if (clearProductName && pNameInput) pNameInput.value = '';
    
    const qtyInput = document.getElementById('insp-inbound-qty');
    if (qtyInput) qtyInput.value = '';
    
    const sampleQtyInput = document.getElementById('insp-sample-qty');
    if (sampleQtyInput) sampleQtyInput.value = '1';
    
    const notesInput = document.getElementById('insp-notes');
    if (notesInput) notesInput.value = '';
    
    const thickInput = document.getElementById('insp-check-thickness');
    if (thickInput) thickInput.value = '';

    const packingDateInput = document.getElementById('insp-packing-date');
    if (packingDateInput) packingDateInput.value = '';

    const inboundDateInput = document.getElementById('insp-inbound-date');
    if (inboundDateInput) inboundDateInput.value = getTodayDateString();

    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';
    
    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = ""); 
};

export const renderTodayInspectionList = () => {
    const tbody = document.getElementById('insp-today-list-body');
    const countEl = document.getElementById('insp-today-count');
    if (!tbody) return;
    if (countEl) countEl.textContent = todayInspectionList.length;
    tbody.innerHTML = '';

    if (todayInspectionList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-400 text-xs">아직 검수된 상품이 없습니다.</td></tr>';
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
        tbody.appendChild(tr);
    });
};

export const clearTodayList = () => {
    todayInspectionList = [];
    renderTodayInspectionList();
};

export { handleExcelUpload } from './inspection-excel.js';
export { toggleScanner, handleImageSelect, clearImageState, handleManualImageSelect, clearManualImageState } from './inspection-media.js';
export { loadAllInspectionHistory, loadInspectionLogs, prepareEditInspectionLog, updateInspectionLog, deleteInspectionLog, deleteProductHistory, savePreInspectionNote } from './inspection-editor.js';