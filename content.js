// Content Script - Handles UI overlay and secure communication
(function() {
  'use strict';
  
  let currentDomain = null;
  let overlayVisible = false;

  // Inject external CSS file securely
  function injectStyles() {
    if (document.getElementById('cookie-extension-styles')) return;
    
    const link = document.createElement('link');
    link.id = 'cookie-extension-styles';
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = chrome.runtime.getURL('styles.css');
    document.head.appendChild(link);
  }

  // Create the secure UI overlay
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
          <button id="refresh-cookies-btn" class="secondary-btn">Refresh Cookies</button>
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

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Set up secure event listeners
  function setupEventListeners() {
    const overlay = document.getElementById('cookie-extension-overlay');
    if (!overlay) return;

    // Close overlay
    overlay.querySelector('#close-overlay')?.addEventListener('click', hideOverlay);

    // Permission button
    overlay.querySelector('#cookie-permission-btn')?.addEventListener('click', requestCookiePermission);

    // Cookie management buttons
    overlay.querySelector('#refresh-cookies-btn')?.addEventListener('click', refreshCookies);
    overlay.querySelector('#clear-cookies-btn')?.addEventListener('click', clearDomainCookies);
    overlay.querySelector('#revoke-permission-btn')?.addEventListener('click', revokePermission);
  }

  // Check initial permission state
  function checkInitialPermissionState() {
    sendSecureMessage({
      type: 'CHECK_PERMISSION',
      domain: currentDomain,
      url: location.href
    });
  }

  // Request cookie permission from user
  function requestCookiePermission() {
    updatePermissionButton('Requesting permission...', true);
    console.log('Requesting cookie permission for domain:', currentDomain);
    
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
        updatePermissionButton('Request Failed - Click to Retry', false);
        updateCookieList('Failed to request permission. Please try again.');
      });
  }

  // Refresh cookie display
  function refreshCookies() {
    updateCookieList('Refreshing cookies...');
    
    sendSecureMessage({
      type: 'FETCH_COOKIES',
      domain: currentDomain,
      url: location.href
    });
  }

  // Clear all cookies for current domain
  function clearDomainCookies() {
    if (!confirm(`Are you sure you want to clear all cookies for ${currentDomain}?`)) {
      return;
    }
    
    updateCookieList('Clearing cookies...');
    
    sendSecureMessage({
      type: 'CLEAR_DOMAIN_COOKIES',
      domain: currentDomain,
      url: location.href
    });
  }

  // Revoke cookie permission
  function revokePermission() {
    if (!confirm('Are you sure you want to revoke cookie access? This will hide all cookie data.')) {
      return;
    }
    
    sendSecureMessage({
      type: 'REVOKE_COOKIE_PERMISSION'
    });
  }

  // Hide the overlay
  function hideOverlay() {
    const overlay = document.getElementById('cookie-extension-overlay');
    if (overlay) {
      overlay.remove();
      overlayVisible = false;
    }
  }

  // Update permission button state
  function updatePermissionButton(text, disabled = false) {
    const btn = document.getElementById('cookie-permission-btn');
    if (btn) {
      btn.textContent = text;
      btn.disabled = disabled;
    }
  }

  // Update cookie list display
  function updateCookieList(content) {
    console.log('updateCookieList called with content type:', typeof content);
    const listElement = document.getElementById('cookie-list');
    console.log('Cookie list element found:', !!listElement);
    
    if (listElement) {
      if (typeof content === 'string') {
        // Check if content contains HTML tags (raw HTML) or should be escaped
        if (content.includes('<div class="cookies-header">') || content.includes('<div class="cookie-item">')) {
          // Raw HTML content
          listElement.innerHTML = content;
        } else {
          // Text content that should be escaped and wrapped
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
      permissionBtn.style.display = 'none';
    }
    
    if (cookieControls) {
      cookieControls.style.display = 'block';
    }
    
    // Automatically fetch cookies when permission is granted
    refreshCookies();
  }

  // Show permission denied state
  function showPermissionDenied() {
    updatePermissionButton('Permission Denied - Click to Retry', false);
    updateCookieList('Cookie access denied. Click "Permission Denied" button to try again.');
    
    const cookieControls = document.getElementById('cookie-controls');
    if (cookieControls) {
      cookieControls.style.display = 'none';
    }
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
    
    updateCookieList('Cookie permission revoked. Grant permission to view cookies.');
  }

  // Display cookies in a secure, formatted way
  function displayCookies(cookies) {
    console.log('displayCookies called with:', cookies);
    
    if (!cookies || cookies.length === 0) {
      console.log('No cookies to display');
      updateCookieList('<div class="no-cookies">No cookies found for this domain.</div>');
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
        updateCookieList('Communication error with extension background script.');
        throw error;
      });
  }

  // Handle messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
            showPermissionGranted();
          } else {
            updatePermissionButton('Grant Cookie Access', false);
            updateCookieList('Click "Grant Cookie Access" to view cookies for this domain.');
          }
          break;

        case 'PERMISSION_GRANTED':
          console.log('Handling PERMISSION_GRANTED');
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
          // Refresh to show current state
          setTimeout(refreshCookies, 500);
          break;

        case 'REAL_TIME_COOKIE_UPDATE':
          console.log('Handling REAL_TIME_COOKIE_UPDATE');
          // Only update if overlay is visible and for current domain
          if (overlayVisible && message.domain === currentDomain) {
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

})();
