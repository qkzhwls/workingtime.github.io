// === js/weekend-core.js ===
import * as State from './state.js?v=202610021042';
import { store } from './weekend-store.js?v=202610021042';
import { showToast, showConfirm } from './utils.js?v=202610021042';
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function createRequest(dateStr, member, status = 'requested') {
    const monthStr = dateStr.substring(0, 7);
    const docId = `${dateStr}_${member}`; 

    const requestData = {
        date: dateStr,
        month: monthStr,
        member: member,
        reason: "", 
        status: status,
        createdAt: new Date().toISOString()
    };

    if (status === 'confirmed') requestData.confirmedAt = new Date().toISOString();

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await setDoc(docRef, requestData);
        if(status === 'requested') showToast("신청되었습니다.");
    } catch (e) {
        console.error("Error creating request:", e);
        showToast("처리 실패", true);
    }
}

export async function deleteRequest(docId) {
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await deleteDoc(docRef);
        showToast("신청 기록이 삭제되었습니다.");
    } catch (e) {
        console.error("Error deleting request:", e);
        showToast("삭제 실패", true);
    }
}

export async function handleDateClick(dateStr, isBlocked) {
    const member = State.appState.currentUser;
    if (!member) {
        showToast("로그인이 필요합니다.", true);
        return;
    }

    if (isBlocked) {
        showToast("이 날짜는 신청이 마감되었습니다.", true);
        return;
    }

    if (store.myRequestsMap.has(dateStr)) {
        if (await showConfirm(`${dateStr} 근무 신청 내역을 완전히 삭제하시겠습니까?`, { title: '신청 취소', okText: '삭제', danger: true })) {
            const docId = store.myRequestsMap.get(dateStr);
            await deleteRequest(docId);
        }
    } else {
        if (await showConfirm(`${dateStr} 근무를 신청하시겠습니까?`, { title: '주말 근무 신청', okText: '신청' })) {
            await createRequest(dateStr, member, 'requested');
        }
    }
}