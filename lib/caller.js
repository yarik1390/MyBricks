// Returns the caller's user ID from Hatchable's auth header
export function getCallerId(req) {
  return req.member?.id || req.headers['x-hatchable-user-id'] || null;
}