// === js/listeners-form-inspection.js ===
// 설명: '검수 매니저(입력)' 모달 내부의 리스너를 담당합니다.

import * as DOM from './dom-elements.js?v=202610021122';
import { 
    searchProductHistory, 
    saveInspectionAndNext, 
    toggleScanner, 
    handleExcelUpload, 
    handleImageSelect, 
    clearImageState, 
    clearTodayList,
    deleteInspectionList,
    openInspectionListWindow
} from './inspection-logic.js?v=202610021122';

export function setupFormInspectionListeners() {

    // 1. 상품명 검색 (버튼 & 엔터키)
    if (DOM.inspSearchBtn) {
        DOM.inspSearchBtn.addEventListener('click', searchProductHistory);
    }
    if (DOM.inspProductNameInput) {
        DOM.inspProductNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') searchProductHistory();
        });
    }

    // 2. 바코드 스캐너 토글
    if (DOM.inspScanBtn) {
        DOM.inspScanBtn.addEventListener('click', toggleScanner);
    }
    if (DOM.inspCloseScannerBtn) {
        DOM.inspCloseScannerBtn.addEventListener('click', toggleScanner);
    }

    // 3. 저장 및 다음
    if (DOM.inspSaveNextBtn) {
        DOM.inspSaveNextBtn.addEventListener('click', saveInspectionAndNext);
    }

    // 4. 리스트 관리 (엑셀 업로드, 새창 열기, 삭제)
    if (DOM.inspExcelUploadInput) {
        DOM.inspExcelUploadInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleExcelUpload(e.target.files[0]);
                e.target.value = ''; // 초기화
            }
        });
    }
    if (DOM.inspOpenListWindowBtn) {
        DOM.inspOpenListWindowBtn.addEventListener('click', openInspectionListWindow);
    }
    if (DOM.inspDeleteListBtn) {
        DOM.inspDeleteListBtn.addEventListener('click', deleteInspectionList);
    }

    // 5. 이미지 업로드 및 삭제
    if (DOM.inspImageInput) {
        DOM.inspImageInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleImageSelect(e.target.files[0]);
            }
        });
    }
    if (DOM.inspRemoveImageBtn) {
        DOM.inspRemoveImageBtn.addEventListener('click', clearImageState);
    }

    // 6. 금일 목록 초기화
    if (DOM.inspClearListBtn) {
        DOM.inspClearListBtn.addEventListener('click', clearTodayList);
    }

    // 7. 전체화면 토글
    if (DOM.inspFullscreenBtn) {
        DOM.inspFullscreenBtn.addEventListener('click', () => {
            const modalContent = document.getElementById('insp-modal-content');
            const modal = document.getElementById('inspection-manager-modal');
            const header = document.getElementById('insp-modal-header');
            
            if (!modalContent || !modal) return;

            if (modalContent.classList.contains('fixed')) {
                // 복구 (기본 모달 스타일)
                modalContent.classList.remove('fixed', 'inset-0', 'h-full', 'w-full', 'rounded-none');
                modalContent.classList.add('rounded-2xl', 'max-w-7xl', 'max-h-[95vh]');

                // 부모 오버레이 복구
                modal.classList.add('p-4', 'flex', 'items-center', 'justify-center');

                // 헤더 모서리 복구
                if(header) header.classList.add('rounded-t-2xl');
            } else {
                // 전체화면
                modalContent.classList.add('fixed', 'inset-0', 'h-full', 'w-full', 'rounded-none');
                modalContent.classList.remove('rounded-2xl', 'max-w-7xl', 'max-h-[95vh]');
                
                // 부모 오버레이 스타일 제거 (꽉 채우기 위해)
                modal.classList.remove('p-4', 'flex', 'items-center', 'justify-center');

                // 헤더 모서리 제거 (꽉 찬 느낌 위해)
                if(header) header.classList.remove('rounded-t-2xl');
            }
        });
    }
}