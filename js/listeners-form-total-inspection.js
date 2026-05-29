// === js/listeners-form-total-inspection.js ===
// 설명: 전량 검수 매니저 및 샘플 검수 전환 버튼 리스너

import * as DOM from './dom-elements.js';
import { 
    searchTotalInspection, 
    updateTotalInspRemaining, 
    saveTotalInspection, 
    triggerTotalInspectionFromSample 
} from './total-inspection-logic.js';

export function setupTotalInspectionListeners() {
    
    // [신규] 샘플 검수 -> 전량 검수로 데이터와 함께 창 전환
    if (DOM.inspSwitchToTotalBtn) {
        DOM.inspSwitchToTotalBtn.addEventListener('click', () => {
            triggerTotalInspectionFromSample();
        });
    }

    // [신규] 전량 검수 창에서 샘플 검수 창으로 돌아가기 (단순히 창만 닫음)
    if (DOM.totalInspBackBtn) {
        DOM.totalInspBackBtn.addEventListener('click', () => {
            DOM.totalInspModal.classList.add('hidden');
        });
    }

    // 상품 조회 (데이터 로드)
    if (DOM.totalInspSearchBtn) {
        DOM.totalInspSearchBtn.addEventListener('click', searchTotalInspection);
    }

    // 상품명 입력 후 엔터 시 자동 조회
    if (DOM.totalInspProductName) {
        DOM.totalInspProductName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') searchTotalInspection();
        });
    }

    // 수량 입력 시 실시간 '남은 수량' 계산 반영
    const quantityInputs = [DOM.totalInspTotalStock, DOM.totalInspTodayNormal, DOM.totalInspTodayDefective];
    quantityInputs.forEach(input => {
        if (input) {
            input.addEventListener('input', updateTotalInspRemaining);
        }
    });

    // 최종 누적 저장 버튼
    if (DOM.totalInspSaveBtn) {
        DOM.totalInspSaveBtn.addEventListener('click', saveTotalInspection);
    }
}