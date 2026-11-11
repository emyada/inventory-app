export function loginAlias(value) {
  if (typeof value !== 'string') return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(username) ? username + '@iem-workshop.local' : null;
}
