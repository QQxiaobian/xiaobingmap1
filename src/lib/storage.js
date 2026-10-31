// 数据层：通过 Supabase 读写收藏夹数据（文件夹、点位、线路）
// 所有数据都按当前登录用户隔离，管理员可跨用户管理
import { supabase } from './supabase.js';

// ---- 文件夹 ----
export const folders = {
  async list() {
    const { data, error } = await supabase
      .from('folders')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  },
  async create(name, parentId = null) {
    const { data, error } = await supabase
      .from('folders')
      .insert({ name, parent_id: parentId })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async update(id, patch) {
    const { data, error } = await supabase
      .from('folders')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async remove(id) {
    const { error } = await supabase.from('folders').delete().eq('id', id);
    if (error) throw error;
  },
};

// ---- 点位 ----
export const markers = {
  async list() {
    const { data, error } = await supabase
      .from('markers')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async listByUser(userId) {
    const { data, error } = await supabase
      .from('markers')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async create(payload) {
    const { data, error } = await supabase
      .from('markers')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async update(id, patch) {
    const { data, error } = await supabase
      .from('markers')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async remove(id) {
    const { error } = await supabase.from('markers').delete().eq('id', id);
    if (error) throw error;
  },
  async removeMany(ids) {
    const { error } = await supabase.from('markers').delete().in('id', ids);
    if (error) throw error;
  },
};

// ---- 线路 ----
export const tracks = {
  async list() {
    const { data, error } = await supabase
      .from('tracks')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async listByUser(userId) {
    const { data, error } = await supabase
      .from('tracks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async create(payload) {
    const { data, error } = await supabase
      .from('tracks')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async update(id, patch) {
    const { data, error } = await supabase
      .from('tracks')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async remove(id) {
    const { error } = await supabase.from('tracks').delete().eq('id', id);
    if (error) throw error;
  },
  async removeMany(ids) {
    const { error } = await supabase.from('tracks').delete().in('id', ids);
    if (error) throw error;
  },
};

// ---- 用户设置（localStorage）----
export async function getSettings() {
  const raw = localStorage.getItem('xb_settings');
  return raw ? JSON.parse(raw) : { coordDisplay: 'WGS84', defaultLayer: 'esri' };
}

export async function saveSettings(settings) {
  const cur = await getSettings();
  localStorage.setItem('xb_settings', JSON.stringify({ ...cur, ...settings }));
}

// ---- 用户信息 ----
export const profiles = {
  async list() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, role, created_at')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },
  async setRole(id, role) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async remove(id) {
    // 通过 admin edge function 删除用户
    const { error: fnError } = await supabase.functions.invoke('admin-delete-user', {
      body: { userId: id },
    });
    if (fnError) throw fnError;
  },
};
