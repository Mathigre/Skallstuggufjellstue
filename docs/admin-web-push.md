# Admin push notifications

Admin users enable notifications separately on each device using the banner in admin. On iOS 16.4+, open admin from a Home Screen installation. Send a test notification after activation.

New public booking requests and guest messages trigger the service-only dispatch action. Payloads contain a generic notice and booking UUID, not customer details. Notification clicks require normal admin authentication and open the matching booking. Email notifications remain independent. Push delivery is best effort, with a one-day TTL; no durable retry queue is implemented.

The admin-push function checks authenticated membership in admin_users for registration, removal and tests. Dispatch accepts only the service role credential, and checks current administrator membership before sending. Only allowlisted push-provider endpoints are accepted. 404/410 subscriptions are removed. Subscriptions expire after 90 days and renew when the owner opens admin. Explicit logout attempts server deregistration and browser unsubscribe.

VAPID keys are generated once on the server, stored in admin_push_settings (RLS enabled, service_role only), and only the public key is returned to the client. Do not rotate keys without re-enrolling devices. admin_push_subscriptions is likewise inaccessible to anon/authenticated through the Data API. No service worker fetch handler or admin data caching is installed.

Migration: database/admin-web-push.sql, applied as admin_web_push. Deploy admin-push and booking-public with verify_jwt=true. No extra external account is required.

Domain move: update the Edge Function CORS origins and existing absolute booking URLs. Users must reinstall or open the app on the new origin and enable notifications again; browser subscriptions are origin-specific.

Verified: local authentication/endpoint/ownership/dispatch/expired-device tests and JavaScript syntax. Real phone delivery must be checked with Send testvarsel on that phone.
