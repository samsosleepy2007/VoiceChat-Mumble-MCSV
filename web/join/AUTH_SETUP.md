# Discord login
Production callback: https://sleepyvoice-join.vercel.app/api/auth/discord/callback
Required server: 1420339720277463112

Set Production environment variables in Vercel, then redeploy:
- DISCORD_CLIENT_ID: 1451893619773542503
- DISCORD_CLIENT_SECRET: from the application's OAuth2 page
- SESSION_SECRET: random secret of at least 32 characters
- DISCORD_BOT_TOKEN: Bot token of the SAME application

Invite that bot to the required server with Create Instant Invite permission. No Gateway connection or permanently running bot process is needed for these REST calls.
The authorization request asks for identify, guilds.members.read, and guilds.join. Users explicitly approve server joining on Discord.
Only verified, non-pending members receive an application session. A missing bot token blocks auto-joining but existing members can sign in. API errors never grant a session.
Membership is checked whenever /api/auth/session is requested. Protected future APIs must perform equivalent server-side checks; static downloads and Mumble server access are not protected by website login.
The OAuth access token is sealed inside an encrypted HttpOnly/Secure cookie solely for membership rechecks, never returned by the session endpoint or written to logs. Sessions expire at the earlier of token expiry and 24 hours. No refresh token is stored. Existing cookies from before membership enforcement require reauthentication.
Membership Screening is respected: pending members must accept server rules in Discord and sign in again.
