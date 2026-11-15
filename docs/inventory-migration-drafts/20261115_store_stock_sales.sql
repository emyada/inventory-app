-- APPLIED to inventory-app-v2 on 2026-11-15 (tables + functions via temporary inventory_executor role switch, reverted).
-- Storefront stock + sales with mandatory, non-duplicable sale tag.
-- Main-stock side reuses existing material movement reasons so existing balance reports keep reconciling:
--   transfer to store  = production_issue (reference 'store:transfer')
-- Roles: new profile role 'store' (storefront staff). Store users have no access to main materials.

-- 1. Role + operation kinds -------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role = ANY (ARRAY['admin','staff','purchasing','store']));

ALTER TABLE public.inventory_operations DROP CONSTRAINT inventory_operations_kind_check;
ALTER TABLE public.inventory_operations ADD CONSTRAINT inventory_operations_kind_check CHECK (kind = ANY (ARRAY[
 'create_material','update_material','archive_material','create_request','confirm_pick','cancel_request','purchase','stocktake',
 'baseline','save_model','set_model_active','set_model_prefix','set_model_settings','finished_out',
 'store_transfer','store_sale','store_sale_add','store_sale_cancel','store_adjust']));

-- 2. Tables --------------------------------------------------------------------------
CREATE TABLE public.store_stock(
 item_kind text NOT NULL CHECK (item_kind IN ('model','material')),
 item_id uuid NOT NULL,
 qty numeric NOT NULL CHECK (qty >= 0),
 qty_version bigint NOT NULL DEFAULT 0,
 PRIMARY KEY (item_kind,item_id));

CREATE TABLE public.store_sales(
 id uuid PRIMARY KEY,
 tag text NOT NULL CHECK (length(btrim(tag)) BETWEEN 3 AND 64),
 tag_key text NOT NULL,
 seller_id uuid NOT NULL,
 seller_name text,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
 created_at timestamptz NOT NULL,
 created_op uuid NOT NULL REFERENCES public.inventory_operations(id),
 cancelled_at timestamptz,
 cancelled_by uuid,
 cancel_reason text,
 CHECK ((status='cancelled') = (cancelled_at IS NOT NULL)));
CREATE UNIQUE INDEX store_sales_one_active_tag ON public.store_sales(tag_key) WHERE status='active';
CREATE INDEX store_sales_created_idx ON public.store_sales(created_at DESC);

CREATE TABLE public.store_sale_lines(
 id uuid PRIMARY KEY,
 sale_id uuid NOT NULL REFERENCES public.store_sales(id),
 item_kind text NOT NULL CHECK (item_kind IN ('model','material')),
 item_id uuid NOT NULL,
 item_name text NOT NULL,
 unit text NOT NULL,
 qty numeric NOT NULL CHECK (qty > 0),
 added_op uuid NOT NULL REFERENCES public.inventory_operations(id),
 added_at timestamptz NOT NULL);
CREATE INDEX store_sale_lines_sale_idx ON public.store_sale_lines(sale_id);

CREATE TABLE public.store_movements(
 id uuid PRIMARY KEY,
 sequence_no bigint GENERATED ALWAYS AS IDENTITY,
 operation_id uuid NOT NULL REFERENCES public.inventory_operations(id),
 item_kind text NOT NULL CHECK (item_kind IN ('model','material')),
 item_id uuid NOT NULL,
 item_name text NOT NULL,
 unit text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('transfer_in','sale','sale_cancel','adjust_in','adjust_out')),
 delta numeric NOT NULL CHECK (delta <> 0),
 qty_before numeric NOT NULL CHECK (qty_before >= 0),
 qty_after numeric NOT NULL CHECK (qty_after >= 0),
 sale_id uuid REFERENCES public.store_sales(id),
 sale_tag text,
 actor_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL,
 note text,
 CHECK (qty_after = qty_before + delta),
 CHECK ((kind IN ('transfer_in','sale_cancel','adjust_in') AND delta > 0) OR (kind IN ('sale','adjust_out') AND delta < 0)),
 CHECK (kind NOT IN ('adjust_in','adjust_out') OR length(btrim(coalesce(note,''))) > 0));
CREATE INDEX store_movements_item_idx ON public.store_movements(item_kind,item_id,occurred_at);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['store_stock','store_sales','store_sale_lines','store_movements'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO inventory_executor',t);
  EXECUTE format('CREATE POLICY executor_all ON public.%I FOR ALL TO inventory_executor USING (true) WITH CHECK (true)',t);
 END LOOP;
END $$;

-- 3. Functions (created as inventory_executor, like the other inventory_* RPCs) ---------
GRANT inventory_executor TO postgres WITH SET TRUE, INHERIT FALSE;
GRANT CREATE ON SCHEMA public TO inventory_executor;
SET LOCAL ROLE inventory_executor;

CREATE OR REPLACE FUNCTION public.inv_role() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r text;
BEGIN
 IF inventory_identity.current_uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT p.role INTO r FROM public.profiles p WHERE p.id=inventory_identity.current_uid();
 IF r IS NULL OR r NOT IN ('admin','staff','purchasing','store') THEN RAISE EXCEPTION 'Invalid role'; END IF;
 RETURN r;
END $$;

-- validate + merge lines: [{kind:'model'|'material', id, qty}]
CREATE FUNCTION public.inv_store_lines(p_lines jsonb) RETURNS TABLE(item_kind text,item_id uuid,qty numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE x jsonb;
BEGIN
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Lines required'; END IF;
 FOR x IN SELECT e FROM jsonb_array_elements(p_lines) e LOOP
  IF jsonb_typeof(x)<>'object' OR coalesce(x->>'kind','') NOT IN ('model','material')
     OR coalesce(x->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(x->'qty')<>'number' THEN RAISE EXCEPTION 'Invalid line'; END IF;
  PERFORM public.inv_number((x->>'qty')::numeric,true);
  IF (x->>'qty')::numeric<=0 OR (x->>'kind'='model' AND (x->>'qty')::numeric<>trunc((x->>'qty')::numeric))
  THEN RAISE EXCEPTION 'Invalid line quantity'; END IF;
 END LOOP;
 RETURN QUERY SELECT e->>'kind',(e->>'id')::uuid,sum((e->>'qty')::numeric)
  FROM jsonb_array_elements(p_lines) e GROUP BY e->>'kind',(e->>'id')::uuid ORDER BY 1,2;
END $$;

CREATE FUNCTION public.inv_store_move(p_op uuid,p_kind text,p_item_kind text,p_item uuid,p_delta numeric,p_sale uuid,p_tag text,p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE s public.store_stock%ROWTYPE; v_name text; v_unit text; v_id uuid:=gen_random_uuid();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.inventory_operations WHERE id=p_op AND actor_id=inventory_identity.current_uid() AND result IS NULL)
 THEN RAISE EXCEPTION 'Invalid operation'; END IF;
 IF p_item_kind='model' THEN SELECT md.name,'ชุด' INTO v_name,v_unit FROM public.models md WHERE md.id=p_item;
 ELSE SELECT m.name,m.unit INTO v_name,v_unit FROM public.materials m WHERE m.id=p_item; END IF;
 IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown store item'; END IF;
 INSERT INTO public.store_stock(item_kind,item_id,qty,qty_version) VALUES(p_item_kind,p_item,0,0) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT s FROM public.store_stock WHERE item_kind=p_item_kind AND item_id=p_item FOR UPDATE;
 IF s.qty+p_delta<0 THEN RAISE EXCEPTION 'Insufficient store stock: % (available %, requested %)',v_name,s.qty,-p_delta; END IF;
 INSERT INTO public.store_movements(id,operation_id,item_kind,item_id,item_name,unit,kind,delta,qty_before,qty_after,sale_id,sale_tag,actor_id,occurred_at,note)
 VALUES(v_id,p_op,p_item_kind,p_item,v_name,v_unit,p_kind,p_delta,s.qty,s.qty+p_delta,p_sale,p_tag,inventory_identity.current_uid(),clock_timestamp(),p_note);
 UPDATE public.store_stock SET qty=s.qty+p_delta,qty_version=s.qty_version+1 WHERE item_kind=p_item_kind AND item_id=p_item;
 RETURN v_id;
END $$;

-- Head of stock moves goods to the storefront. Models: materials deducted by BOM x qty. Materials: deducted directly.
CREATE FUNCTION public.inventory_store_transfer(p_operation_id uuid,p_lines jsonb,p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_replay jsonb; l record; g record; v_n int:=0; v_note text:=nullif(btrim(coalesce(p_note,'')),''); v_lines jsonb; v_need jsonb;
BEGIN
 v_replay:=public.inv_begin(p_operation_id,'store_transfer',jsonb_build_object('lines',p_lines,'note',p_note),ARRAY['admin']);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 v_lines:=(SELECT jsonb_agg(to_jsonb(t)) FROM public.inv_store_lines(p_lines) t);
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(v_lines) AS s(item_kind text,item_id uuid,qty numeric) WHERE s.item_kind='model' AND NOT EXISTS(SELECT 1 FROM public.models md WHERE md.id=s.item_id AND md.is_active))
 THEN RAISE EXCEPTION 'Model not found or inactive'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(v_lines) AS s(item_kind text,item_id uuid,qty numeric) WHERE s.item_kind='model' AND NOT EXISTS(SELECT 1 FROM public.model_bom b WHERE b.model_id=s.item_id))
 THEN RAISE EXCEPTION 'Model has no BOM'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(v_lines) AS s(item_kind text,item_id uuid,qty numeric) WHERE s.item_kind='material' AND NOT EXISTS(SELECT 1 FROM public.materials m WHERE m.id=s.item_id AND m.is_active))
 THEN RAISE EXCEPTION 'Material not found or inactive'; END IF;
 SELECT jsonb_agg(jsonb_build_object('mid',mid,'q',q)) INTO v_need FROM (
  SELECT mid,sum(q) q FROM (
   SELECT b.material_id mid,b.qty*s.qty q FROM jsonb_to_recordset(v_lines) AS s(item_kind text,item_id uuid,qty numeric) JOIN public.model_bom b ON b.model_id=s.item_id WHERE s.item_kind='model'
   UNION ALL SELECT s.item_id,s.qty FROM jsonb_to_recordset(v_lines) AS s(item_kind text,item_id uuid,qty numeric) WHERE s.item_kind='material') u GROUP BY mid) w;
 PERFORM m.id FROM public.materials m WHERE m.id IN (SELECT n.mid FROM jsonb_to_recordset(v_need) AS n(mid uuid,q numeric)) ORDER BY m.id FOR UPDATE;
 FOR g IN SELECT * FROM jsonb_to_recordset(v_need) AS n(mid uuid,q numeric) ORDER BY mid LOOP
  PERFORM public.inv_number(g.q,true);
  PERFORM public.inv_move(p_operation_id,g.mid,-g.q,'production_issue','store:transfer',v_note);
 END LOOP;
 FOR l IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(item_kind text,item_id uuid,qty numeric) ORDER BY item_kind,item_id LOOP
  PERFORM public.inv_store_move(p_operation_id,'transfer_in',l.item_kind,l.item_id,l.qty,NULL,NULL,v_note);
  v_n:=v_n+1;
 END LOOP;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('transferred_lines',v_n));
END $$;

-- Storefront sale: tag is mandatory and must not be used by another active sale.
CREATE FUNCTION public.inventory_store_create_sale(p_operation_id uuid,p_tag text,p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_replay jsonb; v_tag text:=btrim(coalesce(p_tag,'')); v_key text; v_sale uuid:=gen_random_uuid(); v_name text; l record; dup public.store_sales%ROWTYPE; v_lines jsonb;
BEGIN
 v_replay:=public.inv_begin(p_operation_id,'store_sale',jsonb_build_object('tag',p_tag,'lines',p_lines),ARRAY['admin','store']);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 IF length(v_tag) NOT BETWEEN 3 AND 64 THEN RAISE EXCEPTION 'SALE_TAG_REQUIRED'; END IF;
 v_key:=upper(regexp_replace(v_tag,'[\s\-_/.]','','g'));
 IF length(v_key)<3 THEN RAISE EXCEPTION 'SALE_TAG_REQUIRED'; END IF;
 SELECT * INTO dup FROM public.store_sales WHERE tag_key=v_key AND status='active';
 IF FOUND THEN RAISE EXCEPTION 'DUPLICATE_SALE_TAG' USING DETAIL=jsonb_build_object('tag',dup.tag,'sale_id',dup.id,'seller_name',dup.seller_name,'created_at',dup.created_at)::text; END IF;
 v_lines:=(SELECT jsonb_agg(to_jsonb(t)) FROM public.inv_store_lines(p_lines) t);
 SELECT coalesce(nullif(btrim(p.full_name),''),p.username) INTO v_name FROM public.profiles p WHERE p.id=inventory_identity.current_uid();
 INSERT INTO public.store_sales(id,tag,tag_key,seller_id,seller_name,created_at,created_op)
 VALUES(v_sale,v_tag,v_key,inventory_identity.current_uid(),v_name,clock_timestamp(),p_operation_id);
 FOR l IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(item_kind text,item_id uuid,qty numeric) ORDER BY item_kind,item_id LOOP
  PERFORM public.inv_store_move(p_operation_id,'sale',l.item_kind,l.item_id,-l.qty,v_sale,v_tag,NULL);
  INSERT INTO public.store_sale_lines(id,sale_id,item_kind,item_id,item_name,unit,qty,added_op,added_at)
  SELECT gen_random_uuid(),v_sale,l.item_kind,l.item_id,sm.item_name,sm.unit,l.qty,p_operation_id,clock_timestamp()
  FROM public.store_movements sm WHERE sm.operation_id=p_operation_id AND sm.item_kind=l.item_kind AND sm.item_id=l.item_id AND sm.kind='sale';
 END LOOP;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('sale_id',v_sale,'tag',v_tag));
END $$;

-- Add more items to the seller's own active sale (customer adds an item to the same order).
CREATE FUNCTION public.inventory_store_add_sale_lines(p_operation_id uuid,p_sale_id uuid,p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_replay jsonb; s public.store_sales%ROWTYPE; l record; v_lines jsonb;
BEGIN
 v_replay:=public.inv_begin(p_operation_id,'store_sale_add',jsonb_build_object('sale_id',p_sale_id,'lines',p_lines),ARRAY['admin','store']);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 SELECT * INTO s FROM public.store_sales WHERE id=p_sale_id FOR UPDATE;
 IF NOT FOUND OR s.status<>'active' THEN RAISE EXCEPTION 'Sale not found or cancelled'; END IF;
 IF public.inv_role()='store' AND s.seller_id<>inventory_identity.current_uid() THEN RAISE EXCEPTION 'Permission denied'; END IF;
 v_lines:=(SELECT jsonb_agg(to_jsonb(t)) FROM public.inv_store_lines(p_lines) t);
 FOR l IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(item_kind text,item_id uuid,qty numeric) ORDER BY item_kind,item_id LOOP
  PERFORM public.inv_store_move(p_operation_id,'sale',l.item_kind,l.item_id,-l.qty,s.id,s.tag,'เพิ่มรายการในออเดอร์เดิม');
  INSERT INTO public.store_sale_lines(id,sale_id,item_kind,item_id,item_name,unit,qty,added_op,added_at)
  SELECT gen_random_uuid(),s.id,l.item_kind,l.item_id,sm.item_name,sm.unit,l.qty,p_operation_id,clock_timestamp()
  FROM public.store_movements sm WHERE sm.operation_id=p_operation_id AND sm.item_kind=l.item_kind AND sm.item_id=l.item_id AND sm.kind='sale';
 END LOOP;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('sale_id',s.id,'tag',s.tag));
END $$;

-- Cancel a whole sale: stock returns to the store, the tag becomes reusable.
CREATE FUNCTION public.inventory_store_cancel_sale(p_operation_id uuid,p_sale_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_replay jsonb; s public.store_sales%ROWTYPE; l record; v_reason text:=btrim(coalesce(p_reason,''));
BEGIN
 v_replay:=public.inv_begin(p_operation_id,'store_sale_cancel',jsonb_build_object('sale_id',p_sale_id,'reason',p_reason),ARRAY['admin','store']);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 IF length(v_reason)=0 THEN RAISE EXCEPTION 'Cancel reason required'; END IF;
 SELECT * INTO s FROM public.store_sales WHERE id=p_sale_id FOR UPDATE;
 IF NOT FOUND OR s.status<>'active' THEN RAISE EXCEPTION 'Sale not found or already cancelled'; END IF;
 IF public.inv_role()='store' AND s.seller_id<>inventory_identity.current_uid() THEN RAISE EXCEPTION 'Permission denied'; END IF;
 FOR l IN SELECT sl.item_kind,sl.item_id,sum(sl.qty) qty FROM public.store_sale_lines sl WHERE sl.sale_id=s.id GROUP BY 1,2 ORDER BY 1,2 LOOP
  PERFORM public.inv_store_move(p_operation_id,'sale_cancel',l.item_kind,l.item_id,l.qty,s.id,s.tag,v_reason);
 END LOOP;
 UPDATE public.store_sales SET status='cancelled',cancelled_at=clock_timestamp(),cancelled_by=inventory_identity.current_uid(),cancel_reason=v_reason WHERE id=s.id;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('sale_id',s.id,'cancelled',true));
END $$;

-- Month-end count at the storefront: set store qty to the counted value (reason required).
CREATE FUNCTION public.inventory_store_adjust(p_operation_id uuid,p_item_kind text,p_item_id uuid,p_counted_qty numeric,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_replay jsonb; cur numeric:=0; v_reason text:=btrim(coalesce(p_reason,''));
BEGIN
 v_replay:=public.inv_begin(p_operation_id,'store_adjust',jsonb_build_object('kind',p_item_kind,'id',p_item_id,'counted',p_counted_qty,'reason',p_reason),ARRAY['admin']);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 IF p_item_kind NOT IN ('model','material') OR p_counted_qty IS NULL OR p_counted_qty<0 OR length(v_reason)=0 THEN RAISE EXCEPTION 'Invalid adjustment'; END IF;
 PERFORM public.inv_number(p_counted_qty,true);
 IF p_item_kind='model' AND p_counted_qty<>trunc(p_counted_qty) THEN RAISE EXCEPTION 'Invalid adjustment'; END IF;
 SELECT qty INTO cur FROM public.store_stock WHERE item_kind=p_item_kind AND item_id=p_item_id FOR UPDATE;
 cur:=coalesce(cur,0);
 IF cur=p_counted_qty THEN RAISE EXCEPTION 'No change'; END IF;
 PERFORM public.inv_store_move(p_operation_id,CASE WHEN p_counted_qty>cur THEN 'adjust_in' ELSE 'adjust_out' END,p_item_kind,p_item_id,p_counted_qty-cur,NULL,NULL,v_reason);
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('before',cur,'after',p_counted_qty));
END $$;

-- Reads ----------------------------------------------------------------------------------
CREATE FUNCTION public.inventory_store_list_stock() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r jsonb;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','store','purchasing']);
 SELECT coalesce(jsonb_agg(jsonb_build_object('item_kind',s.item_kind,'item_id',s.item_id,'name',coalesce(md.name,m.name),'unit',CASE WHEN s.item_kind='model' THEN 'ชุด' ELSE m.unit END,
   'category',md.category,'qty',s.qty) ORDER BY s.item_kind DESC,coalesce(md.name,m.name)),'[]'::jsonb)
 INTO r FROM public.store_stock s LEFT JOIN public.models md ON s.item_kind='model' AND md.id=s.item_id LEFT JOIN public.materials m ON s.item_kind='material' AND m.id=s.item_id
 WHERE s.qty>0;
 RETURN r;
END $$;

CREATE FUNCTION public.inventory_store_list_sales(p_date_from date,p_date_to date,p_timezone text DEFAULT 'Asia/Bangkok',p_limit integer DEFAULT 300) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r jsonb; a timestamptz; b timestamptz;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','store','purchasing']);
 IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to<p_date_from OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Invalid date range/timezone'; END IF;
 a:=p_date_from::timestamp AT TIME ZONE p_timezone; b:=(p_date_to+1)::timestamp AT TIME ZONE p_timezone;
 SELECT coalesce(jsonb_agg(x ORDER BY (x->>'created_at') DESC),'[]'::jsonb) INTO r FROM (
  SELECT jsonb_build_object('sale_id',s.id,'tag',s.tag,'status',s.status,'seller_id',s.seller_id,'seller_name',s.seller_name,'created_at',s.created_at,
    'cancelled_at',s.cancelled_at,'cancel_reason',s.cancel_reason,
    'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('item_kind',l.item_kind,'item_id',l.item_id,'name',l.item_name,'unit',l.unit,'qty',l.qty) ORDER BY l.added_at,l.item_name),'[]'::jsonb) FROM public.store_sale_lines l WHERE l.sale_id=s.id)) x
  FROM public.store_sales s WHERE s.created_at>=a AND s.created_at<b ORDER BY s.created_at DESC LIMIT least(greatest(coalesce(p_limit,300),1),1000)) q;
 RETURN r;
END $$;

CREATE FUNCTION public.inventory_store_report(p_date_from date,p_date_to date,p_timezone text DEFAULT 'Asia/Bangkok') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r jsonb; a timestamptz; b timestamptz;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','purchasing']);
 IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to<p_date_from OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Invalid date range/timezone'; END IF;
 a:=p_date_from::timestamp AT TIME ZONE p_timezone; b:=(p_date_to+1)::timestamp AT TIME ZONE p_timezone;
 WITH agg AS (
  SELECT v.item_kind,v.item_id,
   (array_agg(v.item_name ORDER BY v.sequence_no DESC))[1] AS name,(array_agg(v.unit ORDER BY v.sequence_no DESC))[1] AS unit,
   coalesce(sum(v.delta) FILTER(WHERE v.occurred_at<a),0) AS opening,
   coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=a AND v.occurred_at<b AND v.kind='transfer_in'),0) AS transfer_in,
   -coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=a AND v.occurred_at<b AND v.kind='sale'),0) AS sold,
   coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=a AND v.occurred_at<b AND v.kind='sale_cancel'),0) AS sale_cancelled,
   coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=a AND v.occurred_at<b AND v.kind='adjust_in'),0) AS adjust_in,
   -coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=a AND v.occurred_at<b AND v.kind='adjust_out'),0) AS adjust_out
  FROM public.store_movements v WHERE v.occurred_at<b GROUP BY v.item_kind,v.item_id),
 rows AS (SELECT item_kind,item_id,name,unit,opening,transfer_in,sold,sale_cancelled,adjust_in,adjust_out,
   opening+transfer_in-sold+sale_cancelled+adjust_in-adjust_out AS closing FROM agg)
 SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY item_kind DESC,name),'[]'::jsonb) INTO r FROM rows;
 RETURN jsonb_build_object('from',a,'to_exclusive',b,'timezone',p_timezone,'items',r);
END $$;

-- True combined balance for re-ordering: main stock + storefront parts, plus sets sitting at the storefront.
CREATE FUNCTION public.inventory_combined_balance() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE mats jsonb; sets jsonb;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','purchasing']);
 SELECT coalesce(jsonb_agg(jsonb_build_object('material_id',m.id,'name',m.name,'unit',m.unit,'main_qty',m.qty,'store_qty',coalesce(s.qty,0),
   'total_qty',m.qty+coalesce(s.qty,0),'low_stock_threshold',m.low_stock_threshold) ORDER BY m.name),'[]'::jsonb) INTO mats
 FROM public.materials m LEFT JOIN public.store_stock s ON s.item_kind='material' AND s.item_id=m.id WHERE m.is_active;
 SELECT coalesce(jsonb_agg(jsonb_build_object('model_id',md.id,'name',md.name,'category',md.category,'store_sets',s.qty) ORDER BY md.name),'[]'::jsonb) INTO sets
 FROM public.store_stock s JOIN public.models md ON s.item_kind='model' AND md.id=s.item_id WHERE s.qty>0;
 RETURN jsonb_build_object('materials',mats,'store_sets',sets);
END $$;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM inventory_executor;
REVOKE SET OPTION FOR inventory_executor FROM postgres;

-- Execute privileges: helpers are internal; RPCs only for signed-in users.
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['inv_store_lines(jsonb)','inv_store_move(uuid,text,text,uuid,numeric,uuid,text,text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated',f);
 END LOOP;
 FOREACH f IN ARRAY ARRAY[
  'inventory_store_transfer(uuid,jsonb,text)','inventory_store_create_sale(uuid,text,jsonb)','inventory_store_add_sale_lines(uuid,uuid,jsonb)',
  'inventory_store_cancel_sale(uuid,uuid,text)','inventory_store_adjust(uuid,text,uuid,numeric,text)','inventory_store_list_stock()',
  'inventory_store_list_sales(date,date,text,integer)','inventory_store_report(date,date,text)','inventory_combined_balance()'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated',f);
 END LOOP;
END $$;

-- 4. Applied afterwards (same role-switch procedure): store users may read setup status so the app can enable actions.
-- CREATE OR REPLACE FUNCTION public.inventory_setup_status(): inv_read(ARRAY['admin','staff','purchasing','store']).

-- 5. APPLIED: inventory_store_report also readable by the 'store' role (store movements only; combined_balance stays admin/purchasing).
--    Only the inv_read(ARRAY['admin','purchasing','store']) line differs from the definition above.
