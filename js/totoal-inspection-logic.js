// === js/total-inspection-logic.js ===
// 설명: 전량 검수(여러 날에 걸쳐 진행되는 검수)의 누적 데이터 관리 로직

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 현재 조회된 상품의 누적 상태를 저장할 내부 변수
let currentTotalInspData = null;

// 남은 수량 실시간 계산 함수
export function updateTotalInspRemaining() {
    const totalStock = parseInt(DOM.totalInspTotalStock.value) || 0;
    const accumulated = currentTotalInspData ? currentTotalInspData.accumulatedTotal : 0;
    const todayNormal = parseInt(DOM.totalInspTodayNormal.value) || 0;
    const todayDefective = parseInt(DOM.totalInspTodayDefective.value) || 0;
    
    const totalDone = accumulated + todayNormal + todayDefective;
    const remaining = totalStock - totalDone;
    
    DOM.totalInspRemaining.textContent = remaining >= 0 ? remaining : 0;
    if (remaining < 0) {
        DOM.totalInspRemaining.classList.add('text-red-500');
    } else {
        DOM.totalInspRemaining.classList.remove('text-red-500');
    }
}

// 상품명 기반 누적 데이터 조회
export async function searchTotalInspection() {
    const productName = DOM.totalInspProductName.value.trim();
    if (!productName) {
        showToast('상품명을 입력해주세요.', true);
        return;
    }

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'total_inspections_accumulated', productName);
        const docSnap = await getDoc(docRef);

        DOM.totalInspContentArea.classList.remove('hidden');

        if (docSnap.exists()) {
            // 기존 기록이 있는 경우 (이어서 진행)
            currentTotalInspData = docSnap.data();
            
            DOM.totalInspReason.value = currentTotalInspData.reason || '';
            DOM.totalInspTotalStock.value = currentTotalInspData.totalStock || 0;
            DOM.totalInspAccumulated.textContent = currentTotalInspData.accumulatedTotal || 0;
            
            showToast('기존 검수 내역을 불러왔습니다. 이어서 입력하세요.');
        } else {
            // 처음 검수하는 경우
            currentTotalInspData = { accumulatedTotal: 0, accumulatedNormal: 0, accumulatedDefective: 0 };
            
            DOM.totalInspReason.value = '';
            DOM.totalInspTotalStock.value = '';
            DOM.totalInspAccumulated.textContent = '0';
            
            showToast('새로운 전량 검수 건입니다. 총 재고와 사유를 입력하세요.');
        }

        // 금일 입력창 초기화
        DOM.totalInspTodayNormal.value = '';
        DOM.totalInspTodayDefective.value = '';
        updateTotalInspRemaining();

    } catch (error) {
        console.error("Error searching total inspection:", error);
        showToast("데이터 조회 중 오류가 발생했습니다.", true);
    }
}

// 금일 검수량 반영 및 누적 저장
export async function saveTotalInspection() {
    const productName = DOM.totalInspProductName.value.trim();
    const reason = DOM.totalInspReason.value.trim();
    const totalStock = parseInt(DOM.totalInspTotalStock.value) || 0;
    
    const todayNormal = parseInt(DOM.totalInspTodayNormal.value) || 0;
    const todayDefective = parseInt(DOM.totalInspTodayDefective.value) || 0;
    const todayTotal = todayNormal + todayDefective;

    if (!productName || !reason || totalStock <= 0) {
        showToast('상품명, 사유, 총 재고를 정확히 입력해주세요.', true);
        return;
    }
    if (todayTotal <= 0) {
        showToast('금일 검수(정상 또는 불량) 수량을 입력해주세요.', true);
        return;
    }

    try {
        // 1. 누적 데이터 업데이트
        const newAccumulatedNormal = (currentTotalInspData.accumulatedNormal || 0) + todayNormal;
        const newAccumulatedDefective = (currentTotalInspData.accumulatedDefective || 0) + todayDefective;
        const newAccumulatedTotal = newAccumulatedNormal + newAccumulatedDefective;

        const accumulatedRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'total_inspections_accumulated', productName);
        await setDoc(accumulatedRef, {
            productName: productName,
            reason: reason,
            totalStock: totalStock,
            accumulatedNormal: newAccumulatedNormal,
            accumulatedDefective: newAccumulatedDefective,
            accumulatedTotal: newAccumulatedTotal,
            lastUpdated: serverTimestamp()
        }, { merge: true });

        // 2. 금일 히스토리 기록
        const historyRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'total_inspection_logs', `${productName}-${Date.now()}`);
        await setDoc(historyRef, {
            productName: productName,
            reason: reason,
            todayNormal: todayNormal,
            todayDefective: todayDefective,
            timestamp: serverTimestamp(),
            worker: State.auth.currentUser?.email || 'unknown'
        });

        showToast(`${productName} 전량 검수 내역이 누적 저장되었습니다.`);
        
        // 저장 완료 후 창 닫기 및 초기화
        DOM.totalInspModal.classList.add('hidden');
        DOM.totalInspContentArea.classList.add('hidden');
        DOM.totalInspProductName.value = '';

    } catch (error) {
        console.error("Error saving total inspection:", error);
        showToast("저장 중 오류가 발생했습니다.", true);
    }
}