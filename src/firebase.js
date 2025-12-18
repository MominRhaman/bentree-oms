import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyDZjv7Od9p3jpHBzVt4bI3ymm6ebTMXtuk",
    authDomain: "bentree-oms.firebaseapp.com",
    projectId: "bentree-oms",
    storageBucket: "bentree-oms.firebasestorage.app",
    messagingSenderId: "863146464502",
    appId: "1:863146464502:web:ce12de37fc9ba2240148d7",
};

export const appId = "1:863146464502:web:ce12de37fc9ba2240148d7";

// Initialize Firebase
let app, auth, db;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} catch (e) {
    console.error("Firebase Initialization Error:", e);
}

export { auth, db };