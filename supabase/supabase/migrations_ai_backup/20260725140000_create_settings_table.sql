CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT INTO settings (key, value) VALUES
('group_url', ''),
('sub_group_url', ''),
('recruitment_group_url', ''),
('fanpage_url', ''),
('zalo_url', ''),
('support_phone', ''),
('warning_days', '30'),
('company_info', ''),
('business_info', ''),
('system_settings', '');
