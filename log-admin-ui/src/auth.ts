const JWT_KEY = "emotion_kit_admin_jwt";

export function getJwt(): string {
  try {
    return localStorage.getItem(JWT_KEY) || "";
  } catch {
    return "";
  }
}

export function setJwt(token: string) {
  try {
    localStorage.setItem(JWT_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearJwt() {
  try {
    localStorage.removeItem(JWT_KEY);
  } catch {
    /* ignore */
  }
}
