// === js/listeners-form-quantity.js ===
// 설명: 업무별 처리량 입력 모달 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js?v=202610021228';
import * as State from './state.js?v=202610021228';

export function setupFormQuantityListeners() {

    // 1. 처리량 저장 (확인) 버튼
    if (DOM.confirmQuantityBtn) {
        DOM.confirmQuantityBtn.addEventListener('click', async () => {
            const newQuantities = {};
            const confirmedZeroTasks = [];

            // 입력 필드에서 값 수집
            document.querySelectorAll('#modal-task-quantity-inputs input[type="number"]').forEach(input => {
                const taskName = input.dataset.task;
                if (taskName) {
                    newQuantities[taskName] = Number(input.value) || 0;
                }
            });

            // 0건 확인 체크박스 수집
            document.querySelectorAll('#modal-task-quantity-inputs .confirm-zero-checkbox').forEach(checkbox => {
                if (checkbox.checked) {
                    confirmedZeroTasks.push(checkbox.dataset.task);
                }
            });

            // [수정] '확정 입력' 체크박스 상태 확인 (추가된 UI 요소)
            const confirmCheckbox = document.getElementById('quantity-confirm-checkbox');
            const isConfirmedInput = confirmCheckbox ? confirmCheckbox.checked : false;

            // [수정] 상태 맵(Status Map) 생성 (모든 입력된 태스크에 대해 상태 적용)
            // 체크박스가 체크되어 있으면 'confirmed', 아니면 'estimated'(예상)
            const quantityStatuses = {};
            Object.keys(newQuantities).forEach(task => {
                quantityStatuses[task] = isConfirmedInput ? 'confirmed' : 'estimated';
            });

            // [추가] 현재 모달이 '확정(Verification)' 모드인지 확인
            const isVerifying = State.context.quantityModalContext?.isVerifyingMode;

            // 컨텍스트에 저장된 콜백 실행 (일별/이력 모드에 따라 다름)
            if (State.context.quantityModalContext && typeof State.context.quantityModalContext.onConfirm === 'function') {
                // [중요] onConfirm 콜백에 데이터와 함께 '상태 정보(quantityStatuses)'도 4번째 인자로 전달
                await State.context.quantityModalContext.onConfirm(newQuantities, confirmedZeroTasks, isVerifying, quantityStatuses);
            }

            if (DOM.quantityModal) DOM.quantityModal.classList.add('hidden');
        });
    }

    // 2. 처리량 입력 취소 버튼
    if (DOM.cancelQuantityBtn) {
        DOM.cancelQuantityBtn.addEventListener('click', () => {
            if (State.context.quantityModalContext && typeof State.context.quantityModalContext.onCancel === 'function') {
                State.context.quantityModalContext.onCancel();
            }
            if (DOM.quantityModal) DOM.quantityModal.classList.add('hidden');
        });
    }
}