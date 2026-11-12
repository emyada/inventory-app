-- GENERATED LOCAL CANDIDATE: empty NEW Supabase project only. Never run on V1 or existing Staging.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $fresh$ BEGIN
 IF current_user<>'postgres' OR current_setting('fresh.verified_project_ref',true) IS NULL
 OR current_setting('fresh.verified_project_ref',true) IN ('','lybneofhjhtdyjvfckyg','hkfgzbeoobfnilrzpxwj','qowhwyiooxxvdbnerlpa')
 OR current_setting('fresh.empty_target_confirmed',true) IS DISTINCT FROM 'confirmed'
 OR nullif(current_setting('fresh.approval_reference',true),'') IS NULL THEN RAISE EXCEPTION 'New target identity/approval required'; END IF;
 IF nullif(current_setting('app.settings.project_ref',true),'') IS NOT NULL AND current_setting('app.settings.project_ref',true) IS DISTINCT FROM current_setting('fresh.verified_project_ref',true) THEN RAISE EXCEPTION 'Server project ref differs'; END IF;
 IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION 'Supabase Auth required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S'))
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'inv%' OR p.proname LIKE 'reporting_%' OR p.proname='is_admin'))
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='inventory_executor')
 OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('inventory_identity','duplicate_order_private','reporting_private'))
 THEN RAISE EXCEPTION 'Target is not empty; no reset permitted'; END IF;
END $fresh$;
CREATE ROLE inventory_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT inventory_executor TO postgres WITH INHERIT TRUE, SET TRUE GRANTED BY postgres;
CREATE SCHEMA inventory_identity AUTHORIZATION inventory_executor;
CREATE SCHEMA duplicate_order_private AUTHORIZATION inventory_executor;
CREATE SCHEMA reporting_private AUTHORIZATION inventory_executor;
REVOKE ALL ON SCHEMA inventory_identity,duplicate_order_private,reporting_private FROM PUBLIC,anon,authenticated,service_role;
GRANT CREATE,USAGE ON SCHEMA public TO inventory_executor;
-- current_uid runs with postgres ownership, avoiding executor grants on managed auth.

CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id),
    full_name text NOT NULL,
    role text NOT NULL DEFAULT 'staff' CHECK(role IN ('admin','staff','purchasing'))
  );

CREATE TABLE public.materials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, unit text NOT NULL,
    qty numeric NOT NULL DEFAULT 0, low_stock_threshold numeric DEFAULT NULL
  );

CREATE TABLE public.models (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, category text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

CREATE TABLE public.model_bom (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE RESTRICT,
    material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
    qty numeric NOT NULL
  );

CREATE TABLE public.transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_id uuid REFERENCES public.models(id),
    model_name text NOT NULL, category text NOT NULL, order_ref text NOT NULL,
    staff_name text NOT NULL, created_by uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(), bom_snapshot jsonb NOT NULL, note text DEFAULT ''
  );

CREATE TABLE public.stock_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), material_id uuid NOT NULL REFERENCES public.materials(id),
    material_name text NOT NULL, unit text NOT NULL, amount numeric NOT NULL,
    type text NOT NULL CHECK(type IN ('in','out')), order_ref text, staff_name text,
    created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
  );

ALTER TABLE public.materials
  ADD COLUMN requires_picking boolean NOT NULL DEFAULT true,
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN qty_version bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT inventory_qty_valid CHECK
    (qty IS NOT NULL AND qty>=0 AND qty::text NOT IN ('NaN','Infinity','-Infinity')),
  ADD CONSTRAINT inventory_qty_version_valid CHECK (qty_version>=0);

ALTER TABLE public.models
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.transactions
  ADD COLUMN inventory_version smallint NOT NULL DEFAULT 0,
  ADD CONSTRAINT inventory_request_version_valid CHECK (inventory_version IN (0,1));

CREATE TABLE public.inventory_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  phase smallint NOT NULL CHECK (phase BETWEEN 1 AND 4),
  active boolean NOT NULL DEFAULT false,
  cutoff_at timestamptz,
  cancellation_window_seconds integer CHECK (cancellation_window_seconds>=-1),
  legacy_return_mode text CHECK (legacy_return_mode IN ('blocked','admin_verified')),
  schema_digest text NOT NULL,
  rpc_digest text,
  legacy_security_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.inventory_operations (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('create_material','update_material','archive_material',
    'create_request','confirm_pick','cancel_request','purchase','stocktake','baseline','save_model','set_model_active','set_model_prefix','finished_out')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CHECK ((result IS NULL)=(completed_at IS NULL))
);

CREATE TABLE public.inventory_baseline_batches (
  id uuid PRIMARY KEY REFERENCES public.inventory_operations(id) ON DELETE RESTRICT,
  cutoff_at timestamptz NOT NULL,
  approved_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  review_note text NOT NULL CHECK (length(btrim(review_note))>0),
  reviewed_manifest jsonb NOT NULL CHECK (jsonb_typeof(reviewed_manifest)='array')
);

CREATE TABLE public.inventory_material_baselines (
  material_id uuid PRIMARY KEY REFERENCES public.materials(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES public.inventory_operations(id) ON DELETE RESTRICT,
  batch_id uuid REFERENCES public.inventory_baseline_batches(id) ON DELETE RESTRICT,
  effective_at timestamptz NOT NULL,
  qty numeric NOT NULL CHECK (qty>=0 AND qty::text NOT IN ('NaN','Infinity','-Infinity')),
  qty_version bigint NOT NULL CHECK (qty_version=0),
  material_name text NOT NULL,
  unit text NOT NULL,
  provenance text NOT NULL CHECK (provenance IN ('cutover_observation','new_material_zero')),
  note text NOT NULL,
  CHECK ((provenance='new_material_zero' AND qty=0 AND batch_id IS NULL)
      OR (provenance='cutover_observation' AND batch_id IS NOT NULL))
);

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_no bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  operation_id uuid NOT NULL REFERENCES public.inventory_operations(id) ON DELETE RESTRICT,
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  material_name text NOT NULL,
  unit text NOT NULL,
  delta numeric NOT NULL CHECK (delta<>0 AND delta::text NOT IN ('NaN','Infinity','-Infinity')),
  qty_before numeric NOT NULL CHECK (qty_before>=0 AND qty_before::text NOT IN ('NaN','Infinity','-Infinity')),
  qty_after numeric NOT NULL CHECK (qty_after>=0 AND qty_after::text NOT IN ('NaN','Infinity','-Infinity')),
  version_before bigint NOT NULL CHECK (version_before>=0),
  version_after bigint NOT NULL,
  reason text NOT NULL CHECK (reason IN ('opening_balance','purchase','production_issue',
    'cancellation_return','stocktake_adjustment_in','stocktake_adjustment_out')),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  reference text,
  note text,
  CHECK (qty_after=qty_before+delta),
  CHECK (version_after=version_before+1),
  CHECK ((reason IN ('opening_balance','purchase','cancellation_return','stocktake_adjustment_in') AND delta>0)
      OR (reason IN ('production_issue','stocktake_adjustment_out') AND delta<0)),
  CHECK (reason NOT IN ('stocktake_adjustment_in','stocktake_adjustment_out')
      OR length(btrim(coalesce(note,'')))>0),
  UNIQUE(material_id,version_after),
  UNIQUE(operation_id,material_id)
);

CREATE TABLE public.inventory_movement_allocations (
  movement_id uuid NOT NULL REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  line_id uuid NOT NULL,
  order_ref text,
  delta numeric NOT NULL CHECK (delta<>0 AND delta::text NOT IN ('NaN','Infinity','-Infinity')),
  legacy_verified boolean NOT NULL DEFAULT false,
  PRIMARY KEY(movement_id,transaction_id,line_id)
);

CREATE TABLE public.inventory_cancellations (
  transaction_id uuid PRIMARY KEY REFERENCES public.transactions(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL UNIQUE REFERENCES public.inventory_operations(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason))>0),
  legacy_verified boolean NOT NULL DEFAULT false
);

CREATE TABLE public.inventory_stocktakes (
  operation_id uuid PRIMARY KEY REFERENCES public.inventory_operations(id) ON DELETE RESTRICT,
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  observed_system_qty numeric NOT NULL CHECK
    (observed_system_qty>=0 AND observed_system_qty::text NOT IN ('NaN','Infinity','-Infinity')),
  counted_qty numeric NOT NULL CHECK (counted_qty>=0 AND counted_qty::text NOT IN ('NaN','Infinity','-Infinity')),
  delta numeric NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL,
  reason text,
  CHECK (delta=counted_qty-observed_system_qty),
  CHECK (delta=0 OR length(btrim(coalesce(reason,'')))>0)
);

CREATE INDEX inventory_movement_material_time ON public.inventory_movements(material_id,occurred_at,sequence_no);

CREATE INDEX inventory_allocation_request ON public.inventory_movement_allocations(transaction_id,line_id);

CREATE INDEX inventory_request_queue ON public.transactions(created_at,id);

CREATE TABLE public.inventory_request_policy(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),employee_requests_enabled boolean NOT NULL DEFAULT true,revision bigint NOT NULL DEFAULT 0,updated_by uuid REFERENCES public.profiles(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());

CREATE TABLE public.inventory_request_policy_audit(operation_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES public.profiles(id),enabled boolean NOT NULL,expected_revision bigint NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());

CREATE TABLE public.inventory_retired_operation_ids(operation_id uuid PRIMARY KEY);

CREATE TABLE public.inventory_receipt_counters (
 business_date date PRIMARY KEY,
 last_number bigint NOT NULL CHECK (last_number>0)
);

CREATE TABLE public.inventory_receipt_documents (
 operation_id uuid PRIMARY KEY REFERENCES public.inventory_operations(id) ON DELETE RESTRICT,
 receipt_reference text NOT NULL UNIQUE,
 business_date date NOT NULL,
 receipt_number bigint NOT NULL CHECK(receipt_number>0),
 supplier_source text,
 document_type text NOT NULL CHECK(document_type IN ('none','po','invoice','both')),
 po_number text,
 invoice_number text,
 UNIQUE(business_date,receipt_number),
 CHECK (receipt_reference='RCV-'||to_char(business_date,'YYYYMMDD')||'-'||
   lpad(receipt_number::text,greatest(3,length(receipt_number::text)),'0')),
 CHECK (supplier_source IS NULL OR (supplier_source=btrim(supplier_source) AND length(supplier_source) BETWEEN 1 AND 500)),
 CHECK ((document_type IN ('po','both') AND po_number IS NOT NULL AND po_number=btrim(po_number) AND length(po_number) BETWEEN 1 AND 200)
    OR (document_type IN ('none','invoice') AND po_number IS NULL)),
 CHECK ((document_type IN ('invoice','both') AND invoice_number IS NOT NULL AND invoice_number=btrim(invoice_number) AND length(invoice_number) BETWEEN 1 AND 200)
    OR (document_type IN ('none','po') AND invoice_number IS NULL))
);

CREATE TABLE public.inventory_receipt_batch_lines(
 operation_id uuid NOT NULL REFERENCES public.inventory_receipt_documents(operation_id) ON DELETE RESTRICT,
 material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
 movement_id uuid NOT NULL UNIQUE REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
 unit_purchase_price numeric CHECK(unit_purchase_price>=0 AND unit_purchase_price::text NOT IN ('NaN','Infinity','-Infinity')),
 PRIMARY KEY(operation_id,material_id));

ALTER TABLE public.inventory_receipt_documents ADD COLUMN receipt_contract text NOT NULL DEFAULT 'v21'
 CHECK(receipt_contract IN ('v21','v22_batch'));

ALTER TABLE public.inventory_receipt_documents ADD COLUMN document_date date
 CHECK(document_date IS NULL OR (receipt_contract='v22_batch' AND isfinite(document_date)));

DO $document_checks$
DECLARE c record; found_checks integer:=0; col text; expr text;
BEGIN
 FOR c IN SELECT conname,conkey,pg_get_expr(conbin,conrelid) expression FROM pg_constraint
 WHERE conrelid='public.inventory_receipt_documents'::regclass AND contype='c' LOOP
  SELECT a.attname INTO col FROM pg_attribute a WHERE a.attrelid='public.inventory_receipt_documents'::regclass
   AND a.attnum=ANY(c.conkey) AND a.attname IN ('po_number','invoice_number');
  IF col IS NULL THEN CONTINUE; END IF;
  IF cardinality(c.conkey)<>2 OR NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.inventory_receipt_documents'::regclass AND a.attnum=ANY(c.conkey) AND a.attname='document_type') THEN RAISE EXCEPTION 'Unexpected document constraint'; END IF;
  found_checks:=found_checks+1;
  expr:=format('(%I IS NULL OR (%I=btrim(%I) AND length(%I) BETWEEN 1 AND 200 AND document_type IN (%L,%L)))',col,col,col,col,CASE WHEN col='po_number' THEN 'po' ELSE 'invoice' END,'both');
  EXECUTE format('ALTER TABLE public.inventory_receipt_documents DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE public.inventory_receipt_documents ADD CONSTRAINT %I CHECK ((receipt_contract=''v21'' AND (%s)) OR (receipt_contract=''v22_batch'' AND (%s)))',c.conname,c.expression,expr);
 END LOOP;
 IF found_checks<>2 THEN RAISE EXCEPTION 'Expected exactly two document-number checks'; END IF;
END $document_checks$;

CREATE TABLE duplicate_order_private.model_policy(
 model_id uuid PRIMARY KEY REFERENCES public.models(id), recorded_category text NOT NULL,
 parent_category text NOT NULL, work_kind text NOT NULL CHECK(work_kind IN ('primary','supplemental')),
 CHECK(work_kind<>'supplemental' OR parent_category='CIEM'));

CREATE TABLE duplicate_order_private.request_identity(
 request_id uuid PRIMARY KEY REFERENCES public.transactions(id),parent_category text NOT NULL,
 reference_key text NOT NULL,work_kind text NOT NULL CHECK(work_kind IN ('primary','supplemental')),
 primary_request_id uuid REFERENCES duplicate_order_private.request_identity(request_id),
 relationship_basis text NOT NULL DEFAULT 'legacy_explicit' CHECK(relationship_basis IN ('legacy_explicit','new_order_key')),recorded_by uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((work_kind='primary' AND primary_request_id IS NULL) OR (work_kind='supplemental' AND ((relationship_basis='legacy_explicit' AND primary_request_id IS NOT NULL) OR (relationship_basis='new_order_key' AND primary_request_id IS NULL)))),
 CHECK(primary_request_id IS DISTINCT FROM request_id));

CREATE TABLE duplicate_order_private.issued_identity(
 request_id uuid PRIMARY KEY REFERENCES duplicate_order_private.request_identity(request_id),
 parent_category text NOT NULL,reference_key text NOT NULL,work_kind text NOT NULL CHECK(work_kind IN ('primary','supplemental')),
 operation_id uuid NOT NULL REFERENCES public.inventory_operations(id),issued_at timestamptz NOT NULL,issuer_id uuid NOT NULL,
 released_operation_id uuid REFERENCES public.inventory_operations(id));

CREATE TABLE duplicate_order_private.model_prefix(
 model_id uuid PRIMARY KEY REFERENCES public.models(id), prefix text NOT NULL CHECK(prefix IN ('','Z','ZG','PL','PN')),
 revision bigint NOT NULL CHECK(revision>0));

CREATE TABLE duplicate_order_private.request_reference(
 request_id uuid PRIMARY KEY REFERENCES public.transactions(id),raw_input text NOT NULL,canonical_reference text,
 prefix_revision bigint,work_mode text NOT NULL CHECK(work_mode IN ('standard','bundled_package','standalone_package')),
 recorded_by uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());

CREATE TABLE duplicate_order_private.bom_history(
 operation_id uuid PRIMARY KEY REFERENCES public.inventory_operations(id),model_id uuid NOT NULL REFERENCES public.models(id),
 actor_id uuid NOT NULL,changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),reason text NOT NULL CHECK(length(btrim(reason))>0),
 before_bom jsonb NOT NULL,after_bom jsonb NOT NULL,result jsonb NOT NULL,payload jsonb NOT NULL);

CREATE TABLE reporting_private.mapping_revisions (
 revision_id uuid PRIMARY KEY,
 revision_no bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
 entries jsonb NOT NULL CHECK(jsonb_typeof(entries)='array')
);

CREATE TABLE public.inventory_finished_stock(
 model_id uuid PRIMARY KEY REFERENCES public.models(id) ON DELETE RESTRICT,
 qty bigint NOT NULL DEFAULT 0 CHECK(qty>=0),qty_version bigint NOT NULL DEFAULT 0 CHECK(qty_version>=0));

CREATE TABLE public.inventory_finished_movements(
 id uuid PRIMARY KEY,sequence_no bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 operation_id uuid NOT NULL REFERENCES public.inventory_operations(id) ON DELETE RESTRICT,
 packing_request_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
 model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE RESTRICT,
 model_name text NOT NULL,category text NOT NULL CHECK(category='Universal'),
 kind text NOT NULL CHECK(kind IN ('pack_in','out','pack_cancel')),
 delta integer NOT NULL CHECK((kind='pack_in' AND delta=1) OR (kind IN ('out','pack_cancel') AND delta=-1)),
 qty_before bigint NOT NULL CHECK(qty_before>=0),qty_after bigint NOT NULL CHECK(qty_after>=0 AND qty_after=qty_before+delta),
 version_before bigint NOT NULL CHECK(version_before>=0),version_after bigint NOT NULL CHECK(version_after=version_before+1),
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,occurred_at timestamptz NOT NULL,
 reference text,note text,UNIQUE(operation_id,packing_request_id),UNIQUE(model_id,version_after));

ALTER TABLE public.inventory_cancellations ADD COLUMN closure_kind text NOT NULL DEFAULT 'cancelled'
 CHECK(closure_kind IN ('cancelled','production_not_completed'));

ALTER TABLE public.inventory_cancellations ADD COLUMN return_summary jsonb
 CHECK(return_summary IS NULL OR jsonb_typeof(return_summary)='array');

ALTER TABLE public.inventory_cancellations ADD CONSTRAINT inventory_closure_summary_required
 CHECK(closure_kind='cancelled' OR (return_summary IS NOT NULL AND jsonb_array_length(return_summary)>0));

CREATE UNIQUE INDEX inventory_finished_pack_once ON public.inventory_finished_movements(packing_request_id) WHERE kind='pack_in';

CREATE UNIQUE INDEX inventory_finished_departure_once ON public.inventory_finished_movements(packing_request_id) WHERE kind IN ('out','pack_cancel');

CREATE INDEX inventory_finished_period ON public.inventory_finished_movements(occurred_at,sequence_no);

ALTER TABLE public.profiles ADD COLUMN username text NOT NULL UNIQUE CHECK(username ~ '^[a-z0-9][a-z0-9._-]{0,63}$'), ADD COLUMN enabled boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX one_active_issue_slot ON duplicate_order_private.issued_identity(parent_category,reference_key,work_kind) WHERE released_operation_id IS NULL;
CREATE FUNCTION inventory_identity.current_uid() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $identity$ SELECT id FROM public.profiles WHERE id=auth.uid() AND enabled; $identity$;

CREATE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $body$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=inventory_identity.current_uid() AND p.role='admin');
$body$;

CREATE FUNCTION public.inv_role()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r text;
BEGIN
 IF inventory_identity.current_uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT p.role INTO r FROM public.profiles p WHERE p.id=inventory_identity.current_uid();
 IF r IS NULL OR r NOT IN ('admin','staff','purchasing') THEN RAISE EXCEPTION 'Invalid role'; END IF;
 RETURN r;
END
$function$
;

CREATE FUNCTION public.inv_schema_digest() RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $body$
 SELECT pg_catalog.md5(coalesce(pg_catalog.string_agg(s.x,E'\n' ORDER BY s.x),''))
 FROM (
   SELECT c.relname||'.'||a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)
      ||':'||a.attnotnull::text||':'||coalesce(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'') AS x
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
   LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
   WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
     AND (c.relname IN ('materials','transactions','stock_log','profiles','models','model_bom')
       OR c.relname LIKE 'inventory\_%' ESCAPE '\')
   UNION ALL
   SELECT c.relname||':'||con.conname||':'||pg_catalog.pg_get_constraintdef(con.oid)
   FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND con.contype IN ('p','f','u','c')
     AND (c.relname IN ('materials','transactions','stock_log','profiles','models','model_bom')
       OR c.relname LIKE 'inventory\_%' ESCAPE '\')
   UNION ALL
   SELECT c.relname||':index:'||pg_catalog.pg_get_indexdef(i.indexrelid)
   FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND (c.relname IN
    ('materials','transactions','stock_log','profiles','models','model_bom') OR c.relname LIKE 'inventory\_%' ESCAPE '\')
   UNION ALL
   SELECT c.relname||':security:'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'')
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind='r' AND (c.relname IN
    ('materials','transactions','stock_log','profiles','models','model_bom') OR c.relname LIKE 'inventory\_%' ESCAPE '\')
   UNION ALL
   SELECT c.relname||':policy:'||p.polname||':'||p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'
     ||coalesce(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),'')
   FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND (c.relname IN
    ('materials','transactions','stock_log','profiles','models','model_bom') OR c.relname LIKE 'inventory\_%' ESCAPE '\')
   UNION ALL
   SELECT c.relname||':trigger:'||pg_catalog.pg_get_triggerdef(t.oid)||':'||t.tgenabled::text
   FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname<>'inventory_write_guard'
    AND (c.relname IN ('materials','transactions','stock_log','profiles','models','model_bom')
      OR c.relname LIKE 'inventory\_%' ESCAPE '\')
 ) s;
$body$;

CREATE FUNCTION public.inventory_get_operation_result(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o public.inventory_operations%ROWTYPE;
BEGIN
 IF inventory_identity.current_uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT x.* INTO o FROM public.inventory_operations x
 WHERE x.id=p_operation_id AND (x.actor_id=inventory_identity.current_uid() OR EXISTS(
   SELECT 1 FROM public.profiles p WHERE p.id=inventory_identity.current_uid() AND p.role='admin'));
 IF NOT FOUND THEN
   RETURN jsonb_build_object('found',false,'kind',NULL,'completed',false,
     'result',NULL,'created_at',NULL,'completed_at',NULL);
 END IF;
 RETURN jsonb_build_object('found',true,'kind',o.kind,
   'completed',o.completed_at IS NOT NULL AND o.result IS NOT NULL,
   'result',o.result,'created_at',o.created_at,'completed_at',o.completed_at);
END
$function$
;

CREATE FUNCTION public.inv_number(p_value numeric, p_positive boolean DEFAULT false) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF p_value IS NULL OR p_value::text IN ('NaN','Infinity','-Infinity')
   OR p_value<0 OR (p_positive AND p_value=0)
 THEN RAISE EXCEPTION 'Finite % quantity required',CASE WHEN p_positive THEN 'positive' ELSE 'nonnegative' END; END IF;
 RETURN p_value;
END
$fn$;

CREATE FUNCTION public.inv_line_id(p_tx uuid, p_line jsonb, p_ordinal bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 RETURN coalesce((p_line->>'line_id')::uuid,
   pg_catalog.md5('inventory-legacy-line:'||p_tx::text||':'||p_ordinal::text)::uuid);
END
$fn$;

CREATE FUNCTION public.inv_begin(p_id uuid, p_kind text, p_payload jsonb, p_roles text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o public.inventory_operations%ROWTYPE; r text;
BEGIN
 -- Serialize all inventory writers. At this app scale, correctness is preferred
 -- over concurrent writes to disjoint materials. Readers use the shared gate.
 PERFORM pg_catalog.pg_advisory_xact_lock(72401,1);
 IF NOT EXISTS(SELECT 1 FROM public.inventory_control WHERE phase=4 AND (active OR p_kind IN ('opening_draft','opening_balance','activate_inventory')))
 THEN RAISE EXCEPTION 'Inventory cutover not active'; END IF;
 r:=public.inv_role();
 IF p_kind IN ('opening_draft','opening_balance','activate_inventory') AND r<>'admin' THEN RAISE EXCEPTION 'Permission denied'; END IF;
 IF NOT (r=ANY(p_roles)) THEN RAISE EXCEPTION 'Permission denied'; END IF;
 IF p_id IS NULL OR p_payload IS NULL THEN RAISE EXCEPTION 'Operation ID/payload required'; END IF;

 IF EXISTS(SELECT 1 FROM public.inventory_retired_operation_ids retired WHERE retired.operation_id=p_id) THEN RAISE EXCEPTION 'Operation retired by inventory reset'; END IF;
 SELECT * INTO o FROM public.inventory_operations WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
   IF o.actor_id IS DISTINCT FROM inventory_identity.current_uid() OR o.kind<>p_kind OR o.payload<>p_payload
   THEN RAISE EXCEPTION 'Operation ID reused with different actor/kind/payload'; END IF;
   IF o.result IS NULL THEN RAISE EXCEPTION 'Operation not finalized'; END IF;
   RETURN o.result;
 END IF;

 IF EXISTS(SELECT 1 FROM public.inventory_request_policy_audit WHERE operation_id=p_id) THEN RAISE EXCEPTION 'Operation ID conflict'; END IF;
 IF p_kind='create_request' AND r<>'admin' AND NOT EXISTS(SELECT 1 FROM public.inventory_request_policy WHERE singleton AND employee_requests_enabled) THEN RAISE EXCEPTION 'NEW_REQUESTS_DISABLED' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.inventory_operations(id,actor_id,kind,payload)
 VALUES(p_id,inventory_identity.current_uid(),p_kind,p_payload);
 RETURN NULL;
END
$function$;

CREATE FUNCTION public.inv_finish(p_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF p_result IS NULL THEN RAISE EXCEPTION 'Result required'; END IF;
 UPDATE public.inventory_operations SET result=p_result,completed_at=clock_timestamp()
 WHERE id=p_id AND actor_id=inventory_identity.current_uid() AND result IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation finalization failed'; END IF;
 RETURN p_result;
END
$function$
;

CREATE FUNCTION public.inv_move(p_operation uuid, p_material uuid, p_delta numeric, p_reason text, p_reference text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.materials%ROWTYPE; v_id uuid:=gen_random_uuid(); b public.inventory_material_baselines%ROWTYPE;
BEGIN
 IF p_delta IS NULL OR p_delta=0 OR p_delta::text IN ('NaN','Infinity','-Infinity')
 THEN RAISE EXCEPTION 'Invalid movement delta'; END IF;
 SELECT * INTO STRICT m FROM public.materials WHERE id=p_material FOR UPDATE;
 SELECT * INTO b FROM public.inventory_material_baselines WHERE material_id=m.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing reviewed baseline for %',m.id; END IF;
 IF m.qty+p_delta<0 THEN RAISE EXCEPTION 'Insufficient stock: % (available %, delta %)',m.name,m.qty,p_delta; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.inventory_operations WHERE id=p_operation
    AND actor_id=inventory_identity.current_uid() AND result IS NULL) THEN RAISE EXCEPTION 'Invalid operation'; END IF;
 IF p_reason='opening_balance' AND
   (b.provenance<>'new_material_zero' OR b.qty<>0 OR m.qty_version<>0 OR m.qty<>0)
 THEN RAISE EXCEPTION 'Opening movement would duplicate baseline'; END IF;
 INSERT INTO public.inventory_movements(id,operation_id,material_id,material_name,unit,
    delta,qty_before,qty_after,version_before,version_after,reason,actor_id,occurred_at,reference,note)
 VALUES(v_id,p_operation,m.id,m.name,m.unit,p_delta,m.qty,m.qty+p_delta,
    m.qty_version,m.qty_version+1,p_reason,inventory_identity.current_uid(),clock_timestamp(),p_reference,p_note);
 UPDATE public.materials SET qty=m.qty+p_delta,qty_version=m.qty_version+1 WHERE id=m.id;
 RETURN v_id;
END
$function$;

CREATE FUNCTION public.inventory_create_material(p_operation_id uuid, p_name text, p_unit text, p_low_stock_threshold numeric, p_initial_qty numeric, p_reason text, p_requires_picking boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE replay jsonb; v_id uuid:=gen_random_uuid(); t timestamptz;
BEGIN
 IF p_initial_qty IS DISTINCT FROM 0::numeric THEN RAISE EXCEPTION 'Fresh materials start at zero; use receiving'; END IF;
 replay:=public.inv_begin(p_operation_id,'create_material',jsonb_build_object(
 'name',p_name,'unit',p_unit,'threshold',p_low_stock_threshold,'qty',p_initial_qty,
 'reason',p_reason,'requires_picking',p_requires_picking),ARRAY['admin']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 PERFORM public.inv_number(p_initial_qty); PERFORM public.inv_number(p_low_stock_threshold);
 IF length(btrim(coalesce(p_name,'')))=0 OR length(btrim(coalesce(p_unit,'')))=0
    OR p_requires_picking IS NULL THEN RAISE EXCEPTION 'Name, unit and flag required'; END IF;
 IF p_initial_qty>0 AND length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'Opening reason required'; END IF;
 INSERT INTO public.materials(id,name,unit,qty,low_stock_threshold,requires_picking,is_active,qty_version)
 VALUES(v_id,btrim(p_name),btrim(p_unit),0,p_low_stock_threshold,p_requires_picking,true,0);
 t:=clock_timestamp();
 INSERT INTO public.inventory_material_baselines(material_id,operation_id,effective_at,qty,
   qty_version,material_name,unit,provenance,note)
 VALUES(v_id,p_operation_id,t,0,0,btrim(p_name),btrim(p_unit),'new_material_zero','Zero at creation');
 IF p_initial_qty>0 THEN
   PERFORM public.inv_move(p_operation_id,v_id,p_initial_qty,'opening_balance',NULL,p_reason);
 END IF;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('material_id',v_id,'qty',p_initial_qty));
END
$fn$;

CREATE FUNCTION public.inventory_update_material(p_operation_id uuid, p_material_id uuid, p_name text, p_unit text, p_low_stock_threshold numeric, p_requires_picking boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE replay jsonb; m public.materials%ROWTYPE;
BEGIN
 replay:=public.inv_begin(p_operation_id,'update_material',jsonb_build_object(
 'id',p_material_id,'name',p_name,'unit',p_unit,'threshold',p_low_stock_threshold,
 'requires_picking',p_requires_picking),ARRAY['admin']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 PERFORM public.inv_number(p_low_stock_threshold);
 SELECT * INTO STRICT m FROM public.materials WHERE id=p_material_id FOR UPDATE;
 IF length(btrim(coalesce(p_name,'')))=0 OR p_requires_picking IS NULL THEN RAISE EXCEPTION 'Name and flag required'; END IF;
 IF p_unit IS DISTINCT FROM m.unit THEN RAISE EXCEPTION 'Unit conversion requires separate approved procedure; archive/create a new unit item'; END IF;
 UPDATE public.materials SET name=btrim(p_name),low_stock_threshold=p_low_stock_threshold,
   requires_picking=p_requires_picking WHERE id=m.id;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('before',to_jsonb(m),
   'after',(SELECT to_jsonb(x) FROM public.materials x WHERE x.id=m.id)));
END
$fn$;

CREATE FUNCTION public.inventory_set_material_active(p_operation_id uuid, p_material_id uuid, p_is_active boolean, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE replay jsonb; pending jsonb;
BEGIN
 replay:=public.inv_begin(p_operation_id,'archive_material',jsonb_build_object(
 'id',p_material_id,'active',p_is_active,'reason',p_reason),ARRAY['admin']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 IF p_is_active IS NULL OR length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'Flag/reason required'; END IF;
 PERFORM 1 FROM public.materials WHERE id=p_material_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Material not found'; END IF;
 SELECT jsonb_agg(t.id) INTO pending FROM public.transactions t
 WHERE NOT EXISTS(SELECT 1 FROM public.inventory_cancellations c WHERE c.transaction_id=t.id)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.bom_snapshot) b
      WHERE (b->>'material_id')::uuid=p_material_id
        AND NOT coalesce((b->>'picked')::boolean,false));
 IF NOT p_is_active AND pending IS NOT NULL THEN RAISE EXCEPTION 'Material used by pending requests: %',pending; END IF;
 UPDATE public.materials SET is_active=p_is_active WHERE id=p_material_id;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('material_id',p_material_id,
   'is_active',p_is_active,'model_references',(SELECT count(*) FROM public.model_bom WHERE material_id=p_material_id)));
END
$fn$;

CREATE FUNCTION public.inventory_receive_purchase(p_operation_id uuid, p_material_id uuid, p_quantity numeric, p_reference text, p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE replay jsonb; movement uuid;
BEGIN
 replay:=public.inv_begin(p_operation_id,'purchase',jsonb_build_object(
 'id',p_material_id,'qty',p_quantity,'reference',p_reference,'note',p_note),ARRAY['admin','purchasing']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 IF upper(btrim(p_reference)) ~ '^RCV-[0-9]{8}-[0-9]{3,}$'
   AND EXISTS(SELECT 1 FROM public.inventory_movements AS receipt_prior
       WHERE upper(btrim(receipt_prior.reference))=upper(btrim(p_reference)))
 THEN RAISE EXCEPTION 'Receipt reference conflict'; END IF;

 PERFORM public.inv_number(p_quantity,true);
 PERFORM 1 FROM public.materials WHERE id=p_material_id AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Material missing or inactive'; END IF;
 movement:=public.inv_move(p_operation_id,p_material_id,p_quantity,'purchase',p_reference,p_note);
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('movement_id',movement));
END
$$;

CREATE FUNCTION public.inventory_stocktake(p_operation_id uuid, p_material_id uuid, p_counted_qty numeric, p_reason text, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE replay jsonb; m public.materials%ROWTYPE; d numeric; movement uuid;
BEGIN
 replay:=public.inv_begin(p_operation_id,'stocktake',jsonb_build_object('id',p_material_id,
 'count',p_counted_qty,'reason',p_reason,'version',p_expected_version),ARRAY['admin']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 PERFORM public.inv_number(p_counted_qty);
 SELECT * INTO STRICT m FROM public.materials WHERE id=p_material_id FOR UPDATE;
 IF p_expected_version IS DISTINCT FROM m.qty_version THEN RAISE EXCEPTION 'Stock changed; recount/review required'; END IF;
 d:=p_counted_qty-m.qty;
 IF d<>0 AND length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'Adjustment reason required'; END IF;
 IF d<>0 THEN movement:=public.inv_move(p_operation_id,m.id,d,
   CASE WHEN d>0 THEN 'stocktake_adjustment_in' ELSE 'stocktake_adjustment_out' END,NULL,p_reason); END IF;
 INSERT INTO public.inventory_stocktakes(operation_id,material_id,observed_system_qty,counted_qty,delta,actor_id,recorded_at,reason)
 VALUES(p_operation_id,m.id,m.qty,p_counted_qty,d,inventory_identity.current_uid(),clock_timestamp(),p_reason);
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('qty_before',m.qty,'qty_after',p_counted_qty,
   'delta',d,'movement_id',movement));
END
$function$
;

CREATE FUNCTION public.inv_issue_lines(p_operation uuid, p_lines jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g record; l jsonb; movement uuid; tid uuid;
BEGIN
 IF jsonb_array_length(p_lines)=0 THEN RETURN; END IF;
 PERFORM duplicate_order_private.claim_issues(p_operation,p_lines);
 -- Callers already locked requests. Stable material ordering, aggregate once.
 PERFORM m.id FROM public.materials m WHERE m.id IN
   (SELECT (x->>'material_id')::uuid FROM jsonb_array_elements(p_lines) x) ORDER BY m.id FOR UPDATE;
 FOR g IN SELECT (x->>'material_id')::uuid AS id,sum((x->>'qty')::numeric) AS qty
   FROM jsonb_array_elements(p_lines) x GROUP BY (x->>'material_id')::uuid ORDER BY 1 LOOP
   PERFORM public.inv_number(g.qty,true);
   IF NOT EXISTS(SELECT 1 FROM public.materials WHERE id=g.id AND is_active AND qty>=g.qty)
   THEN RAISE EXCEPTION 'Insufficient stock or inactive material: %',g.id; END IF;
 END LOOP;
 FOR g IN SELECT (x->>'material_id')::uuid AS id,sum((x->>'qty')::numeric) AS qty
   FROM jsonb_array_elements(p_lines) x GROUP BY (x->>'material_id')::uuid ORDER BY 1 LOOP
   movement:=public.inv_move(p_operation,g.id,-g.qty,'production_issue',NULL,NULL);
   FOR l IN SELECT x FROM jsonb_array_elements(p_lines) x WHERE (x->>'material_id')::uuid=g.id LOOP
     INSERT INTO public.inventory_movement_allocations(movement_id,transaction_id,line_id,order_ref,delta)
     SELECT movement,t.id,(l->>'line_id')::uuid,t.order_ref,-(l->>'qty')::numeric
     FROM public.transactions t WHERE t.id=(l->>'transaction_id')::uuid;
   END LOOP;
 END LOOP;
 FOR tid IN SELECT DISTINCT (x->>'transaction_id')::uuid FROM jsonb_array_elements(p_lines) x LOOP
   UPDATE public.transactions t SET bom_snapshot=(
     SELECT jsonb_agg(CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) q
       WHERE (q->>'transaction_id')::uuid=t.id AND (q->>'line_id')::uuid=
          public.inv_line_id(t.id,b.line,b.ord))
       THEN jsonb_set(b.line,'{picked}','true'::jsonb) ELSE b.line END ORDER BY b.ord)
     FROM jsonb_array_elements(t.bom_snapshot) WITH ORDINALITY b(line,ord))
   WHERE t.id=tid;
 END LOOP;
END
$function$;

CREATE FUNCTION public.inventory_create_request(p_operation_id uuid, p_model_id uuid, p_order_ref text, p_repair_spec jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

DECLARE replay jsonb; md public.models%ROWTYPE; bom jsonb; snapshot jsonb:='[]'::jsonb;

 b record; m public.materials%ROWTYPE; tid uuid:=gen_random_uuid(); lname text; cat text;

 staff text; note text; lines jsonb; all_auto boolean:=true; line_uuid uuid;

BEGIN

 replay:=public.inv_begin(p_operation_id,'create_request',jsonb_build_object(

 'model_id',p_model_id,'order_ref',p_order_ref,'repair',p_repair_spec),ARRAY['admin','staff']);

 IF replay IS NOT NULL THEN RETURN replay; END IF;
 IF EXISTS(SELECT 1 FROM public.models WHERE id=p_model_id AND category IN ('Sleepplug','Lifestyle')) THEN RAISE EXCEPTION 'REQUEST_V2_REQUIRED'; END IF;

 IF nullif(btrim(p_order_ref),'') IS NULL AND EXISTS(SELECT 1 FROM public.models WHERE id=p_model_id AND category='Universal' AND is_active) THEN p_order_ref:='UV-'||tid::text; END IF;
 IF length(btrim(coalesce(p_order_ref,'')))=0 THEN RAISE EXCEPTION 'Order reference required'; END IF;

 SELECT full_name INTO staff FROM public.profiles WHERE id=inventory_identity.current_uid();

 IF length(btrim(coalesce(staff,'')))=0 THEN RAISE EXCEPTION 'Profile name required'; END IF;

 IF p_model_id IS NOT NULL THEN

   IF p_repair_spec IS NOT NULL THEN RAISE EXCEPTION 'Choose model or repair mode'; END IF;

   SELECT * INTO STRICT md FROM public.models WHERE id=p_model_id FOR SHARE;

   IF NOT md.is_active THEN RAISE EXCEPTION 'Model inactive'; END IF;

   lname:=md.name; cat:=md.category; note:='';

   SELECT coalesce(jsonb_agg(jsonb_build_object('material_id',material_id,'qty',qty)),'[]'::jsonb)

   INTO bom FROM public.model_bom WHERE model_id=md.id;

 ELSE

   IF jsonb_typeof(p_repair_spec) IS DISTINCT FROM 'object'

     OR jsonb_typeof(p_repair_spec->'bom') IS DISTINCT FROM 'array'

   THEN RAISE EXCEPTION 'Repair specification with BOM array required'; END IF;

   lname:=p_repair_spec->>'subtype'; cat:='ซ่อมและอื่นๆ'; note:=p_repair_spec->>'note';

   IF lname IS NULL OR lname NOT IN ('CIEM','Tactical','Lifestyle','Sleepplug','อื่นๆ')

      OR length(btrim(coalesce(note,'')))=0 THEN RAISE EXCEPTION 'Invalid repair subtype/reason'; END IF;

   bom:=p_repair_spec->'bom';

 END IF;

 -- inv_begin holds the exclusive advisory writer lock through commit/rollback.

 IF cat IS NULL OR cat NOT IN ('CIEM','Lifestyle','Sleepplug','Tactical','ซ่อมและอื่นๆ')

 THEN RAISE EXCEPTION 'Unsupported request category'; END IF;

 IF cat='ซ่อมและอื่นๆ' AND length(btrim(coalesce(note,'')))=0

 THEN RAISE EXCEPTION 'Repair requests require a nonblank reason; use repair mode'; END IF;



 IF jsonb_array_length(bom)=0 THEN RAISE EXCEPTION 'Empty BOM not enabled; record non-material work outside inventory'; END IF;

 FOR b IN SELECT x FROM jsonb_array_elements(bom) x LOOP

   IF jsonb_typeof(b.x) IS DISTINCT FROM 'object' OR b.x->>'material_id' IS NULL

   THEN RAISE EXCEPTION 'Malformed BOM'; END IF;

   PERFORM (b.x->>'material_id')::uuid;

   PERFORM public.inv_number((b.x->>'qty')::numeric,true);

 END LOOP;

 PERFORM m0.id FROM public.materials m0 WHERE m0.id IN

   (SELECT (x->>'material_id')::uuid FROM jsonb_array_elements(bom) x) ORDER BY m0.id FOR UPDATE;

 FOR b IN SELECT (x->>'material_id')::uuid AS id,sum((x->>'qty')::numeric) qty

   FROM jsonb_array_elements(bom) x GROUP BY (x->>'material_id')::uuid ORDER BY 1 LOOP

   SELECT * INTO m FROM public.materials WHERE id=b.id;

   IF NOT FOUND OR NOT m.is_active THEN RAISE EXCEPTION 'Inactive or missing BOM material %',b.id; END IF;

   PERFORM public.inv_number(b.qty,true);

   line_uuid:=gen_random_uuid();

   snapshot:=snapshot||jsonb_build_array(jsonb_build_object(

     'line_id',line_uuid,'material_id',m.id,'material_name',m.name,'unit',m.unit,'qty',b.qty,

     'requires_picking',m.requires_picking,'picked',false,'received',false));

   all_auto:=all_auto AND NOT m.requires_picking;

 END LOOP;

 INSERT INTO public.transactions(id,model_id,model_name,category,order_ref,staff_name,

   created_by,created_at,bom_snapshot,note,inventory_version)

 VALUES(tid,p_model_id,lname,cat,btrim(p_order_ref),staff,inventory_identity.current_uid(),clock_timestamp(),snapshot,note,1);

 PERFORM duplicate_order_private.register_request(tid,NULL);

 RETURN public.inv_finish(p_operation_id,jsonb_build_object('transaction_id',tid,

   'completed',false,'bom_snapshot',(SELECT bom_snapshot FROM public.transactions WHERE id=tid)));

END

$function$;

CREATE FUNCTION public.inventory_confirm_pick(p_operation_id uuid,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE replay jsonb; selected jsonb; lines jsonb; item jsonb; t public.transactions%ROWTYPE;
BEGIN
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Selection array required'; END IF;
 SELECT jsonb_agg(jsonb_build_object('transaction_id',q.tid,'line_id',q.lid) ORDER BY q.tid,q.lid) INTO selected
 FROM (SELECT DISTINCT (x->>'transaction_id')::uuid tid,(x->>'line_id')::uuid lid FROM jsonb_array_elements(p_items) x) q;
 replay:=public.inv_begin(p_operation_id,'confirm_pick',jsonb_build_object('items',selected),ARRAY['admin']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 PERFORM q.id FROM public.transactions q WHERE q.id IN (SELECT (x->>'transaction_id')::uuid FROM jsonb_array_elements(selected)x) ORDER BY q.id FOR UPDATE;
 FOR item IN SELECT x FROM jsonb_array_elements(selected)x LOOP
  SELECT * INTO STRICT t FROM public.transactions WHERE id=(item->>'transaction_id')::uuid;
  IF t.inventory_version<>1 THEN RAISE EXCEPTION 'Legacy request requires review'; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_cancellations WHERE transaction_id=t.id)
    THEN RAISE EXCEPTION 'Request closed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.bom_snapshot) WITH ORDINALITY b(line,ord)
    WHERE public.inv_line_id(t.id,b.line,b.ord)=(item->>'line_id')::uuid) THEN RAISE EXCEPTION 'Unknown allocation'; END IF;
 END LOOP;
 -- Reject partial-order selection; never silently expand beyond the reviewed payload.
 IF EXISTS(SELECT 1 FROM public.transactions q CROSS JOIN LATERAL jsonb_array_elements(q.bom_snapshot) WITH ORDINALITY b(line,ord)
  WHERE q.id IN (SELECT (x->>'transaction_id')::uuid FROM jsonb_array_elements(selected)x)
  AND NOT coalesce((b.line->>'picked')::boolean,false)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(selected)x WHERE (x->>'transaction_id')::uuid=q.id AND (x->>'line_id')::uuid=public.inv_line_id(q.id,b.line,b.ord)))
 THEN RAISE EXCEPTION 'WHOLE_ORDER_REQUIRED'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('transaction_id',q.id,'line_id',public.inv_line_id(q.id,b.line,b.ord),'material_id',b.line->>'material_id','qty',b.line->'qty') ORDER BY q.id,b.ord),'[]'::jsonb)
 INTO lines FROM public.transactions q CROSS JOIN LATERAL jsonb_array_elements(q.bom_snapshot) WITH ORDINALITY b(line,ord)
 WHERE q.id IN (SELECT (x->>'transaction_id')::uuid FROM jsonb_array_elements(selected)x) AND NOT coalesce((b.line->>'picked')::boolean,false);
 -- Existing issue helper locks materials in deterministic order, validates every balance,
 -- performs duplicate claims, and retains request/line allocations atomically.
 PERFORM public.inv_issue_lines(p_operation_id,lines);
 PERFORM public.inv_complete_pack(p_operation_id,q.id) FROM (SELECT DISTINCT (x->>'transaction_id')::uuid AS id FROM jsonb_array_elements(lines)x) q;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('issued_lines',jsonb_array_length(lines)));
END $function$;

CREATE FUNCTION public.inventory_cancel_request(p_operation_id uuid, p_transaction_id uuid, p_reason text, p_legacy_return_verified boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE replay jsonb; t public.transactions%ROWTYPE; r text; ctl public.inventory_control%ROWTYPE;
 lines jsonb:='[]'::jsonb; b record; g record; l jsonb; movement uuid; q numeric; lid uuid;
 has_issue_evidence boolean;
BEGIN
 replay:=public.inv_begin(p_operation_id,'cancel_request',jsonb_build_object('id',p_transaction_id,
   'reason',p_reason,'legacy_verified',p_legacy_return_verified),ARRAY['admin','staff']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 r:=public.inv_role(); SELECT * INTO STRICT ctl FROM public.inventory_control;
 SELECT * INTO STRICT t FROM public.transactions WHERE id=p_transaction_id FOR UPDATE;
 IF r<>'admin' AND t.created_by IS DISTINCT FROM inventory_identity.current_uid() THEN RAISE EXCEPTION 'Not request owner'; END IF;
 -- Request UUID is the accounting identity. Any allocation counts, even if net
 -- stock is zero after a return. Legacy picked flags also count when logs are absent.
 SELECT EXISTS(SELECT 1 FROM public.inventory_movement_allocations a WHERE a.transaction_id=t.id)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(t.bom_snapshot) line
      WHERE coalesce((line->>'picked')::boolean,false))
 INTO has_issue_evidence;
 IF r<>'admin' AND has_issue_evidence
 THEN RAISE EXCEPTION 'Only admin may cancel a request after any stock issue/allocation'; END IF;
 IF r<>'admin' AND ctl.cancellation_window_seconds>=0
   AND clock_timestamp()>t.created_at+pg_catalog.make_interval(secs=>ctl.cancellation_window_seconds)
 THEN RAISE EXCEPTION 'Owner cancellation window expired'; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_cancellations WHERE transaction_id=t.id)
 THEN RETURN public.inv_finish(p_operation_id,jsonb_build_object('already_cancelled',true)); END IF;
 IF length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'Cancellation reason required'; END IF;
 IF t.inventory_version=0 AND has_issue_evidence AND
    (ctl.legacy_return_mode<>'admin_verified' OR r<>'admin' OR NOT coalesce(p_legacy_return_verified,false))
 THEN RAISE EXCEPTION 'Legacy return requires approved mode and administrator physical-return verification'; END IF;
 FOR b IN SELECT b0.line,b0.ord FROM jsonb_array_elements(t.bom_snapshot) WITH ORDINALITY b0(line,ord) LOOP
   lid:=public.inv_line_id(t.id,b.line,b.ord);
   IF t.inventory_version=0 THEN
     q:=CASE WHEN coalesce((b.line->>'picked')::boolean,false) THEN (b.line->>'qty')::numeric ELSE 0 END;
   ELSE
     SELECT -coalesce(sum(a.delta),0) INTO q FROM public.inventory_movement_allocations a
       WHERE a.transaction_id=t.id AND a.line_id=lid;
     IF q<0 THEN RAISE EXCEPTION 'Return ledger inconsistent'; END IF;
   END IF;
   IF q>0 THEN
     PERFORM public.inv_number(q,true);
     lines:=lines||jsonb_build_array(jsonb_build_object('line_id',lid,'material_id',b.line->>'material_id','qty',q));
   END IF;
 END LOOP;
 IF jsonb_array_length(lines)>0 AND t.inventory_version=1 THEN p_reason:=p_reason||' [ACCOUNTING_RESTORATION_NOT_PHYSICALLY_VERIFIED]'; END IF;
 PERFORM m.id FROM public.materials m WHERE m.id IN
   (SELECT (x->>'material_id')::uuid FROM jsonb_array_elements(lines) x) ORDER BY m.id FOR UPDATE;
 FOR g IN SELECT (x->>'material_id')::uuid id,sum((x->>'qty')::numeric) qty
   FROM jsonb_array_elements(lines) x GROUP BY (x->>'material_id')::uuid ORDER BY 1 LOOP
   movement:=public.inv_move(p_operation_id,g.id,g.qty,'cancellation_return',t.order_ref,p_reason);
   FOR l IN SELECT x FROM jsonb_array_elements(lines) x WHERE (x->>'material_id')::uuid=g.id LOOP
     INSERT INTO public.inventory_movement_allocations(movement_id,transaction_id,line_id,order_ref,delta,legacy_verified)
     VALUES(movement,t.id,(l->>'line_id')::uuid,t.order_ref,(l->>'qty')::numeric,t.inventory_version=0);
   END LOOP;
 END LOOP;
 IF t.category='Universal' AND EXISTS(SELECT 1 FROM public.inventory_finished_movements WHERE packing_request_id=t.id AND kind='pack_in') THEN PERFORM public.inv_finished_move(p_operation_id,t.id,'pack_cancel',t.order_ref,p_reason); END IF;
 INSERT INTO public.inventory_cancellations(transaction_id,operation_id,actor_id,cancelled_at,reason,legacy_verified)
 VALUES(t.id,p_operation_id,inventory_identity.current_uid(),clock_timestamp(),p_reason,
   t.inventory_version=0 AND has_issue_evidence AND coalesce(p_legacy_return_verified,false));
 UPDATE duplicate_order_private.issued_identity SET released_operation_id=p_operation_id WHERE request_id=t.id AND released_operation_id IS NULL;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('transaction_id',t.id,'cancelled',true));
END
$function$
;

CREATE FUNCTION public.inventory_save_model(p_operation_id uuid, p_model_id uuid, p_name text, p_category text, p_bom jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE replay jsonb; mid uuid:=coalesce(p_model_id,gen_random_uuid()); b record;
BEGIN
 replay:=public.inv_begin(p_operation_id,'save_model',jsonb_build_object(
  'id',p_model_id,'name',p_name,'category',p_category,'bom',p_bom),ARRAY['admin']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 IF length(btrim(coalesce(p_name,'')))=0 OR length(btrim(coalesce(p_category,'')))=0
   OR jsonb_typeof(p_bom) IS DISTINCT FROM 'array' OR jsonb_array_length(p_bom)=0
 THEN RAISE EXCEPTION 'Name, category and nonempty BOM required'; END IF;
 IF p_model_id IS NOT NULL THEN
   PERFORM 1 FROM public.models WHERE id=mid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Model missing'; END IF;
 END IF;
 FOR b IN SELECT x FROM jsonb_array_elements(p_bom) x LOOP
   IF b.x->>'material_id' IS NULL THEN RAISE EXCEPTION 'Material ID required'; END IF;
   PERFORM (b.x->>'material_id')::uuid; PERFORM public.inv_number((b.x->>'qty')::numeric,true);
 END LOOP;
 PERFORM m.id FROM public.materials m WHERE m.id IN
   (SELECT (x->>'material_id')::uuid FROM jsonb_array_elements(p_bom) x) ORDER BY m.id FOR UPDATE;
 FOR b IN SELECT (x->>'material_id')::uuid id FROM jsonb_array_elements(p_bom) x LOOP
   IF NOT EXISTS(SELECT 1 FROM public.materials WHERE id=b.id AND is_active)
   THEN RAISE EXCEPTION 'Inactive/missing material %',b.id; END IF;
 END LOOP;
 IF p_model_id IS NULL THEN
   INSERT INTO public.models(id,name,category,created_at) VALUES(mid,btrim(p_name),btrim(p_category),clock_timestamp());
 ELSE
   UPDATE public.models SET name=btrim(p_name),category=btrim(p_category) WHERE id=mid;
   DELETE FROM public.model_bom WHERE model_id=mid;
 END IF;
 INSERT INTO public.model_bom(id,model_id,material_id,qty)
 SELECT gen_random_uuid(),mid,(x->>'material_id')::uuid,sum((x->>'qty')::numeric)
 FROM jsonb_array_elements(p_bom) x GROUP BY (x->>'material_id')::uuid;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('model_id',mid));
END
$function$;

CREATE FUNCTION public.inventory_set_model_active(p_operation_id uuid, p_model_id uuid, p_is_active boolean, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE replay jsonb; prior_active boolean; pending_count bigint;
BEGIN
 replay:=public.inv_begin(p_operation_id,'set_model_active',jsonb_build_object(
   'id',p_model_id,'is_active',p_is_active,'reason',p_reason),ARRAY['admin']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 IF p_is_active IS NULL OR length(btrim(coalesce(p_reason,'')))=0
 THEN RAISE EXCEPTION 'Active flag and reason required'; END IF;
 SELECT is_active INTO prior_active FROM public.models WHERE id=p_model_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Model missing'; END IF;
 SELECT count(*) INTO pending_count FROM public.transactions t
 WHERE t.model_id=p_model_id
   AND NOT EXISTS(SELECT 1 FROM public.inventory_cancellations c WHERE c.transaction_id=t.id)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.bom_snapshot) b
     WHERE NOT coalesce((b->>'picked')::boolean,false));
 UPDATE public.models SET is_active=p_is_active WHERE id=p_model_id;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('model_id',p_model_id,
   'is_active',p_is_active,'previous_is_active',prior_active,'pending_request_count',pending_count));
END
$fn$;

CREATE FUNCTION public.inv_read(p_roles text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(72401,1);
 IF NOT (public.inv_role()=ANY(p_roles)) THEN RAISE EXCEPTION 'Permission denied'; END IF;
END
$fn$;

CREATE FUNCTION public.inventory_list_materials(p_include_inactive boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r text; result jsonb;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','staff','purchasing']); r:=public.inv_role();
 SELECT coalesce(jsonb_agg(CASE WHEN r='staff'
    THEN to_jsonb(m)-'qty'-'qty_version'-'low_stock_threshold' ELSE to_jsonb(m) END ORDER BY m.name,m.id),'[]'::jsonb)
 INTO result FROM public.materials m WHERE m.is_active OR (p_include_inactive AND r<>'staff');
 RETURN result;
END
$fn$;

CREATE FUNCTION public.inventory_list_my_requests(p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r text; result jsonb;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','staff']); r:=public.inv_role();
 IF p_limit IS NULL OR p_limit<1 OR p_limit>500 OR ((p_after_at IS NULL)<>(p_after_id IS NULL))
 THEN RAISE EXCEPTION 'Invalid pagination'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO result
 FROM (
  SELECT t.*,c.cancelled_at,c.closure_kind,c.return_summary,
    (SELECT coalesce(jsonb_agg(issued.occurred_at ORDER BY issued.occurred_at,issued.sequence_no),'[]'::jsonb)
     FROM (SELECT DISTINCT mv.sequence_no,mv.occurred_at
      FROM public.inventory_movement_allocations al JOIN public.inventory_movements mv ON mv.id=al.movement_id
      WHERE al.transaction_id=t.id AND mv.reason='production_issue') issued) AS issue_times,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('line_id',available.line_id,'material_id',available.material_id,'issued_qty',available.issued_qty,'returnable_qty',available.returnable_qty) ORDER BY available.line_id),'[]'::jsonb)
     FROM (SELECT al.line_id,mv.material_id,-sum(al.delta) FILTER(WHERE mv.reason='production_issue') AS issued_qty,-sum(al.delta) AS returnable_qty
       FROM public.inventory_movement_allocations AS al JOIN public.inventory_movements AS mv ON mv.id=al.movement_id
       WHERE al.transaction_id=t.id AND c.transaction_id IS NULL GROUP BY al.line_id,mv.material_id
       HAVING -sum(al.delta)>0) AS available) AS returnable_lines,
    (SELECT count(*) FROM jsonb_array_elements(t.bom_snapshot)) AS total_lines,
    (SELECT count(*) FROM jsonb_array_elements(t.bom_snapshot) b
      WHERE coalesce((b->>'picked')::boolean,false)) AS picked_lines,
    (SELECT count(*) FROM jsonb_array_elements(t.bom_snapshot) b
      WHERE NOT coalesce((b->>'picked')::boolean,false)) AS pending_lines,
    (SELECT count(*) FROM jsonb_array_elements(t.bom_snapshot) b
      WHERE coalesce((b->>'requires_picking')::boolean,true)
        AND NOT coalesce((b->>'picked')::boolean,false)) AS pending_picking_lines,
    CASE WHEN c.transaction_id IS NOT NULL THEN c.closure_kind
      WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.bom_snapshot) b
           WHERE NOT coalesce((b->>'picked')::boolean,false)) THEN 'completed'
      WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(t.bom_snapshot) b
           WHERE coalesce((b->>'picked')::boolean,false)) THEN 'partially_picked'
      ELSE 'pending' END AS workflow_state
  FROM public.transactions t LEFT JOIN public.inventory_cancellations c ON c.transaction_id=t.id
  WHERE (r='admin' OR t.created_by=inventory_identity.current_uid())
    AND (p_after_at IS NULL OR (t.created_at,t.id)>(p_after_at,p_after_id))
  ORDER BY t.created_at,t.id LIMIT p_limit
 ) q;
 RETURN result;
END
$function$
;

CREATE FUNCTION public.inventory_list_pick_queue(p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 PERFORM public.inv_read(ARRAY['admin']);
 IF p_limit IS NULL OR p_limit<1 OR p_limit>500 OR ((p_after_at IS NULL)<>(p_after_id IS NULL))
 THEN RAISE EXCEPTION 'Invalid pagination'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO result FROM (
  SELECT t.id,t.order_ref,t.staff_name,t.created_at,
    t.model_id,t.model_name,t.category,t.note,t.bom_snapshot, 'admin-whole-order-v1'::text AS confirmation_contract,
    (SELECT count(*) FROM jsonb_array_elements(t.bom_snapshot)) AS total_lines,
    (SELECT count(*) FROM jsonb_array_elements(t.bom_snapshot) b
      WHERE coalesce((b->>'picked')::boolean,false)) AS picked_lines,
    (SELECT count(*) FROM jsonb_array_elements(t.bom_snapshot) b
      WHERE NOT coalesce((b->>'picked')::boolean,false)) AS pending_lines,
    (SELECT count(*) FROM jsonb_array_elements(t.bom_snapshot) b
      WHERE NOT coalesce((b->>'picked')::boolean,false)) AS pending_picking_lines,
    CASE WHEN EXISTS(SELECT 1 FROM public.inventory_cancellations c WHERE c.transaction_id=t.id) THEN 'cancelled'
      WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.bom_snapshot) b
           WHERE NOT coalesce((b->>'picked')::boolean,false)) THEN 'completed'
      WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(t.bom_snapshot) b
           WHERE coalesce((b->>'picked')::boolean,false)) THEN 'partially_picked'
      ELSE 'pending' END AS workflow_state,
    (SELECT jsonb_agg(b.line||jsonb_build_object('line_id',public.inv_line_id(t.id,b.line,b.ord))
       ORDER BY b.ord)
      FROM jsonb_array_elements(t.bom_snapshot) WITH ORDINALITY b(line,ord)
      WHERE NOT coalesce((b.line->>'picked')::boolean,false)) AS lines
  FROM public.transactions t
  WHERE NOT EXISTS(SELECT 1 FROM public.inventory_cancellations c WHERE c.transaction_id=t.id)
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.bom_snapshot) b
      WHERE NOT coalesce((b->>'picked')::boolean,false))
    AND (p_after_at IS NULL OR (t.created_at,t.id)>(p_after_at,p_after_id))
  ORDER BY t.created_at,t.id LIMIT p_limit
 ) q;
 RETURN result;
END
$function$;

CREATE FUNCTION public.inventory_balance_report(p_date_from date, p_date_to date, p_timezone text DEFAULT 'Asia/Bangkok') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE result jsonb; start_at timestamptz; end_at timestamptz;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','purchasing']);
 IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to<p_date_from
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone)
 THEN RAISE EXCEPTION 'Invalid date range/timezone'; END IF;
 start_at:=p_date_from::timestamp AT TIME ZONE p_timezone;
 end_at:=(p_date_to+1)::timestamp AT TIME ZONE p_timezone;
 WITH totals AS (
   SELECT m.id,m.name,m.unit,m.is_active,b.effective_at,b.qty AS baseline_qty,b.provenance,
     CASE WHEN b.material_id IS NULL THEN 'missing_baseline'
       WHEN b.effective_at>start_at AND b.provenance='cutover_observation' THEN 'before_coverage'
       ELSE 'complete' END AS coverage,
     CASE WHEN b.effective_at<=start_at THEN b.qty ELSE 0 END
       +coalesce(sum(v.delta) FILTER(WHERE v.occurred_at<start_at),0) AS opening_raw,
     coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=start_at AND v.reason='opening_balance'),0) AS opening_additions,
     coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=start_at AND v.reason='purchase'),0) AS purchase,
     -coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=start_at AND v.reason='production_issue'),0) AS issue,
     coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=start_at AND v.reason='cancellation_return'),0) AS returned,
     coalesce(sum((SELECT -sum(a.delta) FROM public.inventory_movement_allocations a
       JOIN public.transactions t ON t.id=a.transaction_id
       WHERE a.movement_id=v.id AND t.category='ซ่อมและอื่นๆ'))
       FILTER(WHERE v.occurred_at>=start_at AND v.reason='production_issue'),0) AS repair_issue,
     coalesce(sum((SELECT sum(a.delta) FROM public.inventory_movement_allocations a
       JOIN public.transactions t ON t.id=a.transaction_id
       WHERE a.movement_id=v.id AND t.category='ซ่อมและอื่นๆ'))
       FILTER(WHERE v.occurred_at>=start_at AND v.reason='cancellation_return'),0) AS repair_returned,
     coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=start_at AND v.reason='stocktake_adjustment_in'),0) AS adjustment_in,
     -coalesce(sum(v.delta) FILTER(WHERE v.occurred_at>=start_at AND v.reason='stocktake_adjustment_out'),0) AS adjustment_out,
     count(v.id) FILTER(WHERE v.occurred_at>=start_at) AS movement_count
   FROM public.materials m LEFT JOIN public.inventory_material_baselines b ON b.material_id=m.id
   LEFT JOIN public.inventory_movements v ON v.material_id=m.id AND v.occurred_at>=b.effective_at AND v.occurred_at<end_at
   WHERE b.material_id IS NULL OR b.provenance='cutover_observation' OR b.effective_at<end_at
   GROUP BY m.id,m.name,m.unit,m.is_active,b.material_id,b.effective_at,b.qty,b.provenance
 ), rows AS (
   SELECT id,name,unit,is_active,effective_at AS coverage_start,coverage,
     CASE WHEN coverage='complete' THEN opening_raw END AS opening,
     opening_additions,purchase,issue,returned,repair_issue,repair_returned,
     issue-repair_issue AS production_issue,returned-repair_returned AS production_returned,
     adjustment_in,adjustment_out,movement_count,
     CASE WHEN coverage='complete' THEN opening_raw+opening_additions+purchase-issue+returned+adjustment_in-adjustment_out END AS closing
   FROM totals
 )
 SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY name,id),'[]'::jsonb) INTO result FROM rows;
 RETURN jsonb_build_object('from',start_at,'to_exclusive',end_at,'timezone',p_timezone,'materials',result);
END
$fn$;

CREATE FUNCTION public.inventory_list_movements(p_material_id uuid = NULL, p_from timestamptz = NULL, p_to timestamptz = NULL, p_after_sequence bigint = 0, p_cutoff_sequence bigint = NULL, p_limit integer = 500) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE cutoff bigint; result jsonb;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','purchasing']);
 IF p_limit IS NULL OR p_limit<1 OR p_limit>5000 OR p_after_sequence IS NULL OR p_after_sequence<0
   OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_to<=p_from)
 THEN RAISE EXCEPTION 'Invalid export pagination/range'; END IF;
 SELECT coalesce(max(sequence_no),0) INTO cutoff FROM public.inventory_movements;
 IF p_cutoff_sequence IS NOT NULL THEN
   IF p_cutoff_sequence<0 OR p_cutoff_sequence>cutoff THEN RAISE EXCEPTION 'Invalid export cutoff'; END IF;
   cutoff:=p_cutoff_sequence;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.sequence_no),'[]'::jsonb) INTO result FROM (
   SELECT v.*,(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb)
      FROM public.inventory_movement_allocations a WHERE a.movement_id=v.id) AS allocations,
     (SELECT to_jsonb(receipt_doc) FROM public.inventory_receipt_documents AS receipt_doc
       WHERE receipt_doc.operation_id=v.operation_id) AS receipt_document
   FROM public.inventory_movements v
   WHERE v.sequence_no>p_after_sequence AND v.sequence_no<=cutoff
     AND (p_material_id IS NULL OR v.material_id=p_material_id)
     AND (p_from IS NULL OR v.occurred_at>=p_from) AND (p_to IS NULL OR v.occurred_at<p_to)
   ORDER BY v.sequence_no LIMIT p_limit
 ) q;
 RETURN jsonb_build_object('cutoff_sequence',cutoff,'rows',result);
END
$$;

CREATE FUNCTION public.inv_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE b record; old_line jsonb;
BEGIN
 IF current_user<>'inventory_executor' THEN RAISE EXCEPTION 'Direct inventory write blocked; use authorized RPC'; END IF;
 IF TG_OP='DELETE' AND TG_TABLE_NAME<>'model_bom' THEN RAISE EXCEPTION 'Deletion forbidden; archive/cancel instead'; END IF;
 IF TG_TABLE_NAME IN ('inventory_movements','inventory_movement_allocations',
      'inventory_material_baselines','inventory_baseline_batches','inventory_stocktakes','inventory_cancellations')
    AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Accounting evidence is append-only'; END IF;
 IF TG_TABLE_NAME='inventory_operations' AND TG_OP='UPDATE' THEN
   IF OLD.result IS NOT NULL OR
     (to_jsonb(NEW)-'result'-'completed_at') IS DISTINCT FROM (to_jsonb(OLD)-'result'-'completed_at')
   THEN RAISE EXCEPTION 'Operation identity/result immutable'; END IF;
 END IF;
 IF TG_TABLE_NAME='materials' THEN
   IF TG_OP='UPDATE' AND NEW.unit IS DISTINCT FROM OLD.unit
   THEN RAISE EXCEPTION 'Unit changes prohibited'; END IF;
 END IF;
 IF TG_TABLE_NAME='transactions' THEN
   IF TG_OP='INSERT' THEN
     IF NEW.inventory_version<>1 OR NEW.created_by IS DISTINCT FROM inventory_identity.current_uid()
       OR jsonb_typeof(NEW.bom_snapshot) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.bom_snapshot)=0
     THEN RAISE EXCEPTION 'Invalid new inventory request'; END IF;
     FOR b IN SELECT x FROM jsonb_array_elements(NEW.bom_snapshot) x LOOP
       IF b.x->>'line_id' IS NULL OR b.x->>'material_id' IS NULL
         OR jsonb_typeof(b.x->'picked') IS DISTINCT FROM 'boolean'
         OR jsonb_typeof(b.x->'requires_picking') IS DISTINCT FROM 'boolean'
       THEN RAISE EXCEPTION 'Invalid snapshot'; END IF;
     END LOOP;
   ELSIF TG_OP='UPDATE' THEN
     IF OLD.inventory_version<>1 OR
        (to_jsonb(NEW)-'bom_snapshot') IS DISTINCT FROM (to_jsonb(OLD)-'bom_snapshot')
        OR jsonb_array_length(NEW.bom_snapshot)<>jsonb_array_length(OLD.bom_snapshot)
     THEN RAISE EXCEPTION 'Request metadata/legacy snapshot immutable'; END IF;
     FOR b IN SELECT x,ord FROM jsonb_array_elements(NEW.bom_snapshot) WITH ORDINALITY q(x,ord) LOOP
       old_line:=OLD.bom_snapshot->(b.ord::integer-1);
       IF (b.x-'picked') IS DISTINCT FROM (old_line-'picked')
         OR (coalesce((old_line->>'picked')::boolean,false) AND NOT coalesce((b.x->>'picked')::boolean,false))
       THEN RAISE EXCEPTION 'Only pending-to-picked transition allowed'; END IF;
     END LOOP;
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$function$;

CREATE FUNCTION public.inv_check_operation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o public.inventory_operations%ROWTYPE;
BEGIN
 SELECT * INTO STRICT o FROM public.inventory_operations WHERE id=NEW.id;
 IF o.result IS NULL OR o.completed_at IS NULL THEN RAISE EXCEPTION 'Unfinalized inventory operation'; END IF;
 RETURN NULL;
END
$function$;

CREATE FUNCTION public.inv_check_material()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.inventory_movements%ROWTYPE; b public.inventory_material_baselines%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
   SELECT * INTO b FROM public.inventory_material_baselines WHERE material_id=NEW.id;
   IF NOT FOUND OR b.provenance<>'new_material_zero' OR b.qty<>0 OR NEW.qty<>0 OR NEW.qty_version<>0
   THEN RAISE EXCEPTION 'New material must begin with zero baseline'; END IF;
 ELSE
   IF NEW.qty IS NOT DISTINCT FROM OLD.qty AND NEW.qty_version=OLD.qty_version THEN RETURN NULL; END IF;
   SELECT * INTO v FROM public.inventory_movements WHERE material_id=NEW.id AND version_after=NEW.qty_version;
   IF NOT FOUND OR v.qty_before IS DISTINCT FROM OLD.qty OR v.qty_after IS DISTINCT FROM NEW.qty
     OR v.version_before<>OLD.qty_version OR NEW.qty_version<>OLD.qty_version+1
     OR v.actor_id IS DISTINCT FROM inventory_identity.current_uid()
   THEN RAISE EXCEPTION 'Quantity change without exact matching movement'; END IF;
 END IF;
 RETURN NULL;
END
$function$;

CREATE FUNCTION public.inv_check_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.inventory_movements%ROWTYPE; o public.inventory_operations%ROWTYPE;
 b public.inventory_material_baselines%ROWTYPE; prior_qty numeric; prior_time timestamptz;
 a record; t public.transactions%ROWTYPE; line jsonb; issued numeric; returned numeric;
BEGIN
 IF TG_TABLE_NAME='inventory_movement_allocations' THEN
   SELECT * INTO STRICT v FROM public.inventory_movements WHERE id=NEW.movement_id;
 ELSE
   SELECT * INTO STRICT v FROM public.inventory_movements WHERE id=NEW.id;
 END IF;
 SELECT * INTO STRICT o FROM public.inventory_operations WHERE id=v.operation_id;
 SELECT * INTO STRICT b FROM public.inventory_material_baselines WHERE material_id=v.material_id;
 IF o.result IS NULL OR o.actor_id<>v.actor_id OR v.actor_id IS DISTINCT FROM inventory_identity.current_uid()
 THEN RAISE EXCEPTION 'Movement actor/operation mismatch'; END IF;
 IF v.version_before=b.qty_version THEN prior_qty:=b.qty;prior_time:=b.effective_at;
 ELSE
   SELECT qty_after,occurred_at INTO prior_qty,prior_time FROM public.inventory_movements
    WHERE material_id=v.material_id AND version_after=v.version_before;
 END IF;
 IF prior_qty IS NULL OR prior_qty<>v.qty_before OR v.occurred_at<prior_time
   OR NOT EXISTS(SELECT 1 FROM public.materials m WHERE m.id=v.material_id AND m.qty_version>=v.version_after)
 THEN RAISE EXCEPTION 'Broken movement/baseline chain'; END IF;
 IF (v.reason='opening_balance' AND (o.kind<>'create_material' OR b.provenance<>'new_material_zero'
       OR b.qty<>0 OR v.version_before<>0 OR b.operation_id<>v.operation_id))
   OR (v.reason='purchase' AND o.kind<>'purchase')
   OR (v.reason='production_issue' AND o.kind NOT IN ('create_request','confirm_pick'))
   OR (v.reason='cancellation_return' AND o.kind<>'cancel_request')
   OR (v.reason IN ('stocktake_adjustment_in','stocktake_adjustment_out') AND o.kind<>'stocktake')
 THEN RAISE EXCEPTION 'Movement reason/operation mismatch'; END IF;
 IF v.reason IN ('production_issue','cancellation_return') THEN
   IF (SELECT coalesce(sum(delta),0) FROM public.inventory_movement_allocations WHERE movement_id=v.id)<>v.delta
   THEN RAISE EXCEPTION 'Allocation sum mismatch'; END IF;
   FOR a IN SELECT * FROM public.inventory_movement_allocations WHERE movement_id=v.id LOOP
     SELECT * INTO STRICT t FROM public.transactions WHERE id=a.transaction_id;
     SELECT x.line INTO line FROM jsonb_array_elements(t.bom_snapshot) WITH ORDINALITY x(line,ord)
      WHERE public.inv_line_id(t.id,x.line,x.ord)=a.line_id;
     IF line IS NULL OR (line->>'material_id')::uuid<>v.material_id
       OR a.order_ref IS DISTINCT FROM t.order_ref
       OR NOT coalesce((line->>'picked')::boolean,false)
       OR sign(a.delta)<>sign(v.delta)
     THEN RAISE EXCEPTION 'Allocation/BOM mismatch'; END IF;
     IF v.reason='production_issue' THEN
       SELECT -sum(a0.delta) INTO issued FROM public.inventory_movement_allocations a0
        JOIN public.inventory_movements v0 ON v0.id=a0.movement_id
        WHERE a0.transaction_id=t.id AND a0.line_id=a.line_id AND v0.reason='production_issue';
       IF t.inventory_version<>1 OR a.legacy_verified OR issued<>(line->>'qty')::numeric
       THEN RAISE EXCEPTION 'Duplicate or invalid issue'; END IF;
     ELSE
       IF NOT EXISTS(SELECT 1 FROM public.inventory_cancellations c
         WHERE c.transaction_id=t.id AND c.operation_id=v.operation_id)
       THEN RAISE EXCEPTION 'Return missing cancellation marker'; END IF;
       IF t.inventory_version=0 THEN
         IF NOT a.legacy_verified OR public.inv_role()<>'admin' OR a.delta<>(line->>'qty')::numeric
         THEN RAISE EXCEPTION 'Unverified legacy return'; END IF;
       ELSE
         SELECT -coalesce(sum(a0.delta) FILTER(WHERE v0.reason='production_issue'),0),
            coalesce(sum(a0.delta) FILTER(WHERE v0.reason='cancellation_return'),0)
         INTO issued,returned FROM public.inventory_movement_allocations a0
          JOIN public.inventory_movements v0 ON v0.id=a0.movement_id
          WHERE a0.transaction_id=t.id AND a0.line_id=a.line_id;
         IF a.legacy_verified OR issued<=0 OR returned>issued OR returned<0
           OR (returned<>issued AND NOT EXISTS(SELECT 1 FROM public.inventory_cancellations AS closure_row
             WHERE closure_row.transaction_id=t.id AND closure_row.closure_kind='production_not_completed'))
         THEN RAISE EXCEPTION 'Return exceeds or differs from issued quantity'; END IF;
       END IF;
     END IF;
   END LOOP;
 ELSE
   IF EXISTS(SELECT 1 FROM public.inventory_movement_allocations WHERE movement_id=v.id)
   THEN RAISE EXCEPTION 'Unexpected request allocation'; END IF;
 END IF;
 RETURN NULL;
END
$function$;

CREATE FUNCTION public.inv_check_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE t public.transactions%ROWTYPE; b record; amount numeric;
BEGIN
 SELECT * INTO STRICT t FROM public.transactions WHERE id=NEW.id;
 IF t.inventory_version<>1 THEN RETURN NULL; END IF;
 FOR b IN SELECT x FROM jsonb_array_elements(t.bom_snapshot) x LOOP
   SELECT -coalesce(sum(a.delta),0) INTO amount FROM public.inventory_movement_allocations a
     JOIN public.inventory_movements v ON v.id=a.movement_id
     WHERE a.transaction_id=t.id AND a.line_id=(b.x->>'line_id')::uuid AND v.reason='production_issue';
   IF amount<>(CASE WHEN coalesce((b.x->>'picked')::boolean,false) THEN (b.x->>'qty')::numeric ELSE 0 END)
   THEN RAISE EXCEPTION 'Picked flag without matching issue'; END IF;
 END LOOP;
 RETURN NULL;
END
$function$;

CREATE FUNCTION public.inventory_request_policy() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF public.inv_role() IS NULL OR public.inv_role() NOT IN ('admin','staff','purchasing') THEN RAISE EXCEPTION 'Permission denied'; END IF;
 RETURN (SELECT jsonb_build_object('employee_requests_enabled',employee_requests_enabled,'revision',revision) FROM public.inventory_request_policy WHERE singleton);
END $f$;

CREATE FUNCTION public.inventory_set_request_policy(p_operation_id uuid,p_enabled boolean,p_expected_revision bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE a public.inventory_request_policy_audit%ROWTYPE; result jsonb; actor uuid;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(72401,1);
 IF public.inv_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Permission denied'; END IF;
 actor:=inventory_identity.current_uid();
 IF actor IS NULL OR p_operation_id IS NULL OR p_enabled IS NULL OR p_expected_revision IS NULL THEN RAISE EXCEPTION 'Input required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.inventory_control WHERE phase=4 AND active) THEN RAISE EXCEPTION 'Inventory cutover not active'; END IF;
 SELECT * INTO a FROM public.inventory_request_policy_audit WHERE operation_id=p_operation_id;
 IF FOUND THEN
 IF a.actor_id IS DISTINCT FROM actor OR a.enabled IS DISTINCT FROM p_enabled OR a.expected_revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Operation reuse mismatch'; END IF;
 RETURN a.result; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_operations WHERE id=p_operation_id) OR EXISTS(SELECT 1 FROM public.inventory_retired_operation_ids WHERE operation_id=p_operation_id) THEN RAISE EXCEPTION 'Operation ID conflict'; END IF;
 UPDATE public.inventory_request_policy SET employee_requests_enabled=p_enabled,revision=revision+1,updated_by=actor,updated_at=clock_timestamp() WHERE singleton AND revision=p_expected_revision RETURNING jsonb_build_object('employee_requests_enabled',employee_requests_enabled,'revision',revision) INTO result;
 IF NOT FOUND THEN RAISE EXCEPTION 'Policy revision changed'; END IF;
 INSERT INTO public.inventory_request_policy_audit(operation_id,actor_id,enabled,expected_revision,result) VALUES(p_operation_id,actor,p_enabled,p_expected_revision,result);
 RETURN result;
END $f$;

CREATE FUNCTION public.inventory_receive_purchase_v21(
 p_operation_id uuid,p_material_id uuid,p_quantity numeric,
 p_supplier_source text,p_document_type text,p_po_number text,p_invoice_number text,p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $receipt$
DECLARE v_replay jsonb; v_payload jsonb; v_day date; v_number bigint; v_prior numeric;
 v_reference text; v_movement uuid; v_row public.inventory_movements%ROWTYPE;
BEGIN
 -- Exact submitted payload is the idempotency identity; never normalize it before inv_begin.
 v_payload:=jsonb_build_object('receipt_contract','v21','id',p_material_id,'qty',p_quantity,
   'supplier_source',p_supplier_source,'document_type',p_document_type,
   'po_number',p_po_number,'invoice_number',p_invoice_number,'note',p_note);
 v_replay:=public.inv_begin(p_operation_id,'purchase',v_payload,ARRAY['admin','purchasing']);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 PERFORM public.inv_number(p_quantity,true);
 IF p_document_type IS NULL OR p_document_type NOT IN ('none','po','invoice','both')
   OR (p_document_type IN ('po','both') AND nullif(btrim(p_po_number),'') IS NULL)
   OR (p_document_type IN ('none','invoice') AND p_po_number IS NOT NULL)
   OR (p_document_type IN ('invoice','both') AND nullif(btrim(p_invoice_number),'') IS NULL)
   OR (p_document_type IN ('none','po') AND p_invoice_number IS NOT NULL)
   OR length(p_supplier_source)>500 OR length(p_po_number)>200 OR length(p_invoice_number)>200
 THEN RAISE EXCEPTION 'Invalid receipt document fields'; END IF;
 PERFORM 1 FROM public.materials WHERE id=p_material_id AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Material missing or inactive'; END IF;
 -- inv_begin already holds the same transaction writer lock as the manual RPC.
 -- Take the business date AFTER waiting for that lock; statement-start date may be yesterday.
 v_day:=(clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date;
 SELECT coalesce(max(substring(upper(btrim(m.reference)) FROM 14)::numeric),0)
 INTO v_prior FROM public.inventory_movements AS m
 WHERE upper(btrim(m.reference)) ~ ('^RCV-'||to_char(v_day,'YYYYMMDD')||'-[0-9]{3,}$');
 SELECT greatest(v_prior,coalesce(c.last_number,0)) INTO v_prior
 FROM (SELECT 1) AS singleton LEFT JOIN public.inventory_receipt_counters AS c ON c.business_date=v_day;
 IF v_prior>=9223372036854775807 THEN RAISE EXCEPTION 'Receipt sequence exhausted'; END IF;
 v_number:=v_prior::bigint+1;
 INSERT INTO public.inventory_receipt_counters(business_date,last_number) VALUES(v_day,v_number)
 ON CONFLICT(business_date) DO UPDATE SET last_number=EXCLUDED.last_number;
 v_reference:='RCV-'||to_char(v_day,'YYYYMMDD')||'-'||lpad(v_number::text,greatest(3,length(v_number::text)),'0');
 IF EXISTS(SELECT 1 FROM public.inventory_movements AS prior WHERE upper(btrim(prior.reference))=v_reference)
 THEN RAISE EXCEPTION 'Receipt reference conflict'; END IF;
 v_movement:=public.inv_move(p_operation_id,p_material_id,p_quantity,'purchase',v_reference,p_note);
 INSERT INTO public.inventory_receipt_documents(operation_id,receipt_reference,business_date,receipt_number,
   supplier_source,document_type,po_number,invoice_number)
 VALUES(p_operation_id,v_reference,v_day,v_number,nullif(btrim(p_supplier_source),''),p_document_type,
   nullif(btrim(p_po_number),''),nullif(btrim(p_invoice_number),''));
 SELECT * INTO STRICT v_row FROM public.inventory_movements WHERE id=v_movement;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('movement_id',v_movement,
   'reference',v_reference,'material_id',v_row.material_id,'material_name',v_row.material_name,
   'unit',v_row.unit,'quantity',v_row.delta,'qty_before',v_row.qty_before,'qty_after',v_row.qty_after,
   'version_before',v_row.version_before,'version_after',v_row.version_after));
END $receipt$;

CREATE FUNCTION public.inv_receipt_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $receipt$
BEGIN
 IF current_user<>'inventory_executor' OR TG_OP='DELETE'
   OR (TG_TABLE_NAME='inventory_receipt_documents' AND TG_OP<>'INSERT')
 THEN RAISE EXCEPTION 'Direct receipt metadata write forbidden'; END IF;
 IF TG_TABLE_NAME='inventory_receipt_counters' AND TG_OP='UPDATE' THEN
   IF NEW.business_date IS DISTINCT FROM OLD.business_date OR NEW.last_number<=OLD.last_number
   THEN RAISE EXCEPTION 'Receipt counter must advance'; END IF;
 END IF;
 RETURN NEW;
END $receipt$;

CREATE FUNCTION public.inv_check_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $receipt$
DECLARE v_id uuid; v_op public.inventory_operations%ROWTYPE;
 v_doc public.inventory_receipt_documents%ROWTYPE; v_move public.inventory_movements%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='inventory_operations' THEN v_id:=NEW.id; ELSE v_id:=NEW.operation_id; END IF;
 -- Batch dispatch only; the original v21 body below remains byte-for-byte intact.
 IF EXISTS(SELECT 1 FROM public.inventory_operations WHERE id=v_id AND payload->>'receipt_contract'='v22_batch') THEN
  PERFORM public.inv_validate_receipt_batch(v_id);
  RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='inventory_receipt_documents' THEN
  IF NEW.receipt_contract<>'v21' OR NEW.document_date IS NOT NULL THEN
   RAISE EXCEPTION 'Single receipt metadata mismatch';
  END IF;
 END IF;
 IF TG_TABLE_NAME='inventory_operations' THEN
   v_id:=NEW.id;
   IF NEW.kind<>'purchase' OR NEW.payload->>'receipt_contract' IS DISTINCT FROM 'v21' THEN RETURN NULL; END IF;
 ELSE v_id:=NEW.operation_id;
 END IF;
 SELECT * INTO STRICT v_op FROM public.inventory_operations WHERE id=v_id;
 SELECT * INTO STRICT v_doc FROM public.inventory_receipt_documents WHERE operation_id=v_id;
 SELECT * INTO STRICT v_move FROM public.inventory_movements WHERE operation_id=v_id;
 IF v_op.kind<>'purchase' OR v_op.completed_at IS NULL OR v_op.result IS NULL
   OR v_op.payload->>'receipt_contract' IS DISTINCT FROM 'v21'
   OR v_move.reason<>'purchase' OR v_move.delta<=0
   OR v_move.actor_id IS DISTINCT FROM v_op.actor_id
   OR v_move.reference IS DISTINCT FROM v_doc.receipt_reference
   OR v_move.material_id IS DISTINCT FROM (v_op.payload->>'id')::uuid
   OR v_move.delta IS DISTINCT FROM (v_op.payload->>'qty')::numeric
   OR v_move.note IS DISTINCT FROM (v_op.payload->>'note')
   OR v_doc.document_type IS DISTINCT FROM (v_op.payload->>'document_type')
   OR v_doc.supplier_source IS DISTINCT FROM nullif(btrim(v_op.payload->>'supplier_source'),'')
   OR v_doc.po_number IS DISTINCT FROM nullif(btrim(v_op.payload->>'po_number'),'')
   OR v_doc.invoice_number IS DISTINCT FROM nullif(btrim(v_op.payload->>'invoice_number'),'')
   OR v_doc.business_date IS DISTINCT FROM (v_move.occurred_at AT TIME ZONE 'Asia/Bangkok')::date
   OR NOT EXISTS(SELECT 1 FROM public.inventory_receipt_counters AS c WHERE c.business_date=v_doc.business_date AND c.last_number>=v_doc.receipt_number)
   OR EXISTS(SELECT 1 FROM public.inventory_movement_allocations AS a WHERE a.movement_id=v_move.id)
   OR v_op.result IS DISTINCT FROM jsonb_build_object('movement_id',v_move.id,
     'reference',v_doc.receipt_reference,'material_id',v_move.material_id,'material_name',v_move.material_name,
     'unit',v_move.unit,'quantity',v_move.delta,'qty_before',v_move.qty_before,'qty_after',v_move.qty_after,
     'version_before',v_move.version_before,'version_after',v_move.version_after)
 THEN RAISE EXCEPTION 'Receipt accounting/document mismatch'; END IF;
 RETURN NULL;
END $receipt$;

CREATE FUNCTION public.inv_receipt_batch_lines(p_lines jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $batch$
DECLARE l jsonb; ids uuid[]:='{}'; mid uuid; q numeric; price numeric;
BEGIN
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid batch lines'; END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 OR octet_length(p_lines::text)>262144 THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(l) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid batch line'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(l) k WHERE k NOT IN ('material_id','quantity','unit_purchase_price'))
   OR jsonb_typeof(l->'material_id') IS DISTINCT FROM 'string'
   OR coalesce(l->>'material_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR coalesce(jsonb_typeof(l->'quantity'),'null') NOT IN ('string','number')
   OR coalesce(l->>'quantity','') !~ '^[0-9]+(\.[0-9]+)?$'
   OR length(l->>'quantity')>100
  THEN RAISE EXCEPTION 'Invalid batch line'; END IF;
  mid:=(l->>'material_id')::uuid; q:=(l->>'quantity')::numeric;
  IF q<=0 OR mid=ANY(ids) THEN RAISE EXCEPTION 'Invalid quantity or duplicate material'; END IF;
  ids:=array_append(ids,mid);
  IF l->>'unit_purchase_price' IS NOT NULL THEN
   IF jsonb_typeof(l->'unit_purchase_price') NOT IN ('string','number')
    OR (l->>'unit_purchase_price') !~ '^[0-9]+(\.[0-9]+)?$' OR length(l->>'unit_purchase_price')>100
   THEN RAISE EXCEPTION 'Invalid unit purchase price'; END IF;
   price:=(l->>'unit_purchase_price')::numeric;
   IF price<0 THEN RAISE EXCEPTION 'Invalid unit purchase price'; END IF;
  END IF;
 END LOOP;
END $batch$;

CREATE FUNCTION public.inv_receipt_batch_result(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $batch$
 SELECT jsonb_build_object('operation_id',d.operation_id,'reference',d.receipt_reference,
 'business_date',d.business_date,'lines',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'movement_id',m.id,'material_id',m.material_id,'material_name',m.material_name,'unit',m.unit,
 'quantity',m.delta,'qty_before',m.qty_before,'qty_after',m.qty_after,
 'version_before',m.version_before,'version_after',m.version_after,
 'unit_purchase_price',l.unit_purchase_price) ORDER BY m.material_id)
 FROM public.inventory_movements m JOIN public.inventory_receipt_batch_lines l ON l.movement_id=m.id
 WHERE m.operation_id=p_id),'[]'::jsonb))
 FROM public.inventory_receipt_documents d WHERE d.operation_id=p_id
$batch$;

CREATE FUNCTION public.inventory_receive_purchase_batch(
 p_operation_id uuid,p_lines jsonb,p_supplier_source text DEFAULT NULL,
 p_document_type text DEFAULT 'none',p_po_number text DEFAULT NULL,
 p_invoice_number text DEFAULT NULL,p_document_date date DEFAULT NULL,p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $batch$
DECLARE replay jsonb; payload jsonb; l jsonb; material uuid; movement uuid;
 day date; number bigint; prior numeric; v_reference text; locked integer;
BEGIN
 -- Exact submitted payload, including line order, is the retry identity.
 -- inv_begin enforces active phase, role, actor, retired IDs and the existing writer lock.
 payload:=jsonb_build_object('receipt_contract','v22_batch','lines',p_lines,
 'supplier_source',p_supplier_source,'document_type',p_document_type,'po_number',p_po_number,
 'invoice_number',p_invoice_number,'document_date',p_document_date,'note',p_note);
 replay:=public.inv_begin(p_operation_id,'purchase',payload,ARRAY['admin']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 PERFORM public.inv_receipt_batch_lines(p_lines);
 IF p_document_type IS NULL OR p_document_type NOT IN ('none','po','invoice','both')
  OR length(p_supplier_source)>500 OR length(p_po_number)>200 OR length(p_invoice_number)>200 OR length(p_note)>4000
  OR (p_document_type NOT IN ('po','both') AND nullif(btrim(p_po_number),'') IS NOT NULL)
  OR (p_document_type NOT IN ('invoice','both') AND nullif(btrim(p_invoice_number),'') IS NOT NULL)
  OR (p_document_date IS NOT NULL AND NOT isfinite(p_document_date))
 THEN RAISE EXCEPTION 'Invalid batch document fields'; END IF;
 -- Acquire all material locks in UUID order before any movement or counter update.
 PERFORM m.id FROM public.materials m
 WHERE m.id IN (SELECT (value->>'material_id')::uuid FROM jsonb_array_elements(p_lines)) AND m.is_active
 ORDER BY m.id FOR UPDATE;
 GET DIAGNOSTICS locked=ROW_COUNT;
 IF locked<>jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'Material missing or inactive'; END IF;
 day:=(clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date;
 SELECT coalesce(max(substring(upper(btrim(m.reference)) FROM 14)::numeric),0) INTO prior
 FROM public.inventory_movements m WHERE upper(btrim(m.reference)) ~ ('^RCV-'||to_char(day,'YYYYMMDD')||'-[0-9]{3,}$');
 SELECT greatest(prior,coalesce(c.last_number,0)) INTO prior FROM (SELECT 1) s
 LEFT JOIN public.inventory_receipt_counters c ON c.business_date=day;
 IF prior>=9223372036854775807 THEN RAISE EXCEPTION 'Receipt sequence exhausted'; END IF;
 number:=prior::bigint+1;
 v_reference:='RCV-'||to_char(day,'YYYYMMDD')||'-'||lpad(number::text,greatest(3,length(number::text)),'0');
 IF EXISTS(SELECT 1 FROM public.inventory_movements m WHERE upper(btrim(m.reference))=v_reference)
 THEN RAISE EXCEPTION 'Receipt reference conflict'; END IF;
 INSERT INTO public.inventory_receipt_counters(business_date,last_number) VALUES(day,number)
 ON CONFLICT(business_date) DO UPDATE SET last_number=EXCLUDED.last_number;
 INSERT INTO public.inventory_receipt_documents(operation_id,receipt_reference,business_date,receipt_number,
 supplier_source,document_type,po_number,invoice_number,receipt_contract,document_date)
 VALUES(p_operation_id,v_reference,day,number,nullif(btrim(p_supplier_source),''),p_document_type,
 nullif(btrim(p_po_number),''),nullif(btrim(p_invoice_number),''),'v22_batch',p_document_date);
 FOR l IN SELECT value FROM jsonb_array_elements(p_lines) ORDER BY (value->>'material_id')::uuid LOOP
  material:=(l->>'material_id')::uuid;
  PERFORM public.inv_number((l->>'quantity')::numeric,true);
  movement:=public.inv_move(p_operation_id,material,(l->>'quantity')::numeric,'purchase',v_reference,p_note);
  INSERT INTO public.inventory_receipt_batch_lines(operation_id,material_id,movement_id,unit_purchase_price)
  VALUES(p_operation_id,material,movement,(l->>'unit_purchase_price')::numeric);
 END LOOP;
 -- A midnight-crossing batch fails atomically rather than falsifying movement timestamps.
 RETURN public.inv_finish(p_operation_id,public.inv_receipt_batch_result(p_operation_id));
END $batch$;

CREATE FUNCTION public.inv_validate_receipt_batch(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $batch$
DECLARE o public.inventory_operations%ROWTYPE; d public.inventory_receipt_documents%ROWTYPE; n integer;
BEGIN
 SELECT * INTO STRICT o FROM public.inventory_operations WHERE id=p_id;
 SELECT * INTO STRICT d FROM public.inventory_receipt_documents WHERE operation_id=p_id;
 PERFORM public.inv_receipt_batch_lines(o.payload->'lines');
 n:=jsonb_array_length(o.payload->'lines');
 IF o.kind<>'purchase' OR o.completed_at IS NULL OR o.result IS NULL
  OR o.payload->>'receipt_contract' IS DISTINCT FROM 'v22_batch' OR d.receipt_contract<>'v22_batch'
  OR d.document_type IS DISTINCT FROM o.payload->>'document_type'
  OR d.supplier_source IS DISTINCT FROM nullif(btrim(o.payload->>'supplier_source'),'')
  OR d.po_number IS DISTINCT FROM nullif(btrim(o.payload->>'po_number'),'')
  OR d.invoice_number IS DISTINCT FROM nullif(btrim(o.payload->>'invoice_number'),'')
  OR d.document_date IS DISTINCT FROM (o.payload->>'document_date')::date
  OR (SELECT count(*) FROM public.inventory_movements WHERE operation_id=p_id)<>n
  OR (SELECT count(*) FROM public.inventory_receipt_batch_lines WHERE operation_id=p_id)<>n
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(o.payload->'lines') x
    LEFT JOIN public.inventory_receipt_batch_lines l ON l.operation_id=p_id AND l.material_id=(x->>'material_id')::uuid
    LEFT JOIN public.inventory_movements m ON m.id=l.movement_id
    WHERE m.id IS NULL OR m.operation_id<>p_id OR m.material_id<>l.material_id
     OR m.reason<>'purchase' OR m.delta IS DISTINCT FROM (x->>'quantity')::numeric OR m.delta<=0
     OR m.actor_id IS DISTINCT FROM o.actor_id OR m.reference IS DISTINCT FROM d.receipt_reference
     OR m.note IS DISTINCT FROM o.payload->>'note'
     OR l.unit_purchase_price IS DISTINCT FROM (x->>'unit_purchase_price')::numeric
     OR (m.occurred_at AT TIME ZONE 'Asia/Bangkok')::date<>d.business_date
     OR m.qty_after IS DISTINCT FROM m.qty_before+m.delta OR m.version_after<>m.version_before+1)
  OR EXISTS(SELECT 1 FROM public.inventory_movement_allocations a JOIN public.inventory_movements m ON m.id=a.movement_id WHERE m.operation_id=p_id)
  OR NOT EXISTS(SELECT 1 FROM public.inventory_receipt_counters c WHERE c.business_date=d.business_date AND c.last_number>=d.receipt_number)
  OR o.result IS DISTINCT FROM public.inv_receipt_batch_result(p_id)
 THEN RAISE EXCEPTION 'Batch receipt accounting/document mismatch'; END IF;
END $batch$;

CREATE FUNCTION public.inv_check_receipt_batch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $batch$
BEGIN
 IF TG_TABLE_NAME='inventory_receipt_batch_lines'
 OR EXISTS(SELECT 1 FROM public.inventory_operations WHERE id=NEW.operation_id AND payload->>'receipt_contract'='v22_batch')
 THEN PERFORM public.inv_validate_receipt_batch(NEW.operation_id); END IF;
 RETURN NULL;
END $batch$;

CREATE FUNCTION public.inv_receipt_batch_line_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $batch$
BEGIN
 IF current_user<>'inventory_executor' OR TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Direct batch metadata write forbidden'; END IF;
 RETURN NEW;
END $batch$;

CREATE FUNCTION duplicate_order_private.reference_key(p_ref text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $f$
 SELECT CASE WHEN btrim(p_ref)='' THEN NULL
 WHEN btrim(p_ref) ~* '^(ZG|PL|PN|Z)?[0-9]+$' THEN 'numeric:'||coalesce(nullif(ltrim(regexp_replace(upper(btrim(p_ref)),'^(ZG|PL|PN|Z)',''),'0'),''),'0')
 ELSE 'text:'||lower(btrim(p_ref)) END
$f$;

CREATE FUNCTION duplicate_order_private.register_request(p_request uuid,p_primary uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE t public.transactions%ROWTYPE; policy duplicate_order_private.model_policy%ROWTYPE;
 parent duplicate_order_private.request_identity%ROWTYPE; k text;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(72401,1);
 IF inventory_identity.current_uid() IS NULL OR coalesce(public.inv_role(),'') NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Permission denied'; END IF;
 SELECT * INTO STRICT t FROM public.transactions WHERE id=p_request;
 IF t.created_by IS DISTINCT FROM inventory_identity.current_uid() THEN RAISE EXCEPTION 'Request actor mismatch'; END IF;
 IF t.category='ซ่อมและอื่นๆ' THEN
  IF p_primary IS NOT NULL THEN RAISE EXCEPTION 'Repair cannot link a primary'; END IF; RETURN;
 END IF;
 SELECT * INTO policy FROM duplicate_order_private.model_policy WHERE model_id=t.model_id AND recorded_category=t.category;
 IF NOT FOUND THEN RAISE EXCEPTION 'DUPLICATE_POLICY_REVIEW_REQUIRED'; END IF;
 k:=duplicate_order_private.reference_key(t.order_ref);
 IF k IS NULL THEN RAISE EXCEPTION 'Order reference required'; END IF;
 IF policy.work_kind='supplemental' THEN
  -- Explicit relationship authorization is Admin-only; it is never inferred from a reference.
  IF public.inv_role()<>'admin' OR p_primary IS NULL THEN RAISE EXCEPTION 'PRIMARY_RELATIONSHIP_REQUIRED'; END IF;
  SELECT * INTO parent FROM duplicate_order_private.request_identity WHERE request_id=p_primary;
  IF NOT FOUND OR parent.work_kind<>'primary' OR parent.parent_category<>'CIEM'
   OR parent.parent_category<>policy.parent_category OR parent.reference_key<>k OR p_primary=p_request
  THEN RAISE EXCEPTION 'Invalid primary relationship'; END IF;
 ELSE
  IF p_primary IS NOT NULL THEN RAISE EXCEPTION 'Primary request cannot be supplemental'; END IF;
 END IF;
 INSERT INTO duplicate_order_private.request_identity(request_id,parent_category,reference_key,work_kind,primary_request_id,recorded_by)
 VALUES(p_request,policy.parent_category,k,policy.work_kind,p_primary,inventory_identity.current_uid());
END $f$;

CREATE FUNCTION duplicate_order_private.claim_issues(p_operation uuid, p_lines jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE tid uuid; t public.transactions%ROWTYPE; ident duplicate_order_private.request_identity%ROWTYPE;
 prior duplicate_order_private.issued_identity%ROWTYPE; prior_link uuid; detail jsonb;
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
  IF ident.reference_key IS DISTINCT FROM duplicate_order_private.reference_key(t.order_ref) THEN RAISE EXCEPTION 'Request identity drift'; END IF;
  IF NOT EXISTS(SELECT 1 FROM duplicate_order_private.model_policy p WHERE p.model_id=t.model_id AND p.recorded_category=t.category AND p.parent_category=ident.parent_category AND p.work_kind=ident.work_kind)
  THEN RAISE EXCEPTION 'Recorded category/policy drift'; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_cancellations WHERE transaction_id=tid) THEN RAISE EXCEPTION 'Request cancelled'; END IF;
  IF EXISTS(SELECT 1 FROM duplicate_order_private.issued_identity WHERE request_id=tid AND released_operation_id IS NULL) THEN CONTINUE; END IF;
  FOR prior IN SELECT * FROM duplicate_order_private.issued_identity
   WHERE released_operation_id IS NULL AND parent_category=ident.parent_category AND reference_key=ident.reference_key ORDER BY issued_at,request_id LOOP
   SELECT primary_request_id INTO prior_link FROM duplicate_order_private.request_identity WHERE request_id=prior.request_id;
   IF prior.work_kind<>ident.work_kind AND ident.relationship_basis='new_order_key'
     AND EXISTS(SELECT 1 FROM duplicate_order_private.request_identity old WHERE old.request_id=prior.request_id AND old.relationship_basis='new_order_key') THEN CONTINUE; END IF;
   IF prior.work_kind<>ident.work_kind AND
    ((ident.work_kind='supplemental' AND ident.primary_request_id=prior.request_id) OR
     (ident.work_kind='primary' AND prior_link=tid)) THEN CONTINUE; END IF;
   -- Staff may see reference/date, but only Admin receives another issuer's name.
   SELECT jsonb_build_object('previous_order_ref',tx.order_ref,'issued_at',prior.issued_at,
    'issuer_name',CASE WHEN public.inv_role()='admin' OR prior.issuer_id=inventory_identity.current_uid() THEN pr.full_name ELSE NULL END)
   INTO detail FROM public.transactions tx LEFT JOIN public.profiles pr ON pr.id=prior.issuer_id WHERE tx.id=prior.request_id;
   RAISE EXCEPTION 'DUPLICATE_ORDER_ISSUED' USING ERRCODE='P0001',DETAIL=detail::text;
  END LOOP;
  INSERT INTO duplicate_order_private.issued_identity(request_id,parent_category,reference_key,work_kind,operation_id,issued_at,issuer_id) VALUES(tid,ident.parent_category,ident.reference_key,ident.work_kind,p_operation,clock_timestamp(),inventory_identity.current_uid());
 END LOOP;
END $function$;

CREATE FUNCTION duplicate_order_private.immutable_row() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $f$ BEGIN RAISE EXCEPTION 'Duplicate identity audit is immutable'; END $f$;

CREATE FUNCTION public.inventory_create_package_request(p_operation_id uuid, p_model_id uuid, p_order_ref text, p_repair_spec jsonb, p_primary_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

DECLARE replay jsonb; md public.models%ROWTYPE; bom jsonb; snapshot jsonb:='[]'::jsonb;

 b record; m public.materials%ROWTYPE; tid uuid:=gen_random_uuid(); lname text; cat text;

 staff text; note text; lines jsonb; all_auto boolean:=true; line_uuid uuid;

BEGIN

 replay:=public.inv_begin(p_operation_id,'create_request',jsonb_build_object(

 'model_id',p_model_id,'order_ref',p_order_ref,'repair',p_repair_spec,'primary_request_id',p_primary_request_id),ARRAY['admin']);

 IF replay IS NOT NULL THEN RETURN replay; END IF;

 IF p_primary_request_id IS NULL OR p_repair_spec IS NOT NULL THEN RAISE EXCEPTION 'Explicit Package relationship required'; END IF;

 IF length(btrim(coalesce(p_order_ref,'')))=0 THEN RAISE EXCEPTION 'Order reference required'; END IF;

 SELECT full_name INTO staff FROM public.profiles WHERE id=inventory_identity.current_uid();

 IF length(btrim(coalesce(staff,'')))=0 THEN RAISE EXCEPTION 'Profile name required'; END IF;

 IF p_model_id IS NOT NULL THEN

   IF p_repair_spec IS NOT NULL THEN RAISE EXCEPTION 'Choose model or repair mode'; END IF;

   SELECT * INTO STRICT md FROM public.models WHERE id=p_model_id FOR SHARE;

   IF NOT md.is_active THEN RAISE EXCEPTION 'Model inactive'; END IF;

   lname:=md.name; cat:=md.category; note:='';

   SELECT coalesce(jsonb_agg(jsonb_build_object('material_id',material_id,'qty',qty)),'[]'::jsonb)

   INTO bom FROM public.model_bom WHERE model_id=md.id;

 ELSE

   IF jsonb_typeof(p_repair_spec) IS DISTINCT FROM 'object'

     OR jsonb_typeof(p_repair_spec->'bom') IS DISTINCT FROM 'array'

   THEN RAISE EXCEPTION 'Repair specification with BOM array required'; END IF;

   lname:=p_repair_spec->>'subtype'; cat:='ซ่อมและอื่นๆ'; note:=p_repair_spec->>'note';

   IF lname IS NULL OR lname NOT IN ('CIEM','Tactical','Lifestyle','Sleepplug','อื่นๆ')

      OR length(btrim(coalesce(note,'')))=0 THEN RAISE EXCEPTION 'Invalid repair subtype/reason'; END IF;

   bom:=p_repair_spec->'bom';

 END IF;

 -- inv_begin holds the exclusive advisory writer lock through commit/rollback.

 IF cat IS NULL OR cat NOT IN ('CIEM','Lifestyle','Sleepplug','Tactical','ซ่อมและอื่นๆ')

 THEN RAISE EXCEPTION 'Unsupported request category'; END IF;

 IF cat='ซ่อมและอื่นๆ' AND length(btrim(coalesce(note,'')))=0

 THEN RAISE EXCEPTION 'Repair requests require a nonblank reason; use repair mode'; END IF;



 IF jsonb_array_length(bom)=0 THEN RAISE EXCEPTION 'Empty BOM not enabled; record non-material work outside inventory'; END IF;

 FOR b IN SELECT x FROM jsonb_array_elements(bom) x LOOP

   IF jsonb_typeof(b.x) IS DISTINCT FROM 'object' OR b.x->>'material_id' IS NULL

   THEN RAISE EXCEPTION 'Malformed BOM'; END IF;

   PERFORM (b.x->>'material_id')::uuid;

   PERFORM public.inv_number((b.x->>'qty')::numeric,true);

 END LOOP;

 PERFORM m0.id FROM public.materials m0 WHERE m0.id IN

   (SELECT (x->>'material_id')::uuid FROM jsonb_array_elements(bom) x) ORDER BY m0.id FOR UPDATE;

 FOR b IN SELECT (x->>'material_id')::uuid AS id,sum((x->>'qty')::numeric) qty

   FROM jsonb_array_elements(bom) x GROUP BY (x->>'material_id')::uuid ORDER BY 1 LOOP

   SELECT * INTO m FROM public.materials WHERE id=b.id;

   IF NOT FOUND OR NOT m.is_active THEN RAISE EXCEPTION 'Inactive or missing BOM material %',b.id; END IF;

   PERFORM public.inv_number(b.qty,true);

   line_uuid:=gen_random_uuid();

   snapshot:=snapshot||jsonb_build_array(jsonb_build_object(

     'line_id',line_uuid,'material_id',m.id,'material_name',m.name,'unit',m.unit,'qty',b.qty,

     'requires_picking',m.requires_picking,'picked',false,'received',false));

   all_auto:=all_auto AND NOT m.requires_picking;

 END LOOP;

 INSERT INTO public.transactions(id,model_id,model_name,category,order_ref,staff_name,

   created_by,created_at,bom_snapshot,note,inventory_version)

 VALUES(tid,p_model_id,lname,cat,btrim(p_order_ref),staff,inventory_identity.current_uid(),clock_timestamp(),snapshot,note,1);

 PERFORM duplicate_order_private.register_request(tid,p_primary_request_id);

 RETURN public.inv_finish(p_operation_id,jsonb_build_object('transaction_id',tid,

   'completed',false,'bom_snapshot',(SELECT bom_snapshot FROM public.transactions WHERE id=tid)));

END

$function$;

CREATE FUNCTION duplicate_order_private.guard_issue_release() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Issue audit cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-'released_operation_id') IS DISTINCT FROM (to_jsonb(OLD)-'released_operation_id')
 OR OLD.released_operation_id IS NOT NULL OR NEW.released_operation_id IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.inventory_cancellations c JOIN public.inventory_operations o ON o.id=c.operation_id
 WHERE c.transaction_id=OLD.request_id AND c.operation_id=NEW.released_operation_id
 AND o.kind='cancel_request' AND o.actor_id=inventory_identity.current_uid() AND o.result IS NULL)
 THEN RAISE EXCEPTION 'Only atomic cancellation may release issue claim'; END IF;
 RETURN NEW;
END $f$;

CREATE FUNCTION public.inventory_request_reference_settings() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 PERFORM public.inv_read(ARRAY['admin','staff']);
 RETURN jsonb_build_object('contract','p1-request-reference-v1','models',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'model_id',m.id,'order_prefix',p.prefix,'prefix_revision',coalesce(p.revision,0),'work_kind',d.work_kind)
 ORDER BY m.id) FROM public.models m LEFT JOIN duplicate_order_private.model_prefix p ON p.model_id=m.id
 LEFT JOIN duplicate_order_private.model_policy d ON d.model_id=m.id AND d.recorded_category=m.category WHERE m.is_active),'[]'::jsonb));
END $f$;

CREATE FUNCTION public.inventory_set_model_prefix(p_operation_id uuid,p_model_id uuid,p_prefix text,p_expected_revision bigint,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE replay jsonb; old_revision bigint; old_prefix text;
BEGIN
 replay:=public.inv_begin(p_operation_id,'set_model_prefix',jsonb_build_object('model',p_model_id,'prefix',p_prefix,'expected_revision',p_expected_revision,'reason',p_reason),ARRAY['admin']);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 IF p_prefix IS NULL OR p_prefix NOT IN ('','Z','ZG','PL','PN') OR nullif(btrim(p_reason),'') IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.models WHERE id=p_model_id AND category IN ('Sleepplug','Lifestyle') AND is_active)
 THEN RAISE EXCEPTION 'Invalid prefix configuration'; END IF;
 SELECT prefix,revision INTO old_prefix,old_revision FROM duplicate_order_private.model_prefix WHERE model_id=p_model_id FOR UPDATE;
 IF p_expected_revision IS DISTINCT FROM coalesce(old_revision,0) THEN RAISE EXCEPTION 'Prefix revision conflict'; END IF;
 INSERT INTO duplicate_order_private.model_prefix VALUES(p_model_id,p_prefix,coalesce(old_revision,0)+1)
 ON CONFLICT(model_id) DO UPDATE SET prefix=EXCLUDED.prefix,revision=EXCLUDED.revision;
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('model_id',p_model_id,'prefix',p_prefix,'previous_prefix',old_prefix,'revision',coalesce(old_revision,0)+1));
END $f$;

CREATE FUNCTION duplicate_order_private.register_new_request(p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE t public.transactions%ROWTYPE; p duplicate_order_private.model_policy%ROWTYPE; ref duplicate_order_private.request_reference%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(72401,1);
 IF public.inv_role() NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Permission denied'; END IF;
 SELECT * INTO STRICT t FROM public.transactions WHERE id=p_request;
 SELECT * INTO STRICT ref FROM duplicate_order_private.request_reference WHERE request_id=p_request AND recorded_by=inventory_identity.current_uid();
 IF t.created_by IS DISTINCT FROM inventory_identity.current_uid() THEN RAISE EXCEPTION 'Actor mismatch'; END IF;
 IF t.category='ซ่อมและอื่นๆ' THEN RETURN; END IF;
 SELECT * INTO STRICT p FROM duplicate_order_private.model_policy WHERE model_id=t.model_id AND recorded_category=t.category;
 IF (ref.work_mode='bundled_package') IS DISTINCT FROM (p.work_kind='supplemental') OR (p.work_kind='supplemental' AND p.parent_category<>'CIEM') THEN RAISE EXCEPTION 'Reviewed model role required'; END IF;
 IF p.work_kind='supplemental' AND EXISTS(
 SELECT 1 FROM duplicate_order_private.request_identity i WHERE i.parent_category=p.parent_category
 AND i.reference_key=duplicate_order_private.reference_key(t.order_ref) AND i.work_kind='supplemental'
 AND NOT EXISTS(SELECT 1 FROM public.inventory_cancellations c WHERE c.transaction_id=i.request_id))
 THEN RAISE EXCEPTION 'ACTIVE_PACKAGE_ALREADY_EXISTS'; END IF;
 INSERT INTO duplicate_order_private.request_identity(request_id,parent_category,reference_key,work_kind,primary_request_id,recorded_by,relationship_basis)
 VALUES(t.id,p.parent_category,duplicate_order_private.reference_key(t.order_ref),p.work_kind,NULL,inventory_identity.current_uid(),'new_order_key');
END $f$;

CREATE FUNCTION public.inventory_reference_history(p_reference text,p_category text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE result jsonb;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','staff']);
 IF nullif(btrim(p_reference),'') IS NULL OR nullif(btrim(p_category),'') IS NULL THEN RETURN '[]'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC,x.request_id),'[]'::jsonb) INTO result FROM (
 SELECT t.id request_id,t.order_ref,t.category,t.created_at,i.issued_at
 FROM public.transactions t LEFT JOIN duplicate_order_private.issued_identity i ON i.request_id=t.id
 WHERE (public.inv_role()='admin' OR t.created_by=inventory_identity.current_uid())
 AND (t.category=p_category OR (t.category='ซ่อมและอื่นๆ' AND t.model_name=p_category))
 AND nullif(btrim(t.order_ref),'') IS NOT NULL
 AND duplicate_order_private.reference_key(t.order_ref)=duplicate_order_private.reference_key(p_reference)
 ORDER BY t.created_at DESC,t.id LIMIT 100) x;
 RETURN result;
END $f$;

CREATE FUNCTION duplicate_order_private.guard_package_slot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 PERFORM pg_advisory_xact_lock(72401,1);
 IF NEW.work_kind='supplemental' AND EXISTS(
 SELECT 1 FROM duplicate_order_private.request_identity i
 WHERE i.parent_category=NEW.parent_category AND i.reference_key=NEW.reference_key AND i.work_kind='supplemental'
 AND NOT EXISTS(SELECT 1 FROM public.inventory_cancellations c WHERE c.transaction_id=i.request_id))
 THEN RAISE EXCEPTION 'ACTIVE_PACKAGE_ALREADY_EXISTS'; END IF;
 RETURN NEW;
END $f$;

CREATE FUNCTION public.inventory_create_request_v2(p_operation_id uuid, p_model_id uuid, p_order_ref text, p_repair_spec jsonb, p_work_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

DECLARE raw_input text:=coalesce(p_order_ref,''); selected_prefix text; prefix_version bigint; replay jsonb; md public.models%ROWTYPE; bom jsonb; snapshot jsonb:='[]'::jsonb;

 b record; m public.materials%ROWTYPE; tid uuid:=gen_random_uuid(); lname text; cat text;

 staff text; note text; lines jsonb; all_auto boolean:=true; line_uuid uuid;

BEGIN

 replay:=public.inv_begin(p_operation_id,'create_request',jsonb_build_object(

 'model_id',p_model_id,'order_ref',raw_input,'repair',p_repair_spec,'work_mode',p_work_mode),ARRAY['admin','staff']);

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
    IF NOT EXISTS(SELECT 1 FROM duplicate_order_private.model_policy WHERE model_id=md.id AND recorded_category=md.category AND parent_category='CIEM' AND work_kind='supplemental') THEN RAISE EXCEPTION 'Reviewed Package model required'; END IF;
    IF p_order_ref !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Numeric order input required'; END IF;
    IF p_work_mode='standalone_package' THEN cat:='ซ่อมและอื่นๆ';note:='Standalone Package sale / Others'; END IF;
   ELSIF EXISTS(SELECT 1 FROM duplicate_order_private.model_policy WHERE model_id=md.id AND work_kind='supplemental') THEN RAISE EXCEPTION 'Package work mode required';
   END IF;
   IF md.category IN ('Sleepplug','Lifestyle') AND p_work_mode='standard' THEN
    SELECT prefix,revision INTO selected_prefix,prefix_version FROM duplicate_order_private.model_prefix WHERE model_id=md.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'MODEL_PREFIX_REQUIRED'; END IF;
    IF p_order_ref !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Numeric order input required'; END IF;
    p_order_ref:=selected_prefix||p_order_ref;
   END IF;

   SELECT coalesce(jsonb_agg(jsonb_build_object('material_id',material_id,'qty',qty)),'[]'::jsonb)

   INTO bom FROM public.model_bom WHERE model_id=md.id;

 ELSE

   IF jsonb_typeof(p_repair_spec) IS DISTINCT FROM 'object'

     OR jsonb_typeof(p_repair_spec->'bom') IS DISTINCT FROM 'array'

   THEN RAISE EXCEPTION 'Repair specification with BOM array required'; END IF;

   lname:=p_repair_spec->>'subtype'; cat:='ซ่อมและอื่นๆ'; note:=p_repair_spec->>'note';

   IF lname IS NULL OR lname NOT IN ('CIEM','Tactical','Lifestyle','Sleepplug','อื่นๆ')

      OR length(btrim(coalesce(note,'')))=0 THEN RAISE EXCEPTION 'Invalid repair subtype/reason'; END IF;

   bom:=p_repair_spec->'bom';

 END IF;

 -- inv_begin holds the exclusive advisory writer lock through commit/rollback.

 IF cat IS NULL OR cat NOT IN ('CIEM','Lifestyle','Sleepplug','Tactical','ซ่อมและอื่นๆ')

 THEN RAISE EXCEPTION 'Unsupported request category'; END IF;

 IF cat='ซ่อมและอื่นๆ' AND length(btrim(coalesce(note,'')))=0

 THEN RAISE EXCEPTION 'Repair requests require a nonblank reason; use repair mode'; END IF;



 IF jsonb_array_length(bom)=0 THEN RAISE EXCEPTION 'Empty BOM not enabled; record non-material work outside inventory'; END IF;

 FOR b IN SELECT x FROM jsonb_array_elements(bom) x LOOP

   IF jsonb_typeof(b.x) IS DISTINCT FROM 'object' OR b.x->>'material_id' IS NULL

   THEN RAISE EXCEPTION 'Malformed BOM'; END IF;

   PERFORM (b.x->>'material_id')::uuid;

   PERFORM public.inv_number((b.x->>'qty')::numeric,true);

 END LOOP;

 PERFORM m0.id FROM public.materials m0 WHERE m0.id IN

   (SELECT (x->>'material_id')::uuid FROM jsonb_array_elements(bom) x) ORDER BY m0.id FOR UPDATE;

 FOR b IN SELECT (x->>'material_id')::uuid AS id,sum((x->>'qty')::numeric) qty

   FROM jsonb_array_elements(bom) x GROUP BY (x->>'material_id')::uuid ORDER BY 1 LOOP

   SELECT * INTO m FROM public.materials WHERE id=b.id;

   IF NOT FOUND OR NOT m.is_active THEN RAISE EXCEPTION 'Inactive or missing BOM material %',b.id; END IF;

   PERFORM public.inv_number(b.qty,true);

   line_uuid:=gen_random_uuid();

   snapshot:=snapshot||jsonb_build_array(jsonb_build_object(

     'line_id',line_uuid,'material_id',m.id,'material_name',m.name,'unit',m.unit,'qty',b.qty,

     'requires_picking',m.requires_picking,'picked',false,'received',false));

   all_auto:=all_auto AND NOT m.requires_picking;

 END LOOP;

 INSERT INTO public.transactions(id,model_id,model_name,category,order_ref,staff_name,

   created_by,created_at,bom_snapshot,note,inventory_version)

 VALUES(tid,p_model_id,lname,cat,btrim(p_order_ref),staff,inventory_identity.current_uid(),clock_timestamp(),snapshot,note,1);

 INSERT INTO duplicate_order_private.request_reference(request_id,raw_input,canonical_reference,prefix_revision,work_mode,recorded_by)
 VALUES(tid,raw_input,nullif(p_order_ref,''),prefix_version,p_work_mode,inventory_identity.current_uid());
 PERFORM duplicate_order_private.register_new_request(tid);

 RETURN public.inv_finish(p_operation_id,jsonb_build_object('transaction_id',tid,

   'completed',false,'bom_snapshot',(SELECT bom_snapshot FROM public.transactions WHERE id=tid)));

END

$function$;

CREATE FUNCTION public.inventory_save_model_audited(p_operation_id uuid,p_model_id uuid,p_name text,p_category text,p_bom jsonb,p_reason text,p_expected_bom jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE before_data jsonb; after_data jsonb; answer jsonb; mid uuid; previous duplicate_order_private.bom_history%ROWTYPE; body jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(72401,1);
 PERFORM public.inv_read(ARRAY['admin']);
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'BOM change reason required'; END IF;
 body:=jsonb_build_object('model_id',p_model_id,'name',p_name,'category',p_category,'bom',p_bom,'reason',p_reason,'expected_bom',p_expected_bom);
 SELECT * INTO previous FROM duplicate_order_private.bom_history WHERE operation_id=p_operation_id;
 IF FOUND THEN
 IF previous.actor_id IS DISTINCT FROM inventory_identity.current_uid() OR previous.payload IS DISTINCT FROM body THEN RAISE EXCEPTION 'Operation replay conflict'; END IF;
 RETURN previous.result; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_operations WHERE id=p_operation_id) THEN RAISE EXCEPTION 'Existing operation without BOM audit; review required'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('material_id',material_id,'qty',qty::text) ORDER BY material_id),'[]'::jsonb) INTO before_data FROM public.model_bom WHERE model_id=p_model_id;
 IF before_data IS DISTINCT FROM p_expected_bom THEN RAISE EXCEPTION 'BOM changed; reload before editing'; END IF;
 answer:=public.inventory_save_model(p_operation_id,p_model_id,p_name,p_category,p_bom);
 mid:=coalesce(p_model_id,(answer->>'model_id')::uuid);
 IF mid IS NULL THEN RAISE EXCEPTION 'Unexpected model save result'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('material_id',material_id,'qty',qty::text) ORDER BY material_id),'[]'::jsonb) INTO after_data FROM public.model_bom WHERE model_id=mid;
 INSERT INTO duplicate_order_private.bom_history VALUES(p_operation_id,mid,inventory_identity.current_uid(),clock_timestamp(),p_reason,before_data,after_data,answer,body);
 RETURN answer;
END $f$;

CREATE FUNCTION public.inventory_bom_history(p_model_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 PERFORM public.inv_read(ARRAY['admin']);
 RETURN jsonb_build_object('contract','p1-bom-history-v1','current_bom',coalesce((SELECT jsonb_agg(jsonb_build_object('material_id',material_id,'qty',qty::text) ORDER BY material_id) FROM public.model_bom WHERE model_id=p_model_id),'[]'::jsonb),
 'entries',coalesce((SELECT jsonb_agg(x ORDER BY x.changed_at DESC,x.operation_id) FROM (SELECT operation_id,actor_id,changed_at,reason,before_bom,after_bom FROM duplicate_order_private.bom_history WHERE model_id=p_model_id ORDER BY changed_at DESC,operation_id LIMIT 100) x),'[]'::jsonb));
END $f$;

CREATE FUNCTION public.reporting_publish_mapping_v1(p_revision_id uuid,p_expected_revision bigint,p_entries jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE v_latest bigint; v_existing reporting_private.mapping_revisions; e jsonb; v_actor uuid;
BEGIN
 v_actor:=inventory_identity.current_uid();
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=v_actor AND p.role='admin')
 THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(72401,1);
 PERFORM pg_catalog.pg_advisory_xact_lock(72401,401);
 IF p_revision_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 OR p_entries IS NULL
 OR jsonb_typeof(p_entries)<>'array' THEN RAISE EXCEPTION 'Invalid mapping input'; END IF;
 IF jsonb_array_length(p_entries)=0 OR jsonb_array_length(p_entries)>10000 THEN RAISE EXCEPTION 'Invalid mapping size'; END IF;
 SELECT * INTO v_existing FROM reporting_private.mapping_revisions WHERE revision_id=p_revision_id;
 IF FOUND THEN
  IF v_existing.entries IS DISTINCT FROM p_entries OR v_existing.created_by IS DISTINCT FROM v_actor
  THEN RAISE EXCEPTION 'Revision UUID reuse mismatch'; END IF;
  RETURN jsonb_build_object('revision_id',v_existing.revision_id,'revision_no',v_existing.revision_no::text);
 END IF;
 SELECT coalesce(max(revision_no),0) INTO v_latest FROM reporting_private.mapping_revisions;
 IF v_latest<>p_expected_revision THEN RAISE EXCEPTION 'Mapping revision conflict'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
  IF jsonb_typeof(e)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(e))<>3
  OR jsonb_typeof(e->'model_id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(e->'work_kind') IS DISTINCT FROM 'string'
  OR jsonb_typeof(e->'report_category') IS DISTINCT FROM 'string'
  OR (e->>'work_kind') NOT IN ('primary','supplemental')
  OR (e->>'model_id') IS DISTINCT FROM ((e->>'model_id')::uuid)::text
  OR length(btrim(e->>'report_category')) NOT BETWEEN 1 AND 100
  OR NOT EXISTS(SELECT 1 FROM public.models m WHERE m.id=(e->>'model_id')::uuid)
  THEN RAISE EXCEPTION 'Invalid model mapping'; END IF;
 END LOOP;
 IF (SELECT count(*)<>count(DISTINCT (value->>'model_id')::uuid) FROM jsonb_array_elements(p_entries)) THEN RAISE EXCEPTION 'Duplicate model mapping'; END IF;
 INSERT INTO reporting_private.mapping_revisions(revision_id,created_by,entries) VALUES(p_revision_id,v_actor,p_entries) RETURNING * INTO v_existing;
 RETURN jsonb_build_object('revision_id',v_existing.revision_id,'revision_no',v_existing.revision_no::text);
END $body$;

CREATE FUNCTION public.reporting_read_evidence_v1(p_cutoff_sequence bigint,p_mapping_revision uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $body$
DECLARE result jsonb; v_actor uuid; v_cutoff bigint; v_max bigint; v_count bigint; v_budget numeric;
BEGIN
 v_actor:=inventory_identity.current_uid();
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=v_actor AND p.role='admin')
 THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(72401,1);
 IF p_cutoff_sequence<0 OR p_mapping_revision IS NULL THEN RAISE EXCEPTION 'Invalid reporting input'; END IF;
 SELECT coalesce(max(sequence_no),0) INTO v_max FROM public.inventory_movements;
 v_cutoff:=coalesce(p_cutoff_sequence,v_max);
 IF v_cutoff>v_max THEN RAISE EXCEPTION 'Invalid cutoff'; END IF;
 IF NOT EXISTS(SELECT 1 FROM reporting_private.mapping_revisions WHERE revision_id=p_mapping_revision)
 THEN RAISE EXCEPTION 'Unknown mapping'; END IF;
 -- Counts and conservative serialized-size budget run BEFORE payload aggregation.
 SELECT count(*) INTO v_count FROM (SELECT 1 FROM public.inventory_movements WHERE sequence_no<=v_cutoff AND reason IN ('production_issue','cancellation_return') LIMIT 50001) bounded;
 IF v_count>50000 THEN RAISE EXCEPTION 'REPORT_LIMIT: movements' USING ERRCODE='54000'; END IF;
 SELECT count(*) INTO v_count FROM (SELECT 1 FROM public.inventory_movement_allocations a JOIN public.inventory_movements m ON m.id=a.movement_id WHERE m.sequence_no<=v_cutoff AND m.reason IN ('production_issue','cancellation_return') LIMIT 200001) bounded;
 IF v_count>200000 THEN RAISE EXCEPTION 'REPORT_LIMIT: allocations' USING ERRCODE='54000'; END IF;
 -- Eightfold JSON expansion allowance + per-row framing. Reject above 16 MiB.
 -- Include raw snapshots conservatively; no large aggregate JSON exists at this point.
 WITH moves AS MATERIALIZED (SELECT id,sequence_no,material_id,material_name,unit,delta,reason,occurred_at FROM public.inventory_movements WHERE sequence_no<=v_cutoff AND reason IN ('production_issue','cancellation_return')),
 alloc AS MATERIALIZED (SELECT a.* FROM public.inventory_movement_allocations a JOIN moves m ON m.id=a.movement_id),
 req AS (SELECT t.id,t.model_id,t.model_name,t.category,t.order_ref,t.bom_snapshot FROM public.transactions t WHERE EXISTS(SELECT 1 FROM alloc a WHERE a.transaction_id=t.id)),
 sizes AS (
 SELECT 8::numeric*octet_length(to_jsonb(m)::text)+1024 n FROM moves m
 UNION ALL SELECT 8::numeric*octet_length(to_jsonb(a)::text)+1024 FROM alloc a
 UNION ALL SELECT 32::numeric*octet_length(to_jsonb(r)::text)+1024 FROM req r
 UNION ALL SELECT 8::numeric*octet_length(entries::text)+1024 FROM reporting_private.mapping_revisions WHERE revision_id=p_mapping_revision
 ) SELECT coalesce(sum(n),0)+4096 INTO v_budget FROM sizes;
 IF v_budget>16777216 THEN RAISE EXCEPTION 'REPORT_LIMIT: bytes' USING ERRCODE='54000'; END IF;
 WITH ceiling AS (SELECT coalesce(max(sequence_no),0) n FROM public.inventory_movements),
 cutoff AS (SELECT v_cutoff n,n maximum FROM ceiling),
 mapping AS (SELECT revision_id,entries FROM reporting_private.mapping_revisions WHERE revision_id=p_mapping_revision),
 moves AS MATERIALIZED (
  SELECT m.* FROM public.inventory_movements m,cutoff c WHERE m.sequence_no<=c.n AND m.reason IN ('production_issue','cancellation_return') ORDER BY m.sequence_no LIMIT 50001
 ), alloc AS MATERIALIZED (
  SELECT a.* FROM public.inventory_movement_allocations a JOIN moves m ON m.id=a.movement_id
 ), req AS (
  SELECT t.id,t.model_id,t.model_name,t.category,t.order_ref,
   (SELECT jsonb_agg(jsonb_build_object('line_id',b->>'line_id','material_id',b->>'material_id','unit',b->>'unit') ORDER BY b->>'line_id') FROM jsonb_array_elements(t.bom_snapshot) b) bom_snapshot
  FROM public.transactions t WHERE EXISTS(SELECT 1 FROM alloc a WHERE a.transaction_id=t.id)
 )
 SELECT jsonb_build_object('contract','reporting-evidence-v1','complete',true,'cutoff_sequence',c.n::text,
  'mapping',(SELECT to_jsonb(x) FROM mapping x),
  'over_limit',(SELECT count(*)>50000 FROM moves) OR (SELECT count(*)>200000 FROM alloc),
  'invalid_cutoff',c.n>c.maximum,
  'requests',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM req r),'[]'::jsonb),
  'movements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'sequence_no',m.sequence_no::text,'material_id',m.material_id,'material_name',m.material_name,'unit',m.unit,'delta',m.delta::text,'reason',m.reason,'occurred_at',m.occurred_at,
   'allocations',coalesce((SELECT jsonb_agg(jsonb_build_object('transaction_id',a.transaction_id,'line_id',a.line_id,'order_ref',a.order_ref,'delta',a.delta::text) ORDER BY a.transaction_id,a.line_id) FROM alloc a WHERE a.movement_id=m.id),'[]'::jsonb)) ORDER BY m.sequence_no) FROM moves m),'[]'::jsonb)) INTO result FROM cutoff c;
 IF result->'mapping'='null'::jsonb OR (result->>'over_limit')::boolean OR (result->>'invalid_cutoff')::boolean
 THEN RAISE EXCEPTION 'Unknown mapping, unsupported report size or cutoff'; END IF;
 RETURN result-'over_limit'-'invalid_cutoff';
END $body$;

CREATE FUNCTION public.inventory_setup_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE c public.inventory_control%ROWTYPE;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','staff','purchasing']);
 SELECT * INTO STRICT c FROM public.inventory_control;
 RETURN jsonb_build_object('phase',c.phase,'active',c.active);
END $body$;

CREATE FUNCTION public.inv_finished_move(p_operation uuid,p_request uuid,p_kind text,p_reference text,p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_tx public.transactions%ROWTYPE; v_stock public.inventory_finished_stock%ROWTYPE;
 v_op public.inventory_operations%ROWTYPE; v_remaining bigint; v_delta integer; v_id uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO STRICT v_op FROM public.inventory_operations WHERE id=p_operation;
 IF v_op.actor_id IS DISTINCT FROM inventory_identity.current_uid() OR v_op.result IS NOT NULL
 THEN RAISE EXCEPTION 'Invalid finished operation'; END IF;
 SELECT * INTO STRICT v_tx FROM public.transactions WHERE id=p_request FOR UPDATE;
 IF v_tx.inventory_version<>1 OR v_tx.category<>'Universal' OR v_tx.model_id IS NULL
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_tx.bom_snapshot) AS snap WHERE NOT coalesce((snap->>'picked')::boolean,false))
   OR EXISTS(SELECT 1 FROM public.inventory_cancellations AS closed WHERE closed.transaction_id=p_request)
 THEN RAISE EXCEPTION 'Packing request is not eligible'; END IF;
 IF NOT ((p_kind='pack_in' AND v_op.kind IN ('create_request','confirm_pick'))
   OR (p_kind='out' AND v_op.kind='finished_out') OR (p_kind='pack_cancel' AND v_op.kind='cancel_request'))
 THEN RAISE EXCEPTION 'Finished operation kind mismatch'; END IF;
 SELECT coalesce(sum(fm.delta),0) INTO v_remaining FROM public.inventory_finished_movements AS fm WHERE fm.packing_request_id=p_request;
 IF p_kind='pack_in' THEN
   IF EXISTS(SELECT 1 FROM public.inventory_finished_movements AS prior WHERE prior.packing_request_id=p_request)
   THEN RAISE EXCEPTION 'Packing already recorded'; END IF;
   v_delta:=1;
 ELSE
   IF v_remaining<>1 THEN RAISE EXCEPTION 'Finished item unavailable; outbound packing cannot be returned'; END IF;
   v_delta:=-1;
 END IF;
 INSERT INTO public.inventory_finished_stock(model_id,qty,qty_version) VALUES(v_tx.model_id,0,0) ON CONFLICT(model_id) DO NOTHING;
 SELECT * INTO STRICT v_stock FROM public.inventory_finished_stock WHERE model_id=v_tx.model_id FOR UPDATE;
 IF v_stock.qty+v_delta<0 THEN RAISE EXCEPTION 'Insufficient finished stock'; END IF;
 INSERT INTO public.inventory_finished_movements(id,operation_id,packing_request_id,model_id,model_name,category,kind,delta,qty_before,qty_after,version_before,version_after,actor_id,occurred_at,reference,note)
 VALUES(v_id,p_operation,p_request,v_tx.model_id,v_tx.model_name,v_tx.category,p_kind,v_delta,v_stock.qty,v_stock.qty+v_delta,v_stock.qty_version,v_stock.qty_version+1,inventory_identity.current_uid(),clock_timestamp(),p_reference,p_note);
 UPDATE public.inventory_finished_stock SET qty=v_stock.qty+v_delta,qty_version=v_stock.qty_version+1 WHERE model_id=v_tx.model_id;
 RETURN v_id;
END $fn$;

CREATE FUNCTION public.inv_complete_pack(p_operation uuid,p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM public.transactions AS tx WHERE tx.id=p_request AND tx.category='Universal'
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tx.bom_snapshot) AS snap WHERE NOT coalesce((snap->>'picked')::boolean,false)))
   AND NOT EXISTS(SELECT 1 FROM public.inventory_finished_movements AS fm WHERE fm.packing_request_id=p_request AND fm.kind='pack_in')
 THEN PERFORM public.inv_finished_move(p_operation,p_request,'pack_in',NULL,NULL); END IF;
END $fn$;

CREATE FUNCTION public.inventory_issue_finished(p_operation_id uuid,p_packing_request_id uuid,p_quantity integer,p_reference text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_replay jsonb; v_movement uuid;
BEGIN
 v_replay:=public.inv_begin(p_operation_id,'finished_out',jsonb_build_object('packing_request_id',p_packing_request_id,'quantity',p_quantity,'reference',p_reference,'note',p_note),ARRAY['admin']);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 -- One selected model item per packing request; no pair/side arithmetic.
 IF p_quantity IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Exactly one finished item per packing request'; END IF;
 IF length(btrim(coalesce(p_reference,'')))=0 OR length(btrim(coalesce(p_note,'')))=0
 THEN RAISE EXCEPTION 'Finished outflow reference and note required'; END IF;
 v_movement:=public.inv_finished_move(p_operation_id,p_packing_request_id,'out',p_reference,p_note);
 RETURN public.inv_finish(p_operation_id,jsonb_build_object('movement_id',v_movement,'packing_request_id',p_packing_request_id,'quantity',1));
END $fn$;

CREATE FUNCTION public.inv_close_core(p_operation uuid,p_request uuid,p_reason text,p_legacy_verified boolean,p_closure text,p_returns jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_tx public.transactions%ROWTYPE; v_ctl public.inventory_control%ROWTYPE; v_role text;
 v_has_issue boolean; v_lines jsonb:='[]'::jsonb; v_summary jsonb:='[]'::jsonb; v_snap record;
 v_line_id uuid; v_issued numeric; v_prior_return numeric; v_available numeric; v_return numeric;
 v_group record; v_line jsonb; v_movement uuid; v_closed public.inventory_cancellations%ROWTYPE;
BEGIN
 IF p_closure NOT IN ('cancelled','production_not_completed') OR p_closure IS NULL THEN RAISE EXCEPTION 'Invalid closure kind'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.inventory_operations AS op WHERE op.id=p_operation AND op.kind='cancel_request'
    AND op.actor_id=inventory_identity.current_uid() AND op.result IS NULL) THEN RAISE EXCEPTION 'Invalid closure operation'; END IF;
 v_role:=public.inv_role(); SELECT * INTO STRICT v_ctl FROM public.inventory_control;
 SELECT * INTO STRICT v_tx FROM public.transactions WHERE id=p_request FOR UPDATE;
 IF v_role<>'admin' AND v_tx.created_by IS DISTINCT FROM inventory_identity.current_uid() THEN RAISE EXCEPTION 'Not request owner'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.inventory_movement_allocations AS al WHERE al.transaction_id=p_request)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_tx.bom_snapshot) AS snap WHERE coalesce((snap->>'picked')::boolean,false)) INTO v_has_issue;
 IF v_role<>'admin' AND v_has_issue THEN RAISE EXCEPTION 'Only admin may cancel a request after any stock issue/allocation'; END IF;
 IF v_role<>'admin' AND v_ctl.cancellation_window_seconds>=0
   AND clock_timestamp()>v_tx.created_at+pg_catalog.make_interval(secs=>v_ctl.cancellation_window_seconds)
 THEN RAISE EXCEPTION 'Owner cancellation window expired'; END IF;
 SELECT * INTO v_closed FROM public.inventory_cancellations WHERE transaction_id=p_request;
 IF FOUND THEN
   IF p_closure='production_not_completed' THEN RAISE EXCEPTION 'Request already closed'; END IF;
   RETURN jsonb_build_object('already_cancelled',true);
 END IF;
 IF length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'Cancellation reason required'; END IF;
 IF p_closure='production_not_completed' AND (v_role<>'admin' OR v_tx.inventory_version<>1 OR NOT v_has_issue)
 THEN RAISE EXCEPTION 'Verified issued request and administrator required'; END IF;
 IF v_tx.inventory_version=0 AND v_has_issue AND
   (v_ctl.legacy_return_mode<>'admin_verified' OR v_role<>'admin' OR NOT coalesce(p_legacy_verified,false))
 THEN RAISE EXCEPTION 'Legacy return requires approved mode and administrator physical-return verification'; END IF;
 IF p_closure='production_not_completed' AND jsonb_typeof(p_returns) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Explicit return lines required'; END IF;
 FOR v_snap IN SELECT elem.line,elem.ord FROM jsonb_array_elements(v_tx.bom_snapshot) WITH ORDINALITY AS elem(line,ord) LOOP
   v_line_id:=public.inv_line_id(v_tx.id,v_snap.line,v_snap.ord);
   IF v_tx.inventory_version=0 THEN
     v_issued:=CASE WHEN coalesce((v_snap.line->>'picked')::boolean,false) THEN (v_snap.line->>'qty')::numeric ELSE 0 END;
     v_prior_return:=0;
   ELSE
     SELECT -coalesce(sum(al.delta) FILTER(WHERE mv.reason='production_issue'),0),
       coalesce(sum(al.delta) FILTER(WHERE mv.reason='cancellation_return'),0)
     INTO v_issued,v_prior_return FROM public.inventory_movement_allocations AS al JOIN public.inventory_movements AS mv ON mv.id=al.movement_id
     WHERE al.transaction_id=p_request AND al.line_id=v_line_id;
   END IF;
   v_available:=v_issued-v_prior_return;
   IF v_available<0 THEN RAISE EXCEPTION 'Return ledger inconsistent'; END IF;
   IF v_issued>0 THEN
     IF p_closure='production_not_completed' THEN
       IF (SELECT count(*) FROM jsonb_array_elements(p_returns) AS inp WHERE (inp->>'line_id')::uuid=v_line_id)<>1
       THEN RAISE EXCEPTION 'Exactly one explicit quantity per issued line required'; END IF;
       SELECT (inp->>'quantity')::numeric INTO v_return FROM jsonb_array_elements(p_returns) AS inp WHERE (inp->>'line_id')::uuid=v_line_id;
       PERFORM public.inv_number(v_return);
       IF v_return>v_available THEN RAISE EXCEPTION 'Return exceeds still-returnable issued quantity'; END IF;
     ELSE v_return:=v_available; END IF;
     v_summary:=v_summary||jsonb_build_array(jsonb_build_object('line_id',v_line_id,'material_id',v_snap.line->>'material_id',
       'issued_qty',v_issued,'previously_returned_qty',v_prior_return,'returned_qty',v_return,'consumed_qty',v_available-v_return));
     IF v_return>0 THEN v_lines:=v_lines||jsonb_build_array(jsonb_build_object('line_id',v_line_id,'material_id',v_snap.line->>'material_id','qty',v_return)); END IF;
   END IF;
 END LOOP;
 IF p_closure='production_not_completed' AND jsonb_array_length(p_returns)<>jsonb_array_length(v_summary)
 THEN RAISE EXCEPTION 'Foreign or unissued return line'; END IF;
 -- Reverse still-held finished item before any raw return; outbound source fails atomically.
 IF v_tx.category='Universal' AND EXISTS(SELECT 1 FROM public.inventory_finished_movements AS fm WHERE fm.packing_request_id=p_request AND fm.kind='pack_in')
 THEN PERFORM public.inv_finished_move(p_operation,p_request,'pack_cancel',v_tx.order_ref,p_reason); END IF;
 PERFORM mat.id FROM public.materials AS mat WHERE mat.id IN
   (SELECT (inp->>'material_id')::uuid FROM jsonb_array_elements(v_lines) AS inp) ORDER BY mat.id FOR UPDATE;
 FOR v_group IN SELECT (inp->>'material_id')::uuid AS material_id,sum((inp->>'qty')::numeric) AS qty FROM jsonb_array_elements(v_lines) AS inp GROUP BY 1 LOOP
   v_movement:=public.inv_move(p_operation,v_group.material_id,v_group.qty,'cancellation_return',v_tx.order_ref,p_reason);
   FOR v_line IN SELECT inp FROM jsonb_array_elements(v_lines) AS inp WHERE (inp->>'material_id')::uuid=v_group.material_id LOOP
     INSERT INTO public.inventory_movement_allocations(movement_id,transaction_id,line_id,order_ref,delta,legacy_verified)
     VALUES(v_movement,p_request,(v_line->>'line_id')::uuid,v_tx.order_ref,(v_line->>'qty')::numeric,v_tx.inventory_version=0);
   END LOOP;
 END LOOP;
 INSERT INTO public.inventory_cancellations(transaction_id,operation_id,actor_id,cancelled_at,reason,legacy_verified,closure_kind,return_summary)
 VALUES(p_request,p_operation,inventory_identity.current_uid(),clock_timestamp(),p_reason,
   v_tx.inventory_version=0 AND v_has_issue AND coalesce(p_legacy_verified,false),p_closure,v_summary);
 IF p_closure='cancelled' THEN RETURN jsonb_build_object('transaction_id',p_request,'cancelled',true); END IF;
 RETURN jsonb_build_object('transaction_id',p_request,'closure_kind',p_closure,'closed',true,'return_summary',v_summary);
END $fn$;

CREATE FUNCTION public.inventory_close_not_completed(p_operation_id uuid,p_transaction_id uuid,p_reason text,p_returns jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_replay jsonb; v_normal jsonb; v_item jsonb;
BEGIN
 IF jsonb_typeof(p_returns) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Return array required'; END IF;
 FOR v_item IN SELECT inp FROM jsonb_array_elements(p_returns) AS inp LOOP
   IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR NOT(v_item ? 'line_id' AND v_item ? 'quantity')
     OR v_item-'line_id'-'quantity'<>'{}'::jsonb THEN RAISE EXCEPTION 'Return accepts line_id and quantity only'; END IF;
   PERFORM (v_item->>'line_id')::uuid; PERFORM public.inv_number((v_item->>'quantity')::numeric);
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('line_id',(inp->>'line_id')::uuid,'quantity',(inp->>'quantity')::numeric) ORDER BY (inp->>'line_id')::uuid),'[]'::jsonb)
 INTO v_normal FROM jsonb_array_elements(p_returns) AS inp;
 v_replay:=public.inv_begin(p_operation_id,'cancel_request',jsonb_build_object('id',p_transaction_id,'reason',p_reason,'closure_kind','production_not_completed','returns',v_normal),ARRAY['admin']);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 RETURN public.inv_finish(p_operation_id,public.inv_close_core(p_operation_id,p_transaction_id,p_reason,false,'production_not_completed',v_normal));
END $fn$;

CREATE FUNCTION public.inv_finished_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF current_user<>'inventory_executor' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Direct finished write forbidden'; END IF;
 IF TG_TABLE_NAME='inventory_finished_movements' AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Finished ledger append-only'; END IF;
 IF TG_TABLE_NAME='inventory_finished_stock' AND TG_OP='UPDATE' AND NEW.model_id<>OLD.model_id THEN RAISE EXCEPTION 'Finished identity immutable'; END IF;
 RETURN NEW;
END $fn$;

CREATE FUNCTION public.inv_check_finished() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_model uuid; v_stock public.inventory_finished_stock%ROWTYPE; v_count bigint; v_sum bigint;
BEGIN
 v_model:=NEW.model_id;
 IF TG_TABLE_NAME='transactions' THEN
   IF NEW.category<>'Universal' THEN RETURN NULL; END IF;
 END IF;
 SELECT * INTO v_stock FROM public.inventory_finished_stock WHERE model_id=v_model;
 SELECT count(*),coalesce(sum(fm.delta),0) INTO v_count,v_sum FROM public.inventory_finished_movements AS fm WHERE fm.model_id=v_model;
 IF v_stock.model_id IS NULL THEN
   IF v_count<>0 THEN RAISE EXCEPTION 'Missing finished balance'; END IF;
 ELSIF v_stock.qty<>v_sum OR v_stock.qty_version<>v_count THEN RAISE EXCEPTION 'Finished balance/ledger mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM (
   SELECT fm.*,lag(fm.qty_after,1,0::bigint) OVER(ORDER BY fm.version_after) AS prior_qty,
      row_number() OVER(ORDER BY fm.version_after) AS expected_version
   FROM public.inventory_finished_movements AS fm WHERE fm.model_id=v_model
 ) AS chain WHERE chain.qty_before<>chain.prior_qty OR chain.version_after<>chain.expected_version)
 THEN RAISE EXCEPTION 'Finished version chain mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_finished_movements AS fm JOIN public.inventory_operations AS op ON op.id=fm.operation_id
   JOIN public.transactions AS tx ON tx.id=fm.packing_request_id
   WHERE fm.model_id=v_model AND (op.actor_id<>fm.actor_id OR op.result IS NULL OR op.completed_at IS NULL
     OR tx.category<>'Universal' OR tx.model_id<>fm.model_id OR tx.model_name<>fm.model_name
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(tx.bom_snapshot) AS snap WHERE NOT coalesce((snap->>'picked')::boolean,false))
     OR NOT ((fm.kind='pack_in' AND op.kind IN ('create_request','confirm_pick')) OR (fm.kind='out' AND op.kind='finished_out') OR (fm.kind='pack_cancel' AND op.kind='cancel_request'))
     OR (fm.kind='pack_cancel' AND NOT EXISTS(SELECT 1 FROM public.inventory_cancellations AS cl WHERE cl.transaction_id=tx.id AND cl.operation_id=op.id))))
 THEN RAISE EXCEPTION 'Finished event/operation/request mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_finished_movements AS fm WHERE fm.model_id=v_model GROUP BY fm.packing_request_id
   HAVING sum(fm.delta) NOT IN (0,1) OR count(*) FILTER(WHERE fm.kind='pack_in')<>1 OR count(*) FILTER(WHERE fm.kind<>'pack_in')>1)
 THEN RAISE EXCEPTION 'Duplicate or orphan finished effects'; END IF;
 IF EXISTS(SELECT 1 FROM public.transactions AS tx WHERE tx.model_id=v_model AND tx.category='Universal'
   AND NOT EXISTS(SELECT 1 FROM public.inventory_cancellations AS cl WHERE cl.transaction_id=tx.id)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tx.bom_snapshot) AS snap WHERE NOT coalesce((snap->>'picked')::boolean,false))
   AND NOT EXISTS(SELECT 1 FROM public.inventory_finished_movements AS fm WHERE fm.packing_request_id=tx.id AND fm.kind='pack_in'))
 THEN RAISE EXCEPTION 'Completed pack without finished addition'; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_finished_movements AS fm JOIN public.inventory_cancellations AS cl ON cl.transaction_id=fm.packing_request_id
   WHERE fm.model_id=v_model GROUP BY fm.packing_request_id HAVING sum(fm.delta)<>0 OR count(*) FILTER(WHERE fm.kind='pack_cancel')<>1)
 THEN RAISE EXCEPTION 'Closed packing has unreversed/outbound finished stock'; END IF;
 RETURN NULL;
END $fn$;

CREATE FUNCTION public.inv_check_closure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_tx public.transactions%ROWTYPE; v_summary jsonb; v_line jsonb; v_issued numeric; v_returned numeric; v_delta numeric; v_count bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.inventory_operations AS op WHERE op.id=NEW.operation_id AND op.kind='cancel_request' AND op.actor_id=NEW.actor_id AND op.result IS NOT NULL AND op.completed_at IS NOT NULL) THEN RAISE EXCEPTION 'Closure operation/actor mismatch'; END IF;
 IF NEW.closure_kind='cancelled' THEN RETURN NULL; END IF;
 IF (SELECT count(DISTINCT elem->>'line_id') FROM jsonb_array_elements(NEW.return_summary) AS elem)<>jsonb_array_length(NEW.return_summary) THEN RAISE EXCEPTION 'Duplicate closure summary line'; END IF;
 SELECT * INTO STRICT v_tx FROM public.transactions WHERE id=NEW.transaction_id;
 IF v_tx.inventory_version<>1 OR NEW.legacy_verified OR jsonb_array_length(NEW.return_summary)=0 THEN RAISE EXCEPTION 'Invalid typed closure evidence'; END IF;
 SELECT count(DISTINCT al.line_id) INTO v_count FROM public.inventory_movement_allocations AS al JOIN public.inventory_movements AS mv ON mv.id=al.movement_id
 WHERE al.transaction_id=v_tx.id AND mv.reason='production_issue';
 IF v_count<>jsonb_array_length(NEW.return_summary) THEN RAISE EXCEPTION 'Closure line coverage mismatch'; END IF;
 FOR v_summary IN SELECT elem FROM jsonb_array_elements(NEW.return_summary) AS elem LOOP
   SELECT snap INTO v_line FROM jsonb_array_elements(v_tx.bom_snapshot) AS snap WHERE snap->>'line_id'=v_summary->>'line_id';
   SELECT -coalesce(sum(al.delta) FILTER(WHERE mv.reason='production_issue'),0),coalesce(sum(al.delta) FILTER(WHERE mv.reason='cancellation_return'),0),
     coalesce(sum(al.delta) FILTER(WHERE mv.operation_id=NEW.operation_id AND mv.reason='cancellation_return'),0)
   INTO v_issued,v_returned,v_delta FROM public.inventory_movement_allocations AS al JOIN public.inventory_movements AS mv ON mv.id=al.movement_id
   WHERE al.transaction_id=v_tx.id AND al.line_id=(v_summary->>'line_id')::uuid;
   IF v_line IS NULL OR v_issued<=0 OR v_returned<0 OR v_returned>v_issued
     OR (v_summary->>'issued_qty')::numeric IS DISTINCT FROM v_issued
     OR (v_summary->>'returned_qty')::numeric IS DISTINCT FROM v_delta
     OR (v_summary->>'previously_returned_qty')::numeric IS DISTINCT FROM v_returned-v_delta
     OR (v_summary->>'consumed_qty')::numeric IS DISTINCT FROM v_issued-v_returned
     OR v_summary->>'material_id' IS DISTINCT FROM v_line->>'material_id'
   THEN RAISE EXCEPTION 'Closure allocation summary mismatch'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.inventory_finished_movements AS fm WHERE fm.packing_request_id=v_tx.id)
   AND ((SELECT sum(fm.delta) FROM public.inventory_finished_movements AS fm WHERE fm.packing_request_id=v_tx.id)<>0
     OR NOT EXISTS(SELECT 1 FROM public.inventory_finished_movements AS fm WHERE fm.packing_request_id=v_tx.id AND fm.kind='pack_cancel' AND fm.operation_id=NEW.operation_id))
 THEN RAISE EXCEPTION 'Typed closure failed to reverse finished item'; END IF;
 RETURN NULL;
END $fn$;

CREATE FUNCTION public.inventory_list_finished_stock() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_result jsonb;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','purchasing']);
 SELECT coalesce(jsonb_agg(jsonb_build_object('model_id',fs.model_id,'model_name',md.name,'qty',fs.qty,'qty_version',fs.qty_version,'available_packs',
   (SELECT coalesce(jsonb_agg(to_jsonb(packs)),'[]'::jsonb) FROM (SELECT tx.id AS request_id,tx.model_name,tx.created_by AS responsible_actor,tx.staff_name,tx.created_at
     FROM public.transactions AS tx JOIN public.inventory_finished_movements AS fm ON fm.packing_request_id=tx.id
     WHERE fm.model_id=fs.model_id GROUP BY tx.id HAVING sum(fm.delta)=1 ORDER BY tx.created_at,tx.id) AS packs)) ORDER BY fs.model_id),'[]'::jsonb)
 INTO v_result FROM public.inventory_finished_stock AS fs JOIN public.models AS md ON md.id=fs.model_id;
 RETURN v_result;
END $fn$;

CREATE FUNCTION public.inventory_finished_balance_report(p_date_from date,p_date_to date,p_timezone text DEFAULT 'Asia/Bangkok') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_from timestamptz; v_to timestamptz; v_rows jsonb; v_movements jsonb; v_cutoff bigint;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','purchasing']);
 IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to<p_date_from OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names AS tz WHERE tz.name=p_timezone)
 THEN RAISE EXCEPTION 'Invalid date range/timezone'; END IF;
 v_from:=p_date_from::timestamp AT TIME ZONE p_timezone;v_to:=(p_date_to+1)::timestamp AT TIME ZONE p_timezone;
 SELECT coalesce(max(fm.sequence_no),0) INTO v_cutoff FROM public.inventory_finished_movements AS fm;
 SELECT coalesce(jsonb_agg(to_jsonb(totals) ORDER BY totals.model_id),'[]'::jsonb) INTO v_rows FROM (
   SELECT fs.model_id,md.name AS model_name,coalesce(sum(fm.delta) FILTER(WHERE fm.occurred_at<v_from),0) AS opening,
     coalesce(sum(fm.delta) FILTER(WHERE fm.occurred_at>=v_from AND fm.kind='pack_in'),0) AS packed,
     -coalesce(sum(fm.delta) FILTER(WHERE fm.occurred_at>=v_from AND fm.kind='out'),0) AS outflow,
     -coalesce(sum(fm.delta) FILTER(WHERE fm.occurred_at>=v_from AND fm.kind='pack_cancel'),0) AS packing_reversed,
     coalesce(sum(fm.delta),0) AS closing
   FROM public.inventory_finished_stock AS fs JOIN public.models AS md ON md.id=fs.model_id LEFT JOIN public.inventory_finished_movements AS fm
     ON fm.model_id=fs.model_id AND fm.occurred_at<v_to AND fm.sequence_no<=v_cutoff GROUP BY fs.model_id,md.name
 ) AS totals;
 SELECT coalesce(jsonb_agg(to_jsonb(fm) ORDER BY fm.sequence_no),'[]'::jsonb) INTO v_movements FROM public.inventory_finished_movements AS fm
 WHERE fm.occurred_at>=v_from AND fm.occurred_at<v_to AND fm.sequence_no<=v_cutoff;
 RETURN jsonb_build_object('from',v_from,'to_exclusive',v_to,'timezone',p_timezone,'cutoff_sequence',v_cutoff,'models',v_rows,'movements',v_movements);
END $fn$;

CREATE FUNCTION public.inventory_purchase_category_usage_report(
 p_date_from date,p_date_to date,p_after_sequence bigint DEFAULT 0,
 p_cutoff_sequence bigint DEFAULT NULL,p_limit integer DEFAULT 500
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $usage$
DECLARE cutoff bigint; next_sequence bigint; result jsonb; more boolean;
BEGIN
 PERFORM public.inv_read(ARRAY['admin','purchasing']);
 IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to<p_date_from
 OR p_after_sequence IS NULL OR p_after_sequence<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>500
 THEN RAISE EXCEPTION 'Invalid category usage range/pagination'; END IF;
 SELECT coalesce(max(sequence_no),0) INTO cutoff FROM public.inventory_movements;
 IF p_cutoff_sequence IS NOT NULL THEN
  IF p_cutoff_sequence<0 OR p_cutoff_sequence>cutoff THEN RAISE EXCEPTION 'Invalid category usage cutoff'; END IF;
  cutoff:=p_cutoff_sequence;
 END IF;
 IF p_after_sequence>cutoff THEN RAISE EXCEPTION 'Invalid category usage cursor'; END IF;
 WITH page AS MATERIALIZED (
  SELECT v.* FROM public.inventory_movements v
  WHERE v.sequence_no>p_after_sequence AND v.sequence_no<=cutoff
   AND v.reason IN ('production_issue','cancellation_return')
   AND v.occurred_at >= (p_date_from::timestamp AT TIME ZONE 'Asia/Bangkok')
   AND v.occurred_at < ((p_date_to+1)::timestamp AT TIME ZONE 'Asia/Bangkok')
  ORDER BY v.sequence_no LIMIT p_limit
 ), grouped AS (
  SELECT v.sequence_no,v.occurred_at,v.reason,t.category,t.model_id,t.model_name,
   v.material_id,v.material_name,v.unit,sum(a.delta) AS allocated_delta
  FROM page v JOIN public.inventory_movement_allocations a ON a.movement_id=v.id
  JOIN public.transactions t ON t.id=a.transaction_id
  GROUP BY v.sequence_no,v.occurred_at,v.reason,t.category,t.model_id,t.model_name,v.material_id,v.material_name,v.unit
 )
 SELECT coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.sequence_no,g.category,g.model_id,g.model_name) FROM grouped g),'[]'::jsonb),
 coalesce((SELECT max(sequence_no) FROM page),p_after_sequence) INTO result,next_sequence;
 SELECT EXISTS(SELECT 1 FROM public.inventory_movements v WHERE v.sequence_no>next_sequence AND v.sequence_no<=cutoff
  AND v.reason IN ('production_issue','cancellation_return')
  AND v.occurred_at >= (p_date_from::timestamp AT TIME ZONE 'Asia/Bangkok')
  AND v.occurred_at < ((p_date_to+1)::timestamp AT TIME ZONE 'Asia/Bangkok')) INTO more;
 RETURN jsonb_build_object('rows',result,'cutoff_sequence',cutoff,'next_sequence',next_sequence,'has_more',more);
END $usage$;

DO $permissions$ DECLARE r record; BEGIN
 FOR r IN SELECT c.oid,c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','duplicate_order_private','reporting_private') AND c.relkind='r' LOOP
 EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',r.nspname,r.relname);
 EXECUTE format('REVOKE ALL ON %I.%I FROM PUBLIC,anon,authenticated,service_role',r.nspname,r.relname);
 IF r.relname IN ('profiles','inventory_retired_operation_ids') THEN
 EXECUTE format('GRANT SELECT ON %I.%I TO inventory_executor',r.nspname,r.relname);
 ELSIF r.relname IN ('mapping_revisions','bom_history','request_reference','model_policy','request_identity','inventory_receipt_batch_lines','inventory_receipt_documents','inventory_movement_allocations','inventory_stocktakes','inventory_cancellations','inventory_movements','inventory_material_baselines','inventory_request_policy_audit','inventory_finished_movements') THEN
 EXECUTE format('GRANT SELECT,INSERT ON %I.%I TO inventory_executor',r.nspname,r.relname);
 ELSE EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I.%I TO inventory_executor',r.nspname,r.relname); END IF;
 EXECUTE format('CREATE POLICY executor_all ON %I.%I TO inventory_executor USING(true) WITH CHECK(true)',r.nspname,r.relname);
 END LOOP;
 GRANT DELETE ON public.model_bom TO inventory_executor;
 FOR r IN SELECT c.oid::regclass AS seq FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname IN ('public','reporting_private') LOOP
 EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC,anon,authenticated,service_role',r.seq);
 EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %s TO inventory_executor',r.seq);
 END LOOP;
 FOR r IN SELECT p.oid::regprocedure AS signature,p.proname,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','inventory_identity','duplicate_order_private','reporting_private') AND p.prokind='f' AND (n.nspname<>'public' OR p.proname LIKE 'inv%' OR p.proname LIKE 'reporting_%' OR p.proname='is_admin') LOOP
 IF r.nspname<>'inventory_identity' THEN EXECUTE format('ALTER FUNCTION %s OWNER TO inventory_executor',r.signature); END IF;
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.signature);
 IF r.nspname='public' AND (r.proname LIKE 'inventory_%' OR r.proname LIKE 'reporting_%' OR r.proname='is_admin') AND r.proname NOT IN ('inventory_save_model','inventory_create_package_request') THEN
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.signature); END IF;
 END LOOP;
END $permissions$;
GRANT EXECUTE ON FUNCTION inventory_identity.current_uid() TO inventory_executor;
GRANT SELECT ON public.profiles,public.models,public.model_bom,public.materials,public.transactions,public.stock_log TO authenticated;
CREATE POLICY inventory_material_read ON public.materials FOR SELECT TO authenticated
 USING (public.is_admin() OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.enabled AND p.role='purchasing'));
CREATE POLICY inventory_request_read ON public.transactions FOR SELECT TO authenticated
 USING (public.is_admin() OR (created_by=auth.uid() AND EXISTS(
   SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.enabled AND p.role='staff')));
CREATE POLICY inventory_legacy_log_read ON public.stock_log FOR SELECT TO authenticated
 USING (public.is_admin() OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.enabled AND p.role='purchasing'));
CREATE POLICY inventory_profile_read ON public.profiles FOR SELECT TO authenticated
 USING (id=auth.uid() OR public.is_admin());
CREATE POLICY inventory_model_read ON public.models FOR SELECT TO authenticated USING (EXISTS (SELECT FROM public.profiles WHERE id=auth.uid() AND enabled));
CREATE POLICY inventory_model_bom_read ON public.model_bom FOR SELECT TO authenticated USING (EXISTS (SELECT FROM public.profiles WHERE id=auth.uid() AND enabled));
CREATE TRIGGER inventory_finished_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_finished_stock FOR EACH ROW EXECUTE FUNCTION public.inv_finished_write_guard();
CREATE TRIGGER inventory_finished_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_finished_movements FOR EACH ROW EXECUTE FUNCTION public.inv_finished_write_guard();
CREATE CONSTRAINT TRIGGER inventory_finished_balance_integrity AFTER INSERT OR UPDATE ON public.inventory_finished_stock DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_finished();
CREATE CONSTRAINT TRIGGER inventory_finished_movement_integrity AFTER INSERT ON public.inventory_finished_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_finished();
CREATE CONSTRAINT TRIGGER inventory_finished_request_integrity AFTER INSERT OR UPDATE ON public.transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_finished();
CREATE CONSTRAINT TRIGGER inventory_closure_integrity AFTER INSERT ON public.inventory_cancellations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_closure();
CREATE CONSTRAINT TRIGGER inventory_material_accounting AFTER INSERT OR UPDATE ON public.materials
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_material();
CREATE CONSTRAINT TRIGGER inventory_request_accounting AFTER INSERT OR UPDATE ON public.transactions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_request();
CREATE CONSTRAINT TRIGGER inventory_operation_finalized AFTER INSERT OR UPDATE ON public.inventory_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_operation();
CREATE CONSTRAINT TRIGGER inventory_movement_integrity AFTER INSERT ON public.inventory_movements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_movement();
CREATE CONSTRAINT TRIGGER inventory_allocation_integrity AFTER INSERT ON public.inventory_movement_allocations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_movement();
CREATE TRIGGER inventory_receipt_counter_write_guard BEFORE INSERT OR UPDATE OR DELETE
 ON public.inventory_receipt_counters FOR EACH ROW EXECUTE FUNCTION public.inv_receipt_write_guard();
CREATE TRIGGER inventory_receipt_document_write_guard BEFORE INSERT OR UPDATE OR DELETE
 ON public.inventory_receipt_documents FOR EACH ROW EXECUTE FUNCTION public.inv_receipt_write_guard();
CREATE CONSTRAINT TRIGGER inventory_receipt_document_integrity AFTER INSERT
 ON public.inventory_receipt_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_receipt();
CREATE CONSTRAINT TRIGGER inventory_receipt_operation_integrity AFTER INSERT OR UPDATE
 ON public.inventory_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_receipt();
CREATE TRIGGER inventory_receipt_batch_line_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_receipt_batch_lines
 FOR EACH ROW EXECUTE FUNCTION public.inv_receipt_batch_line_write_guard();
CREATE CONSTRAINT TRIGGER inventory_receipt_batch_line_integrity AFTER INSERT ON public.inventory_receipt_batch_lines
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_receipt_batch();
CREATE CONSTRAINT TRIGGER inventory_receipt_batch_movement_integrity AFTER INSERT ON public.inventory_movements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.inv_check_receipt_batch();
CREATE TRIGGER immutable_identity BEFORE UPDATE OR DELETE ON duplicate_order_private.request_identity FOR EACH ROW EXECUTE FUNCTION duplicate_order_private.immutable_row();
CREATE TRIGGER immutable_issue BEFORE UPDATE OR DELETE ON duplicate_order_private.issued_identity FOR EACH ROW EXECUTE FUNCTION duplicate_order_private.guard_issue_release();
CREATE TRIGGER immutable_reference BEFORE UPDATE OR DELETE ON duplicate_order_private.request_reference FOR EACH ROW EXECUTE FUNCTION duplicate_order_private.immutable_row();
CREATE TRIGGER package_slot BEFORE INSERT ON duplicate_order_private.request_identity
FOR EACH ROW EXECUTE FUNCTION duplicate_order_private.guard_package_slot();
CREATE TRIGGER immutable_bom_history BEFORE UPDATE OR DELETE ON duplicate_order_private.bom_history FOR EACH ROW EXECUTE FUNCTION duplicate_order_private.immutable_row();
CREATE TRIGGER inventory_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.materials FOR EACH ROW EXECUTE FUNCTION public.inv_write_guard();
CREATE TRIGGER inventory_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.models FOR EACH ROW EXECUTE FUNCTION public.inv_write_guard();
CREATE TRIGGER inventory_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.model_bom FOR EACH ROW EXECUTE FUNCTION public.inv_write_guard();
CREATE TRIGGER inventory_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.inv_write_guard();
CREATE TRIGGER inventory_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_operations FOR EACH ROW EXECUTE FUNCTION public.inv_write_guard();
CREATE TRIGGER inventory_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_baseline_batches FOR EACH ROW EXECUTE FUNCTION public.inv_write_guard();
CREATE TRIGGER inventory_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_material_baselines FOR EACH ROW EXECUTE FUNCTION public.inv_write_guard();
CREATE TRIGGER inventory_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.inv_write_guard();
CREATE TRIGGER inventory_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_movement_allocations FOR EACH ROW EXECUTE FUNCTION public.inv_write_guard();
CREATE TRIGGER inventory_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_cancellations FOR EACH ROW EXECUTE FUNCTION public.inv_write_guard();
CREATE TRIGGER inventory_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_stocktakes FOR EACH ROW EXECUTE FUNCTION public.inv_write_guard();

INSERT INTO public.inventory_control(singleton,phase,active,cutoff_at,cancellation_window_seconds,legacy_return_mode,schema_digest)
VALUES(true,4,false,NULL,-1,'blocked',public.inv_schema_digest());
UPDATE public.inventory_control SET legacy_security_snapshot=jsonb_build_object('fresh_ref',current_setting('fresh.verified_project_ref'),'master_sha256',current_setting('fresh.master_sha256'));
INSERT INTO public.inventory_request_policy(singleton) VALUES(true);
UPDATE public.inventory_control SET rpc_digest=(SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\n' ORDER BY p.oid::regprocedure::text)) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'inventory!_%' ESCAPE '!' OR p.proname LIKE 'inv!_%' ESCAPE '!'));
GRANT EXECUTE ON FUNCTION public.inv_schema_digest() TO postgres;
-- Fresh project only. Trusted Auth Admin API sets app_metadata at provisioning.
CREATE FUNCTION inventory_identity.guard_login() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.email IS DISTINCT FROM OLD.email THEN
   RAISE EXCEPTION 'Managed login cannot be renamed';
 END IF;
 IF TG_OP='INSERT' AND (NEW.raw_app_meta_data->>'stock_managed' IS DISTINCT FROM 'true'
   OR NEW.email IS NULL OR NEW.email !~ '^[a-z0-9][a-z0-9._-]{0,63}@iem-workshop[.]local$') THEN
   RAISE EXCEPTION 'Managed account required';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION inventory_identity.guard_login() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_managed_login BEFORE INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION inventory_identity.guard_login();

CREATE TABLE inventory_identity.account_events(
 actor uuid NOT NULL, subject uuid NOT NULL, action text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), details jsonb NOT NULL
);
REVOKE ALL ON inventory_identity.account_events FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.stock_manage_profile(p_actor uuid,p_subject uuid,p_action text,p_name text,p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE login text; old_row public.profiles%ROWTYPE;
BEGIN
 LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
 IF NOT EXISTS(SELECT FROM public.profiles WHERE id=p_actor AND enabled AND role='admin') THEN
   RAISE EXCEPTION 'Admin required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO old_row FROM public.profiles WHERE id=p_subject;
 IF p_action IN ('create','edit') AND (nullif(btrim(p_name),'') IS NULL OR length(p_name)>120
    OR p_role IS NULL OR p_role NOT IN ('admin','staff','purchasing')) THEN RAISE EXCEPTION 'Invalid profile'; END IF;
 IF p_action='create' THEN
   SELECT split_part(email,'@',1) INTO STRICT login FROM auth.users WHERE id=p_subject
    AND email ~ '^[a-z0-9][a-z0-9._-]{0,63}@iem-workshop[.]local$' AND raw_app_meta_data->>'stock_managed'='true';
   INSERT INTO public.profiles(id,username,full_name,role) VALUES(p_subject,login,btrim(p_name),p_role);
 ELSE
   IF old_row.id IS NULL THEN RAISE EXCEPTION 'Unknown account'; END IF;
   IF old_row.enabled AND old_row.role='admin' AND (p_action='disable' OR (p_action='edit' AND p_role<>'admin'))
      AND NOT EXISTS(SELECT FROM public.profiles WHERE id<>p_subject AND enabled AND role='admin') THEN RAISE EXCEPTION 'Last active Admin'; END IF;
   CASE p_action WHEN 'edit' THEN UPDATE public.profiles SET full_name=btrim(p_name),role=p_role WHERE id=p_subject;
    WHEN 'disable' THEN UPDATE public.profiles SET enabled=false WHERE id=p_subject;
    WHEN 'enable' THEN UPDATE public.profiles SET enabled=true WHERE id=p_subject;
    WHEN 'authorize_reset' THEN NULL;
    ELSE RAISE EXCEPTION 'Invalid action';
   END CASE;
 END IF;
 INSERT INTO inventory_identity.account_events VALUES(p_actor,p_subject,p_action,clock_timestamp(),
 jsonb_build_object('previous_role',old_row.role,'previous_enabled',old_row.enabled,'requested_role',p_role));
END $$;
REVOKE ALL ON FUNCTION public.stock_manage_profile(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stock_manage_profile(uuid,uuid,text,text,text) TO service_role;

CREATE FUNCTION inventory_identity.provision_login() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.stock_manage_profile((NEW.raw_app_meta_data->>'stock_actor')::uuid,NEW.id,'create',
   NEW.raw_app_meta_data->>'stock_name',NEW.raw_app_meta_data->>'stock_role');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION inventory_identity.provision_login() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_provision_login AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION inventory_identity.provision_login();


-- Configure as Custom Access Token Hook in the fresh project's Auth settings.
CREATE FUNCTION public.stock_access_token_hook(event jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM public.profiles WHERE id=(event->>'user_id')::uuid AND enabled) THEN
   RETURN jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Account unavailable'));
 END IF;
 RETURN event;
END $$;
REVOKE ALL ON FUNCTION public.stock_access_token_hook(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.stock_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- Installer supplies UTF-8 validated JSON and its independently reviewed SHA-256.
-- Auth users must already have been invited and verified in the NEW project.
DO $seed_guard$
DECLARE raw text:=current_setting('fresh.master_json',true); data jsonb; actor uuid:=current_setting('fresh.approved_admin_uuid',true)::uuid;
BEGIN
 IF raw IS NULL OR encode(sha256(convert_to(raw,'UTF8')),'hex') IS DISTINCT FROM current_setting('fresh.master_sha256',true) THEN RAISE EXCEPTION 'Approved master seed digest required'; END IF;
 data:=raw::jsonb;
 IF NOT (data ?& ARRAY['profiles','materials','models','bom','model_policies','prefixes']) OR data-ARRAY['profiles','materials','models','bom','model_policies','prefixes']<>'{}'::jsonb THEN RAISE EXCEPTION 'Unexpected master sections'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(data->'profiles') p(id uuid,role text) WHERE p.id=actor AND p.role='admin') THEN RAISE EXCEPTION 'Named new-project Admin approval required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(data->'profiles') p(id uuid) LEFT JOIN auth.users u ON u.id=p.id WHERE u.id IS NULL OR u.confirmed_at IS NULL OR u.raw_app_meta_data->>'stock_managed' IS DISTINCT FROM 'true' OR u.email IS NULL OR u.email !~ '^[a-z0-9][a-z0-9._-]{0,63}@iem-workshop[.]local$') THEN RAISE EXCEPTION 'Provision and confirm new Auth users first'; END IF;
 IF EXISTS(SELECT FROM auth.users u WHERE NOT EXISTS(SELECT FROM jsonb_to_recordset(data->'profiles') p(id uuid) WHERE p.id=u.id)) THEN RAISE EXCEPTION 'Unexpected Auth account on fresh target'; END IF;
 INSERT INTO public.profiles(id,username,full_name,role) SELECT p.id,split_part(u.email,'@',1),p.full_name,p.role FROM jsonb_to_recordset(data->'profiles') p(id uuid,full_name text,role text) JOIN auth.users u ON u.id=p.id;
END $seed_guard$;
SET LOCAL ROLE inventory_executor;
DO $seed$
DECLARE data jsonb:=current_setting('fresh.master_json')::jsonb; actor uuid:=current_setting('fresh.approved_admin_uuid')::uuid; item record; op uuid; stamp timestamptz;
BEGIN
 FOR item IN SELECT * FROM jsonb_to_recordset(data->'materials') m(id uuid,name text,unit text,low_stock_threshold numeric,requires_picking boolean,is_active boolean,qty numeric,qty_version bigint) LOOP
  IF item.qty IS DISTINCT FROM 0 OR item.qty_version IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Nonzero or missing zero-origin values'; END IF;
  op:=gen_random_uuid();stamp:=clock_timestamp();
  INSERT INTO public.inventory_operations(id,actor_id,kind,payload,result,completed_at) VALUES(op,actor,'create_material',jsonb_build_object('source','fresh_master','master_sha256',current_setting('fresh.master_sha256')),jsonb_build_object('material_id',item.id,'qty',0),stamp);
  INSERT INTO public.materials(id,name,unit,low_stock_threshold,requires_picking,is_active,qty,qty_version) VALUES(item.id,item.name,item.unit,item.low_stock_threshold,item.requires_picking,item.is_active,0,0);
  INSERT INTO public.inventory_material_baselines(material_id,operation_id,effective_at,qty,qty_version,material_name,unit,provenance,note) VALUES(item.id,op,stamp,0,0,item.name,item.unit,'new_material_zero','Fresh Start v1.2 master seed');
 END LOOP;
 INSERT INTO public.models(id,name,category,is_active) SELECT id,name,category,is_active FROM jsonb_to_recordset(data->'models') m(id uuid,name text,category text,is_active boolean);
 INSERT INTO public.model_bom(model_id,material_id,qty) SELECT model_id,material_id,public.inv_number(qty,true) FROM jsonb_to_recordset(data->'bom') b(model_id uuid,material_id uuid,qty numeric);
 INSERT INTO duplicate_order_private.model_policy(model_id,recorded_category,parent_category,work_kind) SELECT p.model_id,m.category,p.parent_category,p.work_kind FROM jsonb_to_recordset(data->'model_policies') p(model_id uuid,parent_category text,work_kind text) JOIN public.models m ON m.id=p.model_id;
 INSERT INTO duplicate_order_private.model_prefix(model_id,prefix,revision) SELECT model_id,prefix,1 FROM jsonb_to_recordset(data->'prefixes') p(model_id uuid,prefix text);
END $seed$;
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

REVOKE CREATE ON SCHEMA public FROM inventory_executor;
REVOKE inventory_executor FROM postgres GRANTED BY postgres;
DO $membership_cleanup$
BEGIN
 IF pg_has_role('postgres','inventory_executor','SET') OR pg_has_role('postgres','inventory_executor','USAGE') THEN
   RAISE EXCEPTION 'Temporary executor access still present';
 END IF;
END $membership_cleanup$;
NOTIFY pgrst,'reload schema';
COMMIT;
