-- Per-model duplicate-order rule, Package/Driver flag + prefix for every model,
-- duplicate check at submission, auto-deduct of "no picking" materials at request time.
-- DRAFT, NOT YET APPLIED: needs the owner role of schema duplicate_order_private (inventory_executor); the postgres role used by the connector is denied.

-- 1. Scope duplicates by model --------------------------------------------------
ALTER TABLE duplicate_order_private.request_identity ADD COLUMN model_id uuid REFERENCES public.models(id);
ALTER TABLE duplicate_order_private.issued_identity  ADD COLUMN model_id uuid REFERENCES public.models(id);
ALTER TABLE duplicate_order_private.request_identity ALTER COLUMN model_id SET NOT NULL;
ALTER TABLE duplicate_order_private.issued_identity  ALTER COLUMN model_id SET NOT NULL;
DROP INDEX duplicate_order_private.one_active_issue_slot;
CREATE UNIQUE INDEX one_active_issue_per_model ON duplicate_order_private.issued_identity(model_id, reference_key)
  WHERE released_operation_id IS NULL;
ALTER TABLE duplicate_order_private.model_policy DROP CONSTRAINT model_policy_check;
DROP TRIGGER package_slot ON duplicate_order_private.request_identity;
DROP FUNCTION duplicate_order_private.guard_package_slot();

DO $$ DECLARE c text; BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid='public.inventory_operations'::regclass AND pg_get_constraintdef(oid) LIKE '%set_model_prefix%';
  EXECUTE format('ALTER TABLE public.inventory_operations DROP CONSTRAINT %I', c);
END $$;
ALTER TABLE public.inventory_operations ADD CONSTRAINT inventory_operations_kind_check CHECK (kind = ANY (ARRAY[
 'create_material','update_material','archive_material','create_request','confirm_pick','cancel_request','purchase','stocktake',
 'baseline','save_model','set_model_active','set_model_prefix','set_model_settings','finished_out']));

-- 2. Every model gets a policy row (Driver by default) and a prefix row -----------
INSERT INTO duplicate_order_private.model_policy(model_id,recorded_category,parent_category,work_kind)
SELECT id,category,category,CASE WHEN name IN ('Package-CIEM','Package-LifestyleCIEM') THEN 'supplemental' ELSE 'primary' END FROM public.models
ON CONFLICT (model_id) DO NOTHING;
INSERT INTO duplicate_order_private.model_prefix(model_id,prefix,revision) SELECT id,'',1 FROM public.models ON CONFLICT (model_id) DO NOTHING;

CREATE FUNCTION duplicate_order_private.sync_model_defaults() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 INSERT INTO duplicate_order_private.model_policy(model_id,recorded_category,parent_category,work_kind) VALUES(NEW.id,NEW.category,NEW.category,'primary')
 ON CONFLICT (model_id) DO UPDATE SET recorded_category=EXCLUDED.recorded_category,parent_category=EXCLUDED.parent_category;
 INSERT INTO duplicate_order_private.model_prefix(model_id,prefix,revision) VALUES(NEW.id,'',1) ON CONFLICT (model_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER models_sync_defaults AFTER INSERT OR UPDATE OF category ON public.models FOR EACH ROW EXECUTE FUNCTION duplicate_order_private.sync_model_defaults();

-- 3. Duplicate check at submission, per model ---------------------------------------
CREATE OR REPLACE FUNCTION duplicate_order_private.register_new_request(p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE t public.transactions%ROWTYPE; p duplicate_order_private.model_policy%ROWTYPE; ref duplicate_order_private.request_reference%ROWTYPE;
 k text; prior public.transactions%ROWTYPE; detail jsonb; prior_by uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(72401,1);
 IF public.inv_role() NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Permission denied'; END IF;
 SELECT * INTO STRICT t FROM public.transactions WHERE id=p_request;
 SELECT * INTO STRICT ref FROM duplicate_order_private.request_reference WHERE request_id=p_request AND recorded_by=inventory_identity.current_uid();
 IF t.created_by IS DISTINCT FROM inventory_identity.current_uid() THEN RAISE EXCEPTION 'Actor mismatch'; END IF;
 IF t.category='ซ่อมและอื่นๆ' THEN RETURN; END IF;
 SELECT * INTO STRICT p FROM duplicate_order_private.model_policy WHERE model_id=t.model_id AND recorded_category=t.category;
 IF (ref.work_mode='bundled_package') IS DISTINCT FROM (p.work_kind='supplemental') THEN RAISE EXCEPTION 'Reviewed model role required'; END IF;
 k:=duplicate_order_private.reference_key(t.order_ref);
 IF k IS NULL THEN RAISE EXCEPTION 'Order reference required'; END IF;
 SELECT tx.* INTO prior FROM duplicate_order_private.request_identity i JOIN public.transactions tx ON tx.id=i.request_id
  WHERE i.model_id=t.model_id AND i.reference_key=k AND i.request_id<>t.id
  AND NOT EXISTS(SELECT 1 FROM public.inventory_cancellations c WHERE c.transaction_id=i.request_id)
  ORDER BY tx.created_at,tx.id LIMIT 1;
 IF FOUND THEN
  detail:=jsonb_build_object('previous_order_ref',prior.order_ref,'issued_at',prior.created_at,
   'issuer_name',CASE WHEN public.inv_role()='admin' OR prior.created_by=inventory_identity.current_uid() THEN prior.staff_name ELSE NULL END);
  RAISE EXCEPTION 'DUPLICATE_ORDER_ISSUED' USING ERRCODE='P0001',DETAIL=detail::text;
 END IF;
 INSERT INTO duplicate_order_private.request_identity(request_id,parent_category,reference_key,work_kind,primary_request_id,recorded_by,relationship_basis,model_id)
 VALUES(t.id,p.parent_category,k,p.work_kind,NULL,inventory_identity.current_uid(),'new_order_key',t.model_id);
END $$;

CREATE OR REPLACE FUNCTION duplicate_order_private.register_request(p_request uuid, p_primary uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'Legacy request path disabled; use create_request_v2'; END $$;

CREATE OR REPLACE FUNCTION duplicate_order_private.claim_issues(p_operation uuid, p_lines jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE tid uuid; t public.transactions%ROWTYPE; ident duplicate_order_private.request_identity%ROWTYPE;
 prior duplicate_order_private.issued_identity%ROWTYPE; detail jsonb;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(72401,1);
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Issue requires read committed isolation'; END IF;
 IF inventory_identity.current_uid() IS NULL OR coalesce(public.inv_role(),'') NOT IN ('admin','staff')
 OR NOT EXISTS(SELECT 1 FROM public.inventory_operations WHERE id=p_operation AND actor_id=inventory_identity.current_uid() AND kind IN ('create_request','confirm_pick') AND result IS NULL)
 THEN RAISE EXCEPTION 'Unauthorized issue operation'; END IF;
 FOR tid IN SELECT DISTINCT (x->>'transaction_id')::uuid FROM jsonb_array_elements(p_lines) x ORDER BY 1 LOOP
  SELECT * INTO STRICT t FROM public.transactions WHERE id=tid;
  IF t.category='ซ่อมและอื่นๆ' THEN CONTINUE; END IF;
  SELECT * INTO ident FROM duplicate_order_private.request_identity WHERE request_id=tid;
  IF NOT FOUND THEN RAISE EXCEPTION 'DUPLICATE_POLICY_REVIEW_REQUIRED'; END IF;
  IF ident.reference_key IS DISTINCT FROM duplicate_order_private.reference_key(t.order_ref) OR ident.model_id IS DISTINCT FROM t.model_id THEN RAISE EXCEPTION 'Request identity drift'; END IF;
  IF NOT EXISTS(SELECT 1 FROM duplicate_order_private.model_policy p WHERE p.model_id=t.model_id AND p.recorded_category=t.category AND p.work_kind=ident.work_kind)
  THEN RAISE EXCEPTION 'Recorded category/policy drift'; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_cancellations WHERE transaction_id=tid) THEN RAISE EXCEPTION 'Request cancelled'; END IF;
  IF EXISTS(SELECT 1 FROM duplicate_order_private.issued_identity WHERE request_id=tid AND released_operation_id IS NULL) THEN CONTINUE; END IF;
  SELECT * INTO prior FROM duplicate_order_private.issued_identity WHERE released_operation_id IS NULL AND model_id=ident.model_id AND reference_key=ident.reference_key AND request_id<>tid ORDER BY issued_at,request_id LIMIT 1;
  IF FOUND THEN
   SELECT jsonb_build_object('previous_order_ref',tx.order_ref,'issued_at',prior.issued_at,
    'issuer_name',CASE WHEN public.inv_role()='admin' OR prior.issuer_id=inventory_identity.current_uid() THEN pr.full_name ELSE NULL END)
   INTO detail FROM public.transactions tx LEFT JOIN public.profiles pr ON pr.id=prior.issuer_id WHERE tx.id=prior.request_id;
   RAISE EXCEPTION 'DUPLICATE_ORDER_ISSUED' USING ERRCODE='P0001',DETAIL=detail::text;
  END IF;
  INSERT INTO duplicate_order_private.issued_identity(request_id,parent_category,reference_key,work_kind,operation_id,issued_at,issuer_id,model_id)
  VALUES(tid,ident.parent_category,ident.reference_key,ident.work_kind,p_operation,clock_timestamp(),inventory_identity.current_uid(),ident.model_id);
 END LOOP;
END $$;

-- 4. Package/Driver + prefix settings for any model ------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_set_model_prefix(p_operation_id uuid, p_model_id uuid, p_prefix text, p_expected_revision bigint, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE replay jsonb; old_revision bigint; old_prefix text;
BEGIN
 replay:=public.inv_begin(p_operation_id,'set_model_prefix',jsonb_build_object('model',p_model_id,'prefix',p_prefix,'expected_revision',p_expected_revision,'reason',p_reason),ARRAY['admin']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 IF p_prefix IS NULL OR p_prefix NOT IN ('','Z','ZG','PL','PN') OR nullif(btrim(p_reason),'') IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.models WHERE id=p_model_id AND is_active) THEN RAISE EXCEPTION 'Invalid prefix configuration'; END IF;
 SELECT prefix,revision INTO old_prefix,old_revision FROM duplicate_order_private.model_prefix WHERE model_id=p_model_id FOR UPDATE;
 IF p_expected_revision IS DISTINCT FROM coalesce(old_revision,0) THEN RAISE EXCEPTION 'Prefix revision conflict'; END IF;
 INSERT INTO duplicate_order_private.model_prefix VALUES(p_model_id,p_prefix,coalesce(old_revision,0)+1)
 ON CONFLICT(model_id) DO UPDATE SET prefix=EXCLUDED.prefix,revision=EXCLUDED.revision;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('model_id',p_model_id,'prefix',p_prefix,'previous_prefix',old_prefix,'revision',coalesce(old_revision,0)+1));
END $$;

CREATE FUNCTION public.inventory_set_model_settings(p_operation_id uuid, p_model_id uuid, p_prefix text, p_is_package boolean, p_expected_revision bigint, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE replay jsonb; md public.models%ROWTYPE; old_revision bigint; old_prefix text; old_kind text; new_kind text; new_revision bigint;
BEGIN
 replay:=public.inv_begin(p_operation_id,'set_model_settings',jsonb_build_object('model',p_model_id,'prefix',p_prefix,'is_package',p_is_package,'expected_revision',p_expected_revision,'reason',p_reason),ARRAY['admin']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 IF p_prefix IS NULL OR p_prefix NOT IN ('','Z','ZG','PL','PN') OR p_is_package IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Invalid model settings'; END IF;
 SELECT * INTO md FROM public.models WHERE id=p_model_id AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid model settings'; END IF;
 SELECT prefix,revision INTO old_prefix,old_revision FROM duplicate_order_private.model_prefix WHERE model_id=p_model_id FOR UPDATE;
 IF p_expected_revision IS DISTINCT FROM coalesce(old_revision,0) THEN RAISE EXCEPTION 'Prefix revision conflict'; END IF;
 SELECT work_kind INTO old_kind FROM duplicate_order_private.model_policy WHERE model_id=p_model_id;
 new_kind:=CASE WHEN p_is_package THEN 'supplemental' ELSE 'primary' END;
 IF new_kind IS DISTINCT FROM coalesce(old_kind,'primary') AND EXISTS(
   SELECT 1 FROM duplicate_order_private.request_identity ri JOIN public.transactions t ON t.id=ri.request_id
   WHERE ri.model_id=p_model_id AND NOT EXISTS(SELECT 1 FROM public.inventory_cancellations c WHERE c.transaction_id=t.id)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.bom_snapshot) l WHERE NOT coalesce((l->>'picked')::boolean,false)))
 THEN RAISE EXCEPTION 'Model has pending requests; finish or cancel them before changing Package/Driver'; END IF;
 INSERT INTO duplicate_order_private.model_policy(model_id,recorded_category,parent_category,work_kind) VALUES(p_model_id,md.category,md.category,new_kind)
 ON CONFLICT(model_id) DO UPDATE SET work_kind=EXCLUDED.work_kind,recorded_category=EXCLUDED.recorded_category,parent_category=EXCLUDED.parent_category;
 new_revision:=coalesce(old_revision,0);
 IF old_prefix IS DISTINCT FROM p_prefix OR old_revision IS NULL THEN
  new_revision:=new_revision+1;
  INSERT INTO duplicate_order_private.model_prefix VALUES(p_model_id,p_prefix,new_revision)
  ON CONFLICT(model_id) DO UPDATE SET prefix=EXCLUDED.prefix,revision=EXCLUDED.revision;
 END IF;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('model_id',p_model_id,'prefix',p_prefix,'is_package',p_is_package,'previous_prefix',old_prefix,'revision',new_revision));
END $$;
REVOKE ALL ON FUNCTION public.inventory_set_model_settings(uuid,uuid,text,boolean,bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_set_model_settings(uuid,uuid,text,boolean,bigint,text) TO authenticated;

-- 5. create_request_v2: any Package model, prefix for any model, auto-deduct at request --------
CREATE OR REPLACE FUNCTION public.inventory_create_request_v2(p_operation_id uuid, p_model_id uuid, p_order_ref text, p_repair_spec jsonb, p_work_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE raw_input text:=coalesce(p_order_ref,''); selected_prefix text; prefix_version bigint; replay jsonb; md public.models%ROWTYPE; bom jsonb; snapshot jsonb:='[]'::jsonb;
 b record; m public.materials%ROWTYPE; tid uuid:=gen_random_uuid(); lname text; cat text;
 staff text; note text; lines jsonb; all_auto boolean:=true; line_uuid uuid;
BEGIN
 replay:=public.inv_begin(p_operation_id,'create_request',jsonb_build_object('model_id',p_model_id,'order_ref',raw_input,'repair',p_repair_spec,'work_mode',p_work_mode),ARRAY['admin','staff']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 IF p_work_mode IS NULL OR p_work_mode NOT IN ('standard','bundled_package','standalone_package') THEN RAISE EXCEPTION 'Invalid work mode'; END IF;
 IF p_model_id IS NULL AND p_work_mode<>'standard' THEN RAISE EXCEPTION 'Repair mode required'; END IF;
 p_order_ref:=btrim(raw_input);
 IF nullif(btrim(p_order_ref),'') IS NULL AND EXISTS(SELECT 1 FROM public.models WHERE id=p_model_id AND category='Universal' AND is_active) THEN p_order_ref:='UV-'||tid::text; END IF;
 IF p_model_id IS NOT NULL AND length(p_order_ref)=0 THEN RAISE EXCEPTION 'Order reference required'; END IF;
 SELECT full_name INTO staff FROM public.profiles WHERE id=inventory_identity.current_uid();
 IF length(btrim(coalesce(staff,'')))=0 THEN RAISE EXCEPTION 'Profile name required'; END IF;
 IF p_model_id IS NOT NULL THEN
   IF p_repair_spec IS NOT NULL THEN RAISE EXCEPTION 'Choose model or repair mode'; END IF;
   SELECT * INTO STRICT md FROM public.models WHERE id=p_model_id FOR SHARE;
   IF NOT md.is_active THEN RAISE EXCEPTION 'Model inactive'; END IF;
   lname:=md.name; cat:=md.category; note:='';
   IF p_work_mode IN ('bundled_package','standalone_package') THEN
    IF NOT EXISTS(SELECT 1 FROM duplicate_order_private.model_policy WHERE model_id=md.id AND recorded_category=md.category AND work_kind='supplemental') THEN RAISE EXCEPTION 'Reviewed Package model required'; END IF;
    IF p_order_ref !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Numeric order input required'; END IF;
    IF p_work_mode='standalone_package' THEN cat:='ซ่อมและอื่นๆ';note:='Standalone Package sale / Others'; END IF;
   ELSIF EXISTS(SELECT 1 FROM duplicate_order_private.model_policy WHERE model_id=md.id AND work_kind='supplemental') THEN RAISE EXCEPTION 'Package work mode required';
   END IF;
   IF p_work_mode='standard' THEN
    SELECT prefix,revision INTO selected_prefix,prefix_version FROM duplicate_order_private.model_prefix WHERE model_id=md.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'MODEL_PREFIX_REQUIRED'; END IF;
    IF selected_prefix<>'' OR md.category IN ('Sleepplug','Lifestyle') THEN
     IF p_order_ref !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Numeric order input required'; END IF;
     p_order_ref:=selected_prefix||p_order_ref;
    END IF;
   END IF;
   SELECT coalesce(jsonb_agg(jsonb_build_object('material_id',material_id,'qty',qty)),'[]'::jsonb) INTO bom FROM public.model_bom WHERE model_id=md.id;
 ELSE
   IF jsonb_typeof(p_repair_spec) IS DISTINCT FROM 'object' OR jsonb_typeof(p_repair_spec->'bom') IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'Repair specification with BOM array required'; END IF;
   lname:=p_repair_spec->>'subtype'; cat:='ซ่อมและอื่นๆ'; note:=p_repair_spec->>'note';
   IF lname IS NULL OR lname NOT IN ('CIEM','Tactical','Lifestyle','Sleepplug','อื่นๆ') OR length(btrim(coalesce(note,'')))=0 THEN RAISE EXCEPTION 'Invalid repair subtype/reason'; END IF;
   bom:=p_repair_spec->'bom';
 END IF;
 IF cat IS NULL OR cat NOT IN ('CIEM','Lifestyle','Sleepplug','Tactical','ซ่อมและอื่นๆ') THEN RAISE EXCEPTION 'Unsupported request category'; END IF;
 IF cat='ซ่อมและอื่นๆ' AND length(btrim(coalesce(note,'')))=0 THEN RAISE EXCEPTION 'Repair requests require a nonblank reason; use repair mode'; END IF;
 IF jsonb_array_length(bom)=0 THEN RAISE EXCEPTION 'Empty BOM not enabled; record non-material work outside inventory'; END IF;
 FOR b IN SELECT x FROM jsonb_array_elements(bom) x LOOP
   IF jsonb_typeof(b.x) IS DISTINCT FROM 'object' OR b.x->>'material_id' IS NULL THEN RAISE EXCEPTION 'Malformed BOM'; END IF;
   PERFORM (b.x->>'material_id')::uuid; PERFORM public.inv_number((b.x->>'qty')::numeric,true);
 END LOOP;
 PERFORM m0.id FROM public.materials m0 WHERE m0.id IN (SELECT (x->>'material_id')::uuid FROM jsonb_array_elements(bom) x) ORDER BY m0.id FOR UPDATE;
 FOR b IN SELECT (x->>'material_id')::uuid AS id,sum((x->>'qty')::numeric) qty FROM jsonb_array_elements(bom) x GROUP BY (x->>'material_id')::uuid ORDER BY 1 LOOP
   SELECT * INTO m FROM public.materials WHERE id=b.id;
   IF NOT FOUND OR NOT m.is_active THEN RAISE EXCEPTION 'Inactive or missing BOM material %',b.id; END IF;
   PERFORM public.inv_number(b.qty,true);
   line_uuid:=gen_random_uuid();
   snapshot:=snapshot||jsonb_build_array(jsonb_build_object('line_id',line_uuid,'material_id',m.id,'material_name',m.name,'unit',m.unit,'qty',b.qty,
     'requires_picking',m.requires_picking,'picked',false,'received',false));
   all_auto:=all_auto AND NOT m.requires_picking;
 END LOOP;
 INSERT INTO public.transactions(id,model_id,model_name,category,order_ref,staff_name,created_by,created_at,bom_snapshot,note,inventory_version)
 VALUES(tid,p_model_id,lname,cat,btrim(p_order_ref),staff,inventory_identity.current_uid(),clock_timestamp(),snapshot,note,1);
 INSERT INTO duplicate_order_private.request_reference(request_id,raw_input,canonical_reference,prefix_revision,work_mode,recorded_by)
 VALUES(tid,raw_input,nullif(p_order_ref,''),prefix_version,p_work_mode,inventory_identity.current_uid());
 PERFORM duplicate_order_private.register_new_request(tid);
 -- Materials set to "no picking" are deducted right away; the head still picks the rest.
 SELECT coalesce(jsonb_agg(jsonb_build_object('transaction_id',tid,'line_id',(x.s->>'line_id')::uuid,'material_id',x.s->>'material_id','qty',x.s->'qty') ORDER BY x.ord),'[]'::jsonb)
 INTO lines FROM jsonb_array_elements(snapshot) WITH ORDINALITY x(s,ord) WHERE NOT coalesce((x.s->>'requires_picking')::boolean,true);
 IF jsonb_array_length(lines)>0 THEN PERFORM public.inv_issue_lines(p_operation_id,lines); END IF;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('transaction_id',tid,'completed',all_auto,
   'bom_snapshot',(SELECT bom_snapshot FROM public.transactions WHERE id=tid)));
END $$;

-- 6. Cancel: owner may still cancel when only auto-deducted lines were issued ------------------
CREATE OR REPLACE FUNCTION public.inventory_cancel_request(p_operation_id uuid, p_transaction_id uuid, p_reason text, p_legacy_return_verified boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE replay jsonb; t public.transactions%ROWTYPE; r text; ctl public.inventory_control%ROWTYPE;
 lines jsonb:='[]'::jsonb; b record; g record; l jsonb; movement uuid; q numeric; lid uuid;
 has_issue_evidence boolean; manual_issue_evidence boolean;
BEGIN
 replay:=public.inv_begin(p_operation_id,'cancel_request',jsonb_build_object('id',p_transaction_id,'reason',p_reason,'legacy_verified',p_legacy_return_verified),ARRAY['admin','staff']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 r:=public.inv_role(); SELECT * INTO STRICT ctl FROM public.inventory_control;
 SELECT * INTO STRICT t FROM public.transactions WHERE id=p_transaction_id FOR UPDATE;
 IF r<>'admin' AND t.created_by IS DISTINCT FROM inventory_identity.current_uid() THEN RAISE EXCEPTION 'Not request owner'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.inventory_movement_allocations a WHERE a.transaction_id=t.id)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(t.bom_snapshot) line WHERE coalesce((line->>'picked')::boolean,false))
 INTO has_issue_evidence;
 -- Only head-picked lines count against owner cancellation; auto-deducted lines are returned on cancel.
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(t.bom_snapshot) WITH ORDINALITY s(line,ord)
   WHERE coalesce((s.line->>'requires_picking')::boolean,true)
   AND (coalesce((s.line->>'picked')::boolean,false)
     OR EXISTS(SELECT 1 FROM public.inventory_movement_allocations a WHERE a.transaction_id=t.id AND a.line_id=public.inv_line_id(t.id,s.line,s.ord))))
 INTO manual_issue_evidence;
 IF r<>'admin' AND manual_issue_evidence THEN RAISE EXCEPTION 'Only admin may cancel a request after any stock issue/allocation'; END IF;
 IF r<>'admin' AND ctl.cancellation_window_seconds>=0 AND clock_timestamp()>t.created_at+pg_catalog.make_interval(secs=>ctl.cancellation_window_seconds)
 THEN RAISE EXCEPTION 'Owner cancellation window expired'; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_cancellations WHERE transaction_id=t.id) THEN RETURN public.inv_finish(p_operation_id,jsonb_build_object('already_cancelled',true)); END IF;
 IF length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'Cancellation reason required'; END IF;
 IF t.inventory_version=0 AND has_issue_evidence AND (ctl.legacy_return_mode<>'admin_verified' OR r<>'admin' OR NOT coalesce(p_legacy_return_verified,false))
 THEN RAISE EXCEPTION 'Legacy return requires approved mode and administrator physical-return verification'; END IF;
 FOR b IN SELECT b0.line,b0.ord FROM jsonb_array_elements(t.bom_snapshot) WITH ORDINALITY b0(line,ord) LOOP
   lid:=public.inv_line_id(t.id,b.line,b.ord);
   IF t.inventory_version=0 THEN
     q:=CASE WHEN coalesce((b.line->>'picked')::boolean,false) THEN (b.line->>'qty')::numeric ELSE 0 END;
   ELSE
     SELECT -coalesce(sum(a.delta),0) INTO q FROM public.inventory_movement_allocations a WHERE a.transaction_id=t.id AND a.line_id=lid;
     IF q<0 THEN RAISE EXCEPTION 'Return ledger inconsistent'; END IF;
   END IF;
   IF q>0 THEN
     PERFORM public.inv_number(q,true);
     lines:=lines||jsonb_build_array(jsonb_build_object('line_id',lid,'material_id',b.line->>'material_id','qty',q));
   END IF;
 END LOOP;
 IF jsonb_array_length(lines)>0 AND t.inventory_version=1 AND manual_issue_evidence THEN p_reason:=p_reason||' [ACCOUNTING_RESTORATION_NOT_PHYSICALLY_VERIFIED]'; END IF;
 PERFORM m.id FROM public.materials m WHERE m.id IN (SELECT (x->>'material_id')::uuid FROM jsonb_array_elements(lines) x) ORDER BY m.id FOR UPDATE;
 FOR g IN SELECT (x->>'material_id')::uuid id,sum((x->>'qty')::numeric) qty FROM jsonb_array_elements(lines) x GROUP BY (x->>'material_id')::uuid ORDER BY 1 LOOP
   movement:=public.inv_move(p_operation_id,g.id,g.qty,'cancellation_return',t.order_ref,p_reason);
   FOR l IN SELECT x FROM jsonb_array_elements(lines) x WHERE (x->>'material_id')::uuid=g.id LOOP
     INSERT INTO public.inventory_movement_allocations(movement_id,transaction_id,line_id,order_ref,delta,legacy_verified)
     VALUES(movement,t.id,(l->>'line_id')::uuid,t.order_ref,(l->>'qty')::numeric,t.inventory_version=0);
   END LOOP;
 END LOOP;
 IF t.category='Universal' AND EXISTS(SELECT 1 FROM public.inventory_finished_movements WHERE packing_request_id=t.id AND kind='pack_in') THEN PERFORM public.inv_finished_move(p_operation_id,t.id,'pack_cancel',t.order_ref,p_reason); END IF;
 INSERT INTO public.inventory_cancellations(transaction_id,operation_id,actor_id,cancelled_at,reason,legacy_verified)
 VALUES(t.id,p_operation_id,inventory_identity.current_uid(),clock_timestamp(),p_reason,t.inventory_version=0 AND has_issue_evidence AND coalesce(p_legacy_return_verified,false));
 UPDATE duplicate_order_private.issued_identity SET released_operation_id=p_operation_id WHERE request_id=t.id AND released_operation_id IS NULL;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('transaction_id',t.id,'cancelled',true));
END $$;
