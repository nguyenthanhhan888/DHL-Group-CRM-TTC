import { requireSupabaseClient } from './BaseService.js';

export class HomepageContentService {
  static async getPublic() {
    const { data, error } = await requireSupabaseClient().rpc('get_public_homepage_content');
    if (error) throw error;
    return data || { content: {}, featuredBusinesses: [] };
  }

  static async getAdminData() {
    const { data, error } = await requireSupabaseClient().rpc('get_homepage_admin_data');
    if (error) throw error;
    return normalizeAdminData(data);
  }

  static async saveContent(content) {
    const { data, error } = await requireSupabaseClient().rpc('save_homepage_content', { p_content: content });
    if (error) throw error;
    return data;
  }

  static async saveBusiness(business) {
    const { data, error } = await requireSupabaseClient().rpc('save_featured_business', { p_business: business });
    if (error) throw error;
    return data;
  }

  static async archiveBusiness(id) {
    const { data, error } = await requireSupabaseClient().rpc('archive_featured_business', { p_id: id });
    if (error) throw error;
    return data;
  }

  static async uploadBusinessImage(file) {
    if (!(file instanceof File)) throw new Error('Vui lòng chọn file ảnh.');
    const allowed = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif']]);
    const extension = allowed.get(file.type);
    if (!extension) throw new Error('Chỉ hỗ trợ ảnh JPG, PNG, WebP hoặc GIF.');
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error('Ảnh phải nhỏ hơn hoặc bằng 5 MB.');
    const client = requireSupabaseClient();
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const path = `featured-businesses/${id}.${extension}`;
    const { error } = await client.storage.from('homepage-assets').upload(path, file, { cacheControl: '3600', contentType: file.type, upsert: false });
    if (error) throw error;
    const { data } = client.storage.from('homepage-assets').getPublicUrl(path);
    if (!data?.publicUrl) throw new Error('Không tạo được URL ảnh công khai.');
    return { path, publicUrl: data.publicUrl };
  }
}

function normalizeAdminData(data = {}) {
  const content = data.content || {};
  return {
    content: {
      heroTitle: content.hero_title || '',
      heroSubtitle: content.hero_subtitle || '',
      heroImageUrl: content.hero_image_url || '',
      heroGroupCtaLabel: content.hero_group_cta_label || '',
      heroGroupCtaUrl: content.hero_group_cta_url || '',
      heroKioskCtaLabel: content.hero_kiosk_cta_label || '',
      heroKioskCtaRoute: content.hero_kiosk_cta_route || '#/register',
      postingRules: content.posting_rules || '',
      zaloContacts: content.zalo_contacts || [],
      hotlineLabel: content.hotline_label || '',
      hotlineNumber: content.hotline_number || '',
      fanpageLabel: content.fanpage_label || '',
      fanpageUrl: content.fanpage_url || '',
      communityLinks: content.community_links || [],
      sectionVisibility: content.section_visibility || {},
      sectionOrder: content.section_order || [],
    },
    featuredBusinesses: (data.featuredBusinesses || []).map((item) => ({
      id: item.id,
      name: item.name || '',
      imageUrl: item.image_url || '',
      category: item.category || '',
      shortDescription: item.short_description || '',
      address: item.address || '',
      facebookUrl: item.facebook_url || '',
      zaloContact: item.zalo_contact || '',
      phone: item.phone || '',
      badge: item.badge || '',
      enabled: item.enabled !== false,
      displayOrder: Number(item.display_order || 0),
      visibilityStart: toLocalDateTime(item.visibility_start),
      visibilityEnd: toLocalDateTime(item.visibility_end),
    })),
  };
}

function toLocalDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
