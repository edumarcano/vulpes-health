export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  // Component libraries use inline styles, never inline scripts.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export const securityHeaders = {
  'Content-Security-Policy': contentSecurityPolicy,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function securityHeadersForSupabase(origin?:string) {
  if(!origin)return {...securityHeaders};
  const url=new URL(origin);
  if(url.origin!==origin || url.username || url.password || url.search || url.hash || url.pathname!=='/' ||
    url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Invalid authentication origin.');
  return {...securityHeaders,'Content-Security-Policy':contentSecurityPolicy.replace("connect-src 'self'",`connect-src 'self' ${origin}`)};
}
