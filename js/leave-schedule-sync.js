// === js/leave-schedule-sync.js ===
// 🔗 근태(연차) 일정 단일 동기화 지점
//
// 근태는 여러 화면에서 등록·수정·삭제된다:
//   · 내 연차관리 / 근태 설정 모달 (listeners-form-attendance.js)
//   · 대시보드 업무 캘린더        (widget-calendar.js)
//   · 근태 복귀(취소) 확인        (listeners-modals-confirm.js)
//   · 데이터 관리 연차 편집       (ui-history-leave.js)
//
// 예전에는 각자 Firestore에 쓰고 `State.persistentLeaveSchedule`만 갱신한 뒤
// 자기 화면만 다시 그렸다. 그래서 한 곳에서 등록해도 대시보드 근태예정 위젯이나
// 캘린더는 새로고침 전까지 옛 내용을 그대로 보여줬다.
//
// 이 모듈은 두 가지를 맡는다.
//  1) notifyLeaveScheduleChanged() — 저장한 쪽이 알리면 구독한 모든 화면이 다시 그린다.
//  2) subscribeLeaveSchedule()     — Firestore 문서를 실시간 구독해, 다른 사람·다른 탭에서
//                                    바뀐 근태도 메모리에 반영하고 같은 알림을 쏜다.

import * as State from './state.js?v=202610021042';
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const LEAVE_CHANGED_EVENT = 'leave-schedule-changed';

/** 근태를 저장·삭제한 뒤 반드시 호출할 것. */
export function notifyLeaveScheduleChanged(source = '') {
    try {
        document.dispatchEvent(new CustomEvent(LEAVE_CHANGED_EVENT, { detail: { source } }));
    } catch (e) {
        console.warn('[leave-sync] 알림 실패:', e);
    }
}

/** 근태 변경 구독. 같은 handler를 중복 등록하지 않도록 key로 관리한다. */
const bound = new Set();
export function onLeaveScheduleChanged(key, handler) {
    if (bound.has(key)) return;
    bound.add(key);
    document.addEventListener(LEAVE_CHANGED_EVENT, handler);
}

let unsubscribe = null;
let lastJson = null;

/** Firestore 실시간 구독 시작 (로그인 후 1회). */
export function subscribeLeaveSchedule() {
    if (unsubscribe || !State.db) return;

    // ⚠️ 이 문서의 구독은 여기 한 곳뿐이어야 한다.
    //    예전에는 app-sync.js 도 같은 문서를 따로 구독해, 근태가 한 번 바뀔 때마다
    //    탭마다 읽기가 2회씩 발생했다. 파생값 계산은 아래 알림을 받아서 한다.
    const ref = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
    unsubscribe = onSnapshot(ref, (snap) => {
        const data = snap.exists() ? snap.data() : { onLeaveMembers: [] };
        const list = Array.isArray(data.onLeaveMembers) ? data.onLeaveMembers : [];

        // 내용이 실제로 바뀐 경우에만 알린다(불필요한 재렌더 방지).
        const json = JSON.stringify(list);
        if (json === lastJson) return;
        lastJson = json;

        // 문서 전체를 싣는다 — onLeaveMembers 말고 다른 필드가 생겨도 잃지 않도록.
        State.setPersistentLeaveSchedule({ ...data, onLeaveMembers: list });
        notifyLeaveScheduleChanged('firestore');
    }, (err) => {
        console.warn('[leave-sync] 근태 일정 구독 실패:', err);
    });
}

export function unsubscribeLeaveSchedule() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; lastJson = null; }
}
