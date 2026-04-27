/** SessionStorage kľúče pre QuickSplit (hostia + lokálny stav tvorcu). */

export const QS_ACTIVE_ID = 'gp_qs_active_id';

export function qsJoinKey(splitId: string) {
  return `gp_qs_${splitId}_join`;
}
export function qsAdminKey(splitId: string) {
  return `gp_qs_${splitId}_admin`;
}
export function qsCreatorPidKey(splitId: string) {
  return `gp_qs_${splitId}_creatorPid`;
}
export function qsCreatorSecretKey(splitId: string) {
  return `gp_qs_${splitId}_creatorSecret`;
}
export function qsMyPidKey(splitId: string) {
  return `gp_qs_${splitId}_myPid`;
}
export function qsMyPsecretKey(splitId: string) {
  return `gp_qs_${splitId}_myPsecret`;
}

const emptySession = () => ({
  joinToken: null as string | null,
  adminToken: null as string | null,
  creatorParticipantId: null as string | null,
  creatorParticipantSecret: null as string | null,
  myParticipantId: null as string | null,
  myParticipantSecret: null as string | null,
});

export function readQsSession(splitId: string) {
  if (typeof sessionStorage === "undefined") return emptySession();
  return {
    joinToken: sessionStorage.getItem(qsJoinKey(splitId)),
    adminToken: sessionStorage.getItem(qsAdminKey(splitId)),
    creatorParticipantId: sessionStorage.getItem(qsCreatorPidKey(splitId)),
    creatorParticipantSecret: sessionStorage.getItem(qsCreatorSecretKey(splitId)),
    myParticipantId: sessionStorage.getItem(qsMyPidKey(splitId)),
    myParticipantSecret: sessionStorage.getItem(qsMyPsecretKey(splitId)),
  };
}

export function writeQsCreateSession(
  splitId: string,
  tokens: {
    joinToken: string;
    adminToken: string;
    creatorParticipantId: string;
    creatorParticipantSecret: string;
  },
) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(QS_ACTIVE_ID, splitId);
  sessionStorage.setItem(qsJoinKey(splitId), tokens.joinToken);
  sessionStorage.setItem(qsAdminKey(splitId), tokens.adminToken);
  sessionStorage.setItem(qsCreatorPidKey(splitId), tokens.creatorParticipantId);
  sessionStorage.setItem(qsCreatorSecretKey(splitId), tokens.creatorParticipantSecret);
  sessionStorage.setItem(qsMyPidKey(splitId), tokens.creatorParticipantId);
  sessionStorage.setItem(qsMyPsecretKey(splitId), tokens.creatorParticipantSecret);
}

export function writeQsJoinSession(
  splitId: string,
  joinToken: string,
  my: { participantId: string; participantSecret: string },
) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(QS_ACTIVE_ID, splitId);
  sessionStorage.setItem(qsJoinKey(splitId), joinToken);
  sessionStorage.setItem(qsMyPidKey(splitId), my.participantId);
  sessionStorage.setItem(qsMyPsecretKey(splitId), my.participantSecret);
}

export function clearQsSession(splitId: string) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(QS_ACTIVE_ID);
  sessionStorage.removeItem(qsJoinKey(splitId));
  sessionStorage.removeItem(qsAdminKey(splitId));
  sessionStorage.removeItem(qsCreatorPidKey(splitId));
  sessionStorage.removeItem(qsCreatorSecretKey(splitId));
  sessionStorage.removeItem(qsMyPidKey(splitId));
  sessionStorage.removeItem(qsMyPsecretKey(splitId));
}
