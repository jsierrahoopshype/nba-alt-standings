# Test fixtures

`data/` is the repo's `data/` folder exactly as it stood when PR #6 merged
(b34f9e6), before the update bot wrote anything: opening night not played
yet, no season schedule cached. The run tests (http, phase1, phase1b,
phase1c) start every scratch copy from it and build the pages from it, so
they keep passing while the bot commits real nights to `data/`. Do not
refresh it from the live folder; a test that needs other data writes it
into its own scratch copy.
