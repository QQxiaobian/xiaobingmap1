// 鉴权：基于 Supabase Auth，邮箱+密码登录/注册
import { supabase } from './supabase.js';

let currentUser = null;

export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    currentUser = await loadProfile(data.session.user);
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    (async () => {
      if (session?.user) {
        currentUser = await loadProfile(session.user);
      } else {
        currentUser = null;
      }
    })();
  });

  return currentUser;
}

async function loadProfile(authUser) {
  const { data } = await supabase
    .from('profiles')
    .select('id, username, role')
    .eq('id', authUser.id)
    .maybeSingle();
  return data || { id: authUser.id, username: authUser.email, role: 'user' };
}

export function getUser() { return currentUser; }
export function isAdmin() { return currentUser?.role === 'admin'; }
export function isLoggedIn() { return !!currentUser; }

export async function login(username, password) {
  const email = usernameToEmail(username);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  currentUser = await loadProfile(data.user);
  return currentUser;
}

export async function register(username, password) {
  const email = usernameToEmail(username);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('注册失败，请重试');
  currentUser = await loadProfile(data.user);
  return currentUser;
}

export async function logout() {
  currentUser = null;
  await supabase.auth.signOut();
}

// 用户名转虚拟邮箱：Supabase Auth 要求邮箱格式，但我们用用户名登录
function usernameToEmail(username) {
  if (username.includes('@')) return username;
  return `${username}@xiaobingmap.local`;
}
