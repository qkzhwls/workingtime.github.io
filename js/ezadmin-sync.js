// === js/ezadmin-sync.js ===
// 이지어드민 연동 숫자(송장·배송)를 Firestore 에서 구독한다.
//
// 왜 Firestore 인가
//   예전에는 Chrome 확장이 이지어드민 탭을 열어 두고('좀비창 모드') 60초마다 새로고침해
//   postMessage 로 숫자를 넘겼다. 창을 계속 띄워야 했고, **그 PC 의 Chrome 에서만** 보였다.
//   지금은 상주 수집기(앱\이지어드민연동)가 창 없이 읽어 Firestore 에 쓰고, 앱을 켠
//   모든 사람과 휴대폰이 같은 숫자를 본다.
//
// ★ 이 모듈이 '언제 기준 숫자인가' 까지 책임진다.
//   예전 방식은 확장이 죽어도 화면에 옛 숫자가 그대로 남아 아무도 몰랐다.
//   lastOkAt(숫자를 실제로 읽은 시각)을 보고 오래된 값은 흐리게 만든다.
//   ⚠️ onSnapshot 만으로는 흐려지지 않는다 — 문서가 안 바뀌면 콜백이 안 오기 때문이다.
//      그래서 타이머로 주기적으로 '다시 판정' 한다.

import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as State from './state.js?v=202610021228';

const 문서경로 = ['artifacts', 'team-work-logger-v2', 'integrations', 'ezadmin'];

export const 신선_분 = 3;      // 이 안이면 라벨 없이 숫자만 (평소 화면을 깔끔하게)
export const STALE_분 = 10;    // 이 이상이면 흐리게 + 빨강

let unsub = null;
let 재판정타이머 = null;
let 최근 = null;               // { invoice, delivery, lastOkAt(ms), ok, error }
const 구독자 = new Set();

/** Firestore Timestamp | ISO 문자열 | Date → ms (못 읽으면 null) */
const 밀리초 = (v) => {
    if (!v) return null;
    try {
        if (typeof v.toMillis === 'function') return v.toMillis();
        if (typeof v.seconds === 'number') return v.seconds * 1000;
        const t = new Date(v).getTime();
        return Number.isFinite(t) ? t : null;
    } catch (e) { return null; }
};

/** 지금 보여 줄 상태. 화면 코드는 이 결과만 보면 된다. */
export const 상태 = () => {
    if (!최근) return { 있음: false };
    // ★ 숫자나 lastOkAt 이 없으면 '값이 없다' 로 본다.
    //   수집기는 실패한 회차에 숫자·lastOkAt 을 **쓰지 않는다**(0 은 실제 값이라
    //   실패와 섞으면 구분이 불가능하기 때문). 그래서 첫 쓰기가 실패였던 날에는
    //   그 필드가 아예 없다. 여기서 0 으로 떨어뜨리면 '송장 0 · 배송 0' 을 방금 읽은
    //   값처럼 보여 주게 되고, 그 설계 전제를 화면에서 되돌리는 셈이 된다.
    const n1 = Number(최근.invoice);
    const n2 = Number(최근.delivery);
    if (!Number.isFinite(n1) || !Number.isFinite(n2) || 최근.lastOkAt == null) {
        return { 있음: false, ok: 최근.ok !== false, error: 최근.error || '' };
    }
    const at = 최근.lastOkAt;
    // 쓰는 PC 와 보는 PC 의 시계가 다를 수 있다 — 음수는 0 으로 본다.
    const 경과분 = at == null ? null : Math.max(0, (Date.now() - at) / 60000);
    const 오래됨 = 경과분 != null && 경과분 >= STALE_분;
    return {
        있음: true,
        invoice: n1,
        delivery: n2,
        경과분,
        오래됨,
        라벨: (경과분 == null || 경과분 < 신선_분) ? ''
            : `${Math.floor(경과분)}분 전 기준`,
        ok: 최근.ok !== false,
        error: 최근.error || '',
    };
};

const 알리기 = () => { 구독자.forEach(fn => { try { fn(상태()); } catch (e) {} }); };

/** 화면 쪽에서 등록한다. 등록 즉시 현재 상태로 한 번 불러 준다. */
export const onEzadminChange = (fn) => {
    구독자.add(fn);
    try { fn(상태()); } catch (e) {}
    return () => 구독자.delete(fn);
};

export const subscribeEzadmin = () => {
    if (unsub || !State.db) return;
    try {
        unsub = onSnapshot(doc(State.db, ...문서경로), (snap) => {
            if (!snap.exists()) { 최근 = null; 알리기(); return; }
            const d = snap.data() || {};
            최근 = {
                invoice: d.invoice,
                delivery: d.delivery,
                lastOkAt: 밀리초(d.lastOkAt),
                ok: d.ok,
                error: d.error,
            };
            알리기();
        }, (e) => { console.warn('[ezadmin] 구독 실패:', e); });
    } catch (e) {
        console.warn('[ezadmin] 구독을 시작하지 못했습니다:', e);
        return;
    }
    // 문서가 안 바뀌어도 '몇 분 전' 은 흘러간다 → 주기적으로 다시 판정한다.
    if (!재판정타이머) 재판정타이머 = setInterval(알리기, 30000);
    // 탭이 백그라운드면 타이머가 늦춰진다. 돌아올 때 즉시 맞춘다.
    document.addEventListener('visibilitychange', 알리기);
};

export const unsubscribeEzadmin = () => {
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    if (재판정타이머) { clearInterval(재판정타이머); 재판정타이머 = null; }
    document.removeEventListener('visibilitychange', 알리기);
    최근 = null;
};
