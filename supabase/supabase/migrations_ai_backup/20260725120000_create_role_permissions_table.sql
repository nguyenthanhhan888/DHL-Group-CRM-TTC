CREATE TABLE role_permissions (
  role TEXT PRIMARY KEY,
  permissions TEXT[] NOT NULL
);

-- Seed initial data for reviewer
INSERT INTO role_permissions (role, permissions) VALUES
('reviewer', ARRAY[
  'dashboard',
  'kiosks',
  'kiosk-detail',
  'customers',
  'customer-detail',
  'payments',
  'payment-detail',
  'registration-requests',
  'reports',
  'logs'
]);
