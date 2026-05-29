// === js/listeners-history-inspection.js ===
// 설명: 이력 보기의 '검수 이력' 탭 관련 리스너 및 데이터 로직을 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';

// UI 렌더링 함수 임포트
import { 
    renderInspectionHistoryTable, 
    renderInspectionLogTable,
    renderInspectionLayout,
    renderInspectionListMode
} from './ui-history.js'; // ui-history.js를 통해 ui-history-inspection.js 함수들을 가져옴

import { setSortState } from './ui-history-inspection.js';

// 비즈니스 로직 임포트
import {
    loadInspectionLogs,
    prepareEditInspectionLog,
    updateInspectionLog,
    deleteInspectionLog,
    deleteProductHistory,
    deleteHistoryInspectionList // ✅ 추가
} from './inspection-logic.js';

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 검수 이력 데이터 캐싱용 변수
let cachedInspectionData = [];

/**
 * 검수 이력 메인 로드 함수
 * - 상품별 모드: product_history 컬렉션 조회
 * - 리스트별 모드: allHistoryData에서 inspectionList 추출
 */
export const fetchAndRenderInspectionHistory = async () => {
    const container = DOM.inspectionHistoryViewContainer;
    if (!container) return;

    // 기본 레이아웃 렌더링 (탭 버튼 등)
    renderInspectionLayout(container);

    const contentArea = document.getElementById('inspection-content-area');
    contentArea.innerHTML = '<div class="text-center text-gray-500 py-10 flex flex-col items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>데이터를 불러오는 중입니다...</div>';

    const viewMode = State.context.inspectionViewMode || 'product';

    if (viewMode === 'product') {
        // 1. 상품별 보기 모드
        try {
            const colRef = collection(State.db, 'product_history');
            const snapshot = await getDocs(colRef);

            cachedInspectionData = []; 
            snapshot.forEach(doc => {
                cachedInspectionData.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            renderInspectionHistoryTable(cachedInspectionData);
        } catch (e) {
            console.error("Error loading inspection history:", e);
            contentArea.innerHTML = '<div class="text-center text-red-500 py-10">데이터 로딩 실패</div>';
        }
    } else {
        // 2. 입고 리스트별 보기 모드
        // allHistoryData (과거+오늘)에서 inspectionList가 있는 날짜 추출
        const dateList = [];
        
        // (1) 과거 데이터 순회
        State.allHistoryData.forEach(day => {
            if (day.inspectionList && day.inspectionList.length > 0) {
                dateList.push({
                    date: day.id,
                    count: day.inspectionList.length,
                    data: day.inspectionList
                });
            }
        });

        // (2) 오늘 데이터 확인 (allHistoryData에 동기화되어 있지만 확실히 하기 위해)
        // syncTodayToHistory()가 이미 실행되었다고 가정 (탭 진입 시 loadAndRenderHistoryList 호출됨)
        
        // 날짜 내림차순 정렬
        dateList.sort((a, b) => b.date.localeCompare(a.date));

        if (dateList.length > 0) {
            // 선택된 날짜가 없으면 가장 최신 날짜 선택
            if (!State.context.selectedInspectionDate) {
                State.context.selectedInspectionDate = dateList[0].date;
            }
            
            // 선택된 날짜의 데이터 찾기
            const selectedData = dateList.find(d => d.date === State.context.selectedInspectionDate);
            
            renderInspectionListMode(dateList, selectedData ? selectedData.data : []);
        } else {
            renderInspectionListMode([], []);
        }
    }
};

export function setupHistoryInspectionListeners() {

    // 1. 탭 전환 및 리스트 선택 리스너 (이벤트 위임)
    if (DOM.inspectionHistoryViewContainer) {
        DOM.inspectionHistoryViewContainer.addEventListener('click', async (e) => {
            // A. 상단 탭 버튼 (상품별 / 리스트별)
            const tabBtn = e.target.closest('button[data-insp-tab]');
            if (tabBtn) {
                const mode = tabBtn.dataset.inspTab;
                if (State.context.inspectionViewMode !== mode) {
                    State.context.inspectionViewMode = mode;
                    State.context.selectedInspectionDate = null; // 모드 변경 시 선택 날짜 초기화
                    fetchAndRenderInspectionHistory(); // 재렌더링
                }
                return;
            }

            // B. 날짜 선택 버튼 (리스트별 보기 모드에서)
            const dateBtn = e.target.closest('.btn-select-insp-date');
            if (dateBtn) {
                const date = dateBtn.dataset.date;
                if (State.context.selectedInspectionDate !== date) {
                    State.context.selectedInspectionDate = date;
                    // 전체 리로드 대신 뷰만 갱신하면 좋겠지만, 구조상 간단히 fetchAndRender 호출
                    // (메모리상의 allHistoryData를 쓰므로 빠름)
                    fetchAndRenderInspectionHistory(); 
                }
                return;
            }

            // [신규] F. 과거 리스트 삭제 버튼
            const deleteListBtn = e.target.closest('.btn-delete-history-list');
            if (deleteListBtn) {
                const dateKey = deleteListBtn.dataset.date;
                const success = await deleteHistoryInspectionList(dateKey);
                if (success) {
                    // 삭제 성공 시 선택된 날짜 초기화 후 재렌더링
                    State.context.selectedInspectionDate = null;
                    fetchAndRenderInspectionHistory();
                }
                return;
            }

            // C. 테이블 헤더 정렬 (상품별 보기 모드에서)
            const th = e.target.closest('th[data-sort-key]');
            if (th) {
                const key = th.dataset.sortKey;
                setSortState(key); 
                renderInspectionHistoryTable(cachedInspectionData);
                return;
            }

            // D. 상세보기 (로그 관리 모달)
            const detailBtn = e.target.closest('.btn-view-detail');
            if (detailBtn) {
                const productName = detailBtn.dataset.productName;
                loadInspectionLogs(productName);
                return;
            }

            // E. 상품 전체 삭제
            const deleteProductBtn = e.target.closest('.btn-delete-product');
            if (deleteProductBtn) {
                const productName = deleteProductBtn.dataset.productName;
                const success = await deleteProductHistory(productName);
                if (success) {
                    fetchAndRenderInspectionHistory();
                }
                return;
            }
        });
    }

    // 2. 검색 입력 리스너 (상품별 보기 모드 전용)
    if (DOM.inspectionHistorySearchInput) {
        DOM.inspectionHistorySearchInput.addEventListener('input', () => {
            if (State.context.inspectionViewMode === 'product') {
                renderInspectionHistoryTable(cachedInspectionData);
            }
        });
    }

    // 3. 새로고침 버튼 리스너
    if (DOM.inspectionHistoryRefreshBtn) {
        DOM.inspectionHistoryRefreshBtn.addEventListener('click', () => {
            fetchAndRenderInspectionHistory();
        });
    }

    // 4. 상세 로그 관리 모달 내부 이벤트 (수정/삭제)
    const inspLogTableBody = document.getElementById('inspection-log-table-body');
    if (inspLogTableBody) {
        inspLogTableBody.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.btn-edit-insp-log');
            if (editBtn) {
                const index = parseInt(editBtn.dataset.index, 10);
                const productName = DOM.inspectionLogProductName.textContent;
                prepareEditInspectionLog(productName, index);
            }
        });
    }

    if (DOM.saveInspLogBtn) {
        DOM.saveInspLogBtn.addEventListener('click', async () => {
            await updateInspectionLog();
            if (State.context.activeMainHistoryTab === 'inspection' && State.context.inspectionViewMode === 'product') {
                fetchAndRenderInspectionHistory();
            }
        });
    }

    if (DOM.deleteInspLogBtn) {
        DOM.deleteInspLogBtn.addEventListener('click', async () => {
            await deleteInspectionLog();
            if (State.context.activeMainHistoryTab === 'inspection' && State.context.inspectionViewMode === 'product') {
                fetchAndRenderInspectionHistory();
            }
        });
    }
}