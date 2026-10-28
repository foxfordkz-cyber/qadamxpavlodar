// Mount inside the team's authenticated page after agreeing the request-body details.
import '../../apps/web/src/features/worker/worker.mjs';
import { createContractGateway, createV2Transport } from '../../apps/web/src/features/worker/contract-v2.mjs';

export async function mountWorker({ element, session, shiftDate, csrfToken, sharedColors }) {
  if (!session?.user?.id || !session.organizationId) throw new Error('Нужна сессия общего приложения.');
  const request = createV2Transport({base:'/api/v1',headersFor:()=>csrfToken?{'X-CSRF-Token':csrfToken}:{}});
  const gateway = createContractGateway({request,user:session.user});
  if (sharedColors) for (const [name, value] of Object.entries(sharedColors)) element.style.setProperty(`--gp-${name}`, value);
  await element.configure({
    gateway, user: session.user, date: shiftDate,
    scope: `production:${session.organizationId}`, // Never reuse the demo scope.
    demo: false, locale: 'ru', embedded: true,
  });
  // On logout immediately clear the component and call the common POST /auth/logout.
  // Never include demo/ in the production bundle.
}
