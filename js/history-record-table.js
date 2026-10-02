// === js/history-record-table.js ===
// 설명: '기록 관리' 모달 내의 테이블 렌더링 및 필터링 로직을 담당합니다.

import * as DOM from './dom-elements.js?v=202610021042';
import * as State from './state.js?v=202610021042';
import { showToast, formatDuration, calcTotalPauseMinutes } from './utils.js?v=202610021042';

/**
 * 기록 관리 모달을 엽니다.
 */
export const openHistoryRecordManager = (dateKey) => {
    const data = State.allHistoryData.find(d => d.id === dateKey);
    if (!data) {
        showToast('데이터를 찾을 수 없습니다.', true);
        return;
    }

    if (DOM.historyRecordsDateSpan) DOM.historyRecordsDateSpan.textContent = dateKey;

    // 필터 초기화 및 옵션 채우기
    const records = data.workRecords || [];
    const members = new Set(records.map(r => r.member).filter(Boolean));
    const tasks = new Set(records.map(r => r.task).filter(Boolean));
    
    const memberSelect = document.getElementById('history-record-filter-member');
    const taskSelect = document.getElementById('history-record-filter-task');

    if (memberSelect) {
        memberSelect.innerHTML = '<option value="">전체</option>';
        [...members].sort().forEach(m => {
            memberSelect.innerHTML += `<option value="${m}">${m}</option>`;
        });
        memberSelect.value = ''; // Reset
    }
    if (taskSelect) {
        taskSelect.innerHTML = '<option value="">전체</option>';
        [...tasks].sort().forEach(t => {
            taskSelect.innerHTML += `<option value="${t}">${t}</option>`;
        });
        taskSelect.value = ''; // Reset
    }

    // 일괄 수정 패널 숨김 (기존 로직 유지)
    const batchArea = document.getElementById('history-record-batch-edit-area');
    if (batchArea) batchArea.classList.add('hidden');

    // ✅ [신규] 하단 버튼 영역에 '일괄 저장' 버튼 주입
    // 기존의 '닫기' 버튼이 있는 영역을 찾습니다.
    const modalFooter = DOM.historyRecordsModal.querySelector('.border-t.flex.justify-end');
    if (modalFooter) {
        // 기존에 주입된 버튼이 있다면 제거 (중복 방지)
        const oldSaveBtn = modalFooter.querySelector('#history-record-save-all-btn');
        if (oldSaveBtn) oldSaveBtn.remove();

        // 닫기 버튼(기존) 찾기 및 스타일 변경
        const closeBtn = modalFooter.querySelector('button');
        if (closeBtn) {
            closeBtn.textContent = '취소 / 닫기'; 
            closeBtn.classList.remove('bg-white', 'hover:bg-gray-50', 'text-gray-700');
            closeBtn.classList.add('bg-gray-100', 'hover:bg-gray-200', 'text-gray-600', 'mr-2');
        }

        // '일괄 저장' 버튼 생성
        const saveAllBtn = document.createElement('button');
        saveAllBtn.id = 'history-record-save-all-btn';
        saveAllBtn.className = 'bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition shadow-md flex items-center gap-2';
        saveAllBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
            변경사항 일괄 저장
        `;
        
        // footer에 추가
        modalFooter.appendChild(saveAllBtn);
    }

    renderHistoryRecordsTable(dateKey); // 초기 렌더링 (전체)

    if (DOM.historyRecordsModal) DOM.historyRecordsModal.classList.remove('hidden');
}

/**
 * 기록 관리 테이블을 렌더링합니다. (필터링 및 일괄수정 UI 연동 포함)
 */
export const renderHistoryRecordsTable = (dateKey) => {
    if (!DOM.historyRecordsTableBody) return;
    
    const data = State.allHistoryData.find(d => d.id === dateKey);
    const records = data ? (data.workRecords || []) : [];

    // 필터 값 읽기
    const memberFilter = document.getElementById('history-record-filter-member')?.value;
    const taskFilter = document.getElementById('history-record-filter-task')?.value;

    // 일괄 수정 패널 표시 여부 제어
    const batchArea = document.getElementById('history-record-batch-edit-area');
    if (batchArea) {
        if (taskFilter) {
            batchArea.classList.remove('hidden');
            batchArea.classList.add('flex');
        } else {
            batchArea.classList.add('hidden');
            batchArea.classList.remove('flex');
        }
    }
    
    DOM.historyRecordsTableBody.innerHTML = '';
    
    // 필터링
    const filtered = records.filter(r => {
        if (memberFilter && r.member !== memberFilter) return false;
        if (taskFilter && r.task !== taskFilter) return false;
        return true;
    });

    // 정렬: 시작 시간 순
    const sorted = filtered.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    const allTasks = (State.appConfig.taskGroups || []).flatMap(g => g.tasks).sort();
    
    sorted.forEach(r => {
        const tr = document.createElement('tr');
        tr.className = 'bg-white border-b hover:bg-gray-50 transition history-record-row';
        tr.dataset.recordId = r.id; // 행에 ID 저장 (일괄 저장 시 식별용)
        
        // 업무 선택 옵션 생성
        let taskOptions = '';
        const uniqueTasks = new Set([...allTasks, r.task]); 
        Array.from(uniqueTasks).sort().forEach(t => {
            taskOptions += `<option value="${t}" ${t === r.task ? 'selected' : ''}>${t}</option>`;
        });

        // 휴식 시간 계산 및 표시
        const pauseMinutes = calcTotalPauseMinutes(r.pauses);
        const pauseText = pauseMinutes > 0 ? ` <span class="text-xs text-gray-400 block">(휴: ${formatDuration(pauseMinutes)})</span>` : '';

        // ✅ [수정] 개별 '저장' 버튼 제거하고 '복제' 버튼 추가
        tr.innerHTML = `
            <td class="px-6 py-4 font-medium text-gray-900 w-[15%]">${r.member}</td>
            <td class="px-6 py-4 w-[20%]">
                <select class="history-record-task w-full p-1 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500">
                    ${taskOptions}
                </select>
            </td>
            <td class="px-6 py-4 w-[15%]">
                <input type="time" class="history-record-start w-full p-1 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500" value="${r.startTime || ''}">
            </td>
            <td class="px-6 py-4 w-[15%]">
                <input type="time" class="history-record-end w-full p-1 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500" value="${r.endTime || ''}">
            </td>
            <td class="px-6 py-4 text-gray-500 text-xs w-[15%]">
                ${formatDuration(r.duration)}${pauseText}
            </td>
            <td class="px-6 py-4 text-right space-x-1 w-[20%]">
                <button class="text-indigo-600 hover:text-indigo-800 font-semibold text-xs border border-indigo-200 rounded px-2 py-1.5 hover:bg-indigo-50 transition" 
                    data-action="duplicate-history-record" 
                    data-date-key="${dateKey}" 
                    data-record-id="${r.id}"
                    title="이 기록 복제하여 추가">
                    복제
                </button>
                <button class="text-red-500 hover:text-red-700 font-semibold text-xs border border-red-200 rounded px-2 py-1.5 hover:bg-red-50 transition" 
                    data-action="delete-history-record" 
                    data-date-key="${dateKey}" 
                    data-record-id="${r.id}">
                    삭제
                </button>
            </td>
        `;
        DOM.historyRecordsTableBody.appendChild(tr);
    });
    
    if (sorted.length === 0) {
        DOM.historyRecordsTableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">조건에 맞는 기록이 없습니다.</td></tr>';
    }
};