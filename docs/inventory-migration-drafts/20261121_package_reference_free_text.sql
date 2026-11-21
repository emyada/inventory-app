-- Package (supplemental) order reference may contain letters (e.g. CL908).
-- Only the Package branch of inventory_create_request_v2 changes; standard models keep the numeric+prefix rule.
GRANT inventory_executor TO postgres WITH SET TRUE, INHERIT FALSE;
GRANT CREATE ON SCHEMA public TO inventory_executor;
SET LOCAL ROLE inventory_executor;
DO $mig$
DECLARE d text; d2 text;
 old text := E'IF p_order_ref !~ ''^[0-9]+$'' THEN RAISE EXCEPTION ''Numeric order input required''; END IF;\n    IF p_work_mode=''standalone_package''';
 new text := E'IF p_work_mode=''standalone_package''';
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='inventory_create_request_v2';
 IF position(old IN d)=0 THEN RAISE EXCEPTION 'expected Package numeric check not found'; END IF;
 d2:=replace(d,old,new);
 EXECUTE d2;
END $mig$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM inventory_executor;
REVOKE SET OPTION FOR inventory_executor FROM postgres;
