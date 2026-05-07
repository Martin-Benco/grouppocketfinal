"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { signInWithEmail, signUpWithEmail, resetPassword } from "@/lib/firebase/auth";

interface LoginFormProps {
  onSuccess?: (isNewUser?: boolean, email?: string) => void;
  onError?: (error: Error) => void;
  onSignUpChange?: (isSignUp: boolean) => void;
}

export function LoginForm({ onSuccess, onError, onSignUpChange }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  useEffect(() => {
    onSignUpChange?.(isSignUp);
  }, [isSignUp, onSignUpChange]);

  const handleSignUpToggle = (value: boolean) => {
    setIsSignUp(value);
    onSignUpChange?.(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    try {
      setIsLoading(true);
      if (isSignUp) {
        await signUpWithEmail(email, password);
        onSuccess?.(true, email);
      } else {
        await signInWithEmail(email, password);
        onSuccess?.(false, email);
      }
    } catch (error) {
      onError?.(error as Error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!resetEmail) {
      setResetMessage("Enter your email");
      return;
    }

    try {
      setIsResetting(true);
      setResetMessage(null);
      await resetPassword(resetEmail);
      setResetMessage("Password reset email sent. Check your inbox.");
    } catch (error: any) {
      setResetMessage(error.message || "Failed to send email");
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-3">
        <div className="relative">
          <input
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full h-14 px-4 bg-card border border-foreground/20 rounded-lg text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full h-14 px-4 pr-12 bg-card border border-foreground/20 rounded-lg text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground/60 hover:text-foreground"
          >
            {showPassword ? (
              <EyeOff className="w-5 h-5" />
            ) : (
              <Eye className="w-5 h-5" />
            )}
          </button>
        </div>
        {!isSignUp && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setResetEmail(email);
                setShowForgotPassword(true);
              }}
              className="text-primary text-sm font-medium"
            >
              Forgot password?
            </button>
          </div>
        )}
        {isSignUp && (
          <div className="h-[21px]"></div>
        )}
      </div>
      <Button 
        type="submit" 
        className="w-full h-14 text-base font-bold bg-primary hover:bg-primary/90 rounded-full"
        disabled={isLoading}
      >
        {isSignUp ? "Sign up" : "Sign in"}
      </Button>
      {!isSignUp && (
        <div className="text-center text-sm text-foreground">
          <span>Don&apos;t have an account yet? </span>
          <button
            type="button"
            onClick={() => handleSignUpToggle(true)}
            className="text-primary font-medium"
          >
            Sign up
          </button>
        </div>
      )}
      {isSignUp && (
        <button
          type="button"
          onClick={() => handleSignUpToggle(false)}
          className="w-full text-center text-primary text-sm font-medium"
        >
          I already have an account
        </button>
      )}

      <Modal
        isOpen={showForgotPassword}
        onClose={() => {
          setShowForgotPassword(false);
          setResetEmail("");
          setResetMessage(null);
        }}
        title="Reset password"
      >
        <div className="space-y-4">
          <p className="text-foreground text-sm">
            Enter your email and we&apos;ll send you a password reset link.
          </p>
          <input
            type="email"
            placeholder="E-mail"
            value={resetEmail}
            onChange={(e) => setResetEmail(e.target.value)}
            className="w-full h-14 px-4 bg-card border border-foreground/20 rounded-lg text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {resetMessage && (
            <div className={`p-3 rounded-lg text-sm ${
              resetMessage.includes("sent") 
                ? "bg-green-500/10 border border-green-500/20 text-green-500"
                : "bg-red-500/10 border border-red-500/20 text-red-500"
            }`}>
              {resetMessage}
            </div>
          )}
          <Button
            onClick={handleForgotPassword}
            disabled={isResetting || !resetEmail}
            className="w-full h-12 bg-primary hover:bg-primary/90"
          >
            {isResetting ? "Sending..." : "Send"}
          </Button>
        </div>
      </Modal>
    </form>
  );
}
