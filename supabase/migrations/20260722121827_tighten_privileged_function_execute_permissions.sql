
revoke execute on function public.approve_registration_request(bigint) from public, anon;
revoke execute on function public.reject_registration_request(bigint, text) from public, anon;
revoke execute on function public.confirm_payment(bigint) from public, anon;

revoke execute on function public.log_changes() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.update_customer_kiosk_count() from public, anon, authenticated;

-- submit_registration_request is intentionally public: it validates inputs and only creates a pending request.
revoke execute on function public.submit_registration_request(text, text, text, text, text, text, bigint, bigint, integer, numeric, text) from public;
grant execute on function public.submit_registration_request(text, text, text, text, text, text, bigint, bigint, integer, numeric, text) to anon, authenticated;

-- Future functions should not be executable by API roles unless explicitly granted.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
;
