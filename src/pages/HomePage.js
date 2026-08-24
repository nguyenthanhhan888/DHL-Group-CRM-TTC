import { PublicSupport } from '../components/PublicSupport.js';
import { PUBLIC_BRAND } from '../config/organization.js';
import { renderIcon } from '../utils/icons.js';

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
      <div class="service-grid">${service('store','Đăng ký Kiosk','Tạo Kiosk mới và thanh toán an toàn qua PayOS.','register','Bắt đầu đăng ký')}${service('user-plus','Bổ sung Kiosk','Thêm Kiosk đã đăng ký trước đây để Ban quản trị kiểm tra.','legacy-registration','Bổ sung Kiosk')}${service('search','Tra cứu Kiosk','Xem trạng thái và thời hạn bằng số điện thoại.','lookup','Tra cứu ngay')}</div>
    </section>
    <section class="portal-section kiosk-process"><div class="portal-section-heading"><span>Quy trình</span><h2>Kiosk hoạt động như thế nào?</h2><p>Bốn bước ngắn từ đăng ký đến khi Kiosk được hệ thống nhận diện.</p></div><ol class="kiosk-process-grid">${processStep('link','Đăng ký','Gửi Facebook và ngành nghề.')}${processStep('wallet','Thanh toán','Thanh toán an toàn qua PayOS.')}${processStep('shield','Xác nhận','Hệ thống xác nhận giao dịch.')}${processStep('check-circle','Nhận diện Kiosk','Hỗ trợ nhận diện khi duyệt bài.')}</ol></section>
    <section class="member-banner"><div><span>Khu vực thành viên</span><h2>Quản lý Kiosk của bạn</h2><p>Đăng nhập để xem Kiosk và các tiện ích thành viên.</p></div><a class="btn-secondary" href="#/login">Đăng nhập tài khoản</a></section>
    <section class="portal-section"><div class="portal-section-heading"><span>Kênh chính thức</span><h2>Kết nối đúng nơi, nhận hỗ trợ đúng lúc</h2></div>${PublicSupport()}</section>
  </div>`;
}
function service(icon,title,text,route,cta){return `<article class="service-card"><span class="service-card-icon" aria-hidden="true">${renderIcon(icon)}</span><h3>${title}</h3><p>${text}</p><a href="#/${route}">${cta} ${renderIcon('chevron-right')}</a></article>`}
function processStep(icon,title,text){return `<li><span aria-hidden="true">${renderIcon(icon)}</span><div><strong>${title}</strong><p>${text}</p></div></li>`;}
