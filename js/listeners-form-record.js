// === js/listeners-form-record.js ===
// 설명: 업무 기록의 수정(휴식 포함), 수동 추가, 시작 시간 변경 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js?v=202610021042';
import * as State from './state.js?v=202610021042';
import { showToast, formatDuration, calcTotalPauseMinutes, calcElapsedMinutes, getTodayDateString } from './utils.js?v=202610021042';
import { generateId } from './app-data.js?v=202610021042';
import { doc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 휴식 시간 관리 상태 변수 및 렌더링 함수
let currentEditingPauses = [];

const renderPauseListInModal = () => {
    const listEl = document.getElementById('edit-pause-list');
    const totalEl = document.getElementById('edit-total-pause-time');
    if (!listEl) return;

    listEl.innerHTML = '';
    
    // 시간순 정렬
    currentEditingPauses.sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    if (currentEditingPauses.length === 0) {
        listEl.innerHTML = '<div class="text-center text-gray-400 py-4 text-xs">기록된 휴식 시간이 없습니다.</div>';
    } else {
        currentEditingPauses.forEach((p, index) => {
            const row = document.createElement('div');
            row.className = 'flex justify-between items-center bg-white p-2 rounded border border-gray-200';
            row.innerHTML = `
                <span class="text-gray-700 font-mono">${p.start} ~ ${p.end || '진행중'}</span>
                <button type="button" class="text-xs text-red-500 hover:text-red-700 delete-pause-btn underline" data-index="${index}">삭제</button>
            `;
            listEl.appendChild(row);
        });
    }
    
    // 총 휴식 시간 업데이트
    const totalMin = calcTotalPauseMinutes(currentEditingPauses);
    if (totalEl) totalEl.textContent = `총 ${formatDuration(totalMin)}`;
};

export function setupFormRecordListeners() {

    // 1. 수정 버튼 클릭 시 휴식 시간 데이터 초기화 (Delegation)
    document.addEventListener('click', (e) => {
         const editBtn = e.target.closest('button[data-action="edit"]');
         if (editBtn) {
             const recordId = editBtn.dataset.recordId;
             const record = (State.appState.workRecords || []).find(r => String(r.id) === String(recordId));
             if (record) {
                 // 기존 기록의 휴식 데이터를 복사
                 currentEditingPauses = JSON.parse(JSON.stringify(record.pauses || []));
                 renderPauseListInModal();
             }
         }
    });

    // 2. 휴식 시간 추가 버튼
    const addPauseBtn = document.getElementById('edit-pause-add-btn');
    if (addPauseBtn) {
        addPauseBtn.addEventListener('click', () => {
            const startInput = document.getElementById('edit-pause-add-start');
            const endInput = document.getElementById('edit-pause-add-end');
            const start = startInput.value;
            const end = endInput.value;

            if (!start) {
                showToast('휴식 시작 시간을 입력해주세요.', true);
                return;
            }
            // 종료 시간이 있으면 유효성 검사
            if (end && start >= end) {
                showToast('종료 시간은 시작 시간보다 늦어야 합니다.', true);
                return;
            }

            currentEditingPauses.push({ start, end: end || null, type: 'break' });
            renderPauseListInModal();
            
            // 입력 초기화
            startInput.value = '';
            endInput.value = '';
        });
    }

    // 3. 휴식 시간 삭제 버튼 (Delegation)
    const pauseListEl = document.getElementById('edit-pause-list');
    if (pauseListEl) {
        pauseListEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-pause-btn')) {
                const index = parseInt(e.target.dataset.index, 10);
                currentEditingPauses.splice(index, 1);
                renderPauseListInModal();
            }
        });
    }

    // 4. 업무 기록 수정 저장 (0분 이하 삭제 포함)
    if (DOM.confirmEditBtn) {
        DOM.confirmEditBtn.addEventListener('click', async () => {
            const recordId = State.context.recordToEditId;
            const task = document.getElementById('edit-task-type').value;
            const member = document.getElementById('edit-member-name').value;
            const startTime = document.getElementById('edit-start-time').value;
            const endTime = document.getElementById('edit-end-time').value;

            const record = (State.appState.workRecords || []).find(r => r.id === recordId);
            if (!record) {
                showToast('수정할 기록을 찾을 수 없습니다.', true);
                return;
            }

            if (startTime && endTime && startTime >= endTime) {
                showToast('시작 시간이 종료 시간보다 늦거나 같을 수 없습니다.', true);
                return;
            }

            try {
                const recordRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords', recordId);

                const updates = {
                    task,
                    member,
                    startTime,
                    pauses: currentEditingPauses // 수정된 휴식 시간 반영
                };

                let newDuration = null;

                if (endTime) {
                    updates.endTime = endTime;
                    updates.status = 'completed';
                    // 휴식 시간을 반영하여 소요 시간 재계산
                    newDuration = calcElapsedMinutes(startTime, endTime, currentEditingPauses);
                    updates.duration = newDuration;
                } else {
                    updates.endTime = null;
                    updates.status = record.status === 'completed' ? 'ongoing' : record.status;
                    updates.duration = null;
                }

                // 소요 시간이 0분 이하라면 삭제
                if (newDuration !== null && Math.round(newDuration) <= 0) {
                    await deleteDoc(recordRef);
                    showToast('수정 후 소요 시간이 0분이 되어 기록이 삭제되었습니다.');
                } else {
                    await updateDoc(recordRef, updates);
                    showToast('업무 기록이 수정되었습니다.');
                }

                DOM.editRecordModal.classList.add('hidden');
            } catch (e) {
                console.error("Error updating work record: ", e);
                showToast("기록 수정 중 오류 발생", true);
            }
        });
    }

    if (DOM.cancelEditBtn) {
        DOM.cancelEditBtn.addEventListener('click', () => {
            if (DOM.editRecordModal) DOM.editRecordModal.classList.add('hidden');
        });
    }

    // 5. 수동 기록 추가
    if (DOM.confirmManualAddBtn) {
        DOM.confirmManualAddBtn.addEventListener('click', async () => {
            const member = document.getElementById('manual-add-member').value;
            const task = document.getElementById('manual-add-task').value;
            const startTime = document.getElementById('manual-add-start-time').value;
            const endTime = document.getElementById('manual-add-end-time').value;
            const pauses = [];

            if (!member || !task || !startTime || !endTime) {
                showToast('모든 필드를 입력해야 합니다.', true);
                return;
            }
            if (startTime >= endTime) {
                showToast('시작 시간이 종료 시간보다 늦거나 같을 수 없습니다.', true);
                return;
            }

            const duration = calcElapsedMinutes(startTime, endTime, pauses);
            // 0분 이하인지 확인
            if (Math.round(duration) <= 0) {
                showToast('소요 시간이 0분이어 기록이 저장되지 않았습니다.', true);
                return;
            }

            try {
                const recordId = generateId();
                
                const newRecordData = {
                    id: recordId,
                    member,
                    task,
                    startTime,
                    endTime,
                    duration,
                    status: 'completed',
                    groupId: `manual-${generateId()}`,
                    pauses: []
                };

                const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords', recordId);
                await setDoc(docRef, newRecordData);

                showToast('수동 기록이 추가되었습니다.');
                DOM.manualAddRecordModal.classList.add('hidden');
                DOM.manualAddForm.reset();

            } catch (e) {
                console.error("Error adding manual work record: ", e);
                showToast("수동 기록 추가 중 오류 발생", true);
            }
        });
    }

    if (DOM.cancelManualAddBtn) {
        DOM.cancelManualAddBtn.addEventListener('click', () => {
            if (DOM.manualAddRecordModal) DOM.manualAddRecordModal.classList.add('hidden');
        });
    }

    // 6. 시작 시간 변경
    if (DOM.confirmEditStartTimeBtn) {
        DOM.confirmEditStartTimeBtn.addEventListener('click', async () => {
            const contextId = document.getElementById('edit-start-time-context-id').value;
            const contextType = document.getElementById('edit-start-time-context-type').value;
            const newStartTime = document.getElementById('edit-start-time-input').value;

            if (!contextId || !contextType || !newStartTime) {
                showToast('정보가 누락되었습니다.', true);
                return;
            }

            try {
                const today = getTodayDateString();
                const workRecordsColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');

                if (contextType === 'individual') {
                    const docRef = doc(workRecordsColRef, contextId);
                    await updateDoc(docRef, { startTime: newStartTime });

                } else if (contextType === 'group') {
                    const q = query(workRecordsColRef, where("groupId", "==", contextId), where("status", "in", ["ongoing", "paused"]));
                    const querySnapshot = await getDocs(q);

                    if (!querySnapshot.empty) {
                        const batch = writeBatch(State.db);
                        querySnapshot.forEach(doc => {
                            batch.update(doc.ref, { startTime: newStartTime });
                        });
                        await batch.commit();
                    }
                }

                showToast('시작 시간이 수정되었습니다.');
                DOM.editStartTimeModal.classList.add('hidden');

            } catch (e) {
                 console.error("Error updating start time: ", e);
                 showToast("시작 시간 수정 중 오류가 발생했습니다.", true);
            }
        });
    }

    if (DOM.cancelEditStartTimeBtn) {
        DOM.cancelEditStartTimeBtn.addEventListener('click', () => {
            if (DOM.editStartTimeModal) DOM.editStartTimeModal.classList.add('hidden');
        });
    }
}