CREATE TABLE public.store_sale_channels(
 code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,32}$'),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 30),
 color text NOT NULL DEFAULT 'gray' CHECK (color IN ('red','blue','amber','green','purple','gray')),
 pattern text,
 spec jsonb,
 example text,
 active boolean NOT NULL DEFAULT true,
 is_system boolean NOT NULL DEFAULT false,
 position integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by uuid
);
CREATE UNIQUE INDEX store_sale_channels_name_uq ON public.store_sale_channels (lower(btrim(name)));
ALTER TABLE public.store_sale_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY executor_all ON public.store_sale_channels FOR ALL TO inventory_executor USING (true) WITH CHECK (true);
REVOKE ALL ON public.store_sale_channels FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_sale_channels TO inventory_executor;

INSERT INTO public.store_sale_channels(code,name,color,pattern,spec,example,is_system,position) VALUES
('tiktok','TikTok','red','^[0-9]{18}$','{"prefix":"","digits":18,"with_date":false,"with_seq":false}','587229145958089832',false,0),
('shipnity','Shipnity','blue','^RE[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])-[1-9][0-9]{0,3}$','{"prefix":"RE","digits":6,"with_date":true,"with_seq":true}','RE261118-3',false,1),
('other','อื่นๆ','amber',NULL,NULL,'ช่องทางอื่น พิมพ์เลขอะไรก็ได้',true,99);

ALTER TABLE public.store_sales ADD COLUMN channel_code text REFERENCES public.store_sale_channels(code);
CREATE INDEX store_sales_channel_idx ON public.store_sales(channel_code);

ALTER TABLE public.inventory_operations DROP CONSTRAINT inventory_operations_kind_check;
ALTER TABLE public.inventory_operations ADD CONSTRAINT inventory_operations_kind_check CHECK ((kind = ANY (ARRAY['create_material','update_material','archive_material','create_request','confirm_pick','cancel_request','purchase','stocktake','baseline','save_model','set_model_active','set_model_prefix','set_model_settings','finished_out','store_transfer','store_sale','store_sale_add','store_sale_cancel','store_adjust','store_sale_tag','store_pin','store_return','store_min','feedback','feedback_resolve','store_order','store_channel'])));

GRANT inventory_executor TO postgres WITH SET TRUE, INHERIT FALSE;
GRANT CREATE ON SCHEMA public TO inventory_executor;
SET LOCAL ROLE inventory_executor;

CREATE FUNCTION public.inv_store_channel_for(p_tag text)
 RETURNS text LANGUAGE sql STABLE SET search_path TO ''
AS $f$ SELECT c.code FROM public.store_sale_channels c WHERE c.active AND c.pattern IS NOT NULL AND upper(btrim(p_tag)) ~ c.pattern ORDER BY c.position, c.code LIMIT 1 $f$;
REVOKE ALL ON FUNCTION public.inv_store_channel_for(text) FROM PUBLIC;

UPDATE public.store_sales SET channel_code = coalesce(public.inv_store_channel_for(tag),'other') WHERE tag IS NOT NULL;

DROP FUNCTION public.inventory_store_create_sale(uuid,text,jsonb,text);
DROP FUNCTION public.inventory_store_set_sale_tag(uuid,uuid,text);

CREATE FUNCTION public.inventory_store_create_sale(p_operation_id uuid, p_tag text, p_lines jsonb, p_reason text DEFAULT NULL::text, p_other boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_replay jsonb; v_tag text:=nullif(btrim(coalesce(p_tag,'')),''); v_key text; v_sale uuid:=gen_random_uuid(); v_name text; dup public.store_sales%ROWTYPE;
 v_reason text:=nullif(btrim(coalesce(p_reason,'')),''); v_ch text;
BEGIN
 v_replay:=public.inv_begin(p_operation_id,'store_sale',jsonb_build_object('tag',p_tag,'lines',p_lines)||CASE WHEN p_reason IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('reason',p_reason) END||CASE WHEN coalesce(p_other,false) THEN jsonb_build_object('other',true) ELSE '{}'::jsonb END,ARRAY['admin','store']);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 IF v_reason IS NULL AND EXISTS (SELECT 1 FROM public.inv_store_sale_lines(p_lines) t WHERE t.source='main') THEN RAISE EXCEPTION 'SALE_REASON_REQUIRED'; END IF;
 IF v_tag IS NOT NULL THEN
  IF length(v_tag) NOT BETWEEN 3 AND 64 THEN RAISE EXCEPTION 'SALE_TAG_REQUIRED'; END IF;
  v_key:=upper(regexp_replace(v_tag,'[\s\-_/.]','','g'));
  IF length(v_key)<3 THEN RAISE EXCEPTION 'SALE_TAG_REQUIRED'; END IF;
  v_ch:=public.inv_store_channel_for(v_tag);
  IF v_ch IS NULL THEN
   IF coalesce(p_other,false) THEN v_ch:='other'; ELSE RAISE EXCEPTION 'TAG_CHANNEL_MISMATCH'; END IF;
  END IF;
  SELECT * INTO dup FROM public.store_sales WHERE tag_key=v_key AND status='active';
  IF FOUND THEN RAISE EXCEPTION 'DUPLICATE_SALE_TAG' USING DETAIL=jsonb_build_object('tag',dup.tag,'sale_id',dup.id,'seller_name',dup.seller_name,'created_at',dup.created_at)::text; END IF;
 END IF;
 SELECT coalesce(nullif(btrim(p.full_name),''),p.username) INTO v_name FROM public.profiles p WHERE p.id=inventory_identity.current_uid();
 INSERT INTO public.store_sales(id,tag,tag_key,channel_code,seller_id,seller_name,created_at,created_op)
 VALUES(v_sale,v_tag,v_key,v_ch,inventory_identity.current_uid(),v_name,clock_timestamp(),p_operation_id);
 PERFORM public.inv_store_sale_apply(p_operation_id,v_sale,v_tag,p_lines,NULL);
 IF v_reason IS NOT NULL THEN UPDATE public.store_sale_lines SET reason=v_reason WHERE sale_id=v_sale AND added_op=p_operation_id AND source='main'; END IF;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('sale_id',v_sale,'tag',v_tag));
END $function$;

CREATE FUNCTION public.inventory_store_set_sale_tag(p_operation_id uuid, p_sale_id uuid, p_tag text, p_other boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_replay jsonb; s public.store_sales%ROWTYPE; v_tag text:=btrim(coalesce(p_tag,'')); v_key text; dup public.store_sales%ROWTYPE; v_ch text;
BEGIN
 v_replay:=public.inv_begin(p_operation_id,'store_sale_tag',jsonb_build_object('sale_id',p_sale_id,'tag',p_tag)||CASE WHEN coalesce(p_other,false) THEN jsonb_build_object('other',true) ELSE '{}'::jsonb END,ARRAY['admin','store']);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 SELECT * INTO s FROM public.store_sales WHERE id=p_sale_id FOR UPDATE;
 IF NOT FOUND OR s.status<>'active' THEN RAISE EXCEPTION 'Sale not found or cancelled'; END IF;
 IF public.inv_role()='store' AND s.seller_id<>inventory_identity.current_uid() THEN RAISE EXCEPTION 'Permission denied'; END IF;
 IF s.tag IS NOT NULL THEN RAISE EXCEPTION 'SALE_TAG_ALREADY_SET'; END IF;
 IF length(v_tag) NOT BETWEEN 3 AND 64 THEN RAISE EXCEPTION 'SALE_TAG_REQUIRED'; END IF;
 v_key:=upper(regexp_replace(v_tag,'[\s\-_/.]','','g'));
 IF length(v_key)<3 THEN RAISE EXCEPTION 'SALE_TAG_REQUIRED'; END IF;
 v_ch:=public.inv_store_channel_for(v_tag);
 IF v_ch IS NULL THEN
  IF coalesce(p_other,false) THEN v_ch:='other'; ELSE RAISE EXCEPTION 'TAG_CHANNEL_MISMATCH'; END IF;
 END IF;
 SELECT * INTO dup FROM public.store_sales WHERE tag_key=v_key AND status='active';
 IF FOUND THEN RAISE EXCEPTION 'DUPLICATE_SALE_TAG' USING DETAIL=jsonb_build_object('tag',dup.tag,'sale_id',dup.id,'seller_name',dup.seller_name,'created_at',dup.created_at)::text; END IF;
 UPDATE public.store_sales SET tag=v_tag,tag_key=v_key,channel_code=v_ch WHERE id=s.id;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('sale_id',s.id,'tag',v_tag));
END $function$;

CREATE OR REPLACE FUNCTION public.inventory_store_list_sales(p_date_from date, p_date_to date, p_timezone text DEFAULT 'Asia/Bangkok'::text, p_limit integer DEFAULT 300)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE r jsonb; a timestamptz; b timestamptz;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','store','purchasing']);
 IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to<p_date_from OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Invalid date range/timezone'; END IF;
 a:=p_date_from::timestamp AT TIME ZONE p_timezone; b:=(p_date_to+1)::timestamp AT TIME ZONE p_timezone;
 SELECT coalesce(jsonb_agg(x ORDER BY (x->>'created_at') DESC),'[]'::jsonb) INTO r FROM (
  SELECT jsonb_build_object('sale_id',s.id,'tag',s.tag,'status',s.status,'seller_id',s.seller_id,'seller_name',s.seller_name,'created_at',s.created_at,
    'cancelled_at',s.cancelled_at,'cancel_reason',s.cancel_reason,'pending',(s.status='active' AND s.tag IS NULL),
    'channel_code',s.channel_code,'channel_name',c.name,'channel_color',c.color,
    'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('item_kind',l.item_kind,'item_id',l.item_id,'name',l.item_name,'unit',l.unit,'qty',l.qty,'source',l.source,'reason',l.reason) ORDER BY l.added_at,l.item_name),'[]'::jsonb) FROM public.store_sale_lines l WHERE l.sale_id=s.id)) x
  FROM public.store_sales s LEFT JOIN public.store_sale_channels c ON c.code=s.channel_code WHERE (s.created_at>=a AND s.created_at<b) OR (s.status='active' AND s.tag IS NULL) ORDER BY s.created_at DESC LIMIT least(greatest(coalesce(p_limit,300),1),1000)) q;
 RETURN r;
END $function$;

CREATE OR REPLACE FUNCTION public.inventory_store_report(p_date_from date, p_date_to date, p_timezone text DEFAULT 'Asia/Bangkok'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE r jsonb; ms jsonb; pn jsonb; ch jsonb; a timestamptz; b timestamptz;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','purchasing','store']);
 IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to<p_date_from OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Invalid date range/timezone'; END IF;
 a:=p_date_from::timestamp AT TIME ZONE p_timezone; b:=(p_date_to+1)::timestamp AT TIME ZONE p_timezone;
 WITH agg AS (
  SELECT v.item_kind,v.item_id,
   (array_agg(v.item_name ORDER BY v.sequence_no DESC))[1] AS name,(array_agg(v.unit ORDER BY v.sequence_no DESC))[1] AS unit,
   coalesce(sum(v.delta) FILTER(WHERE v.occurred_at<a),0) AS opening,
   coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=a AND v.occurred_at<b AND v.kind='transfer_in'),0) AS transfer_in,
   -coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=a AND v.occurred_at<b AND v.kind='transfer_out'),0) AS transfer_out,
   -coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=a AND v.occurred_at<b AND v.kind='sale'),0) AS sold,
   coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=a AND v.occurred_at<b AND v.kind='sale_cancel'),0) AS sale_cancelled,
   coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=a AND v.occurred_at<b AND v.kind='adjust_in'),0) AS adjust_in,
   -coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=a AND v.occurred_at<b AND v.kind='adjust_out'),0) AS adjust_out
  FROM public.store_movements v WHERE v.occurred_at<b GROUP BY v.item_kind,v.item_id),
 rows AS (SELECT item_kind,item_id,name,unit,opening,transfer_in,transfer_out,sold,sale_cancelled,adjust_in,adjust_out,
   opening+transfer_in-transfer_out-sold+sale_cancelled+adjust_in-adjust_out AS closing FROM agg)
 SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY item_kind DESC,name),'[]'::jsonb) INTO r FROM rows;
 SELECT coalesce(jsonb_agg(jsonb_build_object('material_id',x.item_id,'name',x.item_name,'unit',x.unit,'qty',x.qty) ORDER BY x.item_name),'[]'::jsonb) INTO ms
  FROM (SELECT l.item_id,(array_agg(l.item_name ORDER BY l.added_at DESC))[1] AS item_name,(array_agg(l.unit ORDER BY l.added_at DESC))[1] AS unit,sum(l.qty) AS qty
        FROM public.store_sale_lines l JOIN public.store_sales s ON s.id=l.sale_id
        WHERE l.source='main' AND s.status='active' AND l.added_at>=a AND l.added_at<b GROUP BY l.item_id) x;
 SELECT coalesce(jsonb_agg(jsonb_build_object('sale_id',s.id,'created_at',s.created_at,'seller_name',s.seller_name,
   'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',l.item_name,'qty',l.qty,'unit',l.unit,'source',l.source) ORDER BY l.item_name),'[]'::jsonb) FROM public.store_sale_lines l WHERE l.sale_id=s.id)) ORDER BY s.created_at),'[]'::jsonb) INTO pn
  FROM public.store_sales s WHERE s.status='active' AND s.tag IS NULL;
 WITH ln AS (SELECT s.channel_code AS code, s.id AS sid, l.item_name AS nm, l.qty AS q
   FROM public.store_sales s JOIN public.store_sale_lines l ON l.sale_id=s.id
   WHERE s.status='active' AND s.channel_code IS NOT NULL AND s.created_at>=a AND s.created_at<b),
  byitem AS (SELECT code,nm,sum(q) AS q FROM ln GROUP BY code,nm),
  t AS (SELECT bi.code, (SELECT count(DISTINCT l2.sid) FROM ln l2 WHERE l2.code=bi.code) AS orders, sum(bi.q) AS units,
         jsonb_agg(jsonb_build_object('name',bi.nm,'qty',bi.q) ORDER BY bi.q DESC,bi.nm) AS items FROM byitem bi GROUP BY bi.code)
 SELECT coalesce(jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'color',c.color,'active',c.active,'orders',coalesce(t.orders,0),'units',coalesce(t.units,0),'items',coalesce(t.items,'[]'::jsonb)) ORDER BY c.position,c.code),'[]'::jsonb) INTO ch
  FROM public.store_sale_channels c LEFT JOIN t ON t.code=c.code WHERE c.active OR t.orders>0;
 RETURN jsonb_build_object('from',a,'to_exclusive',b,'timezone',p_timezone,'items',r,'main_sales',ms,'pending',pn,'channels',ch);
END $function$;

CREATE FUNCTION public.inventory_store_list_channels()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
BEGIN
 PERFORM public.inv_read(ARRAY['admin','store','purchasing']);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'color',c.color,'pattern',c.pattern,'spec',c.spec,'example',c.example,'active',c.active,'is_system',c.is_system,'position',c.position,
   'used',(SELECT count(*) FROM public.store_sales s WHERE s.channel_code=c.code AND s.status='active')) ORDER BY c.position,c.code) FROM public.store_sale_channels c),'[]'::jsonb);
END $f$;

CREATE FUNCTION public.inventory_store_save_channel(p_operation_id uuid, p_code text, p_name text, p_color text, p_prefix text, p_digits integer, p_with_date boolean, p_with_seq boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE v_replay jsonb; v_name text:=btrim(coalesce(p_name,'')); v_prefix text:=upper(btrim(coalesce(p_prefix,''))); v_digits int:=coalesce(p_digits,0);
 v_date boolean:=coalesce(p_with_date,false); v_seq boolean:=coalesce(p_with_seq,false); v_color text:=coalesce(nullif(btrim(p_color),''),'gray');
 v_pat text; v_ex text; v_code text; v_pos int; v_body text; v_lead text;
BEGIN
 v_replay:=public.inv_begin(p_operation_id,'store_channel',jsonb_build_object('code',p_code,'name',p_name,'color',p_color,'prefix',p_prefix,'digits',p_digits,'with_date',p_with_date,'with_seq',p_with_seq),ARRAY['admin']);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 IF length(v_name) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'CHANNEL_NAME_INVALID'; END IF;
 IF v_color NOT IN ('red','blue','amber','green','purple','gray') THEN RAISE EXCEPTION 'CHANNEL_RULE_INVALID'; END IF;
 IF v_prefix !~ '^[A-Z0-9]{0,8}$' OR (v_seq AND NOT v_date) OR (NOT v_date AND v_digits NOT BETWEEN 1 AND 30) THEN RAISE EXCEPTION 'CHANNEL_RULE_INVALID'; END IF;
 IF p_code IS NOT NULL AND p_code='other' THEN RAISE EXCEPTION 'CHANNEL_SYSTEM'; END IF;
 IF p_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.store_sale_channels WHERE code=p_code) THEN RAISE EXCEPTION 'CHANNEL_NOT_FOUND'; END IF;
 IF EXISTS (SELECT 1 FROM public.store_sale_channels WHERE lower(btrim(name))=lower(v_name) AND code IS DISTINCT FROM p_code) THEN RAISE EXCEPTION 'CHANNEL_NAME_DUPLICATE'; END IF;
 v_lead:=CASE WHEN v_prefix<>'' THEN v_prefix WHEN v_date THEN '[A-Z]{1,3}' ELSE '' END;
 v_body:=CASE WHEN v_date THEN '[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])'||CASE WHEN v_seq THEN '-[0-9]{1,4}' ELSE '' END ELSE '[0-9]{'||v_digits||'}' END;
 v_pat:='^'||v_lead||v_body||'$';
 v_ex:=CASE WHEN v_date THEN coalesce(nullif(v_prefix,''),'AB')||'261118'||CASE WHEN v_seq THEN '-1' ELSE '' END ELSE v_prefix||repeat('1',v_digits) END;
 IF EXISTS (SELECT 1 FROM public.store_sale_channels WHERE pattern=v_pat AND active AND code IS DISTINCT FROM p_code) THEN RAISE EXCEPTION 'CHANNEL_RULE_CONFLICT'; END IF;
 IF EXISTS (SELECT 1 FROM public.store_sales s WHERE s.tag IS NOT NULL AND s.channel_code IS DISTINCT FROM p_code AND upper(btrim(s.tag)) ~ v_pat) THEN RAISE EXCEPTION 'CHANNEL_RULE_CONFLICT'; END IF;
 IF p_code IS NULL THEN
  v_code:='ch_'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
  SELECT coalesce(max(position),0)+1 INTO v_pos FROM public.store_sale_channels WHERE position<90;
  INSERT INTO public.store_sale_channels(code,name,color,pattern,spec,example,position,updated_by)
  VALUES(v_code,v_name,v_color,v_pat,jsonb_build_object('prefix',v_prefix,'digits',v_digits,'with_date',v_date,'with_seq',v_seq),v_ex,v_pos,inventory_identity.current_uid());
 ELSE
  v_code:=p_code;
  UPDATE public.store_sale_channels SET name=v_name,color=v_color,pattern=v_pat,spec=jsonb_build_object('prefix',v_prefix,'digits',v_digits,'with_date',v_date,'with_seq',v_seq),example=v_ex,updated_at=clock_timestamp(),updated_by=inventory_identity.current_uid() WHERE code=v_code;
 END IF;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('code',v_code,'pattern',v_pat));
END $f$;

CREATE FUNCTION public.inventory_store_channel_action(p_operation_id uuid, p_code text, p_action text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE v_replay jsonb; c public.store_sale_channels%ROWTYPE;
BEGIN
 v_replay:=public.inv_begin(p_operation_id,'store_channel',jsonb_build_object('code',p_code,'action',p_action),ARRAY['admin']);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 IF p_action NOT IN ('enable','disable','delete') THEN RAISE EXCEPTION 'CHANNEL_RULE_INVALID'; END IF;
 SELECT * INTO c FROM public.store_sale_channels WHERE code=p_code FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_NOT_FOUND'; END IF;
 IF c.is_system THEN RAISE EXCEPTION 'CHANNEL_SYSTEM'; END IF;
 IF p_action='delete' THEN
  IF EXISTS (SELECT 1 FROM public.store_sales WHERE channel_code=c.code) THEN RAISE EXCEPTION 'CHANNEL_IN_USE'; END IF;
  DELETE FROM public.store_sale_channels WHERE code=c.code;
 ELSIF p_action='enable' THEN
  IF EXISTS (SELECT 1 FROM public.store_sale_channels WHERE pattern=c.pattern AND active AND code<>c.code) THEN RAISE EXCEPTION 'CHANNEL_RULE_CONFLICT'; END IF;
  UPDATE public.store_sale_channels SET active=true,updated_at=clock_timestamp(),updated_by=inventory_identity.current_uid() WHERE code=c.code;
 ELSE
  UPDATE public.store_sale_channels SET active=false,updated_at=clock_timestamp(),updated_by=inventory_identity.current_uid() WHERE code=c.code;
 END IF;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('code',c.code,'action',p_action));
END $f$;

REVOKE ALL ON FUNCTION public.inventory_store_create_sale(uuid,text,jsonb,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_store_set_sale_tag(uuid,uuid,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_store_list_sales(date,date,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_store_report(date,date,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_store_list_channels() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_store_save_channel(uuid,text,text,text,text,integer,boolean,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_store_channel_action(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_store_create_sale(uuid,text,jsonb,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_store_set_sale_tag(uuid,uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_store_list_sales(date,date,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_store_report(date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_store_list_channels() TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_store_save_channel(uuid,text,text,text,text,integer,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_store_channel_action(uuid,text,text) TO authenticated;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM inventory_executor;
REVOKE SET OPTION FOR inventory_executor FROM postgres;
