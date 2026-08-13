const requiredProduction = ['DATABASE_URL', 'MUAPI_API_KEY', 'MUAPI_BASE_URL', 'LOCAL_OBJECT_STORAGE_SECRET'];

export function validateProductionEnvironment(env = process.env) {
  if (env.NODE_ENV !== 'production') return { ok: true, errors: [] };

  const errors = [];
  for (const name of requiredProduction) {
    if (!String(env[name] || '').trim()) errors.push(`${name} is required`);
  }
  if (env.LOCAL_OBJECT_STORAGE_SECRET === 'development-only-change-me') {
    errors.push('LOCAL_OBJECT_STORAGE_SECRET must not use the development default');
  }
  for (const name of Object.keys(env)) {
    if (/^NEXT_PUBLIC_.*(KEY|SECRET|TOKEN|PASSWORD)$/i.test(name)) {
      errors.push(`${name} must not contain a server secret`);
    }
  }
  return { ok: errors.length === 0, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateProductionEnvironment();
  if (result.ok) console.log('Production environment configuration is valid.');
  else {
    console.error(['Production environment configuration is invalid:', ...result.errors.map((error) => `- ${error}`)].join('\n'));
    process.exitCode = 1;
  }
}
