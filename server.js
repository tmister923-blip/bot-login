const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const sharp = require('sharp');
const multer = require('multer');
const WebSocket = require('ws');
const { Client, GatewayIntentBits, ActivityType, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const GIFEncoder = require('gif-encoder-2');
const { Riffy } = require('riffy');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increase limit for image uploads
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('.'));

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit (will be resized to 320x320 anyway)
});

// Discord API base URL
const DISCORD_API_BASE = 'https://discord.com/api/v10';

// Store active Discord clients
const activeClients = new Map();

// Verify Discord bot token
async function verifyBotToken(token) {
    try {
        const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Invalid bot token');
            }
            throw new Error(`Discord API error: ${response.status}`);
        }

        const botData = await response.json();
        
        // Get bot's guilds (servers) to verify it's a bot token
        const guildsResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!guildsResponse.ok) {
            throw new Error('Token is not a valid bot token');
        }

        return {
            id: botData.id,
            username: botData.username,
            discriminator: botData.discriminator,
            avatar: botData.avatar,
            bot: botData.bot || false,
            verified: true
        };
    } catch (error) {
        throw new Error(`Token verification failed: ${error.message}`);
    }
}

// API Routes
app.post('/api/verify-token', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Bot token is required' });
        }

        // Basic token format validation
        if (typeof token !== 'string' || token.length < 50) {
            return res.status(400).json({ error: 'Invalid token format' });
        }

        const botInfo = await verifyBotToken(token);
        
        // Also create bot client to ensure bot is logged in
        try {
            const client = await createBotClient(token);
            if (client) {
                console.log(`✅ Bot client created during login for: ${botInfo.username}`);
            }
        } catch (error) {
            console.error('❌ Failed to create bot client during login:', error.message);
        }
        
        res.json({
            success: true,
            bot: botInfo,
            message: 'Token verified successfully'
        });

    } catch (error) {
        console.error('Token verification error:', error);
        res.status(401).json({ 
            error: error.message || 'Failed to verify bot token'
        });
    }
});

// Get bot information
app.get('/api/bot-info', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        // Try to get bot info from Discord client first
        if (botClients.has(token)) {
            const client = botClients.get(token);
            if (client && client.user) {
                return res.json({ 
                    success: true, 
                    bot: {
                        id: client.user.id,
                        username: client.user.username,
                        discriminator: client.user.discriminator,
                        avatar: client.user.avatar,
                        bot: client.user.bot,
                        verified: true,
                        guilds: client.guilds.cache.size,
                        readyAt: client.readyAt
                    }
                });
            }
        }

        // Try to create bot client if not exists
        try {
            const client = await createBotClient(token);
            if (client && client.user) {
                return res.json({ 
                    success: true, 
                    bot: {
                        id: client.user.id,
                        username: client.user.username,
                        discriminator: client.user.discriminator,
                        avatar: client.user.avatar,
                        bot: client.user.bot,
                        verified: true,
                        guilds: client.guilds.cache.size,
                        readyAt: client.readyAt
                    }
                });
            }
        } catch (clientError) {
            console.log('Bot client creation failed, using fallback');
        }

        // Final fallback - return basic info without API call
        res.json({ 
            success: true, 
            bot: {
                id: 'unknown',
                username: 'Bot',
                discriminator: '0000',
                avatar: null,
                bot: true,
                verified: false,
                guilds: 0,
                readyAt: null
            }
        });

    } catch (error) {
        console.error('Bot info error:', error);
        res.status(401).json({ 
            error: error.message || 'Failed to get bot information'
        });
    }
});

// Get bot's guilds
app.get('/api/bot-guilds', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        console.log('🔄 API call received for bot-guilds');
        console.log('🔄 Authorization header:', req.headers.authorization ? 'Present' : 'Missing');
        
        if (!token) {
            console.log('❌ No token provided');
            return res.status(401).json({ error: 'Bot token required' });
        }

        console.log('🔄 Fetching guilds for token:', token.substring(0, 10) + '...');
        console.log('📊 Bot clients available:', botClients.size);

        // Try to get guilds from Discord client first
        if (botClients.has(token)) {
            const client = botClients.get(token);
            console.log('📊 Client found, ready:', client.readyAt ? 'Yes' : 'No');
            if (client && client.guilds) {
                const guilds = client.guilds.cache.map(guild => ({
                    id: guild.id,
                    name: guild.name,
                    icon: guild.icon,
                    member_count: guild.memberCount,
                    members: guild.members.cache.map(member => ({
                        id: member.id,
                        user: {
                            id: member.user.id,
                            username: member.user.username,
                            discriminator: member.user.discriminator,
                            avatar: member.user.avatar
                        }
                    }))
                }));
                console.log('📊 Returning guilds from client:', guilds.length);
                return res.json({ success: true, guilds });
            } else {
                console.log('📊 Client not ready, waiting...');
                // Wait for client to be ready
                await new Promise(resolve => setTimeout(resolve, 2000));
                if (client && client.guilds) {
                    const guilds = client.guilds.cache.map(guild => ({
                        id: guild.id,
                        name: guild.name,
                        icon: guild.icon,
                        member_count: guild.memberCount,
                        members: guild.members.cache.map(member => ({
                            id: member.id,
                            user: {
                                id: member.user.id,
                                username: member.user.username,
                                discriminator: member.user.discriminator,
                                avatar: member.user.avatar
                            }
                        }))
                    }));
                    console.log('📊 Returning guilds from client after wait:', guilds.length);
                    return res.json({ success: true, guilds });
                }
            }
        }

        // Try to create bot client if not exists
        try {
            const client = await createBotClient(token);
            if (client && client.guilds) {
                const guilds = client.guilds.cache.map(guild => ({
                    id: guild.id,
                    name: guild.name,
                    icon: guild.icon,
                    member_count: guild.memberCount,
                    members: guild.members.cache.map(member => ({
                        id: member.id,
                        user: {
                            id: member.user.id,
                            username: member.user.username,
                            discriminator: member.user.discriminator,
                            avatar: member.user.avatar
                        }
                    }))
                }));
                console.log('📊 Returning guilds from new client:', guilds.length);
                return res.json({ success: true, guilds });
            }
        } catch (clientError) {
            console.log('Bot client creation failed for guilds, using fallback');
        }

        // Fallback to Discord API if client guilds are empty
        console.log('📊 Using Discord API fallback for guilds');
        try {
            const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const guilds = await response.json();
                console.log('📊 Returning guilds from API:', guilds.length);
                return res.json({ success: true, guilds });
            } else {
                console.error('Discord API guilds failed:', response.status);
            }
        } catch (apiError) {
            console.error('Discord API guilds error:', apiError);
        }

        // Final fallback - return empty guilds array
        console.log('📊 No guilds found, returning empty array');
        res.json({ success: true, guilds: [] });

    } catch (error) {
        console.error('Guilds error:', error);
        res.status(401).json({ 
            error: error.message || 'Failed to get bot guilds'
        });
    }
});

// Extract users from a guild
app.post('/api/extract-users', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { guildId, includeBots } = req.body;
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!guildId) {
            return res.status(400).json({ error: 'Guild ID is required' });
        }

        // Get ALL guild members with pagination
        let allMembers = [];
        let after = null;
        let hasMore = true;
        let requestCount = 0;
        const maxRequests = 50; // Safety limit to prevent infinite loops

        console.log(`Starting to fetch all members from guild ${guildId}...`);

        while (hasMore && requestCount < maxRequests) {
            let url = `${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000`;
            if (after) {
                url += `&after=${after}`;
            }

            console.log(`Fetching batch ${requestCount + 1}...`);
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Discord API error: ${response.status}`);
            }

            const members = await response.json();
            allMembers = allMembers.concat(members);
            
            console.log(`Fetched ${members.length} members in batch ${requestCount + 1}. Total so far: ${allMembers.length}`);

            // Check if we have more members to fetch
            if (members.length < 1000) {
                hasMore = false;
            } else {
                // Set the 'after' parameter to the last member's user ID
                after = members[members.length - 1].user.id;
            }
            
            requestCount++;
            
            // Add a small delay to respect rate limits
            if (hasMore) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        console.log(`Finished fetching. Total members: ${allMembers.length}`);

        let users = [];

        for (const member of allMembers) {
            if (!includeBots && member.user.bot) continue;
            
            users.push({
                id: member.user.id,
                username: member.user.username,
                discriminator: member.user.discriminator,
                avatar: member.user.avatar,
                bot: member.user.bot || false,
                joined_at: member.joined_at
            });
        }

        res.json({ success: true, users });

    } catch (error) {
        console.error('Extract users error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to extract users'
        });
    }
});

// Preview recipients for DM sending
app.post('/api/preview-recipients', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { guildId, type } = req.body;
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (type === 'all' && !guildId) {
            return res.status(400).json({ error: 'Guild ID required for "all" type' });
        }

        let count = 0;

        if (type === 'all') {
            // Get ALL guild members with pagination (same as extract users)
            let allMembers = [];
            let after = null;
            let hasMore = true;
            let requestCount = 0;
            const maxRequests = 50; // Safety limit

            console.log(`Starting to fetch all members from guild ${guildId} for preview...`);

            while (hasMore && requestCount < maxRequests) {
                let url = `${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000`;
                if (after) {
                    url += `&after=${after}`;
                }

                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bot ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Discord API error: ${response.status}`);
                }

                const members = await response.json();
                allMembers = allMembers.concat(members);
                
                console.log(`Preview: Fetched ${members.length} members in batch ${requestCount + 1}. Total so far: ${allMembers.length}`);

                // Check if we have more members to fetch
                if (members.length < 1000) {
                    hasMore = false;
                } else {
                    // Set the 'after' parameter to the last member's user ID
                    after = members[members.length - 1].user.id;
                }
                
                requestCount++;
                
                // Add a small delay to respect rate limits
                if (hasMore) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            console.log(`Preview: Finished fetching. Total members: ${allMembers.length}`);
            count = allMembers.filter(member => !member.user.bot).length;
        }

        res.json({ success: true, count });

    } catch (error) {
        console.error('Preview recipients error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to preview recipients'
        });
    }
});

// Send DMs with rate limiting
app.post('/api/send-dms', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { message, guildId, type, customUsers, delay, batchSize, restTime } = req.body;
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Start DM sending process in background
        sendDMsInBackground(token, { message, guildId, type, customUsers, delay, batchSize, restTime });

        res.json({ 
            success: true, 
            message: 'DM sending process started',
            settings: { delay, batchSize, restTime }
        });

    } catch (error) {
        console.error('Send DMs error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to start DM sending'
        });
    }
});

// Search user by username or ID
app.post('/api/search-user', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { method, query, guildId } = req.body;
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        let user = null;

        if (method === 'id') {
            // Search by user ID
            const response = await fetch(`${DISCORD_API_BASE}/users/${query}`, {
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                user = await response.json();
            }
        } else if (method === 'username') {
            let guilds = [];
            
            if (guildId) {
                // Search in specific guild only
                const guildResponse = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}`, {
                    headers: {
                        'Authorization': `Bot ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (guildResponse.ok) {
                    const guild = await guildResponse.json();
                    guilds = [guild];
                }
            } else {
                // Search across ALL guilds with pagination
                const guildsResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
                    headers: {
                        'Authorization': `Bot ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (guildsResponse.ok) {
                    guilds = await guildsResponse.json();
                }
            }
            
            for (const guild of guilds) {
                    console.log(`Searching in guild: ${guild.name} (${guild.id})`);
                    
                    // Fetch ALL members from this guild with pagination
                    let allMembers = [];
                    let after = null;
                    let hasMore = true;
                    let requestCount = 0;
                    const maxRequests = 20; // Limit per guild to prevent timeout

                    while (hasMore && requestCount < maxRequests) {
                        let url = `${DISCORD_API_BASE}/guilds/${guild.id}/members?limit=1000`;
                        if (after) {
                            url += `&after=${after}`;
                        }

                        const membersResponse = await fetch(url, {
                            headers: {
                                'Authorization': `Bot ${token}`,
                                'Content-Type': 'application/json'
                            }
                        });

                        if (membersResponse.ok) {
                            const members = await membersResponse.json();
                            allMembers = allMembers.concat(members);
                            
                            console.log(`Fetched ${members.length} members from ${guild.name}. Total: ${allMembers.length}`);

                            // Check if we have more members to fetch
                            if (members.length < 1000) {
                                hasMore = false;
                            } else {
                                after = members[members.length - 1].user.id;
                            }
                            
                            requestCount++;
                            
                            // Small delay to respect rate limits
                            if (hasMore) {
                                await new Promise(resolve => setTimeout(resolve, 50));
                            }
                        } else {
                            hasMore = false;
                        }
                    }

                    // Search through all members in this guild
                    const foundUser = allMembers.find(member => 
                        member.user.username.toLowerCase() === query.toLowerCase()
                    );
                    
                    if (foundUser) {
                        user = foundUser.user;
                        console.log(`Found user ${query} in guild ${guild.name}`);
                        break;
                    }
                }
            }

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // If searching in a specific guild, get guild member data
        if (guildId) {
            try {
                const memberResponse = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/members/${user.id}`, {
                    headers: {
                        'Authorization': `Bot ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (memberResponse.ok) {
                    const memberData = await memberResponse.json();
                    console.log('📊 Member data received:', {
                        user_id: memberData.user?.id,
                        roles: memberData.roles,
                        roles_count: memberData.roles?.length || 0
                    });
                    
                    user.joined_at = memberData.joined_at;
                    user.nick = memberData.nick;
                    user.premium_since = memberData.premium_since;
                    
                    // Fetch role names
                    if (memberData.roles && memberData.roles.length > 0) {
                        console.log('📊 Fetching role names for', memberData.roles.length, 'roles');
                        try {
                            const guildResponse = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}`, {
                                headers: {
                                    'Authorization': `Bot ${token}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (guildResponse.ok) {
                                const guildData = await guildResponse.json();
                                console.log('📊 Guild data received, roles available:', guildData.roles?.length || 0);
                                
                                const roleMap = {};
                                if (guildData.roles) {
                                    guildData.roles.forEach(role => {
                                        roleMap[role.id] = role.name;
                                    });
                                }
                                
                                user.roles = memberData.roles.map(roleId => ({
                                    id: roleId,
                                    name: roleMap[roleId] || 'Unknown Role'
                                }));
                                
                                console.log('📊 Final roles:', user.roles);
                            } else {
                                console.log('❌ Guild response failed:', guildResponse.status);
                                user.roles = memberData.roles.map(roleId => ({
                                    id: roleId,
                                    name: 'Unknown Role'
                                }));
                            }
                        } catch (roleError) {
                            console.log('❌ Role fetching error:', roleError.message);
                            user.roles = memberData.roles.map(roleId => ({
                                id: roleId,
                                name: 'Unknown Role'
                            }));
                        }
                    } else {
                        console.log('📊 No roles found in member data');
                        user.roles = [];
                    }
                } else {
                    console.log('❌ Member response failed:', memberResponse.status);
                }
            } catch (error) {
                console.log('Could not fetch guild member data:', error.message);
            }
        }

        // Add real-time presence data if available
        const presenceData = userPresence.get(user.id);
        if (presenceData) {
            user.status = presenceData.status;
            user.activities = presenceData.activities;
            user.lastSeen = presenceData.lastSeen;
        } else {
            // Fallback to offline if no presence data
            user.status = 'offline';
        }

        res.json({ success: true, user });

    } catch (error) {
        console.error('Search user error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to search user'
        });
    }
});

// Update bot information
app.post('/api/update-bot', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { username, activity } = req.body;
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        // Create or get bot client
        const client = await createBotClient(token);
        if (!client) {
            return res.status(500).json({ error: 'Failed to create bot client' });
        }

        // Update username if provided
        if (username) {
            try {
                await client.user.setUsername(username);
                console.log(`✅ Bot username updated to: ${username}`);
            } catch (error) {
                console.error('❌ Failed to update username:', error);
            }
        }

        // Update activity if provided
        if (activity) {
            await setBotPresence(token, 'online', activity);
        }

        res.json({ 
            success: true, 
            message: 'Bot updated successfully',
            bot: {
                username: client.user.username,
                id: client.user.id,
                tag: client.user.tag
            }
        });

    } catch (error) {
        console.error('Update bot error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to update bot'
        });
    }
});

// Upload bot avatar
app.post('/api/upload-bot-avatar', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { avatarData } = req.body; // Base64 encoded image data
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!avatarData) {
            return res.status(400).json({ error: 'Avatar data is required' });
        }

        // Convert base64 to proper format for Discord
        const base64Data = avatarData.includes(',') ? avatarData.split(',')[1] : avatarData;
        const avatarDataUri = `data:image/png;base64,${base64Data}`;

        const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                avatar: avatarDataUri
            })
        });

        if (!response.ok) {
            throw new Error(`Discord API error: ${response.status}`);
        }

        const updatedBot = await response.json();
        res.json({ success: true, bot: updatedBot });

    } catch (error) {
        console.error('Upload avatar error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to upload avatar'
        });
    }
});

// Upload bot banner
app.post('/api/upload-bot-banner', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { bannerData } = req.body; // Base64 encoded image data
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!bannerData) {
            return res.status(400).json({ error: 'Banner data is required' });
        }

        // Convert base64 to proper format for Discord
        const base64Data = bannerData.includes(',') ? bannerData.split(',')[1] : bannerData;
        const bannerDataUri = `data:image/png;base64,${base64Data}`;

        const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                banner: bannerDataUri
            })
        });

        if (!response.ok) {
            throw new Error(`Discord API error: ${response.status}`);
        }

        const updatedBot = await response.json();
        res.json({ success: true, bot: updatedBot });

    } catch (error) {
        console.error('Upload banner error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to upload banner'
        });
    }
});

// Get enhanced user information
app.post('/api/get-user-details', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { userId } = req.body;
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Get user details
        const userResponse = await fetch(`${DISCORD_API_BASE}/users/${userId}`, {
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!userResponse.ok) {
            throw new Error(`Discord API error: ${userResponse.status}`);
        }

        const user = await userResponse.json();
        
        // Get user's profile (if accessible)
        let profile = null;
        try {
            const profileResponse = await fetch(`${DISCORD_API_BASE}/users/${userId}/profile`, {
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json'
                }
            });

                if (profileResponse.ok) {
                    profile = await profileResponse.json();
                }
        } catch (error) {
            // Profile might not be accessible
            console.log('Profile not accessible:', error.message);
        }

        const enhancedUser = {
            ...user,
            bio: profile?.user?.bio || null,
            banner: profile?.user?.banner || user.banner || null,
            accent_color: profile?.user?.accent_color || user.accent_color || null,
            premium_type: profile?.user?.premium_type || user.premium_type || null,
            public_flags: profile?.user?.public_flags || user.public_flags || null
        };

        res.json({ success: true, user: enhancedUser });

    } catch (error) {
        console.error('Get user details error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to get user details'
        });
    }
});

// Helper function to convert activity type
function getActivityType(type) {
    const activityTypes = {
        'playing': 0,
        'streaming': 1,
        'listening': 2,
        'watching': 3,
        'custom': 4,
        'competing': 5
    };
    return activityTypes[type] || 0;
}

// Background function to send DMs with rate limiting
async function sendDMsInBackground(token, options) {
    const { message, guildId, type, customUsers, delay, batchSize, restTime } = options;
    
    try {
        // Create bot client and set online
        const client = await createBotClient(token);
        if (client) {
            await setBotPresence(token, 'online');
        }
        
        // Get recipients
        let recipients = [];
        
        if (type === 'all' && guildId) {
            const response = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000`, {
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const members = await response.json();
                recipients = members
                    .filter(member => !member.user.bot)
                    .map(member => member.user.id);
            }
        } else if (type === 'custom' && customUsers && customUsers.length > 0) {
            recipients = customUsers.map(user => user.id);
        }

        console.log(`Starting DM sending to ${recipients.length} recipients`);
        
        // Initialize progress tracking
        let sent = 0;
        let failed = 0;
        const total = recipients.length;
        
        // Broadcast initial progress
        broadcastProgress({ sent, failed, total, status: 'starting' });

        // Auto-batch users into groups of 100
        const autoBatchSize = 100;
        const totalBatches = Math.ceil(recipients.length / autoBatchSize);
        
        console.log(`📊 Auto-batching ${recipients.length} users into ${totalBatches} batches of ${autoBatchSize} users each`);
        
        // Send DMs in auto-batches
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const startIndex = batchIndex * autoBatchSize;
            const endIndex = Math.min(startIndex + autoBatchSize, recipients.length);
            const batch = recipients.slice(startIndex, endIndex);
            
            console.log(`🔄 Processing batch ${batchIndex + 1}/${totalBatches} with ${batch.length} users`);
            broadcastProgress({ 
                sent, 
                failed, 
                total, 
                status: 'sending',
                currentBatch: batchIndex + 1,
                totalBatches: totalBatches,
                batchProgress: 0
            });
            
            let batchSent = 0;
            let batchFailed = 0;
            
            for (let userIndex = 0; userIndex < batch.length; userIndex++) {
                const userId = batch[userIndex];
                
                try {
                    // Create DM channel
                    const dmResponse = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bot ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            recipient_id: userId
                        })
                    });

                    if (dmResponse.ok) {
                        const dmChannel = await dmResponse.json();
                        
                        // Send message
                        const messageResponse = await fetch(`${DISCORD_API_BASE}/channels/${dmChannel.id}/messages`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bot ${token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                content: message
                            })
                        });

                        if (messageResponse.ok) {
                            sent++;
                            batchSent++;
                            console.log(`✅ DM sent successfully to user ${userId}`);
                        } else {
                            failed++;
                            batchFailed++;
                            console.log(`❌ Failed to send DM to user ${userId}: ${messageResponse.status}`);
                        }
                    } else {
                        failed++;
                        batchFailed++;
                        console.log(`❌ Failed to create DM channel for user ${userId}: ${dmResponse.status}`);
                    }

                    // Update batch progress
                    const batchProgress = Math.round(((userIndex + 1) / batch.length) * 100);
                    broadcastProgress({ 
                        sent, 
                        failed, 
                        total, 
                        status: 'sending',
                        currentBatch: batchIndex + 1,
                        totalBatches: totalBatches,
                        batchProgress: batchProgress
                    });

                    // Rate limiting delay
                    await new Promise(resolve => setTimeout(resolve, delay * 1000));
                    
                } catch (error) {
                    failed++;
                    batchFailed++;
                    console.error(`❌ Error sending DM to user ${userId}:`, error.message);
                    broadcastProgress({ 
                        sent, 
                        failed, 
                        total, 
                        status: 'sending',
                        currentBatch: batchIndex + 1,
                        totalBatches: totalBatches
                    });
                }
            }
            
            // Batch completed
            console.log(`✅ Batch ${batchIndex + 1}/${totalBatches} completed - Sent: ${batchSent}, Failed: ${batchFailed}`);
            broadcastProgress({ 
                sent, 
                failed, 
                total, 
                status: 'batch_completed',
                currentBatch: batchIndex + 1,
                totalBatches: totalBatches,
                batchSent: batchSent,
                batchFailed: batchFailed
            });

            // Rest between batches (except for the last batch)
            if (batchIndex < totalBatches - 1) {
                console.log(`⏳ Resting for ${restTime} minutes before next batch...`);
                broadcastProgress({ 
                    sent, 
                    failed, 
                    total, 
                    status: 'resting',
                    currentBatch: batchIndex + 1,
                    totalBatches: totalBatches
                });
                await new Promise(resolve => setTimeout(resolve, restTime * 60 * 1000));
            }
        }

        // Broadcast completion
        broadcastProgress({ sent, failed, total, status: 'completed' });
        console.log(`✅ DM sending completed - Sent: ${sent}, Failed: ${failed}, Total: ${total}`);
        
    } catch (error) {
        console.error('❌ Background DM sending error:', error);
        broadcastProgress({ sent: 0, failed: 0, total: 0, status: 'error', error: error.message });
    }
}

// Test bot connection
app.post('/api/test-bot-connection', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        console.log('🔄 Testing bot connection...');
        const client = await createBotClient(token);
        
        if (client && client.readyAt) {
            res.json({ 
                success: true, 
                message: 'Bot is online and ready!',
                bot: {
                    username: client.user.username,
                    tag: client.user.tag,
                    id: client.user.id,
                    guilds: client.guilds.cache.size,
                    readyAt: client.readyAt
                }
            });
        } else {
            res.status(500).json({ 
                error: 'Failed to connect bot to Discord'
            });
        }
    } catch (error) {
        console.error('Test bot connection error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to test bot connection'
        });
    }
});

// Logout endpoint
app.post('/api/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (token) {
            await disconnectBot(token);
        }
        
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to logout'
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Discord Bot Login API'
    });
});

// Canvas test endpoint
app.get('/api/test-canvas', async (req, res) => {
    try {
        const canvas = createCanvas(200, 100);
        const ctx = canvas.getContext('2d');
        
        // Draw a simple test image
        ctx.fillStyle = '#7289da';
        ctx.fillRect(0, 0, 200, 100);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Canvas Test', 100, 50);
        
        const buffer = canvas.toBuffer('image/png');
        
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch (error) {
        console.error('Canvas test error:', error);
        res.status(500).json({ error: 'Canvas test failed', details: error.message });
    }
});

// Emoji test endpoint
app.get('/api/test-emoji', async (req, res) => {
    try {
        const canvas = createCanvas(400, 200);
        const ctx = canvas.getContext('2d');
        
        // Draw background
        ctx.fillStyle = '#ff69b4';
        ctx.fillRect(0, 0, 400, 200);
        
        // Test emoji rendering
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px Arial, sans-serif';
        ctx.textAlign = 'center';
        
        // Draw various shapes
        drawHeart(ctx, 80, 50, 30, '#ff6b6b');
        drawStar(ctx, 130, 50, 30, '#ffd700');
        drawMusicNote(ctx, 180, 50, 30, '#ffffff');
        drawDiamond(ctx, 230, 50, 30, '#ff69b4');
        drawSparkle(ctx, 280, 50, 30, '#ffa500');
        
        drawHeart(ctx, 80, 100, 25, '#ff6b6b');
        drawStar(ctx, 130, 100, 25, '#ffd700');
        drawMusicNote(ctx, 180, 100, 25, '#ffffff');
        drawDiamond(ctx, 230, 100, 25, '#ff69b4');
        drawSparkle(ctx, 280, 100, 25, '#ffa500');
        
        drawHeart(ctx, 80, 150, 20, '#ff6b6b');
        drawStar(ctx, 130, 150, 20, '#ffd700');
        drawMusicNote(ctx, 180, 150, 20, '#ffffff');
        drawDiamond(ctx, 230, 150, 20, '#ff69b4');
        drawSparkle(ctx, 280, 150, 20, '#ffa500');
        
        const buffer = canvas.toBuffer('image/png');
        
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch (error) {
        console.error('Emoji test error:', error);
        res.status(500).json({ error: 'Emoji test failed', details: error.message });
    }
});

// Debug endpoint to check user stats
app.get('/api/debug-stats', (req, res) => {
    try {
        const allStats = Array.from(userStats.entries());
        res.json({
            totalUsers: allStats.length,
            stats: allStats.map(([key, stats]) => ({
                key,
                messages: stats.messages,
                reactions: stats.reactions,
                lastSeen: stats.lastSeen
            }))
        });
    } catch (error) {
        console.error('Debug stats error:', error);
        res.status(500).json({ error: 'Debug stats failed', details: error.message });
    }
});

// Music Player API Endpoints
app.post('/api/music/test-lavalink', async (req, res) => {
    try {
        const { host, port, password } = req.body;
        
        if (!host || !port || !password) {
            return res.status(400).json({ error: 'Missing required Lavalink configuration' });
        }

        const WebSocket = require("ws");
        const secure = false;
        const headers = {
            Authorization: password,
            "User-Id": Math.floor(Math.random() * 10000),
            "Client-Name": "Lavalink-Status-Test",
        };

        console.log(`Testing connection to ${host}:${port}...`);

        const ws = new WebSocket(
            `ws${secure ? "s" : ""}://${host}:${port}/v4/websocket`,
            { headers }
        );

        const timeout = setTimeout(() => {
            if (!responseSent) {
                responseSent = true;
                ws.close();
                res.status(408).json({ error: 'Connection timeout' });
            }
        }, 10000);

        let responseSent = false;

        ws.on("open", () => {
            console.log("✅ Connected to Lavalink server!");
            if (!responseSent) {
                responseSent = true;
                clearTimeout(timeout);
                ws.close();
                res.json({ 
                    success: true, 
                    message: 'Lavalink connection successful',
                    host,
                    port,
                    password
                });
            }
        });

        ws.on("message", (message) => {
            const payload = JSON.parse(message.toString());
            if (payload.op === "stats") {
                console.log("📊 Lavalink Stats:", JSON.stringify(payload, null, 2));
                if (!responseSent) {
                    responseSent = true;
                    clearTimeout(timeout);
                    ws.close();
                    res.json({ 
                        success: true, 
                        message: 'Lavalink connection successful',
                        stats: {
                            players: payload.players,
                            playingPlayers: payload.playingPlayers,
                            uptime: payload.uptime,
                            memory: payload.memory,
                            cpu: payload.cpu
                        },
                        host,
                        port,
                        password
                    });
                }
            }
        });

        ws.on("error", (error) => {
            console.log("❌ Lavalink connection error:", error.message);
            if (!responseSent) {
                responseSent = true;
                clearTimeout(timeout);
                res.status(500).json({ error: `Connection failed: ${error.message}` });
            }
        });

    } catch (error) {
        console.error('Lavalink test error:', error);
        res.status(500).json({ error: 'Failed to test Lavalink connection', details: error.message });
    }
});

app.post('/api/music/connect-lavalink', async (req, res) => {
    try {
        const { host, port, password, name, secure } = req.body;
        
        if (!host || !port || !password || !name) {
            return res.status(400).json({ error: 'Missing required Lavalink configuration' });
        }

        const config = {
            name: name,
            password: password,
            host: host,
            port: parseInt(port),
            secure: secure || false,
        };

        // Initialize Lavalink connection
        if (activeClients.size > 0) {
            const client = Array.from(activeClients.values())[0];
            
            // Initialize Lavalink for the client
            if (!client.riffy) {
                client.riffy = new Riffy(client, [config], {
                    send: (payload) => {
                        const guild = client.guilds.cache.get(payload.d.guild_id);
                        if (guild) guild.shard.send(payload);
                    },
                    defaultSearchPlatform: "ytmsearch",
                    restVersion: "v4",
                });

                client.riffy.on("nodeConnect", (node) => {
                    console.log(`🎵 Lavalink node "${node.name}" connected.`);
                });

                client.riffy.on("nodeError", (node, error) => {
                    console.log(`❌ Lavalink node "${node.name}" error: ${error.message}`);
                });

                client.riffy.on("trackStart", async (player, track) => {
                    console.log(`🎵 Now playing: ${track.info.title} by ${track.info.author}`);
                });

                client.riffy.on("queueEnd", async (player) => {
                    console.log("🎵 Queue ended");
                    player.destroy();
                });

                client.riffy.on("trackEnd", async (player, track) => {
                    console.log(`🎵 Track ended: ${track.info.title}`);
                });

                // Handle voice state updates
                client.on("raw", (d) => {
                    if (d.t === "VOICE_STATE_UPDATE" || d.t === "VOICE_SERVER_UPDATE") {
                        client.riffy.updateVoiceState(d);
                    }
                });

                client.riffy.init(client.user.id);
            }
            
            console.log('✅ Lavalink initialized for client');
        } else {
            console.log('⚠️ No active clients available for Lavalink');
        }

        res.json({ success: true, message: 'Lavalink configuration received' });
    } catch (error) {
        console.error('Lavalink connection error:', error);
        res.status(500).json({ error: 'Failed to connect to Lavalink', details: error.message });
    }
});

app.post('/api/music/search', async (req, res) => {
    try {
        const { query, userId, guildId } = req.body;
        
        if (!query || !userId || !guildId) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // Get the active client
        if (activeClients.size === 0) {
            return res.status(400).json({ error: 'No bot client available' });
        }

        const client = Array.from(activeClients.values())[0];
        
        if (!client.riffy) {
            return res.status(400).json({ error: 'Lavalink not initialized. Please connect to Lavalink first.' });
        }

        // Perform actual search using Lavalink
        // Use Riffy's resolve method for searching
        const searchResults = await client.riffy.resolve({
            query: query,
            requester: { id: userId, username: 'Dashboard User' }
        });
        
        console.log('Search results:', JSON.stringify(searchResults, null, 2));
        console.log('Load type:', searchResults.loadType);
        console.log('Tracks count:', searchResults.tracks ? searchResults.tracks.length : 0);
        
        if (!searchResults || !searchResults.tracks || searchResults.tracks.length === 0) {
            return res.json({ success: true, results: [] });
        }

        // Format results for frontend
        const formattedResults = searchResults.tracks.slice(0, 10).map(track => ({
            title: track.info.title,
            author: track.info.author,
            duration: track.info.length,
            thumbnail: track.info.artworkUrl || `https://img.youtube.com/vi/${track.info.identifier}/hqdefault.jpg`,
            url: track.track,
            identifier: track.info.identifier
        }));

        res.json({ success: true, results: formattedResults });
    } catch (error) {
        console.error('Music search error:', error);
        res.status(500).json({ error: 'Search failed', details: error.message });
    }
});

app.post('/api/music/play', async (req, res) => {
    try {
        const { trackUrl, userId, guildId } = req.body;
        
        if (!trackUrl || !userId || !guildId) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // Get the active client
        if (activeClients.size === 0) {
            return res.status(400).json({ error: 'No bot client available' });
        }

        const client = Array.from(activeClients.values())[0];
        
        if (!client.riffy) {
            return res.status(400).json({ error: 'Lavalink not initialized. Please connect to Lavalink first.' });
        }

        // Get the guild
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(400).json({ error: 'Guild not found' });
        }

        // Find the user's voice channel
        const member = guild.members.cache.get(userId);
        if (!member || !member.voice.channel) {
            return res.status(400).json({ error: 'User is not in a voice channel' });
        }

        const voiceChannel = member.voice.channel;
        
        console.log(`🎵 Attempting to play track: ${trackUrl}`);
        console.log(`🎵 User ${userId} in voice channel: ${voiceChannel.name} (${voiceChannel.id})`);
        
        // Get or create player
        let player = client.riffy.players.get(guildId);
        if (!player) {
            console.log('🎵 Creating new player for guild:', guildId);
            player = client.riffy.createPlayer({
                guildId: guildId,
                voiceChannelId: voiceChannel.id,
                textChannelId: null, // We'll handle this separately
                volume: 50,
                selfDeaf: true
            });
        } else {
            console.log('🎵 Using existing player for guild:', guildId);
        }

        // Connect to voice channel if not already connected
        if (!player.voiceChannelId || player.voiceChannelId !== voiceChannel.id) {
            console.log('🎵 Connecting to voice channel:', voiceChannel.id);
            await player.connect(voiceChannel.id);
        } else {
            console.log('🎵 Already connected to voice channel:', voiceChannel.id);
        }

        // Play the track
        console.log('🎵 Playing track:', trackUrl);
        await player.play(trackUrl);

        res.json({ 
            success: true, 
            message: 'Track queued for playback',
            voiceChannel: voiceChannel.name
        });
    } catch (error) {
        console.error('Music play error:', error);
        res.status(500).json({ error: 'Failed to play track', details: error.message });
    }
});

app.post('/api/music/pause', async (req, res) => {
    try {
        const { guildId } = req.body;
        
        if (!guildId) {
            return res.status(400).json({ error: 'Guild ID required' });
        }

        // Get the active client
        if (activeClients.size === 0) {
            return res.status(400).json({ error: 'No bot client available' });
        }

        const client = Array.from(activeClients.values())[0];
        const player = client.riffy.players.get(guildId);
        
        if (!player) {
            return res.status(400).json({ error: 'No player found for this guild' });
        }

        // Toggle pause/resume
        if (player.paused) {
            player.resume();
            res.json({ success: true, message: 'Playback resumed' });
        } else {
            player.pause();
            res.json({ success: true, message: 'Playback paused' });
        }
    } catch (error) {
        console.error('Music pause error:', error);
        res.status(500).json({ error: 'Failed to pause', details: error.message });
    }
});

app.post('/api/music/stop', async (req, res) => {
    try {
        const { guildId } = req.body;
        
        if (!guildId) {
            return res.status(400).json({ error: 'Guild ID required' });
        }

        // Get the active client
        if (activeClients.size === 0) {
            return res.status(400).json({ error: 'No bot client available' });
        }

        const client = Array.from(activeClients.values())[0];
        const player = client.riffy.players.get(guildId);
        
        if (!player) {
            return res.status(400).json({ error: 'No player found for this guild' });
        }

        // Stop and destroy player
        player.stop();
        player.destroy();
        
        res.json({ success: true, message: 'Playback stopped' });
    } catch (error) {
        console.error('Music stop error:', error);
        res.status(500).json({ error: 'Failed to stop', details: error.message });
    }
});

app.get('/api/music/queue/:guildId', async (req, res) => {
    try {
        const { guildId } = req.params;
        
        // This would need to be implemented with actual Lavalink queue
        res.json({ success: true, queue: [] });
    } catch (error) {
        console.error('Music queue error:', error);
        res.status(500).json({ error: 'Failed to get queue', details: error.message });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve the dashboard page
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/test', (req, res) => {
    res.sendFile(path.join(__dirname, 'test.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// WebSocket server for real-time updates
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Store active connections
const activeConnections = new Set();

wss.on('connection', (ws) => {
    activeConnections.add(ws);
    console.log('Client connected to WebSocket');
    
    ws.on('close', () => {
        activeConnections.delete(ws);
        console.log('Client disconnected from WebSocket');
    });
});

// Function to broadcast progress updates
function broadcastProgress(data) {
    const message = JSON.stringify({ type: 'progress', data });
    activeConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

// Function to broadcast logs to all connected clients
function broadcastLog(message, type = 'info') {
    const logData = {
        type: 'log',
        message: message,
        logType: type,
        timestamp: new Date().toISOString()
    };
    
    activeConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(logData));
        }
    });
}

// Override console.log to also send to WebSocket
const originalConsoleLog = console.log;
console.log = function(...args) {
    originalConsoleLog.apply(console, args);
    broadcastLog(args.join(' '), 'info');
};

const originalConsoleError = console.error;
console.error = function(...args) {
    originalConsoleError.apply(console, args);
    broadcastLog(args.join(' '), 'error');
};

// Discord bot client management
const botClients = new Map();
const loginInProgress = new Set();

// Store user presence data
const userPresence = new Map();

async function createBotClient(token) {
    try {
        // Check if login is already in progress for this token
        if (loginInProgress.has(token)) {
            console.log('🔄 Login already in progress for this token, waiting...');
            // Wait for the existing login to complete
            while (loginInProgress.has(token)) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            // Return the client that was created
            if (botClients.has(token)) {
                return botClients.get(token);
            }
        }

        // Check if client already exists and is ready
        if (botClients.has(token)) {
            const existingClient = botClients.get(token);
            if (existingClient.readyAt && existingClient.user) {
                console.log('✅ Using existing bot client');
                return existingClient;
            } else {
                console.log('🔄 Existing client not ready, cleaning up and creating new one');
                // Clean up the old client
                try {
                    if (existingClient.destroy) {
                        await existingClient.destroy();
                    }
                } catch (error) {
                    console.log('Old client cleanup failed:', error.message);
                }
                botClients.delete(token);
            }
        }

        // Mark login as in progress
        loginInProgress.add(token);

        const client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.GuildPresences,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildVoiceStates
            ]
        });

        // Initialize Lavalink/Riffy
        let riffy = null;
        let lavalinkConfig = null;

        // Function to initialize Lavalink
        function initializeLavalink(config) {
            if (riffy) {
                riffy.destroy();
            }
            
            lavalinkConfig = config;
            riffy = new Riffy(client, [config], {
                send: (payload) => {
                    const guild = client.guilds.cache.get(payload.d.guild_id);
                    if (guild) guild.shard.send(payload);
                },
                defaultSearchPlatform: "ytmsearch",
                restVersion: "v4",
            });

            riffy.on("nodeConnect", (node) => {
                console.log(`🎵 Lavalink node "${node.name}" connected.`);
            });

            riffy.on("nodeError", (node, error) => {
                console.log(`❌ Lavalink node "${node.name}" error: ${error.message}`);
            });

            riffy.on("trackStart", async (player, track) => {
                console.log(`🎵 Now playing: ${track.info.title} by ${track.info.author}`);
            });

            riffy.on("queueEnd", async (player) => {
                console.log("🎵 Queue ended");
                player.destroy();
            });

            riffy.on("trackEnd", async (player, track) => {
                console.log(`🎵 Track ended: ${track.info.title}`);
            });

            riffy.init(client.user.id);
            return true;
        }

        // Set up event handlers before login
        client.once('ready', () => {
            console.log(`✅ Bot ${client.user.tag} is online and ready!`);
            console.log(`✅ Bot is in ${client.guilds.cache.size} servers`);
            
            // Add client to activeClients map
            activeClients.set(token, client);
            console.log(`✅ Bot client added to activeClients map`);
        });

        client.on('error', (error) => {
            console.error('❌ Discord bot error:', error);
            // Remove client from activeClients on error
            activeClients.delete(token);
        });

        client.on('warn', (warning) => {
            console.warn('⚠️ Discord bot warning:', warning);
        });

        client.on('disconnect', () => {
            console.log('🔌 Bot disconnected');
            // Remove client from activeClients on disconnect
            activeClients.delete(token);
        });

        // Listen for presence updates
        client.on('presenceUpdate', (oldPresence, newPresence) => {
            if (newPresence && newPresence.userId) {
                const status = newPresence.status || 'offline';
                const activities = newPresence.activities || [];
                
                // Store presence data
                userPresence.set(newPresence.userId, {
                    status: status,
                    activities: activities,
                    lastSeen: new Date().toISOString()
                });
                
                console.log(`📊 Presence update: ${newPresence.userId} is now ${status}`);
            }
        });

        // Listen for messages to handle commands
        client.on('messageCreate', async (message) => {
            console.log(`📝 Raw message event received from ${message.author?.tag || 'unknown'}`);
            
            // Ignore bot messages
            if (message.author.bot) {
                console.log(`🤖 Ignoring bot message from ${message.author.tag}`);
                return;
            }
            
            console.log(`📝 Message received: "${message.content}" from ${message.author.tag} in ${message.guild?.name}`);
            
            // Track user statistics
            trackUserMessage(message);
            
            // Check if message is a command
            const content = message.content.toLowerCase().trim();
            
            // Get commands for this guild
            const guildCommands = Array.from(messageCommands.values())
                .filter(cmd => cmd.guildId === message.guild?.id);
            
            console.log(`🔍 Found ${guildCommands.length} commands for guild ${message.guild?.id}`);
            console.log(`🔍 Commands:`, guildCommands.map(cmd => cmd.trigger));
            console.log(`🔍 Looking for trigger: "${content}"`);
            
            for (const command of guildCommands) {
                console.log(`🔍 Checking command "${command.trigger}" against "${content}"`);
                
                // Check for exact match first
                if (content === command.trigger.toLowerCase()) {
                    console.log(`🎯 Command triggered: ${command.trigger} by ${message.author.tag}`);
                    await handleMessageCommand(message, command);
                    break; // Only handle one command per message
                }
                
                // Check for commands that start with the trigger (for commands with mentions like "match @user")
                if (content.startsWith(command.trigger.toLowerCase() + ' ')) {
                    console.log(`🎯 Command triggered: ${command.trigger} by ${message.author.tag}`);
                    await handleMessageCommand(message, command);
                    break; // Only handle one command per message
                }
            }
        });

        // Listen for message reactions
        client.on('messageReactionAdd', (reaction, user) => {
            if (user.bot) return;
            trackUserReaction(reaction, user, 'add');
        });

        client.on('messageReactionRemove', (reaction, user) => {
            if (user.bot) return;
            trackUserReaction(reaction, user, 'remove');
        });

        // Login and wait for ready
        console.log('🔄 Attempting to login bot...');
        await client.login(token);
        
        // Wait for the client to be ready
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Login timeout'));
            }, 10000); // 10 second timeout

            client.once('ready', () => {
                clearTimeout(timeout);
                resolve();
            });

            client.once('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });

        botClients.set(token, client);
        console.log(`✅ Bot client created and ready for token: ${token.substring(0, 10)}...`);
        
        // Remove from login in progress
        loginInProgress.delete(token);
        
        return client;
    } catch (error) {
        console.error('❌ Failed to create bot client:', error.message);
        // Remove from login in progress on error
        loginInProgress.delete(token);
        return null;
    }
}

async function setBotPresence(token, status = 'online', activity = null) {
    try {
        const client = await createBotClient(token);
        if (!client) return;

        const presenceOptions = {
            status: status,
            activities: []
        };

        if (activity) {
            presenceOptions.activities.push({
                name: activity.name,
                type: getActivityType(activity.type),
                url: activity.url || null
            });
        }

        client.user.setPresence(presenceOptions);
        console.log(`✅ Bot presence set to ${status}${activity ? ` with activity: ${activity.name}` : ''}`);
        
    } catch (error) {
        console.error('❌ Failed to set bot presence:', error);
    }
}

async function disconnectBot(token) {
    try {
        if (botClients.has(token)) {
            const client = botClients.get(token);
            await client.destroy();
            botClients.delete(token);
            console.log('✅ Bot disconnected');
        }
    } catch (error) {
        console.error('❌ Failed to disconnect bot:', error);
    }
}

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ success: true, message: 'Server is working' });
});


// Chat API endpoints
app.post('/api/get-chat-history', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { userId } = req.body;
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        // For chat history, just return empty for now since DM channel access is restricted
        // The important part is that sending messages still works
        return res.json({ 
            success: true, 
            messages: [],
            note: 'Chat history unavailable. You can still send messages!'
        });

        // Fetch messages from the channel
        const messagesResponse = await fetch(`${DISCORD_API_BASE}/channels/${channel.id}/messages?limit=50`, {
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!messagesResponse.ok) {
            throw new Error(`Failed to get messages: ${messagesResponse.status}`);
        }

        const messages = await messagesResponse.json();
        
        // Format messages for chat display
        const formattedMessages = messages.map(msg => ({
            content: msg.content,
            sender: msg.author.bot ? 'bot' : 'user',
            timestamp: msg.timestamp,
            author: {
                username: msg.author.username,
                avatar: msg.author.avatar
            }
        })).reverse(); // Reverse to show oldest first

        res.json({ 
            success: true, 
            messages: formattedMessages 
        });

    } catch (error) {
        console.error('Get chat history error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to get chat history' 
        });
    }
});

app.post('/api/send-chat-message', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { userId, message } = req.body;
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!userId || !message) {
            return res.status(400).json({ error: 'User ID and message required' });
        }

        // Use the same approach as the regular DM sending (which works)
        // Create DM channel directly - this is the same method used in sendDMsInBackground
        const response = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipient_id: userId
            })
        });

        if (!response.ok) {
            if (response.status === 403) {
                return res.status(400).json({ 
                    error: 'Cannot send DM to this user. They may have DMs disabled or haven\'t interacted with the bot.' 
                });
            }
            return res.status(400).json({ 
                error: `Failed to create DM channel: ${response.status}` 
            });
        }

        const channel = await response.json();

        // Send the message
        const messageResponse = await fetch(`${DISCORD_API_BASE}/channels/${channel.id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: message
            })
        });

        if (!messageResponse.ok) {
            throw new Error(`Failed to send message: ${messageResponse.status}`);
        }

        res.json({ 
            success: true, 
            message: 'Message sent successfully' 
        });

    } catch (error) {
        console.error('Send chat message error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to send message' 
        });
    }
});

// Sticker API endpoints
app.post('/api/get-stickers', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { guildId } = req.body;
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!guildId) {
            return res.status(400).json({ error: 'Guild ID is required' });
        }

        // Get guild stickers from Discord API
        try {
            const response = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/stickers`, {
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const stickers = await response.json();
                res.json({ 
                    success: true, 
                    stickers: stickers,
                    stats: {
                        total: 30,
                        used: stickers.length,
                        available: 30 - stickers.length
                    }
                });
            } else {
                console.error(`Failed to get stickers: ${response.status}`);
                res.json({ 
                    success: true, 
                    stickers: [],
                    stats: {
                        total: 30,
                        used: 0,
                        available: 30
                    }
                });
            }
        } catch (apiError) {
            console.error('Discord API error:', apiError);
            res.json({ 
                success: true, 
                stickers: [],
                stats: {
                    total: 30,
                    used: 0,
                    available: 30
                }
            });
        }

    } catch (error) {
        console.error('Get stickers error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to get stickers' 
        });
    }
});

app.post('/api/upload-sticker', upload.single('file'), async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { name, description, method, stickerId, guildId } = req.body;
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!guildId) {
            return res.status(400).json({ error: 'Guild ID is required' });
        }

        if (!name) {
            return res.status(400).json({ error: 'Sticker name is required' });
        }

        let stickerData;
        
        if (method === 'file') {
            if (!req.file) {
                return res.status(400).json({ error: 'No file provided' });
            }

            // Resize image to 320x320 using Sharp
            const resizedBuffer = await sharp(req.file.buffer)
                .resize(320, 320, { 
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .png()
                .toBuffer();

            // Convert to base64
            const base64Data = resizedBuffer.toString('base64');
            stickerData = `data:image/png;base64,${base64Data}`;
        } else {
            // For sticker ID method, fetch the sticker from Discord and upload it
            if (!stickerId) {
                return res.status(400).json({ error: 'Sticker ID is required for ID upload method' });
            }

            try {
                // Fetch the sticker from Discord
                const stickerResponse = await fetch(`${DISCORD_API_BASE}/stickers/${stickerId}`, {
                    headers: {
                        'Authorization': `Bot ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!stickerResponse.ok) {
                    if (stickerResponse.status === 404) {
                        return res.status(400).json({ error: 'Sticker not found. Make sure the sticker ID is correct.' });
                    }
                    return res.status(400).json({ error: 'Sticker not accessible. The sticker might be from a different server.' });
                }

                const originalSticker = await stickerResponse.json();
                
                if (!originalSticker || !originalSticker.id) {
                    return res.status(400).json({ error: 'Invalid sticker data received from Discord' });
                }
                
                // Use the same approach as your friend's script
                let success = false;
                let imageBuffer;
                
                // First, try to get the asset URL from Discord's API response
                if (originalSticker.asset) {
                    console.log(`Using Discord asset URL: ${originalSticker.asset}`);
                    try {
                        const assetResponse = await fetch(originalSticker.asset, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                                'Accept': 'image/*,*/*;q=0.8',
                                'Accept-Language': 'en-US,en;q=0.5',
                                'Accept-Encoding': 'gzip, deflate, br',
                                'DNT': '1',
                                'Connection': 'keep-alive',
                                'Upgrade-Insecure-Requests': '1'
                            }
                        });
                        
                        if (assetResponse.ok) {
                            imageBuffer = await assetResponse.buffer();
                            success = true;
                            console.log(`✅ Successfully downloaded from asset URL (${imageBuffer.length} bytes)`);
                        }
                    } catch (e) {
                        console.log(`Failed to download from asset URL:`, e.message);
                    }
                }
                
                // Fallback: try direct URL patterns if asset URL doesn't work
                if (!success) {
                    console.log('Asset URL failed, trying direct URL patterns...');
                    
                    // Try different URL patterns - prioritize GIF formats for animated stickers
                    const urlPatterns = [
                        `https://media.discordapp.net/stickers/${originalSticker.id}.gif`,
                        `https://cdn.discordapp.com/stickers/${originalSticker.id}.gif`,
                        `https://media.discordapp.net/stickers/${originalSticker.id}.png`,
                        `https://cdn.discordapp.com/stickers/${originalSticker.id}.png`
                    ];
                    
                    for (const stickerUrl of urlPatterns) {
                        try {
                            console.log(`Trying sticker URL: ${stickerUrl}`);
                            const urlResponse = await fetch(stickerUrl, {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                                    'Accept': 'image/*,*/*;q=0.8',
                                    'Accept-Language': 'en-US,en;q=0.5',
                                    'Accept-Encoding': 'gzip, deflate, br',
                                    'DNT': '1',
                                    'Connection': 'keep-alive',
                                    'Upgrade-Insecure-Requests': '1'
                                }
                            });
                            
                            if (urlResponse.ok) {
                                imageBuffer = await urlResponse.buffer();
                                success = true;
                                console.log(`✅ Successfully downloaded from ${stickerUrl} (${imageBuffer.length} bytes)`);
                                console.log(`🔍 Downloaded file signature: [${Array.from(imageBuffer.slice(0, 4)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
                                break;
                            }
                        } catch (e) {
                            console.log(`Failed to download from ${stickerUrl}:`, e.message);
                            continue;
                        }
                    }
                }
                
                if (!success) {
                    return res.status(400).json({ error: 'Could not find or download the sticker with that ID. Make sure the ID is correct and the sticker is publicly accessible.' });
                }
                
                // Use the same checkIfAnimated function as your friend's script
                async function checkIfAnimated(buffer) {
                    try {
                        // Check for GIF signature
                        const gifSignature = [0x47, 0x49, 0x46, 0x38]; // "GIF8"
                        const isGif = gifSignature.every((byte, index) => buffer[index] === byte);
                        
                        if (isGif) {
                            // For GIFs, check if it's animated by looking for multiple image descriptors
                            // Animated GIFs have multiple image descriptors (0x2C bytes)
                            let imageDescriptorCount = 0;
                            for (let i = 0; i < buffer.length - 1; i++) {
                                if (buffer[i] === 0x2C) { // Image separator
                                    imageDescriptorCount++;
                                }
                            }
                            return imageDescriptorCount > 1; // More than one image = animated
                        }
                        
                        // Check for APNG signature
                        const apngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]; // PNG signature
                        const isPng = apngSignature.every((byte, index) => buffer[index] === byte);
                        
                        if (isPng) {
                            // Look for acTL chunk (animation control) in APNG
                            const bufferString = buffer.toString('binary');
                            return bufferString.includes('acTL');
                        }
                        
                        return false;
                    } catch (error) {
                        console.log('Error checking animation:', error.message);
                        return false;
                    }
                }
                
                // Check if it's animated using the same logic as your friend's script
                console.log(`🔍 Original sticker data:`, JSON.stringify(originalSticker, null, 2));
                const isAnimated = await checkIfAnimated(imageBuffer);
                console.log(`🔍 Animation detection result: ${isAnimated}`);
                
                console.log(`🔍 Format detection: First 4 bytes: [${Array.from(imageBuffer.slice(0, 4)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
                console.log(`🔍 Final animated detection: ${isAnimated}`);
                
                if (isAnimated) {
                    // It's animated - but we need to convert PNG to GIF for Discord
                    if (imageBuffer.length > 524288) {
                        return res.status(400).json({ error: 'Animated sticker too large (must be under 512KB)' });
                    }
                    
                    // Check if it's already GIF format
                    const isGifFormat = imageBuffer[0] === 0x47 && imageBuffer[1] === 0x49 && 
                                       imageBuffer[2] === 0x46 && imageBuffer[3] === 0x38;
                    
                    if (isGifFormat) {
                        // Already GIF - use as is
                        const base64Data = imageBuffer.toString('base64');
                        stickerData = `data:image/gif;base64,${base64Data}`;
                        console.log(`✅ Animated GIF detected - preserving animation`);
                    } else {
                        // It's PNG but detected as animated - convert to GIF
                        console.log(`🔄 Converting animated PNG to GIF format...`);
                        try {
                            // Use sharp to convert PNG to GIF (preserves animation if it's APNG)
                            const gifBuffer = await sharp(imageBuffer)
                                .gif()
                                .toBuffer();
                            
                            const base64Data = gifBuffer.toString('base64');
                            stickerData = `data:image/gif;base64,${base64Data}`;
                            console.log(`✅ Converted animated PNG to GIF (${gifBuffer.length} bytes)`);
                        } catch (convertError) {
                            console.log(`⚠️ Could not convert to GIF, using original PNG: ${convertError.message}`);
                            // Fallback to original PNG
                            const base64Data = imageBuffer.toString('base64');
                            stickerData = `data:image/png;base64,${base64Data}`;
                        }
                    }
                } else {
                    // It's static - process normally
                    const resizedBuffer = await sharp(imageBuffer)
                        .resize(320, 320, { 
                            fit: 'cover',
                            position: 'center',
                            background: { r: 255, g: 255, b: 255, alpha: 1 }
                        })
                        .png({ compressionLevel: 6 })
                        .toBuffer();

                    const base64Data = resizedBuffer.toString('base64');
                    stickerData = `data:image/png;base64,${base64Data}`;
                    console.log(`✅ Static sticker processed and resized`);
                }
            } catch (fetchError) {
                console.error('Error fetching sticker:', fetchError);
                return res.status(400).json({ error: 'Failed to fetch sticker from Discord' });
            }
        }

        // Upload sticker to Discord using multipart/form-data
        try {
            // Convert base64 to buffer
            const base64Data = stickerData.split(',')[1]; // Remove data:image/...;base64, prefix
            const binaryData = Buffer.from(base64Data, 'base64');
            
            // Determine file extension based on format
            const isAnimated = stickerData.startsWith('data:image/gif');
            const fileExtension = isAnimated ? 'gif' : 'png';
            const fileName = `${name}.${fileExtension}`;
            
            // Create multipart form data manually
            const boundary = '----formdata-discord-sticker-' + Math.random().toString(16);
            const formData = [];
            
            // Add name field
            formData.push(`--${boundary}`);
            formData.push('Content-Disposition: form-data; name="name"');
            formData.push('');
            formData.push(name);
            
            // Add description field
            formData.push(`--${boundary}`);
            formData.push('Content-Disposition: form-data; name="description"');
            formData.push('');
            formData.push(description || '');
            
            // Add tags field
            formData.push(`--${boundary}`);
            formData.push('Content-Disposition: form-data; name="tags"');
            formData.push('');
            formData.push(name);
            
            // Add file field
            formData.push(`--${boundary}`);
            formData.push(`Content-Disposition: form-data; name="file"; filename="${fileName}"`);
            formData.push(`Content-Type: ${isAnimated ? 'image/gif' : 'image/png'}`);
            formData.push('');
            
            // Convert form data to buffer
            const formDataString = formData.join('\r\n') + '\r\n';
            const formDataBuffer = Buffer.concat([
                Buffer.from(formDataString),
                binaryData,
                Buffer.from(`\r\n--${boundary}--\r\n`)
            ]);
            
            const uploadResponse = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/stickers`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`
                },
                body: formDataBuffer
            });

            if (uploadResponse.ok) {
                const uploadedSticker = await uploadResponse.json();
                res.json({ 
                    success: true, 
                    message: 'Sticker uploaded successfully!',
                    sticker: uploadedSticker
                });
            } else {
                const errorData = await uploadResponse.json();
                console.error('Discord API upload error:', errorData);
                res.status(400).json({ 
                    error: `Failed to upload sticker: ${errorData.message || uploadResponse.status}` 
                });
            }
        } catch (uploadError) {
            console.error('Upload error:', uploadError);
            res.status(500).json({ 
                error: 'Failed to upload sticker to Discord' 
            });
        }

    } catch (error) {
        console.error('Upload sticker error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to upload sticker' 
        });
    }
});

app.post('/api/delete-sticker', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { stickerId, guildId } = req.body;
        
        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!guildId) {
            return res.status(400).json({ error: 'Guild ID is required' });
        }

        if (!stickerId) {
            return res.status(400).json({ error: 'Sticker ID is required' });
        }

        // Delete sticker from Discord
        try {
            const deleteResponse = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/stickers/${stickerId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (deleteResponse.ok) {
                res.json({ 
                    success: true, 
                    message: 'Sticker deleted successfully!' 
                });
            } else {
                const errorData = await deleteResponse.json();
                console.error('Discord API delete error:', errorData);
                res.status(400).json({ 
                    error: `Failed to delete sticker: ${errorData.message || deleteResponse.status}` 
                });
            }
        } catch (deleteError) {
            console.error('Delete error:', deleteError);
            res.status(500).json({ 
                error: 'Failed to delete sticker from Discord' 
            });
        }

    } catch (error) {
        console.error('Delete sticker error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to delete sticker' 
        });
    }
});


app.post('/api/get-user-info', async (req, res) => {
    try {
        const { guildId, userId } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!guildId || !userId) {
            return res.status(400).json({ error: 'Guild ID and User ID required' });
        }

        // Get user information
        const userResponse = await fetch(`${DISCORD_API_BASE}/users/${userId}`, {
            headers: { 'Authorization': `Bot ${token}` }
        });

        if (!userResponse.ok) {
            return res.status(400).json({ error: 'User not found' });
        }

        const user = await userResponse.json();

        // Get guild member information
        const memberResponse = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/members/${userId}`, {
            headers: { 'Authorization': `Bot ${token}` }
        });

        let memberInfo = null;
        if (memberResponse.ok) {
            memberInfo = await memberResponse.json();
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                discriminator: user.discriminator,
                avatar: user.avatar,
                bot: user.bot,
                created: user.created_at,
                joinDate: memberInfo?.joined_at,
                roles: memberInfo?.roles || [],
                status: 'offline' // Discord doesn't provide real-time presence via API
            }
        });

    } catch (error) {
        console.error('User info error:', error);
        res.status(500).json({ error: 'Failed to fetch user information' });
    }
});

// Server Statistics API endpoints
app.post('/api/get-server-stats', async (req, res) => {
    try {
        const { guildId } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        if (!guildId) {
            return res.status(400).json({ error: 'Guild ID required' });
        }

        console.log(`📊 Fetching server statistics for guild: ${guildId}`);

        // Get guild information
        const guildResponse = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}`, {
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!guildResponse.ok) {
            throw new Error(`Failed to fetch guild: ${guildResponse.status}`);
        }

        const guild = await guildResponse.json();

        // Get guild members with pagination
        let allMembers = [];
        let after = '';
        let hasMore = true;

        while (hasMore) {
            const membersResponse = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000${after ? `&after=${after}` : ''}`, {
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!membersResponse.ok) {
                console.log('Failed to fetch more members, using what we have');
                break;
            }

            const members = await membersResponse.json();
            allMembers = allMembers.concat(members);
            
            if (members.length < 1000) {
                hasMore = false;
            } else {
                after = members[members.length - 1].user.id;
            }
        }

        // Get channels
        const channelsResponse = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const channels = channelsResponse.ok ? await channelsResponse.json() : [];

        // Calculate statistics
        const memberCount = allMembers.length;
        const botCount = allMembers.filter(member => member.user.bot).length;
        const humanCount = memberCount - botCount;
        
        console.log(`📊 Statistics calculation: ${memberCount} total members, ${humanCount} humans, ${botCount} bots`);

        // Get roles
        const rolesResponse = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/roles`, {
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const roles = rolesResponse.ok ? await rolesResponse.json() : [];

        // Get emojis
        const emojisResponse = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/emojis`, {
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const emojis = emojisResponse.ok ? await emojisResponse.json() : [];

        // Calculate member activity (last 7 days)
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        const recentJoins = allMembers.filter(member => {
            const joinDate = new Date(member.joined_at);
            return joinDate >= sevenDaysAgo;
        }).length;

        // Generate realistic mock data based on actual server data
        const stats = {
            serverInfo: {
                name: guild.name,
                id: guild.id,
                memberCount: memberCount,
                humanCount: humanCount,
                botCount: botCount,
                channelCount: channels.length,
                roleCount: roles.length,
                emojiCount: emojis.length,
                created: guild.created_at,
                owner: guild.owner_id,
                region: guild.region,
                boostLevel: guild.premium_tier || 0,
                boostCount: guild.premium_subscription_count || 0
            },
            memberActivity: {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                joins: generateRealisticActivity(recentJoins),
                leaves: generateRealisticActivity(Math.floor(recentJoins * 0.3))
            },
            topUsers: {
                messages: generateTopUsers(allMembers.slice(0, 50), 'messages'),
                voice: generateTopUsers(allMembers.slice(0, 50), 'voice'),
                reactions: generateTopUsers(allMembers.slice(0, 50), 'reactions')
            },
            channelActivity: {
                labels: channels.slice(0, 5).map(channel => `#${channel.name}`),
                data: generateChannelActivity(channels.slice(0, 5))
            },
            serverGrowth: {
                currentMembers: memberCount,
                growthRate: calculateGrowthRate(memberCount, recentJoins),
                peakActivity: getPeakActivity()
            },
            serverHealth: {
                activity: calculateActivityLevel(memberCount, recentJoins),
                engagement: calculateEngagement(memberCount, channels.length),
                response: 95 // Bot response time
            }
        };

        console.log(`📊 Server statistics generated for ${guild.name}: ${memberCount} members, ${channels.length} channels`);
        console.log(`📊 Final stats structure:`, {
            serverInfo: stats.serverInfo,
            memberActivity: stats.memberActivity,
            topUsers: stats.topUsers,
            channelActivity: stats.channelActivity,
            serverGrowth: stats.serverGrowth,
            serverHealth: stats.serverHealth
        });
        res.json(stats);

    } catch (error) {
        console.error('Error fetching server statistics:', error);
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: `Failed to fetch server statistics: ${error.message}` });
    }
});

// Helper functions for generating realistic data
function generateRealisticActivity(baseCount) {
    const days = 7;
    const activity = [];
    for (let i = 0; i < days; i++) {
        const variation = Math.random() * 0.4 + 0.8; // 80-120% variation
        activity.push(Math.floor((baseCount / days) * variation));
    }
    return activity;
}

function generateTopUsers(members, type) {
    return members.slice(0, 10).map((member, index) => {
        const baseValue = type === 'messages' ? 1000 : type === 'voice' ? 40 : 500;
        const value = Math.floor(baseValue * (1 - index * 0.1) * (Math.random() * 0.5 + 0.75));
        
        return {
            name: member.user.username,
            avatar: member.user.avatar ? 
                `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png?size=64` : 
                `https://cdn.discordapp.com/embed/avatars/${member.user.discriminator % 5}.png`,
            rank: index + 1,
            ...(type === 'messages' ? { messages: value } : 
                type === 'voice' ? { time: `${Math.floor(value / 24)}h ${value % 24}m` } : 
                { reactions: value })
        };
    });
}

function generateChannelActivity(channels) {
    return channels.map(() => Math.floor(Math.random() * 500) + 50);
}

function calculateGrowthRate(memberCount, recentJoins) {
    const weeklyGrowth = (recentJoins / memberCount) * 100;
    return Math.round(weeklyGrowth * 10) / 10;
}

function getPeakActivity() {
    const times = ['Monday 7PM', 'Tuesday 8PM', 'Wednesday 6PM', 'Thursday 9PM', 'Friday 8PM', 'Saturday 7PM', 'Sunday 6PM'];
    return times[Math.floor(Math.random() * times.length)];
}

function calculateActivityLevel(memberCount, recentJoins) {
    const activityRatio = recentJoins / memberCount;
    return Math.min(100, Math.max(20, Math.floor(activityRatio * 1000)));
}

function calculateEngagement(memberCount, channelCount) {
    const engagementRatio = channelCount / (memberCount / 100);
    return Math.min(100, Math.max(30, Math.floor(engagementRatio * 10)));
}

// Message Commands API Endpoints

// Store for message commands (in production, use a database)
const messageCommands = new Map();

// Cooldown tracking for commands
const commandCooldowns = new Map();

// Store account tokens for authentication
const accountTokens = new Map();

// User statistics tracking
const userStats = new Map(); // userId -> { messages: 0, reactions: 0, lastSeen: Date }
const messageStats = new Map(); // messageId -> { authorId, timestamp, reactions: [] }

// Track user message statistics
function trackUserMessage(message) {
    const userId = message.author.id;
    const guildId = message.guild?.id;
    
    if (!guildId) return;
    
    const key = `${guildId}_${userId}`;
    const stats = userStats.get(key) || { messages: 0, reactions: 0, lastSeen: new Date() };
    
    stats.messages++;
    stats.lastSeen = new Date();
    
    userStats.set(key, stats);
    
    // Track message for reaction counting
    messageStats.set(message.id, {
        authorId: userId,
        timestamp: new Date(),
        reactions: []
    });
}

// Track user reaction statistics
function trackUserReaction(reaction, user, action) {
    const userId = user.id;
    const guildId = reaction.message.guild?.id;
    
    if (!guildId) return;
    
    const key = `${guildId}_${userId}`;
    const stats = userStats.get(key) || { messages: 0, reactions: 0, lastSeen: new Date() };
    
    if (action === 'add') {
        stats.reactions++;
        console.log(`📈 Reaction added: ${user.tag} now has ${stats.reactions} reactions in guild ${guildId}`);
    } else if (action === 'remove') {
        stats.reactions = Math.max(0, stats.reactions - 1);
        console.log(`📉 Reaction removed: ${user.tag} now has ${stats.reactions} reactions in guild ${guildId}`);
    }
    
    stats.lastSeen = new Date();
    userStats.set(key, stats);
}

// Handle message commands
async function handleMessageCommand(message, command) {
    try {
        // Check cooldown
        const cooldownKey = `${command.guildId}_${message.author.id}_${command.trigger}`;
        const lastUsed = commandCooldowns.get(cooldownKey);
        const now = Date.now();
        
        if (lastUsed && (now - lastUsed) < (command.cooldown * 1000)) {
            const remainingTime = Math.ceil((command.cooldown * 1000 - (now - lastUsed)) / 1000);
            await message.reply(`⏰ Command is on cooldown. Try again in ${remainingTime} seconds.`);
            return;
        }
        
        // Update cooldown
        commandCooldowns.set(cooldownKey, now);
        
        // Handle different command types
        if (command.type === 'active') {
            await handleActiveCommand(message);
        } else if (command.type === 'custom') {
            await message.reply(command.response);
        } else if (command.type === 'stats') {
            await handleStatsCommand(message);
        } else if (command.type === 'beauty') {
            await handleBeautyCommand(message);
        } else if (command.type === 'matching') {
            await handleMatchingCommand(message);
        }
        
        console.log(`🎯 Command executed: ${command.trigger} by ${message.author.tag} in ${message.guild.name}`);
    } catch (error) {
        console.error('Error handling message command:', error);
        await message.reply('❌ An error occurred while executing the command.');
    }
}

// Handle the 'active' command - show voice channel activity
async function handleActiveCommand(message) {
    try {
        const guild = message.guild;
        const voiceChannels = guild.channels.cache.filter(channel => 
            channel.type === 2 && channel.members.size > 0 // Voice channels with members
        );
        
        if (voiceChannels.size === 0) {
            await message.reply('No one is currently in any voice channels.');
            return;
        }
        
        // Generate visual image with Canvas
        const { createCanvas, loadImage } = require('@napi-rs/canvas');
        
        // Calculate canvas dimensions
        const maxMembersPerRow = 1; // Vertical layout
        const avatarSize = 50; // Smaller avatars
        const padding = 20;
        const channelHeight = 80; // Base height per channel
        const headerHeight = 80;
        const statsHeight = 60;
        
        let totalMembers = 0;
        voiceChannels.forEach(channel => {
            totalMembers += channel.members.size;
        });
        
        const channelsCount = voiceChannels.size;
        const canvasWidth = 600; // Fixed width for vertical layout
        
        // Calculate dynamic height based on member count
        let dynamicHeight = headerHeight + statsHeight + (padding * 2);
        voiceChannels.forEach(channel => {
            dynamicHeight += 60 + (channel.members.size * 60); // 60px per member + channel header
        });
        
        const canvasHeight = Math.max(400, dynamicHeight);
        
        const canvas = createCanvas(canvasWidth, canvasHeight);
        const ctx = canvas.getContext('2d');
        
        // Background gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
        gradient.addColorStop(0, '#2c2f33');
        gradient.addColorStop(1, '#23272a');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        
        // Header
        ctx.fillStyle = '#7289da';
        ctx.fillRect(0, 0, canvasWidth, headerHeight);
        
        // Header text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Voice Activity Report', canvasWidth / 2, 35);
        
        // Draw music note icon
        drawMusicNote(ctx, canvasWidth / 2 - 80, 25, 20, '#ffffff');
        
        ctx.font = '16px Arial, sans-serif';
        ctx.fillText(guild.name, canvasWidth / 2, 60);
        
        let currentY = headerHeight + padding;
        
        // Draw each voice channel
        for (const [index, channel] of voiceChannels.entries()) {
            const members = Array.from(channel.members.values());
            
            // Channel header
            ctx.fillStyle = '#36393f';
            ctx.fillRect(padding, currentY, canvasWidth - (padding * 2), 30);
            
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 18px Arial, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`${channel.name} (${members.length} members)`, padding + 30, currentY + 20);
            
            // Draw music note icon
            drawMusicNote(ctx, padding + 5, currentY + 5, 15, '#ffffff');
            
            currentY += 40;
            
            // Draw member avatars vertically
            const startX = padding + 20;
            const avatarSpacing = 60; // Space between avatars vertically
            
            for (let i = 0; i < members.length; i++) {
                const member = members[i];
                
                const x = startX;
                const y = currentY + (i * avatarSpacing);
                
                try {
                    // Download and draw avatar
                    const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 64 });
                    const avatar = await loadImage(avatarUrl);
                    
                    // Status circle background
                    const status = member.presence?.status || 'offline';
                    const statusColor = {
                        'online': '#43b581',
                        'idle': '#faa61a',
                        'dnd': '#f04747',
                        'offline': '#747f8d'
                    }[status] || '#747f8d';
                    
                    // Draw avatar circle
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(x + avatarSize/2, y + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
                    ctx.clip();
                    ctx.drawImage(avatar, x, y, avatarSize, avatarSize);
                    ctx.restore();
                    
                    // Status indicator
                    ctx.fillStyle = statusColor;
                    ctx.beginPath();
                    ctx.arc(x + avatarSize - 10, y + avatarSize - 10, 8, 0, Math.PI * 2);
                    ctx.fill();
                    
                    // Voice status indicators
                    if (member.voice?.mute) {
                        ctx.fillStyle = '#f04747';
                        ctx.fillText('M', x + 5, y + 15);
                    }
                    if (member.voice?.deaf) {
                        ctx.fillStyle = '#f04747';
                        ctx.fillText('D', x + avatarSize - 20, y + 15);
                    }
                    
                    // Username beside avatar
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 14px Arial, sans-serif';
                    ctx.textAlign = 'left';
                    const username = member.displayName.length > 20 ? 
                        member.displayName.substring(0, 20) + '...' : member.displayName;
                    ctx.fillText(username, x + avatarSize + 10, y + avatarSize/2 + 5);
                    
                } catch (error) {
                    console.error(`Error loading avatar for ${member.displayName}:`, error);
                    // Draw placeholder if avatar fails
                    ctx.fillStyle = '#7289da';
                    ctx.beginPath();
                    ctx.arc(x + avatarSize/2, y + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
                    ctx.fill();
                    
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 20px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", Arial, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('?', x + avatarSize/2, y + avatarSize/2 + 7);
                }
            }
            
            currentY += (members.length * avatarSpacing) + 20;
        }
        
        // Server statistics
        const onlineMembers = guild.members.cache.filter(member => 
            member.presence?.status === 'online' && !member.user.bot
        ).size;
        
        ctx.fillStyle = '#36393f';
        ctx.fillRect(padding, currentY, canvasWidth - (padding * 2), statsHeight);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px Arial';
        ctx.textAlign = 'left';
        ctx.font = '14px Arial, sans-serif';
        ctx.fillText(`Members: ${guild.memberCount}`, padding + 10, currentY + 20);
        ctx.fillText(`Online: ${onlineMembers}`, padding + 10, currentY + 40);
        ctx.fillText(`Voice Channels: ${voiceChannels.size}`, padding + 300, currentY + 20);
        ctx.fillText(`${new Date().toLocaleString()}`, padding + 300, currentY + 40);
        
        // Convert canvas to buffer
        const buffer = canvas.toBuffer('image/png');
        
        // Send as attachment
        const attachment = new AttachmentBuilder(buffer, { name: 'voice-activity.png' });
        await message.reply({ 
            content: `🎤 **Voice Activity Report for ${guild.name}**`,
            files: [attachment]
        });
        
    } catch (error) {
        console.error('Error in handleActiveCommand:', error);
        await message.reply('❌ Failed to get voice channel activity.');
    }
}

// Handle the 'stats' command - show user statistics
async function handleStatsCommand(message) {
    try {
        const guild = message.guild;
        const guildId = guild.id;
        
        // Check if there's a mention in the message
        const mentions = message.mentions.users;
        let targetUser = null;
        
        if (mentions.size > 0) {
            // Get stats for mentioned user
            targetUser = mentions.first();
        } else {
            // Get stats for command author
            targetUser = message.author;
        }
        
        const userId = targetUser.id;
        const key = `${guildId}_${userId}`;
        const stats = userStats.get(key) || { messages: 0, reactions: 0, lastSeen: new Date() };
        
        // Get user's Discord info
        const member = guild.members.cache.get(userId);
        const joinDate = member?.joinedAt;
        const accountCreated = targetUser.createdAt;
        
        // Calculate activity level
        const daysSinceJoin = joinDate ? Math.floor((Date.now() - joinDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        const messagesPerDay = daysSinceJoin > 0 ? (stats.messages / daysSinceJoin).toFixed(2) : 0;
        
        // Get user's roles
        const roles = member?.roles.cache
            .filter(role => role.id !== guild.id) // Exclude @everyone
            .map(role => role.name)
            .slice(0, 5) || []; // Limit to 5 roles
        
        // Create stats embed
        const { EmbedBuilder } = require('discord.js');
        
        const embed = new EmbedBuilder()
            .setTitle(`📊 User Statistics - ${targetUser.displayName}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setColor(0x7289da)
            .setTimestamp()
            .addFields(
                {
                    name: '📈 Activity Stats',
                    value: `💬 **Messages:** ${stats.messages}\n❤️ **Reactions:** ${stats.reactions}\n📅 **Messages/Day:** ${messagesPerDay}`,
                    inline: true
                },
                {
                    name: '👤 User Info',
                    value: `🆔 **ID:** ${userId}\n📅 **Account Created:** ${accountCreated.toLocaleDateString()}\n${joinDate ? `📅 **Joined Server:** ${joinDate.toLocaleDateString()}` : '❌ **Not in server**'}`,
                    inline: true
                },
                {
                    name: '🕒 Last Activity',
                    value: `⏰ **Last Seen:** ${stats.lastSeen.toLocaleString()}\n📊 **Activity Level:** ${getActivityLevel(stats.messages)}`,
                    inline: true
                }
            );
        
        if (roles.length > 0) {
            embed.addFields({
                name: '🎭 Roles',
                value: roles.join(', '),
                inline: false
            });
        }
        
        // Add server comparison
        const allStats = Array.from(userStats.entries())
            .filter(([key]) => key.startsWith(`${guildId}_`))
            .map(([, stats]) => stats);
        
        if (allStats.length > 0) {
            const totalMessages = allStats.reduce((sum, stats) => sum + stats.messages, 0);
            const totalReactions = allStats.reduce((sum, stats) => sum + stats.reactions, 0);
            
            const messageRank = allStats
                .sort((a, b) => b.messages - a.messages)
                .findIndex(stats => stats.messages === userStats.get(key)?.messages) + 1;
            
            embed.addFields({
                name: '🏆 Server Ranking',
                value: `📊 **Message Rank:** #${messageRank} of ${allStats.length}\n💬 **Server Total Messages:** ${totalMessages}\n❤️ **Server Total Reactions:** ${totalReactions}`,
                inline: false
            });
        }
        
        // Send initial response
        const initialResponse = await message.reply(`📊 Generating user statistics for ${targetUser.displayName}...`);
        
        try {
            // Generate the stats image
            const imageBuffer = await generateUserStatsImage(targetUser, stats, {
                joinDate,
                accountCreated,
                messagesPerDay,
                roles,
                messageRank: allStats.length > 0 ? allStats
                    .sort((a, b) => b.messages - a.messages)
                    .findIndex(stats => stats.messages === userStats.get(key)?.messages) + 1 : 1,
                totalUsers: allStats.length,
                guildName: guild.name
            });
            
            // Send the image
            await message.channel.send({
                content: `📊 **User Statistics for ${targetUser.displayName}**`,
                files: [{
                    attachment: imageBuffer,
                    name: `user_stats_${userId}.png`
                }]
            });
            
            // Delete the initial response
            await initialResponse.delete();
            
        } catch (imageError) {
            console.error('Error generating stats image:', imageError);
            await initialResponse.edit(`❌ Failed to generate statistics image. Here's a basic summary:\n\n**Messages:** ${stats.messages}\n**Reactions:** ${stats.reactions}\n**Messages/Day:** ${messagesPerDay}`);
        }
        
    } catch (error) {
        console.error('Error in handleStatsCommand:', error);
        await message.reply('❌ Failed to get user statistics.');
    }
}

// Handle the 'beauty' command - generate beauty rating GIF
async function handleBeautyCommand(message) {
    try {
        const user = message.author;
        const userId = user.id;
        
        // Generate a random beauty percentage (for fun)
        // Special cases: always give 100% to specific user IDs
        const specialUsers = ['482427857168236544', '874460708207726592'];
        const beautyPercentage = specialUsers.includes(userId) ? 100 : Math.floor(Math.random() * 100) + 1;
        
        console.log(`🎨 Generating beauty rating for ${user.tag}: ${beautyPercentage}%`);
        
        // Send initial response
        const initialResponse = await message.reply(`🎨 Generating your beauty rating... Please wait!`);
        
        try {
            // Generate the beauty GIF
            const gifBuffer = await generateBeautyGIF(user, beautyPercentage);
            
            // Send the GIF
            await message.channel.send({
                content: `✨ **${user.username}'s Beauty Rating: ${beautyPercentage}%** ✨`,
                files: [{
                    attachment: gifBuffer,
                    name: `beauty_rating_${userId}.gif`
                }]
            });
            
            // Delete the initial response
            await initialResponse.delete();
            
        } catch (gifError) {
            console.error('Error generating beauty GIF:', gifError);
            await initialResponse.edit(`❌ Failed to generate beauty rating GIF. Here's your rating: **${beautyPercentage}%** 🎨`);
        }
        
    } catch (error) {
        console.error('Error handling beauty command:', error);
        await message.reply('❌ An error occurred while generating your beauty rating.');
    }
}

// Handle the 'matching' command - generate compatibility rating GIF
async function handleMatchingCommand(message) {
    try {
        const user1 = message.author;
        const mentionedUser = message.mentions.users.first();
        
        if (!mentionedUser) {
            await message.reply('❌ Please mention a user to check compatibility with! Example: `match @username`');
            return;
        }
        
        if (mentionedUser.id === user1.id) {
            await message.reply('❌ You cannot match with yourself! Please mention a different user.');
            return;
        }
        
        // Generate a random compatibility percentage (for fun)
        const compatibilityPercentage = Math.floor(Math.random() * 100) + 1;
        
        console.log(`💕 Generating compatibility rating for ${user1.tag} and ${mentionedUser.tag}: ${compatibilityPercentage}%`);
        
        // Send initial response
        const initialResponse = await message.reply(`💕 Calculating compatibility between ${user1.username} and ${mentionedUser.username}... Please wait!`);
        
        try {
            // Generate the matching GIF
            const gifBuffer = await generateMatchingGIF(user1, mentionedUser, compatibilityPercentage);
            
            // Create attachment and send
            const attachment = new AttachmentBuilder(gifBuffer, { name: 'matching.gif' });
            
            // Edit the initial response with the GIF
            await initialResponse.edit({
                content: `💕 **Compatibility Result:**\n${user1.username} ❤️ ${mentionedUser.username}\n**Match: ${compatibilityPercentage}%**`,
                files: [attachment]
            });
            
        } catch (gifError) {
            console.error('Error generating matching GIF:', gifError);
            await initialResponse.edit('❌ Failed to generate compatibility GIF. Here\'s your result anyway:\n' +
                `💕 **Compatibility:** ${user1.username} ❤️ ${mentionedUser.username}\n**Match: ${compatibilityPercentage}%**`);
        }
        
    } catch (error) {
        console.error('Error handling matching command:', error);
        await message.reply('❌ An error occurred while calculating compatibility.');
    }
}

// Generate beauty rating GIF
async function generateBeautyGIF(user, beautyPercentage) {
    try {
        const canvas = createCanvas(400, 400);
        const ctx = canvas.getContext('2d');
        
        // Set background
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, 400, 400);
        
        // Load user avatar
        let avatarImage;
        try {
            const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });
            avatarImage = await loadImage(avatarUrl);
        } catch (error) {
            // Fallback to default avatar
            avatarImage = await loadImage('https://cdn.discordapp.com/embed/avatars/0.png');
        }
        
        // Create GIF encoder
        const encoder = new GIFEncoder(400, 400);
        encoder.setRepeat(0); // Repeat forever
        encoder.setDelay(150); // 150ms delay between frames (increased from 100ms)
        encoder.setQuality(10); // Quality 1-20, lower is better quality
        encoder.start();
        
        // Generate frames for the GIF
        const totalFrames = 30; // Increased from 20 to 30
        for (let frame = 0; frame < totalFrames; frame++) {
            // Clear canvas
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, 400, 400);
            
            // Calculate animation progress
            let animatedPercentage;
            if (frame < 20) {
                // First 20 frames: animate the progress bar
                const progress = frame / 20;
                animatedPercentage = Math.min(beautyPercentage * progress, beautyPercentage);
            } else {
                // Last 10 frames: show final result
                animatedPercentage = beautyPercentage;
            }
            
            // Draw circular background
            ctx.fillStyle = '#2d2d44';
            ctx.beginPath();
            ctx.arc(200, 200, 180, 0, 2 * Math.PI);
            ctx.fill();
            
            // Draw circular progress bar background
            ctx.strokeStyle = '#4a4a6a';
            ctx.lineWidth = 20;
            ctx.beginPath();
            ctx.arc(200, 200, 160, 0, 2 * Math.PI);
            ctx.stroke();
            
            // Draw circular progress bar
            const progressAngle = (animatedPercentage / 100) * 2 * Math.PI;
            ctx.strokeStyle = getProgressColor(animatedPercentage);
            ctx.lineWidth = 20;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(200, 200, 160, -Math.PI / 2, -Math.PI / 2 + progressAngle);
            ctx.stroke();
            
            // Draw user avatar (circular)
            ctx.save();
            ctx.beginPath();
            ctx.arc(200, 200, 120, 0, 2 * Math.PI);
            ctx.clip();
            ctx.drawImage(avatarImage, 80, 80, 240, 240);
            ctx.restore();
            
            // Draw percentage text
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 32px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.round(animatedPercentage)}%`, 200, 320);
            
            // Draw rating text based on percentage
            const ratingText = getRatingText(animatedPercentage);
            ctx.fillStyle = getRatingColor(animatedPercentage);
            ctx.font = 'bold 24px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", Arial, sans-serif';
            ctx.fillText(ratingText, 200, 350);
            
            // Add frame to GIF
            encoder.addFrame(ctx);
        }
        
        encoder.finish();
        return encoder.out.getData();
        
    } catch (error) {
        console.error('Error generating beauty GIF:', error);
        throw error;
    }
}

// Generate matching compatibility GIF
async function generateMatchingGIF(user1, user2, compatibilityPercentage) {
    try {
        const canvas = createCanvas(400, 400);
        const ctx = canvas.getContext('2d');
        
        // Set pink background
        ctx.fillStyle = '#ff69b4';
        ctx.fillRect(0, 0, 400, 400);
        
        // Load user avatars
        let avatar1Image, avatar2Image;
        try {
            const avatar1Url = user1.displayAvatarURL({ extension: 'png', size: 128 });
            const avatar2Url = user2.displayAvatarURL({ extension: 'png', size: 128 });
            avatar1Image = await loadImage(avatar1Url);
            avatar2Image = await loadImage(avatar2Url);
        } catch (error) {
            console.error('Error loading avatars:', error);
            // Create default avatars if loading fails
            avatar1Image = null;
            avatar2Image = null;
        }
        
        // Create GIF encoder
        const encoder = new GIFEncoder(400, 400);
        const stream = encoder.createReadStream();
        const chunks = [];
        
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {});
        
        encoder.setRepeat(0); // Repeat forever
        encoder.setDelay(150); // 150ms delay between frames
        encoder.setQuality(10); // Quality 1-20, lower is better quality
        encoder.start();
        
        // Generate frames for the GIF
        const totalFrames = 30;
        for (let frame = 0; frame < totalFrames; frame++) {
            // Clear canvas with pink background
            ctx.fillStyle = '#ff69b4';
            ctx.fillRect(0, 0, 400, 400);
            
            // Draw raining hearts and fire emojis
            drawRainingEmojis(ctx, frame);
            
            // Calculate animation progress
            let animatedPercentage;
            if (frame < 20) {
                // First 20 frames: animate the progress bar
                const progress = frame / 20;
                animatedPercentage = Math.min(compatibilityPercentage * progress, compatibilityPercentage);
            } else {
                // Last 10 frames: show final result
                animatedPercentage = compatibilityPercentage;
            }
            
            // Calculate shake intensity based on percentage
            const shakeIntensity = Math.min(animatedPercentage / 20, 3); // Max 3px shake
            const shakeX1 = Math.sin(frame * 0.5) * shakeIntensity;
            const shakeY1 = Math.cos(frame * 0.3) * shakeIntensity;
            const shakeX2 = Math.sin(frame * 0.4) * shakeIntensity;
            const shakeY2 = Math.cos(frame * 0.6) * shakeIntensity;
            
            // Draw user 1 avatar (left side) with shake
            if (avatar1Image) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(100 + shakeX1, 150 + shakeY1, 50, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(avatar1Image, 50 + shakeX1, 100 + shakeY1, 100, 100);
                ctx.restore();
            } else {
                // Draw default avatar circle
                ctx.fillStyle = '#4a5568';
                ctx.beginPath();
                ctx.arc(100 + shakeX1, 150 + shakeY1, 50, 0, Math.PI * 2);
                ctx.fill();
            }
            
            // Draw user 2 avatar (right side) with shake
            if (avatar2Image) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(300 + shakeX2, 150 + shakeY2, 50, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(avatar2Image, 250 + shakeX2, 100 + shakeY2, 100, 100);
                ctx.restore();
            } else {
                // Draw default avatar circle
                ctx.fillStyle = '#4a5568';
                ctx.beginPath();
                ctx.arc(300 + shakeX2, 150 + shakeY2, 50, 0, Math.PI * 2);
                ctx.fill();
            }
            
            // Draw heart between users
            drawHeart(ctx, 200, 160, 40, '#ff6b6b');
            
            // Draw compatibility progress bar (horizontal)
            const barWidth = 300;
            const barHeight = 20;
            const barX = 50;
            const barY = 250;
            
            // Background bar
            ctx.fillStyle = '#2d3748';
            ctx.fillRect(barX, barY, barWidth, barHeight);
            
            // Progress bar
            const progressWidth = (barWidth * animatedPercentage) / 100;
            ctx.fillStyle = getCompatibilityColor(animatedPercentage);
            ctx.fillRect(barX, barY, progressWidth, barHeight);
            
            // Draw percentage text
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 32px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.round(animatedPercentage)}%`, 200, 320);
            
            // Draw compatibility text based on percentage
            const compatibilityText = getCompatibilityText(animatedPercentage);
            ctx.fillStyle = getCompatibilityTextColor(animatedPercentage);
            ctx.font = 'bold 24px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", Arial, sans-serif';
            ctx.fillText(compatibilityText, 200, 350);
            
            // Add frame to GIF
            encoder.addFrame(ctx.getImageData(0, 0, 400, 400).data);
        }
        
        encoder.finish();
        
        // Wait for stream to finish
        await new Promise((resolve) => {
            stream.on('end', resolve);
        });
        
        return Buffer.concat(chunks);
        
    } catch (error) {
        console.error('Error generating matching GIF:', error);
        throw error;
    }
}

// Helper function to get progress bar color based on percentage
function getProgressColor(percentage) {
    if (percentage >= 80) return '#4ade80'; // Green
    if (percentage >= 60) return '#a3e635'; // Light green
    if (percentage >= 40) return '#fbbf24'; // Yellow
    if (percentage >= 20) return '#f97316'; // Orange
    return '#ef4444'; // Red
}

// Helper function to get rating text based on percentage
function getRatingText(percentage) {
    if (percentage === 100) return '🔥 Hot ASF 🔥';
    if (percentage >= 81) return 'Stunning';
    if (percentage >= 61) return 'Beautiful';
    if (percentage >= 41) return 'Pretty';
    return 'Cute';
}

// Helper function to get rating text color based on percentage
function getRatingColor(percentage) {
    if (percentage === 100) return '#ff6b6b'; // Red for Hot ASF
    if (percentage >= 81) return '#4ade80'; // Green for Stunning
    if (percentage >= 61) return '#60a5fa'; // Blue for Beautiful
    if (percentage >= 41) return '#fbbf24'; // Yellow for Pretty
    return '#f97316'; // Orange for Cute
}

// Helper function to get compatibility progress bar color based on percentage
function getCompatibilityColor(percentage) {
    if (percentage >= 80) return '#4ade80'; // Green
    if (percentage >= 60) return '#a3e635'; // Light green
    if (percentage >= 40) return '#fbbf24'; // Yellow
    if (percentage >= 20) return '#f97316'; // Orange
    return '#ef4444'; // Red
}

// Helper function to get compatibility text based on percentage
function getCompatibilityText(percentage) {
    if (percentage === 100) return '🔥 Perfect Match 🔥';
    if (percentage >= 81) return 'Soulmates';
    if (percentage >= 61) return 'Great Match';
    if (percentage >= 41) return 'Good Match';
    if (percentage >= 21) return 'Decent Match';
    return 'Not Compatible';
}

// Helper function to get compatibility text color based on percentage
function getCompatibilityTextColor(percentage) {
    if (percentage === 100) return '#ef4444'; // Red for "Perfect Match"
    if (percentage >= 81) return '#4ade80'; // Green for "Soulmates"
    if (percentage >= 61) return '#3b82f6'; // Blue for "Great Match"
    if (percentage >= 41) return '#fbbf24'; // Yellow for "Good Match"
    if (percentage >= 21) return '#f97316'; // Orange for "Decent Match"
    return '#ef4444'; // Red for "Not Compatible"
}

// Helper function to draw a heart shape
function drawHeart(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 20, size / 20);
    
    ctx.fillStyle = color;
    ctx.beginPath();
    
    // Draw heart shape using bezier curves
    ctx.moveTo(10, 15);
    ctx.bezierCurveTo(10, 5, 0, 5, 0, 15);
    ctx.bezierCurveTo(0, 25, 10, 35, 10, 35);
    ctx.bezierCurveTo(10, 35, 20, 25, 20, 15);
    ctx.bezierCurveTo(20, 5, 10, 5, 10, 15);
    
    ctx.fill();
    ctx.restore();
}

// Helper function to draw a star shape
function drawStar(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 20, size / 20);
    
    ctx.fillStyle = color;
    ctx.beginPath();
    
    // Draw 5-pointed star
    for (let i = 0; i < 5; i++) {
        const angle = (i * 4 * Math.PI) / 5;
        const radius = i % 2 === 0 ? 10 : 4;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        
        if (i === 0) {
            ctx.moveTo(px, py);
        } else {
            ctx.lineTo(px, py);
        }
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// Helper function to draw a music note
function drawMusicNote(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 20, size / 20);
    
    ctx.fillStyle = color;
    ctx.beginPath();
    
    // Draw note head (circle)
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw stem
    ctx.fillRect(2, -15, 1, 15);
    
    // Draw flag
    ctx.beginPath();
    ctx.moveTo(3, -15);
    ctx.quadraticCurveTo(8, -12, 3, -9);
    ctx.quadraticCurveTo(8, -6, 3, -3);
    ctx.fill();
    
    ctx.restore();
}

// Helper function to draw a diamond shape
function drawDiamond(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 20, size / 20);
    
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(10, 0);
    ctx.lineTo(0, 10);
    ctx.lineTo(-10, 0);
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
}

// Helper function to draw a circle with sparkle
function drawSparkle(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 20, size / 20);
    
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw sparkle lines
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(8, 0);
    ctx.moveTo(0, -8);
    ctx.lineTo(0, 8);
    ctx.moveTo(-6, -6);
    ctx.lineTo(6, 6);
    ctx.moveTo(-6, 6);
    ctx.lineTo(6, -6);
    ctx.stroke();
    
    ctx.restore();
}

// Helper function to draw raining hearts and other shapes
function drawRainingEmojis(ctx, frame) {
    const shapes = ['heart', 'star', 'music', 'diamond', 'sparkle'];
    const numShapes = 15;
    
    for (let i = 0; i < numShapes; i++) {
        const shapeType = shapes[i % shapes.length];
        const x = (i * 27 + frame * 2) % 400; // Horizontal movement
        const y = (i * 30 + frame * 3) % 400; // Vertical movement
        const size = 20 + (i % 3) * 5; // Varying sizes
        
        // Add some rotation for animation
        const rotation = (frame * 0.1 + i) % (Math.PI * 2);
        
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        
        switch (shapeType) {
            case 'heart':
                drawHeart(ctx, 0, 0, size, '#ff6b6b');
                break;
            case 'star':
                drawStar(ctx, 0, 0, size, '#ffd700');
                break;
            case 'music':
                drawMusicNote(ctx, 0, 0, size, '#ffffff');
                break;
            case 'diamond':
                drawDiamond(ctx, 0, 0, size, '#ff69b4');
                break;
            case 'sparkle':
                drawSparkle(ctx, 0, 0, size, '#ffa500');
                break;
        }
        
        ctx.restore();
    }
}

// Helper function to determine activity level
function getActivityLevel(messages) {
    if (messages >= 1000) return 'Very Active';
    if (messages >= 500) return 'Active';
    if (messages >= 100) return 'Moderately Active';
    if (messages >= 10) return 'Somewhat Active';
    return 'Inactive';
}

// Generate user statistics image
async function generateUserStatsImage(user, stats, additionalData) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    
    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 600);
    gradient.addColorStop(0, '#2c2f33');
    gradient.addColorStop(1, '#23272a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 600);
    
    // Header section
    ctx.fillStyle = '#7289da';
    ctx.fillRect(0, 0, 800, 100);
    
    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('User Statistics', 400, 40);
    
    ctx.font = 'bold 24px Arial, sans-serif';
    ctx.fillText(user.displayName, 400, 70);
    
    // User avatar
    try {
        // Try to load user avatar
        const avatarUrl = user.displayAvatarURL({ format: 'png', size: 128 });
        const avatar = await loadImage(avatarUrl);
        
        // Draw avatar in circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(100, 150, 60, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatar, 40, 90, 120, 120);
        ctx.restore();
        
        // Avatar border
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(100, 150, 60, 0, Math.PI * 2);
        ctx.stroke();
    } catch (error) {
        console.log('Could not load avatar, using placeholder');
        // Fallback: draw placeholder circle
        ctx.fillStyle = '#7289da';
        ctx.beginPath();
        ctx.arc(100, 150, 60, 0, Math.PI * 2);
        ctx.fill();
        
        // Avatar border
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.stroke();
        
        // Draw user initials
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial, sans-serif';
        ctx.textAlign = 'center';
        const initials = user.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        ctx.fillText(initials, 100, 160);
    }
    
    // User info section
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('User Information', 200, 130);
    
    ctx.font = '16px Arial, sans-serif';
    ctx.fillText(`ID: ${user.id}`, 200, 160);
    ctx.fillText(`Account Created: ${additionalData.accountCreated.toLocaleDateString()}`, 200, 185);
    if (additionalData.joinDate) {
        ctx.fillText(`Joined Server: ${additionalData.joinDate.toLocaleDateString()}`, 200, 210);
    }
    
    // Activity stats section
    ctx.fillStyle = '#36393f';
    ctx.fillRect(50, 250, 700, 120);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Activity Statistics', 400, 280);
    
    // Stats grid
    const statsData = [
        { label: 'Messages', value: stats.messages, color: '#ff6b6b' },
        { label: 'Reactions', value: stats.reactions, color: '#4ecdc4' },
        { label: 'Messages/Day', value: additionalData.messagesPerDay, color: '#45b7d1' },
        { label: 'Server Rank', value: `#${additionalData.messageRank}`, color: '#f9ca24' }
    ];
    
    statsData.forEach((stat, index) => {
        const x = 150 + (index * 150);
        const y = 320;
        
        // Stat circle
        ctx.fillStyle = stat.color;
        ctx.beginPath();
        ctx.arc(x, y, 30, 0, Math.PI * 2);
        ctx.fill();
        
        // Stat value
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(stat.value.toString(), x, y + 7);
        
        // Stat label
        ctx.font = '14px Arial, sans-serif';
        ctx.fillText(stat.label, x, y + 40);
    });
    
    // Activity level section
    ctx.fillStyle = '#36393f';
    ctx.fillRect(50, 390, 700, 80);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Activity Level', 70, 420);
    
    const activityLevel = getActivityLevel(stats.messages);
    const activityColor = stats.messages >= 1000 ? '#ff6b6b' : 
                         stats.messages >= 500 ? '#f9ca24' : 
                         stats.messages >= 100 ? '#4ecdc4' : '#95a5a6';
    
    // Draw activity level icon
    if (stats.messages >= 1000) {
        drawHeart(ctx, 50, 450, 20, '#ff6b6b');
    } else if (stats.messages >= 500) {
        drawStar(ctx, 50, 450, 20, '#f9ca24');
    } else if (stats.messages >= 100) {
        drawSparkle(ctx, 50, 450, 20, '#4ecdc4');
    } else {
        drawDiamond(ctx, 50, 450, 20, '#95a5a6');
    }
    
    ctx.fillStyle = activityColor;
    ctx.font = 'bold 24px Arial, sans-serif';
    ctx.fillText(activityLevel, 80, 450);
    
    // Progress bar for activity
    const progressWidth = 400;
    const progressHeight = 20;
    const progressX = 300;
    const progressY = 420;
    
    // Background
    ctx.fillStyle = '#2c2f33';
    ctx.fillRect(progressX, progressY, progressWidth, progressHeight);
    
    // Progress fill
    const progressPercent = Math.min(stats.messages / 1000, 1);
    ctx.fillStyle = activityColor;
    ctx.fillRect(progressX, progressY, progressWidth * progressPercent, progressHeight);
    
    // Progress text
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(progressPercent * 100)}%`, progressX + progressWidth/2, progressY + 15);
    
    // Server info section
    ctx.fillStyle = '#36393f';
    ctx.fillRect(50, 490, 700, 80);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Server: ${additionalData.guildName}`, 70, 520);
    ctx.fillText(`Rank: #${additionalData.messageRank} of ${additionalData.totalUsers} users`, 70, 545);
    
    // Last seen info
    ctx.font = '14px Arial, sans-serif';
    ctx.fillText(`Last Active: ${stats.lastSeen.toLocaleString()}`, 70, 565);
    
    // Roles section (if any)
    if (additionalData.roles.length > 0) {
        ctx.fillStyle = '#36393f';
        ctx.fillRect(50, 580, 700, 20);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Roles: ${additionalData.roles.join(', ')}`, 70, 595);
    }
    
    // Add some decorative elements
    drawHeart(ctx, 750, 200, 20, '#ff6b6b');
    drawStar(ctx, 750, 250, 20, '#ffd700');
    drawMusicNote(ctx, 750, 300, 20, '#ffffff');
    
    return canvas.toBuffer('image/png');
}

// Get commands for a server
app.post('/api/get-commands', async (req, res) => {
    try {
        const { guildId } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!guildId) {
            return res.status(400).json({ error: 'Guild ID required' });
        }

        // Get commands for this guild
        const commands = Array.from(messageCommands.values())
            .filter(cmd => cmd.guildId === guildId)
            .map(cmd => ({
                id: cmd.id,
                trigger: cmd.trigger,
                type: cmd.type,
                response: cmd.response,
                cooldown: cmd.cooldown,
                createdAt: cmd.createdAt
            }));

        res.json({ success: true, commands });
    } catch (error) {
        console.error('Get commands error:', error);
        res.status(500).json({ error: 'Failed to get commands' });
    }
});

// Create a new command
app.post('/api/create-command', async (req, res) => {
    try {
        const { trigger, type, response, cooldown, guildId } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!trigger || !type || !guildId) {
            return res.status(400).json({ error: 'Trigger, type, and guild ID are required' });
        }

        // Check if command already exists
        const existingCommand = Array.from(messageCommands.values())
            .find(cmd => cmd.guildId === guildId && cmd.trigger === trigger);

        if (existingCommand) {
            return res.status(400).json({ error: 'Command with this trigger already exists' });
        }

        // Create new command
        const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const command = {
            id: commandId,
            trigger,
            type,
            response: type === 'custom' ? response : null,
            cooldown: cooldown || 5,
            guildId,
            createdAt: new Date().toISOString()
        };

        messageCommands.set(commandId, command);

        res.json({ success: true, command });
    } catch (error) {
        console.error('Create command error:', error);
        res.status(500).json({ error: 'Failed to create command' });
    }
});

// Update a command
app.post('/api/update-command', async (req, res) => {
    try {
        const { commandId, trigger, type, response, cooldown } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!commandId) {
            return res.status(400).json({ error: 'Command ID required' });
        }

        const command = messageCommands.get(commandId);
        if (!command) {
            return res.status(404).json({ error: 'Command not found' });
        }

        // Update command
        command.trigger = trigger || command.trigger;
        command.type = type || command.type;
        command.response = type === 'custom' ? response : null;
        command.cooldown = cooldown || command.cooldown;
        command.updatedAt = new Date().toISOString();

        messageCommands.set(commandId, command);

        res.json({ success: true, command });
    } catch (error) {
        console.error('Update command error:', error);
        res.status(500).json({ error: 'Failed to update command' });
    }
});

// Delete a command
app.post('/api/delete-command', async (req, res) => {
    try {
        const { commandId } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!commandId) {
            return res.status(400).json({ error: 'Command ID required' });
        }

        const command = messageCommands.get(commandId);
        if (!command) {
            return res.status(404).json({ error: 'Command not found' });
        }

        messageCommands.delete(commandId);

        res.json({ success: true });
    } catch (error) {
        console.error('Delete command error:', error);
        res.status(500).json({ error: 'Failed to delete command' });
    }
});

// Account Authentication API endpoints
app.post('/api/auth/account', async (req, res) => {
    try {
        const { token } = req.body;
        const botToken = req.headers.authorization?.replace('Bearer ', '');

        if (!botToken) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!token) {
            return res.status(400).json({ error: 'Account token required' });
        }

        console.log('🔄 Account authentication request received');
        console.log('🔑 Account token:', token.substring(0, 10) + '...');
        
        // Send terminal log
        broadcastLog('🔄 Starting account authentication...', 'info');

        // Test the account token by making a request to Discord API
        const response = await fetch('https://discord.com/api/v10/users/@me', {
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log('❌ Account token validation failed:', response.status);
            let errorMessage = `❌ Account token validation failed: ${response.status}`;
            
            if (response.status === 401) {
                errorMessage += '\n💡 This looks like a bot token. You need a user account token instead.';
                errorMessage += '\n🔍 Get your account token from Discord web browser (F12 → Network tab)';
            } else if (response.status === 403) {
                errorMessage += '\n💡 Token may be invalid or expired.';
            }
            
            broadcastLog(errorMessage, 'error');
            return res.status(400).json({ 
                error: 'Invalid account token',
                details: `Discord API returned ${response.status}`,
                suggestion: response.status === 401 ? 'This appears to be a bot token. You need a user account token.' : 'Token may be invalid or expired.'
            });
        }

        const userData = await response.json();
        console.log('✅ Account token validated successfully');
        console.log('👤 User:', userData.username + '#' + userData.discriminator);
        
        // Send success logs
        broadcastLog('✅ Account token validated successfully!', 'success');
        broadcastLog(`👤 User: ${userData.username}#${userData.discriminator}`, 'success');
        broadcastLog(`🆔 ID: ${userData.id}`, 'success');

        // Store the account token for this session
        accountTokens.set(botToken, token);

        res.json({
            success: true,
            user: {
                id: userData.id,
                username: userData.username,
                discriminator: userData.discriminator,
                avatar: userData.avatar,
                email: userData.email,
                phone: userData.phone,
                verified: userData.verified,
                mfa_enabled: userData.mfa_enabled
            }
        });

    } catch (error) {
        console.error('Account authentication error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

app.post('/api/auth/test-connection', async (req, res) => {
    try {
        const { token } = req.body;
        const botToken = req.headers.authorization?.replace('Bearer ', '');

        if (!botToken) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!token) {
            return res.status(400).json({ error: 'Account token required' });
        }

        console.log('🔄 Testing account connection...');
        broadcastLog('🔄 Testing account connection...', 'info');

        // Test the connection
        const response = await fetch('https://discord.com/api/v10/users/@me', {
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log('❌ Connection test failed:', response.status);
            broadcastLog(`❌ Connection test failed: ${response.status}`, 'error');
            return res.status(400).json({ 
                error: 'Connection test failed',
                status: response.status
            });
        }

        const userData = await response.json();
        console.log('✅ Connection test successful');
        broadcastLog('✅ Connection test successful!', 'success');
        broadcastLog(`📊 Status: Connected`, 'success');

        res.json({
            success: true,
            status: 'Connected',
            user: {
                id: userData.id,
                username: userData.username,
                discriminator: userData.discriminator
            }
        });

    } catch (error) {
        console.error('Connection test error:', error);
        res.status(500).json({ error: 'Connection test failed' });
    }
});

app.get('/api/auth/user-info', async (req, res) => {
    try {
        const botToken = req.headers.authorization?.replace('Bearer ', '');
        const accountToken = req.headers['x-account-token'];

        if (!botToken) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!accountToken) {
            return res.status(400).json({ error: 'Account token required' });
        }

        console.log('🔄 Fetching account user info...');
        broadcastLog('🔄 Fetching account user info...', 'info');

        // Get user information from Discord API
        const response = await fetch('https://discord.com/api/v10/users/@me', {
            headers: {
                'Authorization': accountToken,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log('❌ Failed to get user info:', response.status);
            broadcastLog(`❌ Failed to get user info: ${response.status}`, 'error');
            return res.status(400).json({ 
                error: 'Failed to get user information',
                details: `Discord API returned ${response.status}`
            });
        }

        const userData = await response.json();
        console.log('✅ User info retrieved successfully');
        broadcastLog('✅ User info retrieved successfully!', 'success');
        broadcastLog(`👤 Username: ${userData.username}#${userData.discriminator}`, 'success');
        broadcastLog(`🆔 ID: ${userData.id}`, 'success');
        broadcastLog(`📧 Email: ${userData.email || 'Not available'}`, 'success');
        broadcastLog(`📱 Phone: ${userData.phone || 'Not available'}`, 'success');
        broadcastLog(`✅ Verified: ${userData.verified ? 'Yes' : 'No'}`, 'success');

        res.json({
            success: true,
            user: {
                id: userData.id,
                username: userData.username,
                discriminator: userData.discriminator,
                avatar: userData.avatar,
                email: userData.email,
                phone: userData.phone,
                verified: userData.verified,
                mfa_enabled: userData.mfa_enabled,
                premium_type: userData.premium_type,
                public_flags: userData.public_flags,
                flags: userData.flags,
                locale: userData.locale,
                nsfw_allowed: userData.nsfw_allowed
            }
        });

    } catch (error) {
        console.error('Get user info error:', error);
        res.status(500).json({ error: 'Failed to get user information' });
    }
});

// API endpoint to get user info by ID (for presence updates)
app.get('/api/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const botToken = req.headers.authorization?.replace('Bearer ', '');

        if (!botToken) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        console.log(`🔄 Fetching user info for ID: ${userId}`);

        // Get user information from Discord API using bot token
        const response = await fetch(`https://discord.com/api/v10/users/${userId}`, {
            headers: {
                'Authorization': `Bot ${botToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log(`❌ Failed to get user info for ${userId}:`, response.status);
            return res.status(400).json({ 
                error: 'Failed to get user information',
                details: `Discord API returned ${response.status}`
            });
        }

        const userData = await response.json();
        console.log(`✅ User info retrieved for ${userId}:`, userData.username);

        res.json({
            success: true,
            user: {
                id: userData.id,
                username: userData.username,
                discriminator: userData.discriminator,
                avatar: userData.avatar ? 
                    `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png?size=32` :
                    `https://cdn.discordapp.com/embed/avatars/${userData.discriminator % 5}.png`
            }
        });

    } catch (error) {
        console.error('Get user info error:', error);
        res.status(500).json({ error: 'Failed to get user information' });
    }
});

// Lookup user by username
app.post('/api/lookup-user', async (req, res) => {
    try {
        const { username } = req.body;
        const botToken = req.headers.authorization?.replace('Bearer ', '');

        if (!botToken) {
            return res.status(401).json({ error: 'Bot token required' });
        }

        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        console.log(`🔍 Looking up user by username: ${username}`);

        // Parse username format (username#discriminator or just username)
        let searchUsername, discriminator;
        if (username.includes('#')) {
            [searchUsername, discriminator] = username.split('#');
        } else {
            searchUsername = username;
            discriminator = null;
        }

        // Get bot client
        const client = botClients.get(botToken);
        if (!client) {
            return res.status(400).json({ error: 'Bot not found or not ready' });
        }

        // Search through all guilds for the user
        let foundUser = null;
        for (const [guildId, guild] of client.guilds.cache) {
            try {
                // Search guild members
                const members = await guild.members.fetch();
                for (const [memberId, member] of members) {
                    const user = member.user;
                    if (user.username.toLowerCase() === searchUsername.toLowerCase()) {
                        if (!discriminator || user.discriminator === discriminator) {
                            foundUser = user;
                            break;
                        }
                    }
                }
                if (foundUser) break;
            } catch (error) {
                console.log(`⚠️ Error searching guild ${guild.name}:`, error.message);
                continue;
            }
        }

        if (!foundUser) {
            console.log(`❌ User not found: ${username}`);
            return res.status(404).json({ 
                error: 'User not found',
                details: 'User not found in any accessible guilds'
            });
        }

        console.log(`✅ User found: ${foundUser.username}#${foundUser.discriminator}`);

        res.json({
            success: true,
            user: {
                id: foundUser.id,
                username: foundUser.username,
                discriminator: foundUser.discriminator,
                avatar: foundUser.avatar ? 
                    `https://cdn.discordapp.com/avatars/${foundUser.id}/${foundUser.avatar}.png?size=256` :
                    `https://cdn.discordapp.com/embed/avatars/${foundUser.discriminator % 5}.png`,
                created_at: foundUser.createdAt,
                verified: foundUser.verified,
                public_flags: foundUser.flags
            }
        });

    } catch (error) {
        console.error('Lookup user error:', error);
        res.status(500).json({ error: 'Failed to lookup user' });
    }
});

// User lookup by ID using account token
app.get('/api/user-account/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const accountToken = req.headers['x-account-token'];

        if (!accountToken) {
            return res.status(401).json({ error: 'Account token required' });
        }

        console.log(`🔍 Looking up user by ID with account token: ${userId}`);

        // Get user information from Discord API using account token
        const response = await fetch(`https://discord.com/api/v10/users/${userId}`, {
            headers: {
                'Authorization': accountToken,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log(`❌ Failed to get user info for ${userId}:`, response.status);
            if (response.status === 403) {
                return res.status(403).json({ 
                    error: 'Access denied',
                    details: 'You can only lookup users you have a relationship with (friends, shared servers)'
                });
            }
            return res.status(400).json({ 
                error: 'Failed to get user information',
                details: `Discord API returned ${response.status}`
            });
        }

        const userData = await response.json();
        console.log(`✅ User info retrieved for ${userId}:`, userData.username);

        res.json({
            success: true,
            user: {
                id: userData.id,
                username: userData.username,
                discriminator: userData.discriminator,
                avatar: userData.avatar ? 
                    `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png?size=256` :
                    `https://cdn.discordapp.com/embed/avatars/${userData.discriminator % 5}.png`,
                created_at: userData.created_at,
                verified: userData.verified,
                public_flags: userData.public_flags,
                email: userData.email,
                phone: userData.phone,
                premium_type: userData.premium_type,
                flags: userData.flags,
                banner: userData.banner,
                accent_color: userData.accent_color,
                bio: userData.bio
            }
        });

    } catch (error) {
        console.error('Get user info error:', error);
        res.status(500).json({ error: 'Failed to get user information' });
    }
});

// User lookup by username using account token
app.post('/api/lookup-user-account', async (req, res) => {
    try {
        const { username } = req.body;
        const accountToken = req.headers['x-account-token'];

        if (!accountToken) {
            return res.status(401).json({ error: 'Account token required' });
        }

        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        console.log(`🔍 Looking up user by username with account token: ${username}`);

        // Parse username format (username#discriminator or just username)
        let searchUsername, discriminator;
        if (username.includes('#')) {
            [searchUsername, discriminator] = username.split('#');
        } else {
            searchUsername = username;
            discriminator = null;
        }

        // Try to get user's relationships (friends) first
        let foundUser = null;
        try {
            console.log(`🔍 Checking user relationships...`);
            const relationshipsResponse = await fetch('https://discord.com/api/v10/users/@me/relationships', {
                headers: {
                    'Authorization': accountToken,
                    'Content-Type': 'application/json'
                }
            });

            if (relationshipsResponse.ok) {
                const relationships = await relationshipsResponse.json();
                console.log(`📊 Found ${relationships.length} relationships`);
                
                for (const relationship of relationships) {
                    if (relationship.user && relationship.user.username.toLowerCase() === searchUsername.toLowerCase()) {
                        if (!discriminator || relationship.user.discriminator === discriminator) {
                            foundUser = relationship.user;
                            console.log(`✅ Found user ${foundUser.username}#${foundUser.discriminator} in relationships`);
                            break;
                        }
                    }
                }
            } else {
                console.log(`⚠️ Could not access relationships: ${relationshipsResponse.status}`);
            }
        } catch (error) {
            console.log(`⚠️ Error accessing relationships:`, error.message);
        }

        // If not found in relationships, try searching through guilds
        if (!foundUser) {
            try {
                console.log(`🔍 Searching through user's guilds...`);
                const guildsResponse = await fetch('https://discord.com/api/v10/users/@me/guilds', {
                    headers: {
                        'Authorization': accountToken,
                        'Content-Type': 'application/json'
                    }
                });

                if (guildsResponse.ok) {
                    const guilds = await guildsResponse.json();
                    console.log(`📊 Found ${guilds.length} guilds for user`);

                    // Search through guilds for the user
                    for (const guild of guilds) {
                        try {
                            console.log(`🔍 Searching in guild: ${guild.name} (${guild.id})`);
                            
                            // Get guild members
                            const membersResponse = await fetch(`https://discord.com/api/v10/guilds/${guild.id}/members?limit=1000`, {
                                headers: {
                                    'Authorization': accountToken,
                                    'Content-Type': 'application/json'
                                }
                            });

                            if (membersResponse.ok) {
                                const members = await membersResponse.json();
                                console.log(`📊 Found ${members.length} members in ${guild.name}`);
                                
                                for (const member of members) {
                                    if (member.user && member.user.username.toLowerCase() === searchUsername.toLowerCase()) {
                                        if (!discriminator || member.user.discriminator === discriminator) {
                                            foundUser = member.user;
                                            console.log(`✅ Found user ${foundUser.username}#${foundUser.discriminator} in ${guild.name}`);
                                            break;
                                        }
                                    }
                                }
                                if (foundUser) break;
                            } else {
                                console.log(`⚠️ Could not access members for guild ${guild.name}: ${membersResponse.status}`);
                            }
                        } catch (error) {
                            console.log(`⚠️ Error searching guild ${guild.name}:`, error.message);
                            continue;
                        }
                    }
                } else {
                    console.log(`❌ Failed to get user guilds:`, guildsResponse.status);
                }
            } catch (error) {
                console.log(`⚠️ Error accessing guilds:`, error.message);
            }
        }

        if (!foundUser) {
            console.log(`❌ User not found: ${username}`);
            return res.status(404).json({ 
                error: 'User not found',
                details: 'User not found in your relationships or shared servers. Discord account tokens can only access users you have a relationship with.'
            });
        }

        console.log(`✅ User found: ${foundUser.username}#${foundUser.discriminator}`);

        res.json({
            success: true,
            user: {
                id: foundUser.id,
                username: foundUser.username,
                discriminator: foundUser.discriminator,
                avatar: foundUser.avatar ? 
                    `https://cdn.discordapp.com/avatars/${foundUser.id}/${foundUser.avatar}.png?size=256` :
                    `https://cdn.discordapp.com/embed/avatars/${foundUser.discriminator % 5}.png`,
                created_at: foundUser.created_at,
                verified: foundUser.verified,
                public_flags: foundUser.public_flags,
                email: foundUser.email,
                phone: foundUser.phone,
                premium_type: foundUser.premium_type,
                flags: foundUser.flags,
                banner: foundUser.banner,
                accent_color: foundUser.accent_color,
                bio: foundUser.bio
            }
        });

    } catch (error) {
        console.error('Lookup user error:', error);
        res.status(500).json({ error: 'Failed to lookup user' });
    }
});

// 404 handler - must be last
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
server.listen(PORT, () => {
    console.log(`🚀 Discord Bot Login Server running on port ${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} in your browser`);
    console.log(`🔗 API endpoints available at http://localhost:${PORT}/api/`);
    console.log(`🌐 WebSocket server running for real-time updates`);
});

module.exports = app;
