// === js/weekend-calendar.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { 
    collection, query, where, getDocs, doc, setDoc, deleteDoc, updateDoc, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-based index
let myRequestsMap = new Map();
let unsubscribe = null; // 실시간 리스너 구독 해제 함수 저장용

// 초기화 함수
export async function initWeekendCalendar() {
    // onSnapshot 내부에서 렌더링을 수행하므로, 여기서는 리스너 연결만 시작
    await loadWeekendRequests(currentYear, currentMonth);
}

export function changeMonth(offset) {
    currentMonth += offset;
    if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    } else if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    }
    // 월 변경 시 리스너 재연결
    loadWeekendRequests(currentYear, currentMonth);
}

// 주말 리스트 렌더링 (틀 그리기)
function renderWeekendList(year, month) {
    const listView = document.getElementById('weekend-list-view');
    const label = document.getElementById('current-month-label');
    
    if (!listView || !label) return;

    // 월 표시
    label.textContent = `${year}년 ${month + 1}월`;
    listView.innerHTML = '';

    const lastDate = new Date(year, month + 1, 0).getDate();
    let hasWeekend = false;

    // 1일부터 말일까지 반복
    for (let d = 1; d <= lastDate; d++) {
        const dateObj = new Date(year, month, d);
        const dayOfWeek = dateObj.getDay();

        // 토(6) 또는 일(0)인 경우만 렌더링
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            hasWeekend = true;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayName = dayOfWeek === 0 ? '일' : '토';
            const dayColor = dayOfWeek === 0 ? 'text-red-600' : 'text-blue-600';
            const bgColor = dayOfWeek === 0 ? 'bg-red-50' : 'bg-blue-50';

            // 리스트 아이템 컨테이너
            const rowItem = document.createElement('div');
            rowItem.className = `flex flex-col md:flex-row md:items-center justify-between p-3 rounded-lg border border-gray-200 shadow-sm transition-all cursor-pointer hover:shadow-md active:scale-[0.99] bg-white group`;
            rowItem.id = `row-${dateStr}`;
            rowItem.onclick = () => handleDateClick(dateStr);

            // 1. 왼쪽: 날짜 정보
            const dateInfo = document.createElement('div');
            dateInfo.className = "flex items-center gap-3 mb-2 md:mb-0";
            dateInfo.innerHTML = `
                <div class="w-12 h-12 flex flex-col items-center justify-center rounded-lg ${bgColor} ${dayColor} font-bold border border-gray-100">
                    <span class="text-xs opacity-70">${month + 1}월</span>
                    <span class="text-lg leading-none">${d}</span>
                </div>
                <div class="flex flex-col">
                    <span class="font-bold text-gray-800 text-lg">${dayName}요일 근무</span>
                    <span class="text-xs text-gray-400 group-hover:text-blue-500 transition-colors">터치하여 신청/취소</span>
                </div>
            `;
            rowItem.appendChild(dateInfo);

            // 2. 오른쪽: 신청자 배지 목록 영역
            const badgesArea = document.createElement('div');
            badgesArea.className = "flex flex-wrap gap-2 justify-end items-center flex-grow pl-0 md:pl-4";
            badgesArea.id = `weekend-list-${dateStr}`; 
            badgesArea.style.minHeight = "28px"; 
            
            rowItem.appendChild(badgesArea);
            listView.appendChild(rowItem);
        }
    }

    if (!hasWeekend) {
        listView.innerHTML = `<div class="text-center text-gray-400 py-10">이 달에는 주말이 없습니다.</div>`;
    }
}

// [핵심 변경] Firestore 실시간 리스너 연결
async function loadWeekendRequests(year, month) {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    // 기존에 연결된 리스너가 있다면 해제 (월 이동 시 중복 방지)
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }

    try {
        const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests');
        const q = query(colRef, where("month", "==", monthStr));

        // onSnapshot을 사용하여 실시간 감시 시작
        unsubscribe = onSnapshot(q, (snapshot) => {
            // 데이터가 변경될 때마다 화면을 새로 그림
            
            // 1. 빈 리스트 틀 먼저 그리기
            renderWeekendList(year, month);
            myRequestsMap.clear();

            // 2. 데이터 채워 넣기
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                addBadgeToCalendar(docSnap.id, data);
                
                // 내 신청 내역 처리 (스타일 강조 등)
                if (data.member === State.appState.currentUser) {
                    myRequestsMap.set(data.date, docSnap.id);
                    
                    const row = document.getElementById(`row-${data.date}`);
                    if (row) {
                        row.classList.remove('bg-white', 'border-gray-200');
                        row.classList.add('bg-indigo-50', 'border-indigo-300', 'ring-1', 'ring-indigo-300');
                        
                        const hintText = row.querySelector('.text-xs.text-gray-400');
                        if(hintText) {
                            hintText.textContent = "✅ 신청됨 (터치하여 취소)";
                            hintText.classList.add('text-indigo-600', 'font-medium');
                            hintText.classList.remove('text-gray-400');
                        }
                    }
                }
            });
        }, (error) => {
            console.error("Error in weekend listener:", error);
            showToast("실시간 데이터를 불러오지 못했습니다.", true);
        });

    } catch (e) {
        console.error("Error setting up listener:", e);
    }
}

// 리스트에 배지(이름표) 추가
function addBadgeToCalendar(docId, data) {
    const container = document.getElementById(`weekend-list-${data.date}`);
    if (!container) return;

    const isAdmin = (State.appState.currentUserRole === 'admin');
    
    const badge = document.createElement('div');
    const colorClass = data.status === 'confirmed' 
        ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
        : 'bg-white text-orange-600 border-orange-300 border shadow-sm'; 
    
    badge.className = `px-3 py-1 rounded-full text-sm font-medium border flex items-center gap-1 transition-transform hover:scale-105 ${colorClass}`;
    
    const icon = data.status === 'confirmed' ? '👌' : '⏳';
    badge.innerHTML = `<span class="text-xs">${icon}</span> ${data.member}`;

    if (isAdmin) {
        badge.style.cursor = 'pointer';
        badge.onclick = (e) => {
            e.stopPropagation(); 
            handleAdminBadgeClick(docId, data);
        };
    } else {
        badge.onclick = (e) => {
            e.stopPropagation(); 
        };
    }

    container.appendChild(badge);
}

// 클릭 핸들러
async function handleDateClick(dateStr) {
    const member = State.appState.currentUser;
    if (!member) {
        showToast("로그인이 필요합니다.", true);
        return;
    }

    if (myRequestsMap.has(dateStr)) {
        if (confirm(`${dateStr} 근무 신청을 취소하시겠습니까?`)) {
            const docId = myRequestsMap.get(dateStr);
            await deleteRequest(docId);
        }
    } else {
        if (confirm(`${dateStr} 근무를 신청하시겠습니까?`)) {
            await createRequest(dateStr, member);
        }
    }
}

// 신청 생성 (수동 새로고침 삭제됨)
async function createRequest(dateStr, member) {
    const monthStr = dateStr.substring(0, 7);
    const docId = `${dateStr}_${member}`; 

    const requestData = {
        date: dateStr,
        month: monthStr,
        member: member,
        reason: "", 
        status: 'requested',
        createdAt: new Date().toISOString()
    };

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await setDoc(docRef, requestData);
        showToast("신청되었습니다.");
        // initWeekendCalendar(); // <-- 삭제됨 (자동 업데이트)
    } catch (e) {
        console.error("Error creating request:", e);
        showToast("신청 실패", true);
    }
}

// 신청 삭제 (수동 새로고침 삭제됨)
async function deleteRequest(docId) {
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await deleteDoc(docRef);
        showToast("취소되었습니다.");
        // initWeekendCalendar(); // <-- 삭제됨 (자동 업데이트)
    } catch (e) {
        console.error("Error deleting request:", e);
        showToast("취소 실패", true);
    }
}

// 관리자 팝업 핸들러
function handleAdminBadgeClick(docId, data) {
    const popup = document.getElementById('weekend-admin-popup');
    document.getElementById('admin-popup-member').textContent = data.member;
    
    const statusSpan = document.getElementById('admin-popup-status');
    statusSpan.textContent = data.status === 'confirmed' ? '승인됨' : '대기 중';
    statusSpan.className = data.status === 'confirmed' ? 'font-bold text-blue-600' : 'font-bold text-orange-500';

    document.getElementById('admin-confirm-btn').onclick = () => processAdminAction(docId, 'confirmed');
    document.getElementById('admin-reject-btn').onclick = () => processAdminAction(docId, 'delete');
    document.getElementById('admin-close-popup-btn').onclick = () => popup.classList.add('hidden');

    popup.classList.remove('hidden');
}

// 관리자 액션 처리 (수동 새로고침 삭제됨)
async function processAdminAction(docId, action) {
    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
    try {
        if (action === 'delete') {
            await deleteDoc(docRef);
            showToast("반려(삭제) 완료");
        } else if (action === 'confirmed') {
            await updateDoc(docRef, { status: 'confirmed', confirmedAt: new Date().toISOString() });
            showToast("승인 완료");
        }
        document.getElementById('weekend-admin-popup').classList.add('hidden');
        // initWeekendCalendar(); // <-- 삭제됨 (자동 업데이트)
    } catch (e) {
        console.error("Error admin action:", e);
        showToast("처리 실패", true);
    }
}