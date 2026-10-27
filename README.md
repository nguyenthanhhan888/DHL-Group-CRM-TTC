# DHL CRM

DHL CRM là hệ thống quản lý khách hàng, kiosk, đăng ký, thanh toán, gia hạn, nhân sự và báo cáo vận hành. Ứng dụng gồm giao diện công khai cho khách hàng và khu vực CRM dành cho người dùng nội bộ có quyền phù hợp.

Tài liệu này phản ánh code, migration và các quy tắc nghiệp vụ đã được chủ dự án phê duyệt. Khi tài liệu lịch sử mâu thuẫn với source hoặc tài liệu chính hiện hành, không dùng tài liệu lịch sử làm nguồn sự thật.

## Kiến trúc

- Frontend là SPA viết bằng JavaScript ES modules, HTML và CSS; entrypoint là `index.html` và `src/app.js`.
- Router phía trình duyệt quản lý các trang công khai, trang cá nhân và các module CRM.
- `src/services/` gọi Supabase trực tiếp qua client công khai hoặc gọi các endpoint cùng domain trong `api/`.
- Supabase cung cấp Auth, PostgreSQL, RLS, RPC, Storage và Edge Functions. Nghiệp vụ nhạy cảm được kiểm tra tại RLS/RPC/API, không chỉ tại giao diện.
- Vercel phục vụ frontend tĩnh và các Serverless Functions trong `api/`. `vercel.json` chạy `npm run build` và giữ rewrite tương thích `/api/staff` sang `/api/user-management?compat=staff`.

Các nhóm route chính:

- Công khai: trang chủ, đăng ký mới, đăng ký Legacy, tra cứu, đăng nhập và đăng ký tài khoản.
- Cá nhân: hồ sơ, thông báo, hỗ trợ, kiosk của tôi, đăng ký kiosk và thanh toán của tôi.
- CRM: dashboard, khách hàng, kiosk, yêu cầu đăng ký, công việc, thanh toán, danh mục, loại hình, khuyến mãi, chi phí và báo cáo.
- Nhân sự và hệ thống: employees, quản lý người dùng/quyền, nhật ký, nội dung trang chủ và cài đặt.

## Cấu trúc chính

```text
.
├── api/                 # Vercel Serverless Functions
├── docs/                # Tài liệu nghiệp vụ, database và triển khai
├── scripts/             # Build config và local development server
├── src/
│   ├── app.js           # Entrypoint và định tuyến SPA
│   ├── components/      # Thành phần giao diện dùng lại
│   ├── layouts/         # Khung giao diện
│   ├── pages/           # Các trang/route
│   ├── services/        # Supabase/RPC/API clients
│   ├── styles/          # CSS
│   └── utils/           # Tiện ích dùng chung
├── supabase/
│   ├── functions/       # Supabase Edge Functions
│   └── migrations/      # Lịch sử schema/RPC/RLS
├── tests/               # Node test suite và fixtures
├── index.html
├── package.json
└── vercel.json
```

## Chạy local

Yêu cầu Node.js 22 trở lên.

```bash
npm install
cp config.example.js config.local.js
node scripts/dev-server.cjs
```

Điền cấu hình Supabase công khai vào `config.local.js`; file này bị Git bỏ qua. Local server mặc định chạy tại `http://localhost:8010`. Để kiểm tra đầy đủ hành vi Vercel Serverless Functions, dùng `npx vercel dev` với biến môi trường local hợp lệ.

Không đưa service-role key, PayOS secret hoặc secret server-side vào `config.js`, `config.local.js` hay source frontend.

## Test và build

```bash
npm test
npm run build
```

`npm test` chạy các test phù hợp mẫu `tests/*.test.*`. Lệnh build chạy `scripts/generate-config.mjs` để tạo `config.js` từ `SUPABASE_URL` và `SUPABASE_ANON_KEY`; vì vậy hai biến này phải tồn tại trong môi trường build.

## Tài liệu chính

- [Quy tắc nghiệp vụ](./docs/BUSINESS_RULES.md)
- [Database, RPC và phân quyền](./docs/DATABASE.md)
- [Triển khai Vercel và Supabase](./docs/DEPLOYMENT.md)

Tài liệu đặc tả Word ở thư mục gốc được giữ như hồ sơ lịch sử, không phải mô tả chắc chắn của hệ thống hiện tại.
