// === js/app-notifications.js ===
import * as State from './state.js';
import { doc, writeBatch, deleteDoc, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showToast } from './utils.js';

export async function sendNotification(targetMember, message, type = 'info') {
    try {
        const notiColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications');
        await addDoc(notiColRef, {
            targetMember,
            message,
            type,
            isRead: false,
            createdAt: new Date().toISOString()
        });
    } catch(e) {
        console.error("알림 발송 실패", e);
    }
}

export function renderNotificationList() {
    const list = document.getElementById('notification-list');
    if (!list) return;
    const notis = State.appState.notifications || [];
    if (notis.length === 0) {
        list.innerHTML = '<li class="text-center text-gray-400 dark:text-gray-500 py-8 text-sm">알림이 없습니다.</li>';
        return;
    }
    
    list.innerHTML = notis.map(n => `
        <li class="p-3 rounded-lg border ${n.isRead ? 'bg-gray-50 border-gray-200 dark:bg-gray-700/50 dark:border-gray-600 text-gray-500 dark:text-gray-400' : 'bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800 text-gray-800 dark:text-gray-200'} shadow-sm relative pr-8">
            <div class="text-[10px] font-bold mb-1 opacity-70">${new Date(n.createdAt).toLocaleString('ko-KR', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</div>
            <div class="text-sm font-medium leading-snug break-words">${n.message}</div>
            <button class="absolute top-2 right-2 text-gray-400 hover:text-red-500 font-bold text-lg delete-single-noti-btn transition" data-id="${n.id}">&times;</button>
        </li>
    `).join('');
}

export async function markAllNotificationsAsRead() {
    const unreadNotis = (State.appState.notifications || []).filter(n => !n.isRead);
    if(unreadNotis.length === 0) return;
    
    try {
        const batch = writeBatch(State.db);
        unreadNotis.forEach(n => {
            const ref = doc(State.db, 'artifacts', 'team-work-logger-v2', 'notifications', n.id);
            batch.update(ref, { isRead: true, readAt: new Date().toISOString() });
        });
        await batch.commit();
    } catch(e) {
        console.error("일괄 읽음 처리 실패:", e);
    }
}

export function setupNotificationListeners() {
    const notiModal = document.getElementById('notification-modal');
    const bellPc = document.getElementById('notification-bell-btn');
    const bellMobile = document.getElementById('notification-bell-btn-mobile');
    const closeNoti = document.getElementById('close-notification-modal-btn');
    
    function toggleNotiModal() {
        if (!notiModal) return;
        notiModal.classList.toggle('hidden');
        if (!notiModal.classList.contains('hidden')) {
            renderNotificationList();
        }
    }
    
    bellPc?.addEventListener('click', toggleNotiModal);
    bellMobile?.addEventListener('click', toggleNotiModal);
    closeNoti?.addEventListener('click', () => notiModal?.classList.add('hidden'));
    
    document.getElementById('read-all-noti-btn')?.addEventListener('click', markAllNotificationsAsRead);
    
    document.getElementById('clear-all-noti-btn')?.addEventListener('click', async () => {
        if (!State.appState.notifications || State.appState.notifications.length === 0) return;
        if (!confirm('모든 알림을 삭제하시겠습니까?')) return;
        
        try {
            const batch = writeBatch(State.db);
            State.appState.notifications.forEach(n => {
                batch.delete(doc(State.db, 'artifacts', 'team-work-logger-v2', 'notifications', n.id));
            });
            await batch.commit();
        } catch(e) {
            console.error('알림 전체 삭제 실패:', e);
        }
    });

    document.getElementById('notification-list')?.addEventListener('click', async (e) => {
        if(e.target.classList.contains('delete-single-noti-btn')) {
            const id = e.target.dataset.id;
            try {
                await deleteDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'notifications', id));
            } catch(err) {
                console.error("개별 알림 삭제 실패:", err);
            }
        }
    });

    // 🔥 쪽지 보내기 관련 이벤트 리스너 수정 (다중/전체 선택 기능)
    const openSendMsgBtn = document.getElementById('open-send-msg-btn');
    const closeSendMsgBtn = document.getElementById('close-send-msg-btn');
    const sendMsgModal = document.getElementById('send-message-modal');
    const sendMsgSubmitBtn = document.getElementById('send-msg-submit-btn');
    
    openSendMsgBtn?.addEventListener('click', () => {
        const listContainer = document.getElementById('msg-target-list');
        const selectAllCb = document.getElementById('msg-target-select-all');
        
        if (listContainer) listContainer.innerHTML = '';
        if (selectAllCb) selectAllCb.checked = false;
        
        const members = new Set();
        (State.appConfig?.teamGroups || []).forEach(g => g.members?.forEach(m => members.add(m)));
        (State.appState?.partTimers || []).forEach(p => members.add(p.name));
        
        Array.from(members).sort().forEach(m => {
            if (m !== State.appState.currentUser) {
                const label = document.createElement('label');
                label.className = 'flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-600 p-1.5 rounded-md transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-500';
                label.innerHTML = `<input type="checkbox" value="${m}" class="msg-target-checkbox w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 bg-white dark:bg-gray-800 cursor-pointer"> <span class="truncate font-medium">${m}</span>`;
                if (listContainer) listContainer.appendChild(label);
            }
        });

        document.getElementById('msg-content-input').value = '';
        sendMsgModal?.classList.remove('hidden');
    });

    // "전체 선택" 묶음 처리 로직
    const selectAllCb = document.getElementById('msg-target-select-all');
    const listContainer = document.getElementById('msg-target-list');
    
    if (selectAllCb && listContainer) {
        selectAllCb.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            listContainer.querySelectorAll('.msg-target-checkbox').forEach(cb => cb.checked = isChecked);
        });

        listContainer.addEventListener('change', (e) => {
            if (e.target.classList.contains('msg-target-checkbox')) {
                const allCbs = listContainer.querySelectorAll('.msg-target-checkbox');
                const allChecked = Array.from(allCbs).every(cb => cb.checked);
                selectAllCb.checked = allChecked;
            }
        });
    }

    closeSendMsgBtn?.addEventListener('click', () => {
        sendMsgModal?.classList.add('hidden');
    });

    sendMsgSubmitBtn?.addEventListener('click', async () => {
        const selectedCbs = document.querySelectorAll('.msg-target-checkbox:checked');
        const targets = Array.from(selectedCbs).map(cb => cb.value);
        const text = document.getElementById('msg-content-input').value.trim();
        
        if (targets.length === 0) return showToast('받는 사람을 1명 이상 선택해주세요.', true);
        if (!text) return showToast('메시지 내용을 입력해주세요.', true);
        
        const sender = State.appState.currentUser || '관리자';
        const finalMsg = `✉️ [${sender}님의 쪽지]\n${text}`;

        const originalBtnText = sendMsgSubmitBtn.textContent;
        sendMsgSubmitBtn.disabled = true;
        sendMsgSubmitBtn.textContent = '전송 중...';

        try {
            // 여러 명에게 병렬로 알림 발송
            await Promise.all(targets.map(target => sendNotification(target, finalMsg, 'message')));
            
            showToast(`${targets.length}명에게 쪽지를 성공적으로 보냈습니다.`);
            sendMsgModal?.classList.add('hidden');
        } catch (e) {
            showToast('쪽지 발송 중 오류가 발생했습니다.', true);
            console.error(e);
        } finally {
            sendMsgSubmitBtn.disabled = false;
            sendMsgSubmitBtn.textContent = originalBtnText;
        }
    });
}