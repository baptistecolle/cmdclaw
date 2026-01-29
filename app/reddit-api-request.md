# Reddit API Access Request

**What is your inquiry?**
I'm a developer and want to build a Reddit App that does not work in the Devvit ecosystem.

**Reddit account name:**
PizzaDrivenGPU

**What benefit/purpose will the bot/app have for Redditors?**

The app is a personal productivity and workflow automation platform that allows users to manage their Reddit account alongside other services (email, calendar, CRM, etc.) from a single interface. It helps Redditors:

- Browse their home feed and subreddit posts
- Vote, comment, and reply to discussions
- Submit new posts (text and link)
- Manage subreddit subscriptions
- Read and send private messages
- Search across Reddit

The app acts on behalf of the authenticated user only — it does not scrape, mass-post, or perform any automated actions without explicit user intent. Each action is manually triggered by the user through a CLI or workflow interface.

**What is missing from Devvit that prevents building on that platform?**

Devvit is designed for building apps that live inside Reddit (custom post types, subreddit widgets, mod tools). Our use case is an external application that integrates Reddit as one of many connected services in a unified workflow platform. We need standard OAuth 2.0 access to the Reddit API from our own web application, which is outside the scope of Devvit's embedded app model.

**Provide a link to source code or platform that will access the API.**

https://github.com/baptistemusic/bap (or your actual repo/platform URL)

**What subreddits do you intend to use the bot/app in?**

No specific subreddits — the app operates on whatever subreddits the authenticated user interacts with through their own account. It does not target or moderate any particular subreddit.

**If applicable, what username will you be operating this bot/app under?**

PizzaDrivenGPU
