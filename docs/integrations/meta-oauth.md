# Meta OAuth account discovery

Facebook and Instagram platform applications use the same actor-bound, one-time Redis transaction state as X. A Meta App must provide an active encrypted `app_secret`, a versioned Graph API value such as `v23.0`, and an exactly registered callback URI.

The callback exchanges the authorization code, converts the user token to a long-lived token, and reads `/me/accounts` with Page access tokens, tasks, and `instagram_business_account`. A Facebook PlatformApp stores each publishable Page as an independent SocialAccount and encrypted OAuth token family. An Instagram PlatformApp stores each discovered Instagram Professional account with the corresponding Page token. User tokens and undiscovered Page tokens are not persisted.

Required Facebook scopes are `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`. Instagram additionally requires `instagram_basic` and `instagram_content_publish`. Meta App Review, Business verification, Page roles, and the Page-to-Instagram Professional link remain external prerequisites.

The Graph API version is never inferred from the latest release at runtime; it is pinned on PlatformApp so upgrades can be tested and rolled out explicitly.
