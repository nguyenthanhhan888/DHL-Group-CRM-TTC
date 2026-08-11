import { PublicSupport } from '../components/PublicSupport.js';
import { PUBLIC_BRAND } from '../config/organization.js';

export function HomePage() {
  return `<div class="portal-home">
    <section class="portal-hero">
      <div class="portal-hero-copy"><span class="portal-eyebrow">Cổng thông tin Kiosk chính thức</span>
        <h1>${PUBLIC_BRAND.communityName} <svg viewBox="0 0 40 24" aria-hidden="true"><path d="M2 12h30m-8-8 8 8-8 8"/></svg> <em>${PUBLIC_BRAND.shortName}</em></h1>
        <p>Đăng ký, bổ sung và tra cứu Kiosk tại một cổng thông tin rõ ràng, an toàn và được Ban quản trị hỗ trợ trực tiếp.</p>
        <div class="portal-hero-actions"><a class="btn-primary" href="#/register">Đăng ký Kiosk</a><a class="btn-secondary" href="#/lookup">Tra cứu Kiosk</a></div>
      </div>
      <div class="portal-hero-visual community-avatar-stage">
        <span class="community-avatar-halo" aria-hidden="true"></span>
        <figure class="community-avatar-card">
          <img src="${PUBLIC_BRAND.assets.avatar}" alt="Ảnh đại diện cộng đồng ${PUBLIC_BRAND.communityName}" width="1254" height="1254">
          <figcaption><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.2 16.2-4-4 2-2 2 2 7-7 2 2-9 9Z"/></svg><span>Cộng đồng chính thức</span></figcaption>
        </figure>
      </div>
      <ul class="portal-hero-trust" aria-label="Ưu điểm của cổng Kiosk">
        <li><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9"/></svg>Quy trình rõ ràng</li>
        <li><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9"/></svg>Thanh toán PayOS</li>
        <li><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9"/></svg>Hỗ trợ trực tiếp</li>
      </ul>
    </section>
    <section class="portal-section"><div class="portal-section-heading"><span>Dịch vụ công khai</span><h2>Mọi thao tác Kiosk tại một nơi</h2><p>Chọn đúng nhu cầu để gửi thông tin nhanh chóng và an toàn.</p></div>
      <div class="service-grid">${service('01','Đăng ký Kiosk','Đăng ký mới, chọn loại hình và thanh toán tự động qua PayOS.','register','Bắt đầu đăng ký')}${service('02','Bổ sung Kiosk','Hoàn thiện dữ liệu Kiosk đã đăng ký trước đây để quản trị viên kiểm tra.','legacy-registration','Bổ sung thông tin')}${service('03','Tra cứu Kiosk','Kiểm tra trạng thái và thời hạn Kiosk bằng số điện thoại đã đăng ký.','lookup','Tra cứu ngay')}</div>
    </section>
    <section class="member-banner"><div><span>Khu vực thành viên</span><h2>Quản lý Kiosk và tham gia TTC</h2><p>Đăng nhập để truy cập các tiện ích dành riêng cho thành viên cộng đồng.</p></div><a class="btn-secondary" href="#/login">Đăng nhập tài khoản</a></section>
    <section class="portal-section"><div class="portal-section-heading"><span>Kênh chính thức</span><h2>Kết nối đúng nơi, nhận hỗ trợ đúng lúc</h2></div>${PublicSupport()}</section>
  </div>`;
}
function service(number,title,text,route,cta){return `<article class="service-card"><span>${number}</span><h3>${title}</h3><p>${text}</p><a href="#/${route}">${cta} →</a></article>`}
