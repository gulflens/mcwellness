// Makes the practice's push key pair (the push memo's "Acts only you can do":
// "run the one command that makes the practice's push key pair"). Run by the
// operator, once per environment, never by the app:
//
//   pnpm push:keys
//
// It prints three lines to paste into the host's own secret settings for the
// API process, and nowhere else: not into .env.example, not into a commit,
// not into a chat. The private key is printed once, here, and this script
// keeps no copy. Replacing the pair later means every phone must turn
// notifications on again, because each one subscribed against the old public
// key — so make it once, and keep it with the host's other secrets.
//
// The pair is P-256 (RFC 8292): the public key as the 65-byte point a
// browser's applicationServerKey takes, the private key as its 32-byte
// scalar, both base64url. app/api/portal/push/webpush.ts (vapidKeysFromEnv)
// reads them back and refuses a pair that does not belong together.
import { createECDH } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** One new pair, as the three variables the API reads. */
export function pushKeyLines(subject = 'mailto:REPLACE-with-the-practice-address@example.com') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return [
    `PUSH_VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}`,
    `PUSH_VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString('base64url')}`,
    `PUSH_VAPID_SUBJECT=${subject}`,
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const subject = process.argv[2];
  console.log(
    '# The practice\'s push key pair. Paste these three into the host\'s secret settings\n' +
      '# for the API process, set PUSH_VAPID_SUBJECT to a mailto: address the practice\n' +
      '# reads, and restart the API. Never commit them.',
  );
  for (const line of pushKeyLines(subject)) console.log(line);
}
