# Discord Bot Dashboard

A comprehensive Discord bot dashboard with GIF generation capabilities for beauty ratings and user matching.

## Features

- **Real-time Dashboard**: Live presence updates and activity monitoring
- **Beauty Rating GIF**: Generate animated GIFs with user avatars and beauty percentages
- **User Matching GIF**: Create compatibility GIFs between two users
- **Account Authentication**: User token-based authentication for enhanced features
- **User Lookup**: Search users by ID or username using account tokens

## Commands

### Beauty Rating
- Trigger: `جمالي` (Arabic) or `beauty`
- Generates a GIF showing user's beauty percentage with animated progress bar
- Special users get 100% rating automatically

### User Matching
- Trigger: `match @username` or `تطابق @username`
- Creates a GIF showing compatibility between two users
- Features pink background, avatar shaking, and raining hearts/fire emojis

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
```

3. Start the server:
```bash
npm start
```

## Deployment

This project is configured for deployment on Render.com with the included `render.yaml` file.

## Technologies Used

- Node.js & Express.js
- Discord.js
- Socket.io for real-time updates
- Canvas for GIF generation
- HTML/CSS/JavaScript for frontend