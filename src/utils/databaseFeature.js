export function isMissingDatabaseFeatureError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || error?.details || '').toLowerCase();
  return code === 'PGRST202'
    || code === '42P01'
    || code === '42883'
    || message.includes('could not find the function')
    || message.includes('could not find function')
    || message.includes('does not exist')
    || message.includes('schema cache');
}

export function migrationRequiredMessage(featureName = 'chức năng này') {
  return `Cần deploy migration TTC/PayOS để dùng ${featureName}.`;
}
