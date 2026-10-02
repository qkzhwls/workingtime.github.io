// === js/china-stock-config.js === (china-stock 전용 Firebase 초기화)
//
// 🔀 2026-09-04: 프로젝트를 메인 앱과 같은 work-tool-e2943 으로 통합했다.
//    이유 — 검수리스트의 '샘플위치'는 로케이션 관리의 Locations 컬렉션에서 읽어오는데,
//    예전 설정(location-e2ff9)은 프로젝트가 달라 그 컬렉션이 아예 보이지 않았다.
//    같은 프로젝트로 옮기면서 loadSampleLocMap() 이 Locations 를 그대로 읽게 된다.
//
//    · 보조 프로젝트(location-data-c374f / db2)는 코드에서 쓰이지 않아 제거했다.
//    · 이 프로젝트는 로그인이 필요하다(firestore.rules 참고).
//      웹(china-stock-goods.html)은 화면 게이트가 로그인 여부를 확인하고,
//      폰 스캐너(scan.html)도 같은 방식으로 확인한다. 메인 앱에서 한 번 로그인해 두면 된다.
//    · 설정값은 js/config.js 와 같은 프로젝트지만, 이 화면들은 관리자 config 로직을
//      쓰지 않으므로 파일은 그대로 분리해 둔다(서로 영향 없이 고칠 수 있게).
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ==========================================
// 메인 앱과 동일한 프로젝트 (로케이션·업무관리 데이터가 있는 곳)
// ==========================================
export const firebaseConfig = {
    apiKey: "AIzaSyBxmX7fEISWYs_JGktAZrFjdb8cb_ZcmSY",
    authDomain: "work-tool-e2943.firebaseapp.com",
    projectId: "work-tool-e2943",
    storageBucket: "work-tool-e2943.firebasestorage.app", 
    messagingSenderId: "133294945093",
    appId: "1:133294945093:web:cde90aab6716127512842c",
    measurementId: "G-ZZQLKB0057"
};

// 옮기기 전 프로젝트 — 손입력 데이터 이관(china-stock-migrate.html)에서만 쓴다.
export const legacyFirebaseConfig = {
    apiKey: "AIzaSyAguJOtoqoSipA-wXH3jSYX2yH1RX7tQQw",
    authDomain: "location-e2ff9.firebaseapp.com",
    projectId: "location-e2ff9",
    storageBucket: "location-e2ff9.firebasestorage.app",
    messagingSenderId: "559399838918",
    appId: "1:559399838918:web:91c3bbf98adb92d2a863c7"
};

const APP_ID = 'team-work-logger-v2';
let app, db, auth;

export const initializeFirebase = () => {
    // 여러 번 불러도 앱을 다시 만들지 않는다(게이트와 본 화면이 각각 호출한다)
    if (app && db) return { app, db, auth };
    try {
        app = getApps().length ? getApp() : initializeApp(firebaseConfig);
        // 오프라인 캐시(IndexedDB) 사용 → 새로고침 시 서버 전체 재읽기 최소화(읽기 요금 절감)
        try {
            db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
        } catch (e) {
            console.warn('Firestore 로컬 캐시 미적용(폴백):', e);
            db = getFirestore(app);
        }
        auth = getAuth(app);
        console.log('Firebase initialized (china-stock → work-tool-e2943).');
        return { app, db, auth };
    } catch (error) {
        console.error("Firebase 초기화 실패:", error);
        alert("Firebase 초기화에 실패했습니다. API 키를 확인하세요.");
        return {};
    }
};
