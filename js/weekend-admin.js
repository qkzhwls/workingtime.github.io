// === js/weekend-admin.js ===
import * as State from './state.js';
import { store, currentManageDateStr, setCurrentManageDateStr } from './weekend-store.js';
import { createRequest } from './weekend-core.js';
import { showToast } from './utils.js';
import { doc, updateDoc, deleteDoc, setDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function handleAdminBadgeClick(docId, data) {
    const popup = document.getElementById('weekend-admin-popup');
    document.getElementById('admin-popup-member').textContent = data.member;
    
    const statusSpan = document.getElementById('admin-popup-status');
    if (data.status === 'confirmed') {
        statusSpan.textContent = '승인됨';
        statusSpan.className = 'font-bold text-blue-600';
    } else if (data.status === 'canceled') {
        statusSpan.textContent = '취소됨';
        statusSpan.className = 'font-bold text-yellow-600';
    } else {
        statusSpan.textContent = '대기 중';
        statusSpan.className = 'font-bold text-orange-500';
    }

    document.getElementById('admin-confirm-btn').onclick = () => processAdminAction(docId, 'confirmed', data);
    document.getElementById('admin-reject-btn').onclick = () => processAdminAction(docId, 'demote', data);
    const cancelBtn = document.getElementById('admin-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = () => processAdminAction(docId, 'canceled', data);
    document.getElementById('admin-close-popup-btn').onclick = () => popup.classList.add('hidden');
    popup.classList.remove('hidden');
}

export async function processAdminAction(docId, action, data) {
    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
    try {
        if (action === 'demote') {
            await updateDoc(docRef, { status: 'requested', confirmedAt: null });
            showToast("대기 상태로 변경되었습니다.");
        } else if (action === 'confirmed') {
            await updateDoc(docRef, { status: 'confirmed', confirmedAt: new Date().toISOString() });
            showToast("승인 완료");
            const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
            await setDoc(notiRef, { targetMember: data.member, type: 'weekend_confirmed', message: `${data.date} 주말 근무 신청이 확정(승인)되었습니다.`, createdAt: new Date().toISOString(), isRead: false });
        } else if (action === 'canceled') {
            await updateDoc(docRef, { status: 'canceled', confirmedAt: null });
            showToast("취소 처리되었습니다.");
            const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
            await setDoc(notiRef, { targetMember: data.member, type: 'weekend_canceled', message: `${data.date} 주말 근무 신청이 관리자에 의해 취소(반려)되었습니다.`, createdAt: new Date().toISOString(), isRead: false });
        }
        document.getElementById('weekend-admin-popup').classList.add('hidden');
    } catch (e) {
        console.error("Error admin action:", e);
        showToast("처리 실패", true);
    }
}

export async function processSelectedDatesBulkAction(action) {
    const checkboxes = document.querySelectorAll('.date-select-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast("선택된 날짜가 없습니다.", true);
        return;
    }
    const actionText = action === 'confirmed' ? '승인' : action === 'canceled' ? '취소' : '삭제';
    if (!confirm(`선택한 ${checkboxes.length}개 날짜의 모든 신청 건을 일괄 ${actionText} 하시겠습니까?`)) return;

    let count = 0;
    try {
        for (const cb of checkboxes) {
            const dateStr = cb.dataset.date;
            const reqs = store.requestsByDate[dateStr] || [];
            
            for (const req of reqs) {
                const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', req.id);
                if (action === 'delete') {
                    await deleteDoc(docRef);
                } else {
                    if (req.status !== action) {
                        await updateDoc(docRef, { status: action, confirmedAt: action === 'confirmed' ? new Date().toISOString() : null });
                        const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
                        const msg = action === 'confirmed' ? `${dateStr} 주말 근무 배정이 확정(승인)되었습니다.` : `${dateStr} 주말 근무 신청이 관리자에 의해 일괄 취소(반려)되었습니다.`;
                        await setDoc(notiRef, { targetMember: req.member, type: action === 'confirmed' ? 'weekend_confirmed' : 'weekend_canceled', message: msg, createdAt: new Date().toISOString(), isRead: false });
                    }
                }
                count++;
            }
        }
        showToast(`선택 날짜의 총 ${count}건 일괄 ${actionText} 완료 및 알림 전송됨.`);
        document.getElementById('select-all-dates-checkbox').checked = false;
        checkboxes.forEach(cb => cb.checked = false);
    } catch (e) {
        console.error("Bulk action error:", e);
        showToast("일괄 처리 중 오류 발생", true);
    }
}

export function populatePastDateAddSelect(dateStr) {
    const select = document.getElementById('past-date-add-member');
    if (!select) return;
    select.innerHTML = '<option value="">팀원 선택...</option>';

    let allMembers = [];
    if (State.appConfig && State.appConfig.teamGroups) {
        State.appConfig.teamGroups.forEach(g => { if (g.members) allMembers = allMembers.concat(g.members); });
    }
    if (State.appState && State.appState.partTimers) {
        State.appState.partTimers.forEach(p => { if (p.name) allMembers.push(p.name); });
    }
    allMembers = [...new Set(allMembers)];

    const reqs = store.requestsByDate[dateStr] || [];
    const alreadyApplied = reqs.map(r => r.member);

    allMembers.forEach(member => {
        const option = document.createElement('option');
        option.value = member;
        option.textContent = member;
        if (alreadyApplied.includes(member)) {
            option.disabled = true;
            option.textContent += ' (이미 등록됨)';
        }
        select.appendChild(option);
    });
}

export function populateAdminAddMemberSelect(dateStr) {
    const select = document.getElementById('admin-date-add-member');
    if (!select) return;
    select.innerHTML = '<option value="">팀원 선택...</option>';

    let allMembers = [];
    if (State.appConfig && State.appConfig.teamGroups) {
        State.appConfig.teamGroups.forEach(g => { if (g.members) allMembers = allMembers.concat(g.members); });
    }
    if (State.appState && State.appState.partTimers) {
        State.appState.partTimers.forEach(p => { if (p.name) allMembers.push(p.name); });
    }
    allMembers = [...new Set(allMembers)];

    const reqs = store.requestsByDate[dateStr] || [];
    const alreadyApplied = reqs.map(r => r.member);

    allMembers.forEach(member => {
        const option = document.createElement('option');
        option.value = member;
        option.textContent = member;
        if (alreadyApplied.includes(member)) {
            option.disabled = true;
            option.textContent += ' (이미 신청/확정됨)';
        }
        select.appendChild(option);
    });
}

export function openAdminDatePopup(dateStr) {
    setCurrentManageDateStr(dateStr);
    store.recommendOffset = 0; 
    
    const popup = document.getElementById('weekend-admin-date-popup');
    document.getElementById('admin-date-popup-title').textContent = dateStr;
    
    populateAdminAddMemberSelect(dateStr);
    
    const capacityInput = document.getElementById('admin-date-capacity');
    if (capacityInput) {
        capacityInput.value = store.capacityMap.has(dateStr) ? store.capacityMap.get(dateStr) : '';
    }

    const randomCountInput = document.getElementById('admin-date-random-count');
    if (randomCountInput) randomCountInput.value = '1';

    const isBlocked = store.blockedDatesSet.has(dateStr);
    document.getElementById('admin-date-block-toggle').checked = isBlocked;

    const smartArea = document.getElementById('smart-calc-result-area');
    if (smartArea) {
        smartArea.innerHTML = '';
        smartArea.classList.add('hidden');
    }
    store.smartCalcCache = null;

    popup.classList.remove('hidden');
}

export function openPastDateEditPopup(dateStr) {
    setCurrentManageDateStr(dateStr);
    const popup = document.getElementById('past-date-edit-popup');
    if (!popup) return;
    
    document.getElementById('past-date-popup-title').textContent = dateStr;
    populatePastDateAddSelect(dateStr);
    renderPastDateMembers(dateStr);
    
    popup.classList.remove('hidden');
}

export function renderPastDateMembers(dateStr) {
    const listContainer = document.getElementById('past-date-member-list');
    if(!listContainer) return;
    listContainer.innerHTML = '';
    
    const reqs = store.requestsByDate[dateStr] || [];
    if (reqs.length === 0) {
        listContainer.innerHTML = '<div class="text-gray-400 text-sm text-center py-4">등록된 인원이 없습니다.</div>';
        return;
    }

    reqs.forEach(req => {
        const item = document.createElement('div');
        item.className = "flex justify-between items-center p-2 border border-gray-200 bg-white shadow-sm rounded mb-1";
        
        let statusText = req.status === 'confirmed' ? '확정' : req.status === 'canceled' ? '취소됨' : '대기';
        let statusColor = req.status === 'confirmed' ? 'text-blue-600' : req.status === 'canceled' ? 'text-red-500' : 'text-orange-500';
        
        item.innerHTML = `
            <div><span class="font-bold text-gray-800">${req.member}</span> <span class="text-xs font-bold ml-2 ${statusColor}">${statusText}</span></div>
            <div class="flex gap-1.5">
                ${req.status !== 'confirmed' ? `<button class="past-date-confirm-btn px-2.5 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded text-xs font-bold transition" data-id="${req.id}" data-member="${req.member}">확정으로 변경</button>` : ''}
                <button class="past-date-delete-btn px-2.5 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded text-xs font-bold transition" data-id="${req.id}" data-member="${req.member}">완전 삭제</button>
            </div>
        `;
        listContainer.appendChild(item);
    });
}

export async function pastDateChangeStatus(docId, status) {
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await updateDoc(docRef, { status: status, confirmedAt: status === 'confirmed' ? new Date().toISOString() : null });
        showToast("상태가 변경되었습니다.");
    } catch (e) {
        console.error("Error updating status:", e);
        showToast("상태 변경 중 오류 발생", true);
    }
}

export async function pastDateDeleteMember(docId) {
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await deleteDoc(docRef);
        showToast("인원이 삭제되었습니다.");
    } catch (e) {
        console.error("Error deleting member:", e);
        showToast("삭제 중 오류 발생", true);
    }
}

export async function pastDateAddMember() {
    if (!currentManageDateStr) return;
    const select = document.getElementById('past-date-add-member');
    const memberName = select.value.trim();
    if (!memberName) { showToast("팀원을 선택하세요.", true); return; }
    await createRequest(currentManageDateStr, memberName, 'confirmed');
    showToast(`${memberName}님 추가 완료`);
}

export function calculateSmartAllocation() {
    if (!currentManageDateStr) return;
    const capacityStr = store.capacityMap.get(currentManageDateStr);
    const capacity = parseInt(capacityStr, 10);
    
    if (isNaN(capacity) || capacity <= 0) {
        showToast("먼저 정원(명)을 설정하고 '설정' 버튼을 눌러주세요.", true);
        return;
    }

    const reqs = store.requestsByDate[currentManageDateStr] || [];
    const activeReqs = reqs.filter(r => r.status !== 'canceled');
    const applicants = activeReqs.map(r => r.member);
    
    let allMembers = [];
    if (State.appConfig && State.appConfig.teamGroups) {
        State.appConfig.teamGroups.forEach(g => { if (g.members) allMembers = allMembers.concat(g.members); });
    }
    allMembers = [...new Set(allMembers)];
    
    const adminMembers = ['박영철', '박호진', '유아라', '이승운'];
    const eligibleMembers = allMembers.filter(m => !adminMembers.includes(m));

    const adminApplicants = applicants.filter(m => adminMembers.includes(m));
    const generalApplicants = applicants.filter(m => !adminMembers.includes(m));

    const availableCapacity = Math.max(0, capacity - adminApplicants.length);

    const getScore = (m) => {
        const y = store.currentYearlyStats.get(m) || 0;
        const ms = store.currentMonthStats.get(m) || {confirmed: 0, requested: 0};
        const monthTotal = ms.confirmed + ms.requested;
        return (monthTotal * 1000) + (y * 10); 
    };

    const sortedGeneralApplicants = [...generalApplicants].sort((a, b) => {
        const diff = getScore(a) - getScore(b);
        return diff !== 0 ? diff : a.localeCompare(b);
    });

    const nonApplicants = eligibleMembers.filter(m => !applicants.includes(m));
    const sortedNonApplicants = [...nonApplicants].sort((a, b) => {
        const diff = getScore(a) - getScore(b);
        return diff !== 0 ? diff : a.localeCompare(b);
    });

    let toConfirm = [...adminApplicants]; 
    let toDecline = []; 
    let toAdd = [];     

    if (generalApplicants.length > availableCapacity) {
        toConfirm = toConfirm.concat(sortedGeneralApplicants.slice(0, availableCapacity));
        toDecline = sortedGeneralApplicants.slice(availableCapacity);
        store.recommendOffset = 0; 
    } else if (generalApplicants.length < availableCapacity) {
        toConfirm = toConfirm.concat(sortedGeneralApplicants);
        const needed = availableCapacity - generalApplicants.length;
        
        if (sortedNonApplicants.length > 0) {
            if (store.recommendOffset >= sortedNonApplicants.length) {
                store.recommendOffset = 0; 
                showToast("모든 후보를 순회하여 다시 1순위부터 추천합니다.");
            }
            
            for (let i = 0; i < needed; i++) {
                const index = (store.recommendOffset + i) % sortedNonApplicants.length;
                if (!toAdd.includes(sortedNonApplicants[index])) {
                    toAdd.push(sortedNonApplicants[index]);
                }
            }
            store.recommendOffset += needed;
        }
    } else {
        toConfirm = toConfirm.concat(sortedGeneralApplicants);
        store.recommendOffset = 0;
    }

    let totalMonthlyCapacity = 0;
    store.capacityMap.forEach(v => totalMonthlyCapacity += parseInt(v, 10) || 0);
    const avgPossibleShifts = (totalMonthlyCapacity / eligibleMembers.length).toFixed(1);

    renderSmartCalcResult(toConfirm, toDecline, toAdd, capacity, applicants.length, adminApplicants.length, avgPossibleShifts);
}

export function renderSmartCalcResult(toConfirm, toDecline, toAdd, capacity, appCount, adminCount, avgPossible) {
    const area = document.getElementById('smart-calc-result-area');
    area.classList.remove('hidden');

    let html = `<div class="text-xs text-gray-700 font-medium space-y-3 mb-4">
                    <div class="flex flex-col gap-1 border-b border-indigo-100 pb-2">
                        <div class="flex justify-between">
                            <span>설정 정원: <b class="text-emerald-600">${capacity}명</b> (관리자 ${adminCount}명 포함)</span> 
                            <span>신청: <b>${appCount}명</b></span>
                        </div>
                        <div class="text-[10px] text-indigo-500 font-normal">* 이 달의 팀원당 권장 근무: 약 ${avgPossible}회</div>
                    </div>`;
    
    const finalConfirmed = [...toConfirm, ...toAdd];
    html += `<div><span class="text-emerald-700 font-bold">✅ 최종 확정 추천 (${finalConfirmed.length}명)</span><div class="mt-2 flex flex-wrap gap-1.5">`;
    
    finalConfirmed.forEach(m => {
        const yCount = store.currentYearlyStats.get(m) || 0;
        const ms = store.currentMonthStats.get(m) || {confirmed: 0, requested: 0};
        const mTotal = ms.confirmed + ms.requested;
        
        const isNew = toAdd.includes(m);
        const isAdmin = ['박영철', '박호진', '유아라', '이승운'].includes(m);
        
        let badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm';
        let icon = '✔️';
        let subText = `(당월 ${mTotal}회/누적 ${yCount}회)`;
        
        if (isAdmin) {
            badgeClass = 'bg-gray-100 text-gray-800 border-gray-300 shadow-sm';
            icon = '👑';
            subText = '(관리자)';
        } else if (isNew) {
            badgeClass = 'bg-blue-50 text-blue-800 border-blue-200 shadow-sm';
            icon = '➕';
        }
        html += `<span class="border px-1.5 py-1 rounded-md text-[11px] ${badgeClass}">${icon} ${m} <span class="text-[10px] opacity-70">${subText}</span></span>`;
    });
    html += `</div></div>`;

    if (toDecline.length > 0) {
        html += `<div class="pt-1"><span class="text-red-600 font-bold">➖ 정원 초과로 자동 취소 (${toDecline.length}명)</span><br><span class="text-gray-400 text-[10px]">당월 신청 횟수가 많아 배정에서 제외되며, 취소(노란색) 상태로 변경됩니다.</span><div class="mt-2 flex flex-wrap gap-1.5">`;
        toDecline.forEach(m => {
            const ms = store.currentMonthStats.get(m) || {confirmed: 0, requested: 0};
            html += `<span class="bg-yellow-100 text-yellow-700 border border-yellow-400 px-1.5 py-1 rounded-md text-[11px] line-through shadow-sm">❌ ${m} <span class="text-[10px] opacity-70">(당월 ${ms.confirmed+ms.requested}회)</span></span>`;
        });
        html += `</div></div>`;
    }

    if(toAdd.length === 0 && toDecline.length === 0) {
         html += `<div class="text-blue-600 font-bold py-1 bg-blue-50 px-2 rounded mt-2">인원이 정원과 일치하여 전원 확정 추천합니다.</div>`;
    }
    
    html += `</div>`;
    html += `<button id="apply-smart-calc-btn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-lg shadow-md transition text-sm flex justify-center items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                추천안 일괄 적용하기
             </button>`;

    area.innerHTML = html;
    store.smartCalcCache = { toConfirm, toDecline, toAdd };
}

export async function applySmartAllocation() {
    if (!store.smartCalcCache || !currentManageDateStr) return;
    const { toConfirm, toDecline, toAdd } = store.smartCalcCache;
    const reqs = store.requestsByDate[currentManageDateStr] || [];
    
    const applyBtn = document.getElementById('apply-smart-calc-btn');
    if(applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '적용 중...'; }

    try {
        for (const m of toDecline) {
            const req = reqs.find(r => r.member === m);
            if (req && req.status !== 'canceled') { 
                await updateDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', req.id), { status: 'canceled', confirmedAt: null });
                const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
                await setDoc(notiRef, { targetMember: m, type: 'weekend_canceled', message: `${currentManageDateStr} 주말 근무 신청이 정원 초과로 인해 취소(반려)되었습니다.`, createdAt: new Date().toISOString(), isRead: false });
            }
        }
        
        for (const m of toConfirm) {
            const req = reqs.find(r => r.member === m);
            if (req && req.status !== 'confirmed') {
                await updateDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', req.id), { status: 'confirmed', confirmedAt: new Date().toISOString() });
                const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
                await setDoc(notiRef, { targetMember: m, type: 'weekend_confirmed', message: `${currentManageDateStr} 주말 근무 배정이 확정되었습니다.`, createdAt: new Date().toISOString(), isRead: false });
            }
        }
        
        for (const m of toAdd) {
            await createRequest(currentManageDateStr, m, 'confirmed');
            const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
            await setDoc(notiRef, { targetMember: m, type: 'weekend_confirmed', message: `${currentManageDateStr} 주말 근무가 배정(확정)되었습니다.`, createdAt: new Date().toISOString(), isRead: false });
        }

        showToast("스마트 배분이 성공적으로 적용되었으며, 알림이 발송되었습니다.");
        document.getElementById('smart-calc-result-area').classList.add('hidden');
        store.smartCalcCache = null;
        store.recommendOffset = 0; 
    } catch (e) {
        console.error("Smart Allocation Error:", e);
        showToast("적용 중 오류가 발생했습니다.", true);
    } finally {
         if(applyBtn) { applyBtn.disabled = false; applyBtn.textContent = '추천안 일괄 적용하기'; }
    }
}

export async function setDateCapacity(capacityStr) {
    if (!currentManageDateStr) return;
    const capacity = parseInt(capacityStr, 10);
    const docId = `CAPACITY_${currentManageDateStr}`;
    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);

    try {
        if (isNaN(capacity) || capacity <= 0) {
            await deleteDoc(docRef);
            showToast(`${currentManageDateStr} 정원 설정이 해제되었습니다.`);
        } else {
            await setDoc(docRef, { type: 'capacity', date: currentManageDateStr, month: currentManageDateStr.substring(0, 7), capacity: capacity, updatedAt: new Date().toISOString() });
            showToast(`${currentManageDateStr} 정원이 ${capacity}명으로 설정되었습니다.`);
        }
    } catch (e) {
        console.error("Error setting capacity:", e);
        showToast("정원 설정 실패", true);
    }
}

export async function adminAddMemberToDate() {
    if (!currentManageDateStr) return;
    const select = document.getElementById('admin-date-add-member');
    const memberName = select.value.trim();

    if (!memberName) { showToast("추가할 팀원을 선택하세요.", true); return; }

    await createRequest(currentManageDateStr, memberName, 'confirmed');
    
    const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
    await setDoc(notiRef, { targetMember: memberName, type: 'weekend_confirmed', message: `${currentManageDateStr} 주말 근무가 배정(확정)되었습니다.`, createdAt: new Date().toISOString(), isRead: false });

    showToast(`${memberName}님 확정 및 알림 발송 완료`);
    populateAdminAddMemberSelect(currentManageDateStr);
}

export async function adminRandomSelectMembers(count) {
    if (!currentManageDateStr) return;
    
    let allMembers = [];
    if (State.appConfig && State.appConfig.teamGroups) {
        State.appConfig.teamGroups.forEach(group => {
            if (group.members && Array.isArray(group.members)) { allMembers = allMembers.concat(group.members); }
        });
    }

    allMembers = [...new Set(allMembers)];
    const excludedMembers = ['박영철', '박호진', '유아라', '이승운']; 
    const alreadyApplied = (store.requestsByDate[currentManageDateStr] || []).map(req => req.member);
    
    const availableMembers = allMembers.filter(member => !excludedMembers.includes(member) && !alreadyApplied.includes(member));

    if (availableMembers.length === 0) { showToast("추첨 가능한 인원이 없습니다.", true); return; }

    if (count > availableMembers.length) {
        showToast(`현재 추첨 가능한 최대 인원은 ${availableMembers.length}명입니다.`, true);
        count = availableMembers.length;
    }

    const shuffled = [...availableMembers];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const selectedMembers = shuffled.slice(0, count);

    let successCount = 0;
    for (const member of selectedMembers) {
        try {
            await createRequest(currentManageDateStr, member, 'requested');
            successCount++;
        } catch(e) {}
    }

    showToast(`랜덤 추첨으로 ${successCount}명 승인 대기 등록 완료`);
}

export async function toggleBlockDate(isBlocked) {
    if (!currentManageDateStr) return;
    const docId = `BLOCKED_${currentManageDateStr}`;
    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);

    try {
        if (isBlocked) {
            const monthStr = currentManageDateStr.substring(0, 7);
            await setDoc(docRef, { type: 'blocked', date: currentManageDateStr, month: monthStr, createdAt: new Date().toISOString() });
            showToast(`${currentManageDateStr} 신청이 마감되었습니다.`);
        } else {
            await deleteDoc(docRef);
            showToast(`${currentManageDateStr} 신청이 다시 활성화되었습니다.`);
        }
    } catch (e) {
        console.error("Error toggling block status:", e);
        showToast("상태 변경 실패", true);
        document.getElementById('admin-date-block-toggle').checked = !isBlocked;
    }
}