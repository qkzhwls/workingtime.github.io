// === js/admin-todo-logic.js ===
import * as State from './state.js?v=202610021042';
import * as DOM from './dom-elements.js?v=202610021042';
import { showToast } from './utils.js?v=202610021042';
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeFirebase } from './config.js?v=202610021042';

// 🔥 [신규] 멘션 발송을 위해 알림 함수 가져오기
import { sendNotification } from './app-notifications.js?v=202610021042';

const createId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

const formatDateTimeShort = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    return `${m}/${d} ${h}:${min}`;
};

const getTodoDocRef = () => {
    const firebase = initializeFirebase();
    return doc(firebase.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'adminTodos');
};

let isSnapshotAttached = false; 

// ==========================================
// 1. 공통 데이터 로드 및 저장 (실시간 동기화)
// ==========================================
export const loadAdminTodos = () => {
    return new Promise((resolve) => {
        try {
            if (isSnapshotAttached) {
                resolve();
                return;
            }
            isSnapshotAttached = true;
            
            onSnapshot(getTodoDocRef(), (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    State.appState.adminTodos = data.tasks || [];
                    State.appState.importantNotices = data.notices || [];
                } else {
                    State.appState.adminTodos = [];
                    State.appState.importantNotices = [];
                }
                
                renderAdminTodoList();
                document.dispatchEvent(new CustomEvent('renderNotices'));
                // 일정이 지난 공지 정리. 지우면 스냅샷이 다시 돌아 화면도 갱신된다.
                purgeExpiredNotices().catch(e => console.warn('지난 공지 정리 실패:', e));
                resolve(); 
            }, (error) => {
                console.error("실시간 동기화 오류:", error);
                resolve(); 
            });
        } catch (e) {
            console.error("데이터 로딩 오류:", e);
            resolve();
        }
    });
};

export const saveAdminTodos = async () => {
    try {
        await setDoc(getTodoDocRef(), { 
            tasks: State.appState.adminTodos || [],
            notices: State.appState.importantNotices || [] 
        }, { merge: true });
    } catch (e) {
        console.error("데이터 저장 오류:", e);
    }
};

// ==========================================
// 2. 관리자 투두(Todo) 전용 로직
// ==========================================
export const renderAdminTodoList = () => {
    const listEl = document.getElementById('admin-todo-list');
    if (!listEl) return;

    const todos = State.appState.adminTodos || [];
    listEl.innerHTML = '';

    if (todos.length === 0) {
        listEl.innerHTML = '<li class="text-center text-gray-400 text-xs py-10">등록된 할 일이 없습니다.<br>일정을 설정하여 추가해보세요!</li>';
        return;
    }

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

export const addTodo = async (text, dateStr) => {
    if (!text.trim()) { showToast("내용을 입력해주세요.", true); return; }
    const newTodo = {
        id: createId(), text: text.trim(), completed: false, dueDateTime: dateStr || null, alertConfirmed: false, createdAt: Date.now()
    };
    State.appState.adminTodos.push(newTodo);
    await saveAdminTodos();
};

export const toggleTodo = async (id) => {
    const todo = State.appState.adminTodos.find(t => t.id === id);
    if (todo) {
        todo.completed = !todo.completed;
        await saveAdminTodos();
    }
};

export const deleteTodo = async (id) => {
    if (!confirm("이 할 일을 삭제하시겠습니까?")) return;
    State.appState.adminTodos = State.appState.adminTodos.filter(t => t.id !== id);
    await saveAdminTodos();
};

export const checkAdminTodoNotifications = async () => {
    const todos = State.appState.adminTodos || [];
    const now = new Date();
    
    const pendingTasks = todos.filter(t => !t.completed && t.dueDateTime && new Date(t.dueDateTime) <= now && !t.alertConfirmed);

    if (pendingTasks.length > 0) {
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
            
            if (DOM.adminTodoAlertModal.classList.contains('hidden')) {
                DOM.adminTodoAlertModal.classList.remove('hidden');
                if (Notification.permission === "granted") {
                    new Notification("할 일 마감 알림", { body: `${pendingTasks.length}건의 마감된 할 일이 있습니다.` });
                }
            }
        }
    }
};

export const confirmPendingAlerts = async () => {
    const todos = State.appState.adminTodos || [];
    const now = new Date();
    let hasChanges = false;

    todos.forEach(t => {
        if (!t.completed && t.dueDateTime && new Date(t.dueDateTime) <= now && !t.alertConfirmed) {
            t.alertConfirmed = true; 
            hasChanges = true;
        }
    });

    if (hasChanges) {
        await saveAdminTodos();
    }
    if (DOM.adminTodoAlertModal) { DOM.adminTodoAlertModal.classList.add('hidden'); }
};

// ==========================================
// 3. 중요 알림(Notice) 전용 로직
// ==========================================

// 🔥 [신규] 텍스트 내에서 '@이름' 멘션을 찾아 알림을 발송하는 헬퍼 함수
const processMentions = async (text) => {
    const sender = State.appState.currentUser || '관리자';
    const mentionRegex = /@([가-힣a-zA-Z0-9]+)/g;
    const matches = [...text.matchAll(mentionRegex)];
    
    if (matches.length > 0) {
        const uniqueMentions = [...new Set(matches.map(m => m[1]))];
        
        // 유효한 대상자인지 확인하기 위해 전체 멤버 세트 구성
        const allMembers = new Set();
        (State.appConfig?.teamGroups || []).forEach(g => g.members?.forEach(m => allMembers.add(m)));
        (State.appState?.partTimers || []).forEach(p => allMembers.add(p.name));

        const shortText = text.length > 20 ? text.substring(0, 20) + '...' : text;

        for (const name of uniqueMentions) {
            if (allMembers.has(name) && name !== sender) {
                // 발송
                await sendNotification(name, `🔔 중요 알림에서 ${sender}님이 회원님을 멘션했습니다:\n"${shortText}"`, 'mention');
            }
        }
    }
};

/**
 * @param {string} text  공지 내용
 * @param {string} [scheduleAt]  'YYYY-MM-DDTHH:MM' 형태의 일정. 비우면 일정 없는 공지.
 */
/** 일정이 지난 공지를 걷어낸다.
 *
 *  '지났다'의 기준은 **그 날짜가 끝난 뒤**다(다음 날 00:00 이후).
 *  시간을 14:00 으로 넣었다고 14:01 에 사라지면, 정작 그날 확인해야 할
 *  공지가 눈앞에서 없어진다. 하루는 온전히 남겨 둔다.
 *
 *  일정이 없는 공지는 건드리지 않는다.
 *  지우는 것이므로 되돌릴 수 없다 — 조건을 좁게 잡은 이유다.
 */
export const purgeExpiredNotices = async () => {
    const list = State.appState.importantNotices || [];
    if (list.length === 0) return 0;

    const today = new Date(); today.setHours(0, 0, 0, 0);

    const kept = list.filter(n => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(n && n.scheduleAt || ''));
        if (!m) return true;                       // 일정 없는 공지는 그대로
        const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return day >= today;                       // 오늘 것까지는 남긴다
    });

    const removed = list.length - kept.length;
    if (removed === 0) return 0;

    State.appState.importantNotices = kept;
    await saveAdminTodos();
    return removed;
};

export const addNotice = async (text, scheduleAt = '') => {
    if (!text.trim()) { showToast("알림 내용을 입력해주세요.", true); return; }
    const newNotice = {
        id: createId(), text: text.trim(), completed: false, createdAt: Date.now()
    };
    // 일정은 넣었을 때만 담는다. 빈 값을 넣어 두면 '일정 없음'과 구분이 흐려진다.
    if (String(scheduleAt || '').trim()) newNotice.scheduleAt = String(scheduleAt).trim();
    if(!State.appState.importantNotices) State.appState.importantNotices = [];
    State.appState.importantNotices.push(newNotice);
    
    await saveAdminTodos();
    
    // 멘션 감지 및 푸시
    await processMentions(text.trim());
};

export const toggleNotice = async (id) => {
    const notice = State.appState.importantNotices.find(n => n.id === id);
    if (notice) {
        notice.completed = !notice.completed;
        await saveAdminTodos();
    }
};

export const deleteNotice = async (id) => {
    if (!confirm("이 중요 알림을 삭제하시겠습니까?")) return;
    State.appState.importantNotices = State.appState.importantNotices.filter(n => n.id !== id);
    await saveAdminTodos();
};

export const editNotice = async (id, newText, scheduleAt) => {
    const notice = State.appState.importantNotices.find(n => n.id === id);
    if (notice && newText.trim()) {
        notice.text = newText.trim();
        // undefined 면 손대지 않고, 빈 문자열이면 일정을 없앤다
        if (scheduleAt !== undefined) {
            if (String(scheduleAt).trim()) notice.scheduleAt = String(scheduleAt).trim();
            else delete notice.scheduleAt;
        }
        await saveAdminTodos();

        // 수정 시에도 새롭게 멘션된 사람이 있다면 푸시
        await processMentions(newText.trim());
    }
};