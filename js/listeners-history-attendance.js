// === js/listeners-history-attendance.js ===
// 설명: 이력 보기의 '근태 이력' 관리(추가/수정/삭제 요청) 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js?v=202610021122';
import * as State from './state.js?v=202610021122';
import { isPersistentLeaveType } from './state.js?v=202610021122';
import { showToast, getTodayDateString, getCurrentTime } from './utils.js?v=202610021122';
import { renderAttendanceDailyHistory } from './ui-history.js?v=202610021122';
import { clearLocalCache } from './history-data-manager.js?v=202610021122';
import { saveLeaveSchedule } from './config.js?v=202610021122';
import { notifyLeaveScheduleChanged } from './leave-schedule-sync.js?v=202610021122';
import { augmentHistoryWithPersistentLeave } from './history-enricher.js?v=202610021122';
import { doc, updateDoc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 수정 모달이 지금 다루고 있는 근태의 '원본'.
// 화면 목록(State.allHistoryData)에는 그날 문서에 실제로 있는 기록과,
// leaveSchedule에서 날짜별로 펼쳐 넣은 사본이 섞여 있다.
// 그래서 행 번호(index)만으로는 어느 문서를 고쳐야 하는지 알 수 없고,
// 펼쳐 넣은 항목은 그날 문서 배열 범위를 넘어가 '수정할 항목을 찾을 수 없습니다'가 떴다.
let editingAttendance = null;   // { dateKey, index, record, fromSchedule }

/** 두 근태 기록이 같은 것인지 — id가 있으면 id, 없으면 내용으로 판정한다. */
const isSameLeave = (a, b) => {
    if (!a || !b) return false;
    if (a.id && b.id) return a.id === b.id;
    return a.member === b.member
        && a.type === b.type
        && (a.startDate || '') === (b.startDate || '')
        && (a.startTime || '') === (b.startTime || '');
};

/** 기존 값(id·기타항목명 등)은 살리되, 유형이 바뀌면 반대쪽 필드는 없앤다. */
const mergeLeave = (prev, next, isTimeBased) => {
    const merged = { ...(prev || {}), ...next };
    if (isTimeBased) { delete merged.startDate; delete merged.endDate; }
    else             { delete merged.startTime; delete merged.endTime; }
    return merged;
};

/** 현재 조회 기간 필터가 걸린 이력 목록 — 화면을 다시 그릴 때 쓴다. */
const filteredHistoryForView = () => {
    const start = State.context.historyStartDate;
    const end = State.context.historyEndDate;
    if (!start && !end) return State.allHistoryData;
    return State.allHistoryData.filter(d => {
        if (start && end) return d.id >= start && d.id <= end;
        if (start) return d.id >= start;
        return d.id <= end;
    });
};

/** 그날 근태가 저장되는 문서 — 오늘은 daily_data, 지난 날짜는 history. */
const dayDocRef = (dateKey) => doc(State.db, 'artifacts', 'team-work-logger-v2',
    (dateKey === getTodayDateString()) ? 'daily_data' : 'history', dateKey);

/** 그날 문서에 근태 한 건 덧붙이기(문서가 없으면 만든다). */
const appendToDayDoc = async (dateKey, entry) => {
    const docRef = dayDocRef(dateKey);
    // ⚠️ 읽기 실패를 '문서 없음'으로 넘기지 않는다.
    //    예전엔 .catch(() => null) 이라 네트워크 오류 한 번이 아래 '문서 생성' 분기로 빠졌고,
    //    merge 없는 setDoc 이 그 날짜의 업무기록·처리량·경영지표를 통째로 지웠다.
    const snap = await getDoc(docRef);
    let list = [];
    if (snap && snap.exists()) {
        const raw = snap.data().onLeaveMembers;
        list = Array.isArray(raw) ? raw : (raw ? Object.values(raw) : []);
        list.push(entry);
        await updateDoc(docRef, { onLeaveMembers: list });
    } else {
        list = [entry];
        // merge 필수 — 없으면 문서 전체 교체다.
        await setDoc(docRef, { id: dateKey, onLeaveMembers: list }, { merge: true });
    }
    const i = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (i > -1) State.allHistoryData[i].onLeaveMembers = list;
    return list;
};

/** leaveSchedule 목록(없으면 만들어서) 돌려주기. */
const scheduleList = () => {
    if (!State.persistentLeaveSchedule) State.setPersistentLeaveSchedule({ onLeaveMembers: [] });
    if (!Array.isArray(State.persistentLeaveSchedule.onLeaveMembers)) {
        State.persistentLeaveSchedule.onLeaveMembers = [];
    }
    return State.persistentLeaveSchedule.onLeaveMembers;
};

/** 근태 일정 저장 — 실패하면 메모리를 원래대로 되돌리고 다시 던진다. */
const saveScheduleOrRollback = async (backup) => {
    try {
        await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
    } catch (e) {
        State.persistentLeaveSchedule.onLeaveMembers = backup;
        throw e;
    }
};

/** 수정 내용을 leaveSchedule에 반영한다.
 *  · 기간형  → 일정에 없으면 새로 넣고(upsert), 있으면 갱신한다.
 *              (그래야 시작일 하루가 아니라 기간 전체 날짜에 표시된다)
 *  · 당일형  → 외출·조퇴·지각은 기간 개념이 없으므로 일정에서 뺀다.
 *  반환값: 일정이 실제로 바뀌었는지 여부. */
const syncScheduleForEdit = async (origin, newEntry, isTimeBased) => {
    const list = scheduleList();
    const backup = list.slice();
    const si = list.findIndex(l => isSameLeave(l, origin));

    if (isTimeBased) {
        if (si < 0) return false;
        list.splice(si, 1);
    } else {
        const merged = mergeLeave(si > -1 ? list[si] : {}, newEntry, false);
        if (!merged.id) merged.id = origin.id || `leave-${Date.now()}`;
        if (si > -1) list[si] = merged; else list.push(merged);
    }
    await saveScheduleOrRollback(backup);
    return true;
};

export function setupHistoryAttendanceListeners() {
    // 1. 리스트 뷰 내 버튼 클릭 이벤트 (수정/삭제/추가 팝업 열기)
    if (DOM.attendanceHistoryViewContainer) {
        DOM.attendanceHistoryViewContainer.addEventListener('click', handleAttendanceListClicks);
    }

    // 2. 모달 내부 버튼 및 입력 제어 이벤트
    setupAttendanceModalButtons();
}

// 리스트 내 클릭 핸들러 (위임)
function handleAttendanceListClicks(e) {
    // 1. 수정 버튼
    const editBtn = e.target.closest('button[data-action="edit-attendance"]');
    if (editBtn) {
        const dateKey = editBtn.dataset.dateKey;
        const index = parseInt(editBtn.dataset.index, 10);
        if (!dateKey || isNaN(index)) return;
        
        const dayData = State.allHistoryData.find(d => d.id === dateKey);
        // onLeaveMembers가 배열인지 확인
        const leaves = Array.isArray(dayData?.onLeaveMembers) ? dayData.onLeaveMembers : [];
        
        if (!dayData || !leaves[index]) {
            showToast('데이터를 찾을 수 없습니다.', true); return;
        }
        const record = leaves[index];

        // 모달 폼 채우기
        if (DOM.editAttendanceMemberName) DOM.editAttendanceMemberName.value = record.member;
        if (DOM.editAttendanceTypeSelect) {
            DOM.editAttendanceTypeSelect.innerHTML = '';
            State.LEAVE_TYPES.forEach(type => {
                const option = document.createElement('option');
                option.value = type;
                option.textContent = type;
                if (type === record.type) option.selected = true;
                DOM.editAttendanceTypeSelect.appendChild(option);
            });
        }

        const isTimeBased = ['외출', '조퇴', '지각'].includes(record.type);
        const isDateBased = isPersistentLeaveType(record.type);
        const isOuting = (record.type === '외출');
        
        if (DOM.editAttendanceTimeFields) {
             DOM.editAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
             const endTimeWrapper = document.getElementById('edit-attendance-end-time-wrapper');
             if(endTimeWrapper) endTimeWrapper.classList.toggle('hidden', !isOuting);
             if(DOM.editAttendanceStartTimeInput) DOM.editAttendanceStartTimeInput.value = record.startTime || '';
             if(DOM.editAttendanceEndTimeInput) DOM.editAttendanceEndTimeInput.value = record.endTime || '';
        }
        if (DOM.editAttendanceDateFields) {
            DOM.editAttendanceDateFields.classList.toggle('hidden', !isDateBased);
            if(DOM.editAttendanceStartDateInput) DOM.editAttendanceStartDateInput.value = record.startDate || '';
            if(DOM.editAttendanceEndDateInput) DOM.editAttendanceEndDateInput.value = record.endDate || '';
        }
        
        // 메타 데이터 저장
        if (DOM.editAttendanceDateKeyInput) DOM.editAttendanceDateKeyInput.value = dateKey;
        if (DOM.editAttendanceRecordIndexInput) DOM.editAttendanceRecordIndexInput.value = index;
        editingAttendance = { dateKey, index, record, fromSchedule: record.__fromSchedule === true };
        
        if (DOM.editAttendanceRecordModal) DOM.editAttendanceRecordModal.classList.remove('hidden');
        return;
    }

    // 2. 삭제 버튼
    const deleteBtn = e.target.closest('button[data-action="delete-attendance"]');
    if (deleteBtn) {
        const dateKey = deleteBtn.dataset.dateKey;
        const index = parseInt(deleteBtn.dataset.index, 10);
        
        // 실제 삭제 로직은 listeners-modals-confirm.js에서 처리
        State.context.deleteMode = 'attendance';
        State.context.attendanceRecordToDelete = { dateKey, index };
        
        if (DOM.deleteConfirmModal) DOM.deleteConfirmModal.classList.remove('hidden');
        return;
    }

    // 3. 추가 버튼 (헤더 영역 등)
    const addBtn = e.target.closest('button[data-action="open-add-attendance-modal"]');
    if (addBtn) {
        const dateKey = addBtn.dataset.dateKey;
        if (DOM.addAttendanceForm) DOM.addAttendanceForm.reset();
        if (DOM.addAttendanceDateKeyInput) DOM.addAttendanceDateKeyInput.value = dateKey;
        if (DOM.addAttendanceStartDateInput) DOM.addAttendanceStartDateInput.value = dateKey;
        
        // 멤버 리스트 갱신 (직원 + 알바)
        if (DOM.addAttendanceMemberDatalist) {
            DOM.addAttendanceMemberDatalist.innerHTML = '';
            const all = [...new Set([...(State.appConfig.teamGroups||[]).flatMap(g=>g.members), ...(State.appState.partTimers||[]).map(p=>p.name)])].sort();
            all.forEach(m=>{const o=document.createElement('option');o.value=m;DOM.addAttendanceMemberDatalist.appendChild(o);});
        }
        
        // 유형 리스트 갱신
        if (DOM.addAttendanceTypeSelect) {
            DOM.addAttendanceTypeSelect.innerHTML = '';
            State.LEAVE_TYPES.forEach((t,i)=>{
                const o=document.createElement('option');o.value=t;o.textContent=t;
                if(i===0)o.selected=true;
                DOM.addAttendanceTypeSelect.appendChild(o);
            });
        }

        // 초기 UI 상태 설정
        const first = State.LEAVE_TYPES[0];
        const isTime = ['외출','조퇴','지각'].includes(first);
        const isDate = !isTime;
        if(DOM.addAttendanceTimeFields) DOM.addAttendanceTimeFields.classList.toggle('hidden', !isTime);
        if(DOM.addAttendanceDateFields) DOM.addAttendanceDateFields.classList.toggle('hidden', !isDate);
        const endWrap = document.getElementById('add-attendance-end-time-wrapper');
        if(endWrap) endWrap.classList.toggle('hidden', first!=='외출');

        if (DOM.addAttendanceRecordModal) DOM.addAttendanceRecordModal.classList.remove('hidden');
    }
}

function setupAttendanceModalButtons() {
    // --- 수정 모달 확인 버튼 ---
    if (DOM.confirmEditAttendanceBtn) {
        DOM.confirmEditAttendanceBtn.addEventListener('click', async () => {
            const dateKey = DOM.editAttendanceDateKeyInput.value;
            const index = parseInt(DOM.editAttendanceRecordIndexInput.value, 10);
            const member = DOM.editAttendanceMemberName.value;
            const type = DOM.editAttendanceTypeSelect.value;

            if (!dateKey || isNaN(index) || !member || !type) {
                showToast('필수 정보가 누락되었습니다.', true); return;
            }

            const isTimeBased = ['외출', '조퇴', '지각'].includes(type);
            const newEntry = { member, type };

            if (isTimeBased) {
                newEntry.startTime = DOM.editAttendanceStartTimeInput.value;
                newEntry.endTime = DOM.editAttendanceEndTimeInput.value;
                if (!newEntry.startTime) { showToast('시작 시간을 입력해주세요.', true); return; }
            } else {
                newEntry.startDate = DOM.editAttendanceStartDateInput.value;
                newEntry.endDate = DOM.editAttendanceEndDateInput.value || newEntry.startDate;
                if (!newEntry.startDate) { showToast('시작일을 입력해주세요.', true); return; }
            }

            const origin = (editingAttendance && editingAttendance.dateKey === dateKey)
                ? editingAttendance.record : null;
            if (!origin) { showToast('수정할 항목을 다시 선택해주세요.', true); return; }

            try {
                // ① 기간형 근태의 원본은 persistent_data/leaveSchedule 이다.
                //    그날 문서에만 저장하면 시작일 하루에만 보이므로, 기간형이면 항상 일정에 반영한다.
                //    (반대로 당일형으로 바뀌었으면 일정에서 빼야 한다)
                const scheduleChanged = await syncScheduleForEdit(origin, newEntry, isTimeBased);

                if (editingAttendance.fromSchedule && !isTimeBased) {
                    // 화면에만 펼쳐 넣은 사본 → 그날 문서에는 손댈 것이 없다.
                    if (!scheduleChanged) { showToast('수정할 항목을 찾을 수 없습니다.', true); return; }
                } else if (editingAttendance.fromSchedule && isTimeBased) {
                    // 기간형 → 당일형으로 바뀌었다: 일정에서 빠졌으니 그날 문서에 새로 넣는다.
                    await appendToDayDoc(dateKey, mergeLeave(origin, newEntry, true));
                } else {
                    // ② 그날 문서(daily_data/history)에 실제로 저장된 기록
                    const docRef = dayDocRef(dateKey);

                    // 문서 전체 읽기 → 배열 수정 → 전체 덮어쓰기
                    // (array index update 방식은 Map 변환 버그를 유발하므로 쓰지 않는다)
                    const docSnap = await getDoc(docRef);
                    if (!docSnap.exists()) { showToast('문서를 찾을 수 없습니다.', true); return; }

                    const data = docSnap.data();
                    // 오염된 데이터(Map)일 경우 배열로 변환, 아니면 배열 그대로 사용
                    let currentLeaves = [];
                    if (data.onLeaveMembers) {
                        currentLeaves = Array.isArray(data.onLeaveMembers)
                            ? data.onLeaveMembers
                            : Object.values(data.onLeaveMembers);
                    }

                    // 행 번호는 화면 목록 기준이라 어긋날 수 있으니 내용으로 먼저 찾는다.
                    let target = currentLeaves.findIndex(l => isSameLeave(l, origin));
                    if (target < 0 && index >= 0 && index < currentLeaves.length) target = index;
                    if (target < 0) { showToast('수정할 항목을 찾을 수 없습니다.', true); return; }

                    currentLeaves[target] = mergeLeave(currentLeaves[target], newEntry, isTimeBased);
                    await updateDoc(docRef, { onLeaveMembers: currentLeaves });

                    const dayDataIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
                    if (dayDataIndex > -1) {
                        State.allHistoryData[dayDataIndex].onLeaveMembers = currentLeaves;
                    }
                }

                clearLocalCache(); // 캐시 무효화 → 새로고침 시 최신값 재조회(수정 사라짐 방지)
                if (scheduleChanged) notifyLeaveScheduleChanged('attendance-edit');
                // 옛 사본을 걷어내고 새 내용으로 다시 펼친다.
                augmentHistoryWithPersistentLeave(State.allHistoryData, State.persistentLeaveSchedule);
                editingAttendance = null;

                showToast('근태 기록이 수정되었습니다.');
                DOM.editAttendanceRecordModal.classList.add('hidden');
                
                // 3. 화면 갱신 (현재 필터 상태 유지)
                const filteredData = (State.context.historyStartDate || State.context.historyEndDate)
                    ? State.allHistoryData.filter(d => {
                        const date = d.id;
                        const start = State.context.historyStartDate;
                        const end = State.context.historyEndDate;
                        if (start && end) return date >= start && date <= end;
                        if (start) return date >= start;
                        if (end) return date <= end;
                        return true;
                    })
                    : State.allHistoryData;
                renderAttendanceDailyHistory(dateKey, filteredData);

            } catch (e) {
                console.error("Error updating attendance:", e);
                showToast('수정 중 오류가 발생했습니다.', true);
            }
        });
    }

    if (DOM.cancelEditAttendanceBtn) {
        DOM.cancelEditAttendanceBtn.addEventListener('click', () => { 
            if(DOM.editAttendanceRecordModal) DOM.editAttendanceRecordModal.classList.add('hidden'); 
        });
    }
    
    // --- 추가 모달 확인 버튼 ---
    if (DOM.confirmAddAttendanceBtn) {
        DOM.confirmAddAttendanceBtn.addEventListener('click', async () => {
            const dateKey = DOM.addAttendanceDateKeyInput.value;
            const member = DOM.addAttendanceMemberNameInput.value.trim();
            const type = DOM.addAttendanceTypeSelect.value;

            if (!member || !type) { showToast('이름과 유형을 입력해주세요.', true); return; }

            const isTimeBased = ['외출', '조퇴', '지각'].includes(type);
            const newEntry = {
                member,
                type,
                id: `manual-leave-${Date.now()}` 
            };

            if (isTimeBased) {
                newEntry.startTime = DOM.addAttendanceStartTimeInput.value;
                newEntry.endTime = DOM.addAttendanceEndTimeInput.value;
                if (!newEntry.startTime) { showToast('시작 시간을 입력해주세요.', true); return; }
            } else {
                newEntry.startDate = DOM.addAttendanceStartDateInput.value;
                newEntry.endDate = DOM.addAttendanceEndDateInput.value || newEntry.startDate;
                if (!newEntry.startDate) { showToast('시작일을 입력해주세요.', true); return; }
            }

            try {
                const todayKey = getTodayDateString();
                let docRef;
                let isToday = (dateKey === todayKey);

                // 기간형 근태(연차·출장 등)의 원본은 persistent_data/leaveSchedule 이다.
                // 그날 문서에만 넣으면 기간을 잡아도 그 하루에만 표시된다.
                if (!isTimeBased) {
                    const list = scheduleList();
                    const backup = list.slice();
                    list.push({ ...newEntry });
                    await saveScheduleOrRollback(backup);
                    notifyLeaveScheduleChanged('attendance-add');
                    augmentHistoryWithPersistentLeave(State.allHistoryData, State.persistentLeaveSchedule);
                    clearLocalCache();

                    showToast('근태 기록이 추가되었습니다.');
                    DOM.addAttendanceRecordModal.classList.add('hidden');
                    renderAttendanceDailyHistory(dateKey, filteredHistoryForView());
                    return;
                }

                if (isToday) {
                    docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey);
                } else {
                    docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                }

                // ✅ [수정] 추가 로직도 안전하게 변경 (읽고 -> 배열에 push -> 저장)
                // ⚠️ 읽기 실패를 '문서 없음'으로 넘기지 않는다 — 아래 생성 분기로 빠지면
                //    그 날짜의 업무기록·처리량·경영지표가 통째로 날아간다.
                const docSnap = await getDoc(docRef);
                let currentLeaves = [];

                if (docSnap && docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.onLeaveMembers) {
                        currentLeaves = Array.isArray(data.onLeaveMembers)
                            ? data.onLeaveMembers
                            : Object.values(data.onLeaveMembers);
                    }
                    currentLeaves.push(newEntry);
                    await updateDoc(docRef, { onLeaveMembers: currentLeaves });
                } else {
                    // 문서가 없으면 생성 — merge 필수. 없으면 문서 전체 교체다.
                    currentLeaves = [newEntry];
                    await setDoc(docRef, { id: dateKey, onLeaveMembers: currentLeaves }, { merge: true });
                }

                // 1. 로컬 데이터 업데이트
                const dayDataIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
                if (dayDataIndex > -1) {
                    State.allHistoryData[dayDataIndex].onLeaveMembers = currentLeaves;
                } else if (!isToday) {
                    State.allHistoryData.push({
                        id: dateKey,
                        onLeaveMembers: currentLeaves,
                        workRecords: [],
                        taskQuantities: {},
                        management: {}
                    });
                    State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
                }
                clearLocalCache(); // 캐시 무효화 → 새로고침 시 최신값 재조회

                showToast('근태 기록이 추가되었습니다.');
                DOM.addAttendanceRecordModal.classList.add('hidden');

                // 3. 화면 갱신
                 const filteredData = (State.context.historyStartDate || State.context.historyEndDate)
                    ? State.allHistoryData.filter(d => {
                        const date = d.id;
                        const start = State.context.historyStartDate;
                        const end = State.context.historyEndDate;
                        if (start && end) return date >= start && date <= end;
                        if (start) return date >= start;
                        if (end) return date <= end;
                        return true;
                    })
                    : State.allHistoryData;
                renderAttendanceDailyHistory(dateKey, filteredData);

            } catch (e) {
                console.error("Error adding attendance:", e);
                showToast('추가 중 오류가 발생했습니다.', true);
            }
        });
    }

    if (DOM.cancelAddAttendanceBtn) {
        DOM.cancelAddAttendanceBtn.addEventListener('click', () => { 
            if(DOM.addAttendanceRecordModal) DOM.addAttendanceRecordModal.classList.add('hidden'); 
        });
    }
    
    // --- 유형 선택에 따른 UI 토글 (시간/날짜 입력창) ---
    const toggleUI = (select, timeFields, dateFields, endWrapperId) => {
        select.addEventListener('change', e => {
            const t = e.target.value;
            const isTime = ['외출','조퇴','지각'].includes(t);
            timeFields.classList.toggle('hidden', !isTime);
            dateFields.classList.toggle('hidden', isTime);
            const w = document.getElementById(endWrapperId);
            if(w) w.classList.toggle('hidden', t!=='외출');
        });
    };
    
    if(DOM.addAttendanceTypeSelect) toggleUI(DOM.addAttendanceTypeSelect, DOM.addAttendanceTimeFields, DOM.addAttendanceDateFields, 'add-attendance-end-time-wrapper');
    if(DOM.editAttendanceTypeSelect) toggleUI(DOM.editAttendanceTypeSelect, DOM.editAttendanceTimeFields, DOM.editAttendanceDateFields, 'edit-attendance-end-time-wrapper');
}