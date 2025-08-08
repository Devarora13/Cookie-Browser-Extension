// Background Script - Service Worker that handles all the cookie operations
(function() {
  'use strict';

  // Keep track of which tabs are monitoring which domains for real-time updates
  const activeTabDomains = new Map();
  
  // Main message handler - routes messages from content scripts to appropriate handlers
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Using async IIFE pattern to handle async operations properly
    (async () => {
      try {
        switch (message.type) {
          case 'CHECK_PERMISSION':
            await handlePermissionCheck(message, sender, sendResponse);
            break;
            
          case 'REQUEST_COOKIE_PERMISSION':
            await handlePermissionRequest(message, sender, sendResponse);
            break;
            
          case 'FETCH_COOKIES':
            await handleFetchCookies(message, sender, sendResponse);
            break;
            
          case 'CLEAR_DOMAIN_COOKIES':
            await handleClearDomainCookies(message, sender, sendResponse);
            break;
            
          case 'REVOKE_COOKIE_PERMISSION':
            await handleRevokePermission(message, sender, sendResponse);
            break;
            
          default:
            console.warn('Unknown message type:', message.type);
            sendResponse({ error: 'Unknown message type' });
        }
      } catch (error) {
        console.error('Background script error:', error);
        sendResponse({ error: error.message });
      }
    })();
    
    return true; // Important: keeps the message channel open for async responses
  });

  // Simple check to see if we currently have cookie permission
  async function handlePermissionCheck(message, sender, sendResponse) {
    try {
      const hasPermission = await checkCookiePermission();
      
      if (hasPermission) {
        // Set up cookie listener if we have permission
        await setupCookieListener();
        // Register this tab for real-time updates
        activeTabDomains.set(sender.tab.id, message.domain);
      }
      
      sendResponse({
        type: 'PERMISSION_CHECK_RESULT',
        hasPermission: hasPermission
      });
    } catch (error) {
      console.error('Permission check error:', error);
      sendResponse({ type: 'ERROR', message: 'Failed to check permissions' });
    }
  }

  // Request cookie permission from user
  async function handlePermissionRequest(message, sender, sendResponse) {
    try {
      console.log('Requesting cookie permission...');
      
      const granted = await new Promise(resolve => {
        chrome.permissions.request(
          { permissions: ['cookies'] },
          (result) => {
            console.log('Permission result:', result);
            resolve(result);
          }
        );
      });

      if (granted) {
        console.log('Permission granted');
        
        // Set up cookie listener now that we have permission
        await setupCookieListener();
        
        // Register this tab for real-time updates
        activeTabDomains.set(sender.tab.id, message.domain);
        
        // Send permission granted response
        chrome.tabs.sendMessage(sender.tab.id, { type: 'PERMISSION_GRANTED' });
        
        sendResponse({ type: 'PERMISSION_GRANTED' });
      } else {
        console.log('Permission denied');
        chrome.tabs.sendMessage(sender.tab.id, { type: 'PERMISSION_DENIED' });
        sendResponse({ type: 'PERMISSION_DENIED' });
      }
    } catch (error) {
      console.error('Permission request error:', error);
      chrome.tabs.sendMessage(sender.tab.id, { 
        type: 'ERROR', 
        message: 'Failed to request permission' 
      });
      sendResponse({ type: 'ERROR', message: 'Failed to request permission' });
    }
  }

  // Fetch cookies for a domain
  async function handleFetchCookies(message, sender, sendResponse) {
    try {
      console.log('handleFetchCookies called for domain:', message.domain || message.url);
      const hasPermission = await checkCookiePermission();
      
      if (!hasPermission) {
        console.log('No cookie permission, sending error');
        const errorMsg = { type: 'ERROR', message: 'Cookie permission not granted' };
        chrome.tabs.sendMessage(sender.tab.id, errorMsg);
        sendResponse(errorMsg);
        return;
      }

      const domain = extractDomain(message.url || message.domain);
      console.log('Fetching cookies for domain:', domain);
      const cookies = await getCookiesForDomain(domain);
      console.log('Found cookies:', cookies.length);
      
      const response = {
        type: 'COOKIES_DATA',
        cookies: cookies,
        domain: domain
      };
      
      // Send via both methods to ensure delivery
      chrome.tabs.sendMessage(sender.tab.id, response);
      sendResponse(response);
      
    } catch (error) {
      console.error('Fetch cookies error:', error);
      const errorMsg = { type: 'ERROR', message: 'Failed to fetch cookies' };
      chrome.tabs.sendMessage(sender.tab.id, errorMsg);
      sendResponse(errorMsg);
    }
  }

  // Clear all cookies for a domain
  async function handleClearDomainCookies(message, sender, sendResponse) {
    try {
      console.log('handleClearDomainCookies called for domain:', message.domain || message.url);
      const hasPermission = await checkCookiePermission();
      
      if (!hasPermission) {
        console.log('No cookie permission for clearing');
        const errorMsg = { type: 'ERROR', message: 'Cookie permission not granted' };
        chrome.tabs.sendMessage(sender.tab.id, errorMsg);
        sendResponse(errorMsg);
        return;
      }

      const domain = extractDomain(message.url || message.domain);
      console.log('Clearing cookies for domain:', domain);
      const cookies = await getCookiesForDomain(domain);
      console.log('Found cookies to clear:', cookies.length);
      
      // Remove each cookie
      const removePromises = cookies.map(cookie => {
        const url = constructCookieUrl(cookie);
        console.log('Removing cookie:', cookie.name, 'from URL:', url);
        return new Promise(resolve => {
          chrome.cookies.remove({
            url: url,
            name: cookie.name,
            storeId: cookie.storeId
          }, (result) => {
            console.log('Cookie removal result for', cookie.name, ':', result);
            resolve(result);
          });
        });
      });

      await Promise.all(removePromises);
      console.log('All cookies cleared successfully');
      
      const response = { type: 'COOKIES_CLEARED', domain: domain };
      
      // Send via both methods to ensure delivery
      chrome.tabs.sendMessage(sender.tab.id, response);
      sendResponse(response);
      
    } catch (error) {
      console.error('Clear cookies error:', error);
      const errorMsg = { type: 'ERROR', message: 'Failed to clear cookies' };
      chrome.tabs.sendMessage(sender.tab.id, errorMsg);
      sendResponse(errorMsg);
    }
  }

  // Revoke cookie permission
  async function handleRevokePermission(message, sender, sendResponse) {
    try {
      const removed = await new Promise(resolve => {
        chrome.permissions.remove({ permissions: ['cookies'] }, resolve);
      });

      if (removed) {
        // Remove cookie listener when permission is revoked
        try {
          if (chrome.cookies && chrome.cookies.onChanged && chrome.cookies.onChanged.hasListener(handleCookieChange)) {
            chrome.cookies.onChanged.removeListener(handleCookieChange);
            console.log('Cookie change listener removed');
          }
        } catch (error) {
          console.log('Cookie listener cleanup error (expected):', error.message);
        }
        
        // Clear all active tab registrations
        activeTabDomains.clear();
        
        sendResponse({ type: 'PERMISSION_REVOKED' });
      } else {
        sendResponse({ type: 'ERROR', message: 'Failed to revoke permission' });
      }
    } catch (error) {
      console.error('Revoke permission error:', error);
      sendResponse({ type: 'ERROR', message: 'Failed to revoke permission' });
    }
  }

  // Helper function to check if we have cookie permission
  async function checkCookiePermission() {
    return new Promise(resolve => {
      chrome.permissions.contains({ permissions: ['cookies'] }, resolve);
    });
  }

  // Helper function to get cookies for a domain
  async function getCookiesForDomain(domain) {
    return new Promise(resolve => {
      chrome.cookies.getAll({ domain: domain }, cookies => {
        if (chrome.runtime.lastError) {
          console.error('Cookie fetch error:', chrome.runtime.lastError);
          resolve([]);
        } else {
          resolve(cookies || []);
        }
      });
    });
  }

  // Helper function to extract domain from URL
  function extractDomain(url) {
    try {
      if (url.startsWith('http')) {
        return new URL(url).hostname;
      }
      return url; // Assume it's already a domain
    } catch (error) {
      console.error('Invalid URL:', url);
      return url;
    }
  }

  // Helper function to construct proper cookie URL
  function constructCookieUrl(cookie) {
    const protocol = cookie.secure ? 'https://' : 'http://';
    const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    return protocol + domain + cookie.path;
  }

  // Real-time cookie change monitoring - only set up if permission exists
  async function setupCookieListener() {
    try {
      const hasPermission = await checkCookiePermission();
      if (hasPermission && chrome.cookies && chrome.cookies.onChanged) {
        // Remove existing listener to prevent duplicates
        if (chrome.cookies.onChanged.hasListener(handleCookieChange)) {
          chrome.cookies.onChanged.removeListener(handleCookieChange);
        }
        chrome.cookies.onChanged.addListener(handleCookieChange);
        console.log('Cookie change listener set up');
      }
    } catch (error) {
      console.error('Failed to setup cookie listener:', error);
    }
  }

  // Handle cookie changes
  async function handleCookieChange(changeInfo) {
    try {
      const hasPermission = await checkCookiePermission();
      if (!hasPermission) return;

      const cookie = changeInfo.cookie;
      const cookieDomain = cookie.domain.replace(/^\./, '');

      // Notify all relevant tabs about cookie changes
      for (const [tabId, domain] of activeTabDomains.entries()) {
        if (domain === cookieDomain || cookieDomain.includes(domain) || domain.includes(cookieDomain)) {
          try {
            const updatedCookies = await getCookiesForDomain(domain);
            
            chrome.tabs.sendMessage(tabId, {
              type: 'REAL_TIME_COOKIE_UPDATE',
              cookies: updatedCookies,
              domain: domain,
              changeInfo: {
                cause: changeInfo.cause,
                removed: changeInfo.removed
              }
            }).catch(error => {
              // Tab might be closed, remove from active domains
              console.log('Tab closed, removing from active domains:', tabId);
              activeTabDomains.delete(tabId);
            });
          } catch (error) {
            console.error('Error sending real-time update:', error);
            activeTabDomains.delete(tabId);
          }
        }
      }
    } catch (error) {
      console.error('Cookie change listener error:', error);
    }
  }

  // Clean up when tabs are closed
  chrome.tabs.onRemoved.addListener((tabId) => {
    activeTabDomains.delete(tabId);
  });

  // Clean up when tabs are updated (e.g., navigated to different domain)
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && activeTabDomains.has(tabId)) {
      const newDomain = extractDomain(changeInfo.url);
      const oldDomain = activeTabDomains.get(tabId);
      
      if (newDomain !== oldDomain) {
        activeTabDomains.delete(tabId);
      }
    }
  });

  // Handle extension startup
  chrome.runtime.onStartup.addListener(async () => {
    console.log('Cookie Viewer Extension started');
    activeTabDomains.clear();
    // Set up cookie listener if we already have permission
    await setupCookieListener();
  });

  // Handle extension installation
  chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('Cookie Viewer Extension installed:', details.reason);
    activeTabDomains.clear();
    // Set up cookie listener if we already have permission
    await setupCookieListener();
  });

})();
