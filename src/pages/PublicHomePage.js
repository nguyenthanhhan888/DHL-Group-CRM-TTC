import { PUBLIC_LINKS, PublicSupportBlock } from '../components/PublicLayout.js';

export function PublicHomePage() {
  return `
    <section class="public-hero">
      <div class="public-hero-copy">
        <span class="public-eyebrow">Cổng cộng đồng chính thức</span>
        <h1>Diễn Châu - À Đây Rồi <span>(DHL)</span></h1>
        <p class="public-hero-lead">Cổng quản lý Kiosk, đăng ký quảng cáo và hỗ trợ cộng đồng Diễn Châu - À Đây Rồi.</p>
        <div class="public-hero-actions"><a class="btn-primary link-button" href="#/register">Đăng ký Kiosk</a><a class="btn-secondary link-button" href="#/tra-cuu-kiosk">Tra cứu Kiosk</a><a class="public-text-link" href="${PUBLIC_LINKS.mainGroup}" target="_blank" rel="noopener noreferrer">Tham gia Group chính ↗</a></div>
        <div class="public-trust-line"><span>✓ Quy trình rõ ràng</span><span>✓ Thanh toán PayOS</span><span>✓ Hỗ trợ trực tiếp</span></div>
      </div>
      <div class="public-hero-panel" aria-label="Các tác vụ phổ biến">
        <div class="public-hero-logo"><img src="images/cover.PNG" alt="Cộng đồng Diễn Châu - À Đây Rồi" /></div>
        <div class="public-hero-quick"><a href="#/tra-cuu-kiosk"><span>⌕</span><strong>Kiểm tra Kiosk</strong><small>Tra cứu nhanh bằng số điện thoại</small></a><a href="#/register"><span>＋</span><strong>Đăng ký mới</strong><small>Gửi yêu cầu trực tiếp tới hệ thống</small></a></div>
      </div>
    </section>
    <section class="public-section" aria-labelledby="features-title"><div class="public-section-heading"><span class="public-eyebrow">Dịch vụ trực tuyến</span><h2 id="features-title">Mọi tác vụ Kiosk tại một nơi</h2><p>Chọn đúng nhu cầu để được hướng dẫn theo quy trình hiện có.</p></div><div class="public-feature-grid">
      ${feature('▣', 'Đăng ký Kiosk', 'Đăng ký Kiosk mới, gửi yêu cầu và tiếp tục luồng thanh toán tự động hiện có.', '#/register', 'Bắt đầu đăng ký')}
      ${feature('↻', 'Bổ sung Kiosk', 'Bổ sung dữ liệu cho Kiosk đã đăng ký trước đây nhưng chưa có trên hệ thống mới.', '#/legacy-registration', 'Bổ sung thông tin')}
      ${feature('⌕', 'Tra cứu Kiosk', 'Kiểm tra ngày dịch vụ, thời hạn và trạng thái bằng số điện thoại đã đăng ký.', '#/tra-cuu-kiosk', 'Tra cứu ngay')}
      ${feature('↔', 'Tương tác chéo', 'Nền tảng hỗ trợ hoạt động tương tác cộng đồng dành cho tài khoản đã được cấp quyền.', '#/login', 'Đăng nhập hệ thống')}
    </div></section>
    <section class="public-section public-process"><div class="public-section-heading"><span class="public-eyebrow">Quy trình</span><h2>Đơn giản và dễ theo dõi</h2></div><ol class="public-step-grid"><li><span>01</span><div><strong>Chọn dịch vụ</strong><p>Đăng ký mới, bổ sung dữ liệu hoặc tra cứu.</p></div></li><li><span>02</span><div><strong>Nhập thông tin</strong><p>Cung cấp chính xác dữ liệu khách hàng và Kiosk.</p></div></li><li><span>03</span><div><strong>Gửi yêu cầu</strong><p>Xác nhận thông tin và thanh toán nếu luồng yêu cầu.</p></div></li><li><span>04</span><div><strong>Theo dõi trạng thái</strong><p>Tra cứu Kiosk bằng số điện thoại đã đăng ký.</p></div></li></ol></section>
    <section class="public-section"><div class="public-section-heading"><span class="public-eyebrow">An tâm sử dụng</span><h2>Cổng hỗ trợ đáng tin cậy</h2></div><div class="public-benefit-grid">${benefit('✓', 'Quy trình rõ ràng', 'Thông tin và bước xử lý được trình bày minh bạch.')}${benefit('⌕', 'Tra cứu nhanh', 'Chỉ cần số điện thoại đã đăng ký.')}${benefit('₫', 'Thanh toán PayOS', 'Tiếp tục sử dụng luồng thanh toán hiện có.')}${benefit('♢', 'Quản lý tập trung', 'Thông tin Kiosk được theo dõi thống nhất.')}${benefit('☎', 'Hỗ trợ trực tiếp', 'Liên hệ đúng kênh của Ban quản trị.')}</div></section>
    <section class="public-section"><div class="public-section-heading"><span class="public-eyebrow">Kết nối cộng đồng</span><h2>Các kênh chính thức</h2><p>Hãy kiểm tra đúng liên kết trước khi trao đổi hoặc gửi thông tin.</p></div><div class="public-channel-grid">${channel('Group chính', 'Kênh sinh hoạt chính của cộng đồng.', PUBLIC_LINKS.mainGroup)}${channel('Group phụ', 'Kênh cộng đồng bổ sung.', PUBLIC_LINKS.subGroup)}${channel('Group tuyển dụng', 'Thông tin việc làm và tuyển dụng.', PUBLIC_LINKS.jobsGroup)}${channel('Fanpage', 'Kênh thông tin của Ban quản trị.', PUBLIC_LINKS.fanpage)}</div></section>
    ${PublicSupportBlock({ title: 'Liên hệ Ban quản trị DHL' })}`;
}

function feature(icon, title, text, href, cta) { return `<article class="public-feature-card"><span class="public-card-icon">${icon}</span><h3>${title}</h3><p>${text}</p><a href="${href}">${cta} →</a></article>`; }
function benefit(icon, title, text) { return `<article><span>${icon}</span><div><h3>${title}</h3><p>${text}</p></div></article>`; }
function channel(title, text, href) { return `<article class="public-channel-card"><span>f</span><h3>${title}</h3><p>${text}</p><a href="${href}" target="_blank" rel="noopener noreferrer">Mở liên kết ↗</a></article>`; }
