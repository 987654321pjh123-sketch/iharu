import type { AuthSettings } from './config.js';
import { createHmac, randomBytes } from 'node:crypto';

export type Delivery = {
  sendMail: (data: { to: string; url: string; kind: 'verify' | 'reset' }) => Promise<void>;
  sendSms: (phone: string, code: string) => Promise<void>;
};
export function createDelivery(settings: AuthSettings): Delivery {
  return {
    async sendMail({ to, url, kind }) {
      if (!settings.mail) throw new Error('MAIL_NOT_CONFIGURED');
      if (to.endsWith('@identity.iharu.invalid')) return;
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${settings.mail.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: settings.mail.from, to: [to],
          subject: kind === 'verify' ? '[아이하루] 이메일을 확인해 주세요' : '[아이하루] 비밀번호 다시 설정하기',
          text: `${kind === 'verify' ? '이메일 확인' : '비밀번호 재설정'}을 위해 아래 링크를 열어 주세요.\n\n${url}\n\n요청하지 않았다면 이 메일을 무시해 주세요.`,
        }), signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new Error('MAIL_DELIVERY_FAILED');
    },
    async sendSms(phone, code) {
      if (!settings.sms) throw new Error('SMS_NOT_CONFIGURED');
      const date = new Date().toISOString(); const salt = randomBytes(16).toString('hex');
      const signature = createHmac('sha256', settings.sms.secret).update(date + salt).digest('hex');
      // One budget reservation = one provider attempt. Do not retry an uncertain SMS send automatically.
      const response = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `HMAC-SHA256 apiKey=${settings.sms.key}, date=${date}, salt=${salt}, signature=${signature}` },
        body: JSON.stringify({ messages: [{ to: `0${phone.slice(3)}`, from: settings.sms.from, type: 'SMS', text: `[아이하루] 인증번호 ${code}\n3분 안에 입력해 주세요.` }], allowDuplicates: false }),
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new Error('SMS_DELIVERY_FAILED');
      const result = await response.json() as { failedMessageList?: unknown[]; groupInfo?: { count?: { total?: number; registeredFailed?: number } } };
      if (!Array.isArray(result.failedMessageList) || result.failedMessageList.length || result.groupInfo?.count?.total !== 1 || result.groupInfo.count.registeredFailed !== 0) throw new Error('SMS_DELIVERY_FAILED');
    },
  };
}
