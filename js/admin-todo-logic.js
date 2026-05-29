// === js/admin-todo-logic.js ===
import * as State from './state.js';
import * as DOM from './dom-elements.js'; // ✅ DOM 요소 임포트 추가
import { showToast } from './utils.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 헬퍼: ID 생성
const createId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// 헬퍼: 날짜 포맷 (MM/DD HH:mm)
const formatDateTimeShort = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    return `${m}/${d} ${h}:${min}`;
};

// Firestore 참조
const getTodoDocRef = () => doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'adminTodos');

// 1. 데이터 로드
export const loadAdminTodos = async () => {
    try {
        const docSnap = await getDoc(getTodoDocRef());
        if (docSnap.exists()) {
            State.appState.adminTodos = docSnap.data().tasks || [];
        } else {
            State.appState.adminTodos = [];
        }
        renderAdminTodoList();
    } catch (e) {
        console.error("Error loading admin todos:", e);
        showToast("할 일 목록을 불러오지 못했습니다.", true);
    }
};

// 2. 데이터 저장
const saveAdminTodos = async () => {
    try {
        await setDoc(getTodoDocRef(), { tasks: State.appState.adminTodos }, { merge: true });
    } catch (e) {
        console.error("Error saving admin todos:", e);
    }
};

// 3. 리스트 렌더링
export const renderAdminTodoList = () => {
    const listEl = document.getElementById('admin-todo-list');
    if (!listEl) return;

    const todos = State.appState.adminTodos || [];
    listEl.innerHTML = '';

    if (todos.length === 0) {
        listEl.innerHTML = '<li class="text-center text-gray-400 text-xs py-10">등록된 할 일이 없습니다.<br>일정을 설정하여 추가해보세요!</li>';
        return;
    }

    // 정렬: 미완료 상단 > 날짜 임박순 > 최신순
    const sortedTodos = [...todos].sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const dateA = a.dueDateTime ? new Date(a.dueDateTime).getTime() : Infinity;
        const dateB = b.dueDateTime ? new Date(b.dueDateTime).getTime() : Infinity;
        if (dateA !== dateB) return dateA - dateB;
        return b.createdAt - a.createdAt;
    });

    const now = new Date();

    sortedTodos.forEach(todo => {
        const li = document.createElement('li');
        li.className = `flex items-center justify-between p-3 rounded-lg border transition ${todo.completed ? 'bg-gray-100 border-gray-200' : 'bg-white border-gray-300 shadow-sm hover:border-indigo-300'}`;
        
        let dateBadge = '';
        if (todo.dueDateTime) {
            const dueDate = new Date(todo.dueDateTime);
            const isOverdue = !todo.completed && dueDate < now;
            // alertConfirmed 여부에 따라 스타일 다르게 (미확인이면 빨간색 강조)
            const isUnconfirmed = isOverdue && !todo.alertConfirmed;
            
            const dateClass = isUnconfirmed ? 'text-red-600 bg-red-50 border-red-200 font-bold animate-pulse' : 
                              (isOverdue ? 'text-red-500 bg-red-50 border-red-100' : 
                              (todo.completed ? 'text-gray-400 bg-gray-50 border-gray-200' : 'text-blue-600 bg-blue-50 border-blue-200'));
            
            const icon = isOverdue ? '🚨' : '⏰';
            dateBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded border ml-2 whitespace-nowrap ${dateClass}">${icon} ${formatDateTimeShort(todo.dueDateTime)}</span>`;
        }

        li.innerHTML = `
            <div class="flex flex-col flex-grow min-w-0 cursor-pointer todo-item-click" data-id="${todo.id}">
                <div class="flex items-center">
                    <div class="flex-shrink-0 text-lg mr-2">
                        ${todo.completed ? '✅' : '⬜'}
                    </div>
                    <span class="text-sm truncate ${todo.completed ? 'text-gray-400 line-through' : 'text-gray-800 font-medium'}">
                        ${todo.text}
                    </span>
                </div>
                ${dateBadge ? `<div class="ml-7 mt-1">${dateBadge}</div>` : ''}
            </div>
            <button class="delete-todo-btn text-gray-400 hover:text-red-500 p-2 transition flex-shrink-0 ml-2" data-id="${todo.id}" title="삭제">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
            </button>
        `;
        listEl.appendChild(li);
    });
};

// 4. 액션: 추가
export const addTodo = async (text, dateStr) => {
    if (!text.trim()) {
        showToast("내용을 입력해주세요.", true);
        return;
    }
    const newTodo = {
        id: createId(),
        text: text.trim(),
        completed: false,
        dueDateTime: dateStr || null, 
        alertConfirmed: false, // ✅ 수정: alertSent -> alertConfirmed
        createdAt: Date.now()
    };
    State.appState.adminTodos.push(newTodo);
    renderAdminTodoList();
    await saveAdminTodos();
};

// 5. 액션: 토글
export const toggleTodo = async (id) => {
    const todo = State.appState.adminTodos.find(t => t.id === id);
    if (todo) {
        todo.completed = !todo.completed;
        renderAdminTodoList();
        await saveAdminTodos();
    }
};

// 6. 액션: 삭제
export const deleteTodo = async (id) => {
    if (!confirm("이 할 일을 삭제하시겠습니까?")) return;
    State.appState.adminTodos = State.appState.adminTodos.filter(t => t.id !== id);
    renderAdminTodoList();
    await saveAdminTodos();
};

// ✅ [수정] 7. 알림 체크 (사라지지 않는 팝업 로직)
export const checkAdminTodoNotifications = async () => {
    const todos = State.appState.adminTodos || [];
    const now = new Date();
    
    // 조건: 미완료 + 마감시간 지남 + 아직 확인 안 함(alertConfirmed == false)
    const pendingTasks = todos.filter(t => 
        !t.completed && 
        t.dueDateTime && 
        new Date(t.dueDateTime) <= now && 
        !t.alertConfirmed
    );

    if (pendingTasks.length > 0) {
        // 모달 내용 업데이트
        if (DOM.adminTodoAlertModal && DOM.adminTodoAlertList) {
            DOM.adminTodoAlertList.innerHTML = pendingTasks.map(t => `
                <div class="flex items-start gap-3 bg-white p-3 rounded border border-indigo-100 shadow-sm">
                    <span class="text-indigo-500 mt-1 text-xs">●</span>
                    <div class="flex-grow">
                        <div class="font-bold text-indigo-900 text-sm">${t.text}</div>
                        <div class="text-xs text-indigo-500 mt-1 flex items-center gap-1">
                            ⏰ 마감: ${t.dueDateTime.replace('T', ' ')}
                        </div>
                    </div>
                </div>
            `).join('');
            
            // 🚨 여기서 바로 저장하지 않습니다! (버튼 누를 때 저장)
            // 모달이 꺼져있다면 켬 (이미 켜져있으면 내용만 갱신됨)
            if (DOM.adminTodoAlertModal.classList.contains('hidden')) {
                DOM.adminTodoAlertModal.classList.remove('hidden');
                
                // 브라우저 알림은 최초 팝업 시 1회만 (선택 사항)
                if (Notification.permission === "granted") {
                    new Notification("할 일 마감 알림", { body: `${pendingTasks.length}건의 마감된 할 일이 있습니다.` });
                }
            }
        }
    }
};

// ✅ [신규] 8. 알림 확인 처리 (버튼 클릭 시 호출)
export const confirmPendingAlerts = async () => {
    const todos = State.appState.adminTodos || [];
    const now = new Date();
    let hasChanges = false;

    // 현재 시점 기준으로 마감된 모든 미확인 항목을 '확인됨'으로 변경
    todos.forEach(t => {
        if (!t.completed && t.dueDateTime && new Date(t.dueDateTime) <= now && !t.alertConfirmed) {
            t.alertConfirmed = true; 
            hasChanges = true;
        }
    });

    // 변경사항이 있으면 DB 저장 및 UI 갱신
    if (hasChanges) {
        await saveAdminTodos();
        renderAdminTodoList(); // To-Do 리스트의 빨간 배지 제거 등 업데이트
    }
    
    // 모달 닫기
    if (DOM.adminTodoAlertModal) {
        DOM.adminTodoAlertModal.classList.add('hidden');
    }
};