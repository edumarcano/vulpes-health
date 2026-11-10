# Temporary-account hosted checks, 2026-11-10

The checks used one temporary account with synthetic RENPHO data on production revision `7843859c9d4771e5610695d61517748999bb7960`. Provider consent was empty and no AI budget was allocated.

Application HTTP requests covered settings, import preview and commit, Data, Goals and conversation reads, export, password reset, old-session rejection, deletion initiation and post-deletion denial. Account-scoped RLS queries returned no foreign-owner rows across profiles, measurements, sources, conversations and goals. The account was deleted; Auth absence, zero owned rows in the checked tables and a completed deletion receipt were confirmed.

Provider requests and spend were zero. These results cover the named production revision and HTTP/API paths. Physical-device and account-switching checks were not part of this run.
