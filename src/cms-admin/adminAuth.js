import { createClient } from '@supabase/supabase-js';
import { ADMIN_ROLES, SUPABASE_CONFIG, getSupabaseConfigStatus } from './adminConfig.js';

let supabaseClient = null;

export function createSupabaseClient() {
  const status = getSupabaseConfigStatus();
  if (!status.ready) {
    return {
      client: null,
      error: new Error(`Thiếu cấu hình Supabase: ${status.missing.join(', ')}`),
      status,
    };
  }

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return { client: supabaseClient, error: null, status };
}

export async function getCurrentSession(client) {
  if (!client) {
    return { session: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const { data, error } = await client.auth.getSession();
  return { session: data?.session || null, error };
}

export async function signInWithEmailPassword(client, email, password) {
  if (!client) {
    return { session: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const cleanEmail = String(email || '').trim();
  const cleanPassword = String(password || '');

  if (!cleanEmail || !cleanPassword) {
    return { session: null, error: new Error('Vui lòng nhập email và mật khẩu.') };
  }

  const { data, error } = await client.auth.signInWithPassword({
    email: cleanEmail,
    password: cleanPassword,
  });

  return { session: data?.session || null, user: data?.user || null, error };
}

export async function signOut(client) {
  if (!client) return { error: null };
  const { error } = await client.auth.signOut();
  return { error };
}

export async function getCurrentProfile(client, userId) {
  if (!client) {
    return { profile: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  if (!userId) {
    return { profile: null, error: new Error('Không tìm thấy user ID trong session.') };
  }

  const { data, error } = await client
    .from('profiles')
    .select('id,email,display_name,role,is_active,created_at,updated_at')
    .eq('id', userId)
    .maybeSingle();

  return { profile: data || null, error };
}

export async function requireAdminAccess(client) {
  const { session, error: sessionError } = await getCurrentSession(client);
  if (sessionError) {
    return { allowed: false, session: null, profile: null, error: sessionError, reason: 'session_error' };
  }

  if (!session?.user) {
    return { allowed: false, session: null, profile: null, error: null, reason: 'no_session' };
  }

  const { profile, error: profileError } = await getCurrentProfile(client, session.user.id);
  if (profileError) {
    return { allowed: false, session, profile: null, error: profileError, reason: 'profile_error' };
  }

  if (!profile) {
    return {
      allowed: false,
      session,
      profile: null,
      error: new Error('Tài khoản chưa có profile quyền quản trị.'),
      reason: 'missing_profile',
    };
  }

  const hasRole = profile.role === ADMIN_ROLES.admin || profile.role === ADMIN_ROLES.editor;
  const isActive = profile.is_active === true;

  if (!hasRole || !isActive) {
    return {
      allowed: false,
      session,
      profile,
      error: new Error('Tài khoản không có quyền truy cập Admin CMS hoặc đã bị vô hiệu hóa.'),
      reason: 'access_denied',
    };
  }

  return { allowed: true, session, profile, error: null, reason: 'allowed' };
}

export function onAuthStateChange(client, callback) {
  if (!client || typeof callback !== 'function') {
    return () => {};
  }

  const { data } = client.auth.onAuthStateChange((event, session) => {
    callback({ event, session });
  });

  return () => {
    data?.subscription?.unsubscribe?.();
  };
}
