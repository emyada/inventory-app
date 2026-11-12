// Auth callbacks never await Supabase work while its auth lock is held.
export function startSessionLifecycle(client, publish, schedule = fn => setTimeout(fn, 0)) {
  let alive = true, serial = 0, current = null, seenEvent = false, loadedId = null;
  async function apply(session) {
    const ticket = ++serial;
    current = session;
    if (!session) { loadedId=null; publish({session:null, profile:null, loading:false, error:null}); return; }
    if (loadedId !== session.user.id) publish({session, profile:null, loading:true, error:null});
    try {
      const {data, error} = await client.from('profiles').select('id,username,full_name,role,enabled').eq('id', session.user.id).single();
      if (error || !data || data.id !== session.user.id) throw new Error('Profile unavailable');
      if (alive && ticket === serial) { loadedId=session.user.id; publish({session, profile:data, loading:false, error:null}); }
    } catch {
      if (alive && ticket === serial) publish({session, profile:null, loading:false, error:'ตรวจสอบสิทธิ์ไม่ได้ กรุณาลองใหม่'});
    }
  }
  const {data} = client.auth.onAuthStateChange((_event, session) => {
    seenEvent = true;
    // Invalidate pending profile reads synchronously, including sign-out.
    serial++;
    current = session;
    if (!session) { loadedId=null; publish({session:null,profile:null,loading:false,error:null}); }
    else schedule(() => { if (alive && current === session) void apply(session); });
  });
  client.auth.getSession().then(({data, error}) => {
    if (!alive || seenEvent) return;
    if (error) publish({session:null,profile:null,loading:false,error:'กู้คืนการเข้าสู่ระบบไม่ได้ กรุณาลองใหม่'});
    else void apply(data.session);
  }).catch(() => { if (alive && !seenEvent) publish({session:null,profile:null,loading:false,error:'กู้คืนการเข้าสู่ระบบไม่ได้ กรุณาลองใหม่'}); });
  return {refresh:() => apply(current), stop:() => { alive=false; serial++; data.subscription.unsubscribe(); }};
}
