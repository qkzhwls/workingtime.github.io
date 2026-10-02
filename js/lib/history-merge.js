// js/lib/history-merge.js
//
// 하루치 이력을 저장할 때 **서버에 있는 것과 내 화면에 있는 것 중 무엇이 이기는가**.
//
// 왜 따로 떼어냈나
//   이 판단은 `saveProgress` 안에 인라인으로 있었고, 같은 종류의 사고가 반복해서 났다.
//   2026-10-01: 마감이 끝난 뒤(이력 53건) 아침부터 켜 둔 탭의 안전망이 저장을 돌려
//   기록 7건이 사라지고 근무시간이 27시간 부풀었다. 마감 뒤 재출근이 되살아난 사고도 있었다.
//   원인은 Firestore 의 성질 두 개다 —
//     · `merge:true` 는 **배열을 합치지 않는다.** 통째로 바꾼다.
//     · 중첩 map 은 깊게 합치므로, 빼지 않은 키는 살아남는다.
//   그래서 "무엇을 payload 에 넣고 무엇을 **키째로 빼는가**" 가 데이터의 생사를 가른다.
//
//   이 함수는 쓰지 않고 **정하기만** 한다. Firestore 도 State 도 모른다 — 그래서 테스트된다.
//
// 불변식 (tests/history-merge.test.js 가 지킨다)
//   ① 마감된 날은 기록을 교체하지 않는다. **완료된** 새 기록만 덧붙인다.
//   ② 마감된 날의 근태는 서버가 이긴다.
//   ③ 살아있는 기록이 0건이고 이력에 있으면 `workRecords` 키를 **뺀다**(빈 배열이 아니다).
//   ④ `isQuantityVerified` 는 인자·라이브·서버의 OR 이다. 절대 후퇴하지 않는다.
//   ⑤ `memRecords` 는 **서버에 실제로 남는 배열과 같아야 한다.** 어긋나면 다른 함수들이
//      메모리 배열을 통째로 서버에 써서 방금 지킨 기록을 날린다.

const 빈객체 = (v) => !v || Object.keys(v).length === 0;
const 빈배열 = (v) => !Array.isArray(v) || v.length === 0;

/**
 * @param {object}  a
 * @param {string}  a.dateStr        'YYYY-MM-DD'
 * @param {Array}   a.liveRecords    저장하려는 기록들(종료시각 정리까지 끝난 것)
 * @param {object}  a.serverHistory  서버 이력 문서 내용. 없으면 `{}`
 * @param {object}  a.live           화면의 오늘 값들
 * @param {boolean} [a.isQuantityVerifiedArg]  '물량 검증' 을 이 저장에서 찍었는가
 * @param {string}  a.now            저장 시각. 순수함수를 위해 **인자로 받는다**
 * @returns {{patch:object, memRecords:Array, notes:object}}
 *   patch     — 그대로 `setDoc(ref, patch, {merge:true})` 에 넣을 값
 *   memRecords— 저장 뒤 메모리 이력에 넣어야 하는 기록 배열(= 서버에 남는 배열)
 *   notes     — 호출처가 로그·분기에 쓰는 사실들
 */
export function decideHistoryMerge({ dateStr, liveRecords, serverHistory, live,
                                    isQuantityVerifiedArg = false, now }) {
    const 기록 = Array.isArray(liveRecords) ? liveRecords : [];
    const 서버 = serverHistory || {};
    const 화면 = live || {};
    const 서버기록 = Array.isArray(서버.workRecords) ? 서버.workRecords : [];
    const existingBefore = 서버기록.length;

    const isClosedDay = !!서버.closedAt;

    // ③ 살아있는 기록이 0건인데 이력엔 있으면 '업무기록만' 손대지 않는다.
    //    저장 자체를 멈추면 같은 payload 의 물량·검수·검증여부까지 날아가므로,
    //    '중단' 이 아니라 '키 빼기' 로 처리한다 — merge 라서 서버 배열이 보존된다.
    const keepServerRecords = existingBefore > 0 && 기록.length === 0;

    // ① 마감된 날은 교체하지 않고 덧붙인다.
    let appendOnlyRecords = null;
    let appendedCount = 0, skippedNoIdCount = 0;
    if (isClosedDay && !keepServerRecords) {
        const 서버id = new Set(서버기록.map(r => r && r.id).filter(Boolean));
        // 진행 중 기록은 덧붙이지 않는다. endTime 이 '저장한 시각' 으로 박히고,
        // 그 뒤에는 '이미 있는 id' 라 영원히 갱신되지 않아 거짓 시간이 굳는다.
        const 덧붙일만한 = 기록.filter(r => r && r.status === 'completed');
        skippedNoIdCount = 덧붙일만한.filter(r => !r.id).length;
        const 새것 = 덧붙일만한.filter(r => r.id && !서버id.has(r.id));
        appendedCount = 새것.length;
        appendOnlyRecords = 새것.length > 0 ? [...서버기록, ...새것] : null;
    }

    const omitRecordsKey = keepServerRecords || (isClosedDay && appendOnlyRecords === null);

    // 🛡️ 마감된 날에는 이력에 있는 값을 **후퇴시키지 않는다.**
    //    마감이 daily_data 의 물량·검증여부를 초기화하기 때문에, 마감 뒤에 열린 세션이
    //    저장을 돌리면 빈 값이 이력을 덮어 그날 물량이 통째로 사라진다.
    const 지키기 = (화면값, 서버값, 비었나) => (!isClosedDay || !비었나(화면값))
        ? 화면값
        : (서버값 !== undefined && 서버값 !== null ? 서버값 : 화면값);

    // ② 마감된 날의 근태는 서버가 이긴다 — 마감이 확정한 퇴근시각을, 그 전 상태를 들고 있던
    //    세션이 지우거나 되살리지 못하게 한다(마감 후 재출근이 되살아난 사고와 같은 종류).
    //    키를 통째로 빼지는 않는다. 그러면 틀린 퇴근시각을 고칠 경로가 사라진다.
    const 화면근태 = 화면.dailyAttendance || {};
    // 마감 안 된 날도 **사본**을 만든다. 같은 참조를 넘기면 memPatch 를 거쳐
    // State.allHistoryData 의 그날 근태가 라이브 객체를 가리키고, 이후 라이브 변경이
    // 메모리 이력에 몰래 반영된다(저장하지 않은 값이 저장된 것처럼 보인다).
    const dailyAttendance = isClosedDay
        ? { ...화면근태, ...(서버.dailyAttendance || {}) }
        : { ...화면근태 };

    const patch = {
        id: dateStr,
        ...(omitRecordsKey ? {} : { workRecords: appendOnlyRecords || 기록 }),
        taskQuantities: 지키기(화면.taskQuantities || {}, 서버.taskQuantities, 빈객체),
        confirmedZeroTasks: 지키기(화면.confirmedZeroTasks || [], 서버.confirmedZeroTasks, 빈배열),
        onLeaveMembers: 지키기(화면.onLeaveMembers || [], 서버.onLeaveMembers, 빈배열),
        partTimers: 지키기(화면.partTimers || [], 서버.partTimers, 빈배열),
        dailyAttendance,
        // 라이브 management 가 일부 필드만 들고 있을 수 있으므로 서버 값 위에 얹는다.
        // (메모리 캐시를 베이스로 쓰면 내 탭이 켜진 뒤 남이 고친 매출·재고가 옛 값으로 되돌아간다)
        management: { ...(서버.management || {}), ...(화면.management || {}) },
        inspectionList: 지키기(화면.inspectionList || [], 서버.inspectionList, 빈배열),
        // ④ 서버값을 항상 OR 에 넣는다 — 검증을 찍은 뒤 다른 탭이 저장하면 false 로 후퇴했다.
        isQuantityVerified: !!(isQuantityVerifiedArg || 화면.isQuantityVerified
            || 서버.isQuantityVerified),
        savedAt: now
    };

    // ⑤ 서버에 실제로 남는 배열. patch 에서 키를 뺐으면 서버의 기존 배열이 그대로 남는다.
    const memRecords = omitRecordsKey ? 서버기록 : (appendOnlyRecords || 기록);

    // 저장할 것이 아무것도 없는 상태. 실패가 아니지만 저장도 아니다 —
    // 마감 안전망은 재시도해야 하고, 화면은 오류로 안내하면 안 되어 따로 구분한다.
    const nothingToSave = 기록.length === 0
        && 빈객체(화면.taskQuantities)
        && 빈배열(화면.inspectionList);

    return {
        patch, memRecords,
        notes: { isClosedDay, keepServerRecords, omitRecordsKey, existingBefore,
                 appendedCount, skippedNoIdCount, nothingToSave,
                 closedAt: 서버.closedAt || null }
    };
}
