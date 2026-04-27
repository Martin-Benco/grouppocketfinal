"use client";

import { SocialAuth } from "./SocialAuth";

interface SocialAuthWrapperProps {
  onSuccess?: (isNewUser?: boolean) => void;
  onError?: (error: Error) => void;
}

export function SocialAuthWrapper({ onSuccess, onError }: SocialAuthWrapperProps) {
  return <SocialAuth onSuccess={onSuccess} onError={onError} />;
}
