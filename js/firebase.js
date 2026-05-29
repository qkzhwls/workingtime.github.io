// === js/firebase.js ===

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// 1. Firebase 설정 (config.js에서 이동)
export const firebaseConfig = {
    apiKey: "AIzaSyAguJOtoqoSipA-wXH3jSYX2yH1RX7tQQw",
    authDomain: "location-e2ff9.firebaseapp.com",
    projectId: "location-e2ff9",
    storageBucket: "location-e2ff9.firebasestorage.app",
    messagingSenderId: "559399838918",
    appId: "1:559399838918:web:91c3bbf98adb92d2a863c7",
    measurementId: "G-RTBSE9SN1Q"
  };

// 2. 앱 ID
export const APP_ID = 'team-work-logger-v2';

// 3. Firebase 인스턴스 (초기화 후 채워짐)
let db, auth;

// 4. Firebase 초기화 함수 (config.js에서 이동)
export const initializeFirebase = () => {
    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        console.log("Firebase initialized successfully.");
        return { app, db, auth };
    } catch (error) {
        console.error("Firebase 초기화 실패:", error);
        alert("Firebase 초기화에 실패했습니다. API 키를 확인하세요.");
        return {};
    }
};

// 5. 초기화된 인스턴스 내보내기
// (initializeFirebase가 호출된 후에 이 변수들이 채워집니다)

export { db, auth };
