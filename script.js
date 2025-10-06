document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const statusDiv = document.getElementById('status');
    const botTokenInput = document.getElementById('botToken');
    const loginBtn = document.querySelector('.login-btn');

    // Show status message
    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = `status-message ${type}`;
        statusDiv.style.display = 'block';
    }

    // Hide status message
    function hideStatus() {
        statusDiv.style.display = 'none';
    }

    // Show loading state
    function showLoading() {
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<div class="loading-spinner"></div> Authenticating...';
    }

    // Hide loading state
    function hideLoading() {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login with Bot Token';
    }

    // Validate bot token format
    function validateToken(token) {
        // Discord bot tokens are typically 70+ characters and contain letters, numbers, and special characters
        if (!token || token.length < 50) {
            return false;
        }
        return true;
    }

    // Handle form submission
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const botToken = botTokenInput.value.trim();
        
        // Validate token
        if (!validateToken(botToken)) {
            showStatus('Please enter a valid Discord bot token', 'error');
            return;
        }

        showLoading();
        hideStatus();

        try {
            console.log('Sending token to backend...');
            
            // Send token to backend for verification
            const response = await fetch('/api/verify-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ token: botToken })
            });

            console.log('Response status:', response.status);
            const data = await response.json();
            console.log('Response data:', data);

            if (response.ok) {
                showStatus(`Successfully authenticated as ${data.bot.username}#${data.bot.discriminator}`, 'success');
                
                // Store token in sessionStorage for future use
                sessionStorage.setItem('discordBotToken', botToken);
                sessionStorage.setItem('botInfo', JSON.stringify(data.bot));
                
                // Redirect to dashboard after successful login
                console.log('Redirecting to dashboard...');
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, 2000);
                
            } else {
                showStatus(data.error || 'Invalid bot token. Please check your token and try again.', 'error');
            }
        } catch (error) {
            console.error('Login error:', error);
            showStatus('Connection error. Please check your internet connection and try again.', 'error');
        } finally {
            hideLoading();
        }
    });

    // Check if user is already logged in
    function checkExistingLogin() {
        const storedToken = sessionStorage.getItem('discordBotToken');
        const storedBotInfo = sessionStorage.getItem('botInfo');
        
        if (storedToken && storedBotInfo) {
            try {
                const botInfo = JSON.parse(storedBotInfo);
                showStatus(`Already logged in as ${botInfo.username}#${botInfo.discriminator}`, 'success');
                botTokenInput.value = storedToken;
            } catch (error) {
                // Clear invalid stored data
                sessionStorage.removeItem('discordBotToken');
                sessionStorage.removeItem('botInfo');
            }
        }
    }

    // Add logout functionality
    function addLogoutButton() {
        const logoutBtn = document.createElement('button');
        logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
        logoutBtn.className = 'logout-btn';
        logoutBtn.style.cssText = `
            width: 100%;
            padding: 10px;
            background: #dc3545;
            color: white;
            border: none;
            border-radius: 8px;
            margin-top: 10px;
            cursor: pointer;
            font-size: 0.9rem;
        `;
        
        logoutBtn.addEventListener('click', function() {
            sessionStorage.removeItem('discordBotToken');
            sessionStorage.removeItem('botInfo');
            botTokenInput.value = '';
            hideStatus();
            logoutBtn.remove();
        });
        
        loginForm.appendChild(logoutBtn);
    }

    // Show logout button if logged in
    if (sessionStorage.getItem('discordBotToken')) {
        addLogoutButton();
    }

    // Test connection button
    const testBtn = document.getElementById('testBtn');
    testBtn.addEventListener('click', async function() {
        showStatus('Testing connection to server...', 'info');
        
        try {
            const response = await fetch('/api/health', {
                method: 'GET'
            });
            
            if (response.ok) {
                showStatus('✅ Server connection successful!', 'success');
                
                // Test canvas functionality
                showStatus('Testing canvas functionality...', 'info');
                try {
                    const canvasResponse = await fetch('/api/test-canvas');
                    if (canvasResponse.ok) {
                        showStatus('✅ Canvas functionality working!', 'success');
                        
                        // Test emoji functionality
                        showStatus('Testing emoji rendering...', 'info');
                        try {
                            const emojiResponse = await fetch('/api/test-emoji');
                            if (emojiResponse.ok) {
                                showStatus('✅ Emoji rendering working!', 'success');
                            } else {
                                showStatus('❌ Emoji test failed', 'error');
                            }
                        } catch (emojiError) {
                            showStatus('❌ Emoji test failed: ' + emojiError.message, 'error');
                        }
                    } else {
                        showStatus('❌ Canvas test failed', 'error');
                    }
                } catch (canvasError) {
                    showStatus('❌ Canvas test failed: ' + canvasError.message, 'error');
                }
            } else {
                showStatus('❌ Server connection failed', 'error');
            }
        } catch (error) {
            console.error('Test connection error:', error);
            showStatus('❌ Cannot connect to server', 'error');
        }
    });

    // Initialize
    checkExistingLogin();

    // Add token visibility toggle
    const tokenInput = document.getElementById('botToken');
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.innerHTML = '<i class="fas fa-eye"></i>';
    toggleBtn.style.cssText = `
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        cursor: pointer;
        color: #72767d;
        font-size: 1rem;
    `;
    
    // Make input container relative
    tokenInput.parentElement.style.position = 'relative';
    tokenInput.parentElement.appendChild(toggleBtn);
    
    let isVisible = false;
    toggleBtn.addEventListener('click', function() {
        isVisible = !isVisible;
        tokenInput.type = isVisible ? 'text' : 'password';
        toggleBtn.innerHTML = isVisible ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
    });
});
