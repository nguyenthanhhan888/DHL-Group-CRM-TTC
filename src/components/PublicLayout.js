const LINKS = {
  mainGroup: 'https://www.facebook.com/groups/1145443782801316',
  subGroup: 'https://www.facebook.com/groups/dienchaugroup888',
  jobsGroup: 'https://www.facebook.com/groups/320237372898775',
  fanpage: 'https://www.facebook.com/admin.dc.adayroi/',
};

export function PublicLayout({ route = 'home', content = '' } = {}) {
  return `
    <div class="public-site">
      <header class="public-navbar">
        <div class="public-navbar-inner">
          <a class="public-brand" href="#/home" aria-label="Diễn Châu - À Đây Rồi - Trang chủ">
            <img src="logo/photo_2026-08-03_06-31-15.jpg" alt="" />
            <span><strong>Diễn Châu - À Đây Rồi</strong><small>Cổng cộng đồng DHL</small></span>
          </a>
          <button class="public-menu-button" type="button" aria-label="Mở menu" aria-expanded="false" data-public-menu-button>☰</button>
          <nav class="public-nav-links" aria-label="Điều hướng chính" data-public-menu>
            ${navLink('home', 'Trang chủ', route)}
            ${navLink('register', 'Đăng ký Kiosk', route)}
            ${navLink('legacy-registration', 'Bổ sung Kiosk', route)}
            ${navLink('tra-cuu-kiosk', 'Tra cứu Kiosk', route)}
            <a href="${LINKS.mainGroup}" target="_blank" rel="noopener noreferrer">Group chính ↗</a>
            <a href="#/login" data-open-login>Đăng nhập</a>
            <a class="public-nav-cta" href="#/register">Đăng ký Kiosk</a>
          </nav>
        </div>
      </header>
      <main class="public-main" data-route-outlet>${content}</main>
      ${PublicFooter()}
    </div>
    <div class="modal-overlay hidden" data-modal-overlay>
      <div class="modal" data-modal role="dialog" aria-modal="true" aria-labelledby="app-modal-title">
        <div class="modal-header"><h3 id="app-modal-title" data-modal-title></h3><button class="modal-close" type="button" data-modal-close aria-label="Đóng">✕</button></div>
        <div class="modal-body" data-modal-body></div>
      </div>
    </div>
    <div class="toast-container" data-toast-container aria-live="polite"></div>`;
}

export function PublicFooter() {
  return `
    <footer class="public-footer">
      <div class="public-footer-grid">
        <div><a class="public-footer-brand" href="#/home">Diễn Châu - À Đây Rồi (DHL)</a><p>Cổng thông tin chính thức hỗ trợ đăng ký, bổ sung và tra cứu Kiosk của cộng đồng.</p></div>
        <div><h2>Liên kết nhanh</h2>${footerLink('#/home', 'Trang chủ')}${footerLink('#/register', 'Đăng ký Kiosk')}${footerLink('#/legacy-registration', 'Bổ sung Kiosk')}${footerLink('#/tra-cuu-kiosk', 'Tra cứu Kiosk')}${footerLink('#/login', 'Đăng nhập')}</div>
        <div><h2>Các kênh chính thức</h2>${externalLink(LINKS.mainGroup, 'Group chính')}${externalLink(LINKS.subGroup, 'Group phụ')}${externalLink(LINKS.jobsGroup, 'Group tuyển dụng')}${externalLink(LINKS.fanpage, 'Fanpage')}</div>
        <div><h2>Liên hệ Ban quản trị</h2>${externalLink('https://zalo.me/0888690346', 'Zalo: 0888690346')}${externalLink('https://zalo.me/0888640346', 'Zalo: 0888640346')}<a href="tel:0333015337">Hotline: 0333 015 337</a></div>
      </div>
      <div class="public-footer-bottom"><span>© ${new Date().getFullYear()} Diễn Châu - À Đây Rồi (DHL)</span><span>Thông tin trên cổng được cung cấp để hỗ trợ thành viên cộng đồng.</span></div>
    </footer>`;
}

export function PublicSupportBlock({ title = 'Bạn cần hỗ trợ?' } = {}) {
  return `<aside class="public-support-block"><div><span class="public-eyebrow">Hỗ trợ trực tiếp</span><h2>${title}</h2><p>Ban quản trị sẵn sàng hỗ trợ trong quá trình đăng ký, bổ sung hoặc gia hạn Kiosk.</p></div><div class="public-support-actions"><a class="btn-primary link-button" href="https://zalo.me/0888690346" target="_blank" rel="noopener noreferrer">Nhắn Zalo</a><a class="btn-secondary link-button" href="tel:0333015337">Gọi 0333 015 337</a></div></aside>`;
}

function navLink(route, label, current) { return `<a href="#/${route}" class="${route === current ? 'active' : ''}" ${route === current ? 'aria-current="page"' : ''}>${label}</a>`; }
function footerLink(href, label) { return `<a href="${href}">${label}</a>`; }
function externalLink(href, label) { return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`; }

export { LINKS as PUBLIC_LINKS };
