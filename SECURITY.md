# Security

## Reporting

Report a vulnerability through GitHub's private reporting: the **Security** tab, then **Report
a vulnerability**. Please don't open a public issue for something exploitable. There is no
bounty.

## What the app does

Filmstrip runs locally. It has no server, no account, and makes no network requests. It reads
and writes folders the user chooses, plus its own directory beside the executable.

Two things are worth knowing when judging a report:

- **Debug builds open a WebView2 debug port on 127.0.0.1:9322** so tests can attach to the
  window. Release builds do not.
- **The app moves and deletes the user's real files.** Path handling, renaming and the trash
  are the parts where a bug does actual damage, and reports there are especially welcome.
