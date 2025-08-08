// Cookie Extension Content Script
(function() {
  'use strict';
  
  let currentDomain = null;
  let overlayVisible = false;
  let cookiesActivelyRequested = false; // Track if user actually clicked to see cookies

  // Safely inject my custom CSS without conflicts
  function injectStyles() {
    if (document.getElementById('cookie-extension-styles')) return;
    
    const link = document.createElement('link');
    link.id = 'cookie-extension-styles';
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = chrome.runtime.getURL('styles.css');
    document.head.appendChild(link);
  }

  // Build the main overlay that shows cookie info
  function createOverlay() {
    if (document.getElementById('cookie-extension-overlay')) return;

    injectStyles();
    currentDomain = new URL(location.href).hostname;

    const overlay = document.createElement('div');
    overlay.id = 'cookie-extension-overlay';
    overlay.className = 'cookie-extension-overlay';

    const isHttps = location.protocol === 'https:';
    
    overlay.innerHTML = `
      <div class="extension-header">
        <strong>🍪 Cookie Viewer</strong>
        <button id="close-overlay" class="close-btn">×</button>
      </div>
      <div class="info-section">
        <div class="info-item">
          <strong>URL:</strong> <span class="url-text">${escapeHtml(location.href)}</span>
        </div>
        <div class="info-item">
          <strong>Domain:</strong> <span class="domain-text">${escapeHtml(currentDomain)}</span>
        </div>
        <div class="info-item">
          <strong>HTTPS:</strong> <span class="https-indicator ${isHttps ? 'secure' : 'insecure'}">${isHttps ? '✅ Yes' : '❌ No'}</span>
        </div>
      </div>
      <div class="cookie-section">
        <button id="cookie-permission-btn" class="primary-btn">Grant Cookie Access</button>
        <div id="cookie-controls" class="cookie-controls" style="display: none;">
          <button id="clear-cookies-btn" class="danger-btn">Clear All Cookies</button>
          <button id="revoke-permission-btn" class="secondary-btn">Revoke Permission</button>
        </div>
        <div id="cookie-list" class="cookie-list"></div>
      </div>
    `;

    // Insert overlay into page with error handling
    try {
      document.body.appendChild(overlay);
      overlayVisible = true;
      setupEventListeners();
      checkInitialPermissionState();
    } catch (error) {
      console.error('Cookie Extension: Failed to create overlay', error);
    }
  }

  // Important: Always escape HTML to prevent XSS attacks
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Wire up all the button clicks and interactions
  function setupEventListeners() {
    const overlay = document.getElementById('cookie-extension-overlay');
    if (!overlay) return;

    // Close overlay
    overlay.querySelector('#close-overlay')?.addEventListener('click', hideOverlay);

    // Permission button - handles both permission request and cookie fetching
    overlay.querySelector('#cookie-permission-btn')?.addEventListener('click', handleCookiePermissionButton);

    // Cookie management buttons
    overlay.querySelector('#clear-cookies-btn')?.addEventListener('click', clearDomainCookies);
    overlay.querySelector('#revoke-permission-btn')?.addEventListener('click', revokePermission);
  }

  // Check what permissions we already have when overlay first opens
  function checkInitialPermissionState() {
    // Check if extension context is still valid
    if (!chrome.runtime.id) {
      console.log('Extension context invalidated, skipping permission check');
      handleExtensionReload();
      return;
    }
    
    sendSecureMessage({
      type: 'CHECK_PERMISSION',
      domain: currentDomain,
      url: location.href
    }).catch(error => {
      console.error('Failed to check initial permission state:', error);
    });
  }

  // This button does double duty - requests permission OR shows cookies
  function handleCookiePermissionButton() {
    const btn = document.getElementById('cookie-permission-btn');
    if (!btn) return;
    
    const buttonText = btn.textContent;
    
    if (buttonText === 'Grant Cookie Access') {
      // First time - need to request permission
      requestCookiePermission();
    } else if (buttonText === 'Show Cookies') {
      // Permission already granted, user wants to see the actual cookies
      cookiesActivelyRequested = true;
      btn.textContent = 'Loading...';
      btn.disabled = true;
      fetchCookiesForDisplay();
      // Give some feedback to user, then reset button
      setTimeout(() => {
        btn.textContent = 'Show Cookies';
        btn.disabled = false;
      }, 1000);
    }
  }

  // Separate function just for fetching cookies when user clicks
  function fetchCookiesForDisplay() {
    sendSecureMessage({
      type: 'FETCH_COOKIES',
      domain: currentDomain,
      url: location.href
    }).catch(error => {
      console.error('Failed to fetch cookies:', error);
      updateCookieList('Failed to fetch cookies. Please try again.');
    });
  }

  // Ask Chrome for permission to access cookies
  function requestCookiePermission() {
    updatePermissionButton('Requesting permission...', true);
    console.log('Requesting cookie permission for domain:', currentDomain);
    
    // Make sure extension hasn't been reloaded/disabled
    if (!chrome.runtime.id) {
      console.log('Extension context invalidated during permission request');
      handleExtensionReload();
      return;
    }
    
    const message = {
      type: 'REQUEST_COOKIE_PERMISSION',
      domain: currentDomain,
      url: location.href
    };
    
    chrome.runtime.sendMessage(message)
      .then(response => {
        console.log('Permission request response:', response);
      })
      .catch(error => {
        console.error('Permission request failed:', error);
        
        // Handle extension context invalidated error
        if (error.message && error.message.includes('Extension context invalidated')) {
          handleExtensionReload();
          return;
        }
        
        updatePermissionButton('Request Failed - Click to Retry', false);
        updateCookieList('Failed to request permission. Please try again.');
      });
  }

  // Nuclear option - delete all cookies for this domain
  function clearDomainCookies() {
    if (!confirm(`Are you sure you want to clear all cookies for ${currentDomain}?`)) {
      return;
    }
    
    updateCookieList('Clearing cookies...');
    
    sendSecureMessage({
      type: 'CLEAR_DOMAIN_COOKIES',
      domain: currentDomain,
      url: location.href
    }).catch(error => {
      console.error('Failed to clear cookies:', error);
      updateCookieList('Failed to clear cookies. Please try again.');
    });
  }

  // Let user take back permission if they want
  function revokePermission() {
    if (!confirm('Are you sure you want to revoke cookie access? This will hide all cookie data.')) {
      return;
    }
    
    sendSecureMessage({
      type: 'REVOKE_COOKIE_PERMISSION'
    }).then(response => {
      console.log('Revoke permission response:', response);
      // Handle the response directly since it comes via sendResponse, not onMessage
      if (response && response.type === 'PERMISSION_REVOKED') {
        showPermissionRevoked();
      } else if (response && response.type === 'ERROR') {
        updateCookieList(`Error: ${escapeHtml(response.message)}`);
      }
    }).catch(error => {
      console.error('Failed to revoke permission:', error);
      updateCookieList('Failed to revoke permission. Please try again.');
    });
  }

  // Clean up when user closes the overlay
  function hideOverlay() {
    const overlay = document.getElementById('cookie-extension-overlay');
    if (overlay) {
      overlay.remove();
      overlayVisible = false;
      cookiesActivelyRequested = false; // Reset state
    }
  }

  // Helper to update the main permission button
  function updatePermissionButton(text, disabled = false) {
    const btn = document.getElementById('cookie-permission-btn');
    if (btn) {
      btn.textContent = text;
      btn.disabled = disabled;
    }
  }

  // This updates the cookie display area with content or error messages
  function updateCookieList(content) {
    console.log('updateCookieList called with content type:', typeof content);
    const listElement = document.getElementById('cookie-list');
    console.log('Cookie list element found:', !!listElement);
    
    if (listElement) {
      if (typeof content === 'string') {
        // Check if this is raw HTML content or plain text that needs escaping
        if (content.includes('<div class="cookies-header">') || content.includes('<div class="cookie-item">')) {
          // It's HTML content, insert directly
          listElement.innerHTML = content;
        } else {
          // Plain text - escape it and wrap in a status div
          listElement.innerHTML = `<div class="status-message">${escapeHtml(content)}</div>`;
        }
      } else {
        listElement.innerHTML = content;
      }
      console.log('Cookie list updated, new innerHTML length:', listElement.innerHTML.length);
    } else {
      console.error('Cookie list element not found!');
    }
  }

  // Show permission granted state
  function showPermissionGranted() {
    const permissionBtn = document.getElementById('cookie-permission-btn');
    const cookieControls = document.getElementById('cookie-controls');
    
    if (permissionBtn) {
      // Change button to "Show Cookies" as per requirements
      permissionBtn.textContent = 'Show Cookies';
      permissionBtn.disabled = false;
      permissionBtn.style.display = 'block';
    }
    
    if (cookieControls) {
      cookieControls.style.display = 'block';
    }
    
    // Never auto-fetch cookies - user must always click "Show Cookies"
    updateCookieList('Click "Show Cookies" to view cookies for this domain.');
  }

  // Show permission denied state
  function showPermissionDenied() {
    updatePermissionButton('Access Denied', true); // Disabled as per requirements
    updateCookieList('Cookie access denied. The extension needs cookie permission to display cookies for this domain.');
    
    const cookieControls = document.getElementById('cookie-controls');
    if (cookieControls) {
      cookieControls.style.display = 'none';
    }
    
    // Add a way for user to try again after some time
    setTimeout(() => {
      const btn = document.getElementById('cookie-permission-btn');
      if (btn && btn.textContent === 'Access Denied') {
        btn.textContent = 'Grant Cookie Access';
        btn.disabled = false;
      }
    }, 3000); // Allow retry after 3 seconds
  }

  // Show permission revoked state
  function showPermissionRevoked() {
    const permissionBtn = document.getElementById('cookie-permission-btn');
    const cookieControls = document.getElementById('cookie-controls');
    
    if (permissionBtn) {
      permissionBtn.style.display = 'block';
      permissionBtn.textContent = 'Grant Cookie Access';
      permissionBtn.disabled = false;
    }
    
    if (cookieControls) {
      cookieControls.style.display = 'none';
    }
    
    // Reset the actively requested flag
    cookiesActivelyRequested = false;
    
    updateCookieList('Cookie permission revoked. Click "Grant Cookie Access" to access cookies again.');
  }

  // Display cookies in a secure, formatted way
  function displayCookies(cookies) {
    console.log('displayCookies called with:', cookies);
    
    if (!cookies || cookies.length === 0) {
      console.log('No cookies to display');
      updateCookieList('No cookies found for this domain.');
      return;
    }

    console.log(`Displaying ${cookies.length} cookies`);
    let html = '<div class="cookies-header">Cookies for this domain:</div>';
    
    cookies.forEach((cookie, index) => {
      const isSecure = cookie.secure ? '🔒' : '🔓';
      const isHttpOnly = cookie.httpOnly ? '🚫' : '👁️';
      const sameSite = cookie.sameSite || 'none';
      
      html += `
        <div class="cookie-item" data-index="${index}">
          <div class="cookie-name">
            <strong>${escapeHtml(cookie.name)}</strong>
            <span class="cookie-flags">
              <span title="${cookie.secure ? 'Secure' : 'Not Secure'}">${isSecure}</span>
              <span title="${cookie.httpOnly ? 'HTTP Only' : 'Accessible via JavaScript'}">${isHttpOnly}</span>
              <span title="SameSite: ${sameSite}" class="samesite">${sameSite}</span>
            </span>
          </div>
          <div class="cookie-value">${escapeHtml(cookie.value || '(empty)')}</div>
          <div class="cookie-details">
            <small>
              Domain: ${escapeHtml(cookie.domain)} | 
              Path: ${escapeHtml(cookie.path)} |
              ${cookie.expirationDate ? `Expires: ${new Date(cookie.expirationDate * 1000).toLocaleString()}` : 'Session cookie'}
            </small>
          </div>
        </div>
      `;
    });

    console.log('Generated HTML length:', html.length);
    updateCookieList(html);
  }

  // Secure message passing to background script
  function sendSecureMessage(message) {
    console.log('Sending message:', message);
    return chrome.runtime.sendMessage(message)
      .then(response => {
        console.log('Message response:', response);
        return response;
      })
      .catch(error => {
        console.error('Cookie Extension: Message sending failed', error);
        
        // Handle extension context invalidated error
        if (error.message && error.message.includes('Extension context invalidated')) {
          console.log('Extension was reloaded, cleaning up...');
          handleExtensionReload();
          return;
        }
        
        updateCookieList('Communication error with extension background script.');
        throw error;
      });
  }

  // Handle extension reload/invalidation
  function handleExtensionReload() {
    const overlay = document.getElementById('cookie-extension-overlay');
    if (overlay) {
      // Show a user-friendly message
      const listElement = document.getElementById('cookie-list');
      if (listElement) {
        listElement.innerHTML = `
          <div class="status-message" style="color: #e53e3e; text-align: center;">
            <strong>⚠️ Extension Reloaded</strong><br>
            <small>Please close and reopen this overlay to continue using the extension.</small>
          </div>
        `;
      }
      
      // Disable all buttons
      const buttons = overlay.querySelectorAll('button');
      buttons.forEach(btn => {
        if (btn.id !== 'close-overlay') {
          btn.disabled = true;
          btn.style.opacity = '0.5';
        }
      });
    }
  }

  // Handle messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Check if extension context is still valid
    if (!chrome.runtime.id) {
      console.log('Extension context invalidated, ignoring message');
      return;
    }
    
    console.log('Message received:', message);
    
    // Verify the message is from our extension
    if (!sender.id || sender.id !== chrome.runtime.id) {
      console.log('Message rejected - not from our extension');
      return;
    }

    try {
      console.log('Processing message type:', message.type);
      switch (message.type) {
        case 'PERMISSION_CHECK_RESULT':
          console.log('Handling PERMISSION_CHECK_RESULT');
          if (message.hasPermission) {
            // Permission exists but don't auto-fetch cookies - user must click button
            showPermissionGranted();
          } else {
            updatePermissionButton('Grant Cookie Access', false);
            updateCookieList('Click "Grant Cookie Access" to view cookies for this domain.');
          }
          break;

        case 'PERMISSION_GRANTED':
          console.log('Handling PERMISSION_GRANTED');
          // Permission newly granted - still require user to click "Show Cookies"
          showPermissionGranted();
          break;

        case 'PERMISSION_DENIED':
          console.log('Handling PERMISSION_DENIED');
          showPermissionDenied();
          break;

        case 'PERMISSION_REVOKED':
          console.log('Handling PERMISSION_REVOKED');
          showPermissionRevoked();
          break;

        case 'COOKIES_DATA':
          console.log('Handling COOKIES_DATA with cookies:', message.cookies);
          displayCookies(message.cookies);
          break;

        case 'COOKIES_CLEARED':
          console.log('Handling COOKIES_CLEARED');
          updateCookieList('All cookies cleared for this domain.');
          // The real-time listener will automatically update with the new state
          break;

        case 'REAL_TIME_COOKIE_UPDATE':
          console.log('Handling REAL_TIME_COOKIE_UPDATE');
          // Only update if overlay is visible, for current domain, AND user has actively requested cookies
          if (overlayVisible && message.domain === currentDomain && cookiesActivelyRequested) {
            displayCookies(message.cookies);
          }
          break;

        case 'ERROR':
          console.log('Handling ERROR');
          updateCookieList(`Error: ${escapeHtml(message.message)}`);
          updatePermissionButton('Grant Cookie Access', false);
          break;

        default:
          console.warn('Cookie Extension: Unknown message type', message.type);
      }
    } catch (error) {
      console.error('Cookie Extension: Error handling message', error);
    }

    sendResponse({ received: true });
  });

  // Toggle overlay when extension icon is clicked
  window.addEventListener('toggle-extension-overlay', () => {
    const overlay = document.getElementById('cookie-extension-overlay');
    if (overlay) {
      hideOverlay();
    } else {
      createOverlay();
    }
  });

  // Clean up when page is unloaded
  window.addEventListener('beforeunload', () => {
    hideOverlay();
  });

  // Global error handler for extension context invalidation
  window.addEventListener('error', (event) => {
    if (event.error && event.error.message && event.error.message.includes('Extension context invalidated')) {
      console.log('Caught extension context invalidated error globally');
      event.preventDefault(); // Prevent the error from appearing in console
      handleExtensionReload();
    }
  });

  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.message && event.reason.message.includes('Extension context invalidated')) {
      console.log('Caught extension context invalidated promise rejection');
      event.preventDefault(); // Prevent the error from appearing in console
      handleExtensionReload();
    }
  });

})();
