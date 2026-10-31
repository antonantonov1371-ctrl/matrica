export const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
];
export function validSubscription(value: any): boolean {
  try {
    const u = new URL(value.endpoint);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') ||
      value.endpoint.length > 2048 || !PUSH_HOSTS.some(p => p.test(u.hostname))) return false;
    const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const key = decode(value.keys.p256dh), auth = decode(value.keys.auth);
    return key.length === 65 && key[0] === 4 && auth.length === 16;
  } catch { return false; }
}
export function subscriptionProblem(value: any): string {
  try {
    const u=new URL(value?.endpoint);
    if(u.protocol!=='https:' || !PUSH_HOSTS.some(p=>p.test(u.hostname)))
      return 'Служба уведомлений этого браузера не поддерживается. Откройте Матрицу в Safari или Chrome; на iPhone — через иконку на главном экране.';
    return 'Браузер не передал корректный ключ уведомлений. Откройте Матрицу в обычном Safari или Chrome и попробуйте снова.';
  }catch{
    return 'Этот браузер не предоставил адрес доставки уведомлений. Откройте Матрицу в Safari или Chrome.';
  }
}
export function validTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone.length > 100) return false;
  try { new Intl.DateTimeFormat('en', {timeZone: zone}).format(); return true; } catch { return false; }
}
