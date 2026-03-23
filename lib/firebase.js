import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, onSnapshot, orderBy, query, doc, getDoc, enableNetwork } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

/**
 * 실시간으로 요약 목록 구독
 */
export function subscribeSummaries(callback) {
  const q = query(collection(db, 'summaries'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const summaries = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || new Date(),
    }));
    callback(summaries);
  });
}

/**
 * 특정 요약 실시간 구독
 */
export function subscribeSummary(id, callback) {
  return onSnapshot(doc(db, 'summaries', id), (snapshot) => {
    if (snapshot.exists()) {
      callback({
        id: snapshot.id,
        ...snapshot.data(),
        createdAt: snapshot.data().createdAt?.toDate?.() || new Date(),
      });
    }
  });
}

/**
 * 특정 요약 단건 조회
 */
export async function getSummary(id) {
  const docRef = doc(db, 'summaries', id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return {
    id: snapshot.id,
    ...snapshot.data(),
    createdAt: snapshot.data().createdAt?.toDate?.() || new Date(),
  };
}

/**
 * Firebase에서 서버 URL 가져오기 (Cloudflare Tunnel 동적 URL)
 */
let cachedServerUrl = null;

export async function getServerUrl() {
  if (cachedServerUrl) return cachedServerUrl;
  try {
    const snapshot = await getDoc(doc(db, 'config', 'server'));
    if (snapshot.exists()) {
      cachedServerUrl = snapshot.data().url;
      return cachedServerUrl;
    }
  } catch (e) {
    console.error('서버 URL 조회 실패:', e.message);
  }
  return null;
}

/**
 * 서버 URL 실시간 구독
 */
export function subscribeServerUrl(callback) {
  return onSnapshot(doc(db, 'config', 'server'), (snapshot) => {
    if (snapshot.exists()) {
      const url = snapshot.data().url;
      cachedServerUrl = url;
      callback(url);
    }
  });
}

export { db };
