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
import { auth } from "./config";

const googleProvider = new GoogleAuthProvider();
const appleProvider = new OAuthProvider("apple.com");

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result;
  } catch (error) {
    throw error;
  }
};

export const signInWithApple = async () => {
  try {
    const result = await signInWithPopup(auth, appleProvider);
    return result;
  } catch (error) {
    throw error;
  }
};

export const signInWithEmail = async (email: string, password: string) => {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error) {
    throw error;
  }
};

export const signUpWithEmail = async (email: string, password: string) => {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error) {
    throw error;
  }
};

export const signOut = async () => {
  try {
    await firebaseSignOut(auth);
  } catch (error) {
    throw error;
  }
};

export const getCurrentUser = (): User | null => {
  return auth.currentUser;
};

export const onAuthChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};

export const updateUserEmail = async (newEmail: string) => {
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error("Používateľ nie je prihlásený");
    }
    await updateEmail(user, newEmail);
  } catch (error) {
    throw error;
  }
};

export const updateUserPassword = async (currentPassword: string, newPassword: string) => {
  try {
    const user = auth.currentUser;
    if (!user || !user.email) {
      throw new Error("Používateľ nie je prihlásený");
    }

    // Re-authenticate user with current password
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);

    // Update password
    await updatePassword(user, newPassword);
  } catch (error: any) {
    if (error.code === "auth/wrong-password") {
      throw new Error("Nesprávne aktuálne heslo");
    } else if (error.code === "auth/weak-password") {
      throw new Error("Nové heslo je príliš slabé");
    } else {
      throw error;
    }
  }
};

export const addUserPassword = async (newPassword: string) => {
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error("Používateľ nie je prihlásený");
    }

    // Re-authenticate user with their provider (Google/Apple) before adding password
    const providerId = user.providerData[0]?.providerId;
    if (providerId === "google.com") {
      await reauthenticateWithPopup(user, googleProvider);
    } else if (providerId === "apple.com") {
      await reauthenticateWithPopup(user, appleProvider);
    } else {
      throw new Error("Nepodporovaný spôsob prihlásenia");
    }

    // Add password after re-authentication
    await updatePassword(user, newPassword);
  } catch (error: any) {
    if (error.code === "auth/weak-password") {
      throw new Error("Heslo je príliš slabé");
    } else if (error.code === "auth/popup-closed-by-user") {
      throw new Error("Okno bolo zatvorené. Skúste znova.");
    } else {
      throw error;
    }
  }
};

export const resetPassword = async (email: string) => {
  try {
    // Skúsiť zistiť, aké metódy prihlásenia má účet
    let signInMethods: string[] = [];
    
    try {
      signInMethods = await fetchSignInMethodsForEmail(auth, email);
    } catch (fetchError: any) {
      // Ak fetchSignInMethodsForEmail zlyhá s user-not-found, účet neexistuje
      if (fetchError.code === "auth/user-not-found") {
        throw new Error("Účet s týmto e-mailom neexistuje");
      }
      // Pre ostatné chyby pokračujeme - možno účet existuje, ale metóda zlyhala
      // V tomto prípade skúsiť odoslať e-mail
    }
    
    // Ak vráti prázdne pole, skúsiť odoslať e-mail
    // (môže to byť false positive - účet môže existovať)
    if (signInMethods.length === 0) {
      // Skúsiť odoslať e-mail - Firebase z bezpečnostných dôvodov vždy vráti úspech
      // Takže nemôžeme spoľahlivo zistiť, či účet existuje
      await sendPasswordResetEmail(auth, email);
      return;
    }
    
    // Skontrolovať, či používateľ má nastavené heslo (password provider)
    // Ak má len social login (Google/Apple), nemôže resetovať heslo
    const hasPassword = signInMethods.includes("password");
    
    if (!hasPassword) {
      throw new Error("Tento účet nemá nastavené heslo. Prihláste sa pomocou sociálnej siete.");
    }
    
    // Ak účet existuje a má heslo, odoslať e-mail
    await sendPasswordResetEmail(auth, email);
  } catch (error: any) {
    // Ak je to naša vlastná chyba, vyhodíme ju
    if (error.message === "Účet s týmto e-mailom neexistuje" || 
        error.message === "Tento účet nemá nastavené heslo. Prihláste sa pomocou sociálnej siete.") {
      throw error;
    }
    // Firebase môže vrátiť user-not-found
    if (error.code === "auth/user-not-found") {
      throw new Error("Účet s týmto e-mailom neexistuje");
    } else if (error.code === "auth/invalid-email") {
      throw new Error("Neplatný e-mail");
    } else {
      // Pre ostatné chyby vyhodíme pôvodnú chybu
      throw error;
    }
  }
};
