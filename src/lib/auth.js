// 前端鉴权状态管理
import { api } from './api.js';
import { saveAuth, getAuth, clearAuth } from './storage.js';

let currentUser = null;

export async function initAuth() {
  const auth = await getAuth();
  if (auth?.token && auth?.user) {
    currentUser = auth.user;
  }
  return currentUser;
}

export function getUser() { return currentUser; }
export function isAdmin() { return currentUser?.role === 'admin'; }
export function isLoggedIn() { return !!currentUser; }

export async function login(username, password) {
  const data = await api.login(username, password);
  currentUser = data.user;
  await saveAuth(data);
  return data.user;
}

export async function register(username, password) {
  const data = await api.register(username, password);
  currentUser = data.user;
  await saveAuth(data);
  return data.user;
}

export async function logout() {
  currentUser = null;
  await clearAuth();
}
