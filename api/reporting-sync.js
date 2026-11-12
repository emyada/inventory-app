import {createClient} from '@supabase/supabase-js';
import {reportingSyncHandler} from '../server/reporting-sync.js';
export default reportingSyncHandler({env:process.env,createClient});
