# 🚀 Deployment Guide for Render.com

## Prerequisites

1. **GitHub Account**: You'll need a GitHub account
2. **Render Account**: Sign up at [render.com](https://render.com)
3. **Discord Application**: Your bot token and OAuth2 credentials

## Step 1: Prepare Your Code

### 1.1 Create a GitHub Repository

1. Go to [GitHub](https://github.com) and create a new repository
2. Name it something like `discord-bot-dashboard`
3. Make it **Public** (required for free Render deployment)

### 1.2 Upload Your Code

```bash
# Initialize git in your project folder
git init

# Add all files
git add .

# Commit the changes
git commit -m "Initial commit: Discord Bot Dashboard"

# Add your GitHub repository as remote
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Push to GitHub
git push -u origin main
```

## Step 2: Deploy to Render.com

### 2.1 Create a New Web Service

1. Go to [render.com](https://render.com) and sign in
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account if not already connected
4. Select your repository: `discord-bot-dashboard`

### 2.2 Configure the Service

**Basic Settings:**
- **Name**: `discord-bot-dashboard` (or any name you prefer)
- **Environment**: `Node`
- **Region**: Choose closest to your users
- **Branch**: `main` (or your default branch)
- **Root Directory**: Leave empty (it will use the root)
- **Runtime**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`

### 2.3 Set Environment Variables

In the **Environment** section, add these variables:

```
NODE_ENV=production
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
```

**Important Notes:**
- Replace `your_bot_token_here` with your actual Discord bot token
- Replace `your_client_id_here` with your Discord application client ID
- Replace `your_client_secret_here` with your Discord application client secret
- **Never share these values publicly!**

### 2.4 Deploy

1. Click **"Create Web Service"**
2. Render will automatically:
   - Clone your repository
   - Install dependencies (`npm install`)
   - Start your application (`npm start`)
3. Wait for deployment to complete (usually 2-5 minutes)

## Step 3: Configure Your Discord Bot

### 3.1 Update Bot Invite URL

1. Go to your Discord application dashboard
2. Navigate to **OAuth2** → **URL Generator**
3. Select scopes: `bot`, `identify`, `guilds`
4. Select bot permissions: `Send Messages`, `Use Slash Commands`, `Attach Files`
5. Copy the generated URL and test it

### 3.2 Update Redirect URI

1. In your Discord application dashboard, go to **OAuth2** → **General**
2. Add redirect URI: `https://your-app-name.onrender.com/auth/callback`
3. Replace `your-app-name` with your actual Render app name

## Step 4: Test Your Deployment

### 4.1 Check the Logs

1. In Render dashboard, go to your service
2. Click **"Logs"** tab
3. Look for successful startup messages:
   ```
   ✅ Discord bot connected as YourBot#1234
   🚀 Server running on port 10000
   ```

### 4.2 Test the Dashboard

1. Visit your Render URL: `https://your-app-name.onrender.com`
2. Test the dashboard functionality
3. Try the beauty rating and matching commands in Discord

## Troubleshooting

### Common Issues:

1. **Build Fails**: Check that all dependencies are in `package.json`
2. **Bot Doesn't Connect**: Verify your `DISCORD_BOT_TOKEN` is correct
3. **OAuth2 Issues**: Ensure redirect URI matches your Render URL
4. **Canvas Issues**: Render supports Canvas, but if issues occur, check the logs

### Getting Help:

- Check Render logs for error messages
- Verify all environment variables are set correctly
- Ensure your Discord bot has proper permissions
- Test locally first to ensure everything works

## Step 5: Keep Your Bot Running

### 5.1 Free Tier Limitations

- Render free tier has some limitations:
  - Service may sleep after 15 minutes of inactivity
  - Limited build minutes per month
  - Slower cold starts

### 5.2 Upgrade Options

- Consider upgrading to a paid plan for:
  - Always-on service
  - Faster builds
  - More resources
  - Better performance

## Success! 🎉

Your Discord bot dashboard should now be live and accessible at:
`https://your-app-name.onrender.com`

Remember to:
- Keep your environment variables secure
- Monitor your Render dashboard for any issues
- Update your bot's redirect URI if you change the URL
- Test all features to ensure everything works correctly
