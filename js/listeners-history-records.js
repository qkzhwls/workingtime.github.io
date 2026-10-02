// === js/listeners-history-records.js ===
// 설명: 이력 보기의 '기록 관리'(상세 내역 수정/삭제/일괄적용) 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js?v=202610021042';
import * as State from './state.js?v=202610021042';
import { showToast } from './utils.js?v=202610021042';
import {
    updateHistoryWorkRecord,
    deleteHistoryWorkRecord,
    addHistoryWorkRecord
} from './history-data-manager.js?v=202610021042';
import { renderHistoryDetail } from './app-history-logic.js?v=202610021042';
import { renderHistoryRecordsTable, openHistoryRecordManager } from './history-record-table.js?v=202610021042';
import { generateId } from './app-data.js?v=202610021042';

export function setupHistoryRecordListeners() {

    // 1. 메인 뷰에서 '기록 관리' 버튼 클릭 시 모달 열기
    if (DOM.historyViewContainer) {
        DOM.historyViewContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action="open-record-manager"]');
            if (btn) {
                openHistoryRecordManager(btn.dataset.dateKey);
            }
        });
    }

    // 2. 필터 UI 변경 (필터링)
    const memberFilterEl = document.getElementById('history-record-filter-member');
    const taskFilterEl = document.getElementById('history-record-filter-task');

    if (memberFilterEl) {
        memberFilterEl.addEventListener('change', () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            renderHistoryRecordsTable(dateKey);
        });
    }
    if (taskFilterEl) {
        taskFilterEl.addEventListener('change', () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            renderHistoryRecordsTable(dateKey);
        });
    }

    // 3. (기존) 선택된 업무 일괄 시간 수정 적용
    const batchApplyBtn = document.getElementById('history-batch-apply-btn');
    if (batchApplyBtn) {
        batchApplyBtn.addEventListener('click', async () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            const taskFilterVal = taskFilterEl ? taskFilterEl.value : '';
            const newStart = document.getElementById('history-batch-start-time').value;
            const newEnd = document.getElementById('history-batch-end-time').value;

            if (!taskFilterVal) { showToast('업무를 선택한 상태에서만 일괄 수정이 가능합니다.', true); return; }
            if (!newStart && !newEnd) { showToast('수정할 시작 또는 종료 시간을 입력해주세요.', true); return; }
            if (newStart && newEnd && newStart >= newEnd) { showToast('시작 시간이 종료 시간보다 빨라야 합니다.', true); return; }

            if (!confirm(`선택된 업무(${taskFilterVal})의 모든 기록을 일괄 수정하시겠습니까?`)) return;

            try {
                const data = State.allHistoryData.find(d => d.id === dateKey);
                const records = data ? data.workRecords : [];
                const targets = records.filter(r => r.task === taskFilterVal);
                
                if (targets.length === 0) { showToast('수정할 대상이 없습니다.', true); return; }

                const updatePromises = targets.map(r => {
                    const updateData = {};
                    if (newStart) updateData.startTime = newStart;
                    if (newEnd) updateData.endTime = newEnd;
                    return updateHistoryWorkRecord(dateKey, r.id, updateData);
                });

                await Promise.all(updatePromises);
                showToast(`${targets.length}건의 기록이 일괄 수정되었습니다.`);
                renderHistoryRecordsTable(dateKey);
                renderHistoryDetail(dateKey); 
            } catch (e) {
                console.error(e);
                showToast('일괄 수정 중 오류가 발생했습니다.', true);
            }
        });
    }

    // 4. 기록 추가 버튼 (수동 입력 모달 열기)
    if (DOM.historyRecordAddBtn) {
        DOM.historyRecordAddBtn.addEventListener('click', () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            if (!dateKey) { showToast('날짜 정보를 찾을 수 없습니다.', true); return; }
            
            if (DOM.historyAddDateDisplay) DOM.historyAddDateDisplay.textContent = dateKey;
            if (DOM.historyAddRecordForm) DOM.historyAddRecordForm.reset();
            
            // Datalist 채우기
            if (DOM.historyAddMemberDatalist) {
                DOM.historyAddMemberDatalist.innerHTML = '';
                const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
                const partTimers = (State.appState.partTimers || []).map(p => p.name);
                const allMembers = [...new Set([...staff, ...partTimers])].sort();
                allMembers.forEach(m => {
                    const op = document.createElement('option');
                    op.value = m;
                    DOM.historyAddMemberDatalist.appendChild(op);
                });
            }
            
            if (DOM.historyAddTaskDatalist) {
                DOM.historyAddTaskDatalist.innerHTML = '';
                const allTasks = (State.appConfig.taskGroups || []).flatMap(g => g.tasks).sort();
                const uniqueTasks = [...new Set(allTasks)];
                uniqueTasks.forEach(t => {
                    const op = document.createElement('option');
                    op.value = t;
                    DOM.historyAddTaskDatalist.appendChild(op);
                });
            }

            if (DOM.historyAddRecordModal) DOM.historyAddRecordModal.classList.remove('hidden');
        });
    }

    // 5. 기록 추가 확인
    if (DOM.confirmHistoryAddBtn) {
        DOM.confirmHistoryAddBtn.addEventListener('click', async () => {
             const dateKey = document.getElementById('history-records-date').textContent;
             const member = DOM.historyAddMemberInput.value.trim();
             const task = DOM.historyAddTaskInput.value.trim();
             const startTime = DOM.historyAddStartTimeInput.value;
             const endTime = DOM.historyAddEndTimeInput.value;

             if (!member || !task || !startTime || !endTime) { showToast('모든 필드를 입력해주세요.', true); return; }
             if (startTime >= endTime) { showToast('종료 시간은 시작 시간보다 늦어야 합니다.', true); return; }

             try {
                 const newRecord = {
                     id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                     member, task, startTime, endTime, 
                     status: 'completed', pauses: [],
                     groupId: `manual-grp-${Date.now()}` // 그룹 ID도 생성
                 };
                 await addHistoryWorkRecord(dateKey, newRecord);
                 showToast('기록이 추가되었습니다.');
                 if (DOM.historyAddRecordModal) DOM.historyAddRecordModal.classList.add('hidden');
                 
                 renderHistoryRecordsTable(dateKey);
                 // 상세 뷰 갱신
                 const selectedDateKey = document.querySelector('.history-date-btn.bg-blue-100')?.dataset.key;
                 if (dateKey === selectedDateKey) {
                     renderHistoryDetail(dateKey);
                 }
             } catch (e) {
                 console.error(e);
                 showToast('기록 추가 중 오류가 발생했습니다.', true);
             }
        });
    }

    // 6. 테이블 내부 버튼 (삭제 및 복제)
    if (DOM.historyRecordsTableBody) {
        DOM.historyRecordsTableBody.addEventListener('click', async (e) => {
            const target = e.target;
            
            // 삭제
            const deleteBtn = target.closest('button[data-action="delete-history-record"]');
            if (deleteBtn) {
                const dateKey = deleteBtn.dataset.dateKey;
                const recordId = deleteBtn.dataset.recordId;
                if (confirm('정말로 이 기록을 삭제하시겠습니까?')) {
                    try {
                        await deleteHistoryWorkRecord(dateKey, recordId);
                        showToast('기록이 삭제되었습니다.');
                        renderHistoryRecordsTable(dateKey);
                        const selectedDateKey = document.querySelector('.history-date-btn.bg-blue-100')?.dataset.key;
                        if (dateKey === selectedDateKey) {
                             renderHistoryDetail(dateKey);
                        }
                    } catch (err) {
                        console.error(err);
                        showToast('삭제 중 오류가 발생했습니다.', true);
                    }
                }
                return;
            }

            // ✅ [신규] 복제 기능
            const duplicateBtn = target.closest('button[data-action="duplicate-history-record"]');
            if (duplicateBtn) {
                const dateKey = duplicateBtn.dataset.dateKey;
                const recordId = duplicateBtn.dataset.recordId;
                
                // 원본 데이터 찾기
                const dayData = State.allHistoryData.find(d => d.id === dateKey);
                const originalRecord = dayData?.workRecords?.find(r => r.id === recordId);

                if (originalRecord) {
                    try {
                        const newRecord = {
                            ...originalRecord,
                            id: generateId(), // 새 ID 생성
                            groupId: generateId() // 새 그룹 ID
                        };
                        
                        await addHistoryWorkRecord(dateKey, newRecord);
                        
                        showToast(`${originalRecord.member}님의 기록이 복제되었습니다.`);
                        renderHistoryRecordsTable(dateKey); // 테이블 갱신
                        
                        // 백그라운드 뷰 갱신
                        const selectedDateKey = document.querySelector('.history-date-btn.bg-blue-100')?.dataset.key;
                        if (dateKey === selectedDateKey) renderHistoryDetail(dateKey);

                    } catch (err) {
                        console.error("복제 중 오류:", err);
                        showToast("기록 복제에 실패했습니다.", true);
                    }
                }
            }
        });
    }

    // ✅ [신규] 일괄 저장 기능 (DOM 위임: 모달 컨텐츠 박스에 리스너 연결)
    if (DOM.historyRecordsModal) {
        DOM.historyRecordsModal.addEventListener('click', async (e) => {
            const saveAllBtn = e.target.closest('#history-record-save-all-btn');
            if (saveAllBtn) {
                const dateKey = document.getElementById('history-records-date').textContent;
                if (!dateKey) return;

                // 1. 테이블의 모든 행(tr)을 순회하며 변경된 값을 수집
                const rows = DOM.historyRecordsTableBody.querySelectorAll('tr.history-record-row');
                const updatePromises = [];
                let updateCount = 0;

                saveAllBtn.disabled = true;
                saveAllBtn.textContent = '저장 중...';

                rows.forEach(row => {
                    const recordId = row.dataset.recordId;
                    const newTask = row.querySelector('.history-record-task').value;
                    const newStart = row.querySelector('.history-record-start').value;
                    const newEnd = row.querySelector('.history-record-end').value;

                    // 유효성 검사 및 업데이트 목록 추가
                    if (recordId && newTask && newStart && newEnd) {
                        if (newStart < newEnd) { // 시작 시간이 종료 시간보다 빠른 경우만
                            updatePromises.push(
                                updateHistoryWorkRecord(dateKey, recordId, { 
                                    task: newTask, 
                                    startTime: newStart, 
                                    endTime: newEnd 
                                })
                            );
                            updateCount++;
                        }
                    }
                });

                try {
                    await Promise.all(updatePromises);
                    showToast(`총 ${updateCount}건의 기록이 일괄 저장되었습니다.`);
                    
                    renderHistoryRecordsTable(dateKey); // 재렌더링
                    const selectedDateKey = document.querySelector('.history-date-btn.bg-blue-100')?.dataset.key;
                    if (dateKey === selectedDateKey) renderHistoryDetail(dateKey);

                    // ✅ [수정] 저장 후 팝업 닫지 않음 (주석 처리됨)
                    // DOM.historyRecordsModal.classList.add('hidden');

                } catch (err) {
                    console.error("일괄 저장 오류:", err);
                    showToast("일괄 저장 중 일부 오류가 발생했습니다.", true);
                } finally {
                    saveAllBtn.disabled = false;
                    saveAllBtn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                        </svg>
                        변경사항 일괄 저장
                    `;
                }
            }
        });
    }
}