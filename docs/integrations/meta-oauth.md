# Meta OAuth account discovery

Facebook and Instagram platform applications use the same actor-bound, one-time Redis transaction state as X. A Meta App must provide an active encrypted `app_secret`, a versioned Graph API value such as `v23.0`, and an exactly registered callback URI.

The callback exchanges the authorization code, converts the user token to a long-lived token, and reads `/me/accounts` with Page access tokens, tasks, and `instagram_business_account`. A Facebook PlatformApp stores each publishable Page as an independent SocialAccount and encrypted OAuth token family. An Instagram PlatformApp stores each discovered Instagram Professional account with the corresponding Page token. User tokens and undiscovered Page tokens are not persisted.

Required Facebook scopes are `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`. Instagram additionally requires `instagram_basic` and `instagram_content_publish`. Meta App Review, Business verification, Page roles, and the Page-to-Instagram Professional link remain external prerequisites.

The Graph API version is never inferred from the latest release at runtime; it is pinned on PlatformApp so upgrades can be tested and rolled out explicitly.

## Facebook Page publishing

The worker publishes text and optional links to `/{page-id}/feed`. A single validated private image is uploaded as multipart binary to `/{page-id}/photos` with the publication text as its caption. The Page token comes only from that Page account's encrypted token version. Returned object IDs and Meta request/trace IDs are persisted; the worker then makes a best-effort lookup for `permalink_url`. Transport failure after a publish request is `RESULT_UNKNOWN` and is not blindly replayed.

## Instagram Professional image publishing

Instagram image publishing requires Meta to fetch an `image_url`; the bucket remains private. The worker generates a 15-minute S3 GET signature, creates a container at `/{ig-user-id}/media`, persists its ID, and polls `status_code`. Only a `FINISHED` container is sent to `/{ig-user-id}/media_publish`, after which the media permalink is verified and stored. A publish transport failure is quarantined as `RESULT_UNKNOWN`. Local filesystem media is deliberately rejected because Meta cannot retrieve it.
