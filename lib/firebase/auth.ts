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
      throw new Error("User is not signed in");
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
      throw new Error("User is not signed in");
    }

    // Re-authenticate user with current password
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);

    // Update password
    await updatePassword(user, newPassword);
  } catch (error: any) {
    if (error.code === "auth/wrong-password") {
      throw new Error("Incorrect current password");
    } else if (error.code === "auth/weak-password") {
      throw new Error("New password is too weak");
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
      throw new Error("User is not signed in");
    }

    // Re-authenticate user with their provider (Google/Apple) before adding password
    const providerId = user.providerData[0]?.providerId;
    if (providerId === "google.com") {
      await reauthenticateWithPopup(user, googleProvider);
    } else if (providerId === "apple.com") {
      await reauthenticateWithPopup(user, appleProvider);
    } else {
      throw new Error("Unsupported sign-in method");
    }

    // Add password after re-authentication
    await updatePassword(user, newPassword);
  } catch (error: any) {
    if (error.code === "auth/weak-password") {
      throw new Error("Password is too weak");
    } else if (error.code === "auth/popup-closed-by-user") {
      throw new Error("Popup was closed. Please try again.");
    } else {
      throw error;
    }
  }
};

export const resetPassword = async (email: string) => {
  try {
    const authInstance = getRequiredAuth();
    // Skúsiť zistiť, aké metódy prihlásenia má účet
    let signInMethods: string[] = [];
    
    try {
      signInMethods = await fetchSignInMethodsForEmail(authInstance, email);
    } catch (fetchError: any) {
      // Ak fetchSignInMethodsForEmail zlyhá s user-not-found, účet neexistuje
      if (fetchError.code === "auth/user-not-found") {
        throw new Error("No account exists with this email");
      }
      // Pre ostatné chyby pokračujeme - možno účet existuje, ale metóda zlyhala
      // V tomto prípade skúsiť odoslať e-mail
    }
    
    // Ak vráti prázdne pole, skúsiť odoslať e-mail
    // (môže to byť false positive - účet môže existovať)
    if (signInMethods.length === 0) {
      // Skúsiť odoslať e-mail - Firebase z bezpečnostných dôvodov vždy vráti úspech
      // Takže nemôžeme spoľahlivo zistiť, či účet existuje
      await sendPasswordResetEmail(authInstance, email);
      return;
    }
    
    // Skontrolovať, či používateľ má nastavené heslo (password provider)
    // Ak má len social login (Google/Apple), nemôže resetovať heslo
    const hasPassword = signInMethods.includes("password");
    
    if (!hasPassword) {
      throw new Error("This account has no password set. Sign in with social login.");
    }
    
    // Ak účet existuje a má heslo, odoslať e-mail
    await sendPasswordResetEmail(authInstance, email);
  } catch (error: any) {
    // Ak je to naša vlastná chyba, vyhodíme ju
    if (error.message === "No account exists with this email" || 
        error.message === "This account has no password set. Sign in with social login.") {
      throw error;
    }
    // Firebase môže vrátiť user-not-found
    if (error.code === "auth/user-not-found") {
      throw new Error("No account exists with this email");
    } else if (error.code === "auth/invalid-email") {
      throw new Error("Invalid email");
    } else {
      // Pre ostatné chyby vyhodíme pôvodnú chybu
      throw error;
    }
  }
};
