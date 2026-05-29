// === js/total-inspection-logic.js ===
// 설명: 전량 검수(누적 데이터) 관리 및 샘플 검수 연동 로직

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';
import { doc, getDoc, setDoc, serverTimestamp, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 현재 조회된 상품의 누적 상태를 저장할 변수
let currentTotalInspData = null;
// 샘플 검수에서 전환 시 넘어온 데이터를 임시 보관
let pendingDataFromSample = null;

/**
 * [신규] 샘플 검수 -> 전량 검수로 데이터 전환 실행
 */
export async function triggerTotalInspectionFromSample() {
    const productName = DOM.inspProductNameInput.value.trim();
    if (!productName) {
        showToast('검수 중인 상품이 없습니다.', true);
        return;
    }

    // 1. 샘플 검수 UI에 표시된 상세 정보 추출
    const code = DOM.inspCodeDisplay.textContent.replace('코드: ', '').trim();
    const option = DOM.inspOptionDisplay.textContent.replace('옵션: ', '').trim();
    const supplier = DOM.inspSupplierDisplay.textContent.replace('공급처: ', '').trim();
    const inboundDate = DOM.inspInboundDateInput.value;

    // 2. 임시 보관함에 데이터 저장 (조회 시 반영됨)
    pendingDataFromSample = {
        code: code !== '-' ? code : '',
        option: option !== '-' ? option : '',
        supplier: supplier !== '-' ? supplier : '',
        inboundDate: inboundDate || '',
        location: '' // 로케이션은 전량검수 창에서 입력
    };

    // 3. 전량검수 모달 표시 (샘플검수 모달은 닫지 않음)
    if (DOM.totalInspModal) {
        DOM.totalInspModal.classList.remove('hidden');
        DOM.totalInspProductName.value = productName;
        // 즉시 데이터 조회 실행
        await searchTotalInspection();
    }
}

/**
 * 남은 수량 실시간 계산
 */
export function updateTotalInspRemaining() {
    const totalStock = parseInt(DOM.totalInspTotalStock.value) || 0;
    const accumulated = currentTotalInspData ? (currentTotalInspData.accumulatedTotal || 0) : 0;
    const todayNormal = parseInt(DOM.totalInspTodayNormal.value) || 0;
    const todayDefective = parseInt(DOM.totalInspTodayDefective.value) || 0;
    
    const totalDone = accumulated + todayNormal + todayDefective;
    const remaining = totalStock - totalDone;
    
    if (DOM.totalInspRemaining) {
        DOM.totalInspRemaining.textContent = remaining >= 0 ? remaining : 0;
        DOM.totalInspRemaining.classList.toggle('text-red-500', remaining < 0);
    }
}

/**
 * 상품명 기반 데이터 조회 (기존 기록 확인)
 */
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
            currentTotalInspData = docSnap.data();
            
            // 기존 데이터 로드
            DOM.totalInspReason.value = currentTotalInspData.reason || '';
            DOM.totalInspTotalStock.value = currentTotalInspData.totalStock || 0;
            DOM.totalInspAccumulated.textContent = currentTotalInspData.accumulatedTotal || 0;
            
            // 상세 정보 표시 (DB에 없으면 샘플검수에서 넘어온 값 사용)
            DOM.totalInspCode.textContent = currentTotalInspData.code || (pendingDataFromSample?.code || '-');
            DOM.totalInspOption.textContent = currentTotalInspData.option || (pendingDataFromSample?.option || '-');
            DOM.totalInspSupplier.textContent = currentTotalInspData.supplier || (pendingDataFromSample?.supplier || '-');
            DOM.totalInspInboundDate.value = currentTotalInspData.inboundDate || (pendingDataFromSample?.inboundDate || '');
            DOM.totalInspLocation.value = currentTotalInspData.location || (pendingDataFromSample?.location || '');
            
            showToast('기존 전량검수 내역을 불러왔습니다.');
        } else {
            currentTotalInspData = { accumulatedTotal: 0, accumulatedNormal: 0, accumulatedDefective: 0 };
            
            // 신규 기록 초기화
            DOM.totalInspReason.value = '';
            DOM.totalInspTotalStock.value = '';
            DOM.totalInspAccumulated.textContent = '0';

            // 샘플검수에서 넘어온 정보가 있다면 자동 입력
            DOM.totalInspCode.textContent = pendingDataFromSample?.code || '-';
            DOM.totalInspOption.textContent = pendingDataFromSample?.option || '-';
            DOM.totalInspSupplier.textContent = pendingDataFromSample?.supplier || '-';
            DOM.totalInspInboundDate.value = pendingDataFromSample?.inboundDate || '';
            DOM.totalInspLocation.value = '';

            showToast('신규 전량검수 건입니다. 총 재고를 입력하세요.');
        }

        DOM.totalInspTodayNormal.value = '';
        DOM.totalInspTodayDefective.value = '';
        updateTotalInspRemaining();
        
        // 데이터 전송 완료 후 초기화
        pendingDataFromSample = null;

    } catch (error) {
        console.error("Search error:", error);
        showToast("데이터 조회 중 오류 발생", true);
    }
}

/**
 * 금일 검수 결과 누적 저장
 */
export async function saveTotalInspection() {
    const productName = DOM.totalInspProductName.value.trim();
    const reason = DOM.totalInspReason.value.trim();
    const totalStock = parseInt(DOM.totalInspTotalStock.value) || 0;
    
    // 상세 정보 필드값
    const code = DOM.totalInspCode.textContent !== '-' ? DOM.totalInspCode.textContent : '';
    const option = DOM.totalInspOption.textContent !== '-' ? DOM.totalInspOption.textContent : '';
    const supplier = DOM.totalInspSupplier.textContent !== '-' ? DOM.totalInspSupplier.textContent : '';
    const location = DOM.totalInspLocation.value.trim();
    const inboundDate = DOM.totalInspInboundDate.value;

    const todayNormal = parseInt(DOM.totalInspTodayNormal.value) || 0;
    const todayDefective = parseInt(DOM.totalInspTodayDefective.value) || 0;
    const todayTotal = todayNormal + todayDefective;

    if (!productName || !reason || totalStock <= 0) {
        showToast('상품 정보, 사유, 총 재고를 입력해주세요.', true);
        return;
    }
    if (todayTotal <= 0) {
        showToast('금일 검수 수량을 입력해주세요.', true);
        return;
    }

    try {
        const newAccumNormal = (currentTotalInspData.accumulatedNormal || 0) + todayNormal;
        const newAccumDefect = (currentTotalInspData.accumulatedDefective || 0) + todayDefective;
        const newAccumTotal = newAccumNormal + newAccumDefect;

        // 1. 누적 데이터 마스터 저장
        const masterRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'total_inspections_accumulated', productName);
        await setDoc(masterRef, {
            productName, reason, totalStock,
            accumulatedNormal: newAccumNormal,
            accumulatedDefective: newAccumDefect,
            accumulatedTotal: newAccumTotal,
            code, option, supplier, location, inboundDate,
            lastUpdated: serverTimestamp()
        }, { merge: true });

        // 2. 금일 활동 히스토리 저장
        const historyRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'total_inspection_logs', `${productName}-${Date.now()}`);
        await setDoc(historyRef, {
            productName, reason, todayNormal, todayDefective,
            code, option, supplier, location, inboundDate,
            worker: State.auth.currentUser?.email || 'unknown',
            timestamp: serverTimestamp()
        });

        // ✨ 3. 신규: 당일 전량검수 처리량 자동 누적
        try {
            const dailyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
            await updateDoc(dailyDocRef, {
                [`taskQuantities.전량검수`]: increment(todayTotal)
            });
            if (!State.appState.taskQuantities) State.appState.taskQuantities = {};
            State.appState.taskQuantities['전량검수'] = (State.appState.taskQuantities['전량검수'] || 0) + todayTotal;
        } catch(err) {
            console.warn("전량검수 처리량 누적 실패:", err);
        }

        showToast('전량검수 내역이 누적 저장되었습니다.');
        
        // 창 닫기 및 초기화 (샘플검수 창은 그대로 유지됨)
        DOM.totalInspModal.classList.add('hidden');
        DOM.totalInspContentArea.classList.add('hidden');
        DOM.totalInspProductName.value = '';

    } catch (error) {
        console.error("Save error:", error);
        showToast("저장 오류 발생", true);
    }
}