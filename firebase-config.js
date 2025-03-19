import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { 
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updateProfile,
    signOut 
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { 
    getFirestore,
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    runTransaction,
    query,
    where,
    writeBatch
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAwI7NNIYE5yVsn7-eNOwKOB73BirkBVew",
    authDomain: "subscriptions-directory.firebaseapp.com",
    projectId: "subscriptions-directory",
    storageBucket: "subscriptions-directory.firebasestorage.app",
    messagingSenderId: "290067608247",
    appId: "1:290067608247:web:3e75f1d88271784468d332"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const auditCollection = collection(db, 'auditLogs');

export { 
    auth,
    db,
    auditCollection,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updateProfile,
    signOut,
    doc,
    setDoc,
    getDoc,
    getDocs,
    runTransaction,
    query,
    where,
    writeBatch
};