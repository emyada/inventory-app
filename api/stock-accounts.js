import { createClient } from '@supabase/supabase-js';
import { loginAlias } from '../src/lib/loginAlias.js';

const roles = ['staff', 'admin', 'purchasing'];
export function accountEndpoint(env, connect = createClient) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const fail = (status, error) => res.status(status).json({ error });
    if (req.method !== 'POST') return fail(405, 'POST required');
    // Fail closed on the server, before any Auth or database connection.
    if (req.body?.action !== 'list' && env.STOCK_ACCOUNT_MUTATIONS_ENABLED !== 'true') {
      return fail(403, 'READ ONLY: account mutations disabled');
    }
    const ref = env.STOCK_ACCOUNT_PROJECT_REF;
    if (!/^[a-z]{20}$/.test(ref || '') || ['lybneofhjhtdyjvfckyg','hkfgzbeoobfnilrzpxwj','qowhwyiooxxvdbnerlpa'].includes(ref)
        || env.VITE_SUPABASE_URL !== 'https://' + ref + '.supabase.co' || env.VITE_SUPABASE_EXPECTED_PROJECT_REF !== ref
        || !env.VITE_SUPABASE_ANON_KEY) return fail(503, 'Account management unavailable');
    const bearer = req.headers.authorization;
    if (!/^Bearer [^\s]+$/.test(bearer || '')) return fail(401, 'Authentication required');
    const auth = { persistSession: false, autoRefreshToken: false };
    try {
      const userClient = connect(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth,global:{headers:{Authorization:bearer}}});
      const {data:{user},error} = await userClient.auth.getUser(bearer.slice(7));
      if (error || !user) return fail(401,'Authentication required');
      const {data:actor} = await userClient.from('profiles').select('role,enabled').eq('id',user.id).single();
      if (!actor?.enabled || actor.role !== 'admin') return fail(403,'Admin required');
      const { action, id, username, name, role, password } = req.body || {};
      if (action === 'list') {
        const {data,error} = await userClient.from('profiles').select('id,username,full_name,role,enabled').order('username');
        return error ? fail(503,'โหลดบัญชีไม่สำเร็จ') : res.status(200).json({accounts:data});
      }
      if (!['create','edit','reset','disable','enable'].includes(action)) return fail(400,'Unknown action');
      // Listing uses the caller's RLS-bound client. Only mutations need the server secret.
      if (!env.STOCK_ACCOUNT_SECRET) return fail(503,'ยังไม่ได้ตั้งค่าบริการจัดการบัญชี กรุณาติดต่อผู้ดูแลระบบ');
      if (action !== 'create' && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id || '')) return fail(400,'Invalid account');
      if (['create','edit'].includes(action) && (!roles.includes(role) || typeof name !== 'string' || !name.trim() || name.length>120)) return fail(400,'Invalid name or role');
      if (['create','reset'].includes(action) && (typeof password !== 'string' || password.length<8 || password.length>128)) return fail(400,'ใช้รหัสผ่าน 8–128 ตัวอักษร รองรับตัวเลขอย่างน้อย 8 หลัก');
      const admin = connect(env.VITE_SUPABASE_URL,env.STOCK_ACCOUNT_SECRET,{auth});
      if (action === 'create') {
        const email = loginAlias(username);
        if (!email) return fail(400,'ชื่อผู้ใช้ไม่ถูกต้อง');
        const {error} = await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{stock_managed:true,stock_actor:user.id,stock_name:name.trim(),stock_role:role}});
        // The installed AFTER INSERT Auth trigger provisions the profile in the
        // same database transaction. A trigger error rolls back Auth insertion.
        // Never compensate an uncertain network result by deleting an account.
        if (error) return error.code === 'email_exists' || error.code === 'user_already_exists'
          ? fail(409,'ชื่อผู้ใช้นี้มีอยู่แล้ว กรุณาใช้ชื่ออื่น')
          : fail(409,'สร้างบัญชีไม่ได้ โปรดตรวจเงื่อนไขรหัสผ่านและโหลดรายการก่อนลองใหม่');
      } else {
        const {error} = await admin.rpc('stock_manage_profile',{p_actor:user.id,p_subject:id,p_action:action==='reset'?'authorize_reset':action,p_name:action==='edit'?name:null,p_role:action==='edit'?role:null});
        if (error) return fail(409,'จัดการบัญชีไม่ได้ โปรดตรวจสิทธิ์และจำนวน Admin ที่เปิดใช้งาน');
        if (action === 'reset' && (await admin.auth.admin.updateUserById(id,{password})).error) return fail(409,'เปลี่ยนรหัสผ่านไม่สำเร็จ');
      }
      return res.status(200).json({ok:true});
    } catch { return fail(503,'ไม่ทราบผล โปรดตรวจรายการก่อนทำซ้ำ'); }
  };
}
export default accountEndpoint(process.env);
