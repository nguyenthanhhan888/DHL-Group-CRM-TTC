
comment on column public.customers.total_paid is
'Tổng thanh toán tích lũy của khách hàng: tiền gói chung ban đầu cộng tất cả thanh toán của các kiosk';

comment on column public.kiosks.total_paid is
'Số tiền của kỳ thanh toán hiện tại hoặc kỳ gần nhất của riêng kiosk';

comment on column public.kiosks.kiosk_total_paid is
'Tổng thanh toán tích lũy qua tất cả các kỳ của riêng kiosk';

comment on column public.payments.total_amount is
'Số tiền của một lần hoặc một kỳ thanh toán';

comment on column public.payments.kiosk_id is
'Kiosk nhận thanh toán; để trống khi khoản tiền là gói chung cấp khách hàng';
;
