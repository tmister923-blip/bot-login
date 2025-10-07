// Dashboard JavaScript
class DiscordBotDashboard {
    constructor() {
        this.botToken = null;
        this.botInfo = null;
        this.guilds = [];
        this.users = [];
        this.availableUsers = [];
        this.selectedUsers = [];
        this.currentTab = 'overview';
        this.dmQueue = [];
        this.isSendingDMs = false;
        
        this.init();
    }

    async init() {
        console.log('🚀 Initializing dashboard...');
        
        // Check if user is logged in
        this.botToken = sessionStorage.getItem('discordBotToken');
        this.botInfo = JSON.parse(sessionStorage.getItem('botInfo') || '{}');
        
        console.log('📊 Bot token present:', !!this.botToken);
        console.log('📊 Bot info:', this.botInfo);
        
        if (!this.botToken) {
            console.log('❌ No bot token, redirecting to login');
            this.redirectToLogin();
            return;
        }

        console.log('🔧 Setting up event listeners...');
        this.setupEventListeners();
        
        console.log('📊 Loading bot info...');
        this.loadBotInfo();
        
        console.log('⏰ Scheduling guild loading in 2 seconds...');
        // Add a small delay to ensure bot client is ready
        setTimeout(() => {
            console.log('🔄 Starting guild loading...');
            this.loadGuilds();
        }, 2000);
        
        console.log('📊 Updating stats...');
        this.updateStats();
        
        console.log('🔄 Starting bot status monitoring...');
        this.startBotStatusMonitoring();
        
        console.log('🔌 Connecting WebSocket...');
        this.connectWebSocket();
        
        console.log('🧪 Testing bot connection...');
        this.testBotConnection();
        
        // Chat properties
        this.currentChatUser = null;
        this.chatHistory = [];
        
        // Music player properties
        this.musicPlayer = {
            isConnected: false,
            currentTrack: null,
            queue: [],
            isPlaying: false,
            volume: 50,
            lavalinkConfig: null
        };
        
        console.log('✅ Dashboard initialization complete');
    }

    connectWebSocket() {
        try {
            this.ws = new WebSocket('ws://localhost:3000');
            
            this.ws.onopen = () => {
                console.log('WebSocket connected');
            };
            
            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log('📨 WebSocket message received:', data);
                
                if (data.type === 'progress') {
                    this.updateProgressBar(data.data);
                } else if (data.type === 'log') {
                    this.addLogEntry(data.message, data.logType);
                    // Also add to auth terminal if we're on the auth tab
                    if (this.currentTab === 'auth') {
                        this.addTerminalLog(data.message, data.logType);
                    }
                    
                    // Check if this is a presence update and add to Recent Activity
                    if (data.message && data.message.includes('is now')) {
                        console.log('🎯 Detected presence update:', data.message);
                        this.addPresenceUpdateToActivity(data.message);
                    }
                }
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                // Try to reconnect after 5 seconds
                setTimeout(() => this.connectWebSocket(), 5000);
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
        }
    }

    updateProgressBar(progressData) {
        const { sent, failed, total, status } = progressData;
        const progressFill = document.querySelector('#dmProgress .progress-fill');
        const progressText = document.querySelector('#dmProgress .progress-text');
        
        if (progressFill && progressText) {
            const progress = total > 0 ? ((sent + failed) / total) * 100 : 0;
            progressFill.style.width = `${progress}%`;
            
            let statusText = '';
            switch (status) {
                case 'starting':
                    statusText = 'Starting DM sending...';
                    break;
                case 'sending':
                    statusText = `Sending DMs... Sent: ${sent}, Failed: ${failed}, Total: ${total}`;
                    break;
                case 'resting':
                    statusText = `Resting between batches... Sent: ${sent}, Failed: ${failed}, Total: ${total}`;
                    break;
                case 'completed':
                    statusText = `✅ Completed! Sent: ${sent}, Failed: ${failed}, Total: ${total}`;
                    this.isSendingDMs = false;
                    this.hideProgress('dmProgress');
                    break;
                case 'error':
                    statusText = `❌ Error: ${progressData.error || 'Unknown error'}`;
                    this.isSendingDMs = false;
                    this.hideProgress('dmProgress');
                    break;
            }
            
            progressText.textContent = statusText;
        }
        
        // Update batch progress if available
        if (progressData.currentBatch && progressData.totalBatches) {
            this.updateBatchProgress(progressData);
        }
    }
    
    updateBatchProgress(progressData) {
        const batchProgress = document.getElementById('batchProgress');
        const currentBatch = document.getElementById('currentBatch');
        const totalBatches = document.getElementById('totalBatches');
        const batchStatus = document.getElementById('batchStatus');
        const batchList = document.getElementById('batchList');
        
        if (batchProgress) {
            batchProgress.style.display = 'block';
        }
        
        if (currentBatch) currentBatch.textContent = progressData.currentBatch;
        if (totalBatches) totalBatches.textContent = progressData.totalBatches;
        
        // Update batch status
        if (batchStatus) {
            switch (progressData.status) {
                case 'starting':
                    batchStatus.textContent = 'Preparing batches...';
                    break;
                case 'sending':
                    batchStatus.textContent = `Processing batch ${progressData.currentBatch}...`;
                    break;
                case 'batch_completed':
                    batchStatus.textContent = `Batch ${progressData.currentBatch} completed!`;
                    break;
                case 'resting':
                    batchStatus.textContent = `Resting before next batch...`;
                    break;
                case 'completed':
                    batchStatus.textContent = 'All batches completed!';
                    break;
                default:
                    batchStatus.textContent = 'Processing...';
            }
        }
        
        // Update batch list
        if (batchList && progressData.totalBatches) {
            this.updateBatchList(progressData);
        }
    }
    
    updateBatchList(progressData) {
        const batchList = document.getElementById('batchList');
        if (!batchList) return;
        
        const totalBatches = progressData.totalBatches;
        const currentBatch = progressData.currentBatch;
        
        // Clear and rebuild batch list
        batchList.innerHTML = '';
        
        for (let i = 1; i <= totalBatches; i++) {
            const batchItem = document.createElement('div');
            batchItem.className = 'batch-item';
            batchItem.id = `batch-${i}`;
            
            let status = 'pending';
            let icon = '⏳';
            let stats = '';
            
            if (i < currentBatch) {
                status = 'completed';
                icon = '✅';
                stats = 'Completed';
            } else if (i === currentBatch) {
                if (progressData.status === 'batch_completed') {
                    status = 'completed';
                    icon = '✅';
                    stats = `Sent: ${progressData.batchSent || 0}, Failed: ${progressData.batchFailed || 0}`;
                } else {
                    status = 'processing';
                    icon = '🔄';
                    stats = 'Processing...';
                }
            }
            
            batchItem.className = `batch-item ${status}`;
            batchItem.innerHTML = `
                <div class="batch-number">${i}</div>
                <div class="batch-status-icon">${icon}</div>
                <div class="batch-info">Batch ${i}</div>
                <div class="batch-stats">${stats}</div>
            `;
            
            batchList.appendChild(batchItem);
        }
    }
    
    addLogEntry(message, type = 'info') {
        const logsContainer = document.getElementById('logsContainer');
        const terminalLogs = document.getElementById('terminalLogs');
        
        if (terminalLogs) {
            terminalLogs.style.display = 'block';
        }
        
        if (logsContainer) {
            const logEntry = document.createElement('div');
            logEntry.className = `log-entry ${type}`;
            
            const timestamp = new Date().toLocaleTimeString();
            logEntry.innerHTML = `
                <span class="log-timestamp">[${timestamp}]</span>
                <span class="log-message">${message}</span>
            `;
            
            logsContainer.appendChild(logEntry);
            
            // Keep only last 100 log entries
            const entries = logsContainer.querySelectorAll('.log-entry');
            if (entries.length > 100) {
                entries[0].remove();
            }
            
            // Auto-scroll to bottom
            logsContainer.scrollTop = logsContainer.scrollHeight;
        }
    }

    startBotStatusMonitoring() {
        // Keep bot online by sending periodic status updates
        this.botStatusInterval = setInterval(async () => {
            try {
                // Send a simple API call to keep the bot active
                await fetch('/api/bot-info', {
                    headers: {
                        'Authorization': `Bearer ${this.botToken}`
                    }
                });
                console.log('Bot status check - keeping bot online');
            } catch (error) {
                console.error('Bot status check failed:', error);
            }
        }, 60000); // Check every 60 seconds (reduced frequency)

        // Update bot status display
        this.updateBotStatusDisplay();
    }

    updateBotStatusDisplay() {
        const statusElement = document.getElementById('botStatus');
        if (statusElement) {
            statusElement.textContent = 'Online';
            statusElement.className = 'status-online';
        }
    }

    async testBotConnection() {
        try {
            console.log('🔄 Testing bot connection...');
            const response = await fetch('/api/test-bot-connection', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.botToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                console.log('✅ Bot connection test successful:', data);
                this.showStatus(`Bot is online: ${data.bot.tag}`, 'success');
            } else {
                const error = await response.json();
                console.error('❌ Bot connection test failed:', error);
                this.showStatus(`Bot connection failed: ${error.error}`, 'error');
            }
        } catch (error) {
            console.error('❌ Bot connection test error:', error);
            this.showStatus('Bot connection test failed', 'error');
        }
    }

    setupEventListeners() {
        console.log('🔄 Setting up event listeners...');
        
        // Navigation
        const navItems = document.querySelectorAll('.nav-item');
        console.log('📊 Found nav items:', navItems.length);
        
        // Music Player setup
        this.setupMusicPlayer();
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const tab = e.currentTarget.dataset.tab;
                console.log('Tab clicked:', tab);
                this.switchTab(tab);
            });
        });

        // Logout
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.logout();
            });
        }

        // User extraction
        const extractUsersBtn = document.getElementById('extractUsersBtn');
        if (extractUsersBtn) {
            extractUsersBtn.addEventListener('click', () => {
                this.extractUsers();
            });
        }

        // Download buttons
        const downloadTxtBtn = document.getElementById('downloadTxtBtn');
        if (downloadTxtBtn) {
            downloadTxtBtn.addEventListener('click', () => {
                this.downloadUsers('txt');
            });
        }

        const downloadCsvBtn = document.getElementById('downloadCsvBtn');
        if (downloadCsvBtn) {
            downloadCsvBtn.addEventListener('click', () => {
                this.downloadUsers('csv');
            });
        }

        // DM messaging
        const sendDmBtn = document.getElementById('sendDmBtn');
        if (sendDmBtn) {
            sendDmBtn.addEventListener('click', () => {
                this.sendDMs();
            });
        }

        const previewBtn = document.getElementById('previewBtn');
        if (previewBtn) {
            previewBtn.addEventListener('click', () => {
                this.previewRecipients();
            });
        }

        // User search
        const searchUserBtn = document.getElementById('searchUserBtn');
        if (searchUserBtn) {
            searchUserBtn.addEventListener('click', () => {
                this.searchUser();
            });
        }

        // Open avatar/banner buttons
        const openAvatarBtn = document.getElementById('openAvatarBtn');
        if (openAvatarBtn) {
            openAvatarBtn.addEventListener('click', () => {
                this.openAvatarInNewTab();
            });
        }

        const openBannerBtn = document.getElementById('openBannerBtn');
        if (openBannerBtn) {
            openBannerBtn.addEventListener('click', () => {
                this.openBannerInNewTab();
            });
        }

        // Search method change
        const searchMethod = document.getElementById('searchMethod');
        if (searchMethod) {
            searchMethod.addEventListener('change', (e) => {
                const label = document.getElementById('searchLabel');
                const input = document.getElementById('searchInput');
                if (e.target.value === 'username') {
                    label.textContent = 'Username:';
                    input.placeholder = 'Enter username';
                } else {
                    label.textContent = 'User ID:';
                    input.placeholder = 'Enter user ID';
                }
            });
        }

        // Recipient selection change
        const recipientSelect = document.getElementById('recipientSelect');
        if (recipientSelect) {
            recipientSelect.addEventListener('change', (e) => {
                const customSelection = document.getElementById('customUserSelection');
                if (e.target.value === 'custom') {
                    customSelection.style.display = 'block';
                    this.loadAvailableUsers();
                } else {
                    customSelection.style.display = 'none';
                }
            });
        }

        // User search for custom selection
        const searchUsersBtn = document.getElementById('searchUsersBtn');
        if (searchUsersBtn) {
            searchUsersBtn.addEventListener('click', () => {
                this.searchAvailableUsers();
            });
        }

        // Download buttons
        const downloadAvatarBtn = document.getElementById('downloadAvatarBtn');
        if (downloadAvatarBtn) {
            downloadAvatarBtn.addEventListener('click', () => {
                this.downloadUserAvatar();
            });
        }

        const downloadBannerBtn = document.getElementById('downloadBannerBtn');
        if (downloadBannerBtn) {
            downloadBannerBtn.addEventListener('click', () => {
                this.downloadUserBanner();
            });
        }

        // Bot customization
        const updateBotBtn = document.getElementById('updateBotBtn');
        if (updateBotBtn) {
            updateBotBtn.addEventListener('click', () => {
                this.updateBot();
            });
        }

        const resetBotBtn = document.getElementById('resetBotBtn');
        if (resetBotBtn) {
            resetBotBtn.addEventListener('click', () => {
                this.resetBotForm();
            });
        }

        const uploadAvatarBtn = document.getElementById('uploadAvatarBtn');
        if (uploadAvatarBtn) {
            uploadAvatarBtn.addEventListener('click', () => {
                this.uploadBotAvatar();
            });
        }

        const uploadBannerBtn = document.getElementById('uploadBannerBtn');
        if (uploadBannerBtn) {
            uploadBannerBtn.addEventListener('click', () => {
                this.uploadBotBanner();
            });
        }
        
        // Chat event listeners
        const openChatBtn = document.getElementById('openChatBtn');
        if (openChatBtn) {
            openChatBtn.addEventListener('click', () => {
                this.openChat();
            });
        }

        const sendChatMessage = document.getElementById('sendChatMessage');
        if (sendChatMessage) {
            sendChatMessage.addEventListener('click', () => {
                this.sendChatMessage();
            });
        }
        
        const chatMessageInput = document.getElementById('chatMessageInput');
        if (chatMessageInput) {
            chatMessageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendChatMessage();
                }
            });
        }
        
        // Close chat modal when clicking outside
        const chatModal = document.getElementById('chatModal');
        if (chatModal) {
            chatModal.addEventListener('click', (e) => {
                if (e.target.id === 'chatModal') {
                    this.closeChat();
                }
            });
        }
        
        // Stickers event listeners
        const uploadMethod = document.getElementById('uploadMethod');
        if (uploadMethod) {
            uploadMethod.addEventListener('change', (e) => {
                this.toggleUploadMethod(e.target.value);
            });
        }

        const uploadStickerBtn = document.getElementById('uploadStickerBtn');
        if (uploadStickerBtn) {
            uploadStickerBtn.addEventListener('click', () => {
                this.uploadSticker();
            });
        }

        const stickerServerSelect = document.getElementById('stickerServerSelect');
        if (stickerServerSelect) {
            stickerServerSelect.addEventListener('change', (e) => {
                this.onStickerServerChange(e.target.value);
            });
        }

        // Statistics event listeners
        const statsServerSelect = document.getElementById('statsServerSelect');
        const loadStatsBtn = document.getElementById('loadStatsBtn');
        
        if (statsServerSelect) {
            statsServerSelect.addEventListener('change', () => this.onStatsServerChange());
        }
        
        if (loadStatsBtn) {
            loadStatsBtn.addEventListener('click', () => this.loadServerStats());
        }

        // Leaderboard tab event listeners
        document.querySelectorAll('.leaderboard-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const type = e.target.dataset.type;
                this.switchLeaderboardTab(type);
            });
        });
        
        // Overview server selection
        const overviewServerSelect = document.getElementById('overviewServerSelect');
        if (overviewServerSelect) {
            overviewServerSelect.addEventListener('change', (e) => {
                this.onOverviewServerChange(e.target.value);
            });
        }

        // User info action buttons (copyUserIdBtn only - others already declared above)
        const copyUserIdBtn = document.getElementById('copyUserIdBtn');
        if (copyUserIdBtn) {
            copyUserIdBtn.addEventListener('click', () => {
                this.copyUserId();
            });
        }
        
        // Authentication tab event listeners
        const authenticateAccountBtn = document.getElementById('authenticateAccountBtn');
        if (authenticateAccountBtn) {
            authenticateAccountBtn.addEventListener('click', () => {
                this.authenticateAccount();
            });
        }

        const clearAuthBtn = document.getElementById('clearAuthBtn');
        if (clearAuthBtn) {
            clearAuthBtn.addEventListener('click', () => {
                this.clearAuthentication();
            });
        }

        const showTokenCheckbox = document.getElementById('showToken');
        if (showTokenCheckbox) {
            showTokenCheckbox.addEventListener('change', (e) => {
                this.toggleTokenVisibility(e.target.checked);
            });
        }

        const testConnectionBtn = document.getElementById('testConnectionBtn');
        if (testConnectionBtn) {
            testConnectionBtn.addEventListener('click', () => {
                this.testAccountConnection();
            });
        }

        const getUserInfoBtn = document.getElementById('getUserInfoBtn');
        if (getUserInfoBtn) {
            getUserInfoBtn.addEventListener('click', () => {
                this.getAccountUserInfo();
            });
        }

        // User lookup event listeners
        const lookupTypeSelect = document.getElementById('lookupType');
        const lookupInput = document.getElementById('lookupInput');
        const lookupUserBtn = document.getElementById('lookupUserBtn');

        if (lookupTypeSelect) {
            lookupTypeSelect.addEventListener('change', (e) => {
                this.updateLookupInput(e.target.value);
            });
        }

        if (lookupUserBtn) {
            lookupUserBtn.addEventListener('click', () => {
                this.lookupUser();
            });
        }

        // Commands event listeners
        this.setupCommandsEventListeners();
    }

    redirectToLogin() {
        window.location.href = '/';
    }

    switchTab(tabName) {
        console.log('Switching to tab:', tabName);
        // Update navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update content
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        const tabElement = document.getElementById(tabName);
        if (tabElement) {
            tabElement.classList.add('active');
            console.log('Tab element found and activated:', tabName);
        } else {
            console.error('Tab element not found:', tabName);
        }

        // Update header
        const titles = {
            overview: 'Dashboard Overview',
            users: 'User Management',
            messaging: 'DM Messaging',
            extract: 'User Lookup',
            stickers: 'Sticker Management',
            statistics: 'Server Statistics',
            commands: 'Message Commands',
            settings: 'Bot Settings'
        };

        const subtitles = {
            overview: 'Welcome to your Discord bot dashboard',
            users: 'Extract and manage users from your servers',
            messaging: 'Send direct messages to users with rate limiting',
            extract: 'Extract detailed information about specific users',
            stickers: 'Upload and manage server stickers',
            statistics: 'Comprehensive analytics and insights for your server',
            commands: 'Create and manage custom message commands for your server',
            settings: 'Configure your bot preferences'
        };

        document.getElementById('pageTitle').textContent = titles[tabName];
        document.getElementById('pageSubtitle').textContent = subtitles[tabName];

        this.currentTab = tabName;

        // Load data for specific tabs
        if (tabName === 'stickers') {
            this.populateStickerServerDropdown();
        } else if (tabName === 'statistics') {
            this.populateStatsServerDropdown();
        } else if (tabName === 'commands') {
            this.populateCommandsServerDropdown();
        }
    }

    async loadBotInfo() {
        try {
            const response = await fetch('/api/bot-info', {
                headers: {
                    'Authorization': `Bearer ${this.botToken}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.botInfo = data.bot;
                this.updateBotDisplay();
            }
        } catch (error) {
            console.error('Error loading bot info:', error);
        }
    }

    updateBotDisplay() {
        if (this.botInfo) {
            document.getElementById('botName').textContent = this.botInfo.username;
            if (this.botInfo.avatar) {
                const avatarUrl = `https://cdn.discordapp.com/avatars/${this.botInfo.id}/${this.botInfo.avatar}.png`;
                document.getElementById('botAvatar').src = avatarUrl;
            }
        }
    }

    async loadGuilds(retryCount = 0) {
        try {
            console.log('🔄 Loading guilds... (attempt', retryCount + 1, ')');
            console.log('🔄 Bot token:', this.botToken ? 'Present' : 'Missing');
            
            const response = await fetch('/api/bot-guilds', {
                headers: {
                    'Authorization': `Bearer ${this.botToken}`
                }
            });

            console.log('📊 Response status:', response.status);
            console.log('📊 Response ok:', response.ok);

            if (response.ok) {
                const data = await response.json();
                console.log('📊 Guilds data:', data);
                
                if (data.guilds && data.guilds.length > 0) {
                    this.guilds = data.guilds;
                    console.log('📊 Guilds loaded:', this.guilds.length);
                    this.populateServerSelect();
                    this.populateLookupServerDropdown();
                    this.populateOverviewServerSelect();
                    this.updateStats();
                } else {
                    console.log('📊 No guilds in response, retrying...');
                    if (retryCount < 3) {
                        console.log('📊 No guilds found, retrying in 2 seconds...');
                        setTimeout(() => {
                            this.loadGuilds(retryCount + 1);
                        }, 2000);
                    } else {
                        console.error('❌ No guilds found after 3 attempts');
                    }
                }
            } else {
                const errorText = await response.text();
                console.error('❌ Failed to load guilds:', response.status, response.statusText, errorText);
                if (retryCount < 3) {
                    console.log('📊 Retrying in 2 seconds...');
                    setTimeout(() => {
                        this.loadGuilds(retryCount + 1);
                    }, 2000);
                }
            }
        } catch (error) {
            console.error('❌ Error loading guilds:', error);
            if (retryCount < 3) {
                console.log('📊 Retrying in 2 seconds...');
                setTimeout(() => {
                    this.loadGuilds(retryCount + 1);
                }, 2000);
            }
        }
    }

    populateServerSelect() {
        const select = document.getElementById('serverSelect');
        if (!select) {
            console.error('❌ serverSelect element not found');
            return;
        }
        
        console.log('🔄 Populating server select with', this.guilds.length, 'guilds');
        select.innerHTML = '<option value="">Select a server...</option>';
        
        this.guilds.forEach(guild => {
            const option = document.createElement('option');
            option.value = guild.id;
            option.textContent = guild.name;
            select.appendChild(option);
        });
        
        console.log('✅ Server select populated with', select.children.length - 1, 'servers');
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
                <span>${message}</span>
            </div>
            <button class="notification-close">&times;</button>
        `;

        // Add to page
        document.body.appendChild(notification);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);

        // Close button functionality
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.remove();
        });
    }

    async extractUsers() {
        const serverId = document.getElementById('serverSelect').value;

        if (!serverId) {
            this.showNotification('Please select a server first', 'error');
            return;
        }

        try {
            const response = await fetch('/api/extract-users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    guildId: serverId,
                    includeBots: true
                })
            });

            if (response.ok) {
                const data = await response.json();
                this.users = data.users;
                this.displayUsers();
                this.showDownloadButtons();
                this.showNotification(`Successfully extracted ${this.users.length} users`, 'success');
            } else {
                const error = await response.json();
                this.showNotification(`Error: ${error.error}`, 'error');
            }
        } catch (error) {
            console.error('Error extracting users:', error);
            this.showNotification('Error extracting users', 'error');
        }
    }

    showDownloadButtons() {
        const downloadTxtBtn = document.getElementById('downloadTxtBtn');
        const downloadCsvBtn = document.getElementById('downloadCsvBtn');
        
        if (downloadTxtBtn) downloadTxtBtn.disabled = false;
        if (downloadCsvBtn) downloadCsvBtn.disabled = false;
    }

    displayUsers() {
        const userList = document.getElementById('userList');
        const userCountDisplay = document.getElementById('userCountDisplay');
        const userListContent = document.getElementById('userListContent');
        
        if (!userList) return;

        if (this.users.length === 0) {
            userList.style.display = 'none';
            return;
        }

        // Show the user list
        userList.style.display = 'block';
        
        // Update user count
        if (userCountDisplay) {
            userCountDisplay.textContent = this.users.length;
        }

        // Display users
        if (userListContent) {
            let html = '';
            this.users.forEach(user => {
                html += `
                    <div class="user-item">
                        <img src="${user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" alt="Avatar" class="user-avatar">
                        <div class="user-info">
                            <div class="user-name">${user.username}#${user.discriminator}</div>
                            <div class="user-id">ID: ${user.id}</div>
                        </div>
                    </div>
                `;
            });
            userListContent.innerHTML = html;
        }
    }

    downloadUsers(format) {
        if (this.users.length === 0) {
            this.showStatus('No users to download', 'error');
            return;
        }

        let content = '';
        let filename = '';

        if (format === 'txt') {
            content = this.users.map(user => 
                `${user.username}#${user.discriminator} (${user.id})`
            ).join('\n');
            filename = 'discord_users.txt';
        } else if (format === 'csv') {
            content = 'Username,Discriminator,ID,Avatar\n';
            content += this.users.map(user => 
                `"${user.username}","${user.discriminator}","${user.id}","${user.avatar || ''}"`
            ).join('\n');
            filename = 'discord_users.csv';
        }

        this.downloadFile(content, filename);
        this.showStatus(`Downloaded ${this.users.length} users as ${format.toUpperCase()}`, 'success');
    }

    downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async previewRecipients() {
        const serverId = document.getElementById('serverSelect').value;
        const recipientSelect = document.getElementById('recipientSelect').value;

        if (!serverId && recipientSelect === 'all') {
            this.showStatus('Please select a server first', 'error');
            return;
        }

        this.showStatus('Loading recipients...', 'info');

        try {
            const response = await fetch('/api/preview-recipients', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    guildId: serverId,
                    type: recipientSelect
                })
            });

            if (response.ok) {
                const data = await response.json();
                this.showStatus(`Found ${data.count} recipients`, 'success');
            } else {
                const error = await response.json();
                this.showStatus(error.error || 'Failed to preview recipients', 'error');
            }
        } catch (error) {
            console.error('Error previewing recipients:', error);
            this.showStatus('Connection error. Please try again.', 'error');
        }
    }

    async sendDMs() {
        const message = document.getElementById('dmMessage').value.trim();
        const serverId = document.getElementById('serverSelect').value;
        const recipientSelect = document.getElementById('recipientSelect').value;
        const messageDelay = parseInt(document.getElementById('messageDelay').value);
        const batchSize = parseInt(document.getElementById('batchSize').value);
        const restTime = parseInt(document.getElementById('restTime').value);

        if (!message) {
            this.showStatus('Please enter a message', 'error');
            return;
        }

        if (recipientSelect === 'all' && !serverId) {
            this.showStatus('Please select a server first', 'error');
            return;
        }

        if (recipientSelect === 'custom' && (!this.selectedUsers || this.selectedUsers.length === 0)) {
            this.showStatus('Please select users from the custom list first', 'error');
            return;
        }

        if (this.isSendingDMs) {
            this.showStatus('Already sending messages. Please wait.', 'error');
            return;
        }

        this.isSendingDMs = true;
        this.dmStats = { sent: 0, failed: 0, total: 0 };
        this.showProgress('dmProgress', 'Sending messages...');

        try {
            const response = await fetch('/api/send-dms', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    message: message,
                    guildId: serverId,
                    type: recipientSelect,
                    customUsers: this.selectedUsers || [],
                    delay: messageDelay,
                    batchSize: batchSize,
                    restTime: restTime
                })
            });

            if (response.ok) {
                this.showStatus('DM sending started. Check the activity log for progress.', 'success');
                this.startDMProgressTracking();
            } else {
                const error = await response.json();
                this.showStatus(error.error || 'Failed to start DM sending', 'error');
            }
        } catch (error) {
            console.error('Error sending DMs:', error);
            this.showStatus('Connection error. Please try again.', 'error');
        } finally {
            this.isSendingDMs = false;
            this.hideProgress('dmProgress');
        }
    }

    startDMProgressTracking() {
        // Simulate progress tracking - in real implementation, this would be WebSocket or polling
        const progressInterval = setInterval(() => {
            if (!this.isSendingDMs) {
                clearInterval(progressInterval);
                return;
            }

            // Update progress bar
            const progressFill = document.querySelector('#dmProgress .progress-fill');
            const progressText = document.querySelector('#dmProgress .progress-text');
            
            if (progressFill && progressText) {
                const progress = Math.min((this.dmStats.sent + this.dmStats.failed) / this.dmStats.total * 100, 100);
                progressFill.style.width = `${progress}%`;
                progressText.textContent = `Sent: ${this.dmStats.sent}, Failed: ${this.dmStats.failed}, Total: ${this.dmStats.total}`;
            }
        }, 1000);
    }

    async searchUser() {
        const searchMethod = document.getElementById('searchMethod').value;
        const searchInput = document.getElementById('searchInput').value.trim();
        const serverId = document.getElementById('lookupServerSelect').value;

        if (!searchInput) {
            this.showNotification('Please enter a username or ID', 'error');
            return;
        }

        if (!serverId) {
            this.showNotification('Please select a server first', 'error');
            return;
        }

        this.showNotification('Searching user...', 'info');

        try {
            // First, search for the user
            const searchResponse = await fetch('/api/search-user', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    method: searchMethod,
                    query: searchInput,
                    guildId: serverId
                })
            });

            if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                console.log('📊 Search response received:', searchData);
                console.log('📊 User data:', searchData.user);
                console.log('📊 User roles in response:', searchData.user.roles);
                
                // Use the search response directly since it already has roles data
                this.displayUserInfo(searchData.user);
                this.showNotification('User found successfully', 'success');
            } else {
                const error = await searchResponse.json();
                this.showNotification(error.error || 'User not found', 'error');
            }
        } catch (error) {
            console.error('Error searching user:', error);
            this.showNotification('Connection error. Please try again.', 'error');
        }
    }

    displayUserInfo(user) {
        const userInfo = document.getElementById('userInfo');
        if (!userInfo) return;

        userInfo.style.display = 'block';
        
        // Store current user for downloads and chat
        this.currentUser = user;
        this.currentChatUser = user;
        
        console.log('📊 Displaying user info:', user);
        
        // Update user avatar
        const userAvatar = document.getElementById('userAvatar');
        if (userAvatar) {
            const avatarUrl = user.avatar ? 
                `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : 
                'https://cdn.discordapp.com/embed/avatars/0.png';
            userAvatar.src = avatarUrl;
        }

        // Update user display name
        const userDisplayName = document.getElementById('userDisplayName');
        if (userDisplayName) {
            userDisplayName.textContent = user.global_name || user.username || 'Unknown User';
        }

        // Update user tag
        const userTag = document.getElementById('userTag');
        if (userTag) {
            userTag.textContent = `@${user.username}`;
        }

        // Update user ID
        const userId = document.getElementById('userId');
        if (userId) {
            userId.textContent = `ID: ${user.id}`;
        }

        // Update user badges
        const userBadges = document.getElementById('userBadges');
        if (userBadges) {
            if (user.badges && user.badges.length > 0) {
                userBadges.innerHTML = user.badges.map(badge => 
                    `<span class="badge"><i class="fas fa-star"></i> ${badge}</span>`
                ).join('');
            } else {
                userBadges.innerHTML = '<span class="badge">No badges</span>';
            }
        }

        // Update user banner
        const userBannerSection = document.getElementById('userBannerSection');
        const userBanner = document.getElementById('userBanner');
        if (userBannerSection && userBanner) {
            if (user.banner) {
                userBanner.src = `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.png`;
                userBannerSection.style.display = 'block';
            } else {
                userBannerSection.style.display = 'none';
            }
        }

        // Update user bio
        const userBioSection = document.getElementById('userBioSection');
        const userBio = document.getElementById('userBio');
        if (userBioSection && userBio) {
            if (user.bio) {
                userBio.textContent = user.bio;
                userBioSection.style.display = 'block';
            } else {
                userBioSection.style.display = 'none';
            }
        }

        // Update user stats
        const userCreatedAt = document.getElementById('userCreatedAt');
        if (userCreatedAt) {
            userCreatedAt.textContent = user.created_at ? 
                new Date(user.created_at).toLocaleDateString() : 'Unknown';
        }

        const userJoinedAt = document.getElementById('userJoinedAt');
        if (userJoinedAt) {
            userJoinedAt.textContent = user.joined_at ? 
                new Date(user.joined_at).toLocaleDateString() : 'Unknown';
        }

        const userStatus = document.getElementById('userStatus');
        if (userStatus) {
            const statusText = user.status || 'offline';
            userStatus.textContent = statusText.charAt(0).toUpperCase() + statusText.slice(1);
        }

        const userPremiumSince = document.getElementById('userPremiumSince');
        if (userPremiumSince) {
            if (user.premium_since) {
                // User has premium_since - this means they're boosting the server
                const premiumDate = new Date(user.premium_since).toLocaleDateString();
                const boostDuration = this.calculateBoostDuration(user.premium_since);
                const badge = this.getBoostBadge(boostDuration);
                
                userPremiumSince.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span>Server Booster Since: ${premiumDate}</span>
                        ${badge}
                    </div>
                `;
            } else {
                // No premium_since - they're not boosting this server
                userPremiumSince.textContent = 'Not boosting this server';
            }
        }

        // Update user roles
        const userRolesSection = document.getElementById('userRolesSection');
        const userRoles = document.getElementById('userRoles');
        if (userRolesSection && userRoles) {
            console.log('📊 User roles data:', user.roles);
            if (user.roles && user.roles.length > 0) {
                console.log('📊 Displaying roles:', user.roles.length, 'roles');
                userRoles.innerHTML = user.roles.map(role => 
                    `<span class="role-badge"><i class="fas fa-shield-alt"></i> ${role.name}</span>`
                ).join('');
                userRolesSection.style.display = 'block';
                console.log('✅ Roles section displayed');
            } else {
                console.log('📊 No roles found, hiding section');
                userRolesSection.style.display = 'none';
            }
        }

        // Show/hide chat button based on user type
        const openChatBtn = document.getElementById('openChatBtn');
        if (openChatBtn) {
            openChatBtn.style.display = user.bot ? 'none' : 'block';
        }

        console.log('✅ User info displayed successfully');
    }

    openAvatarInNewTab() {
        if (!this.currentUser) return;
        
        const avatarUrl = this.currentUser.avatar ? 
            `https://cdn.discordapp.com/avatars/${this.currentUser.id}/${this.currentUser.avatar}.png` :
            `https://cdn.discordapp.com/embed/avatars/0.png`;
        
        window.open(avatarUrl, '_blank');
    }

    openBannerInNewTab() {
        if (!this.currentUser || !this.currentUser.banner) return;
        
        const bannerUrl = `https://cdn.discordapp.com/banners/${this.currentUser.id}/${this.currentUser.banner}.png`;
        window.open(bannerUrl, '_blank');
    }

    copyUserId() {
        if (!this.currentUser) return;
        
        navigator.clipboard.writeText(this.currentUser.id).then(() => {
            this.showNotification('User ID copied to clipboard!', 'success');
        }).catch(() => {
            this.showNotification('Failed to copy User ID', 'error');
        });
    }

    calculateBoostDuration(premiumSince) {
        const now = new Date();
        const boostStart = new Date(premiumSince);
        const diffTime = Math.abs(now - boostStart);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    }

    getBoostBadge(days) {
        // Discord server boosting badge thresholds
        if (days >= 730) { // 24 months
            return this.createBadge('24M', '#ff73fa', 'diamond', true);
        } else if (days >= 548) { // 18 months
            return this.createBadge('18M', '#ff73fa', 'hexagon', true);
        } else if (days >= 456) { // 15 months
            return this.createBadge('15M', '#ff73fa', 'octagon', true);
        } else if (days >= 365) { // 12 months
            return this.createBadge('12M', '#ff73fa', 'star', true);
        } else if (days >= 274) { // 9 months
            return this.createBadge('9M', '#ff73fa', 'rectangle', false);
        } else if (days >= 182) { // 6 months
            return this.createBadge('6M', '#ff73fa', 'hexagon', false);
        } else if (days >= 91) { // 3 months
            return this.createBadge('3M', '#ff73fa', 'octagon', false);
        } else if (days >= 60) { // 2 months
            return this.createBadge('2M', '#ff73fa', 'diamond', false);
        } else if (days >= 30) { // 1 month
            return this.createBadge('1M', '#ff73fa', 'triangle', false);
        } else {
            return this.createBadge('NEW', '#ff73fa', 'circle', false);
        }
    }

    createBadge(text, color, shape, hasSparkles) {
        const sparkles = hasSparkles ? `
            <div style="position: absolute; top: -2px; right: -2px; font-size: 8px; color: #ffd700;">✨</div>
            <div style="position: absolute; bottom: -2px; left: -2px; font-size: 8px; color: #fff;">✨</div>
        ` : '';
        
        const shapeStyles = {
            triangle: 'clip-path: polygon(50% 0%, 0% 100%, 100% 100%);',
            diamond: 'clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);',
            octagon: 'clip-path: polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%);',
            hexagon: 'clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);',
            star: 'clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);',
            rectangle: 'clip-path: polygon(20% 0%, 80% 0%, 100% 20%, 100% 80%, 80% 100%, 20% 100%, 0% 80%, 0% 20%);',
            circle: 'border-radius: 50%;'
        };

        return `
            <div style="
                position: relative;
                display: inline-block;
                width: 24px;
                height: 24px;
                background: linear-gradient(135deg, ${color}, #ff9ffb);
                ${shapeStyles[shape] || shapeStyles.circle}
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 8px;
                font-weight: bold;
                color: white;
                text-shadow: 0 1px 2px rgba(0,0,0,0.5);
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            ">
                ${text}
                ${sparkles}
            </div>
        `;
    }

    populateLookupServerDropdown() {
        const select = document.getElementById('lookupServerSelect');
        if (!select) return;
        
        select.innerHTML = '<option value="">Select a server...</option>';
        
        this.guilds.forEach(guild => {
            const option = document.createElement('option');
            option.value = guild.id;
            option.textContent = guild.name;
            select.appendChild(option);
        });
    }

    populateOverviewServerSelect() {
        const select = document.getElementById('overviewServerSelect');
        if (!select) {
            console.error('❌ overviewServerSelect element not found');
            return;
        }
        
        console.log('🔄 Populating overview server select with', this.guilds.length, 'guilds');
        select.innerHTML = '<option value="">Select a server...</option>';
        
        this.guilds.forEach(guild => {
            const option = document.createElement('option');
            option.value = guild.id;
            option.textContent = guild.name;
            select.appendChild(option);
        });
        
        console.log('✅ Overview server select populated with', select.children.length - 1, 'servers');
    }

    onOverviewServerChange(serverId) {
        if (!serverId) {
            document.getElementById('selectedServerInfo').style.display = 'none';
            return;
        }
        
        const guild = this.guilds.find(g => g.id === serverId);
        if (guild) {
            const serverInfo = document.getElementById('selectedServerInfo');
            const serverDetails = document.getElementById('serverDetails');
            
            serverDetails.innerHTML = `
                <div class="server-detail">
                    <strong>Server Name:</strong> ${guild.name}
                </div>
                <div class="server-detail">
                    <strong>Server ID:</strong> ${guild.id}
                </div>
                <div class="server-detail">
                    <strong>Members:</strong> ${guild.member_count || 'Unknown'}
                </div>
                <div class="server-detail">
                    <strong>Icon:</strong> ${guild.icon ? '✅ Has icon' : '❌ No icon'}
                </div>
            `;
            
            serverInfo.style.display = 'block';
            console.log('✅ Server selected:', guild.name);
        }
    }

    downloadUserAvatar() {
        if (!this.currentUser) {
            this.showStatus('No user selected', 'error');
            return;
        }

        const avatarUrl = this.currentUser.avatar 
            ? `https://cdn.discordapp.com/avatars/${this.currentUser.id}/${this.currentUser.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/0.png`;
        
        this.downloadImage(avatarUrl, `${this.currentUser.username}_avatar.png`);
        this.showStatus('Avatar download started', 'success');
    }

    downloadUserBanner() {
        if (!this.currentUser || !this.currentUser.banner) {
            this.showStatus('No banner available for this user', 'error');
            return;
        }

        const bannerUrl = `https://cdn.discordapp.com/banners/${this.currentUser.id}/${this.currentUser.banner}.png`;
        this.downloadImage(bannerUrl, `${this.currentUser.username}_banner.png`);
        this.showStatus('Banner download started', 'success');
    }

    downloadImage(url, filename) {
        fetch(url)
            .then(response => response.blob())
            .then(blob => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
            })
            .catch(error => {
                console.error('Download error:', error);
                this.showStatus('Download failed', 'error');
            });
    }

    async loadAvailableUsers() {
        const serverId = document.getElementById('serverSelect').value;
        if (!serverId) {
            this.showStatus('Please select a server first', 'error');
            return;
        }

        try {
            const response = await fetch('/api/extract-users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    guildId: serverId,
                    includeBots: false
                })
            });

            if (response.ok) {
                const data = await response.json();
                this.availableUsers = data.users;
                this.displayAvailableUsers();
            } else {
                const error = await response.json();
                this.showStatus(error.error || 'Failed to load users', 'error');
            }
        } catch (error) {
            console.error('Error loading users:', error);
            this.showStatus('Connection error. Please try again.', 'error');
        }
    }

    displayAvailableUsers() {
        const availableList = document.getElementById('availableUsersList');
        availableList.innerHTML = '';

        this.availableUsers.forEach(user => {
            const userItem = document.createElement('div');
            userItem.className = 'user-selection-item';
            userItem.innerHTML = `
                <img src="${user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                     alt="${user.username}" class="user-avatar">
                <div class="user-info">
                    <div class="user-name">${user.username}#${user.discriminator}</div>
                    <div class="user-id">ID: ${user.id}</div>
                </div>
                <div class="user-actions">
                    <button class="btn btn-primary add-user-btn" data-user-id="${user.id}">
                        <i class="fas fa-plus"></i> Add
                    </button>
                </div>
            `;
            availableList.appendChild(userItem);
        });

        // Add event listeners for add buttons
        availableList.querySelectorAll('.add-user-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const userId = e.target.closest('.add-user-btn').dataset.userId;
                this.addUserToSelection(userId);
            });
        });
    }

    addUserToSelection(userId) {
        const user = this.availableUsers.find(u => u.id === userId);
        if (!user) return;

        if (!this.selectedUsers) {
            this.selectedUsers = [];
        }

        if (!this.selectedUsers.find(u => u.id === userId)) {
            this.selectedUsers.push(user);
            this.updateSelectedUsersDisplay();
        }
    }

    removeUserFromSelection(userId) {
        if (this.selectedUsers) {
            this.selectedUsers = this.selectedUsers.filter(u => u.id !== userId);
            this.updateSelectedUsersDisplay();
        }
    }

    updateSelectedUsersDisplay() {
        const selectedList = document.getElementById('selectedUsersList');
        const selectedCount = document.getElementById('selectedCount');
        
        selectedCount.textContent = this.selectedUsers ? this.selectedUsers.length : 0;
        selectedList.innerHTML = '';

        if (this.selectedUsers) {
            this.selectedUsers.forEach(user => {
                const userItem = document.createElement('div');
                userItem.className = 'user-selection-item';
                userItem.innerHTML = `
                    <img src="${user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                         alt="${user.username}" class="user-avatar">
                    <div class="user-info">
                        <div class="user-name">${user.username}#${user.discriminator}</div>
                        <div class="user-id">ID: ${user.id}</div>
                    </div>
                    <div class="user-actions">
                        <button class="btn btn-danger remove-user-btn" data-user-id="${user.id}">
                            <i class="fas fa-times"></i> Remove
                        </button>
                    </div>
                `;
                selectedList.appendChild(userItem);
            });

            // Add event listeners for remove buttons
            selectedList.querySelectorAll('.remove-user-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const userId = e.target.closest('.remove-user-btn').dataset.userId;
                    this.removeUserFromSelection(userId);
                });
            });
        }
    }

    searchAvailableUsers() {
        const searchTerm = document.getElementById('userSearch').value.toLowerCase();
        if (!searchTerm) {
            this.displayAvailableUsers();
            return;
        }

        const filteredUsers = this.availableUsers.filter(user => 
            user.username.toLowerCase().includes(searchTerm)
        );

        const availableList = document.getElementById('availableUsersList');
        availableList.innerHTML = '';

        filteredUsers.forEach(user => {
            const userItem = document.createElement('div');
            userItem.className = 'user-selection-item';
            userItem.innerHTML = `
                <img src="${user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                     alt="${user.username}" class="user-avatar">
                <div class="user-info">
                    <div class="user-name">${user.username}#${user.discriminator}</div>
                    <div class="user-id">ID: ${user.id}</div>
                </div>
                <div class="user-actions">
                    <button class="btn btn-primary add-user-btn" data-user-id="${user.id}">
                        <i class="fas fa-plus"></i> Add
                    </button>
                </div>
            `;
            availableList.appendChild(userItem);
        });

        // Add event listeners for add buttons
        availableList.querySelectorAll('.add-user-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const userId = e.target.closest('.add-user-btn').dataset.userId;
                this.addUserToSelection(userId);
            });
        });
    }

    async updateBot() {
        const username = document.getElementById('botUsername').value.trim();
        const activityType = document.getElementById('botActivityType').value;
        const activityText = document.getElementById('botActivityText').value.trim();
        const streamingUrl = document.getElementById('botStreamingUrl').value.trim();

        if (!username && !activityText) {
            this.showStatus('Please enter at least one field to update', 'error');
            return;
        }

        try {
            const updateData = {};
            if (username) updateData.username = username;
            if (activityText) {
                updateData.activity = {
                    type: activityType,
                    name: activityText
                };
                if (activityType === 'streaming' && streamingUrl) {
                    updateData.activity.url = streamingUrl;
                }
            }

            const response = await fetch('/api/update-bot', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify(updateData)
            });

            if (response.ok) {
                this.showStatus('Bot updated successfully', 'success');
                this.loadBotInfo(); // Refresh bot info
            } else {
                const error = await response.json();
                this.showStatus(error.error || 'Failed to update bot', 'error');
            }
        } catch (error) {
            console.error('Error updating bot:', error);
            this.showStatus('Connection error. Please try again.', 'error');
        }
    }

    resetBotForm() {
        document.getElementById('botUsername').value = '';
        document.getElementById('botActivityText').value = '';
        document.getElementById('botStreamingUrl').value = '';
        document.getElementById('botActivityType').value = 'playing';
        this.showStatus('Form reset', 'info');
    }

    async uploadBotAvatar() {
        const fileInput = document.getElementById('botAvatarFile');
        const file = fileInput.files[0];
        
        if (!file) {
            this.showStatus('Please select an image file', 'error');
            return;
        }

        try {
            // Convert file to base64
            const base64 = await this.fileToBase64(file);
            
            const response = await fetch('/api/upload-bot-avatar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    avatarData: base64
                })
            });

            if (response.ok) {
                this.showStatus('Avatar uploaded successfully', 'success');
                this.loadBotInfo();
            } else {
                const error = await response.json();
                this.showStatus(error.error || 'Failed to upload avatar', 'error');
            }
        } catch (error) {
            console.error('Error uploading avatar:', error);
            this.showStatus('Upload failed. Please try again.', 'error');
        }
    }

    async uploadBotBanner() {
        const fileInput = document.getElementById('botBannerFile');
        const file = fileInput.files[0];
        
        if (!file) {
            this.showStatus('Please select an image file', 'error');
            return;
        }

        try {
            // Convert file to base64
            const base64 = await this.fileToBase64(file);
            
            const response = await fetch('/api/upload-bot-banner', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    bannerData: base64
                })
            });

            if (response.ok) {
                this.showStatus('Banner uploaded successfully', 'success');
                this.loadBotInfo();
            } else {
                const error = await response.json();
                this.showStatus(error.error || 'Failed to upload banner', 'error');
            }
        } catch (error) {
            console.error('Error uploading banner:', error);
            this.showStatus('Upload failed. Please try again.', 'error');
        }
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    updateStats() {
        const guildCount = this.guilds ? this.guilds.length : 0;
        const userCount = this.users ? this.users.length : 0;
        
        console.log('📊 Updating stats - Guilds:', guildCount, 'Users:', userCount);
        
        const guildCountElement = document.getElementById('guildCount');
        const userCountElement = document.getElementById('userCount');
        
        if (guildCountElement) {
            guildCountElement.textContent = guildCount;
        }
        if (userCountElement) {
            userCountElement.textContent = userCount;
        }
    }

    showProgress(containerId, text) {
        const container = document.getElementById(containerId);
        const textElement = container.querySelector('.progress-text');
        textElement.textContent = text;
        container.style.display = 'block';
    }

    hideProgress(containerId) {
        document.getElementById(containerId).style.display = 'none';
    }

    showStatus(message, type) {
        const statusMessage = document.getElementById('statusMessage');
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        statusMessage.classList.add('show');

        setTimeout(() => {
            statusMessage.classList.remove('show');
        }, 5000);
    }

    async logout() {
        // Clean up bot status monitoring
        if (this.botStatusInterval) {
            clearInterval(this.botStatusInterval);
        }
        
        // Close WebSocket connection
        if (this.ws) {
            this.ws.close();
        }
        
        // Disconnect bot from Discord
        try {
            await fetch('/api/logout', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.botToken}`
                }
            });
        } catch (error) {
            console.error('Logout error:', error);
        }
        
        sessionStorage.removeItem('discordBotToken');
        sessionStorage.removeItem('botInfo');
        this.redirectToLogin();
    }

    // Chat Methods
    async openChat() {
        if (!this.currentChatUser) {
            this.showStatus('No user selected for chat', 'error');
            return;
        }

        const chatModal = document.getElementById('chatModal');
        const chatUserInfo = document.getElementById('chatUserInfo');
        
        chatUserInfo.textContent = `Chat with ${this.currentChatUser.username}`;
        chatModal.style.display = 'flex';
        
        // Load chat history
        await this.loadChatHistory();
    }

    closeChat() {
        const chatModal = document.getElementById('chatModal');
        chatModal.style.display = 'none';
        this.currentChatUser = null;
        this.chatHistory = [];
        
        // Clear the chat messages display
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            chatMessages.innerHTML = '';
        }
        
        // Clear the input
        const messageInput = document.getElementById('chatMessageInput');
        if (messageInput) {
            messageInput.value = '';
        }
    }

    async loadChatHistory() {
        if (!this.currentChatUser) return;

        try {
            const response = await fetch('/api/get-chat-history', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    userId: this.currentChatUser.id
                })
            });

            if (response.ok) {
                const data = await response.json();
                this.chatHistory = data.messages || [];
                this.chatNote = data.note || null;
                this.displayChatMessages();
            } else {
                console.error('Failed to load chat history');
                this.chatHistory = [];
                this.chatNote = 'Failed to load chat history';
                this.displayChatMessages();
            }
        } catch (error) {
            console.error('Error loading chat history:', error);
            this.chatHistory = [];
            this.displayChatMessages();
        }
    }

    displayChatMessages() {
        const chatMessages = document.getElementById('chatMessages');
        chatMessages.innerHTML = '';

        if (this.chatHistory.length === 0) {
            const noteMessage = this.chatNote || 'No messages yet. Start the conversation!';
            chatMessages.innerHTML = `<div class="no-messages" style="text-align: center; color: #b0b0b0; padding: 20px;">${noteMessage}</div>`;
            return;
        }

        this.chatHistory.forEach(message => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${message.sender === 'bot' ? 'sent' : 'received'}`;
            
            const time = new Date(message.timestamp).toLocaleTimeString();
            const authorName = message.author ? message.author.username : (message.sender === 'bot' ? 'Bot' : 'User');
            
            messageDiv.innerHTML = `
                <div class="message-author">${authorName}</div>
                <div class="message-content">${message.content}</div>
                <div class="message-time">${time}</div>
            `;
            
            chatMessages.appendChild(messageDiv);
        });

        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async sendChatMessage() {
        const messageInput = document.getElementById('chatMessageInput');
        const message = messageInput.value.trim();
        
        if (!message || !this.currentChatUser) return;

        const sendBtn = document.getElementById('sendChatMessage');
        sendBtn.disabled = true;

        try {
            const response = await fetch('/api/send-chat-message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    userId: this.currentChatUser.id,
                    message: message
                })
            });

            if (response.ok) {
                const data = await response.json();
                
                // Add message to chat history
                this.chatHistory.push({
                    content: message,
                    sender: 'bot',
                    timestamp: new Date().toISOString()
                });
                
                this.displayChatMessages();
                messageInput.value = '';
            } else {
                const error = await response.json();
                this.showStatus(`Failed to send message: ${error.error}`, 'error');
            }
        } catch (error) {
            console.error('Error sending chat message:', error);
            this.showStatus('Failed to send message', 'error');
        } finally {
            sendBtn.disabled = false;
        }
    }

    // Stickers Methods
    toggleUploadMethod(method) {
        const fileSection = document.getElementById('fileUploadSection');
        const idSection = document.getElementById('idUploadSection');
        
        if (method === 'file') {
            fileSection.style.display = 'block';
            idSection.style.display = 'none';
        } else {
            fileSection.style.display = 'none';
            idSection.style.display = 'block';
        }
    }

    async loadStickers() {
        if (!this.currentStickerServer) {
            this.clearStickerDisplay();
            return;
        }

        try {
            const response = await fetch('/api/get-stickers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    guildId: this.currentStickerServer
                })
            });

            if (response.ok) {
                const data = await response.json();
                this.displayStickers(data.stickers || []);
                this.updateStickerStats(data.stats || {});
            } else {
                console.error('Failed to load stickers');
                this.showStatus('Failed to load stickers', 'error');
            }
        } catch (error) {
            console.error('Error loading stickers:', error);
            this.showStatus('Connection error. Please try again.', 'error');
        }
    }

    displayStickers(stickers) {
        const stickersList = document.getElementById('stickersList');
        
        if (stickers.length === 0) {
            stickersList.innerHTML = '<div class="loading-stickers">No stickers found</div>';
            return;
        }

        stickersList.innerHTML = stickers.map(sticker => `
            <div class="sticker-item">
                <img src="${sticker.url}" alt="${sticker.name}" class="sticker-preview">
                <div class="sticker-name">${sticker.name}</div>
                <div class="sticker-description">${sticker.description || 'No description'}</div>
                <div class="sticker-actions">
                    <button class="sticker-btn delete" onclick="dashboard.deleteSticker('${sticker.id}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        `).join('');
    }

    updateStickerStats(stats) {
        document.getElementById('availableSlots').textContent = stats.available || 0;
        document.getElementById('usedSlots').textContent = stats.used || 0;
    }

    async uploadSticker() {
        if (!this.currentStickerServer) {
            this.showStatus('Please select a server first', 'error');
            return;
        }

        const method = document.getElementById('uploadMethod').value;
        const name = document.getElementById('stickerName').value.trim();
        const description = document.getElementById('stickerDescription').value.trim();

        if (!name) {
            this.showStatus('Please enter a sticker name', 'error');
            return;
        }

        this.showStatus('Uploading sticker...', 'info');

        try {
            let formData = new FormData();
            formData.append('name', name);
            formData.append('description', description);
            formData.append('method', method);
            formData.append('guildId', this.currentStickerServer);

            if (method === 'file') {
                const file = document.getElementById('stickerFile').files[0];
                if (!file) {
                    this.showStatus('Please select a file', 'error');
                    return;
                }
                formData.append('file', file);
            } else {
                const stickerId = document.getElementById('stickerId').value.trim();
                if (!stickerId) {
                    this.showStatus('Please enter a sticker ID', 'error');
                    return;
                }
                formData.append('stickerId', stickerId);
            }

            const response = await fetch('/api/upload-sticker', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                this.showStatus('Sticker uploaded successfully!', 'success');
                this.loadStickers(); // Refresh the list
                this.clearStickerForm();
            } else {
                const error = await response.json();
                this.showStatus(error.error || 'Failed to upload sticker', 'error');
            }
        } catch (error) {
            console.error('Error uploading sticker:', error);
            this.showStatus('Connection error. Please try again.', 'error');
        }
    }

    async deleteSticker(stickerId) {
        if (!this.currentStickerServer) {
            this.showStatus('Please select a server first', 'error');
            return;
        }

        if (!confirm('Are you sure you want to delete this sticker?')) {
            return;
        }

        try {
            const response = await fetch('/api/delete-sticker', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({ 
                    stickerId,
                    guildId: this.currentStickerServer
                })
            });

            if (response.ok) {
                this.showStatus('Sticker deleted successfully!', 'success');
                this.loadStickers(); // Refresh the list
            } else {
                const error = await response.json();
                this.showStatus(error.error || 'Failed to delete sticker', 'error');
            }
        } catch (error) {
            console.error('Error deleting sticker:', error);
            this.showStatus('Connection error. Please try again.', 'error');
        }
    }

    clearStickerForm() {
        document.getElementById('stickerName').value = '';
        document.getElementById('stickerDescription').value = '';
        document.getElementById('stickerFile').value = '';
        document.getElementById('stickerId').value = '';
    }

    async populateStickerServerDropdown() {
        try {
            const serverSelect = document.getElementById('stickerServerSelect');
            if (serverSelect) {
                // Clear existing options
                serverSelect.innerHTML = '<option value="">Select a server...</option>';
                
                // Use the already loaded guilds
                this.guilds.forEach(guild => {
                    const option = document.createElement('option');
                    option.value = guild.id;
                    option.textContent = guild.name;
                    serverSelect.appendChild(option);
                });
                
                // Auto-select if global server is already selected
                const globalServer = this.getGlobalSelectedServer();
                if (globalServer) {
                    serverSelect.value = globalServer.id;
                    this.onStickerServerChange(globalServer.id);
                }
            }
        } catch (error) {
            console.error('Error loading guilds for stickers:', error);
        }
    }

    onStickerServerChange(serverId) {
        if (serverId) {
            this.currentStickerServer = serverId;
            this.loadStickers();
        } else {
            this.currentStickerServer = null;
            this.clearStickerDisplay();
        }
    }

    clearStickerDisplay() {
        document.getElementById('stickersList').innerHTML = '<div class="loading-stickers">Please select a server first</div>';
        document.getElementById('availableSlots').textContent = '0';
        document.getElementById('usedSlots').textContent = '0';
    }

    // Statistics Methods
    async populateStatsServerDropdown() {
        try {
            console.log('Populating stats server dropdown...');
            const select = document.getElementById('statsServerSelect');
            if (select) {
                select.innerHTML = '<option value="">Select a server...</option>';
                
                // Use the already loaded guilds
                this.guilds.forEach(guild => {
                    const option = document.createElement('option');
                    option.value = guild.id;
                    option.textContent = guild.name;
                    select.appendChild(option);
                });
                console.log('Stats server dropdown populated');
                
                // Auto-select if global server is already selected
                const globalServer = this.getGlobalSelectedServer();
                if (globalServer) {
                    select.value = globalServer.id;
                    this.onStatsServerChange(globalServer.id);
                }
            } else {
                console.error('statsServerSelect element not found');
            }
        } catch (error) {
            console.error('Error loading servers for stats:', error);
        }
    }

    async onStatsServerChange(serverId) {
        console.log('Stats server changed to:', serverId);
        if (!serverId) return;
        
        this.currentStatsServer = serverId;
        await this.loadServerStats(serverId);
    }

    async loadServerStats(guildId) {
        try {
            const response = await fetch('/api/get-server-stats', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.botToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ guildId })
            });

            if (response.ok) {
                const data = await response.json();
                console.log('📊 Real server statistics received:', data);
                this.displayServerStats(data);
            } else {
                console.error('Failed to load server stats');
            }
        } catch (error) {
            console.error('Error loading server stats:', error);
        }
    }

    displayServerStats(stats) {
        console.log('📊 Displaying server stats:', stats);
        
        // Member statistics - using the correct API response structure
        const serverInfo = stats.serverInfo;
        
        // Update the main member count (this is the key fix!)
        const currentMembersElement = document.getElementById('currentMembers');
        if (currentMembersElement) {
            currentMembersElement.textContent = serverInfo.memberCount || 0;
            console.log('✅ Updated currentMembers to:', serverInfo.memberCount);
        } else {
            console.log('❌ currentMembers element not found');
        }
        
        // Update growth rate
        const growthRateElement = document.getElementById('growthRate');
        if (growthRateElement && stats.serverGrowth) {
            growthRateElement.textContent = `${stats.serverGrowth.growthRate || 0}%`;
        }
        
        // Update peak activity
        const peakActivityElement = document.getElementById('peakActivity');
        if (peakActivityElement && stats.serverGrowth) {
            peakActivityElement.textContent = stats.serverGrowth.peakActivity || '-';
        }
        
        // Update channel count (REAL DATA)
        const totalChannelsElement = document.getElementById('totalChannels');
        if (totalChannelsElement) {
            totalChannelsElement.textContent = serverInfo.channelCount || 0;
            console.log('✅ Updated totalChannels to:', serverInfo.channelCount);
        }
        
        // Update most active channel (REAL DATA)
        const mostActiveChannelElement = document.getElementById('mostActiveChannel');
        if (mostActiveChannelElement && stats.channelActivity && stats.channelActivity.labels && stats.channelActivity.labels.length > 0) {
            // Find the channel with the highest activity
            const maxIndex = stats.channelActivity.data.indexOf(Math.max(...stats.channelActivity.data));
            const mostActiveChannel = stats.channelActivity.labels[maxIndex] || '-';
            mostActiveChannelElement.textContent = mostActiveChannel;
            console.log('✅ Updated mostActiveChannel to:', mostActiveChannel);
        }
        
        console.log('✅ Server stats displayed successfully');
    }

    switchActivityTab(activity) {
        // Remove active class from all tabs and content
        document.querySelectorAll('.activity-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.activity-content').forEach(content => content.classList.remove('active'));
        
        // Add active class to selected tab and content
        document.querySelector(`[data-activity="${activity}"]`).classList.add('active');
        document.getElementById(`${activity}Activity`).classList.add('active');
    }

    switchLeaderboardTab(leaderboard) {
        // Remove active class from all tabs and content
        document.querySelectorAll('.leaderboard-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.leaderboard').forEach(content => content.classList.remove('active'));
        
        // Add active class to selected tab and content
        document.querySelector(`[data-leaderboard="${leaderboard}"]`).classList.add('active');
        document.getElementById(`${leaderboard}Leaderboard`).classList.add('active');
    }

    async getUserInfo() {
        const searchTerm = document.getElementById('userInfoSearch').value.trim();
        if (!searchTerm) {
            alert('Please enter a username or ID');
            return;
        }

        try {
            // First, try to find the user by searching in the current server
            const response = await fetch('/api/search-user', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.botToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    searchTerm,
                    guildId: this.currentStatsServer 
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.user) {
                    await this.displayUserInfoStats(data.user);
                } else {
                    alert('User not found');
                }
            } else {
                alert('Failed to search for user');
            }
        } catch (error) {
            console.error('Error getting user info:', error);
            alert('Error getting user information');
        }
    }

    async displayUserInfoStats(user) {
        const display = document.getElementById('userInfoDisplay');
        const avatar = document.getElementById('userInfoAvatar');
        const name = document.getElementById('userInfoName');
        const id = document.getElementById('userInfoId');
        const joinDate = document.getElementById('userJoinDate');
        const createdDate = document.getElementById('userCreatedDate');
        const status = document.getElementById('userStatus');
        const roles = document.getElementById('userRoles');

        // Set user information
        avatar.src = user.avatar ? 
            `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : 
            `https://cdn.discordapp.com/embed/avatars/${user.discriminator % 5}.png`;
        
        name.textContent = user.username;
        id.textContent = user.id;
        joinDate.textContent = user.joinDate ? new Date(user.joinDate).toLocaleDateString() : 'Unknown';
        createdDate.textContent = user.created ? new Date(user.created).toLocaleDateString() : 'Unknown';
        status.textContent = user.status || 'Offline';
        roles.textContent = user.roles ? user.roles.length : 0;

        display.style.display = 'block';
    }

    // Statistics Methods
    populateStatsServerDropdown() {
        const statsServerSelect = document.getElementById('statsServerSelect');
        if (!statsServerSelect) return;

        statsServerSelect.innerHTML = '<option value="">Select a server...</option>';
        
        if (this.guilds && this.guilds.length > 0) {
            this.guilds.forEach(guild => {
                const option = document.createElement('option');
                option.value = guild.id;
                option.textContent = guild.name;
                statsServerSelect.appendChild(option);
            });
        }
    }

    onStatsServerChange() {
        const statsServerSelect = document.getElementById('statsServerSelect');
        const loadStatsBtn = document.getElementById('loadStatsBtn');
        
        if (statsServerSelect && loadStatsBtn) {
            loadStatsBtn.disabled = !statsServerSelect.value;
        }
    }

    async loadServerStats() {
        const statsServerSelect = document.getElementById('statsServerSelect');
        const statsContent = document.getElementById('statsContent');
        
        if (!statsServerSelect || !statsContent) return;

        const serverId = statsServerSelect.value;
        if (!serverId) return;

        try {
            this.showNotification('Loading server statistics...', 'info');
            
            // Show loading state
            statsContent.style.display = 'block';
            
            // Fetch real server statistics
            const response = await fetch('/api/get-server-stats', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({ guildId: serverId })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('📊 API Error Response:', errorData);
                throw new Error(`Failed to fetch statistics: ${response.status} - ${errorData.error || 'Unknown error'}`);
            }

            const responseData = await response.json();
            console.log('📊 Real server statistics received:', responseData);
            
            // Extract the actual stats from the response structure
            let stats;
            if (responseData.success && responseData.stats) {
                // Response has {success: true, stats: {...}} structure
                stats = responseData.stats;
            } else {
                // Response is the stats object directly
                stats = responseData;
            }
            
            console.log('📊 Extracted stats:', stats);
            console.log('📊 Stats keys:', Object.keys(stats));
            console.log('📊 Stats structure:', {
                memberActivity: stats.memberActivity,
                topUsers: stats.topUsers,
                channelActivity: stats.channelActivity,
                serverGrowth: stats.serverGrowth,
                serverHealth: stats.serverHealth,
                serverInfo: stats.serverInfo
            });
            
            // Display real statistics
            this.displayRealStats(stats);
            
            this.showNotification('Statistics loaded successfully!', 'success');
        } catch (error) {
            console.error('Error loading statistics:', error);
            this.showNotification('Failed to load statistics', 'error');
        }
    }

    displayRealStats(stats) {
        console.log('📊 Full stats object keys:', Object.keys(stats));
        console.log('📊 Stats values:', {
            serverInfo: stats.serverInfo,
            memberActivity: stats.memberActivity,
            topUsers: stats.topUsers,
            channelActivity: stats.channelActivity,
            serverGrowth: stats.serverGrowth,
            serverHealth: stats.serverHealth
        });
        
        // Display server info from the actual data structure
        if (stats.serverInfo) {
            this.displayServerInfoFromData(stats.serverInfo);
        }
        
        // Display member info from the actual data structure
        if (stats.serverInfo) {
            this.displayMemberInfoFromData(stats.serverInfo);
        }
        
        // Generate mock data for charts since we don't have real activity data
        this.generateMockCharts(stats);
    }

    displayServerInfoFromData(serverData) {
        console.log('📊 Displaying server info:', serverData);
        
        // Update server info in the UI
        const serverName = document.getElementById('serverName');
        const memberCount = document.getElementById('memberCount');
        const channelCount = document.getElementById('channelCount');
        
        if (serverName) serverName.textContent = serverData.name;
        if (memberCount) memberCount.textContent = serverData.memberCount || 'N/A';
        if (channelCount) channelCount.textContent = serverData.channelCount;
        
        // Update other server metrics with REAL DATA
        document.getElementById('currentMembers').textContent = serverData.memberCount || 'N/A';
        document.getElementById('totalChannels').textContent = serverData.channelCount || 0;
        document.getElementById('totalMessages').textContent = 'N/A'; // Not available from Discord API
        document.getElementById('mostActiveChannel').textContent = 'N/A'; // Will be updated by displayServerStats
    }

    displayMemberInfoFromData(serverData) {
        console.log('📊 Displaying member info:', serverData);
        
        // Update member statistics using the correct API response structure
        const totalMembers = serverData.memberCount || 0;
        const humanCount = serverData.humanCount || 0;
        const botCount = serverData.botCount || 0;
        
        // Update member counts in the UI
        document.getElementById('currentMembers').textContent = totalMembers.toLocaleString();
        
        // Update health metrics based on member data
        const activityLevel = Math.min(100, Math.max(20, Math.floor((humanCount / totalMembers) * 100)));
        const engagementLevel = Math.min(100, Math.max(30, Math.floor((totalMembers / 1000) * 50)));
        
        document.getElementById('activityBar').style.width = activityLevel + '%';
        document.getElementById('engagementBar').style.width = engagementLevel + '%';
        document.getElementById('responseBar').style.width = '95%';
        
        document.getElementById('activityLevel').textContent = this.getHealthLevel(activityLevel);
        document.getElementById('engagementLevel').textContent = this.getHealthLevel(engagementLevel);
        document.getElementById('responseTime').textContent = 'Excellent';
    }

    generateMockCharts(stats) {
        console.log('📊 Generating charts with REAL data:', stats);
        
        // Use REAL data from the API response instead of generating fake data
        if (stats.memberActivity) {
            this.displayMemberActivity(stats.memberActivity);
        }
        
        if (stats.channelActivity) {
            this.displayChannelActivity(stats.channelActivity);
        }
        
        if (stats.topUsers) {
            this.displayTopUsers(stats.topUsers);
        }
        
        if (stats.serverGrowth) {
            this.displayServerGrowth(stats.serverGrowth);
        }
        
        console.log('✅ Charts updated with real data');
    }

    generateActivityData(baseCount) {
        const days = 7;
        const activity = [];
        for (let i = 0; i < days; i++) {
            const variation = Math.random() * 0.4 + 0.8; // 80-120% variation
            activity.push(Math.floor((baseCount / days) * variation));
        }
        return activity;
    }

    displayServerInfo(serverInfo) {
        // Update server info in the UI if elements exist
        const serverName = document.getElementById('serverName');
        const memberCount = document.getElementById('memberCount');
        const channelCount = document.getElementById('channelCount');
        
        if (serverName) serverName.textContent = serverInfo.name;
        if (memberCount) memberCount.textContent = serverInfo.memberCount.toLocaleString();
        if (channelCount) channelCount.textContent = serverInfo.channelCount;
    }

    generateMockStats(serverId) {
        // Mock data for demonstration
        const mockData = {
            memberActivity: {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                joins: [12, 8, 15, 22, 18, 25, 30],
                leaves: [5, 3, 8, 12, 10, 15, 20]
            },
            topUsers: {
                messages: [
                    { name: 'User1', avatar: '', messages: 1250, rank: 1 },
                    { name: 'User2', avatar: '', messages: 980, rank: 2 },
                    { name: 'User3', avatar: '', messages: 756, rank: 3 },
                    { name: 'User4', avatar: '', messages: 642, rank: 4 },
                    { name: 'User5', avatar: '', messages: 534, rank: 5 }
                ],
                voice: [
                    { name: 'User1', avatar: '', time: '45h 30m', rank: 1 },
                    { name: 'User2', avatar: '', time: '38h 15m', rank: 2 },
                    { name: 'User3', avatar: '', time: '32h 45m', rank: 3 },
                    { name: 'User4', avatar: '', time: '28h 20m', rank: 4 },
                    { name: 'User5', avatar: '', time: '24h 10m', rank: 5 }
                ],
                reactions: [
                    { name: 'User1', avatar: '', reactions: 890, rank: 1 },
                    { name: 'User2', avatar: '', reactions: 654, rank: 2 },
                    { name: 'User3', avatar: '', reactions: 432, rank: 3 },
                    { name: 'User4', avatar: '', reactions: 321, rank: 4 },
                    { name: 'User5', avatar: '', reactions: 234, rank: 5 }
                ]
            },
            channelActivity: {
                labels: ['#general', '#memes', '#voice', '#bot-commands', '#announcements'],
                data: [450, 320, 180, 95, 60]
            },
            serverGrowth: {
                currentMembers: 2845,
                growthRate: 12.5,
                peakActivity: 'Friday 8PM'
            },
            serverHealth: {
                activity: 85,
                engagement: 72,
                response: 95
            }
        };

        this.displayMemberActivity(mockData.memberActivity);
        this.displayTopUsers(mockData.topUsers);
        this.displayChannelActivity(mockData.channelActivity);
        this.displayServerGrowth(mockData.serverGrowth);
        this.displayServerHealth(mockData.serverHealth);
    }

    displayMemberActivity(data) {
        console.log('📊 Displaying member activity:', data);
        
        // Safety check for data structure
        if (!data || !data.joins || !data.leaves) {
            console.error('📊 Invalid member activity data:', data);
            return;
        }
        
        // Update summary stats
        const totalJoins = data.joins.reduce((a, b) => a + b, 0);
        const totalLeaves = data.leaves.reduce((a, b) => a + b, 0);
        const netGrowth = totalJoins - totalLeaves;

        document.getElementById('totalJoins').textContent = totalJoins;
        document.getElementById('totalLeaves').textContent = totalLeaves;
        document.getElementById('netGrowth').textContent = netGrowth;

        // Create chart (mock implementation)
        const canvas = document.getElementById('memberActivityChart');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Simple bar chart implementation
            const maxValue = Math.max(...data.joins, ...data.leaves);
            const barWidth = canvas.width / data.labels.length / 3;
            
            data.labels.forEach((label, index) => {
                const x = (index * canvas.width / data.labels.length) + barWidth;
                const joinHeight = (data.joins[index] / maxValue) * (canvas.height - 40);
                const leaveHeight = (data.leaves[index] / maxValue) * (canvas.height - 40);
                
                // Joins bar (green)
                ctx.fillStyle = '#4CAF50';
                ctx.fillRect(x, canvas.height - joinHeight - 20, barWidth, joinHeight);
                
                // Leaves bar (red)
                ctx.fillStyle = '#f44336';
                ctx.fillRect(x + barWidth, canvas.height - leaveHeight - 20, barWidth, leaveHeight);
            });
        }
    }

    displayTopUsers(data) {
        console.log('📊 Displaying top users:', data);
        
        const activeUsersList = document.getElementById('activeUsersList');
        if (!activeUsersList) return;

        // Safety check for data structure
        if (!data || !data.messages) {
            console.error('📊 Invalid top users data:', data);
            return;
        }

        // Display messages leaderboard by default
        this.displayLeaderboard(data.messages, 'messages');
    }

    displayLeaderboard(users, type) {
        const activeUsersList = document.getElementById('activeUsersList');
        if (!activeUsersList) return;

        activeUsersList.innerHTML = '';
        
        users.forEach((user, index) => {
            const item = document.createElement('div');
            item.className = 'leaderboard-item';
            
            const rankClass = index < 3 ? ['gold', 'silver', 'bronze'][index] : '';
            
            item.innerHTML = `
                <div class="leaderboard-rank ${rankClass}">${user.rank}</div>
                <img src="${user.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                     class="leaderboard-avatar" alt="Avatar">
                <div class="leaderboard-info">
                    <div class="leaderboard-name">${user.name}</div>
                    <div class="leaderboard-xp">
                        ${type === 'messages' ? user.messages + ' messages' : 
                          type === 'voice' ? user.time + ' voice time' : 
                          user.reactions + ' reactions'}
                    </div>
                </div>
            `;
            
            activeUsersList.appendChild(item);
        });
    }

    switchLeaderboardTab(type) {
        // Update tab buttons
        document.querySelectorAll('.leaderboard-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-type="${type}"]`).classList.add('active');

        // Display appropriate leaderboard
        const mockData = {
            messages: [
                { name: 'User1', avatar: '', messages: 1250, rank: 1 },
                { name: 'User2', avatar: '', messages: 980, rank: 2 },
                { name: 'User3', avatar: '', messages: 756, rank: 3 },
                { name: 'User4', avatar: '', messages: 642, rank: 4 },
                { name: 'User5', avatar: '', messages: 534, rank: 5 }
            ],
            voice: [
                { name: 'User1', avatar: '', time: '45h 30m', rank: 1 },
                { name: 'User2', avatar: '', time: '38h 15m', rank: 2 },
                { name: 'User3', avatar: '', time: '32h 45m', rank: 3 },
                { name: 'User4', avatar: '', time: '28h 20m', rank: 4 },
                { name: 'User5', avatar: '', time: '24h 10m', rank: 5 }
            ],
            reactions: [
                { name: 'User1', avatar: '', reactions: 890, rank: 1 },
                { name: 'User2', avatar: '', reactions: 654, rank: 2 },
                { name: 'User3', avatar: '', reactions: 432, rank: 3 },
                { name: 'User4', avatar: '', reactions: 321, rank: 4 },
                { name: 'User5', avatar: '', reactions: 234, rank: 5 }
            ]
        };

        this.displayLeaderboard(mockData[type], type);
    }

    displayChannelActivity(data) {
        console.log('📊 Displaying channel activity:', data);
        
        // Safety check for data structure
        if (!data || !data.labels || !data.data) {
            console.error('📊 Invalid channel activity data:', data);
            return;
        }
        
        // Update channel stats
        document.getElementById('totalChannels').textContent = data.labels.length;
        document.getElementById('totalMessages').textContent = data.data.reduce((a, b) => a + b, 0);
        document.getElementById('mostActiveChannel').textContent = data.labels[0];

        // Create chart (mock implementation)
        const canvas = document.getElementById('channelActivityChart');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            const maxValue = Math.max(...data.data);
            const barWidth = canvas.width / data.labels.length;
            
            data.labels.forEach((label, index) => {
                const x = index * barWidth;
                const height = (data.data[index] / maxValue) * (canvas.height - 40);
                
                ctx.fillStyle = `hsl(${index * 60}, 70%, 50%)`;
                ctx.fillRect(x + 10, canvas.height - height - 20, barWidth - 20, height);
            });
        }
    }

    displayServerGrowth(data) {
        document.getElementById('currentMembers').textContent = data.currentMembers.toLocaleString();
        document.getElementById('growthRate').textContent = data.growthRate + '%';
        document.getElementById('peakActivity').textContent = data.peakActivity;

        // Create growth chart (mock implementation)
        const canvas = document.getElementById('growthChart');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Simple line chart
            ctx.strokeStyle = '#4CAF50';
            ctx.lineWidth = 3;
            ctx.beginPath();
            
            const points = 7;
            for (let i = 0; i < points; i++) {
                const x = (i / (points - 1)) * canvas.width;
                const y = canvas.height - 20 - (Math.random() * (canvas.height - 40));
                
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        }
    }

    displayServerHealth(data) {
        // Update health bars
        document.getElementById('activityBar').style.width = data.activity + '%';
        document.getElementById('engagementBar').style.width = data.engagement + '%';
        document.getElementById('responseBar').style.width = data.response + '%';

        // Update health text
        document.getElementById('activityLevel').textContent = this.getHealthLevel(data.activity);
        document.getElementById('engagementLevel').textContent = this.getHealthLevel(data.engagement);
        document.getElementById('responseTime').textContent = this.getHealthLevel(data.response);
    }

    getHealthLevel(value) {
        if (value >= 80) return 'Excellent';
        if (value >= 60) return 'Good';
        if (value >= 40) return 'Fair';
        return 'Poor';
    }

    // Message Commands Methods
    populateCommandsServerDropdown() {
        const commandsServerSelect = document.getElementById('commandsServerSelect');
        if (!commandsServerSelect) return;

        commandsServerSelect.innerHTML = '<option value="">Select a server...</option>';
        
        if (this.guilds && this.guilds.length > 0) {
            this.guilds.forEach(guild => {
                const option = document.createElement('option');
                option.value = guild.id;
                option.textContent = guild.name;
                commandsServerSelect.appendChild(option);
            });
        }
    }

    onCommandsServerChange() {
        const commandsServerSelect = document.getElementById('commandsServerSelect');
        const addCommandBtn = document.getElementById('addCommandBtn');
        
        if (commandsServerSelect && addCommandBtn) {
            const selectedServerId = commandsServerSelect.value;
            addCommandBtn.disabled = !selectedServerId;
            
            if (selectedServerId) {
                this.loadCommandsForServer(selectedServerId);
            } else {
                this.clearCommandsList();
            }
        }
    }

    async loadCommandsForServer(serverId) {
        try {
            const response = await fetch('/api/get-commands', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({ guildId: serverId })
            });

            if (response.ok) {
                const data = await response.json();
                this.displayCommands(data.commands || []);
            } else {
                this.displayCommands([]);
            }
        } catch (error) {
            console.error('Error loading commands:', error);
            this.displayCommands([]);
        }
    }

    displayCommands(commands) {
        const commandsList = document.getElementById('commandsList');
        if (!commandsList) return;

        if (commands.length === 0) {
            commandsList.innerHTML = `
                <div class="no-commands">
                    <i class="fas fa-terminal"></i>
                    <p>No commands created yet. Click "Add New Command" to get started.</p>
                </div>
            `;
            return;
        }

        commandsList.innerHTML = commands.map(command => `
            <div class="command-item">
                <div class="command-info">
                    <h4>!${command.trigger}</h4>
                    <p>Type: ${command.type}</p>
                    <p>Cooldown: ${command.cooldown}s</p>
                </div>
                <div class="command-actions">
                    <button class="btn btn-sm btn-secondary edit-command" data-command-id="${command.id}">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn btn-sm btn-danger delete-command" data-command-id="${command.id}">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        `).join('');

        // Add event listeners for command actions
        commandsList.querySelectorAll('.edit-command').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const commandId = e.target.closest('.edit-command').dataset.commandId;
                this.editCommand(commandId, commands);
            });
        });

        commandsList.querySelectorAll('.delete-command').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const commandId = e.target.closest('.delete-command').dataset.commandId;
                this.deleteCommand(commandId);
            });
        });
    }

    clearCommandsList() {
        const commandsList = document.getElementById('commandsList');
        if (commandsList) {
            commandsList.innerHTML = `
                <div class="no-commands">
                    <i class="fas fa-terminal"></i>
                    <p>No commands created yet. Select a server to get started.</p>
                </div>
            `;
        }
    }

    editCommand(commandId, commands) {
        const command = commands.find(cmd => cmd.id === commandId);
        if (!command) return;

        // Populate modal with command data
        document.getElementById('commandTrigger').value = command.trigger;
        document.getElementById('commandType').value = command.type;
        document.getElementById('commandCooldown').value = command.cooldown;
        
        if (command.type === 'custom') {
            document.getElementById('commandResponse').value = command.response || '';
            document.getElementById('customResponseGroup').style.display = 'block';
        } else {
            document.getElementById('customResponseGroup').style.display = 'none';
        }

        // Update modal title
        document.getElementById('commandModalTitle').textContent = 'Edit Command';
        
        // Store command ID for update
        document.getElementById('commandModal').dataset.commandId = commandId;
        
        // Show modal
        document.getElementById('commandModal').style.display = 'flex';
    }

    async deleteCommand(commandId) {
        if (!confirm('Are you sure you want to delete this command?')) return;

        try {
            const response = await fetch('/api/delete-command', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({ commandId })
            });

            if (response.ok) {
                this.showNotification('Command deleted successfully!', 'success');
                const commandsServerSelect = document.getElementById('commandsServerSelect');
                if (commandsServerSelect.value) {
                    this.loadCommandsForServer(commandsServerSelect.value);
                }
            } else {
                this.showNotification('Failed to delete command', 'error');
            }
        } catch (error) {
            console.error('Error deleting command:', error);
            this.showNotification('Failed to delete command', 'error');
        }
    }

    setupCommandsEventListeners() {
        // Commands server selection
        const commandsServerSelect = document.getElementById('commandsServerSelect');
        if (commandsServerSelect) {
            commandsServerSelect.addEventListener('change', () => {
                this.onCommandsServerChange();
            });
        }

        // Add command button
        const addCommandBtn = document.getElementById('addCommandBtn');
        if (addCommandBtn) {
            addCommandBtn.addEventListener('click', () => {
                this.openCommandModal();
            });
        }

        // Command type change
        const commandType = document.getElementById('commandType');
        if (commandType) {
            commandType.addEventListener('change', (e) => {
                const customResponseGroup = document.getElementById('customResponseGroup');
                if (e.target.value === 'custom') {
                    customResponseGroup.style.display = 'block';
                } else {
                    customResponseGroup.style.display = 'none';
                }
            });
        }

        // Modal controls
        const commandModal = document.getElementById('commandModal');
        const closeCommandModal = document.getElementById('closeCommandModal');
        const cancelCommandBtn = document.getElementById('cancelCommandBtn');
        const saveCommandBtn = document.getElementById('saveCommandBtn');

        if (closeCommandModal) {
            closeCommandModal.addEventListener('click', () => {
                this.closeCommandModal();
            });
        }

        if (cancelCommandBtn) {
            cancelCommandBtn.addEventListener('click', () => {
                this.closeCommandModal();
            });
        }

        if (saveCommandBtn) {
            saveCommandBtn.addEventListener('click', () => {
                this.saveCommand();
            });
        }

        // Close modal on outside click
        if (commandModal) {
            commandModal.addEventListener('click', (e) => {
                if (e.target === commandModal) {
                    this.closeCommandModal();
                }
            });
        }
    }

    openCommandModal() {
        // Reset form
        document.getElementById('commandTrigger').value = '';
        document.getElementById('commandType').value = 'active';
        document.getElementById('commandResponse').value = '';
        document.getElementById('commandCooldown').value = '5';
        document.getElementById('customResponseGroup').style.display = 'none';
        
        // Update modal title
        document.getElementById('commandModalTitle').textContent = 'Create New Command';
        
        // Remove command ID
        delete document.getElementById('commandModal').dataset.commandId;
        
        // Show modal
        document.getElementById('commandModal').style.display = 'flex';
    }

    closeCommandModal() {
        document.getElementById('commandModal').style.display = 'none';
    }

    async saveCommand() {
        const trigger = document.getElementById('commandTrigger').value.trim();
        const type = document.getElementById('commandType').value;
        const response = document.getElementById('commandResponse').value.trim();
        const cooldown = parseInt(document.getElementById('commandCooldown').value);
        const commandId = document.getElementById('commandModal').dataset.commandId;

        if (!trigger) {
            this.showNotification('Command trigger is required', 'error');
            return;
        }

        if (type === 'custom' && !response) {
            this.showNotification('Custom response is required', 'error');
            return;
        }

        try {
            const commandData = {
                trigger,
                type,
                cooldown,
                guildId: document.getElementById('commandsServerSelect').value
            };

            if (type === 'custom') {
                commandData.response = response;
            }

            const url = commandId ? '/api/update-command' : '/api/create-command';
            if (commandId) {
                commandData.commandId = commandId;
            }

            const fetchResponse = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify(commandData)
            });

            if (fetchResponse.ok) {
                this.showNotification('Command saved successfully!', 'success');
                this.closeCommandModal();
                const commandsServerSelect = document.getElementById('commandsServerSelect');
                if (commandsServerSelect.value) {
                    this.loadCommandsForServer(commandsServerSelect.value);
                }
            } else {
                const error = await fetchResponse.json();
                this.showNotification(error.error || 'Failed to save command', 'error');
            }
        } catch (error) {
            console.error('Error saving command:', error);
            this.showNotification('Failed to save command', 'error');
        }
    }

    // Authentication Methods
    async authenticateAccount() {
        const token = document.getElementById('accountToken').value.trim();
        
        if (!token) {
            this.addTerminalLog('❌ Please enter a Discord account token', 'error');
            return;
        }

        this.addTerminalLog('🔄 Starting account authentication...', 'info');
        this.addTerminalLog(`🔑 Token: ${token.substring(0, 10)}...`, 'info');

        try {
            const response = await fetch('/api/auth/account', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({ token })
            });

            const data = await response.json();

            if (data.success) {
                this.addTerminalLog('✅ Account authentication successful!', 'success');
                this.addTerminalLog(`👤 User: ${data.user.username}#${data.user.discriminator}`, 'success');
                this.addTerminalLog(`🆔 ID: ${data.user.id}`, 'success');
                
                // Store account info
                sessionStorage.setItem('accountToken', token);
                sessionStorage.setItem('accountUser', JSON.stringify(data.user));
                
                // Show auth status
                this.showAuthStatus(data.user);
                
                // Update UI
                document.getElementById('authenticateAccountBtn').style.display = 'none';
                document.getElementById('clearAuthBtn').style.display = 'inline-flex';
                document.getElementById('accountToken').value = '';
                
            } else {
                this.addTerminalLog(`❌ Authentication failed: ${data.error}`, 'error');
            }
        } catch (error) {
            this.addTerminalLog(`❌ Authentication error: ${error.message}`, 'error');
            console.error('Authentication error:', error);
        }
    }

        clearAuthentication() {
            this.addTerminalLog('🔄 Clearing authentication...', 'info');
            
            // Clear stored data
            sessionStorage.removeItem('accountToken');
            sessionStorage.removeItem('accountUser');
            
            // Hide auth status
            document.getElementById('authStatus').style.display = 'none';
            
            // Hide user lookup section
            const userLookupSection = document.getElementById('userLookupSection');
            if (userLookupSection) {
                userLookupSection.style.display = 'none';
            }
            
            // Reset UI
            document.getElementById('authenticateAccountBtn').style.display = 'inline-flex';
            document.getElementById('clearAuthBtn').style.display = 'none';
            document.getElementById('accountToken').value = '';
            
            this.addTerminalLog('✅ Authentication cleared', 'success');
        }

    toggleTokenVisibility(show) {
        const tokenInput = document.getElementById('accountToken');
        tokenInput.type = show ? 'text' : 'password';
    }

    async testAccountConnection() {
        const accountToken = sessionStorage.getItem('accountToken');
        
        if (!accountToken) {
            this.addTerminalLog('❌ No account token found. Please authenticate first.', 'error');
            return;
        }

        this.addTerminalLog('🔄 Testing account connection...', 'info');

        try {
            const response = await fetch('/api/auth/test-connection', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({ token: accountToken })
            });

            const data = await response.json();

            if (data.success) {
                this.addTerminalLog('✅ Connection test successful!', 'success');
                this.addTerminalLog(`📊 Status: ${data.status}`, 'success');
            } else {
                this.addTerminalLog(`❌ Connection test failed: ${data.error}`, 'error');
            }
        } catch (error) {
            this.addTerminalLog(`❌ Connection test error: ${error.message}`, 'error');
        }
    }

    async getAccountUserInfo() {
        const accountToken = sessionStorage.getItem('accountToken');
        
        if (!accountToken) {
            this.addTerminalLog('❌ No account token found. Please authenticate first.', 'error');
            return;
        }

        this.addTerminalLog('🔄 Fetching account user info...', 'info');

        try {
            const response = await fetch('/api/auth/user-info', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.botToken}`,
                    'X-Account-Token': accountToken
                }
            });

            const data = await response.json();

            if (data.success) {
                this.addTerminalLog('✅ User info retrieved successfully!', 'success');
                this.addTerminalLog(`👤 Username: ${data.user.username}#${data.user.discriminator}`, 'success');
                this.addTerminalLog(`🆔 ID: ${data.user.id}`, 'success');
                this.addTerminalLog(`📧 Email: ${data.user.email || 'Not available'}`, 'success');
                this.addTerminalLog(`📱 Phone: ${data.user.phone || 'Not available'}`, 'success');
                this.addTerminalLog(`✅ Verified: ${data.user.verified ? 'Yes' : 'No'}`, 'success');
                
                // Update auth status display
                this.showAuthStatus(data.user);
            } else {
                this.addTerminalLog(`❌ Failed to get user info: ${data.error}`, 'error');
            }
        } catch (error) {
            this.addTerminalLog(`❌ User info error: ${error.message}`, 'error');
        }
    }

        showAuthStatus(user) {
            const authStatus = document.getElementById('authStatus');
            const authUserAvatar = document.getElementById('authUserAvatar');
            const authUserName = document.getElementById('authUserName');
            const authUserTag = document.getElementById('authUserTag');
            const authUserId = document.getElementById('authUserId');

            // Update user info
            authUserAvatar.src = user.avatar ? 
                `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` :
                `https://cdn.discordapp.com/embed/avatars/${user.discriminator % 5}.png`;
            
            authUserName.textContent = user.username;
            authUserTag.textContent = `#${user.discriminator}`;
            authUserId.textContent = `ID: ${user.id}`;

            // Show the status section
            authStatus.style.display = 'block';
            
            // Show the user lookup section
            const userLookupSection = document.getElementById('userLookupSection');
            if (userLookupSection) {
                userLookupSection.style.display = 'block';
            }
        }

    addTerminalLog(message, type = 'info') {
        const terminal = document.getElementById('authTerminal');
        const timestamp = new Date().toLocaleTimeString();
        
        const logLine = document.createElement('div');
        logLine.className = 'terminal-line';
        
        const prompt = document.createElement('span');
        prompt.className = 'terminal-prompt';
        prompt.textContent = '$';
        
        const text = document.createElement('span');
        text.className = `terminal-text ${type}`;
        text.textContent = `[${timestamp}] ${message}`;
        
        logLine.appendChild(prompt);
        logLine.appendChild(text);
        terminal.appendChild(logLine);
        
        // Auto-scroll to bottom
        terminal.scrollTop = terminal.scrollHeight;
        
        // Limit terminal lines to prevent memory issues
        const lines = terminal.querySelectorAll('.terminal-line');
        if (lines.length > 100) {
            lines[0].remove();
        }
    }

    addPresenceUpdateToActivity(message) {
        const activityLog = document.getElementById('activityLog');
        if (!activityLog) return;

        // Parse the presence update message
        // Format: "📊 Presence update: 1424399877068296195 is now online"
        const match = message.match(/📊 Presence update: (\d+) is now (\w+)/);
        if (!match) return;

        const userId = match[1];
        const status = match[2];

        console.log('🔍 Processing presence update for user:', userId, 'status:', status);
        console.log('📊 Available guilds:', this.guilds.length);

        // Create activity item
        const activityItem = document.createElement('div');
        activityItem.className = 'activity-item';

        // Get status icon
        let statusIcon = 'fas fa-circle';
        let statusColor = '#43b581'; // green for online
        let statusText = 'came online';

        switch (status) {
            case 'online':
                statusIcon = 'fas fa-circle';
                statusColor = '#43b581';
                statusText = 'came online';
                break;
            case 'offline':
                statusIcon = 'fas fa-circle';
                statusColor = '#72767d';
                statusText = 'went offline';
                break;
            case 'idle':
                statusIcon = 'fas fa-moon';
                statusColor = '#faa61a';
                statusText = 'is now idle';
                break;
            case 'dnd':
                statusIcon = 'fas fa-times-circle';
                statusColor = '#f04747';
                statusText = 'is do not disturb';
                break;
        }

        // Try to get user info from the guilds data
        let userName = `User ${userId.substring(0, 8)}...`;
        let userAvatar = `https://cdn.discordapp.com/embed/avatars/0.png`;

        // Look for user in guilds data - try different data structures
        console.log('🔍 Looking for user in guilds...');
        for (const guild of this.guilds) {
            console.log('📊 Guild:', guild.name, 'Members:', guild.members ? guild.members.length : 'No members');
            
            if (guild.members) {
                // Try different member data structures
                let member = null;
                
                // Try direct member lookup
                member = guild.members.find(m => m.user && m.user.id === userId);
                console.log('🔍 Direct member lookup result:', member ? 'Found' : 'Not found');
                
                // Try nested member lookup
                if (!member) {
                    member = guild.members.find(m => m.id === userId);
                    console.log('🔍 Nested member lookup result:', member ? 'Found' : 'Not found');
                }
                
                // Try in users array
                if (!member && guild.users) {
                    member = guild.users.find(u => u.id === userId);
                    console.log('🔍 Users array lookup result:', member ? 'Found' : 'Not found');
                }
                
                if (member) {
                    console.log('✅ Found member:', member);
                    // Extract user info from different possible structures
                    const user = member.user || member;
                    if (user.username) {
                        userName = user.username;
                        userAvatar = user.avatar ? 
                            `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=32` :
                            `https://cdn.discordapp.com/embed/avatars/${user.discriminator % 5}.png`;
                        console.log('✅ Using user info:', userName, userAvatar);
                        break;
                    }
                }
            }
        }

        activityItem.setAttribute('data-user-id', userId);
        
        // Always try to get user info from Discord API as fallback/update
        this.fetchUserInfo(userId).then(userInfo => {
            console.log('🔍 Fetched user info for', userId, ':', userInfo);
            if (userInfo) {
                // Update the activity item with real user info
                const activityItem = document.querySelector(`[data-user-id="${userId}"]`);
                console.log('🔍 Looking for activity item with data-user-id:', userId, 'Found:', activityItem);
                if (activityItem) {
                    const userNameEl = activityItem.querySelector('.activity-user');
                    const avatarEl = activityItem.querySelector('.user-avatar-small');
                    console.log('🔍 Found elements - userNameEl:', userNameEl, 'avatarEl:', avatarEl);
                    if (userNameEl) {
                        console.log('✅ Updating username from', userNameEl.textContent, 'to', userInfo.username);
                        userNameEl.textContent = userInfo.username;
                        
                        // Force the username to be visible with aggressive CSS
                        userNameEl.style.cssText = `
                            color: #f0f6fc !important;
                            font-size: 16px !important;
                            font-weight: bold !important;
                            display: block !important;
                            visibility: visible !important;
                            opacity: 1 !important;
                            position: relative !important;
                            z-index: 9999 !important;
                            margin: 0 !important;
                            padding: 4px !important;
                            line-height: 1.4 !important;
                            background: rgba(0,0,0,0.3) !important;
                            border-radius: 4px !important;
                        `;
                    }
                    if (avatarEl) {
                        console.log('✅ Updating avatar from', avatarEl.src, 'to', userInfo.avatar);
                        avatarEl.src = userInfo.avatar;
                    }
                }
            }
        }).catch(error => {
            console.error('❌ Error fetching user info:', error);
        });
        activityItem.innerHTML = `
            <div class="activity-user-avatar">
                <img src="${userAvatar}" alt="${userName}" class="user-avatar-small">
            </div>
            <div class="activity-content">
                <div class="activity-text">
                    <span class="activity-user">${userName}</span>
                    <span class="activity-action">${statusText}</span>
                </div>
                <div class="activity-time">${new Date().toLocaleTimeString()}</div>
            </div>
            <div class="activity-status">
                <i class="${statusIcon}" style="color: ${statusColor}"></i>
            </div>
        `;

        // Add to the top of the activity log
        activityLog.insertBefore(activityItem, activityLog.firstChild);

        // Keep only last 20 activity items
        const items = activityLog.querySelectorAll('.activity-item');
        if (items.length > 20) {
            items[items.length - 1].remove();
        }
    }

    async fetchUserInfo(userId) {
        try {
            const response = await fetch(`/api/user/${userId}`, {
                headers: {
                    'Authorization': `Bearer ${this.botToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    return {
                        username: data.user.username,
                        avatar: data.user.avatar
                    };
                }
            }
        } catch (error) {
            console.error('Failed to fetch user info:', error);
        }
        return null;
    }

    // User Lookup Methods
    updateLookupInput(type) {
        const lookupLabel = document.getElementById('lookupLabel');
        const lookupInput = document.getElementById('lookupInput');
        
        if (type === 'id') {
            lookupLabel.textContent = 'User ID:';
            lookupInput.placeholder = 'Enter user ID (e.g., 123456789012345678)';
        } else if (type === 'username') {
            lookupLabel.textContent = 'Username:';
            lookupInput.placeholder = 'Enter username (e.g., username#1234)';
        }
    }

    async lookupUser() {
        const lookupType = document.getElementById('lookupType').value;
        const lookupInput = document.getElementById('lookupInput').value.trim();
        
        if (!lookupInput) {
            this.addTerminalLog('❌ Please enter a user ID or username', 'error');
            return;
        }

        // Check if user is authenticated
        const accountToken = sessionStorage.getItem('accountToken');
        if (!accountToken) {
            this.addTerminalLog('❌ Please authenticate with your account token first', 'error');
            return;
        }

        this.addTerminalLog(`🔍 Looking up user: ${lookupInput} (${lookupType})`, 'info');

        try {
            let response;
            if (lookupType === 'id') {
                // Lookup by ID using user's account token
                response = await fetch(`/api/user-account/${lookupInput}`, {
                    headers: {
                        'Authorization': `Bearer ${this.botToken}`,
                        'X-Account-Token': accountToken,
                        'Content-Type': 'application/json'
                    }
                });
            } else {
                // Lookup by username using user's account token
                response = await fetch('/api/lookup-user-account', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.botToken}`,
                        'X-Account-Token': accountToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username: lookupInput })
                });
            }

            const data = await response.json();

            if (data.success) {
                this.addTerminalLog('✅ User found successfully!', 'success');
                this.addTerminalLog(`👤 Username: ${data.user.username}#${data.user.discriminator}`, 'success');
                this.addTerminalLog(`🆔 ID: ${data.user.id}`, 'success');
                this.addTerminalLog(`📅 Created: ${new Date(data.user.created_at).toLocaleDateString()}`, 'success');
                this.addTerminalLog(`✅ Verified: ${data.user.verified ? 'Yes' : 'No'}`, 'success');
                
                // Display user info in the lookup result section
                this.displayLookupResult(data.user);
            } else {
                this.addTerminalLog(`❌ User not found: ${data.error}`, 'error');
                this.hideLookupResult();
            }
        } catch (error) {
            this.addTerminalLog(`❌ Lookup error: ${error.message}`, 'error');
            this.hideLookupResult();
        }
    }

    displayLookupResult(user) {
        const lookupResult = document.getElementById('lookupResult');
        const lookupUserAvatar = document.getElementById('lookupUserAvatar');
        const lookupUserName = document.getElementById('lookupUserName');
        const lookupUserTag = document.getElementById('lookupUserTag');
        const lookupUserId = document.getElementById('lookupUserId');
        const lookupUserCreated = document.getElementById('lookupUserCreated');
        const lookupUserVerified = document.getElementById('lookupUserVerified');
        const lookupUserFlags = document.getElementById('lookupUserFlags');

        // Update user info
        lookupUserAvatar.src = user.avatar ? 
            `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` :
            `https://cdn.discordapp.com/embed/avatars/${user.discriminator % 5}.png`;
        
        lookupUserName.textContent = user.username;
        lookupUserTag.textContent = `#${user.discriminator}`;
        lookupUserId.textContent = `ID: ${user.id}`;
        lookupUserCreated.textContent = `Account Created: ${new Date(user.created_at).toLocaleDateString()}`;
        lookupUserVerified.textContent = `Verified: ${user.verified ? 'Yes' : 'No'}`;
        lookupUserFlags.textContent = `Flags: ${user.public_flags || 'None'}`;

        // Show the result section
        lookupResult.style.display = 'block';
    }

    hideLookupResult() {
        const lookupResult = document.getElementById('lookupResult');
        lookupResult.style.display = 'none';
    }

    // Music Player Functions
    setupMusicPlayer() {
        console.log('🎵 Setting up music player...');
        
        // Connect Lavalink button
        const connectBtn = document.getElementById('connectLavalinkBtn');
        if (connectBtn) {
            connectBtn.addEventListener('click', () => this.connectLavalink());
        }

        // Search music button
        const searchBtn = document.getElementById('searchMusicBtn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.searchMusic());
        }

        // Music controls
        const playPauseBtn = document.getElementById('playPauseBtn');
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        }

        const stopBtn = document.getElementById('stopBtn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.stopMusic());
        }

        const nextBtn = document.getElementById('nextTrackBtn');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.nextTrack());
        }

        const prevBtn = document.getElementById('prevTrackBtn');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.prevTrack());
        }

        const clearQueueBtn = document.getElementById('clearQueueBtn');
        if (clearQueueBtn) {
            clearQueueBtn.addEventListener('click', () => this.clearQueue());
        }

        // Volume control
        const volumeSlider = document.getElementById('volumeSlider');
        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));
        }

        // Search input enter key
        const searchInput = document.getElementById('musicSearch');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.searchMusic();
                }
            });
        }
    }

    async connectLavalink() {
        const host = document.getElementById('lavalinkHost').value;
        const port = document.getElementById('lavalinkPort').value;
        const password = document.getElementById('lavalinkPassword').value;
        const name = document.getElementById('lavalinkName').value;
        const secure = document.getElementById('lavalinkSecure').checked;
        const userId = document.getElementById('musicUserId').value;

        if (!host || !port || !password || !name || !userId) {
            this.showStatus('Please fill in all Lavalink configuration fields', 'error');
            return;
        }

        try {
            const response = await fetch('/api/music/connect-lavalink', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    host,
                    port: parseInt(port),
                    password,
                    name,
                    secure,
                    userId
                })
            });

            const data = await response.json();

            if (data.success) {
                this.musicPlayer.lavalinkConfig = { host, port, password, name, secure };
                this.musicPlayer.isConnected = true;
                this.showStatus('✅ Connected to Lavalink successfully!', 'success');
                this.updateLavalinkStatus('Connected');
            } else {
                this.showStatus(`❌ Failed to connect: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Lavalink connection error:', error);
            this.showStatus('❌ Connection failed', 'error');
        }
    }

    async searchMusic() {
        const query = document.getElementById('musicSearch').value.trim();
        const guildId = document.getElementById('musicServerSelect').value;
        const userId = document.getElementById('musicUserId').value;

        if (!query) {
            this.showStatus('Please enter a search query', 'error');
            return;
        }

        if (!guildId) {
            this.showStatus('Please select a server first', 'error');
            return;
        }

        if (!userId) {
            this.showStatus('Please enter your user ID', 'error');
            return;
        }

        try {
            const response = await fetch('/api/music/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query,
                    userId,
                    guildId
                })
            });

            const data = await response.json();

            if (data.success) {
                this.displaySearchResults(data.results);
            } else {
                this.showStatus(`❌ Search failed: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Music search error:', error);
            this.showStatus('❌ Search failed', 'error');
        }
    }

    displaySearchResults(results) {
        const searchResultsCard = document.getElementById('searchResultsCard');
        const searchResults = document.getElementById('searchResults');
        
        if (results.length === 0) {
            searchResults.innerHTML = '<div class="no-tracks">No results found</div>';
        } else {
            searchResults.innerHTML = results.map((track, index) => `
                <div class="search-result-item" data-index="${index}">
                    <img src="${track.thumbnail}" alt="Track Thumbnail" class="search-result-thumbnail">
                    <div class="search-result-info">
                        <h6>${track.title}</h6>
                        <p>${track.author} • ${this.formatDuration(track.duration)}</p>
                    </div>
                    <div class="search-result-actions">
                        <button class="btn btn-primary btn-sm" onclick="dashboard.playTrack('${track.url}', '${track.title}', '${track.author}', '${track.thumbnail}')">
                            <i class="fas fa-play"></i> Play
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="dashboard.addToQueue('${track.url}', '${track.title}', '${track.author}', '${track.thumbnail}')">
                            <i class="fas fa-plus"></i> Add to Queue
                        </button>
                    </div>
                </div>
            `).join('');
        }
        
        searchResultsCard.style.display = 'block';
    }

    async playTrack(url, title, author, thumbnail) {
        const guildId = document.getElementById('musicServerSelect').value;
        const userId = document.getElementById('musicUserId').value;

        if (!guildId || !userId) {
            this.showStatus('Please select a server and enter your user ID', 'error');
            return;
        }

        try {
            const response = await fetch('/api/music/play', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    trackUrl: url,
                    userId,
                    guildId,
                    voiceChannelId: 'default' // This would need to be selected from available voice channels
                })
            });

            const data = await response.json();

            if (data.success) {
                this.musicPlayer.currentTrack = { url, title, author, thumbnail };
                this.musicPlayer.isPlaying = true;
                this.updatePlayerDisplay();
                this.showStatus(`🎵 Now playing: ${title}`, 'success');
            } else {
                this.showStatus(`❌ Failed to play track: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Play track error:', error);
            this.showStatus('❌ Failed to play track', 'error');
        }
    }

    addToQueue(url, title, author, thumbnail) {
        this.musicPlayer.queue.push({ url, title, author, thumbnail });
        this.updateQueueDisplay();
        this.showStatus(`➕ Added to queue: ${title}`, 'success');
    }

    async togglePlayPause() {
        const guildId = document.getElementById('musicServerSelect').value;
        
        if (!guildId) {
            this.showStatus('Please select a server first', 'error');
            return;
        }

        try {
            const endpoint = this.musicPlayer.isPlaying ? '/api/music/pause' : '/api/music/play';
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ guildId })
            });

            const data = await response.json();

            if (data.success) {
                this.musicPlayer.isPlaying = !this.musicPlayer.isPlaying;
                this.updatePlayerDisplay();
                this.showStatus(this.musicPlayer.isPlaying ? '▶️ Resumed playback' : '⏸️ Paused playback', 'success');
            } else {
                this.showStatus(`❌ Failed to ${this.musicPlayer.isPlaying ? 'pause' : 'play'}: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Play/Pause error:', error);
            this.showStatus('❌ Failed to control playback', 'error');
        }
    }

    async stopMusic() {
        const guildId = document.getElementById('musicServerSelect').value;
        
        if (!guildId) {
            this.showStatus('Please select a server first', 'error');
            return;
        }

        try {
            const response = await fetch('/api/music/stop', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ guildId })
            });

            const data = await response.json();

            if (data.success) {
                this.musicPlayer.isPlaying = false;
                this.musicPlayer.currentTrack = null;
                this.updatePlayerDisplay();
                this.showStatus('⏹️ Stopped playback', 'success');
            } else {
                this.showStatus(`❌ Failed to stop: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Stop music error:', error);
            this.showStatus('❌ Failed to stop music', 'error');
        }
    }

    nextTrack() {
        if (this.musicPlayer.queue.length > 0) {
            const nextTrack = this.musicPlayer.queue.shift();
            this.playTrack(nextTrack.url, nextTrack.title, nextTrack.author, nextTrack.thumbnail);
            this.updateQueueDisplay();
        } else {
            this.showStatus('No tracks in queue', 'info');
        }
    }

    prevTrack() {
        this.showStatus('Previous track functionality not implemented yet', 'info');
    }

    clearQueue() {
        this.musicPlayer.queue = [];
        this.updateQueueDisplay();
        this.showStatus('🗑️ Queue cleared', 'success');
    }

    setVolume(volume) {
        this.musicPlayer.volume = parseInt(volume);
        document.getElementById('volumeDisplay').textContent = `${volume}%`;
        // This would need to be implemented with actual Lavalink volume control
    }

    updatePlayerDisplay() {
        const musicPlayer = document.getElementById('musicPlayer');
        const trackTitle = document.getElementById('trackTitle');
        const trackAuthor = document.getElementById('trackAuthor');
        const trackThumbnail = document.getElementById('trackThumbnail');
        const playPauseBtn = document.getElementById('playPauseBtn');

        if (this.musicPlayer.currentTrack) {
            musicPlayer.style.display = 'block';
            trackTitle.textContent = this.musicPlayer.currentTrack.title;
            trackAuthor.textContent = this.musicPlayer.currentTrack.author;
            trackThumbnail.src = this.musicPlayer.currentTrack.thumbnail;
            playPauseBtn.innerHTML = this.musicPlayer.isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
        } else {
            musicPlayer.style.display = 'none';
        }
    }

    updateQueueDisplay() {
        const queueList = document.getElementById('queueList');
        const queueCount = document.getElementById('queueCount');
        
        queueCount.textContent = this.musicPlayer.queue.length;
        
        if (this.musicPlayer.queue.length === 0) {
            queueList.innerHTML = '<div class="no-tracks">No tracks in queue</div>';
        } else {
            queueList.innerHTML = this.musicPlayer.queue.map((track, index) => `
                <div class="queue-item">
                    <img src="${track.thumbnail}" alt="Track Thumbnail">
                    <div class="queue-item-info">
                        <h6>${track.title}</h6>
                        <p>${track.author}</p>
                    </div>
                    <div class="queue-item-actions">
                        <button class="btn btn-danger btn-sm" onclick="dashboard.removeFromQueue(${index})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        }
    }

    removeFromQueue(index) {
        this.musicPlayer.queue.splice(index, 1);
        this.updateQueueDisplay();
    }

    updateLavalinkStatus(status) {
        const statusElement = document.getElementById('lavalinkStatus');
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.className = `status-value ${status === 'Connected' ? 'connected' : 'disconnected'}`;
        }
    }

    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }


}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
    new DiscordBotDashboard();
});
