# Reddit API Access Request

**What is your inquiry?**
I'm a developer and want to build a Reddit App that does not work in the Devvit ecosystem.

**Reddit account name:**
PizzaDrivenGPU

**What benefit/purpose will the bot/app have for Redditors?**

It allows Redditors to manage their Reddit activity from a unified productivity platform alongside their other tools (email, calendar, CRM, etc.), saving time by not having to switch between apps. The app acts on behalf of the authenticated user only — no scraping, mass-posting, or automated actions.

**Provide a detailed description of what the Bot/App will be doing on the Reddit platform.**

The app will perform the following actions on behalf of the authenticated user:

- Browse home feed, subreddit posts, and user profiles
- Vote on posts and comments (upvote/downvote)
- Comment on posts and reply to comments
- Submit new text and link posts to subreddits
- Save and unsave posts/comments
- Manage subreddit subscriptions (subscribe/unsubscribe)
- Read and send private messages
- Search Reddit for posts and content
- Edit and delete the user's own posts/comments

All actions are manually triggered by the user through a CLI or workflow interface. The app never acts autonomously — every API call corresponds to an explicit user action.

**What is missing from Devvit that prevents building on that platform?**

Devvit is designed for building apps that live inside Reddit (custom post types, subreddit widgets, mod tools). Our use case is an external application that integrates Reddit as one of many connected services in a unified workflow platform. We need standard OAuth 2.0 access to the Reddit API from our own web application, which is outside the scope of Devvit's embedded app model.

**Provide a link to source code or platform that will access the API.**

https://github.com/baptistemusic/bap (or your actual repo/platform URL)

**What subreddits do you intend to use the bot/app in?**

No specific subreddits — the app operates on whatever subreddits the authenticated user interacts with through their own account. It does not target or moderate any particular subreddit.

**If applicable, what username will you be operating this bot/app under?**

PizzaDrivenGPU
