import { getFirestore } from "firebase/firestore";

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA0YqY9I6qqe7a5boEkT8UqfLenU4P0lNg",
  authDomain: "app-eventdream-a896f.firebaseapp.com",
  projectId: "app-eventdream-a896f",
  storageBucket: "app-eventdream-a896f.firebasestorage.app",
  messagingSenderId: "670328214153",
  appId: "1:670328214153:web:bc03cf4afadb5d85f0ec58"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);