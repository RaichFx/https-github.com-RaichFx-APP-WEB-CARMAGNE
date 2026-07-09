
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// *** CREDENCIALES DE FIREBASE ***
const firebaseConfig = {
  apiKey: "AIzaSyCelLg2pqp1-lYi_IUgsv4FAoH4mN0WsAc",
  authDomain: "carmagne-instal-2024.firebaseapp.com",
  projectId: "carmagne-instal-2024",
  storageBucket: "carmagne-instal-2024.firebasestorage.app",
  messagingSenderId: "318117443518",
  appId: "1:318117443518:web:d9f257212f153373046bef",
  measurementId: "G-LGCXHWMQQC"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
