// Operator accounts may install on any server without paying (testing, support, comped installs).
// Identity comes from the Discord OAuth session, never from the request body. Extra IDs can be added
// with ADMIN_DISCORD_IDS (comma separated) without a code change.
const OWNER_IDS = ['904046392106967122'];

export function isAdmin(userId, env = process.env) {
  if (typeof userId !== 'string' || !/^\d{17,20}$/.test(userId)) return false;
  const extra = String(env.ADMIN_DISCORD_IDS || '').split(',').map(id => id.trim()).filter(id => /^\d{17,20}$/.test(id));
  return OWNER_IDS.includes(userId) || extra.includes(userId);
}

// The hard-coded owner only (not ADMIN_DISCORD_IDS): clears a server's unlicensed-history block.
export function isOwner(userId) {
  return typeof userId === 'string' && OWNER_IDS.includes(userId);
}
