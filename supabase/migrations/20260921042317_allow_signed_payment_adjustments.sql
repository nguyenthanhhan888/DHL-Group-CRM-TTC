alter table public.payments
  drop constraint payments_total_amount_check;

alter table public.payments
  add constraint payments_total_amount_check
  check (
    (transaction_type = 'standard' and total_amount >= 0)
    or
    (transaction_type = 'adjustment' and total_amount <> 0)
  );;
