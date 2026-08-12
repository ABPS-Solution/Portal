// The operator's display name — never their login email. Any column that
// records "who did this" for humans to read stores this, not an identity key.
function displayName(req) {
  const name = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim();
  return name || req.user.email;
}
module.exports = { displayName };