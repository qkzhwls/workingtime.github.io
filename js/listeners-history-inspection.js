// === js/listeners-history-inspection.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';

import { 
    renderInspectionHistoryTable, 
    renderInspectionLayout,
    renderInspectionListMode
} from './ui-history.js'; 

import { 
    setSortState, 
    renderQCStatsMode, 
    currentInspTypeFilter, 
    setInspTypeFilter 
} from './ui-history-inspection.js';

import {
    loadInspectionLogs,
    prepareEditInspectionLog,
    updateInspectionLog,
    deleteInspectionLog,
    deleteProductHistory,
    deleteHistoryInspectionList,
    savePreInspectionNote,
    handleManualImageSelect, 
    clearManualImageState    
} from './inspection-logic.js';

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let cachedInspectionData = [];

export const fetchAndRenderInspectionHistory = async () => {
    const container = DOM.inspectionHistoryViewContainer;
    if (!container) return;

    renderInspectionLayout(container);

    const contentArea = document.getElementById('inspection-content-area');
    contentArea.innerHTML = '<div class="text-center text-gray-500 py-10 flex flex-col items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>데이터를 불러오는 중입니다...</div>';

    const viewMode = State.context.inspectionViewMode || 'product';

    if (viewMode === 'product' || viewMode === 'qc') {
        try {
            const colRef = collection(State.db, 'product_history');
            const snapshot = await getDocs(colRef);

            cachedInspectionData = []; 
            snapshot.forEach(doc => {
                cachedInspectionData.push({ id: doc.id, ...doc.data() });
            });
            
            if (viewMode === 'product') {
                renderInspectionHistoryTable(cachedInspectionData);
            } else if (viewMode === 'qc') {
                renderQCStatsMode(cachedInspectionData, 'month', '');
            }
        } catch (e) {
            console.error("Error loading inspection history:", e);
            contentArea.innerHTML = '<div class="text-center text-red-500 py-10">데이터 로딩 실패</div>';
        }
    } else if (viewMode === 'list') {
        const dateList = [];
        State.allHistoryData.forEach(day => {
            if (day.inspectionList && day.inspectionList.length > 0) {
                dateList.push({
                    date: day.id,
                    count: day.inspectionList.length,
                    data: day.inspectionList
                });
            }
        });

        dateList.sort((a, b) => b.date.localeCompare(a.date));

        if (dateList.length > 0) {
            if (!State.context.selectedInspectionDate) {
                State.context.selectedInspectionDate = dateList[0].date;
            }
            const selectedData = dateList.find(d => d.date === State.context.selectedInspectionDate);
            renderInspectionListMode(dateList, selectedData ? selectedData.data : []);
        } else {
            renderInspectionListMode([], []);
        }
    }
};

export function setupHistoryInspectionListeners() {

    const preModal = document.getElementById('pre-register-inspection-modal');
    if (preModal) {
        preModal.addEventListener('click', async (e) => {
            if (e.target.closest('#close-pre-insp-modal') || e.target.closest('#cancel-pre-insp-btn')) {
                preModal.classList.add('hidden');
                clearManualImageState(); 
            }
            if (e.target.closest('#save-pre-insp-btn')) {
                const success = await savePreInspectionNote();
                if (success) {
                    fetchAndRenderInspectionHistory(); 
                }
            }
            if (e.target.closest('#manual-insp-image-clear-btn')) {
                clearManualImageState();
            }
        });

        const imageInput = document.getElementById('manual-insp-image');
        if (imageInput) {
            imageInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    handleManualImageSelect(file);
                }
            });
        }
    }

    if (DOM.inspectionHistoryViewContainer) {
        
        DOM.inspectionHistoryViewContainer.addEventListener('change', (e) => {
            // ⭐ [신규] 상단 검수 유형 필터 (전체/샘플/전량) 선택 시 다시 렌더링
            if (e.target.id === 'insp-type-filter') {
                setInspTypeFilter(e.target.value);
                fetchAndRenderInspectionHistory();
                return;
            }
            if (e.target.id === 'qc-period-type') {
                renderQCStatsMode(cachedInspectionData, e.target.value, '');
                return;
            }
        });

        DOM.inspectionHistoryViewContainer.addEventListener('click', async (e) => {
            
            const addPreBtn = e.target.closest('#btn-add-pre-inspection');
            if (addPreBtn) {
                const modal = document.getElementById('pre-register-inspection-modal');
                if (modal) {
                    modal.classList.remove('hidden');
                    
                    const getEl = (id) => document.getElementById(id);
                    if (getEl('manual-insp-type')) getEl('manual-insp-type').value = 'sample'; // 기본값 세팅
                    if (getEl('manual-insp-product-name')) getEl('manual-insp-product-name').value = '';
                    if (getEl('manual-insp-code')) getEl('manual-insp-code').value = '';
                    if (getEl('manual-insp-option')) getEl('manual-insp-option').value = '';
                    if (getEl('manual-insp-qty')) getEl('manual-insp-qty').value = '';
                    if (getEl('manual-insp-check-thickness')) getEl('manual-insp-check-thickness').value = '';
                    if (getEl('manual-insp-supplier')) getEl('manual-insp-supplier').value = '';
                    if (getEl('manual-insp-note')) getEl('manual-insp-note').value = '';
                    if (getEl('manual-insp-packing-date')) getEl('manual-insp-packing-date').value = '';
                    
                    if (getEl('manual-insp-inbound-date')) getEl('manual-insp-inbound-date').value = getTodayDateString();
                    
                    const selects = modal.querySelectorAll('select:not(#manual-insp-type)'); // 유형 셀렉트 제외 초기화
                    selects.forEach(sel => sel.value = "정상"); 
                    
                    clearManualImageState();
                }
                return;
            }

            const refreshQcBtn = e.target.closest('#btn-refresh-qc');
            if (refreshQcBtn) {
                const typeSelect = document.getElementById('qc-period-type');
                const valueSelect = document.getElementById('qc-period-value');
                if (typeSelect && valueSelect) {
                    renderQCStatsMode(cachedInspectionData, typeSelect.value, valueSelect.value);
                }
                return;
            }

            const deleteListBtn = e.target.closest('.btn-delete-history-list');
            if (deleteListBtn) {
                const dateKey = deleteListBtn.dataset.date;
                const success = await deleteHistoryInspectionList(dateKey);
                if (success) {
                    State.context.selectedInspectionDate = null;
                    fetchAndRenderInspectionHistory();
                }
                return;
            }

            const deleteProductBtn = e.target.closest('.btn-delete-product');
            if (deleteProductBtn) {
                const productName = deleteProductBtn.dataset.productName;
                const success = await deleteProductHistory(productName);
                if (success) {
                    fetchAndRenderInspectionHistory();
                }
                return;
            }

            const closeExpandedBtn = e.target.closest('.btn-close-expanded');
            if (closeExpandedBtn) {
                closeExpandedBtn.closest('.expanded-detail-row').remove();
                return;
            }

            const editBtn = e.target.closest('.btn-edit-insp-log');
            if (editBtn) {
                const index = parseInt(editBtn.dataset.index, 10);
                const productName = editBtn.dataset.productName;
                prepareEditInspectionLog(productName, index);
                return;
            }

            const tabBtn = e.target.closest('button[data-insp-tab]');
            if (tabBtn) {
                const mode = tabBtn.dataset.inspTab;
                if (State.context.inspectionViewMode !== mode) {
                    State.context.inspectionViewMode = mode;
                    State.context.selectedInspectionDate = null; 
                    fetchAndRenderInspectionHistory(); 
                }
                return;
            }

            const dateBtn = e.target.closest('.btn-select-insp-date');
            if (dateBtn) {
                const date = dateBtn.dataset.date;
                if (State.context.selectedInspectionDate !== date) {
                    State.context.selectedInspectionDate = date;
                    fetchAndRenderInspectionHistory(); 
                }
                return;
            }

            const th = e.target.closest('th[data-sort-key]');
            if (th) {
                const key = th.dataset.sortKey;
                setSortState(key); 
                renderInspectionHistoryTable(cachedInspectionData);
                return;
            }

            const detailBtn = e.target.closest('.btn-view-detail');
            if (detailBtn) {
                const tr = detailBtn.tagName === 'TR' ? detailBtn : detailBtn.closest('tr');
                const productName = tr.dataset.productName;

                const nextTr = tr.nextElementSibling;
                if (nextTr && nextTr.classList.contains('expanded-detail-row')) {
                    nextTr.remove(); 
                    return;
                }

                loadInspectionLogs(productName, tr);
                return;
            }
        });
    }

    if (DOM.inspectionHistorySearchInput) {
        DOM.inspectionHistorySearchInput.addEventListener('input', () => {
            if (State.context.inspectionViewMode === 'product') {
                renderInspectionHistoryTable(cachedInspectionData);
            }
        });
    }

    if (DOM.inspectionHistoryRefreshBtn) {
        DOM.inspectionHistoryRefreshBtn.addEventListener('click', () => {
            fetchAndRenderInspectionHistory();
        });
    }

    if (DOM.saveInspLogBtn) {
        DOM.saveInspLogBtn.addEventListener('click', async () => {
            await updateInspectionLog();
            if (State.context.activeMainHistoryTab === 'inspection') {
                fetchAndRenderInspectionHistory(); 
            }
        });
    }

    if (DOM.deleteInspLogBtn) {
        DOM.deleteInspLogBtn.addEventListener('click', async () => {
            await deleteInspectionLog();
            if (State.context.activeMainHistoryTab === 'inspection') {
                fetchAndRenderInspectionHistory();
            }
        });
    }
}