-- REVIEW ONLY: requires separately approved target/source/ACL preflight.
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(72401,1);
DO $g$ BEGIN
 IF (SELECT count(*)=1 AND bool_and(phase=4 AND schema_digest=public.inv_schema_digest()) FROM public.inventory_control) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Control/schema mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.inv_begin(uuid,text,jsonb,text[])') AND md5(prosrc)='54fa03b1cbc567bc8ca8a88bad870379' AND prosecdef AND proowner='inventory_executor'::regrole AND proconfig=ARRAY['search_path=""']) THEN RAISE EXCEPTION 'Source mismatch'; END IF;
 IF (SELECT rpc_digest FROM public.inventory_control) IS DISTINCT FROM (SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\n' ORDER BY p.oid::regprocedure::text)) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'inventory!_%' ESCAPE '!' OR p.proname LIKE 'inv!_%' ESCAPE '!')) THEN RAISE EXCEPTION 'RPC digest mismatch'; END IF;
END $g$;
CREATE TABLE public.inventory_request_policy(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),employee_requests_enabled boolean NOT NULL DEFAULT true,revision bigint NOT NULL DEFAULT 0,updated_by uuid REFERENCES public.profiles(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
INSERT INTO public.inventory_request_policy(singleton) VALUES(true);
CREATE TABLE public.inventory_request_policy_audit(operation_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES public.profiles(id),enabled boolean NOT NULL,expected_revision bigint NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.inventory_request_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_request_policy_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_request_policy,public.inventory_request_policy_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,UPDATE ON public.inventory_request_policy TO inventory_executor;
GRANT SELECT,INSERT ON public.inventory_request_policy_audit TO inventory_executor;
CREATE POLICY executor_policy ON public.inventory_request_policy TO inventory_executor USING(true) WITH CHECK(true);
CREATE POLICY executor_audit ON public.inventory_request_policy_audit TO inventory_executor USING(true) WITH CHECK(true);
DO $patch$ DECLARE definition text; anchor text:=' INSERT INTO public.inventory_operations(id,actor_id,kind,payload)'; BEGIN
 definition:=pg_get_functiondef('public.inv_begin(uuid,text,jsonb,text[])'::regprocedure);
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Anchor mismatch'; END IF;
 EXECUTE replace(definition,anchor,$gate$
 IF EXISTS(SELECT 1 FROM public.inventory_request_policy_audit WHERE operation_id=p_id) THEN RAISE EXCEPTION 'Operation ID conflict'; END IF;
 IF p_kind='create_request' AND r<>'admin' AND NOT EXISTS(SELECT 1 FROM public.inventory_request_policy WHERE singleton AND employee_requests_enabled) THEN RAISE EXCEPTION 'NEW_REQUESTS_DISABLED' USING ERRCODE='P0001'; END IF;
$gate$||anchor);
END $patch$;
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
ALTER FUNCTION public.inventory_request_policy() OWNER TO inventory_executor;
ALTER FUNCTION public.inventory_set_request_policy(uuid,boolean,bigint) OWNER TO inventory_executor;
REVOKE ALL ON FUNCTION public.inventory_request_policy(),public.inventory_set_request_policy(uuid,boolean,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.inventory_request_policy(),public.inventory_set_request_policy(uuid,boolean,bigint) TO authenticated;
UPDATE public.inventory_control SET schema_digest=public.inv_schema_digest(),rpc_digest=(SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\n' ORDER BY p.oid::regprocedure::text)) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'inventory!_%' ESCAPE '!' OR p.proname LIKE 'inv!_%' ESCAPE '!'));
COMMIT;
