import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  OAuthProvider,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  updateEmail,
  updatePassword,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  EmailAuthProvider,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  User,
  onAuthStateChanged,
} from "firebase/auth";
import { auth, FIREBASE_SETUP_ERROR } from "./config";

const googleProvider = new GoogleAuthProvider();
const appleProvider = new OAuthProvider("apple.com");

const getRequiredAuth = () => {
  if (!auth) {
    throw new Error(FIREBASE_SETUP_ERROR);
  }
  return auth;
};

export const signInWithGoogle = async () => {
  try {
    const authInstance = getRequiredAuth();
    const result = await signInWithPopup(authInstance, googleProvider);
    return result;
  } catch (error) {
    throw error;
  }
};

export const signInWithApple = async () => {
  try {
    const authInstance = getRequiredAuth();
    const result = await signInWithPopup(authInstance, appleProvider);
    return result;
  } catch (error) {
    throw error;
  }
};

export const signInWithEmail = async (email: string, password: string) => {
  try {
    const authInstance = getRequiredAuth();
    const result = await signInWithEmailAndPassword(authInstance, email, password);
    return result.user;
  } catch (error) {
    throw error;
  }
};

export const signUpWithEmail = async (email: string, password: string) => {
  try {
    const authInstance = getRequiredAuth();
    const result = await createUserWithEmailAndPassword(authInstance, email, password);
    return result.user;
  } catch (error) {
    throw error;
  }
};

export const signOut = async () => {
  try {
    const authInstance = getRequiredAuth();
    await firebaseSignOut(authInstance);
  } catch (error) {
    throw error;
  }
};

export const getCurrentUser = (): User | null => {
  if (!auth) {
    return null;
  }
  return auth.currentUser;
};

export const onAuthChange = (callback: (user: User | null) => void) => {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
};

export const updateUserEmail = async (newEmail: string) => {
  try {
    const authInstance = getRequiredAuth();
    const user = authInstance.currentUser;
    if (!user) {
      throw new Error("Nie ste prihlásený.");
    }
    await updateEmail(user, newEmail);
  } catch (error) {
    throw error;
  }
};

export const updateUserPassword = async (currentPassword: string, newPassword: string) => {
  try {
    const authInstance = getRequiredAuth();
    const user = authInstance.currentUser;
    if (!user || !user.email) {
      throw new Error("Nie ste prihlásený.");
    }

    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);

    await updatePassword(user, newPassword);
  } catch (error: any) {
    if (error.code === "auth/wrong-password") {
      throw new Error("Nesprávne súčasné heslo");
    } else if (error.code === "auth/weak-password") {
      throw new Error("Nové heslo je príliš slabé");
    } else {
      throw error;
    }
  }
};

export const addUserPassword = async (newPassword: string) => {
  try {
    const authInstance = getRequiredAuth();
    const user = authInstance.currentUser;
    if (!user) {
      throw new Error("Nie ste prihlásený.");
    }

    const providerId = user.providerData[0]?.providerId;
    if (providerId === "google.com") {
      await reauthenticateWithPopup(user, googleProvider);
    } else if (providerId === "apple.com") {
      await reauthenticateWithPopup(user, appleProvider);
    } else {
      throw new Error("Tento spôsob prihlásenia nie je podporovaný.");
    }

    await updatePassword(user, newPassword);
  } catch (error: any) {
    if (error.code === "auth/weak-password") {
      throw new Error("Heslo je príliš slabé");
    } else if (error.code === "auth/popup-closed-by-user") {
      throw new Error("Okno bolo zatvorené. Skúste to znova.");
    } else {
      throw error;
    }
  }
};

export const resetPassword = async (email: string) => {
  try {
    const authInstance = getRequiredAuth();
    let signInMethods: string[] = [];

    try {
      signInMethods = await fetchSignInMethodsForEmail(authInstance, email);
    } catch (fetchError: any) {
      if (fetchError.code === "auth/user-not-found") {
        throw new Error("S týmto e-mailom nie je zaregistrovaný žiadny účet.");
      }
    }

    if (signInMethods.length === 0) {
      await sendPasswordResetEmail(authInstance, email);
      return;
    }

    const hasPassword = signInMethods.includes("password");

    if (!hasPassword) {
      throw new Error("Tento účet nemá nastavené heslo. Prihláste sa cez Google alebo Apple.");
    }

    await sendPasswordResetEmail(authInstance, email);
  } catch (error: any) {
    if (
      error.message === "S týmto e-mailom nie je zaregistrovaný žiadny účet." ||
      error.message === "Tento účet nemá nastavené heslo. Prihláste sa cez Google alebo Apple."
    ) {
      throw error;
    }
    if (error.code === "auth/user-not-found") {
      throw new Error("S týmto e-mailom nie je zaregistrovaný žiadny účet.");
    } else if (error.code === "auth/invalid-email") {
      throw new Error("Neplatný e-mail");
    } else {
      throw error;
    }
  }
};
