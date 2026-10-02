// === js/firebase-emulator.js ===
// 🧪 로컬 Firebase 에뮬레이터 연결 (개발·검증 전용)
//
// 왜 필요한가: 이 앱은 로그인 게이트라, 코드를 고쳐도 실제로 눌러 보려면
// 운영 데이터에 로그인해야 했다. 그래서 대부분의 변경이 '정적 검증만' 된 채 배포됐다.
// 에뮬레이터를 붙이면 운영 데이터를 전혀 건드리지 않고 화면을 끝까지 확인할 수 있다.
//
// 안전장치 — 아래 세 조건이 모두 맞아야만 연결된다.
//   1) 주소가 localhost / 127.0.0.1 일 것        (GitHub Pages 에서는 절대 동작하지 않음)
//   2) 주소에 ?emu=1 을 붙여 켤 것                (그냥 로컬 서버로 여는 평소 사용에는 영향 없음)
//   3) 한 번 켜면 그 탭에서만 유지               (sessionStorage — 창을 닫으면 사라진다)
//
// 끄기: 주소에 ?emu=0 을 붙여 한 번 열면 된다.

import { connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const FLAG = 'useFirebaseEmulator';
const HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;
const AUTH_PORT = 9099;

const isLocal = () => LOCAL_HOSTS.has(location.hostname);

/** 이 탭에서 에뮬레이터를 쓸 것인지. ?emu=1 로 켜고 ?emu=0 으로 끈다. */
export const emulatorEnabled = () => {
    if (!isLocal()) return false;                 // 운영에서는 어떤 경우에도 false
    try {
        const q = new URLSearchParams(location.search).get('emu');
        if (q === '1') sessionStorage.setItem(FLAG, '1');
        if (q === '0') sessionStorage.removeItem(FLAG);
        return sessionStorage.getItem(FLAG) === '1';
    } catch (e) {
        return false;                             // sessionStorage 가 막힌 환경이면 그냥 끈다
    }
};

let connected = false;

/** Firestore·Auth 를 에뮬레이터로 돌린다. 첫 읽기·쓰기보다 먼저 불러야 한다. */
export const connectEmulatorsIfEnabled = (db, auth) => {
    if (connected || !emulatorEnabled()) return false;
    try {
        if (db)   connectFirestoreEmulator(db, HOST, FIRESTORE_PORT);
        if (auth) connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, { disableWarnings: true });
        connected = true;
        console.log(`%c🧪 에뮬레이터에 연결됨 — Firestore ${HOST}:${FIRESTORE_PORT} · Auth ${HOST}:${AUTH_PORT}`,
                    'color:#8A6011;font-weight:bold');
        showBanner();
        return true;
    } catch (e) {
        console.error('[emulator] 연결 실패 — 운영 데이터로 붙습니다. 즉시 창을 닫으세요:', e);
        return false;
    }
};

/** 운영 화면과 헷갈리지 않도록 위쪽에 띠를 하나 붙인다. */
function showBanner() {
    const paint = () => {
        if (document.getElementById('emulator-banner')) return;
        const el = document.createElement('div');
        el.id = 'emulator-banner';
        el.textContent = '🧪 로컬 에뮬레이터 — 여기 데이터는 실제가 아닙니다 (?emu=0 으로 해제)';
        el.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
            'background:#8A6011', 'color:#fff', 'font:600 12px/1.9 system-ui,sans-serif',
            'text-align:center', 'letter-spacing:.02em', 'pointer-events:none'
        ].join(';');
        document.body.appendChild(el);
        document.body.style.paddingTop = '23px';
    };
    if (document.body) paint();
    else document.addEventListener('DOMContentLoaded', paint, { once: true });
}
