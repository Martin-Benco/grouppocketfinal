"use client";

import { useRef, useState, useEffect } from "react";
import { useNavigation } from "@/components/navigation/TopNav";
import { TopNav } from "@/components/navigation/TopNav";
import { useSwipeNavigation } from "@/hooks/useSwipe";
import { User as UserIcon, Phone, Mail, CreditCard, MapPin, ChevronRight, ChevronDown, Image as ImageIcon, Eye, EyeOff } from "lucide-react";
import { QuickSplitScreen } from "@/components/quicksplit/QuickSplitScreen";
import { LoginForm } from "@/components/auth/LoginForm";
import { SocialAuthWrapper } from "@/components/auth/SocialAuthWrapper";
import { RegistrationFlow } from "@/components/auth/RegistrationFlow";
import { useAuth } from "@/contexts/AuthContext";
import { storage } from "@/lib/firebase/config";
import { api } from "@/lib/api/client";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { updateUserPassword, addUserPassword } from "@/lib/firebase/auth";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

const navItems = [
  { id: "quicksplit", label: "QuickSplit" },
  { id: "pockety", label: "Pockety" },
  { id: "ucet", label: "Účet" },
  { id: "premium", label: "Premium" },
];

function PocketsScreen() {
  return (
    <div className="min-h-screen bg-background w-full">
      <div className="max-w-screen-sm mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-foreground">
          Pockety
        </h1>
      </div>
    </div>
  );
}

function AccountScreen({ onNewUser, isPendingNewUser }: { onNewUser?: (isNew: boolean, email?: string) => void; isPendingNewUser?: boolean }) {
  const { user, loading, signOut } = useAuth();
  const { activeTab } = useNavigation();
  const isAccountScreenActive = activeTab === "ucet";
  const [error, setError] = useState<string | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [userData, setUserData] = useState<{
    phoneNumber: string | null;
    residence: string | null;
    fullName: string | null;
    iban: string | null;
    profileImageUrl: string | null;
  } | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<"fullName" | "phoneNumber" | "iban" | "residence" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);

  useEffect(() => {
    const loadUserData = async () => {
      if (!user) {
        setDataLoading(false);
        return;
      }

      try {
        const data = await api.users.get(user.uid);
        setUserData({
          phoneNumber: data.phoneNumber || null,
          residence: data.residence || null,
          fullName: data.fullName || null,
          iban: data.iban || null,
          profileImageUrl: data.profileImageUrl || null,
        });
      } catch (error: any) {
        if (error.message?.includes('Backend server')) {
          console.warn('⚠️ Backend nie je spustený:', error.message);
        }
        setUserData({
          phoneNumber: null,
          residence: null,
          fullName: null,
          iban: null,
          profileImageUrl: null,
        });
      } finally {
        setDataLoading(false);
      }
    };

    loadUserData();
  }, [user]);

  if (loading || isPendingNewUser || dataLoading) {
    return (
      <div className="min-h-screen bg-background w-full flex items-center justify-center">
        <div className="text-muted-foreground">Načítavam...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="bg-background w-full">
        <div className="max-w-screen-sm mx-auto w-full px-5 pt-8 pb-0">
          <h1 className="text-3xl font-bold text-foreground mb-2 text-center">
            {isSignUp ? "Registrácia" : "Prihlásenie"}
          </h1>
          <p className="text-foreground text-center mb-6">
            {isSignUp ? "Vytvor si účet v GroupPocket" : "Vitaj späť v GroupPocket"}
          </p>
          {error && (
            <div className="mb-4 p-3 bg-muted border border-muted rounded-lg text-sm text-foreground">
              {error}
            </div>
          )}
          <LoginForm 
            onSuccess={(isNewUser, email) => {
              setError(null);
              if (isNewUser) {
                onNewUser?.(true, email);
              } else {
                onNewUser?.(false, email);
              }
            }}
            onError={(err) => setError(err.message)}
            onSignUpChange={setIsSignUp}
          />
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-foreground/20" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-background text-foreground">
                alebo
              </span>
            </div>
          </div>
          <SocialAuthWrapper 
            onSuccess={(isNewUser) => {
              setError(null);
              if (isNewUser) {
                onNewUser?.(true);
              } else {
                onNewUser?.(false);
              }
            }}
            onError={(err) => setError(err.message)}
          />
        </div>
      </div>
    );
  }

  const displayName = userData?.fullName || user.displayName;
  const firstName = displayName ? displayName.split(" ")[0] : null;
  const email = user.email;
  const phoneNumber = userData?.phoneNumber || null;
  const bankAccount = userData?.iban || null;
  const location = userData?.residence || null;
  const collectedAmount = 0;
  
  // Check if user has password provider
  const hasPassword = user.providerData.some(provider => provider.providerId === "password");

  const handleProfileImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !storage) return;

    if (!file.type.startsWith("image/")) {
      setError("Prosím vyberte obrázok");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Obrázok je príliš veľký (max 5MB)");
      return;
    }

    setSaving(true);
    try {
      const storageRef = ref(storage, `profiles/${user.uid}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      
      await api.users.updateProfileImage(user.uid, downloadURL);
      
      setUserData((prev) => {
        if (!prev) {
          return {
            phoneNumber: null,
            residence: null,
            fullName: null,
            iban: null,
            profileImageUrl: downloadURL,
          };
        }

        return {
          ...prev,
          profileImageUrl: downloadURL,
        };
      });
    } catch (error: any) {
      setError("Chyba pri nahrávaní obrázka");
    } finally {
      setSaving(false);
      if (e.target) {
        e.target.value = "";
      }
    }
  };

  const handleEditClick = (field: "fullName" | "phoneNumber" | "iban" | "residence") => {
    setEditingField(field);
    if (field === "fullName") {
      setEditValue(userData?.fullName || "");
    } else if (field === "phoneNumber") {
      setEditValue(userData?.phoneNumber || "");
    } else if (field === "iban") {
      setEditValue(userData?.iban || "");
    } else if (field === "residence") {
      setEditValue(userData?.residence || "");
    }
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!user || !editingField) return;

    setSaving(true);
    try {
      const updateData: any = {};
      
      if (editingField === "fullName") {
        updateData.fullName = editValue.trim() || null;
      } else if (editingField === "phoneNumber") {
        updateData.phoneNumber = editValue.trim() || null;
      } else if (editingField === "iban") {
        updateData.iban = editValue.trim() || null;
      } else if (editingField === "residence") {
        updateData.residence = editValue.trim() || null;
      }

      await api.users.update(user.uid, updateData);
      
      setUserData((prev) => ({
        ...prev,
        [editingField]: editValue.trim() || null,
      } as any));

      setModalOpen(false);
      setEditingField(null);
      setEditValue("");
    } catch (error: any) {
      setError(error.message || "Chyba pri ukladaní dát");
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!newPassword || !confirmPassword) {
      setError("Vyplňte všetky polia");
      return;
    }

    if (hasPassword && !currentPassword) {
      setError("Vyplňte aktuálne heslo");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Nové heslá sa nezhodujú");
      return;
    }

    if (newPassword.length < 6) {
      setError("Heslo musí mať aspoň 6 znakov");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (hasPassword) {
        await updateUserPassword(currentPassword, newPassword);
      } else {
        await addUserPassword(newPassword);
      }
      setPasswordModalOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
        } catch (error: any) {
          setError(error.message || "Chyba pri zmene hesla");
    } finally {
      setSaving(false);
    }
  };

  const getModalTitle = () => {
    switch (editingField) {
      case "fullName":
        return userData?.fullName ? "Upraviť meno" : "Pridať meno";
      case "phoneNumber":
        return userData?.phoneNumber ? "Upraviť telefónne číslo" : "Pridať telefónne číslo";
      case "iban":
        return userData?.iban ? "Upraviť IBAN" : "Pridať IBAN";
      case "residence":
        return userData?.residence ? "Upraviť bydlisko" : "Pridať bydlisko";
      default:
        return "";
    }
  };

  const getModalPlaceholder = () => {
    switch (editingField) {
      case "fullName":
        return "Meno a priezvisko";
      case "phoneNumber":
        return "+421 912 345 678";
      case "iban":
        return "SK12 3456 7890 1234 5678 9012";
      case "residence":
        return "Slovensko";
      default:
        return "";
    }
  };

  return (
    <>
      <Modal
        isOpen={modalOpen && isAccountScreenActive}
        onClose={() => {
          setModalOpen(false);
          setEditingField(null);
          setEditValue("");
        }}
        title={getModalTitle()}
      >
        <div className="space-y-4">
          {editingField === "residence" ? (
            <div className="relative">
              <select
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full h-14 px-4 pr-12 bg-background border border-foreground/20 rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary appearance-none cursor-pointer"
              >
                <option value="">Vyberte krajinu</option>
                <option value="Slovensko">Slovensko</option>
                <option value="Česko">Česko</option>
                <option value="Poľsko">Poľsko</option>
                <option value="Anglicko">Anglicko</option>
                <option value="Rakúsko">Rakúsko</option>
                <option value="Maďarsko">Maďarsko</option>
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/60 pointer-events-none" />
            </div>
          ) : (
            <input
              type={editingField === "phoneNumber" ? "tel" : "text"}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={getModalPlaceholder()}
              className="w-full h-14 px-4 bg-background border border-foreground/20 rounded-lg text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          )}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 h-12"
              onClick={() => {
                setModalOpen(false);
                setEditingField(null);
                setEditValue("");
              }}
              disabled={saving}
            >
              Zrušiť
            </Button>
            <Button
              className="flex-1 h-12 bg-primary hover:bg-primary/90"
              onClick={handleSave}
              disabled={saving || !editValue.trim()}
            >
              {saving ? "Ukladám..." : "Uložiť"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={passwordModalOpen && isAccountScreenActive}
        onClose={() => {
          setPasswordModalOpen(false);
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
          setError(null);
        }}
        title={hasPassword ? "Zmeniť heslo" : "Pridať heslo"}
      >
        <div className="space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-500">
              {error}
            </div>
          )}
          {hasPassword && (
            <div className="relative">
              <input
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Aktuálne heslo"
                className="w-full h-14 px-4 pr-12 bg-background border border-foreground/20 rounded-lg text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/60 hover:text-foreground"
              >
                {showCurrentPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          )}
          <div className="relative">
            <input
              type={showNewPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Nové heslo"
              className="w-full h-14 px-4 pr-12 bg-background border border-foreground/20 rounded-lg text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/60 hover:text-foreground"
            >
              {showNewPassword ? (
                <EyeOff className="w-5 h-5" />
              ) : (
                <Eye className="w-5 h-5" />
              )}
            </button>
          </div>
          <div className="relative">
            <input
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Potvrďte nové heslo"
              className="w-full h-14 px-4 pr-12 bg-background border border-foreground/20 rounded-lg text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/60 hover:text-foreground"
            >
              {showConfirmPassword ? (
                <EyeOff className="w-5 h-5" />
              ) : (
                <Eye className="w-5 h-5" />
              )}
            </button>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 h-12"
              onClick={() => {
                setPasswordModalOpen(false);
                setCurrentPassword("");
                setNewPassword("");
                setConfirmPassword("");
                setError(null);
              }}
              disabled={saving}
            >
              Zrušiť
            </Button>
            <Button
              className="flex-1 h-12 bg-primary hover:bg-primary/90"
              onClick={handlePasswordChange}
              disabled={saving || (hasPassword && !currentPassword) || !newPassword || !confirmPassword}
            >
              {saving ? "Ukladám..." : hasPassword ? "Zmeniť heslo" : "Pridať heslo"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={logoutModalOpen && isAccountScreenActive}
        onClose={() => setLogoutModalOpen(false)}
        title="Odhlásiť sa"
      >
        <div className="space-y-4">
          <p className="text-foreground">
            Naozaj sa chcete odhlásiť?
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 h-12"
              onClick={() => setLogoutModalOpen(false)}
            >
              Zrušiť
            </Button>
            <Button
              className="flex-1 h-12 bg-primary hover:bg-primary/90"
              onClick={async () => {
                setLogoutModalOpen(false);
                await signOut();
              }}
            >
              Odhlásiť sa
            </Button>
          </div>
        </div>
      </Modal>

      <div className="min-h-screen bg-background w-full">
        <div className="max-w-screen-sm mx-auto px-5 py-6 space-y-8">
        <div>
          <h1 className="text-lg font-bold text-foreground mb-4">Profil</h1>
          <div className="flex items-center gap-4 mb-6">
            <label htmlFor="profile-image-upload" className="cursor-pointer">
              {userData?.profileImageUrl ? (
                <img
                  src={userData.profileImageUrl}
                  alt="Profilový obrázok"
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
                  <UserIcon className="w-10 h-10 text-foreground/60" />
                </div>
              )}
            </label>
            <div className="flex-1">
              <h2 className="text-3xl font-bold text-foreground mb-1">
                {displayName || "Ahoj"}
              </h2>
              <p className="text-primary text-sm">
                Zozbieraných {collectedAmount}€
              </p>
            </div>
          </div>
          
          <div className="space-y-0">
            <div className="flex items-center justify-between py-4 border-b border-foreground/10">
              <div className="flex items-center gap-3">
                <UserIcon className="w-5 h-5 text-foreground flex-shrink-0" />
                {displayName ? (
                  <span className="text-foreground">{displayName}</span>
                ) : (
                  <span className="text-muted-foreground">Meno</span>
                )}
              </div>
              <button 
                onClick={() => handleEditClick("fullName")}
                className="text-primary text-sm font-medium"
              >
                {displayName ? "Upraviť" : "Pridať"}
              </button>
            </div>
            
            <div className="flex items-center justify-between py-4 border-b border-foreground/10">
              <div className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-foreground flex-shrink-0" />
                {phoneNumber ? (
                  <span className="text-foreground">{phoneNumber}</span>
                ) : (
                  <span className="text-muted-foreground">Telefónne číslo</span>
                )}
              </div>
              <button 
                onClick={() => handleEditClick("phoneNumber")}
                className="text-primary text-sm font-medium"
              >
                {phoneNumber ? "Upraviť" : "Pridať"}
              </button>
            </div>
            
            <div className="flex items-center justify-between py-4 border-b border-foreground/10">
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-foreground flex-shrink-0" />
                {email ? (
                  <span className="text-foreground">{email}</span>
                ) : (
                  <span className="text-muted-foreground">Email</span>
                )}
              </div>
            </div>
            
            <div className="flex items-center justify-between py-4 border-b border-foreground/10">
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-foreground flex-shrink-0" />
                {bankAccount ? (
                  <span className="text-foreground">{bankAccount}</span>
                ) : (
                  <span className="text-muted-foreground">IBAN</span>
                )}
              </div>
              <button 
                onClick={() => handleEditClick("iban")}
                className="text-primary text-sm font-medium"
              >
                {bankAccount ? "Upraviť" : "Pridať"}
              </button>
            </div>
            
            <div className="flex items-center justify-between py-4 border-b border-foreground/10">
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-foreground flex-shrink-0" />
                {location ? (
                  <span className="text-foreground">{location}</span>
                ) : (
                  <span className="text-muted-foreground">Lokácia</span>
                )}
              </div>
              <button 
                onClick={() => handleEditClick("residence")}
                className="text-primary text-sm font-medium"
              >
                {location ? "Upraviť" : "Pridať"}
              </button>
            </div>
            
            <label htmlFor="profile-image-upload" className="cursor-pointer">
              <div className="flex items-center justify-between py-4">
                <span className="text-foreground">Zmeniť profilovú fotku</span>
                <ChevronRight className="w-5 h-5 text-primary" />
              </div>
            </label>
            <input
              id="profile-image-upload"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleProfileImageUpload}
              disabled={saving}
            />
          </div>
        </div>

        <div>
          <h2 className="text-lg font-bold text-foreground mb-4">Personalizácia</h2>
          <div className="space-y-0">
            <div className="flex items-center justify-between py-4">
              <span className="text-foreground">Jazyk</span>
              <span className="text-primary">Slovenčina</span>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-bold text-foreground mb-4">Bezpečnosť</h2>
          <div className="space-y-0">
            <button 
              className="w-full flex items-center justify-between py-4 border-b border-foreground/10"
              onClick={() => setPasswordModalOpen(true)}
            >
              <span className="text-foreground">{hasPassword ? "Zmeniť heslo" : "Pridať heslo"}</span>
              <ChevronRight className="w-5 h-5 text-primary" />
            </button>
            <button 
              className="w-full flex items-center justify-between py-4"
              onClick={() => setLogoutModalOpen(true)}
            >
              <span className="text-foreground">Odhlásiť sa</span>
              <ChevronRight className="w-5 h-5 text-primary" />
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

function PremiumPlanScreen() {
  return (
    <div className="min-h-screen bg-background w-full">
      <div className="max-w-screen-sm mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-foreground">
          Premium
        </h1>
      </div>
    </div>
  );
}

function Content({ onNewUser, isPendingNewUser }: { onNewUser?: (isNew: boolean, email?: string) => void; isPendingNewUser?: boolean }) {
  const { activeTab } = useNavigation();
  const contentRef = useRef<HTMLDivElement>(null);
  useSwipeNavigation(contentRef);

  const activeIndex = navItems.findIndex((item) => item.id === activeTab);

  return (
    <>
      <div ref={contentRef} className="relative w-full h-full overflow-hidden">
        <div
          className="flex transition-transform duration-300 ease-out h-full"
          style={{
            transform: `translateX(-${activeIndex * 100}%)`,
            willChange: "transform",
          }}
        >
          <div className="w-full flex-shrink-0 h-full overflow-y-auto">
            <QuickSplitScreen />
          </div>
          <div className="w-full flex-shrink-0 h-full overflow-y-auto">
            <PocketsScreen />
          </div>
          <div className="w-full flex-shrink-0 h-full overflow-y-auto">
            <AccountScreen onNewUser={onNewUser} isPendingNewUser={isPendingNewUser} />
          </div>
          <div className="w-full flex-shrink-0 h-full overflow-y-auto">
            <PremiumPlanScreen />
          </div>
        </div>
      </div>
    </>
  );
}

export default function Home() {
  const { user, loading } = useAuth();
  const { setActiveTab } = useNavigation();
  const [showRegistrationFlow, setShowRegistrationFlow] = useState(false);
  const [registrationInitialName, setRegistrationInitialName] = useState("");
  const [pendingNewUser, setPendingNewUser] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [shouldNavigateToAccount, setShouldNavigateToAccount] = useState(false);

  useEffect(() => {
    if (user && pendingNewUser && !showRegistrationFlow) {
      const creationTime = new Date(user.metadata.creationTime || "").getTime();
      const lastSignInTime = new Date(user.metadata.lastSignInTime || "").getTime();
      const timeDiff = Math.abs(creationTime - lastSignInTime);
      const isNewUser = timeDiff < 5000;
      
      if (isNewUser) {
        const displayName = user.displayName || user.email?.split("@")[0] || pendingEmail?.split("@")[0] || "";
        setRegistrationInitialName(displayName);
        setShowRegistrationFlow(true);
      }
      setPendingNewUser(false);
      setPendingEmail(null);
    }
  }, [user, pendingNewUser, pendingEmail, showRegistrationFlow]);

  // Presmerovanie na účet po dokončení registrácie
  useEffect(() => {
    if (shouldNavigateToAccount && !showRegistrationFlow) {
      setActiveTab("ucet");
      setShouldNavigateToAccount(false);
    }
  }, [shouldNavigateToAccount, showRegistrationFlow, setActiveTab]);

  const handleSaveStep = async (step: number, stepData: any) => {
    if (!user) {
      return;
    }

    try {
      const updateData: any = {};
      
      if (step === 1 && stepData.phoneNumber) {
        updateData.phoneNumber = stepData.phoneNumber ? `${stepData.countryCode}${stepData.phoneNumber}` : null;
      } else if (step === 2 && stepData.residence) {
        updateData.residence = stepData.residence;
      } else if (step === 3 && stepData.fullName) {
        updateData.fullName = stepData.fullName;
      } else if (step === 4 && stepData.iban) {
        updateData.iban = stepData.iban;
      }
      
      await api.users.update(user.uid, updateData);
    } catch (error: any) {
    }
  };

  const handleRegistrationComplete = async (data: any) => {
    if (!user) {
      setShowRegistrationFlow(false);
      setPendingNewUser(false);
      setPendingEmail(null);
      return;
    }

    try {
      const userData = {
        phoneNumber: data.phoneNumber ? `${data.countryCode}${data.phoneNumber}` : null,
        residence: data.residence || null,
        fullName: data.fullName || null,
        iban: data.iban || null,
      };

      await api.users.update(user.uid, userData);
    } catch (error: any) {
    }
    
    // Nastaviť flag, že sa má presmerovať na účet
    setShouldNavigateToAccount(true);
    
    setShowRegistrationFlow(false);
    setPendingNewUser(false);
    setPendingEmail(null);
  };

  const handleNewUser = (isNew: boolean, email?: string) => {
    if (isNew) {
      setPendingNewUser(true);
      if (email) {
        setPendingEmail(email);
        const displayName = email.split("@")[0] || "";
        setRegistrationInitialName(displayName);
        setShowRegistrationFlow(true);
      } else if (user) {
        const displayName = user.displayName || user.email?.split("@")[0] || "";
        setRegistrationInitialName(displayName);
        setShowRegistrationFlow(true);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Načítavam...</div>
      </div>
    );
  }

  if (showRegistrationFlow) {
    return (
      <TopNav>
        <RegistrationFlow
          initialName={registrationInitialName}
          onComplete={handleRegistrationComplete}
          onSkip={handleRegistrationComplete}
          onNavigateToAccount={handleRegistrationComplete}
          onSaveStep={handleSaveStep}
        />
      </TopNav>
    );
  }

  return (
    <div className="h-screen bg-background overflow-hidden flex flex-col">
      <TopNav initialTab={shouldNavigateToAccount ? "ucet" : undefined}>
        <div className="flex-1 overflow-y-auto">
          <Content onNewUser={handleNewUser} isPendingNewUser={pendingNewUser || showRegistrationFlow} />
        </div>
      </TopNav>
    </div>
  );
}
